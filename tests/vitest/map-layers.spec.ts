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
    AERIAL_ATTRIBUTION, AERIAL_MAX_ZOOM, AERIAL_TILE_SIZE, AERIAL_TILES,
    CLOSED_COLOR, CLOSED_OPACITY, CLUSTER_MAX_ZOOM, CLUSTER_PIXEL_RADIUS, DARK_MAJOR_ROAD_LABEL_COLOR,
    DARK_MAJOR_ROAD_LABEL_LAYER, DECLINE_RING, DECLINE_RINGS, DECLINE_RING_WIDTH, GRADE_PALETTES,
    LITE_MARKER_COLOR, LYR_AERIAL, LYR_CLUSTERS, LYR_POINTS, LYR_STACK_COUNT, LYR_STACKS, MARKER_RING,
    MARKER_RING_WIDTH, NEW_COLORS, POINT_OPACITY, SRC, SRC_AERIAL, STACK_COUNT_ZOOM, STACK_INK,
    STACK_SURFACE,
} from '../../app/constants'
import { donutIconExpr, donutId } from '../../app/donut'
import { pointRadiusAt, stackRadiusAt } from '../../app/mapHit'
import { BUCKET_KEYS, buildMapData } from '../../app/mapData'
import type { Buckets } from '../../app/mapData'
import {
    CLUSTER_COUNT_TEXT, CLUSTER_FILTER, HIT_LAYERS, POINT_FILTER, STACK_FILTER,
    applyBasemap, applyPalette, fixDarkRoadLabels, installDataLayers, labelBlockStart,
    pointFillExpr, pointOpacityExpr, pointRadiusExpr,
    ringColorExpr, ringWidthExpr, stackRadiusExpr,
} from '../../app/mapLayers'
import type { LayerHost } from '../../app/mapLayers'

type Layer = { id: string; type: string; source?: string; filter?: unknown; minzoom?: number;
    layout?: Record<string, unknown>; paint?: Record<string, unknown> }

/** A map that only remembers what it was asked to do.
 *
 *  `hasSource` answers for every id (the marker install asks about one);
 *  `sources` answers per id, for the basemap tests, which need the aerial
 *  source present while the markers' is not. `styleLayers` is what
 *  `getStyle()` reports — the basemap insertion point is read from it. */
function recorder(state: {
    hasSource?: boolean; images?: string[]; layers?: string[]
    sources?: string[]; styleLayers?: Array<{ id: string; type: string }>
} = {}) {
    const calls = {
        addSource: [] as Array<[string, Record<string, unknown>]>,
        addLayer: [] as Layer[],
        /** Every addLayer's `before` argument, in order — where a layer was
         *  INSERTED, which is the whole contract for the aerial. */
        before: [] as Array<string | undefined>,
        removeImage: [] as string[],
        removeLayer: [] as string[],
        removeSource: [] as string[],
        setPaint: [] as Array<[string, string, unknown]>,
        setLayout: [] as Array<[string, string, unknown]>,
    }
    const host = {
        getSource: (id: string) => (state.sources
            ? (state.sources.includes(id) ? {} : undefined)
            : (state.hasSource ? {} : undefined)),
        addSource: (id: string, spec: Record<string, unknown>) => { calls.addSource.push([id, spec]) },
        addLayer: (spec: Layer, before?: string) => {
            calls.addLayer.push(spec)
            calls.before.push(before)
        },
        listImages: () => state.images ?? [],
        removeImage: (id: string) => { calls.removeImage.push(id) },
        getLayer: (id: string) => ((state.layers ?? []).includes(id) ? {} : undefined),
        getStyle: () => ({ layers: state.styleLayers ?? [] }),
        removeLayer: (id: string) => { calls.removeLayer.push(id) },
        removeSource: (id: string) => { calls.removeSource.push(id) },
        setPaintProperty: (id: string, name: string, value: unknown) => { calls.setPaint.push([id, name, value]) },
        setLayoutProperty: (id: string, name: string, value: unknown) => { calls.setLayout.push([id, name, value]) },
    } as unknown as LayerHost
    return { host, calls }
}

