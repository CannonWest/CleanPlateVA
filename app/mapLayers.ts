/**
 * The MapLibre layer set (CRP-M3 — lifted out of MapView.tsx with zero
 * behavior change): the §6.2 marker grammar as style layers over the ONE
 * GeoJSON source, plus the dark-matter road-label fix. No React here, and
 * the map is typed structurally (`LayerHost`), so the install runs against
 * a recording fake in Vitest — the layer ORDER, the source's cluster
 * config, and the paint/layout expressions are contracts, not incidentals.
 *
 * Bottom to top:
 *
 *   · vbmp-imagery       raster   the aerial, when chosen — NOT on top of
 *                                 the basemap but INSIDE it, under CARTO's
 *                                 first label layer (applyBasemap), so the
 *                                 photograph replaces the drawn ground and
 *                                 the theme's labels still ride over it
 *   · food-clusters      symbol   the CRP-M6 donut + count, under everything
 *   · food-points        circle   grade fill; ring white, or declining red
 *   · food-stacks        circle   neutral count bubbles, above lone dots
 *   · food-stack-count   symbol   the count, past STACK_COUNT_ZOOM
 *
 * The hit test (mapHit.ts) mirrors the radius expressions here in JS — a
 * target that disagrees with the paint is worse than no slop at all — and
 * the map-layers spec evaluates both sides against each other.
 */

import type * as maplibregl from 'maplibre-gl'
import {
    AERIAL_ATTRIBUTION, AERIAL_MAX_ZOOM, AERIAL_TILE_SIZE, AERIAL_TILES,
    CLOSED_OPACITY, CLUSTER_COUNT_TEXT_SIZE, CLUSTER_MAX_ZOOM, CLUSTER_PIXEL_RADIUS,
    DARK_MAJOR_ROAD_LABEL_COLOR, DARK_MAJOR_ROAD_LABEL_LAYER,
    DECLINE_RINGS, DECLINE_RING_WIDTH,
    LITE_MARKER_COLOR, LYR_AERIAL, LYR_CLUSTERS,
    LYR_POINTS, LYR_STACK_COUNT, LYR_STACKS, MARKER_RING, MARKER_RING_WIDTH,
    POINT_OPACITY, POINT_RADIUS_FULL, POINT_RADIUS_STOPS, SRC, SRC_AERIAL, STACK_COUNT_ZOOM,
    STACK_INK, STACK_RADII, STACK_STEPS, STACK_SURFACE,
} from './constants'
import type { GradePalette } from './constants'
import type { Basemap } from './basemap'
import { bucketFills, donutIconExpr, staleDonutIds } from './donut'
import { BUCKET_KEYS, clusterProperties } from './mapData'
import type { MapData } from './mapData'

type ExpressionSpec = maplibregl.ExpressionSpecification

/** What the install needs of a map — the real `maplibregl.Map` satisfies
 *  it; a spec passes a recorder. */
export type LayerHost = Pick<maplibregl.Map,
    'getSource' | 'addSource' | 'addLayer' | 'listImages' | 'removeImage'
    | 'getLayer' | 'setPaintProperty' | 'setLayoutProperty'
    | 'getStyle' | 'removeLayer' | 'removeSource'>

/** The layers the pointer resolves against, in one padded query — every
 *  mark type at once, so a stack beside a dot beside a bubble all compete
 *  (mapHit.pickMark ranks them). */
export const HIT_LAYERS: readonly string[] = [LYR_STACKS, LYR_POINTS, LYR_CLUSTERS]

/** The dot layer's zoom→radius curve (linear between stops). */
export function pointRadiusExpr(): ExpressionSpec {
    const expr: unknown[] = ['interpolate', ['linear'], ['zoom']]
    for (const [zoom, radius] of POINT_RADIUS_STOPS) expr.push(zoom, radius)
    return expr as ExpressionSpec
}

/** The dot's fill: the bucket it wears, in the palette — ONE table with the
 *  donut's arcs (donut.ts bucketFills), so a dot and the arc that hides it
 *  can never disagree. Exactly one bucket is 1 on a lone dot; all zero is
 *  the basic map's uniform gray (P6). A paint expression, not a feature
 *  property (2026-09-07): the palette is re-pointed in place (applyPalette)
 *  and the data never changes — the principle the cluster switch and the
 *  declining ring already held. */
export function pointFillExpr(palette: GradePalette = 'standard'): ExpressionSpec {
    const fills = bucketFills(palette)
    const expr: unknown[] = ['case']
    for (const key of BUCKET_KEYS) expr.push(['>', ['get', key], 0], fills[key])
    expr.push(LITE_MARKER_COLOR)
    return expr as ExpressionSpec
}

