/**
 * The §6.2 marker grammar as source data (CRVa-M0) — `buildMapData` is the
 * pure half of the MapView island, so the grammar pins without MapLibre:
 *
 *   · fill = grade color · NEW blue · closed gray+dim · unscored gray ·
 *     basic-map uniform gray (P6: the basic map carries no judgment);
 *   · the LETTER rides only graded, active facilities (§6.0);
 *   · same-point rows collapse into ONE stack feature carrying its member
 *     count and NO judgment properties (neutral count bubbles);
 *   · rows without coordinates draw nothing.
 *
 * (The 2026-08-30 cluster accumulators and the declining-ring property
 * were withdrawn on Cannon's live review the same day — CleanPlateVA
 * #174/#175 hold the machinery if either returns. The declining form
 * returned as the CRP-M1 ↓ suffix, then became the CRP-M2 red ring — the
 * bake is the same for both: `declining` is true only where a letter
 * rides; the ring itself has no zoom gate.)
 */
import { expect, test } from 'vitest'
import { GRADE_COLORS, CLOSED_COLOR, LITE_MARKER_COLOR, NEW_COLOR } from '../../app/constants'
import { buildMapData, stackKey } from '../../app/mapData'
import type { PointProps, StackProps } from '../../app/mapData'
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

test('the full-tier fills: grade color, NEW blue, unscored gray, closed gray+dim', () => {
    const graded = row({ o: { grade_score: 93 } })
    const newly = row({ o: { grade_score: null, new: 1 } })
    const unscored = row({ o: { grade_score: null, new: 0 } })
    const closed = row({ status: 'Business Closed', o: { grade_score: 88 } })
    const data = buildMapData([graded, newly, unscored, closed], false)

    const g = props(data, graded.permit_id)
    expect(g.fill).toBe(GRADE_COLORS.A)
    expect(g.letter).toBe('A')
    expect(g.opacity).toBe(0.88)

    const n = props(data, newly.permit_id)
    expect(n.fill).toBe(NEW_COLOR)
    expect(n.letter).toBe('')                    // blue is NEW's alone; no letter rides

    const u = props(data, unscored.permit_id)
    expect(u.fill).toBe(GRADE_COLORS.none)
    expect(u.letter).toBe('')

    const c = props(data, closed.permit_id)
    expect(c.fill).toBe(CLOSED_COLOR)
    expect(c.opacity).toBe(0.42)                 // dimmed: not currently open
    expect(c.letter).toBe('')                    // a shuttered grade is not a fact today
})

test('the basic map is uniform and judgment-free (P6)', () => {
    const scored = row({ o: { grade_score: 60, trend_delta: -9 } })
    const plain = row()
    const data = buildMapData([scored, plain], true)
    for (const pid of [scored.permit_id, plain.permit_id]) {
        const p = props(data, pid)
        expect(p.fill).toBe(LITE_MARKER_COLOR)
        expect(p.letter).toBe('')
        expect(p.opacity).toBe(0.88)
        expect(p.declining).toBe(false)          // the fixture's -9 delta stays mute here
    }
})

test('the declining ring bakes only where a letter rides, banded past 5 (CRP-M2; band M1b)', () => {
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
    expect(d.letter).toBe('C')                   // the ring never rides alone
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
    // Neutral: a count bubble carries no fill/letter/judgment channels.
    expect('fill' in sp).toBe(false)
    expect('letter' in sp).toBe(false)
    expect('declining' in sp).toBe(false)
    // The members stay reachable for the M2 fan-out.
    expect(data.stacks.get(sp.skey)).toHaveLength(3)
})

test('rows without coordinates draw nothing', () => {
    const nowhere = row({ lat: Number.NaN, lon: Number.NaN })
    const data = buildMapData([nowhere], false)
    expect(data.geojson.features).toHaveLength(0)
})
