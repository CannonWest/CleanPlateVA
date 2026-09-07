/**
 * The map paints — the one proof the Vitest suite structurally cannot give
 * (design ref §7). Every map spec under tests/vitest/ runs against a fake:
 * the layer set against a recording host, the hit test against numbers, the
 * donut codec against strings. This file runs the PRODUCTION build in a real
 * Chromium and asks the running map, through the handle MapView leaves on
 * `window.__cpMap`, whether it actually drew:
 *
 *   · `food-points` has RENDERED features — the roster shards loaded, the
 *     worker started from the file the build copied beside the main chunk
 *     (the request the bundler never sees; vite.config.ts), the tiles were
 *     indexed, the layer installed on `style.load`;
 *   · the GL canvas holds more than one color — the painter rasterized,
 *     not just indexed (read back inside a `render` frame, the one moment
 *     the drawing buffer is intact without `preserveDrawingBuffer`);
 *   · in each theme, over that theme's basemap and with the resolved theme
 *     class where the CSS expects it;
 *   · with "Group nearby places" on, cluster bubbles render and the
 *     missing-image resolver has painted donuts — the canvas path jsdom
 *     cannot exercise (donut.ts).
 *
 * The basic map (`?tier=lite`) throughout: no acknowledgement to answer
 * (C2), and its finder shards are COMMITTED under public/data/, so the
 * roster is the repo's own (lite-roster-contract.spec.ts pins its shape).
 * The Full tier's families live on R2 behind the Worker, which `vite
 * preview` does not run — nothing judgment-bearing is asserted here. The
 * basemap is CARTO's, live: a CARTO outage fails this suite, and that is
 * the truth of production too.
 *
 * Screenshots are attached to the report for eyes, never compared: a
 * software rasterizer on a Linux runner does not match a laptop pixel for
 * pixel, and a threshold that survives that proves nothing.
 *
 * Every in-page function below reaches the map through the window itself —
 * Playwright serializes the function, so nothing from this module's scope
 * is there when it runs.
 */
import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import {
    CLUSTERS_KEY, LYR_CLUSTERS, LYR_POINTS, SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY, THEME_KEY,
} from '../../app/constants'

/** The map's own API, as much of it as the probes touch. Typed here rather
 *  than imported: the spec runs in Node and the handle lives in the page. */
interface MapHandle {
    loaded(): boolean
    queryRenderedFeatures(options: { layers: string[] }): Array<{ properties: Record<string, unknown> }>
    listImages(): string[]
    getStyle(): { name?: string }
    getCanvas(): HTMLCanvasElement
    once(event: 'render', fn: () => void): void
    triggerRepaint(): void
}

type WithHandle = { __cpMap?: MapHandle }

/** Seed the visitor's stored choices before the page's own scripts run —
 *  the theme (index.html applies it pre-paint), the switch, and the two
 *  "seen" flags so neither the settings dialog nor its hint sits over the
 *  map in the screenshot. */
async function seed(page: Page, prefs: Record<string, string>) {
    await page.addInitScript((entries) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value)
    }, Object.entries({ [SETTINGS_SEEN_KEY]: '1', [SETTINGS_HINT_KEY]: '1', ...prefs }))
}

/** Open the basic map and wait until it has loaded AND `layer` has
 *  rendered features. */
async function openPainted(page: Page, layer: string) {
    await page.goto('/?tier=lite')
    await page.waitForFunction(
        (layer) => {
            const map = (window as unknown as WithHandle).__cpMap
            if (!map?.loaded()) return false
            try {
                return map.queryRenderedFeatures({ layers: [layer] }).length > 0
            } catch {
                return false // a style swap mid-load: the layer is not there yet
            }
        },
        layer,
        { timeout: 60_000, polling: 250 },
    )
}

/** Rendered-feature counts per layer, from the live map. */
function rendered(page: Page, layers: readonly string[]): Promise<Record<string, number>> {
    return page.evaluate((layers) => {
        const map = (window as unknown as WithHandle).__cpMap
        if (!map) throw new Error('no map handle')
        return Object.fromEntries(
            layers.map((id) => [id, map.queryRenderedFeatures({ layers: [id] }).length]))
    }, layers)
}

