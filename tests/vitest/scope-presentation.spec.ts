/**
 * Scope + presentation contracts (§7 pure-derivation port, CRVa-M2) — the
 * behavioral half of tests/scope-presentation.test.mjs against the ported
 * presentation layer: the 20-item scope gate, form breadth vs applicable
 * denominator, focused outcome tones (never fabricating a clean result),
 * the facility pairing (detail shape and the Contract V4 overlay shape),
 * the scope series, and the grade block. The old suite's markup/CSS pins
 * are superseded by the CRV component suites (§7 dispositions).
 */
import { expect, test } from 'vitest'
import {
    buildScopeSeries, facilityPresentation, focusedOutcomePresentation,
    gradePresentation, inspectionCountsPresentation, inspectionPresentation,
    isNewlyPermitted, narrativeVerdictPresentation,
} from '../../app/data/presentation'
import type { Inspection } from '../../app/data/types'

const checklist = (count: number, out = 0) =>
    Array.from({ length: count }, (_, index) => ({
        item: index + 1,
        disposition: index < out ? 'OUT' : 'IN',
        compliant: index >= out,
        violation: index < out,
        is_sentinel: false,
    })) as unknown as Inspection['checklist']

test('inspection scope changes exactly at 20 distinct numbered form items', () => {
    expect(inspectionPresentation({ checklist: checklist(20), score: 90 }).scope).toBe('broad')
    expect(inspectionPresentation({ checklist: checklist(19), score: 90 }).scope).toBe('focused')
    expect(inspectionPresentation({ checklist: [], checklist_present: true, score: 100 }).scope).toBe('unknown')
    expect(inspectionPresentation({ checklist_present: false, score: 100 }).scope).toBe('unknown')
})

test('form breadth is separate from the applicable IN/OUT denominator', () => {
    const rows = [
        { item: 1, disposition: 'IN', compliant: true },
        { item: 1, disposition: 'OUT', violation: true },
        { item: 2, disposition: 'IN', compliant: true },
        { item: 3, disposition: 'N/A' },
        { item: 4, disposition: 'N/O' },
        { item: 99, disposition: 'IN', compliant: true, is_sentinel: true },
        { item: null, disposition: 'IN', compliant: true },
    ] as unknown as Inspection['checklist']
    const view = inspectionPresentation({ checklist: rows, score: 0 })
    expect(view.formCount).toBe(4)
    expect(view.count).toBe(2)
    expect(view.out).toBe(1)
    expect(view.scope).toBe('focused')
    expect(view.score).toBe(0)
    expect('grade' in view).toBe(false) // an inspection never carries a letter
})

test('N/A and N/O can prove form breadth without becoming compliant passes', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
        item: index + 1,
        disposition: index % 2 ? 'N/A' : 'N/O',
        compliant: true, // the exact stale pre-M3 portal-token projection
        is_sentinel: false,
    })) as unknown as Inspection['checklist']
    const view = inspectionPresentation({ checklist: rows, score: 100 })
    expect(view.scope).toBe('broad')
    expect(view.formCount).toBe(20)
    expect(view.count).toBe(0)
    expect(view.compliant).toBe(0)
})

test('focused X/Y outcomes reserve green for zero OUT and escalate by compliance', () => {
    const outcome = (count: number, out: number) => focusedOutcomePresentation(
        inspectionPresentation({ checklist: checklist(count, out), score: 100 }),
    )
    expect([outcome(2, 0).label, outcome(2, 0).tone]).toEqual(['0/2 OUT', 'clear'])
    expect(outcome(4, 1).tone).toBe('good')
    expect(outcome(3, 1).tone).toBe('watch')
    expect(outcome(3, 2).tone).toBe('warning')
    expect([outcome(4, 4).label, outcome(4, 4).tone]).toEqual(['4/4 OUT', 'severe'])
})

test('focused outcomes never fabricate a clean result from missing or inconsistent counts', () => {
    expect([
        focusedOutcomePresentation({ count: 2, out: null }).label,
        focusedOutcomePresentation({ count: 2, out: null }).tone,
    ]).toEqual(['?/2 OUT', 'unknown'])
    expect(focusedOutcomePresentation({ count: 3, out: 4 }).tone).toBe('unknown')
})

