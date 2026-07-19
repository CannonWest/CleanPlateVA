// NARRATIVE arc presentation contract: adjudicated comment verdicts on
// scope-unknown Follow-Ups drive the row badge/chip, and the grade block's
// narrative provenance reaches gradePresentation. The verdict fixtures
// mirror the exporter's compact `adjudication` block (status/verdict/items),
// with real-archive shapes: Brickhouse's blanket, Curry Lounge's failure,
// Nash & Smashed's enumeration.
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

const { narrativeVerdictPresentation, gradePresentation } = dashboard;

const row = (adjudication) => ({
    inspection_id: 'N1', date: '2026-04-06', purpose: 'Follow-Up',
    scope: 'unknown', checklist_present: false, score: 100,
    violations: [], adjudication,
});

test('all_corrected reads as a clear ✓ verdict at the r100 line', () => {
    const v = narrativeVerdictPresentation(
        row({ status: 'adjudicated', verdict: 'all_corrected' }));
    assert.equal(v.tone, 'clear');
    assert.equal(v.glyph, '✓');
    assert.equal(v.label, 'All violations corrected');
    assert.equal(v.height, 100); // sparkline: where the full-clear r100 lives
});

test('none_corrected reads as a severe ✗ verdict at r0', () => {
    const v = narrativeVerdictPresentation(
        row({ status: 'adjudicated', verdict: 'none_corrected' }));
    assert.equal(v.tone, 'severe');
    assert.equal(v.glyph, '✗');
    assert.equal(v.label, 'Violations not corrected');
    assert.equal(v.height, 0);
});

test('priority_corrected names the scoping', () => {
    const v = narrativeVerdictPresentation(
        row({ status: 'adjudicated', verdict: 'priority_corrected' }));
    assert.equal(v.tone, 'good');
    assert.match(v.label, /^Priority violations corrected$/);
});

test('items verdict lists INs sorted numerically', () => {
    const v = narrativeVerdictPresentation(row({
        status: 'adjudicated', verdict: 'items',
        items: { 28: 'IN', 3: 'IN', 51: 'IN', 41: 'IN' },
    }));
    assert.equal(v.label, 'Items #3, #28, #41, #51 corrected');
    assert.equal(v.tone, 'good');
});

test('items verdict with OUTs downgrades tone and says so', () => {
    const v = narrativeVerdictPresentation(row({
        status: 'adjudicated', verdict: 'items',
        items: { 8: 'IN', 14: 'OUT' },
    }));
    assert.equal(v.tone, 'watch');
    assert.match(v.label, /#8 corrected · #14 still out/);
    assert.equal(v.height, 50); // sparkline plots the IN-share
    const allOut = narrativeVerdictPresentation(row({
        status: 'adjudicated', verdict: 'items', items: { 14: 'OUT' },
    }));
    assert.equal(allOut.tone, 'severe');
    assert.equal(allOut.glyph, '✗');
    assert.equal(allOut.height, 0);
});

test('sparkline heights: priority sits high, enumerated at IN-share', () => {
    assert.equal(narrativeVerdictPresentation(
        row({ status: 'adjudicated', verdict: 'priority_corrected' })).height, 85);
    assert.equal(narrativeVerdictPresentation(row({
        status: 'adjudicated', verdict: 'items',
        items: { 3: 'IN', 28: 'IN', 41: 'IN', 51: 'IN' },
    })).height, 100);
});

test('non-actionable and malformed blocks render nothing', () => {
    assert.equal(narrativeVerdictPresentation(row(undefined)), null);
    assert.equal(narrativeVerdictPresentation(
        row({ status: 'needs_llm', verdict: null })), null);
    assert.equal(narrativeVerdictPresentation(
        row({ status: 'abstain' })), null);
    assert.equal(narrativeVerdictPresentation(
        row({ status: 'adjudicated', verdict: 'items', items: {} })), null);
    assert.equal(narrativeVerdictPresentation(
        row({ status: 'adjudicated', verdict: 'unrecognized_future' })), null);
    assert.equal(narrativeVerdictPresentation(null), null);
});

test('gradePresentation carries narrative provenance', () => {
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
    });
    assert.equal(g.narrativeFollowups, 1);
    assert.deepEqual(g.narrativeItems, [8, 21]);
});

test('gradePresentation defaults narrative fields for pre-arc payloads', () => {
    const g = gradePresentation({
        grade: {
            score: 92, letter: 'A', base_score: 92, base_letter: 'A',
            base_date: '2026-01-01', adjusted: false, followups: 0,
        },
    });
    assert.equal(g.narrativeFollowups, 0);
    assert.deepEqual(g.narrativeItems, []);
});
