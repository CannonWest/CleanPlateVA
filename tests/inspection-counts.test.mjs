// Inspection-summary violation counts: the grade-receipt chip row (total + the
// risk-factor / retail-practice split) ported onto every history row, replacing
// the old muted "N viol." text (CleanPlateVA, 2026-07-22). The contract lives in
// inspectionCountsPresentation; the render method only paints it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboard, dashboardSource as source } from './support/dashboard.mjs';

const { inspectionCountsPresentation } = dashboard;

// A checklist of `count` distinct applicable items drives the broad/focused
// scope classification (broad at ≥20), mirroring scope-presentation.test.mjs.
const checklist = (count) => Array.from({ length: count }, (_, i) => ({
    item: i + 1, disposition: 'IN', compliant: true, is_sentinel: false,
}));

test('violations split into risk-factor (item ≤29) and retail-practice (item ≥30)', () => {
    // Holy Burger's real 6-violation anchor: items 3/15/28 (rf) + 35/43/47 (rp).
    const c = inspectionCountsPresentation({
        checklist: checklist(20), score: 80,
        violations: [{ item: 3 }, { item: 15 }, { item: 28 }, { item: 35 }, { item: 43 }, { item: 47 }],
    });
    assert.equal(c.n, 6);
    assert.equal(c.rf, 3);
    assert.equal(c.grp, 3);
    assert.equal(c.show, true);
});

test('item-less, sentinel, and item >29 rows all count as retail practice', () => {
    const c = inspectionCountsPresentation({
        checklist: checklist(20), score: 70,
        violations: [{ item: null }, { item: 99 }, { item: 30 }, { item: 1 }],
    });
    assert.equal(c.n, 4);
    assert.equal(c.rf, 1);    // only item 1 is a risk factor
    assert.equal(c.grp, 3);   // null, 99, 30 — everything not an integer ≤29
});

// Cannon's call (2026-07-22): a scope-unknown row with nothing recorded shows NO
// badge — a green "0 violations" there reads as "verified clean" when the
// checklist breadth is simply unknown, the misleading skim the narrative channel
// exists to fight. This is the tripwire for that decision — do not loosen it.
test('scope-unknown with zero recorded violations suppresses the badge', () => {
    const c = inspectionCountsPresentation({ checklist_present: false, score: 100, violations: [] });
    assert.equal(c.n, 0);
    assert.equal(c.show, false);
});

test('scope-unknown WITH violations still shows the badge', () => {
    const c = inspectionCountsPresentation({
        checklist_present: false, score: 90, violations: [{ item: 5 }, { item: 40 }],
    });
    assert.equal(c.n, 2);
    assert.equal(c.rf, 1);
    assert.equal(c.grp, 1);
    assert.equal(c.show, true);
});

test('a clean broad inspection keeps an honest green zero (shown, n=0)', () => {
    const c = inspectionCountsPresentation({ checklist: checklist(20), score: 100, violations: [] });
    assert.equal(c.n, 0);
    assert.equal(c.show, true);   // broad zero is a real clean docket, not an unknown
});

test('a clean focused re-check is shown too (zero against a known docket)', () => {
    const c = inspectionCountsPresentation({ checklist: checklist(5), score: 100, violations: [] });
    assert.equal(c.show, true);
});