test('compact row-counted OUT values are never presented as a distinct-item ratio', () => {
    const compact = inspectionPresentation({
        scope: 'focused', applicable_item_count: 3, checklist_out: 4,
        checklist_present: true, score: 52,
    })
    expect(compact.outIsDistinct).toBe(false)
    expect([
        focusedOutcomePresentation(compact).label,
        focusedOutcomePresentation(compact).tone,
    ]).toEqual(['4 OUT markings', 'unknown'])

    const futureDistinct = inspectionPresentation({
        scope: 'focused', applicable_item_count: 3, out_item_count: 2,
        checklist_present: true, score: 68,
    })
    expect(futureDistinct.outIsDistinct).toBe(true)
    expect(focusedOutcomePresentation(futureDistinct).label).toBe('2/3 OUT')
})

test('hybrid detail rows use the exported effective OUT union', () => {
    const view = inspectionPresentation({
        scope: 'focused', form_item_count: 1, applicable_item_count: 1,
        addressed_item_count: 3, out_item_count: 2,
        checklist: [{ item: 22, disposition: 'OUT', violation: true }] as unknown as Inspection['checklist'],
    })
    expect(view.out).toBe(2)
    expect(view.count).toBe(3)
    expect(focusedOutcomePresentation(view).label).toBe('2/3 OUT')
})

test('a broad inspection has a score but never a letter', () => {
    const withScore = inspectionPresentation({
        scope: 'broad', applicable_item_count: 24, score: 81,
    })
    expect(withScore.broadEligible).toBe(true)
    expect(withScore.gradeEligible).toBe(true) // broad + scored: can anchor a grade
    expect('grade' in withScore).toBe(false)   // but carries no letter of its own
    const noScore = inspectionPresentation({
        scope: 'broad', applicable_item_count: 24, score: null,
    })
    expect(noScore.gradeEligible).toBe(false)
})

test('the hard form-count gate wins over contradictory scope and applicable counts', () => {
    expect(inspectionPresentation({ scope: 'broad', form_item_count: 0, applicable_item_count: 20, score: 90 }).scope).toBe('unknown')
    expect(inspectionPresentation({ scope: 'broad', form_item_count: 19, applicable_item_count: 20, score: 90 }).scope).toBe('focused')
    expect(inspectionPresentation({ scope: 'focused', form_item_count: 20, applicable_item_count: 0, score: 90 }).scope).toBe('broad')
    expect(inspectionPresentation({ scope: 'broad', form_item_count: 20, checklist_present: false, score: 90 }).scope).toBe('unknown')
})

test('facility presentation pairs newest event with one assessment and one grade (detail shape)', () => {
    const facility = {
        latest: { scope: 'focused', applicable_item_count: 2, score: 100, checklist_out: 0 },
        latest_assessment: { scope: 'broad', applicable_item_count: 31, score: 68 },
        grade: { score: 68, letter: 'D', base_score: 68, base_letter: 'D', adjusted: false },
    }
    const view = facilityPresentation(facility)
    expect(view.latest.scope).toBe('focused')
    expect(view.latest.score).toBe(100)
    expect(view.assessment?.score).toBe(68)          // the broad record…
    expect(view.assessment && 'grade' in view.assessment).toBe(false)
    expect([view.grade?.score, view.grade?.letter]).toEqual([68, 'D'])
    expect(view.trend).toEqual([])
    expect(view.trendDelta).toBeNull()
    expect(view.declining).toBe(false)
    expect('standing' in view).toBe(false)
})

