/**
 * The CARTO key on every basemap request (basemapRequest.ts, 2026-10-05).
 * Measured: the key does not propagate from the style URL — CARTO's style,
 * TileJSON, tiles, sprites and glyphs all name keyless URLs, on two hosts —
 * so the transform must key each one, and must leave every other host alone.
 */
import { expect, test } from 'vitest'
import { basemapKeyFor, isBasemapKeyRejection, transformBasemapRequest } from '../../app/basemapRequest'
import {
    AERIAL_TILES, CARTO_BASEMAP_KEY, CARTO_BASEMAP_LOCAL_KEY, STYLE_DARK, STYLE_LIGHT,
} from '../../app/constants'

const keyOf = (url: string) => new URL(url).searchParams.get('key')

test('a local host sends the local key; every other host the site key', () => {
    // CARTO keeps local hosts off a public key, so there are two (constants.ts).
    expect(CARTO_BASEMAP_LOCAL_KEY).not.toBe(CARTO_BASEMAP_KEY)
    for (const host of ['localhost', '127.0.0.1']) expect(basemapKeyFor(host), host).toBe(CARTO_BASEMAP_LOCAL_KEY)
    for (const host of ['cleanplateva.com', 'www.cleanplateva.com', 'embed.example.org', '[::1]', 'localhost.example.com']) {
        expect(basemapKeyFor(host), host).toBe(CARTO_BASEMAP_KEY)
    }
})

test('the key handed in is the key sent', () => {
    expect(keyOf(transformBasemapRequest(STYLE_LIGHT, CARTO_BASEMAP_LOCAL_KEY)!.url)).toBe(CARTO_BASEMAP_LOCAL_KEY)
})

test('both theme styles are keyed with the site key', () => {
    for (const style of [STYLE_LIGHT, STYLE_DARK]) {
        const out = transformBasemapRequest(style)
        expect(out).toBeDefined()
        expect(keyOf(out!.url)).toBe(CARTO_BASEMAP_KEY)
        expect(out!.url.startsWith(`${style}?`)).toBe(true)
    }
})

test('every URL the style leads to is keyed — TileJSON, each tile shard, sprite, glyphs', () => {
    // The URLs CARTO's positron style and its TileJSON actually name
    // (measured 2026-10-05), as MapLibre requests them.
    for (const url of [
        'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json',
        'https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/10/290/400.mvt',
        'https://tiles-d.basemaps.cartocdn.com/vectortiles/carto.streets/v1/14/4652/6402.mvt',
        'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/sprite@2x.json',
        'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/sprite@2x.png',
        'https://tiles.basemaps.cartocdn.com/fonts/Montserrat%20Medium/0-255.pbf',
    ]) {
        const out = transformBasemapRequest(url)
        expect(out, url).toBeDefined()
        expect(keyOf(out!.url), url).toBe(CARTO_BASEMAP_KEY)
        // The path is untouched — the glyph's encoded font stack included.
        expect(new URL(out!.url).pathname).toBe(new URL(url).pathname)
    }
})

test('everything that is not a CARTO basemap host passes through untouched', () => {
    for (const url of [
        AERIAL_TILES.replace('{z}', '10').replace('{y}', '400').replace('{x}', '290'),
        'https://cleanplateva.com/data/manifest.json',
        'https://cartocdn.com.example.net/tiles.json',
        'https://notbasemaps.cartocdn.com/x.json',
        'data/finder/00-0123456789ab.json',
    ]) {
        expect(transformBasemapRequest(url), url).toBeUndefined()
    }
})

test('a URL that already carries a key is left as it is', () => {
    expect(transformBasemapRequest(`${STYLE_LIGHT}?key=other`)).toBeUndefined()
})

// The keyless fallback's trigger: MapLibre reports a failed fetch as an
// AJAXError carrying `status` and `url`. Only CARTO refusing a KEYED request
// qualifies — anything else must not flip the session keyless.
const keyed = transformBasemapRequest('https://tiles-b.basemaps.cartocdn.com/vectortiles/carto.streets/v1/10/290/400.mvt')!.url

test('a keyed CARTO request refused or throttled is a key rejection', () => {
    // 0: CARTO's 403 has no CORS header, so the browser reports a failed
    // fetch — MapLibre's AJAXError status 0 — never the 403 itself.
    for (const status of [0, 401, 403, 429]) {
        expect(isBasemapKeyRejection({ status, url: keyed }), String(status)).toBe(true)
        expect(isBasemapKeyRejection({ status, url: transformBasemapRequest(STYLE_DARK)!.url })).toBe(true)
    }
})

test('nothing else is: outages, keyless failures, other hosts, other shapes', () => {
    for (const error of [
        { status: 500, url: keyed },                    // a CARTO outage — keyless would fail too
        { status: 404, url: keyed },                    // a tile that does not exist
        { status: 403, url: STYLE_LIGHT },              // already keyless
        { status: 0, url: STYLE_LIGHT },                // a keyless request that never arrived
        { status: 403, url: 'https://vginmaps.vdem.virginia.gov/x/tile/1/2/3?key=k' },
        { status: '403', url: keyed },
        { status: 403 },
        new Error('Failed to fetch'),
        null,
        undefined,
    ]) {
        expect(isBasemapKeyRejection(error), JSON.stringify(error)).toBe(false)
    }
})

test('existing query parameters survive', () => {
    const out = transformBasemapRequest('https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json?v=3')
    expect(new URL(out!.url).searchParams.get('v')).toBe('3')
    expect(keyOf(out!.url)).toBe(CARTO_BASEMAP_KEY)
})
