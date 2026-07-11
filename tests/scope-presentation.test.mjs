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

const checklist = (count) => Array.from({ length: count }, (_, index) => ({
    item: index + 1,
    disposition: 'IN',
    compliant: true,
    violation: false,
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
    assert.equal(view.scope, 'focused');
    assert.equal(view.score, 0);
    assert.equal(view.grade, null);
});

test('a broad report needs a raw score before it can expose a grade', () => {
    const view = dashboard.inspectionPresentation({
        scope: 'broad', applicable_item_count: 24, score: null, grade: 'A',
    });
    assert.equal(view.broadEligible, true);
    assert.equal(view.gradeEligible, false);
    assert.equal(view.grade, null);
});

test('the hard count gate wins over contradictory scope labels', () => {
    const { inspectionPresentation } = dashboard;
    assert.equal(inspectionPresentation({ scope: 'broad', applicable_item_count: 0, score: 90 }).scope, 'unknown');
    assert.equal(inspectionPresentation({ scope: 'broad', applicable_item_count: 19, score: 90 }).scope, 'focused');
    assert.equal(inspectionPresentation({ scope: 'focused', applicable_item_count: 20, score: 90 }).scope, 'broad');
    assert.equal(inspectionPresentation({ scope: 'broad', applicable_item_count: 20, checklist_present: false, score: 90 }).scope, 'unknown');
});

test('facility presentation pairs newest event with one assessment and one trend', () => {
    const facility = {
        latest: { scope: 'focused', applicable_item_count: 2, score: 100, checklist_out: 0 },
        latest_assessment: { scope: 'broad', applicable_item_count: 31, score: 68, grade: 'D' },
        score_trend: [68, 76, 64],
    };
    const view = dashboard.facilityPresentation(facility);
    assert.equal(view.latest.scope, 'focused');
    assert.equal(view.latest.score, 100);
    assert.equal(view.assessment.grade, 'D');
    assert.deepEqual(view.trend, [68, 76, 64]);
    assert.equal(view.declining, true);
    assert.equal('broadTrend' in view, false);
});

test('a focused-only facility has no fabricated assessment', () => {
    const view = dashboard.facilityPresentation({
        latest: { scope: 'focused', applicable_item_count: 2, score: 100 },
        latest_assessment: null,
        score_trend: [],
    });
    assert.equal(view.assessment, null);
    assert.deepEqual(view.trend, []);
});

test('focused marker tooltip executes and discloses broad compliance', () => {
    const facility = {
        name: 'Example', status: 'Permitted',
        latest: {
            scope: 'focused', applicable_item_count: 2, score: 100,
            checklist_out: 0, date: '2026-06-05', checklist_present: true,
        },
        latest_assessment: {
            scope: 'broad', applicable_item_count: 31, score: 58, grade: 'F',
            compliance_rate: 0.7667, date: '2026-05-21',
        },
        score_trend: [58, 54],
    };
    const html = dashboard.FoodDashboard.prototype._tooltipHTML.call({
        _mode: 'full',
        _isActive: () => true,
    }, facility);
    assert.match(html, /Latest: focused inspection/);
    assert.match(html, /Assessment: Grade F · 58/);
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
    assert.match(source, /Raw formula .*not used for grade or trend/);
    assert.match(source, /broad line · ◇ focused raw/);
    assert.match(source, /Broad scores oldest to newest/);
    assert.match(source, /Broad compliance/);
});
