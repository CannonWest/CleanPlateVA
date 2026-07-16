import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('../public/static/js/foodDashboard.js', import.meta.url),
    'utf8',
);
const dashboard = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const checklist = (count, out = 0) => Array.from({ length: count }, (_, index) => ({
    item: index + 1,
    disposition: index < out ? 'OUT' : 'IN',
    compliant: index >= out,
    violation: index < out,
    is_sentinel: false,
}));

test('inspection scope changes exactly at 20 distinct applicable code items', () => {
    const { inspectionPresentation } = dashboard;
    assert.equal(inspectionPresentation({ checklist: checklist(20), score: 90 }).scope, 'broad');
    assert.equal(inspectionPresentation({ checklist: checklist(19), score: 90 }).scope, 'focused');
    assert.equal(inspectionPresentation({ checklist: [], checklist_present: true, score: 100 }).scope, 'unknown');
    assert.equal(inspectionPresentation({ checklist_present: false, score: 100 }).scope, 'unknown');
});

test('duplicates, non-applicable rows, missing IDs, and item 99 do not inflate scope', () => {
    const rows = [
        { item: 1, disposition: 'IN', compliant: true },
        { item: 1, disposition: 'OUT', violation: true },
        { item: 2, disposition: 'IN', compliant: true },
        { item: 3, disposition: 'N/A' },
        { item: 4, disposition: 'N/O' },
        { item: 99, disposition: 'IN', compliant: true, is_sentinel: true },
        { item: null, disposition: 'IN', compliant: true },
    ];
    const view = dashboard.inspectionPresentation({ checklist: rows, score: 0 });
    assert.equal(view.count, 2);
    assert.equal(view.out, 1);
    assert.equal(view.scope, 'focused');
    assert.equal(view.score, 0);
    assert.equal('grade' in view, false);   // an inspection never carries a letter
});

test('focused X/Y outcomes reserve green for zero OUT and escalate by compliance', () => {
    const { focusedOutcomePresentation, inspectionPresentation } = dashboard;
    const outcome = (count, out) => focusedOutcomePresentation(
        inspectionPresentation({ checklist: checklist(count, out), score: 100 }),
    );

    assert.deepEqual(
        [outcome(2, 0).label, outcome(2, 0).tone],
        ['0/2 OUT', 'clear'],
    );
    assert.equal(outcome(4, 1).tone, 'good');
    assert.equal(outcome(3, 1).tone, 'watch');
    assert.equal(outcome(3, 2).tone, 'warning');
    assert.deepEqual(
        [outcome(4, 4).label, outcome(4, 4).tone],
        ['4/4 OUT', 'severe'],
    );
});

test('focused outcomes never fabricate a clean result from missing or inconsistent counts', () => {
    const { focusedOutcomePresentation } = dashboard;
    assert.deepEqual(
        [focusedOutcomePresentation({ count: 2, out: null }).label,
            focusedOutcomePresentation({ count: 2, out: null }).tone],
        ['?/2 OUT', 'unknown'],
    );
    assert.equal(focusedOutcomePresentation({ count: 3, out: 4 }).tone, 'unknown');
});

test('compact row-counted OUT values are never presented as a distinct-item ratio', () => {
    const compact = dashboard.inspectionPresentation({
        scope: 'focused', applicable_item_count: 3, checklist_out: 4,
        checklist_present: true, score: 52,
    });
    assert.equal(compact.outIsDistinct, false);
    assert.deepEqual(
        [dashboard.focusedOutcomePresentation(compact).label,
            dashboard.focusedOutcomePresentation(compact).tone],
        ['4 OUT markings', 'unknown'],
    );

    const futureDistinct = dashboard.inspectionPresentation({
        scope: 'focused', applicable_item_count: 3, out_item_count: 2,
        checklist_present: true, score: 68,
    });
    assert.equal(futureDistinct.outIsDistinct, true);
    assert.equal(dashboard.focusedOutcomePresentation(futureDistinct).label, '2/3 OUT');
});

