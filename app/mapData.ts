/**
 * Filtered roster → the map's GeoJSON (CRVa-M0) — the §6.2 marker grammar
 * as per-feature properties, pure and testable without MapLibre.
 *
 * Ported semantics (old `markers.js` `_toGeoJSON` / `_markerPaint`):
 *   · one feature per DISTINCT POINT — facilities sharing a coordinate
 *     (6-dp `stackKey`, matching the finder's export rounding) collapse
 *     into a single stack feature carrying its member count;
 *   · fill = grade color · NEW blue · closed gray+dim · lite uniform gray;
 *   · closed permits (visible only under "Show closed") plot dimmed.
 *
 * Redesigned per the ratified mockup (design ref §6.2, CRD-M1):
 *   · the dot is COLOR + RING alone. Grade letters rode the dots past a
 *     z13.5 gate (a `letter` property feeding a symbol layer) until
 *     2026-09-06, when Cannon retired them from the map — the letter still
 *     rides every place a grade is NAMED (hover card, panel, list, chips),
 *     so this bake keeps deriving the letter, but only to pick the fill;
 *   · stacks are NEUTRAL count bubbles (their PAINT carries no judgment).
 *
 * Proximity clustering was revived and withdrawn the same day (2026-08-30,
 * Cannon's live preview review; CleanPlateVA #174/#175) and the CRD-M1
 * dashed declining ring was scrapped on the same review. The declining
 * replacement landed CRP-M1 (2026-08-31): the ↓ suffix beside the letter;
 * CRP-M2 (2026-09-05, Cannon's pick) retired the suffix for a RED RING on
 * the dot at every zoom — production's form, off-ramp color. The bake is
 * the same either way: `declining` is true for GRADED dots only (what the
 * letters used to mark), and MapView's ring expression reads it.
 *
 * Clustering returned as a VISITOR SWITCH (CRP-M6, 2026-09-05, default
 * off), so every feature also carries the cluster inputs — ALWAYS, whether
 * the switch is on or not, so a flip never rebuilds this GeoJSON: `stack`
 * (places standing on the point, 1 for a lone place — a cluster counts
 * PLACES rather than the points it drew over) and the eight DONUT BUCKETS
 * (how many of those places wear each of the dots' fills: A–F, NEW,
 * unscored, closed). The source sums them across a cluster (MapView
 * clusterProperties) and the donut draws the sums. The accumulators must
 * never meet a null (old `markers.js` rule), which is why every feature
 * carries all of them; the basic map zeroes the buckets — it publishes no
 * grades (P6), so its donut is one neutral arc.
 */

import type { Feature, FeatureCollection, Point } from 'geojson'
import { CLOSED_COLOR, LITE_MARKER_COLOR, NEW_COLOR } from './constants'
import {
    coordsOf, facilityPresentation, gradeColor, isActivePermit, isNewlyPermitted,
} from './data/presentation'
import type { RosterRow } from './data/types'

/** Same-point grouping key — 6 dp, the finder's own coordinate rounding
 *  (old `stacks.js` STACK_DP). */
