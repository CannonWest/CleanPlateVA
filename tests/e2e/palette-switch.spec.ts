/**
 * A palette switch is paint, not data (2026-09-07) — the page, end to end,
 * on the production build. The dots' fill is a paint expression over the
 * bucket each feature carries (mapLayers pointFillExpr), so choosing the
 * color-blind ramp in the settings dialog re-points the layer in place and
 * never re-sets the source: no GeoJSON rebuild, no worker re-index — the
 * principle the cluster switch and the declining ring already held, now
 * the palette's too.
 *
 * Counted, not inferred: the source's `setData` is wrapped on the live map
 * before the switch and read back after. The basic map is enough to prove
 * the MECHANISM (every bucket is zero there, so the dots stay gray either
 * way — the expression's fallback); the fills themselves are pinned by
 * map-layers.spec through MapLibre's own evaluator.
 */
import { expect, test } from '@playwright/test'
import {
    LYR_POINTS, PALETTE_KEY, SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY, SRC, THEME_KEY,
} from '../../app/constants'
import { gradeHex } from '../../app/data/presentation'

// The A fill in each ramp — the one hex that tells the two apart in a
// serialized expression (the grays are shared).
const STANDARD_A = gradeHex('A', 'standard')
const COLORBLIND_A = gradeHex('A', 'colorblind')

interface MapHandle {
    loaded(): boolean
    queryRenderedFeatures(options: { layers: string[] }): unknown[]
    getSource(id: string): { setData(data: unknown): unknown } | undefined
    getPaintProperty(layer: string, name: string): unknown
}
type Probe = { __cpMap?: MapHandle; __setDataCalls?: () => number }

test('choosing the color-blind ramp re-points the dots\' fill in place and never re-sets the source', async ({ page }) => {
    await page.addInitScript((entries) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value)
    }, Object.entries({ [SETTINGS_SEEN_KEY]: '1', [SETTINGS_HINT_KEY]: '1', [THEME_KEY]: 'dark' }))
    await page.goto('/?tier=lite')
    await page.waitForFunction(
        (layer) => {
            const map = (window as unknown as Probe).__cpMap
            if (!map?.loaded()) return false
            try { return map.queryRenderedFeatures({ layers: [layer] }).length > 0 } catch { return false }
        },
        LYR_POINTS,
        { timeout: 60_000, polling: 250 },
    )

    // Count every setData from here on.
    await page.evaluate((src) => {
        const probe = window as unknown as Probe
        const source = probe.__cpMap?.getSource(src)
        if (!source) throw new Error('no source')
        const original = source.setData.bind(source)
        let calls = 0
        source.setData = (data: unknown) => { calls += 1; return original(data) }
        probe.__setDataCalls = () => calls
    }, SRC)
    const fillOf = () => page.evaluate(
        (layer) => JSON.stringify((window as unknown as Probe).__cpMap?.getPaintProperty(layer, 'circle-color')),
        LYR_POINTS)
    const before = await fillOf()
    expect(before).toContain(STANDARD_A)
    expect(before).not.toContain(COLORBLIND_A)

    // The real dialog: the pill under the band, then the ramp.
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('radio', { name: /Color-blind friendly/ }).click()
    await page.waitForFunction(
        ([layer, hex]) => JSON.stringify((window as unknown as Probe).__cpMap?.getPaintProperty(layer as string, 'circle-color')).includes(hex as string),
        [LYR_POINTS, COLORBLIND_A],
        { timeout: 10_000 },
    )
    const after = await fillOf()
    expect(after).toContain(COLORBLIND_A)
    expect(after).not.toContain(STANDARD_A)
    // Persisted for the visitor, never in the URL (C6).
    expect(await page.evaluate((key) => window.localStorage.getItem(key), PALETTE_KEY)).toBe('colorblind')
    await expect(page).not.toHaveURL(/palette/)
    // And the source was left alone.
    expect(await page.evaluate(() => (window as unknown as Probe).__setDataCalls?.())).toBe(0)
})
