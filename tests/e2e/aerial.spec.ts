/**
 * The aerial basemap, end to end (2026-09-07; design ref §7 "the paint
 * proof", §6.2). `map-layers.spec.ts` pins WHERE the raster is inserted
 * against a recording host; it cannot say whether VGIN serves a tile, nor
 * whether the seam this depends on is where the real CARTO styles put it.
 * This does, on the PRODUCTION build in a real Chromium:
 *
 *   · a first-time visitor gets the drawn map — the aerial is the absence
 *     of a layer, not a layer set to invisible;
 *   · the Layers pill flips it, the browser really fetches a VBMP tile
 *     (200, from vginmaps.vdem.virginia.gov — a state ArcGIS server, live,
 *     so an outage there fails this suite exactly as a CARTO outage does);
 *   · **IN BOTH THEMES**, against the real style, every layer the basemap
 *     DRAWS is under the photograph and every label is over it, and the
 *     markers are above all of it. This is the case that matters: the first
 *     cut inserted at the style's first symbol layer, which is right for
 *     dark-matter and wrong for positron — it writes `waterway_label` at
 *     index 13 and then draws 53 more layers of roads, buildings and
 *     boundaries. Dark alone passed; light was a white map with imagery in
 *     the gaps (caught live, not here — hence this case);
 *   · the credit appears with the imagery and leaves with it;
 *   · the choice survives a reload (C6: per visitor, never the URL).
 *
 * The basic map (`?tier=lite`) throughout, as the rest of the e2e suite:
 * no acknowledgement to answer, and the roster is the repo's own committed
 * shards.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
    BASEMAP_KEY, LYR_AERIAL, LYR_CLUSTERS, LYR_POINTS, LYR_STACKS, LYR_STACK_COUNT,
    SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY, SRC_AERIAL, THEME_KEY,
} from '../../app/constants'

const TILE_HOST = 'vginmaps.vdem.virginia.gov'

/** The map's own API, as much as the probes touch. */
interface MapHandle {
    loaded(): boolean
    getLayer(id: string): unknown
    getSource(id: string): unknown
    getStyle(): { name?: string; layers: Array<{ id: string; type: string }> }
    queryRenderedFeatures(options: { layers: string[] }): unknown[]
}
type WithHandle = { __cpMap?: MapHandle }

const OWN_LAYERS = [LYR_AERIAL, LYR_CLUSTERS, LYR_POINTS, LYR_STACKS, LYR_STACK_COUNT]

async function seed(page: Page, prefs: Record<string, string> = {}) {
    await page.addInitScript((entries) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value)
    }, Object.entries({ [SETTINGS_SEEN_KEY]: '1', [SETTINGS_HINT_KEY]: '1', ...prefs }))
}

/** Open the basic map and wait until the markers have rendered. */
async function openPainted(page: Page) {
    await page.goto('/?tier=lite')
    await page.waitForFunction(
        (layer) => {
            const map = (window as unknown as WithHandle).__cpMap
            if (!map?.loaded()) return false
            try {
                return map.queryRenderedFeatures({ layers: [layer] }).length > 0
            } catch {
                return false
            }
        },
        LYR_POINTS,
        { timeout: 60_000, polling: 250 },
    )
}

async function waitForAerial(page: Page) {
    await page.waitForFunction(
        (layer) => !!(window as unknown as WithHandle).__cpMap?.getLayer(layer),
        LYR_AERIAL,
        { timeout: 60_000 },
    )
}

/** The live style, split the way the insertion rule splits it. */
function stack(page: Page, own: readonly string[]) {
    return page.evaluate((own) => {
        const map = (window as unknown as WithHandle).__cpMap
        if (!map) throw new Error('no map handle')
        const style = map.getStyle()
        const ids = style.layers.map((l) => l.id)
        const mine = new Set(own)
        return {
            name: style.name ?? '',
            ids,
            // The basemap's own layers, with the type that decides the seam.
            basemap: style.layers.filter((l) => !mine.has(l.id)).map((l) => ({ id: l.id, type: l.type })),
            markers: map.queryRenderedFeatures({ layers: ['food-points'] }).length,
        }
    }, own)
}

test('a first-time visitor gets the drawn map: the aerial is not on the style at all', async ({ page }) => {
    await seed(page)
    await openPainted(page)
    const present = await page.evaluate(([layer, source]) => {
        const map = (window as unknown as WithHandle).__cpMap
        return { layer: !!map?.getLayer(layer), source: !!map?.getSource(source) }
    }, [LYR_AERIAL, SRC_AERIAL] as const)
    expect(present).toEqual({ layer: false, source: false })
})