/** The dot's presence: closed dims, everything else stands at full. */
export function pointOpacityExpr(): ExpressionSpec {
    return ['case', ['>', ['get', 'nClosed'], 0], CLOSED_OPACITY, POINT_OPACITY] as unknown as ExpressionSpec
}

/** Stack radius: the member-count step at full size, riding the dots' own
 *  zoom curve so a bubble reads as a slightly bigger dot at state view. */
export function stackRadiusExpr(): ExpressionSpec {
    const step = ['step', ['get', 'stack'],
        STACK_RADII[0], STACK_STEPS[0], STACK_RADII[1],
        STACK_STEPS[1], STACK_RADII[2]]
    const expr: unknown[] = ['interpolate', ['linear'], ['zoom']]
    for (const [zoom, radius] of POINT_RADIUS_STOPS) {
        const factor = radius / POINT_RADIUS_FULL
        expr.push(zoom, factor === 1 ? step : ['*', step, factor])
    }
    return expr as ExpressionSpec
}

export const POINT_FILTER = ['==', ['get', 'kind'], 'point'] as unknown as ExpressionSpec
export const STACK_FILTER = ['==', ['get', 'kind'], 'stack'] as unknown as ExpressionSpec
// Cluster features carry no `kind`, so the point/stack filters above never
// match them; this one is MapLibre's own marker for a cluster feature. With
// clustering off it matches nothing.
export const CLUSTER_FILTER = ['has', 'point_count'] as unknown as ExpressionSpec

// The bubble's count: `sum` (see clusterProperties), not point_count — a
// cluster must count PLACES, and one feature can stand for 57 of them.
// point_count_abbreviated came free; abbreviate sum by hand (≥1000 → "1.2k").
export const CLUSTER_COUNT_TEXT = ['case',
    ['>=', ['get', 'sum'], 1000],
    ['concat',
        ['to-string', ['/', ['round', ['/', ['get', 'sum'], 100]], 10]],
        'k'],
    ['to-string', ['get', 'sum']]] as unknown as ExpressionSpec

const DECLINING = ['==', ['get', 'declining'], true]

/** The dot's ring (CRP-M2): the declining color over the theme's white
 *  separator, on the SAME circle layer — MapLibre draws one stroke per
 *  circle, so a declining dot trades its white ring for the marked one (a
 *  second halo layer beneath was scoped and not taken). No zoom gate: the
 *  ring rides the dot wherever the dot is drawn. The color is the palette's
 *  (constants.ts DECLINE_RINGS): red on the standard ramp, near-black on
 *  the color-blind one. */
export function ringColorExpr(theme: 'dark' | 'light', palette: GradePalette = 'standard'): ExpressionSpec {
    return ['case', DECLINING, DECLINE_RINGS[palette], MARKER_RING[theme]] as unknown as ExpressionSpec
}

export function ringWidthExpr(): ExpressionSpec {
    return ['case', DECLINING, DECLINE_RING_WIDTH, MARKER_RING_WIDTH] as unknown as ExpressionSpec
}

/** Re-point the palette-bearing layer properties on a LIVE style (the
 *  settings dialog's grade-palette switch): the dots' fill (their bucket,
 *  in the palette), the ring's declining color and the donut ids the
 *  cluster layer asks for, then evict the other palette's donuts so the
 *  resolver repaints under the new one. Paint only — the data is
 *  palette-free (mapData.ts, since 2026-09-07), so no rebuild and no
 *  setData. Before the layers exist (first mount) there is nothing to
 *  re-point: style.load installs with the palette. */
export function applyPalette(map: LayerHost, dark: boolean, palette: GradePalette): void {
    const theme = dark ? 'dark' : 'light'
    if (map.getLayer(LYR_POINTS)) {
        map.setPaintProperty(LYR_POINTS, 'circle-color', pointFillExpr(palette))
        map.setPaintProperty(LYR_POINTS, 'circle-stroke-color', ringColorExpr(theme, palette))
    }
    if (map.getLayer(LYR_CLUSTERS)) {
        map.setLayoutProperty(LYR_CLUSTERS, 'icon-image', donutIconExpr(theme, palette) as ExpressionSpec)
    }
    for (const id of staleDonutIds(map.listImages(), theme, palette)) map.removeImage(id)
}

/** Our own layer ids — everything this module adds. `firstLabelLayer` skips
 *  them: the cluster donuts are a symbol layer too, and the aerial must
 *  never slide under the markers. */
