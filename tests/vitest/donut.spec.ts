/**
 * The cluster donut's pure half (CRP-M6): the image-id codec round-trips
 * real bucket tuples — theme, palette and size included — and rejects
 * everything else the resolver is asked about; the arcs skip zero buckets,
 * keep ring order, close the turn, and wear the palette they are asked for
 * (the color-blind ramp since 2026-09-06); the basic map's all-zero tuple is
 * one neutral arc; and the symbol layer's icon-image EXPRESSION, run
 * through MapLibre's own evaluator against a cluster feature, yields an id
 * the codec parses back to the same sums — run, not read. The canvas
 * painter stays unpinned (jsdom has no 2D context) and is verified live.
 */
import { createExpression } from '@maplibre/maplibre-gl-style-spec'
import { expect, test } from 'vitest'
import {
    CLOSED_COLOR, CLUSTER_RADII, DONUT_CLOSED_ALPHA, DONUT_RING_WIDTHS, GRADE_PALETTES,
    LITE_MARKER_COLOR, NEW_COLORS,
} from '../../app/constants'
import { gradeHex } from '../../app/data/presentation'
import {
    bucketFills, donutArcs, donutIconExpr, donutId, donutRingWidth, paintDonut, parseDonutId,
    staleDonutIds,
} from '../../app/donut'
import { BUCKET_KEYS } from '../../app/mapData'
import type { Buckets } from '../../app/mapData'

const ZERO: Buckets = { nA: 0, nB: 0, nC: 0, nD: 0, nF: 0, nNew: 0, nNone: 0, nClosed: 0 }

test('the id round-trips real bucket tuples, theme, palette and size included', () => {
    const buckets = { ...ZERO, nA: 3, nB: 1, nNew: 1 }
    const id = donutId('dark', 22, buckets)
    expect(id).toBe('donut:dark:standard:22:3-1-0-0-0-1-0-0')
    expect(parseDonutId(id)).toEqual({ theme: 'dark', palette: 'standard', size: 22, buckets })
    const cb = donutId('light', 16, buckets, 'colorblind')
    expect(cb).toBe('donut:light:colorblind:16:3-1-0-0-0-1-0-0')
    expect(parseDonutId(cb)).toEqual({ theme: 'light', palette: 'colorblind', size: 16, buckets })
    // A metro-scale cluster, straight from production's shape (57 places).
    const big = { ...ZERO, nA: 30, nB: 12, nC: 6, nD: 2, nF: 1, nNew: 3, nNone: 2, nClosed: 1 }
    expect(parseDonutId(donutId('light', 22, big)))
        .toEqual({ theme: 'light', palette: 'standard', size: 22, buckets: big })
    // The basic map: an all-zero tuple.
    expect(parseDonutId(donutId('light', 16, ZERO)))
        .toEqual({ theme: 'light', palette: 'standard', size: 16, buckets: ZERO })
})

test('the codec rejects what the resolver must ignore', () => {
    expect(parseDonutId('cat')).toBeNull()                                            // the basemap's own icons
    expect(parseDonutId('donut:dark:22:3-1-0-0-0-1-0-0')).toBeNull()                 // the pre-palette shape
    expect(parseDonutId('donut:dark:standard:22:3-1-0-0-0-1-0')).toBeNull()          // seven counts
    expect(parseDonutId('donut:dark:standard:22:3-1-0-0-0-1-0-0-0')).toBeNull()      // nine
    expect(parseDonutId('donut:sepia:standard:22:3-1-0-0-0-1-0-0')).toBeNull()       // no such theme
    expect(parseDonutId('donut:dark:sepia:22:3-1-0-0-0-1-0-0')).toBeNull()           // no such palette
    expect(parseDonutId('donut:dark:standard:20:3-1-0-0-0-1-0-0')).toBeNull()        // no such size step
    expect(parseDonutId('donut:dark:standard:22:3-x-0-0-0-1-0-0')).toBeNull()        // not a count
    expect(parseDonutId('donut:dark:standard:22:3--1-0-0-0-1-0-0')).toBeNull()       // a negative is not a count
    expect(parseDonutId('donut:dark:standard:22:3-1-0-0-0-1-0-0:extra')).toBeNull()
})