/** How many distinct colors the GL canvas holds, sampled — read back inside
 *  the next `render` frame, where the drawing buffer still holds the paint.
 *  A blank canvas is 1; a basemap under ~27k anti-aliased dots is hundreds. */
function distinctCanvasColors(page: Page): Promise<number> {
    return page.evaluate(() => new Promise<number>((resolve, reject) => {
        const map = (window as unknown as WithHandle).__cpMap
        if (!map) return reject(new Error('no map handle'))
        const canvas = map.getCanvas()
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
        if (!gl) return reject(new Error('no GL context on the map canvas'))
        map.once('render', () => {
            const w = gl.drawingBufferWidth
            const h = gl.drawingBufferHeight
            const px = new Uint8Array(w * h * 4)
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
            const seen = new Set<number>()
            for (let i = 0; i < px.length; i += 4 * 7) {
                seen.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0))
            }
            resolve(seen.size)
        })
        map.triggerRepaint()
    }))
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

const THEMES = [
    // [stored choice, CARTO style name, `theme-light` on <html>]
    ['dark', 'Dark Matter', false],
    ['light', 'Positron', true],
] as const

for (const [theme, styleName, lightClass] of THEMES) {
    test(`${theme} theme: the dots paint over the ${styleName} basemap, from the production build`, async ({ page }, testInfo) => {
        await seed(page, { [THEME_KEY]: theme })
        await openPainted(page, LYR_POINTS)

        const style = await page.evaluate(() => ({
            name: (window as unknown as WithHandle).__cpMap?.getStyle().name,
            lightClass: document.documentElement.classList.contains('theme-light'),
        }))
        expect(style.name).toBe(styleName)
        expect(style.lightClass).toBe(lightClass)
        // Every place on the basic map is a dot (P6: no clusters by default,
        // a stack only where two share a point) — thousands at state view.
        const counts = await rendered(page, [LYR_POINTS, LYR_CLUSTERS])
        expect(counts[LYR_POINTS]).toBeGreaterThan(1000)
        expect(counts[LYR_CLUSTERS]).toBe(0)
        // The painter drew, not merely indexed.
        const colors = await distinctCanvasColors(page)
        expect(colors).toBeGreaterThan(16)
        // The margins, for the CI log: the thresholds above are floors.
        console.log(`[${theme}] rendered points ${counts[LYR_POINTS]} · canvas colors ${colors}`)

        await attachScreenshot(page, testInfo, `map-${theme}.png`)
    })
}

test('grouped: the cluster bubbles render and the resolver has painted their donuts', async ({ page }, testInfo) => {
    await seed(page, { [THEME_KEY]: 'dark', [CLUSTERS_KEY]: '1' })
    await openPainted(page, LYR_CLUSTERS)

    const counts = await rendered(page, [LYR_CLUSTERS, LYR_POINTS])
    expect(counts[LYR_CLUSTERS]).toBeGreaterThan(0)
    // Grouped at state view, most of the roster is inside a bubble.
    expect(counts[LYR_POINTS]).toBeLessThan(1000)
    // The ids the layer asked for, painted by the resolver on THIS theme
    // and palette: donut:<theme>:<palette>:<size>:<eight counts>. On the
    // basic map every count is zero — one neutral arc (P6).
    const donuts = await page.evaluate(() => {
        const map = (window as unknown as WithHandle).__cpMap
        if (!map) throw new Error('no map handle')
        return map.listImages().filter((id) => id.startsWith('donut:'))
    })
    expect(donuts.length).toBeGreaterThan(0)
    for (const id of donuts) expect(id).toMatch(/^donut:dark:standard:(12|16|22):0-0-0-0-0-0-0-0$/)
    const colors = await distinctCanvasColors(page)
    expect(colors).toBeGreaterThan(16)
    console.log(`[grouped] rendered clusters ${counts[LYR_CLUSTERS]} · points ${counts[LYR_POINTS]} · donuts ${donuts.length} · canvas colors ${colors}`)

    await attachScreenshot(page, testInfo, 'map-grouped.png')
})