/** dark-matter's shape: every fill and line, THEN every label. Its first
 *  symbol layer is also where its drawing ends. */
const DARK_MATTER_LAYERS = [
    { id: 'background', type: 'background' },
    { id: 'landcover', type: 'fill' },
    { id: 'water', type: 'fill' },
    { id: 'road_minor', type: 'line' },
    { id: 'boundary_country_inner', type: 'line' },
    { id: 'waterway_label', type: 'symbol' },
    { id: 'place_city', type: 'symbol' },
]

/** Positron's shape, and the reason the seam is not "the first symbol
 *  layer": `waterway_label` sits at index 13 of the real style with 53 more
 *  DRAWN layers after it. A rule that stops at the first symbol puts the
 *  photograph under most of the cartography — measured live 2026-09-07,
 *  and it looked like a white map with imagery in the gaps. */
const POSITRON_LAYERS = [
    { id: 'background', type: 'background' },
    { id: 'landcover', type: 'fill' },
    { id: 'waterway_label', type: 'symbol' },
    { id: 'road_minor', type: 'line' },
    { id: 'building', type: 'fill' },
    { id: 'boundary_country_inner', type: 'line' },
    { id: 'watername_ocean', type: 'symbol' },
    { id: 'place_city', type: 'symbol' },
]

const CARTO_LAYERS = DARK_MATTER_LAYERS

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
        expect(points['circle-color']).toEqual(pointFillExpr())
        expect(points['circle-opacity']).toEqual(pointOpacityExpr())
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

