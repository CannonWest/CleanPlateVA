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
    CLUSTER_COUNT_TEXT_SIZE, CLUSTER_MAX_ZOOM, CLUSTER_PIXEL_RADIUS,
    DARK_MAJOR_ROAD_LABEL_COLOR, DARK_MAJOR_ROAD_LABEL_LAYER,
    DECLINE_RINGS, DECLINE_RING_WIDTH,
    LYR_CLUSTERS,
    LYR_POINTS, LYR_STACK_COUNT, LYR_STACKS, MARKER_RING, MARKER_RING_WIDTH,
    POINT_RADIUS_FULL, POINT_RADIUS_STOPS, SRC, STACK_COUNT_ZOOM,
    STACK_INK, STACK_RADII, STACK_STEPS, STACK_SURFACE,
} from './constants'
import type { GradePalette } from './constants'
import { donutIconExpr, staleDonutIds } from './donut'
import { clusterProperties } from './mapData'
import type { MapData } from './mapData'

type ExpressionSpec = maplibregl.ExpressionSpecification

/** What the install needs of a map — the real `maplibregl.Map` satisfies
 *  it; a spec passes a recorder. */
export type LayerHost = Pick<maplibregl.Map,
    'getSource' | 'addSource' | 'addLayer' | 'listImages' | 'removeImage'
    | 'getLayer' | 'setPaintProperty' | 'setLayoutProperty'>

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
 *  settings dialog's grade-palette switch): the dot ring's declining color
 *  and the donut ids the cluster layer asks for, then evict the other
 *  palette's donuts so the resolver repaints under the new one. The dots'
 *  fills are baked into the data — MapView rebuilds and re-sets the source
 *  (buildMapData takes the palette). Before the layers exist (first mount)
 *  there is nothing to re-point: style.load installs with the palette. */
export function applyPalette(map: LayerHost, dark: boolean, palette: GradePalette): void {
    const theme = dark ? 'dark' : 'light'
    if (map.getLayer(LYR_POINTS)) {
        map.setPaintProperty(LYR_POINTS, 'circle-stroke-color', ringColorExpr(theme, palette))
    }
    if (map.getLayer(LYR_CLUSTERS)) {
        map.setLayoutProperty(LYR_CLUSTERS, 'icon-image', donutIconExpr(theme, palette) as ExpressionSpec)
    }
    for (const id of staleDonutIds(map.listImages(), theme, palette)) map.removeImage(id)
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
            'circle-color': ['get', 'fill'],
            'circle-opacity': ['get', 'opacity'],
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
