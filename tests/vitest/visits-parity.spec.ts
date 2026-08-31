/**
 * visits ↔ detail parity (§7 — the hover-card suite's behavioral half,
 * CRVa-M2): the overlay's compact `visits` column decodes into the SAME
 * series shape `buildScopeSeries` builds from a real inspection history,
 * and the ONE trend instrument lays both out IDENTICALLY — the hover
 * card cannot drift from the panel by construction. Ported from
 * tests/hover-card.test.mjs (the old byte-identical-SVG pin becomes a
 * layout-equality pin; the popup-geometry half retired with the splitter
 * world it measured).
 */
import { expect, test } from 'vitest'
import {
    buildScopeSeries, facilityPresentation, focusedOutcomePresentation,
    isoFromYmd, narrativeVerdictPresentation, visitsOf,
} from '../../app/data/presentation'
import { trendLayout } from '../../app/trend'
import type { Inspection, VisitEntry } from '../../app/data/types'

const row = (visits: VisitEntry[] | unknown = undefined) => ({
    permit_id: 'L-1', name: 'Lakeside Grill', address: '6920 Lakeside Ave',
    city: 'Richmond', zip: '23228', lat: 37.6, lon: -77.47, loc: 0,
    o: visits === undefined ? {} : { visits: visits as VisitEntry[] },
})

const detailRows = (count: number, out = 0) =>
    Array.from({ length: count }, (_, index) => ({
        item: index + 1,
        disposition: index < out ? 'OUT' : 'IN',
        compliant: index >= out,
        violation: index < out,
        is_sentinel: false,
    })) as unknown as Inspection['checklist']

test('overlay dates decode from yyyymmdd', () => {
    expect(isoFromYmd(20260204)).toBe('2026-02-04')
    expect(isoFromYmd(0)).toBeNull()
    expect(isoFromYmd(null)).toBeNull()
})