test('a Contract V4 roster row presents from its overlay: grade, dates, delta, compliance', () => {
    const view = facilityPresentation({
        permit_id: 'P', name: 'Row', lat: 37.5, lon: -77.4, loc: 0,
        o: {
            grade_score: 68, new: 0, trend_delta: -8, latest_yyyymmdd: 20250301,
            base_yyyymmdd: 20250301, latest_scope_code: 1, latest_out: null,
            latest_items: 31, compliance_pct: 90,
        },
    })
    expect([view.grade?.score, view.grade?.letter]).toEqual([68, 'D']) // letter derived, never shipped
    expect(view.grade?.baseDate).toBe('2025-03-01')
    expect(view.latest.scope).toBe('broad')
    expect(view.latest.count).toBe(31)
    expect(view.latest.score).toBeNull()             // no per-visit score rides the roster
    expect(view.latestDate).toBe('2025-03-01')
    expect((view.assessmentRecord as { compliance_rate?: number })?.compliance_rate).toBe(0.9)
    expect(view.trendDelta).toBe(-8)
    expect(view.declining).toBe(true)
    expect(view.trend).toEqual([])
    // The legacy roster `trend` tuple stream is not read even if present
    // (the field is retired, so the type won't even name it — cast on purpose).
    const legacy = facilityPresentation(
        { trend: [['b', 20250101, 68, 31], ['b', 20250301, 61, 30]] } as unknown as Parameters<typeof facilityPresentation>[0])
    expect(legacy.trend).toEqual([])
    expect(legacy.declining).toBe(false)
})

test('facility presentation does not read the retired score_trend field', () => {
    const view = facilityPresentation(
        { score_trend: [61, 68] } as unknown as Parameters<typeof facilityPresentation>[0])
    expect(view.trend).toEqual([])
    expect(view.declining).toBe(false)
})

test('a focused-only facility has no fabricated assessment or grade', () => {
    const view = facilityPresentation({
        latest: { scope: 'focused', applicable_item_count: 2, score: 100 },
        latest_assessment: null,
    })
    expect(view.assessment).toBeNull()
    expect(view.grade).toBeNull()
    expect(view.trend).toEqual([])
})

test('scope series connects only broad scores and preserves focused event positions', () => {
    const inspections: Inspection[] = [
        { inspection_id: 'new-broad', scope: 'broad', applicable_item_count: 30, score: 76 },
        { inspection_id: 'focused', scope: 'focused', applicable_item_count: 2, score: 100 },
        { inspection_id: 'old-broad', scope: 'broad', applicable_item_count: 31, score: 68 },
        { inspection_id: 'unknown', scope: 'unknown', applicable_item_count: null, score: 100 },
    ]
    const series = buildScopeSeries(inspections)
    expect(series.broad.map((e) => e.inspection.inspection_id)).toEqual(['old-broad', 'new-broad'])
    expect(series.broad.map((e) => e.index)).toEqual([1, 3])
    expect(series.focused.map((e) => e.index)).toEqual([2])
    expect(series.unknown.map((e) => e.index)).toEqual([0])
    expect(series.events.map((e) => e.historyIndex)).toEqual([3, 2, 1, 0])
})

test('gradePresentation reads the facility grade block; letters band from the score', () => {
    const view = gradePresentation({
        grade: {
            score: 62, letter: 'D', adjusted: true, base_score: 82, base_letter: 'B',
            base_date: '2025-01-17', followups: 1, followup_date: '2025-07-05',
            restored_items: [], failed_items: [47, 49], cos_items: [],
            new_items: [16], unchecked_items: [5],
            restored_points: 0, extra_points: 11,
        },
    })
    expect(view?.adjusted).toBe(true)
    expect([view?.score, view?.letter, view?.baseScore, view?.baseLetter]).toEqual([62, 'D', 82, 'B'])
    expect(view?.failed).toEqual([47, 49])

    const banded = gradePresentation({ grade: { score: 91, adjusted: false } })
    expect(banded?.letter).toBe('A')
})

test('no grade block means no grade — the assessment never stands in for one', () => {
    const view = facilityPresentation({
        latest: { scope: 'broad', applicable_item_count: 31, score: 68 },
        latest_assessment: { scope: 'broad', applicable_item_count: 31, score: 68 },
    })
    expect(view.grade).toBeNull()
    expect(view.assessment).not.toBeNull()

    const none = facilityPresentation({
        latest: { scope: 'focused', applicable_item_count: 2, score: 100 },
        latest_assessment: null,
    })
    expect(none.grade).toBeNull()
})