const OURS = new Set<string>([LYR_AERIAL, LYR_CLUSTERS, LYR_POINTS, LYR_STACKS, LYR_STACK_COUNT])

/** Where the basemap stops DRAWING and starts WRITING — the layer the
 *  aerial goes under, so the photograph replaces the drawn ground while
 *  every label, in the visitor's theme and wearing its own halo, still
 *  rides on top ("aerial with labels", and no second style to keep in step
 *  with the theme).
 *
 *  The seam is the layer after the LAST non-symbol one, not the first
 *  symbol one — the two are not the same, and assuming they were shipped a
 *  bug that only dark-matter hid (caught live, 2026-09-07). dark-matter
 *  paints all 66 of its fills and lines and then all its text, so its first
 *  symbol IS the seam; positron puts `waterway_label` at index 13 and then
 *  draws 53 more layers of roads, buildings and boundaries over it, so
 *  inserting at ITS first symbol left the photograph under most of the
 *  cartography — a white map with imagery showing through the gaps. Both
 *  styles end their drawing at `boundary_country_inner`; this finds that
 *  edge without naming it.
 *
 *  The cost of taking the seam this late is that a label written BEFORE the
 *  basemap finishes drawing goes under the photo too. Measured: positron
 *  loses exactly one of its 27 label layers that way (`waterway_label` —
 *  river and stream names, which the photograph shows anyway) and
 *  dark-matter loses none. Every place, road, POI and house-number label
 *  rides over the imagery in both. Pinned in tests/e2e/aerial.spec.ts, so a
 *  CARTO restyle that swallowed more would fail rather than degrade.
 *
 *  Our own layers are skipped: the markers are circles (non-symbol) and the
 *  cluster donuts are symbols, so counting them would move the seam to the
 *  top of the style and slide the aerial over the dots.
 *
 *  Null when the basemap draws all the way to the end (no labels at all, or
 *  a style still loading): the caller falls back to the markers. */
export function labelBlockStart(map: LayerHost): string | null {
    let layers: Array<{ id: string; type: string }>
    try {
        layers = map.getStyle()?.layers ?? []
    } catch {
        return null // no style yet
    }
    const basemap = layers.filter((layer) => !OURS.has(layer.id))
    let lastDrawn = -1
    for (let i = 0; i < basemap.length; i += 1) {
        if (basemap[i]!.type !== 'symbol') lastDrawn = i
    }
    return basemap[lastDrawn + 1]?.id ?? null
}

/** Put the visitor's basemap choice on the CURRENT style: 'aerial' adds the
 *  VBMP raster under the style's labels, 'map' takes it off again. Called
 *  on every style.load (a theme swap drops it with everything else) and
 *  whenever the layers control changes the choice — the same function both
 *  times, so there is one code path and no "install vs. update" pair to
 *  drift. Idempotent: the source's presence is the state.
 *
 *  The markers do not move. They are added after this on a fresh style, and
 *  on a live one the raster is inserted BELOW a label layer that is itself
 *  below them — so a flip never restacks the dots, and nothing about the
 *  hit test, the palette or the clustering knows this ran. */
export function applyBasemap(map: LayerHost, basemap: Basemap): void {
    const on = !!map.getSource(SRC_AERIAL)
    if (basemap === 'aerial') {
        if (on) return
        map.addSource(SRC_AERIAL, {
            type: 'raster',
            tiles: [AERIAL_TILES],
            tileSize: AERIAL_TILE_SIZE,
            maxzoom: AERIAL_MAX_ZOOM,
            attribution: AERIAL_ATTRIBUTION,
        })
        // Under the basemap's labels; failing that (a style that draws to
        // the end) under the bottom-most marker layer, which is the one
        // thing this must never cover. Only a style with neither leaves it
        // on top, and then there is nothing above it to hide.
        const before = labelBlockStart(map)
            ?? (map.getLayer(LYR_CLUSTERS) ? LYR_CLUSTERS : null)
        map.addLayer({ id: LYR_AERIAL, type: 'raster', source: SRC_AERIAL },
            before ?? undefined)
        return
    }
    if (!on) return
    if (map.getLayer(LYR_AERIAL)) map.removeLayer(LYR_AERIAL)
    map.removeSource(SRC_AERIAL)
}

/** Add source + the marker layers to the CURRENT style. Idempotent per
 *  style — style.load hands a bare basemap each time. */