export function stackKey(lat: number, lon: number): string {
    return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

/** The donut's buckets, in RING order: A→F on the ramp, NEW blue, unscored
 *  gray, closed dimmed gray. One per fill the dots use. */
export const BUCKET_KEYS = ['nA', 'nB', 'nC', 'nD', 'nF', 'nNew', 'nNone', 'nClosed'] as const
export type BucketKey = (typeof BUCKET_KEYS)[number]
export type Buckets = Record<BucketKey, number>

/** Cluster inputs, present on EVERY feature (see header). */
export interface ClusterInputs extends Buckets {
    /** Places standing on this point (1 for a lone facility). */
    stack: number
}

export function emptyBuckets(): Buckets {
    return { nA: 0, nB: 0, nC: 0, nD: 0, nF: 0, nNew: 0, nNone: 0, nClosed: 0 }
}

const LETTER_BUCKET: Record<string, BucketKey> = { A: 'nA', B: 'nB', C: 'nC', D: 'nD', F: 'nF' }

/** Which of the dots' fills this place wears — the bucket its cluster
 *  counts it in. The same branches as pointPaint below, so the ring is
 *  exactly the dots it hides. */
export function bucketOf(f: RosterRow): BucketKey {
    if (!isActivePermit(f)) return 'nClosed'
    const letter = facilityPresentation(f).grade?.letter || ''
    return LETTER_BUCKET[letter] ?? (isNewlyPermitted(f) ? 'nNew' : 'nNone')
}

/** The cluster inputs for the places standing on one point. */
export function clusterInputs(members: RosterRow[], lite: boolean): ClusterInputs {
    const inputs: ClusterInputs = { stack: members.length, ...emptyBuckets() }
    if (lite) return inputs // the basic map publishes no grades — one neutral arc
    for (const m of members) inputs[bucketOf(m)] += 1
    return inputs
}

/** The source's `clusterProperties`: a cluster's `sum` is the PLACES inside
 *  it (Σ stack — "without this a cluster covering Dulles counts 57 permits
 *  as one"), and each bucket sums the same way. */
export function clusterProperties(): Record<string, [unknown, unknown]> {
    const spec: Record<string, [unknown, unknown]> = { sum: ['+', ['get', 'stack']] }
    for (const key of BUCKET_KEYS) spec[key] = ['+', ['get', key]]
    return spec
}

export interface PointProps extends ClusterInputs {
    kind: 'point'
    pid: string
    fill: string
    opacity: number
    /** The declining ring (CRP-M2; band from M1b): true only for a GRADED
     *  dot — graded, active, full tier — whose grade-to-grade drop exceeds
     *  TREND_DECLINE_BAND (>5 points), so closed/NEW/unscored/basic-map
     *  dots never carry it. The ring has no zoom gate: it rides the dot
     *  wherever the dot is drawn (the letters it once accompanied were
     *  gated at z13.5 and are gone since 2026-09-06). */
    declining: boolean
}

/** A same-point stack; its `stack` (ClusterInputs) is the bubble's label
 *  and radius step as well as the cluster accumulator. */
export interface StackProps extends ClusterInputs {
    kind: 'stack'
    skey: string
}

export type MarkerProps = PointProps | StackProps

/** The same-point groups, keyed by `stackKey` — what a stack click will
 *  fan out (M2 consumers read members; M0 draws counts). */
export type StackIndex = Map<string, RosterRow[]>

export interface MapData {
    geojson: FeatureCollection<Point, MarkerProps>
    stacks: StackIndex
}

/** A lone dot's paint (the cluster inputs are spread in by the builder). */
function pointPaint(f: RosterRow, lite: boolean): Omit<PointProps, keyof ClusterInputs> {
    const pid = String(f.permit_id)
    if (lite) {
        // The finder view: every marker a uniform neutral — the basic map
        // locates places, it doesn't judge them (P6).
        return { kind: 'point', pid, fill: LITE_MARKER_COLOR, opacity: 0.88, declining: false }
    }
    const active = isActivePermit(f)
    if (!active) {
        return { kind: 'point', pid, fill: CLOSED_COLOR, opacity: 0.42, declining: false }
    }
    const view = facilityPresentation(f)
    const letter = view.grade?.letter || ''
    if (!letter) {
        return {
            kind: 'point',
            pid,
            fill: isNewlyPermitted(f) ? NEW_COLOR : gradeColor(null),
            opacity: 0.88,
            declining: false,
        }
    }
    return { kind: 'point', pid, fill: gradeColor(letter), opacity: 0.88, declining: view.declining }
}

/** Build the source data for the current filtered roster + tier. */
export function buildMapData(filtered: RosterRow[], lite: boolean): MapData {
    const groups: StackIndex = new Map()
    const at = new Map<string, [number, number]>()
    for (const f of filtered) {
        const { lat, lon } = coordsOf(f)
        if (lat == null || lon == null
            || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
        const key = stackKey(lat, lon)
        const group = groups.get(key)
        if (group) group.push(f)
        else {
            groups.set(key, [f])
            at.set(key, [lon, lat])
        }
    }
    const features: Feature<Point, MarkerProps>[] = []
    for (const [key, members] of groups) {
        const coordinates = at.get(key)
        const first = members[0]
        if (!coordinates || !first) continue // unreachable: groups always seed both
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates },
            properties: members.length === 1
                ? { ...pointPaint(first, lite), ...clusterInputs([first], lite) }
                : { kind: 'stack', skey: key, ...clusterInputs(members, lite) },
        })
    }
    return { geojson: { type: 'FeatureCollection', features }, stacks: groups }
}
