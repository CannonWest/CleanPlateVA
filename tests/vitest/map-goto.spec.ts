/**
 * "Go to a coordinate" — the parse and the mark (the coordinate box,
 * app/admin/mapGoto.ts). The box takes a decimal pair, latitude first, and
 * refuses everything else by name rather than guessing: the one shape it
 * could plausibly "fix" — a Virginia pair pasted longitude-first — is the
 * one it must not, because silently reordering an operator's own input in
 * a tool that proposes map corrections is how a wrong point gets published.
 */
import { describe, expect, test } from 'vitest'
import { MARKER_RING } from '../../app/constants'
import {
    buildGotoGeoJSON, formatCoordinate, GOTO_COLOR, installGotoLayers, LYR_GOTO_CASE, LYR_GOTO_DOT,
    LYR_GOTO_RING, parseCoordinate, SRC_GOTO,
} from '../../app/admin/mapGoto'

const ok = (text: string) => {
    const parsed = parseCoordinate(text)
    if (!parsed.ok) throw new Error(`refused: ${parsed.reason}`)
    return parsed.point
}

const refusal = (text: string) => {
    const parsed = parseCoordinate(text)
    if (parsed.ok) throw new Error(`accepted: ${JSON.stringify(parsed.point)}`)
    return parsed.reason
}

describe('the parse', () => {
    test('a pasted pair, at the precision it was pasted', () => {
        // Cannon's own example, 14 dp, kept to the last digit: the box is
        // for a coordinate that came from somewhere exact.
        expect(ok('37.53812556551333, -77.56654203147325'))
            .toEqual({ lat: 37.53812556551333, lon: -77.56654203147325 })
    })

    test('the wrapping a copy picks up', () => {
        const point = { lat: 37.5, lon: -77.4 }
        expect(ok('37.5,-77.4')).toEqual(point)          // no space
        expect(ok('  37.5 ,  -77.4  ')).toEqual(point)   // whitespace either side
        expect(ok('37.5 -77.4')).toEqual(point)          // whitespace as the separator
        expect(ok('(37.5, -77.4)')).toEqual(point)       // parentheses
        expect(ok('[37.5, -77.4]')).toEqual(point)       // brackets
        expect(ok('37.5°, -77.4°')).toEqual(point)       // degree signs
        expect(ok('+37.5, -77.4')).toEqual(point)        // an explicit +
    })

    test('a whole number and a bare decimal still read', () => {
        expect(ok('37, -77')).toEqual({ lat: 37, lon: -77 })
        expect(ok('.5, -.4')).toEqual({ lat: 0.5, lon: -0.4 })
    })

    test('a Virginia pair pasted longitude-first is refused, never reordered', () => {
        expect(refusal('-77.56654203147325, 37.53812556551333'))
            .toBe('That pair reads longitude first. Paste latitude, then longitude.')
        // The guard is the Virginia box, not a general lat/lon heuristic: a
        // real pair that happens to be small stands.
        expect(ok('-10, 20')).toEqual({ lat: -10, lon: 20 })
    })

    test('what it will not take', () => {
        expect(refusal('')).toBe('Paste a coordinate — latitude, then longitude.')
        expect(refusal('   ')).toBe('Paste a coordinate — latitude, then longitude.')
        expect(refusal('37.5')).toBe('Paste two decimal numbers — latitude, then longitude.')
        expect(refusal('37.5, -77.4, 12')).toBe('Paste two decimal numbers — latitude, then longitude.')
        expect(refusal('37.5N, -77.4W')).toBe('Not a decimal number: 37.5N')
        expect(refusal('37.5, west')).toBe('Not a decimal number: west')
        expect(refusal('37°32\'17"N 77°33\'59"W')).toContain('Not a decimal number')
        expect(refusal('https://maps.example/@37.5,-77.4,17z'))
            .toBe('Paste two decimal numbers — latitude, then longitude.')
        expect(refusal('91, -77.4')).toBe('Latitude must be between −90 and 90.')
        expect(refusal('-91, -77.4')).toBe('Latitude must be between −90 and 90.')
        expect(refusal('37.5, 181')).toBe('Longitude must be between −180 and 180.')
        expect(refusal('37.5, -181')).toBe('Longitude must be between −180 and 180.')
    })

    test('the edges of the ranges stand', () => {
        expect(ok('90, 180')).toEqual({ lat: 90, lon: 180 })
        expect(ok('-90, -180')).toEqual({ lat: -90, lon: -180 })
    })
})

test('the marked line reads back at the roster\'s own 6 dp', () => {
    expect(formatCoordinate({ lat: 37.53812556551333, lon: -77.56654203147325 }))
        .toBe('37.538126, -77.566542')
    expect(formatCoordinate({ lat: 37, lon: -77 })).toBe('37.000000, -77.000000')
})

test('the source data: one point, or none at all', () => {
    expect(buildGotoGeoJSON(null)).toEqual({ type: 'FeatureCollection', features: [] })
    const data = buildGotoGeoJSON({ lat: 37.5, lon: -77.4 })
    expect(data.features).toHaveLength(1)
    expect(data.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [-77.4, 37.5] })
})

describe('the layers', () => {
    type Layer = { id: string; type: string; source?: string; paint?: Record<string, unknown> }

    function host() {
        const layers: Layer[] = []
        const sources = new Set<string>()
        let added = 0
        return {
            layers,
            sources,
            added: () => added,
            map: {
                getSource: (id: string) => (sources.has(id) ? {} : undefined),
                addSource: (id: string) => { sources.add(id); added += 1 },
                addLayer: (spec: Layer) => { layers.push(spec) },
            } as never,
        }
    }

    test('one source, three circles — casing, ring, bead — idempotent per style', () => {
        const h = host()
        installGotoLayers(h.map, true, buildGotoGeoJSON(null))
        installGotoLayers(h.map, true, buildGotoGeoJSON(null))
        expect(h.added()).toBe(1)
        expect(h.layers.map((l) => l.id)).toEqual([LYR_GOTO_CASE, LYR_GOTO_RING, LYR_GOTO_DOT])
        expect(h.layers.map((l) => l.type)).toEqual(['circle', 'circle', 'circle'])
        expect(new Set(h.layers.map((l) => l.source))).toEqual(new Set([SRC_GOTO]))
        expect(h.layers[1]!.paint!['circle-stroke-color']).toBe(GOTO_COLOR)
        expect(h.layers[2]!.paint!['circle-color']).toBe(GOTO_COLOR)
    })

    test('the casing follows the theme, so the mark holds on a rooftop photograph', () => {
        const dark = host()
        installGotoLayers(dark.map, true, buildGotoGeoJSON(null))
        expect(dark.layers[0]!.paint!['circle-stroke-color']).toBe(MARKER_RING.dark)
        const light = host()
        installGotoLayers(light.map, false, buildGotoGeoJSON(null))
        expect(light.layers[0]!.paint!['circle-stroke-color']).toBe(MARKER_RING.light)
    })

    test('the color is the map\'s one free hue — no grade, no ramp, not the proposal orange', () => {
        expect(GOTO_COLOR).toBe('#ae3ec9')
        expect(GOTO_COLOR).not.toBe('#ff922b')
    })
})