test('newly permitted keys off the exporter flag, not merely "no grade"', () => {
    expect(isNewlyPermitted({ newly_permitted: true })).toBe(true)
    expect(isNewlyPermitted({ newly_permitted: false })).toBe(false)
    // "active + no grade" is NOT enough on its own — an unparsed routine
    // with violations must never read as "cleared to open".
    expect(isNewlyPermitted({ status: 'Permitted' })).toBe(false)
    expect(isNewlyPermitted({ status: 'Permitted', grade: { score: 82, letter: 'B' } })).toBe(false)
    expect(isNewlyPermitted({})).toBe(false)
})

// ── narrative verdicts (tests/narrative-verdicts.test.mjs, behavioral) ──

const narrRow = (adjudication?: Inspection['adjudication']): Inspection => ({
    inspection_id: 'N1', date: '2026-04-06', purpose: 'Follow-Up',
    scope: 'unknown', checklist_present: false, score: 100,
    violations: [], adjudication,
})

test('all_corrected reads as a clear ✓ verdict at the r100 line', () => {
    const v = narrativeVerdictPresentation(narrRow({ status: 'adjudicated', verdict: 'all_corrected' }))
    expect([v?.tone, v?.glyph, v?.label, v?.height, v?.count])
        .toEqual(['clear', '✓', 'All violations corrected', 100, null])
})

test('badge counts distinguish targeted credit from a blanket clear', () => {
    const targeted = narrativeVerdictPresentation(narrRow({
        status: 'adjudicated', verdict: 'items', items: { 22: 'IN', 23: 'IN' },
    }))
    expect([targeted?.glyph, targeted?.count]).toEqual(['✓', 2])
    expect(targeted?.detail).toMatch(/2 items corrected/)
    expect(targeted?.detail).toMatch(/keeps its full deduction/)

    const mixed = narrativeVerdictPresentation(narrRow({
        status: 'adjudicated', verdict: 'items', items: { 8: 'IN', 14: 'OUT' },
    }))
    expect([mixed?.glyph, mixed?.count]).toEqual(['✓', 1])
    expect(mixed?.detail).toMatch(/1 item corrected, 1 still out/)

    const allOut = narrativeVerdictPresentation(narrRow({
        status: 'adjudicated', verdict: 'items', items: { 14: 'OUT', 16: 'OUT' },
    }))
    expect([allOut?.glyph, allOut?.count]).toEqual(['✗', 2])
    expect(allOut?.detail).toMatch(/2 items still out/)

    expect(narrativeVerdictPresentation(
        narrRow({ status: 'adjudicated', verdict: 'priority_corrected' }))?.count).toBeNull()
})

test('none_corrected reads as a severe ✗ verdict at r0; priority sits high', () => {
    const none = narrativeVerdictPresentation(narrRow({ status: 'adjudicated', verdict: 'none_corrected' }))
    expect([none?.tone, none?.glyph, none?.label, none?.height])
        .toEqual(['severe', '✗', 'Violations not corrected', 0])
    const priority = narrativeVerdictPresentation(narrRow({ status: 'adjudicated', verdict: 'priority_corrected' }))
    expect([priority?.tone, priority?.label, priority?.height])
        .toEqual(['good', 'Priority violations corrected', 85])
})