export function installDataLayers(
    map: LayerHost, data: MapData, dark: boolean, clusters: boolean, palette: GradePalette = 'standard',
): void {
    if (map.getSource(SRC)) return
    const theme = dark ? 'dark' : 'light'
    // A theme swap diffs the style in place and keeps the image manager
    // (measured: both themes' donuts listed after a swap) — drop the
    // outgoing theme's, and any other palette's; this pair's are repainted
    // on demand.
    for (const id of staleDonutIds(map.listImages(), theme, palette)) map.removeImage(id)
    map.addSource(SRC, {
        type: 'geojson',
        data: data.geojson,
        // Proximity clustering is ALWAYS configured and flipped in place by
        // the visitor's switch (MapView's setClusterOptions effect — no
        // teardown, no GeoJSON rebuild); `cluster` is the switch's state at
        // (re)install. clusterMaxZoom is a TILE zoom: bubbles dissolve at
        // camera zoom 13 on CARTO's 512px tiles. clusterProperties are
        // addSource-time config and survive the flip.
        cluster: clusters,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: CLUSTER_PIXEL_RADIUS,
        // Every feature carries `stack` (1 for a lone place) and its donut
        // buckets, so a cluster reports the PLACES inside it and the
        // breakdown its ring draws (mapData.ts clusterInputs).
        clusterProperties: clusterProperties(),
    })
    // Cluster bubbles sit UNDER everything: a lone dot or a stack that
    // escaped grouping must never be occluded by a neighbouring bubble.
    // Installed even with clustering off — the filter matches nothing, so
    // the layer is empty and free, and the hit test never names a missing
    // layer.
    map.addLayer({
        id: LYR_CLUSTERS,
        type: 'symbol',
        source: SRC,
        filter: CLUSTER_FILTER,
        layout: {
            // The donut: one image per (theme · palette · size step · bucket
            // tuple), painted on demand by the missing-image resolver
            // (donut.ts). Fixed radii by places, never zoom-scaled — a
            // bubble is a camera control, not a mark.
            'icon-image': donutIconExpr(theme, palette) as ExpressionSpec,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            // The count rides the icon on the same layer, so the two can
            // never drift apart across a re-cluster (fadeDuration 0 keeps
            // symbols from cross-fading behind their bubbles).
            'text-field': CLUSTER_COUNT_TEXT,
            'text-font': ['Montserrat Regular'],
            'text-size': CLUSTER_COUNT_TEXT_SIZE,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        // The hole is the stacks' surface — their own ink, no halo (the
        // old white-on-dark-halo treatment existed for the grade-tinted
        // fills). Theme-invariant with them since 2026-09-06.
        paint: { 'text-color': STACK_INK },
    })
    map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC,
        filter: POINT_FILTER,
        paint: {
            'circle-radius': pointRadiusExpr(),
            'circle-color': pointFillExpr(palette),
            'circle-opacity': pointOpacityExpr(),
            'circle-stroke-color': ringColorExpr(theme, palette),
            'circle-stroke-width': ringWidthExpr(),
        },
    })
    // Stacks sit above the lone dots: a point standing for N places
    // outranks its neighbours. Bubbles ride the dots' zoom curve (the old
    // client hid them under proximity clusters below z12; scaled down they
    // read as slightly-bigger dots instead of swamping the state view),
    // and the count appears once the bubble can carry it.
    map.addLayer({
        id: LYR_STACKS,
        type: 'circle',
        source: SRC,
        filter: STACK_FILTER,
        paint: {
            'circle-radius': stackRadiusExpr(),
            'circle-color': STACK_SURFACE,
            'circle-stroke-color': MARKER_RING[theme],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 2],
        },
    })
    map.addLayer({
        id: LYR_STACK_COUNT,
        type: 'symbol',
        source: SRC,
        minzoom: STACK_COUNT_ZOOM,
        filter: STACK_FILTER,
        layout: {
            'text-field': ['to-string', ['get', 'stack']],
            'text-font': ['Montserrat Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], STACK_COUNT_ZOOM, 9, 14, 11],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        // Neutral bubble, ink label — the count sits INSIDE (the old
        // outside-offset dodge existed for grade-tinted fills).
        paint: { 'text-color': STACK_INK },
    })
}

/** dark-matter ships trunk/motorway labels at 1.7:1 against its own
 *  background (vendor defect, one layer); guard on the layer existing. */
export function fixDarkRoadLabels(map: LayerHost, dark: boolean): void {
    if (!dark) return
    if (map.getLayer(DARK_MAJOR_ROAD_LABEL_LAYER)) {
        map.setPaintProperty(DARK_MAJOR_ROAD_LABEL_LAYER, 'text-color', DARK_MAJOR_ROAD_LABEL_COLOR)
    }
}