test('arcs skip zero buckets, keep ring order, and close the turn', () => {
    const arcs = donutArcs({ ...ZERO, nA: 3, nC: 1, nClosed: 1 })
    expect(arcs.map((a) => a.bucket)).toEqual(['nA', 'nC', 'nClosed'])
    expect(arcs.map((a) => a.fill)).toEqual([gradeHex('A', 'standard'), gradeHex('C', 'standard'), CLOSED_COLOR])
    // Shares of the five places: 3/5 · 1/5 · 1/5, laid end to end from 12 o'clock.
    expect(arcs[0]).toMatchObject({ start: 0, end: 0.6, alpha: 1 })
    expect(arcs[1]?.start).toBeCloseTo(0.6, 10)
    expect(arcs[1]?.end).toBeCloseTo(0.8, 10)
    expect(arcs[2]?.start).toBeCloseTo(0.8, 10)
    expect(arcs[2]?.end).toBe(1)                          // closes the turn exactly, no float tail
    // The closed arc dims like the closed dots.
    expect(arcs[2]?.alpha).toBe(DONUT_CLOSED_ALPHA)
    // Every place gets an arc: the shares total the count in the hole.
    const total = arcs.reduce((n, a) => n + (a.end - a.start), 0)
    expect(total).toBeCloseTo(1, 10)
})