test('focused history renders one colored X/Y OUT signal', () => {
    const context = {
        _disposSets: dashboard.FoodDashboard.prototype._disposSets,
        _renderChecklist: () => '',
        _renderTemps: () => '',
    };
    const html = dashboard.FoodDashboard.prototype._renderInspection.call(context, {
        date: '2024-11-12', insp_type: 'Full Service Restaurant', purpose: 'Follow-Up',
        score: 100, checklist: checklist(2), checklist_present: true,
        checklist_summary: { compliance_rate: 1, compliant: 2, out: 0 },
        violations: [],
    }, false);

    assert.match(html, /food-outcome-clear/);
    assert.match(html, />0\/2<\/span><small aria-hidden="true">OUT/);
    assert.match(html, /role="img"/);
    assert.match(html, /aria-label="0 of 2 focused items marked OUT; 100% in compliance"/);
    assert.match(html, />Focused<\/span>/);
    assert.doesNotMatch(html, /Focused · 2 items/);
    assert.doesNotMatch(html, /food-insp-compliance/);
});

test('focused compliance bar uses the same distinct-item X/Y outcome', () => {
    const html = dashboard.FoodDashboard.prototype._complianceBar.call({}, {
        compliance_rate: 0.75, compliant: 3, out: 1,
    }, { scope: 'focused', count: 3, out: 2 });
    assert.match(html, /33% — 1 of 3/);
    assert.match(html, /distinct applicable numbered items/);
    assert.doesNotMatch(html, /75%/);
    assert.equal(dashboard.FoodDashboard.prototype._complianceBar.call({}, {
        compliance_rate: 0.75, compliant: 3, out: 1,
    }, { scope: 'focused', count: 3, out: null }), '');
});

test('an inspection has a score but never a letter', () => {
    const withScore = dashboard.inspectionPresentation({
        scope: 'broad', applicable_item_count: 24, score: 81,
    });
    assert.equal(withScore.broadEligible, true);
    assert.equal(withScore.gradeEligible, true);   // broad + scored: can anchor a grade
    assert.equal('grade' in withScore, false);     // but carries no letter of its own
    const noScore = dashboard.inspectionPresentation({
        scope: 'broad', applicable_item_count: 24, score: null,
    });
    assert.equal(noScore.gradeEligible, false);
});

test('the hard count gate wins over contradictory scope labels', () => {
    const { inspectionPresentation } = dashboard;
    assert.equal(inspectionPresentation({ scope: 'broad', applicable_item_count: 0, score: 90 }).scope, 'unknown');
    assert.equal(inspectionPresentation({ scope: 'broad', applicable_item_count: 19, score: 90 }).scope, 'focused');
    assert.equal(inspectionPresentation({ scope: 'focused', applicable_item_count: 20, score: 90 }).scope, 'broad');
    assert.equal(inspectionPresentation({ scope: 'broad', applicable_item_count: 20, checklist_present: false, score: 90 }).scope, 'unknown');
});

test('facility presentation pairs newest event with one assessment, one grade, one trend', () => {
    const facility = {
        latest: { scope: 'focused', applicable_item_count: 2, score: 100, checklist_out: 0 },
        latest_assessment: { scope: 'broad', applicable_item_count: 31, score: 68 },
        grade: { score: 68, letter: 'D', base_score: 68, base_letter: 'D', adjusted: false },
        score_trend: [68, 76, 64],
    };
    const view = dashboard.facilityPresentation(facility);
    assert.equal(view.latest.scope, 'focused');
    assert.equal(view.latest.score, 100);
    assert.equal(view.assessment.score, 68);          // the broad record...
    assert.equal('grade' in view.assessment, false);  // ...with no letter of its own
    assert.deepEqual([view.grade.score, view.grade.letter], [68, 'D']);  // the letter is the facility's
    assert.deepEqual(view.trend, [68, 76, 64]);
    assert.equal(view.declining, true);
    assert.equal('standing' in view, false);
});