test('visitsOf decodes every kind into the series shape buildScopeSeries builds', () => {
    // A history that exercises every mark family, as the exporter encodes
    // it (oldest-first): a tick, a scored broad, an unscored broad (x-slot
    // only), a focused ratio-known, a focused tick, three blanket
    // verdicts, an items verdict, and an unknown verdict code → tick.
    const visits: VisitEntry[] = [
        [0, 20240101],
        [1, 20240301, 88],
        [1, 20240401],
        [2, 20240501, 1, 4],
        [2, 20240601],
        [3, 20240701, 1],
        [3, 20240801, 2],
        [3, 20240901, 3],
        [3, 20241001, 4, 2, 1],
        [3, 20241101, 9],
    ]
    const series = visitsOf(row(visits))
    expect(series.events).toHaveLength(10)                 // every visit is an x-slot
    expect(series.events.map((e) => e.inspection.date)).toEqual([
        '2024-01-01', '2024-03-01', '2024-04-01', '2024-05-01', '2024-06-01',
        '2024-07-01', '2024-08-01', '2024-09-01', '2024-10-01', '2024-11-01',
    ])
    expect(series.events.map((e) => e.historyIndex)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(series.broad.map((e) => [e.index, e.presentation.score])).toEqual([[1, 88]])
    expect(series.events[2]?.presentation.scope).toBe('broad')       // the unscored broad…
    expect(series.events[2]?.presentation.gradeEligible).toBe(false) // …is a slot with no mark
    expect(series.focused.map((e) => e.index)).toEqual([3, 4])
    const known = focusedOutcomePresentation(series.events[3]?.presentation)
    expect([known.ratioKnown, known.out, known.total, known.tone]).toEqual([true, 1, 4, 'good'])
    expect(focusedOutcomePresentation(series.events[4]?.presentation).ratioKnown).toBe(false)
    expect(series.unknown.map((e) => e.index)).toEqual([0, 5, 6, 7, 8, 9])
    const verdicts = series.unknown.map((e) => narrativeVerdictPresentation(e.inspection))
    expect(verdicts[0]).toBeNull()                          // the plain tick
    expect(verdicts.slice(1, 4).map((v) => [v?.verdict, v?.height, v?.glyph, v?.tone, v?.count])).toEqual([
        ['all_corrected', 100, '✓', 'clear', null],
        ['priority_corrected', 85, '✓', 'good', null],
        ['none_corrected', 0, '✗', 'severe', null],
    ])
    expect([verdicts[4]?.verdict, verdicts[4]?.height, verdicts[4]?.glyph, verdicts[4]?.tone, verdicts[4]?.count])
        .toEqual(['items', 67, '✓', 'watch', 2])
    expect(verdicts[5]).toBeNull()                          // unknown code → tick
    // Absent, malformed, or non-array visits are simply an empty series.
    expect(visitsOf(row()).events).toHaveLength(0)
    expect(visitsOf({ o: { visits: 'nope' as unknown as VisitEntry[] } }).events).toHaveLength(0)
    expect(visitsOf({ o: { visits: [null, 7] as unknown as VisitEntry[] } }).events).toHaveLength(2) // slots, both ticks
})

test('the same history through the detail and through visits lays out ONE plot — every kind', () => {
    // The detail-side rows the visits above encode; the LAYOUTS must agree.
    const inspections: Inspection[] = [
        { date: '2024-11-01', checklist_present: false, checklist: [],
            adjudication: { status: 'adjudicated', verdict: 'partial' } },
        { date: '2024-10-01', checklist_present: false, checklist: [],
            adjudication: { status: 'adjudicated', verdict: 'items', items: { 12: 'IN', 23: 'OUT', 30: 'IN' } } },
        { date: '2024-09-01', checklist_present: false, checklist: [],
            adjudication: { status: 'adjudicated', verdict: 'none_corrected' } },
        { date: '2024-08-01', checklist_present: false, checklist: [],
            adjudication: { status: 'adjudicated', verdict: 'priority_corrected' } },
        { date: '2024-07-01', checklist_present: false, checklist: [],
            adjudication: { status: 'adjudicated', verdict: 'all_corrected' } },
        { date: '2024-06-01', scope: 'focused', form_item_count: 3, applicable_item_count: 3, checklist: [] },
        { date: '2024-05-01', score: null, checklist_present: true, checklist: detailRows(4, 1) },
        { date: '2024-04-01', score: null, checklist_present: true, checklist: detailRows(30) },
        { date: '2024-03-01', score: 88, checklist_present: true, checklist: detailRows(30, 2) },
        { date: '2024-01-01', checklist_present: false, checklist: [] },
    ]
    const visits: VisitEntry[] = [
        [0, 20240101], [1, 20240301, 88], [1, 20240401], [2, 20240501, 1, 4], [2, 20240601],
        [3, 20240701, 1], [3, 20240801, 2], [3, 20240901, 3], [3, 20241001, 4, 2, 1], [3, 20241101, 9],
    ]
    for (const variant of ['panel', 'card'] as const) {
        const fromDetail = trendLayout(buildScopeSeries(inspections), variant)
        const fromVisits = trendLayout(visitsOf(row(visits)), variant)
        expect(fromVisits).toEqual(fromDetail)
    }
    // The counted items verdict and the focused ratio both survive as
    // the marks' always-on labels (the ' OUT' suffix drops there).
    const layout = trendLayout(visitsOf(row(visits)), 'panel')
    expect(layout.marks.map((m) => m.label)).toContain('✓2')
    expect(layout.marks.map((m) => m.label)).toContain('1/4')
})

test('a Contract V4 roster row keeps its last-visit date and grade off the overlay', () => {
    const fp = facilityPresentation({
        ...row([[1, 20260204, 20], [2, 20260402, 3, 3]]),
        o: {
            grade_score: 20, trend_delta: -5, base_yyyymmdd: 20260204,
            latest_yyyymmdd: 20260402, latest_scope_code: 2, latest_out: 3,
            latest_items: 3, visits: [[1, 20260204, 20], [2, 20260402, 3, 3]],
        },
    })
    expect(fp.latestDate).toBe('2026-04-02')
    expect(fp.latest.scope).toBe('focused')
    expect([fp.latest.out, fp.latest.count]).toEqual([3, 3])
    expect(fp.grade?.letter).toBe('F')
    expect(fp.grade?.baseDate).toBe('2026-02-04')
    expect(fp.trendDelta).toBe(-5)
    expect(fp.declining).toBe(true)
    expect(fp.trend).toEqual([])          // no series rides the roster under V4
})
