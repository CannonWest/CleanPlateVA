/**
 * MapLibre's `transformRequest` for the CARTO basemap (2026-10-05): every
 * request to a CARTO basemap host carries the site's key.
 *
 * Appending `?key=` to the style URL alone is not enough — measured, the
 * style CARTO returns names keyless sprite, glyph and TileJSON URLs, and the
 * TileJSON names keyless tile URLs, across basemaps.cartocdn.com and the
 * tiles(-a…-d).basemaps.cartocdn.com hosts. So the key rides on each request
 * MapLibre makes to one of those hosts, whatever its resource type. Anything
 * else — the VBMP aerial, the site's own data — passes through untouched.
 *
 * And the key can be REFUSED where no key would not: a keyed request whose
 * Referer is missing or not on the key's allowlist is a 403, a keyless one a
 * 200 (measured) — and a refused style is a map with no dots at all, since
 * the markers install on `style.load`. isBasemapKeyRejection names that
 * refusal so MapView can reload the basemap keyless once, the map as it was
 * before the key, rather than an empty canvas (the P4 posture: degrade,
 * never break).
 */

import { CARTO_BASEMAP_KEY, CARTO_BASEMAP_LOCAL_KEY, CARTO_LOCAL_HOSTS } from './constants'

const CARTO_HOST = 'basemaps.cartocdn.com'

/** Which of the site's two keys a page served from `hostname` sends: the
 *  local key on the hosts its allowlist holds, the site key everywhere else
 *  (constants.ts says why there are two). */
export function basemapKeyFor(hostname: string): string {
    return CARTO_LOCAL_HOSTS.includes(hostname) ? CARTO_BASEMAP_LOCAL_KEY : CARTO_BASEMAP_KEY
}

function isCartoHost(hostname: string): boolean {
    return hostname === CARTO_HOST || hostname.endsWith(`.${CARTO_HOST}`)
}

/** The keyed request for a CARTO basemap URL; `undefined` (MapLibre's
 *  "leave it alone") for every other URL, and for one already keyed. */
export function transformBasemapRequest(url: string, key: string = CARTO_BASEMAP_KEY): { url: string } | undefined {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return undefined
    }
    if (!isCartoHost(parsed.hostname) || parsed.searchParams.has('key')) return undefined
    parsed.searchParams.set('key', key)
    return { url: parsed.toString() }
}

/** Answers that may mean "not with this key": refused (401/403) — an
 *  unlisted or stripped Referer, a revoked key — or throttled (429) — a key
 *  past its limit. And 0: CARTO's 403 carries no Access-Control-Allow-Origin
 *  (measured 2026-10-05; its 200s do), so in a browser the refusal never
 *  arrives as a 403 at all — the fetch fails outright and MapLibre reports
 *  status 0, exactly as it reports a dropped connection. The two cannot be
 *  told apart from the page, so both get the one keyless retry: after a real
 *  outage it fails just as the keyed request did, and the session simply
 *  stays keyless — the map as it was before the key. */
const KEY_REFUSALS = new Set([0, 401, 403, 429])

/** Is a MapLibre `error` event's error CARTO refusing the key? MapLibre
 *  reports a failed fetch as an AJAXError carrying `status` and `url`;
 *  only a KEYED request to a CARTO basemap host qualifies, so an outage,
 *  a keyless failure or any other host's error never triggers the retry. */
export function isBasemapKeyRejection(error: unknown): boolean {
    const { status, url } = (error ?? {}) as { status?: unknown, url?: unknown }
    if (typeof status !== 'number' || !KEY_REFUSALS.has(status) || typeof url !== 'string') return false
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }
    return isCartoHost(parsed.hostname) && parsed.searchParams.has('key')
}