test('items verdicts list INs sorted, downgrade tone on OUTs, plot the IN-share', () => {
    const sorted = narrativeVerdictPresentation(narrRow({
        status: 'adjudicated', verdict: 'items',
        items: { 28: 'IN', 3: 'IN', 51: 'IN', 41: 'IN' },
    }))
    expect(sorted?.label).toBe('Items #3, #28, #41, #51 corrected')
    expect([sorted?.tone, sorted?.height]).toEqual(['good', 100])

    const mixed = narrativeVerdictPresentation(narrRow({
        status: 'adjudicated', verdict: 'items', items: { 8: 'IN', 14: 'OUT' },
    }))
    expect(mixed?.tone).toBe('watch')
    expect(mixed?.label).toMatch(/#8 corrected · #14 still out/)
    expect(mixed?.height).toBe(50)

    const allOut = narrativeVerdictPresentation(narrRow({
        status: 'adjudicated', verdict: 'items', items: { 14: 'OUT' },
    }))
    expect([allOut?.tone, allOut?.glyph, allOut?.height]).toEqual(['severe', '✗', 0])
})

test('non-actionable and malformed adjudication blocks render nothing', () => {
    expect(narrativeVerdictPresentation(narrRow(undefined))).toBeNull()
    expect(narrativeVerdictPresentation(narrRow({ status: 'needs_llm', verdict: undefined }))).toBeNull()
    expect(narrativeVerdictPresentation(narrRow({ status: 'abstain' }))).toBeNull()
    expect(narrativeVerdictPresentation(narrRow({ status: 'adjudicated', verdict: 'items', items: {} }))).toBeNull()
    expect(narrativeVerdictPresentation(narrRow({ status: 'adjudicated', verdict: 'unrecognized_future' }))).toBeNull()
    expect(narrativeVerdictPresentation(null)).toBeNull()
})

test('gradePresentation carries narrative provenance and defaults it for pre-arc payloads', () => {
    const g = gradePresentation({
        grade: {
            score: 86, letter: 'B', base_score: 60, base_letter: 'D',
            base_date: '2026-02-09', adjusted: true, followups: 1,
            followup_date: '2026-04-06',
            narrative_followups: 1, narrative_items: [8, 21],
            restored_items: [8, 21], failed_items: [], cos_items: [],
            new_items: [], unchecked_items: [],
            restored_points: 26.0, extra_points: 0,
        },
    })
    expect(g?.narrativeFollowups).toBe(1)
    expect(g?.narrativeItems).toEqual([8, 21])

    const preArc = gradePresentation({
        grade: {
            score: 92, letter: 'A', base_score: 92, base_letter: 'A',
            base_date: '2026-01-01', adjusted: false, followups: 0,
        },
    })
    expect(preArc?.narrativeFollowups).toBe(0)
    expect(preArc?.narrativeItems).toEqual([])
})

// ── inspection counts (tests/inspection-counts.test.mjs, behavioral) ────

test('violations split into risk-factor (item ≤29) and retail-practice (item ≥30)', () => {
    const c = inspectionCountsPresentation({
        checklist: checklist(20), score: 80,
        violations: [{ item: 3 }, { item: 15 }, { item: 28 }, { item: 35 }, { item: 43 }, { item: 47 }],
    })
    expect([c.n, c.rf, c.grp, c.show]).toEqual([6, 3, 3, true])
})

test('item-less, sentinel, and item >29 rows all count as retail practice', () => {
    const c = inspectionCountsPresentation({
        checklist: checklist(20), score: 70,
        violations: [{ item: null }, { item: 99 }, { item: 30 }, { item: 1 }],
    })
    expect([c.n, c.rf, c.grp]).toEqual([4, 1, 3])
})

test('scope-unknown with zero recorded violations suppresses the badge', () => {
    // a design decision (2026-07-22): a green "0 violations" on an unknown
    // checklist breadth reads as "verified clean" — do not loosen this.
    const c = inspectionCountsPresentation({ checklist_present: false, score: 100, violations: [] })
    expect([c.n, c.show]).toEqual([0, false])
})

test('scope-unknown WITH violations still shows the badge', () => {
    const c = inspectionCountsPresentation({
        checklist_present: false, score: 90, violations: [{ item: 5 }, { item: 40 }],
    })
    expect([c.n, c.rf, c.grp, c.show]).toEqual([2, 1, 1, true])
})

test('clean broad and clean focused inspections keep an honest, shown zero', () => {
    expect(inspectionCountsPresentation({ checklist: checklist(20), score: 100, violations: [] }).show).toBe(true)
    expect(inspectionCountsPresentation({ checklist: checklist(5), score: 100, violations: [] }).show).toBe(true)
})