test('a focused-only facility has no fabricated assessment or grade', () => {
    const view = dashboard.facilityPresentation({
        latest: { scope: 'focused', applicable_item_count: 2, score: 100 },
        latest_assessment: null,
        score_trend: [],
    });
    assert.equal(view.assessment, null);
    assert.equal(view.grade, null);
    assert.deepEqual(view.trend, []);
});

test('an unadjusted grade leads the marker tooltip; broad compliance discloses below', () => {
    const facility = {
        name: 'Example', status: 'Permitted',
        latest: {
            scope: 'focused', applicable_item_count: 2, score: 100,
            checklist_out: 0, date: '2026-06-05', checklist_present: true,
        },
        latest_assessment: {
            scope: 'broad', applicable_item_count: 31, score: 58,
            compliance_rate: 0.7667, date: '2026-05-21',
        },
        grade: { score: 58, letter: 'F', base_score: 58, base_letter: 'F', adjusted: false },
        score_trend: [58, 54],
    };
    const html = dashboard.FoodDashboard.prototype._tooltipHTML.call({
        _mode: 'full',
        _isActive: () => true,
    }, facility);
    assert.match(html, /Latest: focused inspection/);
    assert.match(html, /Grade F · 58/);
    assert.doesNotMatch(html, /Grade F · 58 · after/);   // unadjusted: one line, no follow-up
    assert.match(html, /Broad compliance 77%/);
});

test('scope series connects only broad scores and preserves focused event positions', () => {
    const inspections = [
        { inspection_id: 'new-broad', scope: 'broad', applicable_item_count: 30, score: 76 },
        { inspection_id: 'focused', scope: 'focused', applicable_item_count: 2, score: 100 },
        { inspection_id: 'old-broad', scope: 'broad', applicable_item_count: 31, score: 68 },
        { inspection_id: 'unknown', scope: 'unknown', applicable_item_count: null, score: 100 },
    ];
    const series = dashboard.buildScopeSeries(inspections);
    assert.deepEqual(series.broad.map((event) => event.inspection.inspection_id), ['old-broad', 'new-broad']);
    assert.deepEqual(series.broad.map((event) => event.index), [1, 3]);
    assert.deepEqual(series.focused.map((event) => event.index), [2]);
    assert.deepEqual(series.unknown.map((event) => event.index), [0]);
});

test('detail copy does not claim a limited report is a clean full checklist', () => {
    assert.doesNotMatch(source, /clean report/i);
    assert.doesNotMatch(source, /Full food-code checklist/i);
    assert.match(source, /No violations recorded in this focused/);
    assert.match(source, /focused re-check — it adjusts the facility grade/);
    assert.match(source, /broad line · ◇ focused raw/);
    assert.match(source, /Broad scores oldest to newest/);
    assert.match(source, /Broad compliance/);
});

test('gradePresentation reads the facility grade block; letters band from the score', () => {
    const view = dashboard.gradePresentation({
        grade: {
            score: 62, letter: 'D', adjusted: true, base_score: 82, base_letter: 'B',
            base_date: '2025-01-17', followups: 1, followup_date: '2025-07-05',
            restored_items: [], failed_items: [47, 49], cos_items: [],
            new_items: [16], unchecked_items: [5],
            restored_points: 0, extra_points: 11,
        },
    });
    assert.equal(view.adjusted, true);
    assert.deepEqual([view.score, view.letter, view.baseScore, view.baseLetter], [62, 'D', 82, 'B']);
    assert.deepEqual(view.failed, [47, 49]);

    const banded = dashboard.gradePresentation({ grade: { score: 91, adjusted: false } });
    assert.equal(banded.letter, 'A');
});

