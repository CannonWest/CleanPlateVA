/**
 * "Go to a coordinate" — the map edit mode's navigation aid (the coordinate
 * box, 2026-09-09; design ref frontend-redesign.md §6.6). An operator working from a rooftop point
 * they got somewhere else (a county record, an aerial read, a note) pastes
 * it into the drawer and the view centres on it, with a mark drawn where
 * the point actually is. It proposes NOTHING: no pin, no draft, no fetch —
 * the mark is a place to aim at, and the drag is still what makes a
 * proposal. Zoom is the operator's (Cannon, 2026-09-09): the box moves the
 * centre and nothing else, so a survey scale survives a paste.
 *
 * The parse is deliberately narrow — a decimal pair, latitude first — and
 * refuses rather than guesses. The one guess it will not make is the
 * swapped pair: `-77.56, 37.53` is two valid numbers and would centre the
 * map in the Indian Ocean, so when the pair reads as Virginia REVERSED the
 * box says so and stays put. Silently reordering the operator's own input
 * is the thing a proposal tool must never do.
 *
 * The mark is magenta, which is the one hue family the map has left: the
 * grades own green→red and (on the color-blind ramp) blue→umber, NEW owns
 * blue, the declining ring owns `#e03131`, and `#ff922b` is reserved for
 * unsaved judgment (§6.6). A ring with a hole, cased in white, so a pin
 * dragged onto the target lands INSIDE the mark and stays legible on the
 * aerial in both themes.
 */

import type * as maplibregl from 'maplibre-gl'
import { MARKER_RING } from '../constants'
import type { LngLatPair } from './mapDraft'

export const SRC_GOTO = 'cp-goto'
export const LYR_GOTO_CASE = 'cp-goto-case'
export const LYR_GOTO_RING = 'cp-goto-ring'
export const LYR_GOTO_DOT = 'cp-goto-dot'

/** Open Color grape-6 — no grade, no ramp, not the proposal orange. */
export const GOTO_COLOR = '#ae3ec9'
export const GOTO_RADIUS = 11
/** The bead at the point itself: the coordinate, not the ring's middle. */
export const GOTO_DOT_RADIUS = 2.5

/** The Virginia box — `manual_proposals.VA_LAT` / `VA_LON`, the same pair
 *  the Worker refuses a pin outside of (§6.6). Used here for ONE thing:
 *  recognising a pair that was pasted longitude-first. */
export const VA_LAT: readonly [number, number] = [36.3, 39.7]
export const VA_LON: readonly [number, number] = [-83.9, -75.0]

export type ParsedCoordinate =
    | { ok: true; point: LngLatPair }
    | { ok: false; reason: string }

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

function inVirginia(lat: number, lon: number): boolean {
    return lat >= VA_LAT[0] && lat <= VA_LAT[1] && lon >= VA_LON[0] && lon <= VA_LON[1]
}

/** A pasted `lat, lon` pair, or the reason it is not one. Tolerant of the
 *  wrapping a copy picks up — surrounding brackets or parentheses, extra
 *  whitespace, a degree sign on either number, a comma or whitespace as the
 *  separator — and of nothing else. */
export function parseCoordinate(text: string): ParsedCoordinate {
    let raw = text.trim()
    if (!raw) return { ok: false, reason: 'Paste a coordinate — latitude, then longitude.' }
    // One wrapping pair, the shape a copy out of a bracketed list arrives in.
    if ((raw.startsWith('(') && raw.endsWith(')')) || (raw.startsWith('[') && raw.endsWith(']'))) {
        raw = raw.slice(1, -1).trim()
    }
    const parts = (raw.includes(',') ? raw.split(',') : raw.split(/\s+/))
        .map((part) => part.trim().replace(/°$/, '').trim())
        .filter((part) => part.length > 0)
    if (parts.length !== 2) {
        return { ok: false, reason: 'Paste two decimal numbers — latitude, then longitude.' }
    }
    const [latText, lonText] = parts as [string, string]
    if (!DECIMAL.test(latText)) return { ok: false, reason: `Not a decimal number: ${latText}` }
    if (!DECIMAL.test(lonText)) return { ok: false, reason: `Not a decimal number: ${lonText}` }
    const lat = Number(latText)
    const lon = Number(lonText)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, reason: 'Paste two decimal numbers — latitude, then longitude.' }
    }
    // The pair that is Virginia with its numbers the other way round: two
    // valid numbers, a centre in the Indian Ocean. Refuse, never reorder.
    if (!inVirginia(lat, lon) && inVirginia(lon, lat)) {
        return { ok: false, reason: 'That pair reads longitude first. Paste latitude, then longitude.' }
    }
    if (lat < -90 || lat > 90) return { ok: false, reason: 'Latitude must be between −90 and 90.' }
    if (lon < -180 || lon > 180) return { ok: false, reason: 'Longitude must be between −180 and 180.' }
    return { ok: true, point: { lat, lon } }
}

/** The marked point as the drawer reads it back — 6 dp, the roster's own
 *  precision, so what the line says is what the map can show. */
export function formatCoordinate(point: LngLatPair): string {
    return `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`
}

export interface GotoCollection {
    type: 'FeatureCollection'
    features: Array<{
        type: 'Feature'
        geometry: { type: 'Point'; coordinates: [number, number] }
        properties: Record<string, never>
    }>
}

/** The mark's source data — one point, or nothing at all. */
export function buildGotoGeoJSON(point: LngLatPair | null): GotoCollection {
    if (!point) return { type: 'FeatureCollection', features: [] }
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
            properties: {},
        }],
    }
}

/** Add the mark's source + layers to the CURRENT style. Idempotent per
 *  style, and installed BEFORE the proposal layers so a pin dragged onto
 *  the target draws over it — the ring's hole is what you aim into.
 *  Exported for the spec (the order and the paint are the contract). */
export function installGotoLayers(
    map: Pick<maplibregl.Map, 'getSource' | 'addSource' | 'addLayer'>,
    dark: boolean,
    data: GotoCollection,
): void {
    if (map.getSource(SRC_GOTO)) return
    const casing = MARKER_RING[dark ? 'dark' : 'light']
    map.addSource(SRC_GOTO, { type: 'geojson', data })
    // The white casing under the ring: the mark has to hold on a rooftop
    // photograph as well as on the drawn map.
    map.addLayer({
        id: LYR_GOTO_CASE,
        type: 'circle',
        source: SRC_GOTO,
        paint: {
            'circle-radius': GOTO_RADIUS,
            'circle-opacity': 0,
            'circle-stroke-color': casing,
            'circle-stroke-width': 4.5,
        },
    })
    map.addLayer({
        id: LYR_GOTO_RING,
        type: 'circle',
        source: SRC_GOTO,
        paint: {
            'circle-radius': GOTO_RADIUS,
            'circle-opacity': 0,
            'circle-stroke-color': GOTO_COLOR,
            'circle-stroke-width': 2.5,
        },
    })
    map.addLayer({
        id: LYR_GOTO_DOT,
        type: 'circle',
        source: SRC_GOTO,
        paint: {
            'circle-radius': GOTO_DOT_RADIUS,
            'circle-color': GOTO_COLOR,
            'circle-stroke-color': casing,
            'circle-stroke-width': 1.5,
        },
    })
}
