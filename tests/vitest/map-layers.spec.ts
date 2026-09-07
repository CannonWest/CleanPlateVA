/**
 * The layer set as a contract (CRP-M3): `installDataLayers` run against a
 * RECORDING host — the source's cluster config, the five layers in paint
 * order with their filters and gates, idempotence per style, the stale-
 * donut eviction on a theme swap — and the radius expressions evaluated by
 * MapLibre's own style-spec evaluator against the hit test's JS twins in
 * mapHit.ts (a target that disagrees with the paint is worse than no slop).
 * Run, not read.
 */
import { createExpression } from '@maplibre/maplibre-gl-style-spec'
import { expect, test } from 'vitest'
import {
    CLUSTER_MAX_ZOOM, CLUSTER_PIXEL_RADIUS, DARK_MAJOR_ROAD_LABEL_COLOR, DARK_MAJOR_ROAD_LABEL_LAYER,
    DECLINE_RING, DECLINE_RINGS, DECLINE_RING_WIDTH, LYR_CLUSTERS, LYR_POINTS,
    LYR_STACK_COUNT, LYR_STACKS, MARKER_RING, MARKER_RING_WIDTH, SRC, STACK_COUNT_ZOOM, STACK_INK,
    STACK_SURFACE,
} from '../../app/constants'
import { donutIconExpr, donutId } from '../../app/donut'
import { pointRadiusAt, stackRadiusAt } from '../../app/mapHit'
import { BUCKET_KEYS, buildMapData } from '../../app/mapData'
import type { Buckets } from '../../app/mapData'
import {
    CLUSTER_COUNT_TEXT, CLUSTER_FILTER, HIT_LAYERS, POINT_FILTER, STACK_FILTER,
    applyPalette, fixDarkRoadLabels, installDataLayers, pointRadiusExpr, ringColorExpr, ringWidthExpr,
    stackRadiusExpr,
} from '../../app/mapLayers'
import type { LayerHost } from '../../app/mapLayers'

type Layer = { id: string; type: string; source?: string; filter?: unknown; minzoom?: number;
    layout?: Record<string, unknown>; paint?: Record<string, unknown> }

/** A map that only remembers what it was asked to do. */
function recorder(state: { hasSource?: boolean; images?: string[]; layers?: string[] } = {}) {
    const calls = {
        addSource: [] as Array<[string, Record<string, unknown>]>,
        addLayer: [] as Layer[],
        removeImage: [] as string[],
        setPaint: [] as Array<[string, string, unknown]>,
        setLayout: [] as Array<[string, string, unknown]>,
    }
    const host = {
        getSource: () => (state.hasSource ? {} : undefined),
        addSource: (id: string, spec: Record<string, unknown>) => { calls.addSource.push([id, spec]) },
        addLayer: (spec: Layer) => { calls.addLayer.push(spec) },
        listImages: () => state.images ?? [],
        removeImage: (id: string) => { calls.removeImage.push(id) },
        getLayer: (id: string) => ((state.layers ?? []).includes(id) ? {} : undefined),
        setPaintProperty: (id: string, name: string, value: unknown) => { calls.setPaint.push([id, name, value]) },
        setLayoutProperty: (id: string, name: string, value: unknown) => { calls.setLayout.push([id, name, value]) },
    } as unknown as LayerHost
    return { host, calls }
}

const DATA = buildMapData([], false)
const ZERO: Buckets = { nA: 0, nB: 0, nC: 0, nD: 0, nF: 0, nNew: 0, nNone: 0, nClosed: 0 }

function evaluate(expr: unknown, spec: string, zoom: number, properties: Record<string, unknown> = {}) {
    const parsed = createExpression(expr as never, spec as never)
    expect(parsed.result).toBe('success')
    if (parsed.result !== 'success') throw new Error('expression did not parse')
    return parsed.value.evaluate({ zoom }, { type: 'Point', properties })
}