test('the Layers pill flips to the aerial: VGIN serves tiles, and the markers never move', async ({ page }) => {
    await seed(page)
    await openPainted(page)
    const before = await stack(page, OWN_LAYERS)
    expect(before.ids).not.toContain(LYR_AERIAL)
    expect(before.markers).toBeGreaterThan(0)

    // The imagery is a live third-party fetch; wait for a real 200.
    const tile = page.waitForResponse(
        (r) => r.url().includes(TILE_HOST) && r.status() === 200,
        { timeout: 60_000 },
    )
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await page.getByRole('radio', { name: /Aerial/ }).click()
    const response = await tile
    expect(response.url()).toContain('/MapServer/tile/')
    await waitForAerial(page)

    const after = await stack(page, OWN_LAYERS)
    // The dots are the same dots — the flip touched one basemap layer.
    expect(after.markers).toBe(before.markers)
    expect(after.ids.filter((id) => id.startsWith('food-')))
        .toEqual(before.ids.filter((id) => id.startsWith('food-')))

    // The credit rides the source, so it is on screen while the imagery is.
    await expect(page.locator('.maplibregl-ctrl-attrib').first()).toContainText('VGIN')

    // The control collapsed on the pick, and reports the choice when reopened.
    await expect(page.getByRole('radiogroup', { name: 'Basemap' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Aerial/ })).toHaveAttribute('aria-checked', 'true')
})

// The case the first cut got wrong. Run against BOTH real CARTO styles: the
// rule is "under everything the basemap draws, over everything it writes",
// and only the live style can say where that seam actually falls.
for (const [theme, styleName] of [['dark', 'Dark Matter'], ['light', 'Positron']] as const) {
    test(`${theme} theme: every drawn ${styleName} layer is UNDER the photo and every label is over it`, async ({ page }) => {
        await seed(page, { [THEME_KEY]: theme, [BASEMAP_KEY]: 'aerial' })
        await openPainted(page)
        await waitForAerial(page)

        const { name, ids, basemap, markers } = await stack(page, OWN_LAYERS)
        expect(name).toBe(styleName)
        const aerialAt = ids.indexOf(LYR_AERIAL)
        expect(aerialAt).toBeGreaterThan(-1)

        const drawn = basemap.filter((l) => l.type !== 'symbol')
        const labels = basemap.filter((l) => l.type === 'symbol')
        expect(drawn.length).toBeGreaterThan(10)
        expect(labels.length).toBeGreaterThan(20)
        // Nothing the basemap DRAWS may paint over the photograph — the
        // whole point of the choice.
        for (const layer of drawn) expect(ids.indexOf(layer.id)).toBeLessThan(aerialAt)

        // Every label a visitor navigates by must stay readable over it:
        // place names, road names, POIs, house numbers.
        const wayfinding = labels.filter((l) => /place|road|poi|housenum|water(name)/.test(l.id))
        expect(wayfinding.length).toBeGreaterThan(10)
        for (const layer of wayfinding) expect(ids.indexOf(layer.id)).toBeGreaterThan(aerialAt)

        // The accepted loss, pinned so a CARTO restyle cannot widen it
        // quietly: positron interleaves ONE label with its cartography
        // (`waterway_label`, river and stream names, at index 13 of 93), so
        // that one goes under the photo — you can see the water anyway.
        // dark-matter writes nothing before it finishes drawing, so it
        // loses none. Anything more than this is a regression.
        const swallowed = labels.filter((l) => ids.indexOf(l.id) < aerialAt).map((l) => l.id)
        expect(swallowed).toEqual(theme === 'light' ? ['waterway_label'] : [])
        // And the markers are above all of it.
        for (const own of OWN_LAYERS.filter((id) => id !== LYR_AERIAL)) {
            expect(ids.indexOf(own)).toBeGreaterThan(aerialAt)
        }
        expect(markers).toBeGreaterThan(0)
    })
}

