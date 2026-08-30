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
 *   · grade LETTERS ride the dots past a zoom threshold (letter property;
 *     the letter always rides the color, §6.0) — graded facilities only;
 *   · declining = a DASHED ring in the marker's own grade color (was the
 *     old client's F-red stroke), active graded facilities only;
 *   · stacks are NEUTRAL count bubbles (their PAINT carries no judgment).
 *
 * Proximity clustering revived (Cannon's preview call, 2026-08-30): every
 * feature also carries the cluster accumulator inputs — `stack` (1 for a
 * lone place, so a cluster counts PLACES rather than the points it drew
 * over) and `gradeSum`/`gradeCount` (raw sum + count over the LIVE, scored
 * places standing on the point, so summing across a cluster yields the
 * mean over its places; averaging per-point means would weight a lone
 * diner equally against a 57-permit food court). Closed permits are
 * excluded — a shuttered restaurant's last grade is not a fact about the
 * address today — and lite publishes no grades, so both stay 0. The
 * accumulators must never meet a null (old `markers.js` rule).
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

/** Cluster accumulator inputs, present on EVERY feature (see header). */
interface ClusterInputs {
    /** Places standing on this point (1 for a lone facility). */
    stack: number
    gradeSum: number
    gradeCount: number
}

export interface PointProps extends ClusterInputs {
    kind: 'point'
    pid: string
    fill: string
    opacity: number
    /** The grade letter for the symbol layer; '' when nothing rides. */
    letter: string
    /** 1 = draw the dashed declining ring (MapLibre filters on it). */
    declining: 0 | 1
}

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

/** The mean-grade inputs for the places standing on one point. */
function clusterInputs(members: RosterRow[], lite: boolean): ClusterInputs {
    const inputs: ClusterInputs = { stack: members.length, gradeSum: 0, gradeCount: 0 }
    if (lite) return inputs // lite publishes no grades — nothing to average
    for (const m of members) {
        if (!isActivePermit(m)) continue
        const score = facilityPresentation(m).grade?.score
        if (!Number.isFinite(score)) continue
        inputs.gradeSum += score as number
        inputs.gradeCount += 1
    }
    return inputs
}

function pointProps(f: RosterRow, lite: boolean): PointProps {
    const pid = String(f.permit_id)
    const inputs = clusterInputs([f], lite)
    if (lite) {
        // The finder view: every marker a uniform neutral — the basic map
        // locates places, it doesn't judge them (P6).
        return { kind: 'point', pid, fill: LITE_MARKER_COLOR, opacity: 0.88, letter: '', declining: 0, ...inputs }
    }
    const active = isActivePermit(f)
    if (!active) {
        return { kind: 'point', pid, fill: CLOSED_COLOR, opacity: 0.42, letter: '', declining: 0, ...inputs }
    }
    const view = facilityPresentation(f)
    const letter = view.grade?.letter || ''
    if (!letter) {
        return {
            kind: 'point',
            pid,
            fill: isNewlyPermitted(f) ? NEW_COLOR : gradeColor(null),
            opacity: 0.88,
            letter: '',
            declining: 0,
            ...inputs,
        }
    }
    return {
        kind: 'point',
        pid,
        fill: gradeColor(letter),
        opacity: 0.88,
        letter,
        declining: view.declining ? 1 : 0,
        ...inputs,
    }
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
                ? pointProps(first, lite)
                : { kind: 'stack', skey: key, ...clusterInputs(members, lite) },
        })
    }
    return { geojson: { type: 'FeatureCollection', features }, stacks: groups }
}