test('the source carries the cluster config, the switch state, and the bucket sums', () => {
    for (const clusters of [false, true]) {
        const { host, calls } = recorder()
        installDataLayers(host, DATA, true, clusters)
        expect(calls.addSource).toHaveLength(1)
        const [id, spec] = calls.addSource[0]!
        expect(id).toBe(SRC)
        expect(spec.type).toBe('geojson')
        expect(spec.data).toBe(DATA.geojson)
        expect(spec.cluster).toBe(clusters)
        expect(spec.clusterMaxZoom).toBe(CLUSTER_MAX_ZOOM)
        expect(spec.clusterRadius).toBe(CLUSTER_PIXEL_RADIUS)
        // `stack` (1 for a lone place) sums into `sum` — the PLACES a bubble
        // stands for — beside the eight donut buckets.
        expect(Object.keys(spec.clusterProperties as object)).toEqual(['sum', ...BUCKET_KEYS])
    }
})

test('four layers, bottom to top: clusters · points · stacks · stack counts', () => {
    const { host, calls } = recorder()
    installDataLayers(host, DATA, true, false)
    expect(calls.addLayer.map((l) => l.id)).toEqual([
        LYR_CLUSTERS, LYR_POINTS, LYR_STACKS, LYR_STACK_COUNT,
    ])
    expect(calls.addLayer.map((l) => l.type)).toEqual(['symbol', 'circle', 'circle', 'symbol'])
    expect(new Set(calls.addLayer.map((l) => l.source))).toEqual(new Set([SRC]))
    // Every layer the pointer queries is installed — the hit test never
    // names a missing layer, clustering on or off.
    for (const id of HIT_LAYERS) expect(calls.addLayer.some((l) => l.id === id)).toBe(true)
})

test('filters and zoom gates: clusters by point_count, points/stacks by kind, counts gated', () => {
    const { host, calls } = recorder()
    installDataLayers(host, DATA, false, true)
    const by = Object.fromEntries(calls.addLayer.map((l) => [l.id, l])) as Record<string, Layer>
    expect(by[LYR_CLUSTERS]!.filter).toEqual(CLUSTER_FILTER)
    expect(by[LYR_POINTS]!.filter).toEqual(POINT_FILTER)
    expect(by[LYR_STACKS]!.filter).toEqual(STACK_FILTER)
    expect(by[LYR_STACK_COUNT]!.filter).toEqual(STACK_FILTER)
    expect(by[LYR_STACK_COUNT]!.minzoom).toBe(STACK_COUNT_ZOOM)
    expect(by[LYR_CLUSTERS]!.minzoom).toBeUndefined()
    expect(by[LYR_POINTS]!.minzoom).toBeUndefined()
    // A cluster feature has no `kind`, so the point/stack filters cannot
    // match it; a dot has no point_count, so the cluster filter cannot.
    const cluster = { point_count: 4, sum: 5 }
    const dot = { kind: 'point' }
    expect(evaluate(CLUSTER_FILTER, 'filter', 8, cluster)).toBe(true)
    expect(evaluate(CLUSTER_FILTER, 'filter', 8, dot)).toBe(false)
    expect(evaluate(POINT_FILTER, 'filter', 8, cluster)).toBe(false)
    expect(evaluate(POINT_FILTER, 'filter', 8, dot)).toBe(true)
})

test('the theme reaches the paint: ring color and the donut ids (the stacks no longer take it)', () => {
    for (const dark of [true, false]) {
        const theme = dark ? 'dark' : 'light'
        const { host, calls } = recorder()
        installDataLayers(host, DATA, dark, false)
        const by = Object.fromEntries(calls.addLayer.map((l) => [l.id, l])) as Record<string, Layer>
        const points = by[LYR_POINTS]!.paint!
        expect(points['circle-color']).toEqual(['get', 'fill'])
        expect(points['circle-opacity']).toEqual(['get', 'opacity'])
        expect(points['circle-radius']).toEqual(pointRadiusExpr())
        expect(points['circle-stroke-color']).toEqual(ringColorExpr(theme))
        expect(points['circle-stroke-width']).toEqual(ringWidthExpr())
        expect(by[LYR_STACKS]!.paint!['circle-color']).toBe(STACK_SURFACE)
        expect(by[LYR_STACKS]!.paint!['circle-stroke-color']).toBe(MARKER_RING[theme])
        expect(by[LYR_STACKS]!.paint!['circle-radius']).toEqual(stackRadiusExpr())
        expect(by[LYR_STACK_COUNT]!.paint!['text-color']).toBe(STACK_INK)
        expect(by[LYR_CLUSTERS]!.paint!['text-color']).toBe(STACK_INK)
        expect(by[LYR_CLUSTERS]!.layout!['icon-image']).toEqual(donutIconExpr(theme))
        expect(by[LYR_CLUSTERS]!.layout!['text-field']).toEqual(CLUSTER_COUNT_TEXT)
    }
})

