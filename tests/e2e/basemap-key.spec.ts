/**
 * The CARTO basemap key (2026-10-05), against the live CARTO service.
 *
 *   · keyed: every request the running map makes to a CARTO basemap host —
 *     style, TileJSON, tiles, sprite, glyphs — carries the key for this host
 *     and is answered. The preview is local, so that is the LOCAL key, whose
 *     Referer allowlist holds localhost / 127.0.0.1 (CARTO will not put local
 *     hosts on the public site key); a host a key lacks gets 403s, which is
 *     exactly what the second case guards against on the public site.
 *   · refused: when CARTO refuses the key (faked here on every keyed
 *     request, in both shapes a refusal takes in a browser), the map
 *     reloads keyless and still paints — a missing or
 *     stripped Referer, a revoked or throttled key degrade to the map as it
 *     was before the key, never to an empty canvas (MapView's `error`
 *     listener; basemapRequest.ts).
 */
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { basemapKeyFor } from '../../app/basemapRequest'
import { CARTO_BASEMAP_LOCAL_KEY, LYR_POINTS, SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY } from '../../app/constants'

type WithHandle = {
    __cpMap?: {
        loaded(): boolean
        queryRenderedFeatures(options: { layers: string[] }): unknown[]
    }
}

const isCarto = (url: string) => /^https:\/\/([a-z0-9-]+\.)*basemaps\.cartocdn\.com\//.test(url)
const keyOf = (url: string) => new URL(url).searchParams.get('key')

async function openPainted(page: Page) {
    await page.addInitScript((entries) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value)
    }, Object.entries({ [SETTINGS_SEEN_KEY]: '1', [SETTINGS_HINT_KEY]: '1' }))
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

test('every CARTO basemap request carries the key and is answered', async ({ page }) => {
    const answered: Array<{ url: string, status: number }> = []
    page.on('response', (response) => {
        if (isCarto(response.url())) answered.push({ url: response.url(), status: response.status() })
    })
    await openPainted(page)

    const kinds = new Set(answered.map(({ url }) => {
        const path = new URL(url).pathname
        return path.endsWith('style.json') ? 'style'
            : path.endsWith('tiles.json') ? 'tilejson'
            : path.endsWith('.mvt') ? 'tile'
            : path.includes('/sprite') ? 'sprite'
            : path.startsWith('/fonts/') ? 'glyphs'
            : path
    }))
    for (const kind of ['style', 'tilejson', 'tile', 'sprite', 'glyphs']) expect(kinds, kind).toContain(kind)
    // The preview runs on a local host, so this is the LOCAL key — the one
    // whose allowlist holds localhost / 127.0.0.1 (basemapKeyFor).
    const expected = basemapKeyFor(new URL(page.url()).hostname)
    expect(expected).toBe(CARTO_BASEMAP_LOCAL_KEY)
    for (const { url, status } of answered) {
        expect(keyOf(url), url).toBe(expected)
        expect(status, `${status} for ${url} — is this host on the key's Referer allowlist?`).toBeLessThan(400)
    }
})

// The two shapes a refusal takes in a browser. CARTO's real 403 carries no
// Access-Control-Allow-Origin (measured 2026-10-05), so the page never sees
// it — the fetch fails outright, which `abort` reproduces; a fulfilled 403
// reaches the page as a 403 (Playwright supplies the CORS header), the shape
// it would take if CARTO ever adds CORS to its refusals.
const REFUSALS = [
    ['blocked by CORS, as CARTO answers today', (route: Route) => route.abort('failed')],
    ['a readable 403', (route: Route) => route.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' })],
] as const

for (const [shape, refuse] of REFUSALS) test(`a refused key (${shape}) falls back to keyless, and the map still paints`, async ({ page }) => {
    const keyless: string[] = []
    let refused = 0
    await page.route((url) => isCarto(url.href), async (route) => {
        const url = route.request().url()
        if (keyOf(url) !== null) {
            refused += 1
            await refuse(route)
            return
        }
        keyless.push(url)
        await route.continue()
    })
    const warned = page.waitForEvent('console', {
        predicate: (message) => message.type() === 'warning' && message.text().includes('CARTO refused the basemap key'),
    })

    await openPainted(page)
    await warned

    expect(refused, 'the keyed style was tried first').toBeGreaterThan(0)
    expect(keyless.some((url) => new URL(url).pathname.endsWith('style.json')), 'the style was reloaded keyless')
        .toBe(true)
    expect(keyless.some((url) => new URL(url).pathname.endsWith('.mvt')), 'the tiles came keyless').toBe(true)
})
