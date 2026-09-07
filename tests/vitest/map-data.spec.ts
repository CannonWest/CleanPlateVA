/**
 * The §6.2 marker grammar as source data (CRVa-M0) — `buildMapData` is the
 * pure half of the MapView island, so the grammar pins without MapLibre:
 *
 *   · the fill is NOT a property (2026-09-07): each feature carries the
 *     BUCKET it wears — grade A–F, NEW, unscored, closed — and the points
 *     layer paints the bucket in the visitor's palette (map-layers.spec
 *     evaluates that expression); a palette switch never rebuilds this data;
 *   · the declining ring rides only graded, active, full-tier dots;
 *   · same-point rows collapse into ONE stack feature carrying its member
 *     count and NO judgment properties (neutral count bubbles);
 *   · every feature carries the cluster inputs (CRP-M6) — `stack` (1 for a
 *     lone place) plus the eight donut buckets, so a cluster can count
 *     places and draw the breakdown of the dots it hides; the basic map
 *     zeroes the buckets (P6: the basic map carries no judgment);
 *   · rows without coordinates draw nothing.
 *
 * (The 2026-08-30 cluster accumulators and the declining-ring property
 * were withdrawn on Cannon's live review the same day — CleanPlateVA
 * #174/#175. The declining form returned as the CRP-M1 ↓ suffix, then
 * became the CRP-M2 red ring — the bake is the same for both: `declining`
 * is true only on a GRADED dot; the ring itself has no zoom gate. The
 * grade letters that predicate was once phrased against left the map
 * 2026-09-06 (Cannon's call), so no feature carries a `letter` any more.
 * Clustering returned as the CRP-M6 switch, with per-bucket COUNTS in
 * place of #174's mean-grade sums. The hex fill and the opacity left the
 * data 2026-09-07 — the bucket already said what the dot IS.)
 */
import { expect, test } from 'vitest'
import { BUCKET_KEYS, buildMapData, clusterProperties, stackKey } from '../../app/mapData'
import type { Buckets, ClusterInputs, PointProps, StackProps } from '../../app/mapData'
import type { OverlayRow, RosterRow } from '../../app/data/types'

let seq = 0
function row(over: Partial<RosterRow> & { o?: OverlayRow } = {}): RosterRow {
    seq += 1
    return {
        permit_id: `P-${seq}`,
        name: `Place ${seq}`,
        address: '1 Main St',
        address2: null,
        city: 'Richmond',
        zip: '23220',
        tenant: 'richmond',
        is_restaurant: true,
        mobile: false,
        pt: 1,
        lat: 37.5 + seq * 0.01,
        lon: -77.4 - seq * 0.01,
        loc: 0,
        ...over,
    }
}

function props(data: ReturnType<typeof buildMapData>, pid: string): PointProps {
    const feature = data.geojson.features.find(
        (f) => f.properties.kind === 'point' && f.properties.pid === pid,
    )
    if (!feature) throw new Error(`no point feature for ${pid}`)
    return feature.properties as PointProps
}

/** Just the cluster inputs of a feature's properties. */
function inputsOf(p: ClusterInputs): ClusterInputs {
    const out = { stack: p.stack } as ClusterInputs
    for (const key of BUCKET_KEYS) out[key] = p[key]
    return out
}

const ZERO: Buckets = { nA: 0, nB: 0, nC: 0, nD: 0, nF: 0, nNew: 0, nNone: 0, nClosed: 0 }

test('a dot carries its judgment as a BUCKET, never a color: the layer paints the bucket', () => {
    const graded = row({ o: { grade_score: 93 } })
    const newly = row({ o: { grade_score: null, new: 1 } })
    const unscored = row({ o: { grade_score: null, new: 0 } })
    const closed = row({ status: 'Business Closed', o: { grade_score: 88 } })
    const data = buildMapData([graded, newly, unscored, closed], false)

    expect(props(data, graded.permit_id).nA).toBe(1)
    expect(props(data, newly.permit_id).nNew).toBe(1)
    expect(props(data, unscored.permit_id).nNone).toBe(1)
    expect(props(data, closed.permit_id).nClosed).toBe(1)
    for (const r of [graded, newly, unscored, closed]) {
        const p = props(data, r.permit_id) as unknown as Record<string, unknown>
        // No hex, no opacity, no letter: the points layer paints the bucket
        // in the visitor's palette (mapLayers pointFillExpr), so the data
        // never changes under a palette switch.
        expect('fill' in p).toBe(false)
        expect('opacity' in p).toBe(false)
        expect('letter' in p).toBe(false)
    }
    // No palette reaches the builder at all.
    expect(buildMapData.length).toBe(2)
})

test('the basic map is uniform and judgment-free (P6): no bucket, no ring', () => {
    const scored = row({ o: { grade_score: 60, trend_delta: -9 } })
    const plain = row()
    const data = buildMapData([scored, plain], true)
    for (const pid of [scored.permit_id, plain.permit_id]) {
        const p = props(data, pid)
        // All zero: the layer's fallback fill, the basic map's uniform gray.
        expect(inputsOf(p)).toEqual({ ...ZERO, stack: 1 })
        expect(p.declining).toBe(false)          // the fixture's -9 delta stays mute here
    }
})