test('no grade block means no grade — the assessment never stands in for one', () => {
    const view = dashboard.facilityPresentation({
        latest: { scope: 'broad', applicable_item_count: 31, score: 68 },
        latest_assessment: { scope: 'broad', applicable_item_count: 31, score: 68 },
        score_trend: [68],
    });
    assert.equal(view.grade, null);
    assert.notEqual(view.assessment, null);   // the broad record is still there, just letterless

    const none = dashboard.facilityPresentation({
        latest: { scope: 'focused', applicable_item_count: 2, score: 100 },
        latest_assessment: null,
    });
    assert.equal(none.grade, null);
});

test('an adjusted grade leads the tooltip; the broad line names a score, not a letter', () => {
    const facility = {
        name: 'Example', status: 'Permitted',
        latest: {
            scope: 'focused', applicable_item_count: 2, score: 100,
            checklist_out: 0, date: '2025-07-05', checklist_present: true,
        },
        latest_assessment: {
            scope: 'broad', applicable_item_count: 31, score: 82,
            compliance_rate: 0.9, date: '2025-01-17',
        },
        grade: {
            score: 62, letter: 'D', adjusted: true, base_score: 82, base_letter: 'B',
            base_date: '2025-01-17', followups: 1, followup_date: '2025-07-05',
        },
        score_trend: [82, 90],
    };
    const html = dashboard.FoodDashboard.prototype._tooltipHTML.call({
        _mode: 'full',
        _isActive: () => true,
    }, facility);
    assert.match(html, /Grade D · 62 · after 1 follow-up/);
    assert.match(html, /Latest broad inspection: 82 ▼/);
    assert.doesNotMatch(html, /Grade B/);   // the broad inspection shows its score, never a letter
});

test('the grade hero draws the circle and names every adjustment with its rule', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const html = proto._gradeHero.call(
        {
            _gradeCircle: proto._gradeCircle,
            _gradeChips: proto._gradeChips,
            _gradeBadgeCol: proto._gradeBadgeCol,
        },
        {
            adjusted: true, score: 62, letter: 'D', baseScore: 82, baseLetter: 'B',
            baseDate: '2025-01-17', followups: 1, followupDate: '2025-07-05',
            restored: [22], failed: [47, 49], cos: [3], newItems: [16], unchecked: [5],
            restoredPoints: 3.9, extraPoints: 11,
        },
        '<svg data-spark></svg>', '2025-07-05');
    assert.match(html, /food-grade-circle/);
    assert.match(html, /food-grade-letter">D</);
    assert.match(html, /food-grade-score">62</);
    // "Grade" caption over the circle, "computed" tag under it
    assert.match(html, /food-grade-caption">Grade</);
    assert.match(html, /food-score-computed[^>]*>computed</);
    // two dated provenance lines, numeric M/D/YYYY
    assert.match(html, /Last broad inspection: 1\/17\/2025/);
    assert.match(html, /Last visit: 7\/5\/2025/);
    assert.match(html, /✓ 1 verified fixed \(\+3\.9\)/);
    assert.match(html, /items 47, 49 still OUT on the newest re-check — deduction ×1\.5/);
    assert.match(html, /\+1 new finding</);
    assert.match(html, /1 fixed on site/);
    assert.match(html, /1 not re-checked/);
    assert.match(html, /65% of their deductions returned/);
    assert.match(html, /data-spark/);
    assert.doesNotMatch(html, /standing/i);
});

test('grade filter, marker fill, and score sort all key off facility.grade', () => {
    const src = readFileSync(
        new URL('../public/static/js/foodDashboard.js', import.meta.url), 'utf8');
    assert.match(src, /facilityPresentation\(f\)\.grade\?\.letter/);
    assert.match(src, /return gradeColor\(facilityPresentation\(f\)\.grade\?\.letter \|\| null\);/);
    assert.match(src, /case 'score': return fp\.grade\?\.score \?\? -1;/);
    assert.doesNotMatch(src, /\bstandingPresentation\b/);
});