test('the neutral count bubble is THEME-INVARIANT (Cannon 2026-09-06): the dark surface + ink on a light basemap too', () => {
    expect(STACK_SURFACE).toBe('#242a31')
    expect(STACK_INK).toBe('#e9ecef')
    // Four paints across the two themes — the stack bubble, its count, and
    // the donut hole's count — collapse to ONE surface and ONE ink, so a
    // stack looks like a stack wherever you meet it and an isolated stack
    // can never read differently from the cluster bubble beside it.
    const painted = new Set<string>()
    for (const dark of [true, false]) {
        const { host, calls } = recorder()
        installDataLayers(host, DATA, dark, false)
        const by = Object.fromEntries(calls.addLayer.map((l) => [l.id, l])) as Record<string, Layer>
        painted.add(String(by[LYR_STACKS]!.paint!['circle-color']))
        painted.add(String(by[LYR_STACK_COUNT]!.paint!['text-color']))
        painted.add(String(by[LYR_CLUSTERS]!.paint!['text-color']))
    }
    expect([...painted].sort()).toEqual([STACK_SURFACE, STACK_INK].sort())
})

test('the ring (CRP-M2): declining trades the theme white for the palette\'s mark, at a wider stroke, no zoom gate', () => {
    for (const theme of ['dark', 'light'] as const) {
        for (const palette of ['standard', 'colorblind'] as const) {
            const color = ringColorExpr(theme, palette)
            const width = ringWidthExpr()
            for (const zoom of [5, 9, 13.4, 16]) {
                // Evaluated without a property spec, a color expression yields
                // its literal — the hex the constants hold.
                expect(evaluate(color, 'paint.circle-stroke-color', zoom, { declining: true })).toBe(DECLINE_RINGS[palette])
                expect(evaluate(color, 'paint.circle-stroke-color', zoom, { declining: false })).toBe(MARKER_RING[theme])
                expect(evaluate(color, 'paint.circle-stroke-color', zoom, {})).toBe(MARKER_RING[theme])
                expect(evaluate(width, 'paint.circle-stroke-width', zoom, { declining: true })).toBe(DECLINE_RING_WIDTH)
                expect(evaluate(width, 'paint.circle-stroke-width', zoom, { declining: false })).toBe(MARKER_RING_WIDTH)
            }
        }
        // The bare call is the standard ramp's red — the pre-2026-09-06 call sites.
        expect(evaluate(ringColorExpr(theme), 'paint.circle-stroke-color', 9, { declining: true })).toBe(DECLINE_RING)
    }
    // Red on the color-blind ramp's umber F is ~1.4:1: that palette's mark is not red.
    expect(DECLINE_RINGS.colorblind).not.toBe(DECLINE_RING)
})

test('a palette switch re-points the ring and the donut ids on a LIVE style and evicts the other palette\'s donuts', () => {
    const images = [
        'donut:dark:standard:22:3-1-0-0-0-1-0-0', 'donut:dark:standard:12:0-0-0-0-0-0-0-0',
        'donut:dark:colorblind:16:0-2-0-0-0-0-0-0', 'donut:light:colorblind:22:3-1-0-0-0-1-0-0', 'airport-11',
    ]
    const { host, calls } = recorder({ hasSource: true, images, layers: [LYR_POINTS, LYR_CLUSTERS, LYR_STACKS] })
    applyPalette(host, true, 'colorblind')
    expect(calls.setPaint).toEqual([[LYR_POINTS, 'circle-stroke-color', ringColorExpr('dark', 'colorblind')]])
    expect(calls.setLayout).toEqual([[LYR_CLUSTERS, 'icon-image', donutIconExpr('dark', 'colorblind')]])
    // This theme's, this palette's donut stays; every other donut goes; the basemap's icons are not ours.
    expect(calls.removeImage).toEqual([
        'donut:dark:standard:22:3-1-0-0-0-1-0-0', 'donut:dark:standard:12:0-0-0-0-0-0-0-0',
        'donut:light:colorblind:22:3-1-0-0-0-1-0-0',
    ])
    // Nothing is added or re-sourced: the fills are the data's, re-set by MapView.
    expect(calls.addSource).toEqual([])
    expect(calls.addLayer).toEqual([])
    // Before the layers exist there is nothing to re-point — and nothing throws.
    const bare = recorder({ images: ['donut:light:standard:22:3-1-0-0-0-1-0-0'] })
    applyPalette(bare.host, false, 'standard')
    expect(bare.calls.setPaint).toEqual([])
    expect(bare.calls.setLayout).toEqual([])
    expect(bare.calls.removeImage).toEqual([])
    // The install itself paints in the palette it is handed.
    const install = recorder()
    installDataLayers(install.host, DATA, false, false, 'colorblind')
    const by = Object.fromEntries(install.calls.addLayer.map((l) => [l.id, l])) as Record<string, Layer>
    expect(by[LYR_POINTS]!.paint!['circle-stroke-color']).toEqual(ringColorExpr('light', 'colorblind'))
    expect(by[LYR_CLUSTERS]!.layout!['icon-image']).toEqual(donutIconExpr('light', 'colorblind'))
})