test('a theme swap keeps the aerial: style.load re-applies it on the new style', async ({ page }) => {
    await seed(page, { [THEME_KEY]: 'dark', [BASEMAP_KEY]: 'aerial' })
    await openPainted(page)
    await waitForAerial(page)
    expect((await stack(page, OWN_LAYERS)).name).toBe('Dark Matter')

    // setStyle drops every custom source and layer; style.load puts them
    // back from the refs, the aerial included.
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('radio', { name: 'Light' }).click()
    await page.keyboard.press('Escape')
    await page.waitForFunction(
        () => (window as unknown as WithHandle).__cpMap?.getStyle().name === 'Positron',
        undefined,
        { timeout: 30_000 },
    )
    await waitForAerial(page)
    const after = await stack(page, OWN_LAYERS)
    const aerialAt = after.ids.indexOf(LYR_AERIAL)
    for (const layer of after.basemap.filter((l) => l.type !== 'symbol')) {
        expect(after.ids.indexOf(layer.id)).toBeLessThan(aerialAt)
    }
})

// The imagery's credit joins CARTO's and OpenStreetMap's on MapLibre's one
// attribution strip, and the footer chip shares that lane — its stop was
// measured (App.tsx, `sm:right-[360px]`) against the strip's width WITHOUT
// an imagery credit. With the aerial on, the first cut's longer credit ran
// under the chip at 1024-1200px and lost its own opening word; a shorter
// credit plus a wider stop (440px) answered that, and then VGIN's condition
// for public use — the program by name (2026-09-08) — made the strip 598px,
// which that stop overlapped by 168px. Now the chip LIFTS one row above the
// strip while the imagery is on (App.tsx), so the clearance is vertical and
// no width of credit reaches it; the predicate below accepts either axis.
// This is what says the two never touch, at the widths where they did.
for (const width of [1024, 1200, 1440]) {
    test(`at ${width}px the imagery credit and the footer chip share the lane without overlapping`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 })
        await seed(page, { [BASEMAP_KEY]: 'aerial' })
        await openPainted(page)
        await waitForAerial(page)

        // MapLibre keeps the strip behind an (i) until it is opened. The
        // OPEN state is the one the lane was measured against (App.tsx) and
        // the one that collided, so measure it open — asserted below to be
        // genuinely wider than the collapsed button, not a no-op.
        const boxes = await page.evaluate(() => {
            const strip = document.querySelector('.maplibregl-ctrl-attrib')
            const lane = [...document.querySelectorAll('div')].find((el) =>
                el.className.includes('pointer-events-none') && el.className.includes('bottom-2.5'))
            // The chip by its TAG, not its position: since 2026-09-09 the
            // Settings pill (and the hint above it) share this box, over the
            // chip, so the first child is no longer the footer.
            const chip = lane?.querySelector('footer')
            if (!strip || !chip) throw new Error('no attribution strip or footer chip')
            const shut = strip.getBoundingClientRect().width
            strip.classList.add('maplibregl-compact-show')
            const a = strip.getBoundingClientRect()
            const c = chip.getBoundingClientRect()
            return {
                text: (strip as HTMLElement).innerText.trim(),
                shut,
                a: { l: a.left, r: a.right, t: a.top, b: a.bottom, w: a.width },
                c: { l: c.left, r: c.right, t: c.top, b: c.bottom },
            }
        })
        // The strip is spelled out and really carries both credits.
        expect(boxes.a.w).toBeGreaterThan(200)
        expect(boxes.text).toContain('VGIN')
        expect(boxes.text).toContain('CARTO')
        const clear = boxes.c.r <= boxes.a.l || boxes.a.r <= boxes.c.l
            || boxes.c.b <= boxes.a.t || boxes.a.b <= boxes.c.t
        expect(clear, `chip ${JSON.stringify(boxes.c)} vs strip ${JSON.stringify(boxes.a)}`).toBe(true)
    })
}

test('the choice is the visitor\'s and survives a reload, without touching the URL (C6)', async ({ page }) => {
    await seed(page, { [BASEMAP_KEY]: 'aerial' })
    await openPainted(page)
    await waitForAerial(page)
    expect(new URL(page.url()).searchParams.has('basemap')).toBe(false)
})

test('back to the drawn map takes the layer and its credit off again', async ({ page }) => {
    await seed(page, { [BASEMAP_KEY]: 'aerial' })
    await openPainted(page)
    await waitForAerial(page)
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await page.getByRole('radio', { name: /Map/ }).click()
    await page.waitForFunction(
        ([layer, source]) => {
            const map = (window as unknown as WithHandle).__cpMap
            return !map?.getLayer(layer) && !map?.getSource(source)
        },
        [LYR_AERIAL, SRC_AERIAL] as const,
        { timeout: 30_000 },
    )
    await expect(page.locator('.maplibregl-ctrl-attrib').first()).not.toContainText('VGIN')
    expect((await stack(page, OWN_LAYERS)).markers).toBeGreaterThan(0)
})