test('the neutral count bubble is THEME-INVARIANT (design decision, 2026-09-06): the dark surface + ink on a light basemap too', () => {
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

test('the fill is the BUCKET in the palette (2026-09-07): one table with the donut arcs, evaluated by MapLibre', () => {
    for (const palette of ['standard', 'colorblind'] as const) {
        const fill = pointFillExpr(palette)
        const ramp = GRADE_PALETTES[palette]
        const at = (buckets: Partial<Buckets>) => evaluate(fill, 'paint.circle-color', 12, { ...ZERO, ...buckets })
        expect(at({ nA: 1 })).toBe(ramp.A)
        expect(at({ nB: 1 })).toBe(ramp.B)
        expect(at({ nC: 1 })).toBe(ramp.C)
        expect(at({ nD: 1 })).toBe(ramp.D)
        expect(at({ nF: 1 })).toBe(ramp.F)
        expect(at({ nNew: 1 })).toBe(NEW_COLORS[palette])
        expect(at({ nNone: 1 })).toBe(ramp.none)
        expect(at({ nClosed: 1 })).toBe(CLOSED_COLOR)
        // All zero — the basic map's dot (P6): the uniform gray.
        expect(at({})).toBe(LITE_MARKER_COLOR)
        // Every fill is hex: MapLibre paint cannot read a CSS token.
        for (const key of BUCKET_KEYS) expect(at({ [key]: 1 })).toMatch(/^#[0-9a-f]{6}$/)
    }
    // The bare call is the standard ramp — the pre-2026-09-06 call sites.
    expect(evaluate(pointFillExpr(), 'paint.circle-color', 12, { ...ZERO, nA: 1 })).toBe(GRADE_PALETTES.standard.A)
    // Closed dims; everything else is the dot's full presence.
    const opacity = pointOpacityExpr()
    expect(evaluate(opacity, 'paint.circle-opacity', 12, { ...ZERO, nClosed: 1 })).toBe(CLOSED_OPACITY)
    expect(evaluate(opacity, 'paint.circle-opacity', 12, { ...ZERO, nA: 1 })).toBe(POINT_OPACITY)
    expect(evaluate(opacity, 'paint.circle-opacity', 12, ZERO)).toBe(POINT_OPACITY)
    expect(CLOSED_OPACITY).toBe(0.42)
    expect(POINT_OPACITY).toBe(0.88)
})

test('a palette switch re-points the fill, the ring and the donut ids on a LIVE style and evicts the other palette\'s donuts', () => {
    const images = [
        'donut:dark:standard:22:3-1-0-0-0-1-0-0', 'donut:dark:standard:12:0-0-0-0-0-0-0-0',
        'donut:dark:colorblind:16:0-2-0-0-0-0-0-0', 'donut:light:colorblind:22:3-1-0-0-0-1-0-0', 'airport-11',
    ]
    const { host, calls } = recorder({ hasSource: true, images, layers: [LYR_POINTS, LYR_CLUSTERS, LYR_STACKS] })
    applyPalette(host, true, 'colorblind')
    expect(calls.setPaint).toEqual([
        [LYR_POINTS, 'circle-color', pointFillExpr('colorblind')],
        [LYR_POINTS, 'circle-stroke-color', ringColorExpr('dark', 'colorblind')],
    ])
    expect(calls.setLayout).toEqual([[LYR_CLUSTERS, 'icon-image', donutIconExpr('dark', 'colorblind')]])
    // This theme's, this palette's donut stays; every other donut goes; the basemap's icons are not ours.
    expect(calls.removeImage).toEqual([
        'donut:dark:standard:22:3-1-0-0-0-1-0-0', 'donut:dark:standard:12:0-0-0-0-0-0-0-0',
        'donut:light:colorblind:22:3-1-0-0-0-1-0-0',
    ])
    // Nothing is added or re-sourced: the fill is paint too, so the data never moves.
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
    expect(by[LYR_POINTS]!.paint!['circle-color']).toEqual(pointFillExpr('colorblind'))
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

// ── the aerial basemap (2026-09-07) ────────────────────────────────────
// The choice is one raster layer INSIDE the basemap, and these pin the two
// things that make that true: where it is inserted, and that flipping it
// touches nothing else.

test('the drawn map adds nothing at all — the shipped default is the absence of a layer', () => {
    const { host, calls } = recorder({ styleLayers: CARTO_LAYERS })
    applyBasemap(host, 'map')
    expect(calls.addSource).toHaveLength(0)
    expect(calls.addLayer).toHaveLength(0)
    expect(calls.removeLayer).toHaveLength(0)
    expect(calls.removeSource).toHaveLength(0)
})

test('the aerial is a raster source on the VBMP tile scheme, capped at the zoom that has tiles', () => {
    const { host, calls } = recorder({ styleLayers: CARTO_LAYERS })
    applyBasemap(host, 'aerial')
    expect(calls.addSource).toHaveLength(1)
    const [id, spec] = calls.addSource[0]!
    expect(id).toBe(SRC_AERIAL)
    expect(spec).toMatchObject({
        type: 'raster',
        tiles: [AERIAL_TILES],
        tileSize: AERIAL_TILE_SIZE,
        // The service's LODs claim 23; tiles 404 past 19 (measured
        // 2026-09-07), so the source declares what exists and MapLibre
        // overzooms the rest instead of painting holes.
        maxzoom: AERIAL_MAX_ZOOM,
        attribution: AERIAL_ATTRIBUTION,
    })
    // XYZ, and the row/col order ArcGIS serves — a transposed template
    // returns tiles from the wrong hemisphere rather than an error.
    expect(AERIAL_TILES).toContain('/tile/{z}/{y}/{x}')
    // The credit rides the SOURCE, so it appears exactly while the imagery
    // is on the map and leaves with it.
    // The program by name — VGIN's condition for public use (2026-09-08) —
    // and the network that holds the copyright.
    expect(AERIAL_ATTRIBUTION).toContain('Virginia Base Mapping Program')
    expect(AERIAL_ATTRIBUTION).toContain('VGIN')
})

test('the aerial goes under the basemap\'s LABEL BLOCK — the photo replaces the drawn ground, the labels stay', () => {
    const { host, calls } = recorder({ styleLayers: DARK_MATTER_LAYERS })
    applyBasemap(host, 'aerial')
    expect(calls.addLayer).toHaveLength(1)
    expect(calls.addLayer[0]).toMatchObject({ id: LYR_AERIAL, type: 'raster', source: SRC_AERIAL })
    expect(calls.before[0]).toBe('waterway_label')
})

test('the seam is the last DRAWN layer, not the first symbol one — positron writes before it finishes drawing', () => {
    // The bug this pins, measured live 2026-09-07: positron's first symbol
    // layer is `waterway_label` at index 13, with 53 drawn layers after it.
    // Inserting there left the photograph under the roads, the buildings
    // and the boundaries — a white map with imagery showing through.
    expect(labelBlockStart(recorder({ styleLayers: POSITRON_LAYERS }).host)).toBe('watername_ocean')
    expect(labelBlockStart(recorder({ styleLayers: DARK_MATTER_LAYERS }).host)).toBe('waterway_label')

    const { host, calls } = recorder({ styleLayers: POSITRON_LAYERS })
    applyBasemap(host, 'aerial')
    expect(calls.before[0]).toBe('watername_ocean')
    // Everything the basemap DRAWS is under the photo; only its text is over.
    const ids = POSITRON_LAYERS.map((l) => l.id)
    const at = ids.indexOf(calls.before[0]!)
    for (const layer of POSITRON_LAYERS) {
        if (layer.type === 'symbol') continue
        expect(ids.indexOf(layer.id)).toBeLessThan(at)
    }
})

test('our own layers are not the basemap: a live flip never slides the aerial over the markers', () => {
    // The flip a visitor makes: the markers are already installed. The dots
    // are CIRCLES — non-symbol — so counting them would push the seam to the
    // very top of the style and put the photograph over the map.
    for (const style of [DARK_MATTER_LAYERS, POSITRON_LAYERS]) {
        const { host, calls } = recorder({
            styleLayers: [...style,
                { id: LYR_CLUSTERS, type: 'symbol' },
                { id: LYR_POINTS, type: 'circle' },
                { id: LYR_STACKS, type: 'circle' },
                { id: LYR_STACK_COUNT, type: 'symbol' }],
            layers: [LYR_CLUSTERS],
        })
        applyBasemap(host, 'aerial')
        const before = calls.before[0]!
        expect(style.map((l) => l.id)).toContain(before)
        // Strictly below every marker layer.
        const ids = [...style.map((l) => l.id), LYR_CLUSTERS, LYR_POINTS, LYR_STACKS, LYR_STACK_COUNT]
        expect(ids.indexOf(before)).toBeLessThan(ids.indexOf(LYR_CLUSTERS))
    }
})

test('a basemap that draws to the end puts the aerial under the bottom-most marker layer, never over it', () => {
    const { host, calls } = recorder({
        styleLayers: [{ id: 'background', type: 'background' }, { id: LYR_CLUSTERS, type: 'symbol' }],
        layers: [LYR_CLUSTERS],
    })
    applyBasemap(host, 'aerial')
    expect(labelBlockStart(host)).toBeNull()
    expect(calls.before[0]).toBe(LYR_CLUSTERS)
})

test('applyBasemap is idempotent — the source\'s presence IS the state', () => {
    const { host, calls } = recorder({ sources: [SRC_AERIAL], styleLayers: CARTO_LAYERS })
    applyBasemap(host, 'aerial')
    expect(calls.addSource).toHaveLength(0)
    expect(calls.addLayer).toHaveLength(0)
})

test('back to the drawn map drops the layer and then its source, in that order', () => {
    const { host, calls } = recorder({
        sources: [SRC_AERIAL], layers: [LYR_AERIAL], styleLayers: CARTO_LAYERS,
    })
    applyBasemap(host, 'map')
    expect(calls.removeLayer).toEqual([LYR_AERIAL])
    expect(calls.removeSource).toEqual([SRC_AERIAL])
    expect(calls.addLayer).toHaveLength(0)
})

test('a style that lost the layer but kept the source still cleans up', () => {
    const { host, calls } = recorder({ sources: [SRC_AERIAL], layers: [], styleLayers: CARTO_LAYERS })
    applyBasemap(host, 'map')
    expect(calls.removeLayer).toEqual([])
    expect(calls.removeSource).toEqual([SRC_AERIAL])
})

test('the basemap never touches the markers: no paint, no layout, no images, no data', () => {
    for (const choice of ['map', 'aerial'] as const) {
        const { host, calls } = recorder({
            sources: choice === 'map' ? [SRC_AERIAL] : [], layers: [LYR_AERIAL, LYR_CLUSTERS, LYR_POINTS],
            styleLayers: CARTO_LAYERS,
        })
        applyBasemap(host, choice)
        expect(calls.setPaint).toHaveLength(0)
        expect(calls.setLayout).toHaveLength(0)
        expect(calls.removeImage).toHaveLength(0)
        // Whatever it added or removed was the aerial's own, nothing else.
        expect(calls.addSource.map(([id]) => id)).not.toContain(SRC)
        expect(calls.removeLayer.filter((id) => id !== LYR_AERIAL)).toEqual([])
        expect(calls.removeSource.filter((id) => id !== SRC_AERIAL)).toEqual([])
    }
})

// ── the seam on a style strangers have added to (2026-09-08) ────────────
// Found merging the aerial over CPE-M2: the edit mode installs proposal
// tethers (a LINE layer) and pins (CIRCLES) above the markers — layers this
// module does not own. A live flip that re-scanned the style took the pins
// for the basemap's last drawn layer and put the photograph over the dots.
// The fix is the `seam` MapView measures on the pristine style at style.load
// and hands back on every flip.

const EDIT_MODE_LAYERS = [
    ...DARK_MATTER_LAYERS,
    { id: LYR_CLUSTERS, type: 'symbol' }, { id: LYR_POINTS, type: 'circle' },
    { id: LYR_STACKS, type: 'circle' }, { id: LYR_STACK_COUNT, type: 'symbol' },
    // The edit mode's layers, in its own install order (mapEditController;
    // the ids are app/admin/mapDraft.ts's, written out so this spec never
    // imports the admin chunk).
    { id: 'cp-proposal-tethers', type: 'line' },
    { id: 'cp-proposal-pins', type: 'circle' },
    { id: 'cp-proposal-badges', type: 'symbol' },
]

test('a live flip in edit mode: the seam measured on the pristine style keeps the aerial under the markers', () => {
    // What MapView does at style.load, before anything is added.
    const pristine = recorder({ styleLayers: DARK_MATTER_LAYERS })
    const seam = labelBlockStart(pristine.host)
    expect(seam).toBe('waterway_label')
    // The visitor flips later, on a style that now carries the markers and
    // the edit mode's layers above them.
    const live = recorder({ styleLayers: EDIT_MODE_LAYERS, layers: EDIT_MODE_LAYERS.map((l) => l.id) })
    applyBasemap(live.host, 'aerial', seam)
    expect(live.calls.before[0]).toBe('waterway_label')
})

test('why the seam is handed over: a re-scan of that style takes the pins for the basemap and lands above the dots', () => {
    const live = recorder({ styleLayers: EDIT_MODE_LAYERS, layers: EDIT_MODE_LAYERS.map((l) => l.id) })
    // The scan alone, as the first cut did it: the last non-symbol layer it
    // can see is the pins, so it names the badges above them — above the
    // markers. This is the defect, kept as a test so the reason survives.
    expect(labelBlockStart(live.host)).toBe('cp-proposal-badges')
    applyBasemap(live.host, 'aerial', null)
    expect(live.calls.before[0]).toBe('cp-proposal-badges')
})

test('a measured seam the style no longer has falls back to the scan, then to the markers', () => {
    const restyled = recorder({ styleLayers: POSITRON_LAYERS, layers: [] })
    applyBasemap(restyled.host, 'aerial', 'a_layer_carto_renamed')
    expect(restyled.calls.before[0]).toBe(labelBlockStart(restyled.host))
    const bare = recorder({
        styleLayers: [{ id: 'background', type: 'background' }, { id: LYR_CLUSTERS, type: 'symbol' }],
        layers: [LYR_CLUSTERS],
    })
    applyBasemap(bare.host, 'aerial', 'gone')
    expect(bare.calls.before[0]).toBe(LYR_CLUSTERS)
})