test('the declining ring bakes only on a graded dot, banded past 5 (CRP-M2; band M1b)', () => {
    const declining = row({ o: { grade_score: 78, trend_delta: -9 } })
    const edgeSix = row({ o: { grade_score: 78, trend_delta: -6 } })
    // The band is STRICT: a −5 grade-to-grade drop ships in the delta but
    // does not mark (exporter TREND_DECLINE_BAND, mirrored here).
    const edgeFive = row({ o: { grade_score: 78, trend_delta: -5 } })
    const steady = row({ o: { grade_score: 78, trend_delta: 0 } })
    const improving = row({ o: { grade_score: 78, trend_delta: 6 } })
    const noTrend = row({ o: { grade_score: 78 } })
    const unscored = row({ o: { grade_score: null, trend_delta: -9 } })
    const closed = row({ status: 'Business Closed', o: { grade_score: 70, trend_delta: -12 } })
    const data = buildMapData(
        [declining, edgeSix, edgeFive, steady, improving, noTrend, unscored, closed], false)

    const d = props(data, declining.permit_id)
    expect(d.declining).toBe(true)
    expect(d.nC).toBe(1)                         // the ring never rides an ungraded dot
    expect(props(data, edgeSix.permit_id).declining).toBe(true)
    for (const r of [edgeFive, steady, improving, noTrend, unscored, closed]) {
        expect(props(data, r.permit_id).declining).toBe(false)
    }
})

test('same-point rows collapse into one neutral stack feature', () => {
    const a = row({ lat: 37.541234, lon: -77.435678, o: { grade_score: 95 } })
    const b = row({ lat: 37.541234, lon: -77.435678, o: { grade_score: 55 } })
    const c = row({ lat: 37.541234, lon: -77.435678 })
    const lone = row({ lat: 37.6, lon: -77.5 })
    const data = buildMapData([a, b, c, lone], false)

    expect(data.geojson.features).toHaveLength(2)
    const stack = data.geojson.features.find((f) => f.properties.kind === 'stack')
    expect(stack).toBeTruthy()
    const sp = stack?.properties as StackProps
    expect(sp.stack).toBe(3)
    expect(sp.skey).toBe(stackKey(37.541234, -77.435678))
    // Neutral: a count bubble carries no judgment channel of its own.
    expect('declining' in sp).toBe(false)
    expect('pid' in sp).toBe(false)
    // The members stay reachable for the M2 fan-out.
    expect(data.stacks.get(sp.skey)).toHaveLength(3)
})

test('every lone dot carries its cluster inputs: stack 1 + the one bucket it wears (CRP-M6)', () => {
    const a = row({ o: { grade_score: 92 } })
    const c = row({ o: { grade_score: 75 } })
    const f = row({ o: { grade_score: 40 } })
    const newly = row({ o: { grade_score: null, new: 1 } })
    const unscored = row({ o: { grade_score: null, new: 0 } })
    const closed = row({ status: 'Business Closed', o: { grade_score: 88 } })
    const data = buildMapData([a, c, f, newly, unscored, closed], false)

    expect(inputsOf(props(data, a.permit_id))).toEqual({ ...ZERO, stack: 1, nA: 1 })
    expect(inputsOf(props(data, c.permit_id))).toEqual({ ...ZERO, stack: 1, nC: 1 })
    expect(inputsOf(props(data, f.permit_id))).toEqual({ ...ZERO, stack: 1, nF: 1 })
    expect(inputsOf(props(data, newly.permit_id))).toEqual({ ...ZERO, stack: 1, nNew: 1 })
    expect(inputsOf(props(data, unscored.permit_id))).toEqual({ ...ZERO, stack: 1, nNone: 1 })
    // Closed counts in ITS bucket only — a shuttered grade is not an A.
    expect(inputsOf(props(data, closed.permit_id))).toEqual({ ...ZERO, stack: 1, nClosed: 1 })
})

test('a stack sums its members into the buckets and counts every one of them', () => {
    const a = row({ lat: 37.51, lon: -77.41, o: { grade_score: 90 } })
    const c = row({ lat: 37.51, lon: -77.41, o: { grade_score: 70 } })
    const closed = row({ lat: 37.51, lon: -77.41, status: 'Business Closed', o: { grade_score: 50 } })
    const data = buildMapData([a, c, closed], false)
    const stack = data.geojson.features
        .find((f) => f.properties.kind === 'stack')?.properties as StackProps
    expect(inputsOf(stack)).toEqual({ ...ZERO, stack: 3, nA: 1, nC: 1, nClosed: 1 })
    // The ring always totals the number in the hole.
    expect(BUCKET_KEYS.reduce((n, key) => n + stack[key], 0)).toBe(stack.stack)
})

test('the basic map zeroes every bucket — nothing to break down (P6)', () => {
    const scored = row({ o: { grade_score: 90, trend_delta: -9 } })
    const b = row({ lat: 37.51, lon: -77.41, o: { grade_score: 85 } })
    const d = row({ lat: 37.51, lon: -77.41, o: { grade_score: 62 } })
    const data = buildMapData([scored, b, d], true)
    expect(inputsOf(props(data, scored.permit_id))).toEqual({ ...ZERO, stack: 1 })
    const stack = data.geojson.features
        .find((f) => f.properties.kind === 'stack')?.properties as StackProps
    expect(inputsOf(stack)).toEqual({ ...ZERO, stack: 2 })
})

test('the source sums `sum` over stacks and every bucket over itself', () => {
    const spec = clusterProperties()
    expect(spec.sum).toEqual(['+', ['get', 'stack']])
    for (const key of BUCKET_KEYS) expect(spec[key]).toEqual(['+', ['get', key]])
    expect(Object.keys(spec)).toHaveLength(BUCKET_KEYS.length + 1)
})

test('rows without coordinates draw nothing', () => {
    const nowhere = row({ lat: Number.NaN, lon: Number.NaN })
    const data = buildMapData([nowhere], false)
    expect(data.geojson.features).toHaveLength(0)
})