test('the paint radii and the hit test agree at every zoom (mapHit.ts is the JS twin)', () => {
    const zooms = [3, 5, 6.5, 7.3, 9, 10.25, 12, 13.5, 14, 16, 19]
    const point = pointRadiusExpr()
    for (const zoom of zooms) {
        expect(evaluate(point, 'paint.circle-radius', zoom)).toBeCloseTo(pointRadiusAt(zoom), 6)
    }
    const stack = stackRadiusExpr()
    for (const zoom of zooms) {
        for (const count of [2, 9, 10, 49, 50, 300]) {
            expect(evaluate(stack, 'paint.circle-radius', zoom, { stack: count }), `z${zoom} ×${count}`)
                .toBeCloseTo(stackRadiusAt(zoom, count), 6)
        }
    }
})

test('the bubble count abbreviates the PLACES sum by hand past 1,000', () => {
    const text = (sum: number) => String(evaluate(CLUSTER_COUNT_TEXT, 'layout.text-field', 8, { sum, point_count: 3 }))
    expect(text(7)).toBe('7')
    expect(text(999)).toBe('999')
    expect(text(1000)).toBe('1k')
    expect(text(1250)).toBe('1.3k')
    expect(text(12345)).toBe('12.3k')
})

test('install is idempotent per style — a second call on a style that has the source does nothing', () => {
    const { host, calls } = recorder({ hasSource: true })
    installDataLayers(host, DATA, true, true)
    expect(calls.addSource).toEqual([])
    expect(calls.addLayer).toEqual([])
    expect(calls.removeImage).toEqual([])
})

test('a reinstall evicts the OTHER theme\'s donuts and nothing else (a 6.6.0 theme swap keeps the image manager)', () => {
    const lightBig = donutId('light', 22, { ...ZERO, nA: 5 })
    const lightSmall = donutId('light', 12, ZERO)
    const dark = donutId('dark', 16, { ...ZERO, nC: 3 })
    const { host, calls } = recorder({ images: [lightBig, 'some-basemap-sprite', dark, lightSmall] })
    installDataLayers(host, DATA, true, false)          // installing DARK
    expect(calls.removeImage).toEqual([lightBig, lightSmall])
    const light = recorder({ images: [lightBig, 'some-basemap-sprite', dark, lightSmall] })
    installDataLayers(light.host, DATA, false, false)   // installing LIGHT
    expect(light.calls.removeImage).toEqual([dark])
})

test('the dark-matter road-label fix touches one layer, only when dark, only when the layer exists', () => {
    const dark = recorder({ layers: [DARK_MAJOR_ROAD_LABEL_LAYER] })
    fixDarkRoadLabels(dark.host, true)
    expect(dark.calls.setPaint).toEqual([[DARK_MAJOR_ROAD_LABEL_LAYER, 'text-color', DARK_MAJOR_ROAD_LABEL_COLOR]])
    const light = recorder({ layers: [DARK_MAJOR_ROAD_LABEL_LAYER] })
    fixDarkRoadLabels(light.host, false)
    expect(light.calls.setPaint).toEqual([])
    const missing = recorder({ layers: [] })
    fixDarkRoadLabels(missing.host, true)
    expect(missing.calls.setPaint).toEqual([])
})