test('the arcs wear the palette they are asked for — the dots\' own fills, hex for the canvas', () => {
    const buckets = { ...ZERO, nA: 2, nB: 1, nNew: 1, nNone: 1, nClosed: 1 }
    const standard = donutArcs(buckets, 'standard').map((a) => a.fill)
    const colorblind = donutArcs(buckets, 'colorblind').map((a) => a.fill)
    expect(standard).toEqual(['#2f9e44', '#94be1b', '#1c7ed6', '#868e96', CLOSED_COLOR])
    expect(colorblind).toEqual(['#045a8d', '#5aa9d6', NEW_COLORS.colorblind, '#868e96', CLOSED_COLOR])
    // The fill table IS the dots' table — never a CSS token, which the canvas cannot read.
    for (const palette of ['standard', 'colorblind'] as const) {
        const fills = bucketFills(palette)
        expect(fills.nA).toBe(GRADE_PALETTES[palette].A)
        expect(fills.nF).toBe(GRADE_PALETTES[palette].F)
        expect(fills.nNew).toBe(NEW_COLORS[palette])
        for (const fill of Object.values(fills)) expect(fill).toMatch(/^#[0-9a-f]{6}$/)
    }
    // The geometry does not care which palette: same buckets, same turns.
    const turns = (palette: 'standard' | 'colorblind') => donutArcs(buckets, palette).map((a) => [a.start, a.end])
    expect(turns('colorblind')).toEqual(turns('standard'))
})

test('a single bucket is one full arc; the basic map (all zero) is one neutral arc in either palette', () => {
    expect(donutArcs({ ...ZERO, nB: 7 })).toEqual([
        { start: 0, end: 1, fill: gradeHex('B', 'standard'), alpha: 1, bucket: 'nB' },
    ])
    for (const palette of ['standard', 'colorblind'] as const) {
        expect(donutArcs(ZERO, palette)).toEqual([
            { start: 0, end: 1, fill: LITE_MARKER_COLOR, alpha: 1, bucket: 'lite' },
        ])
    }
})

test('a reinstall evicts the OTHER theme\'s and the OTHER palette\'s donuts and nothing else', () => {
    const ids = [
        'donut:dark:standard:22:3-1-0-0-0-1-0-0', 'donut:light:standard:22:3-1-0-0-0-1-0-0',
        'donut:dark:standard:12:0-0-0-0-0-0-0-0', 'donut:dark:colorblind:22:3-1-0-0-0-1-0-0',
        'airport-11', 'donutshop-icon',
    ]
    expect(staleDonutIds(ids, 'light')).toEqual([
        'donut:dark:standard:22:3-1-0-0-0-1-0-0', 'donut:dark:standard:12:0-0-0-0-0-0-0-0',
        'donut:dark:colorblind:22:3-1-0-0-0-1-0-0',
    ])
    expect(staleDonutIds(ids, 'dark')).toEqual([
        'donut:light:standard:22:3-1-0-0-0-1-0-0', 'donut:dark:colorblind:22:3-1-0-0-0-1-0-0',
    ])
    expect(staleDonutIds(ids, 'dark', 'colorblind')).toEqual([
        'donut:dark:standard:22:3-1-0-0-0-1-0-0', 'donut:light:standard:22:3-1-0-0-0-1-0-0',
        'donut:dark:standard:12:0-0-0-0-0-0-0-0',
    ])
    expect(staleDonutIds([], 'dark')).toEqual([])
})

test('ring widths pair with the size steps', () => {
    CLUSTER_RADII.forEach((size, i) => expect(donutRingWidth(size)).toBe(DONUT_RING_WIDTHS[i]))
})

test('the icon-image expression, evaluated against a cluster feature, yields an id the codec parses back', () => {
    for (const theme of ['dark', 'light'] as const) {
        for (const palette of ['standard', 'colorblind'] as const) {
            const parsed = createExpression(donutIconExpr(theme, palette), 'layout.icon-image')
            expect(parsed.result).toBe('success')
            if (parsed.result !== 'success') return
            const evaluate = (properties: Record<string, unknown>) => String(
                parsed.value.evaluate({ zoom: 8 }, { type: 'Point', properties }),
            )
            // What the source hands a cluster feature: the summed inputs.
            const metro = { ...ZERO, nA: 30, nB: 12, nC: 6, nD: 2, nF: 1, nNew: 3, nNone: 2, nClosed: 1 }
            const metroId = evaluate({ point_count: 41, cluster_id: 7, sum: 57, ...metro })
            expect(metroId).toBe(`donut:${theme}:${palette}:22:30-12-6-2-1-3-2-1`)
            expect(parseDonutId(metroId)).toEqual({ theme, palette, size: 22, buckets: metro })
            // The size step is the hit test's: <10 → 12, <50 → 16, 50+ → 22.
            expect(parseDonutId(evaluate({ sum: 9, ...ZERO, nA: 9 }))?.size).toBe(12)
            expect(parseDonutId(evaluate({ sum: 10, ...ZERO, nA: 10 }))?.size).toBe(16)
            expect(parseDonutId(evaluate({ sum: 49, ...ZERO, nC: 49 }))?.size).toBe(16)
            expect(parseDonutId(evaluate({ sum: 50, ...ZERO, nC: 50 }))?.size).toBe(22)
            // The basic map's clusters: zeros in, one neutral arc out.
            const liteId = evaluate({ sum: 12, ...ZERO })
            expect(parseDonutId(liteId)).toEqual({ theme, palette, size: 16, buckets: ZERO })
            expect(donutArcs(parseDonutId(liteId)!.buckets)[0]?.bucket).toBe('lite')
        }
    }
    // The bare call is the standard ramp — the pre-2026-09-06 call sites.
    expect(donutIconExpr('dark')).toEqual(donutIconExpr('dark', 'standard'))
    expect(BUCKET_KEYS).toHaveLength(8)
})

test('the painter answers null where there is no 2D canvas (headless), never throws', () => {
    // jsdom has no canvas package: getContext returns null. Live, the
    // resolver only registers an image when the painter returns one.
    const noCanvas = {
        createElement: () => ({ getContext: () => null }),
    } as unknown as Document
    expect(paintDonut({ theme: 'dark', palette: 'standard', size: 22, buckets: ZERO }, noCanvas)).toBeNull()
    expect(paintDonut({ theme: 'light', palette: 'colorblind', size: 12, buckets: ZERO }, noCanvas)).toBeNull()
})
