import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('../public/static/js/foodDashboard.js', import.meta.url),
    'utf8',
);
const styles = readFileSync(
    new URL('../public/static/css/style.css', import.meta.url),
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

test('inspection scope changes exactly at 20 distinct numbered form items', () => {
    const { inspectionPresentation } = dashboard;
    assert.equal(inspectionPresentation({ checklist: checklist(20), score: 90 }).scope, 'broad');
    assert.equal(inspectionPresentation({ checklist: checklist(19), score: 90 }).scope, 'focused');
    assert.equal(inspectionPresentation({ checklist: [], checklist_present: true, score: 100 }).scope, 'unknown');
    assert.equal(inspectionPresentation({ checklist_present: false, score: 100 }).scope, 'unknown');
});

test('form breadth is separate from the applicable IN/OUT denominator', () => {
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
    assert.equal(view.formCount, 4);
    assert.equal(view.count, 2);
    assert.equal(view.out, 1);
    assert.equal(view.scope, 'focused');
    assert.equal(view.score, 0);
    assert.equal('grade' in view, false);   // an inspection never carries a letter
});

test('N/A and N/O can prove form breadth without becoming compliant passes', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
        item: index + 1,
        disposition: index % 2 ? 'N/A' : 'N/O',
        compliant: true, // the exact stale pre-M3 portal-token projection
        is_sentinel: false,
    }));
    const view = dashboard.inspectionPresentation({ checklist: rows, score: 100 });
    assert.equal(view.scope, 'broad');
    assert.equal(view.formCount, 20);
    assert.equal(view.count, 0);
    assert.equal(view.compliant, 0);
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
    assert.match(html, /food-insp-score-focused food-insp-signal/);
    assert.match(html, />0\/2<\/span><small aria-hidden="true">OUT/);
    assert.match(html, /role="img"/);
    assert.match(html, /aria-label="0 of 2 focused items marked OUT; 100% in compliance"/);
    assert.match(html, />Focused<\/span>/);
    assert.doesNotMatch(html, /Focused · 2 items/);
    assert.doesNotMatch(html, /food-insp-compliance/);
});

test('a focused detail row shows its OUT ratio and no score line at all', () => {
    const context = {
        _disposSets: dashboard.FoodDashboard.prototype._disposSets,
        _renderChecklist: () => '',
        _renderTemps: () => '',
    };
    const render = (insp) => dashboard.FoodDashboard.prototype._renderInspection
        .call(context, insp, true);

    // Lakeside Grill's 2026-04-02 follow-up: raw 92, 3/3 OUT.
    const focused = render({
        date: '2026-04-02', insp_type: 'Fast Food', purpose: 'Follow-Up',
        score: 92, checklist: checklist(3, 3), checklist_present: true,
        violations: [],
    });
    assert.match(focused, />3\/3<\/span><small aria-hidden="true">OUT/);
    assert.doesNotMatch(focused, /food-raw-score/);   // the score line is gone
    assert.doesNotMatch(focused, /\b92\b/);
    assert.doesNotMatch(focused, /item-by-item/);

    // The narrative twin keeps a line, reworded: it explains the missing
    // checklist without lecturing about grade mechanics.
    const narrative = render({
        date: '2026-05-01', insp_type: 'Fast Food', purpose: 'Follow-Up',
        score: 100, checklist: [], checklist_present: false, violations: [],
        adjudication: { status: 'adjudicated', verdict: 'none_corrected' },
    });
    assert.match(narrative,
        /food-raw-score">No checklist published; verdict read from the inspector's written comments\./);
    assert.match(narrative, /food-insp-score-adj food-insp-signal/);
    assert.doesNotMatch(narrative, /item-by-item/);
    assert.doesNotMatch(narrative, /\b100\b/);        // and still no raw score

    const targeted = render({
        date: '2026-05-02', insp_type: 'Fast Food', purpose: 'Follow-Up',
        score: 100, checklist: [], checklist_present: false, violations: [],
        adjudication: { status: 'adjudicated', verdict: 'items', items: { 47: 'IN' } },
    });
    assert.match(targeted, /<span aria-hidden="true">✓<\/span><small aria-hidden="true">1<\/small>/);
});

// The summary row keeps only per-inspection signal: purpose stays, but the
// establishment category (insp_type, e.g. "Fast Food" — already in the panel
// header) and the checklist compliance % are dropped (2026-07-22).
test('the inspection summary drops the establishment category and the compliance %', () => {
    const context = {
        _disposSets: dashboard.FoodDashboard.prototype._disposSets,
        _renderChecklist: () => '',
        _renderTemps: () => '',
        _scoreColor: () => '#000',
    };
    const html = dashboard.FoodDashboard.prototype._renderInspection.call(context, {
        date: '2026-05-26', insp_type: 'Fast Food', purpose: 'Routine',
        score: 80, checklist: checklist(20), checklist_present: true,
        checklist_summary: { compliance_rate: 0.81, compliant: 17, out: 3 },
        violations: [],
    }, false);
    assert.match(html, />Routine<\/span>/);              // the purpose stays
    assert.doesNotMatch(html, /Fast Food/);              // establishment category is gone
    assert.doesNotMatch(html, /food-insp-compliance/);   // and so is the compliance %
    assert.doesNotMatch(html, /81%/);
});

// The inspection-only score/outcome becomes a mini circle in its own grid
// column, spanning the metadata and chip rows. The VDH link stays icon-only in
// the top-right cluster.
test('the inspection signal is a two-row circle and the VDH link stays icon-only', () => {
    const context = {
        _disposSets: dashboard.FoodDashboard.prototype._disposSets,
        _renderChecklist: () => '',
        _renderTemps: () => '',
        _scoreColor: () => '#000',
    };
    const html = dashboard.FoodDashboard.prototype._renderInspection.call(context, {
        date: '2026-05-26', insp_type: 'Fast Food', purpose: 'Routine',
        score: 80, checklist: checklist(20), checklist_present: true,
        report_url: 'https://henrico.example.gov/report/42', violations: [],
    }, false, 7);
    const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'));
    assert.match(html, /<details class="food-insp" data-inspection-index="7">/);
    assert.match(summary, /<summary>\s*<span class="food-insp-score food-insp-signal"/);
    assert.match(summary, /food-insp-signal[\s\S]*?food-insp-r1[\s\S]*?food-insp-counts/);
    assert.match(summary, /food-insp-report[\s\S]*?henrico\.example\.gov/);       // the link moved into the summary
    assert.match(summary, /aria-label="Open the official VDH report for this inspection"/);
    assert.match(summary, /bi-file-earmark-text[\s\S]*?bi-box-arrow-up-right/);    // both glyphs stay
    assert.doesNotMatch(summary, />Source</);                                      // no visible text
    assert.doesNotMatch(html, /View full VDH report/);
    assert.match(summary, /food-insp-r1-right[\s\S]*?food-insp-report[\s\S]*?food-insp-caret/);  // right cluster, next to the caret
    assert.match(summary, /food-insp-r1"[\s\S]*?food-insp-counts/);               // badges are a sibling AFTER row 1
    assert.match(styles, /grid-template-areas:\s*"signal meta"\s*"signal counts"/);
    assert.match(styles, /\.food-insp-signal\s*\{[\s\S]*?border-radius:\s*50%/);
    assert.match(styles, /\.food-insp-signal\s*\{[\s\S]*?font-size:\s*1\.1rem/);
    assert.match(styles, /\.food-insp-signal\.food-insp-score-adj\s*\{[\s\S]*?flex-direction:\s*row/);
    assert.match(styles, /\.food-insp-signal\.food-insp-score-adj\s*\{[\s\S]*?align-items:\s*center/);
    assert.match(styles, /\.food-insp-signal\.food-insp-score-adj > span,\s*\n\.food-insp-signal\.food-insp-score-adj > small\s*\{[\s\S]*?font-size:\s*1\.08rem/);
});

// The facility detail header pins only the title row: name + a compact "Source"
// link (replacing the inline "VDH record" text) + the close button. Address, type,
// and permit status move OUT of the sticky head into a scrolling sub-block
// (2026-07-22). _renderDetail needs the whole grade-hero machinery to render, so
// this pins the wiring at the source level, like the other layout tripwires.
test('the detail header pins only title + Source; address/type scroll in a sub-block', () => {
    assert.doesNotMatch(source, /VDH record<\/a>/);   // the inline text link (label) is gone
    // the Source chip (both glyphs) sits in the title's right cluster, by the close button
    assert.match(source, /food-detail-title-right"[\s\S]*?food-detail-source[\s\S]*?>Source<[\s\S]*?food-detail-close/);
    // the sticky head closes BEFORE the secondary lines, which live in .food-detail-sub
    assert.match(source, /<\/div>\s*<div class="food-detail-sub">/);
    assert.match(source, /food-detail-sub"[\s\S]*?permit_type[\s\S]*?status/);
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

test('the hard form-count gate wins over contradictory scope and applicable counts', () => {
    const { inspectionPresentation } = dashboard;
    assert.equal(inspectionPresentation({ scope: 'broad', form_item_count: 0, applicable_item_count: 20, score: 90 }).scope, 'unknown');
    assert.equal(inspectionPresentation({ scope: 'broad', form_item_count: 19, applicable_item_count: 20, score: 90 }).scope, 'focused');
    assert.equal(inspectionPresentation({ scope: 'focused', form_item_count: 20, applicable_item_count: 0, score: 90 }).scope, 'broad');
    assert.equal(inspectionPresentation({ scope: 'broad', form_item_count: 20, checklist_present: false, score: 90 }).scope, 'unknown');
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

test('the hover card leads with the grade CIRCLE — the flat grade text is gone', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const facility = {
        name: 'Example', status: 'Permitted', address: '1 Main St', city: 'Richmond',
        latest: {
            scope: 'focused', applicable_item_count: 2, score: 100,
            checklist_out: 0, date: '2026-06-05', checklist_present: true,
        },
        latest_assessment: {
            scope: 'broad', applicable_item_count: 31, score: 58,
            compliance_rate: 0.7667, date: '2026-05-21',
        },
        grade: { score: 58, letter: 'F', base_score: 58, base_letter: 'F',
            base_date: '2026-05-21', adjusted: false },
        score_trend: [58, 54],
        trend: [['b', 20260521, 58, 31], ['f', 20260605, 0, 2]],
    };
    const html = proto._hoverCardHTML.call(
        Object.assign(Object.create(proto), { _mode: 'full', _isActive: () => true }),
        facility);
    // The circle is the verdict — letter over score, aria for the rest.
    assert.match(html, /food-grade-letter">F</);
    assert.match(html, /food-grade-score">58</);
    assert.match(html, /aria-label="Grade F, score 58 of 100/);
    // The old "Grade F · 58" line (and its follow-up suffix) never renders.
    assert.doesNotMatch(html, /Grade F · 58/);
    // Provenance rides as the date cards, not prose.
    assert.match(html, /Last broad inspection/);
    assert.match(html, /5\/21\/2026/);
    assert.match(html, /Last visit/);
    assert.match(html, /6\/5\/2026/);
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
    assert.deepEqual(series.events.map((event) => event.historyIndex), [3, 2, 1, 0]);
});

test('every plotted trend mark keeps the exact history row even when dates repeat', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const sameDate = '2026-05-26';
    const html = proto._sparkline.call({
        _scoreColor: proto._scoreColor,
        _sparkSvg: proto._sparkSvg,
    }, [
        { date: sameDate, scope: 'broad', applicable_item_count: 30, score: 76 },
        {
            date: sameDate, scope: 'focused', checklist_present: true,
            checklist: checklist(2, 1), score: 98,
        },
        {
            date: sameDate, scope: 'unknown', checklist_present: false,
            score: null,
        },
        { date: sameDate, scope: 'broad', applicable_item_count: 31, score: 68 },
    ]);
    const nodes = JSON.parse(
        html.match(/data-spark-nodes="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    assert.deepEqual(
        nodes.map((node) => [node.historyIndex, node.k])
            .sort((a, b) => a[0] - b[0]),
        [[0, 'broad'], [1, 'focused'], [2, 'unknown'], [3, 'broad']],
    );
});

test('a trend jump expands the exact row and pins its header below the sticky title', () => {
    const proto = dashboard.FoodDashboard.prototype;
    let selector = '';
    let scrollOptions = null;
    const stickyHead = {
        getBoundingClientRect() { return { bottom: 120 }; },
    };
    const scroller = {
        scrollTop: 80,
        scrollTo(options) { scrollOptions = options; },
    };
    const target = {
        open: false,
        querySelector(value) {
            assert.equal(value, 'summary');
            return this.summary;
        },
        summary: {
            getBoundingClientRect() { return { top: 520 }; },
            scrollIntoView() {
                assert.fail('the normal detail panel should use its exact sticky-title offset');
            },
        },
        scrollIntoView() {
            assert.fail('the multi-screen details body must not be scrolled directly');
        },
    };
    const root = {
        querySelector(value) {
            if (value === '.food-detail-head') return stickyHead;
            selector = value;
            return target;
        },
        closest(value) {
            assert.equal(value, '.food-detail');
            return scroller;
        },
    };
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => {
        callback();
        return 1;
    };
    try {
        assert.equal(proto._openInspectionFromTrend(root, 4), true);
    } finally {
        if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
        else globalThis.requestAnimationFrame = previousRaf;
    }
    assert.equal(selector, '.food-insp[data-inspection-index="4"]');
    assert.equal(target.open, true);
    assert.deepEqual(scrollOptions, { top: 479, behavior: 'smooth' });
    assert.match(styles, /\.food-spark-overlay-active\s*\{\s*cursor:\s*pointer/);
});

test('a focused re-check plots at its compliance, never at its raw report score', () => {
    const proto = dashboard.FoodDashboard.prototype;
    // The Lakeside Grill shape (6920 Lakeside Ave, 2026-04-02): a 3-item
    // follow-up docket with every one of them OUT and nothing corrected — yet a
    // raw VDH score of 92, because that formula only ever subtracts the weight
    // of the items the visit actually looked at. Plotted on the raw score this
    // total failure sat at the TOP of the chart, inside the A band, above a
    // broad 25. It belongs at the floor.
    const html = proto._sparkline.call({ _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg }, [
        {
            date: '2026-04-02', scope: 'focused', score: 92,
            checklist_present: true, checklist: checklist(3, 3),
        },
        { date: '2026-02-04', scope: 'broad', applicable_item_count: 35, score: 25 },
    ]);
    const nodes = JSON.parse(
        html.match(/data-spark-nodes="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    const focused = nodes.find((n) => n.k === 'focused');
    const broad = nodes.find((n) => n.k === 'broad');
    assert.equal(focused.s, '3/3');          // the X/Y OUT ratio, not "r92"
    assert.equal(focused.tone, 'severe');
    // y grows downward: 0% compliance must sit BELOW even a broad score of 25.
    assert.ok(focused.y > broad.y,
        `3/3 OUT (y=${focused.y}) must plot below a broad score of 25 (y=${broad.y})`);
    // The raw score appears nowhere in the chart — not as a label, not as a
    // position.
    assert.doesNotMatch(html, /r92|>92</);
});

test('a focused re-check with no trustworthy ratio claims no height at all', () => {
    const proto = dashboard.FoodDashboard.prototype;
    // Row-counted OUT (not distinct items) can't produce an honest compliance
    // share, so the mark drops to the neutral baseline tick rather than
    // inventing a position from the raw score.
    const html = proto._sparkline.call({ _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg }, [
        {
            date: '2026-04-02', scope: 'focused', applicable_item_count: 3,
            checklist_out: 4, checklist_present: true, score: 52,
        },
    ]);
    const nodes = JSON.parse(
        html.match(/data-spark-nodes="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    assert.deepEqual(nodes.map((n) => n.k), ['unknown']);
    assert.doesNotMatch(html, /food-spark-focused/);
    assert.doesNotMatch(html, /r52|>52</);
});

test('no surface pairs a focused re-check with its raw report score', () => {
    const proto = dashboard.FoodDashboard.prototype;
    // The Lakeside Grill roster shape: a compact `latest` marker with a raw
    // score of 92 and no distinct-OUT count to build a ratio from. The score is
    // the one number that must NOT appear — it reads near 100 on any focused
    // docket regardless of outcome, so beside a real signal it wins the glance.
    const facility = {
        permit_id: 'CF6DE8B6', name: 'Lakeside Grill', address: '6920 Lakeside Ave',
        status: 'Permitted', zip: '23228',
        latest: {
            scope: 'focused', applicable_item_count: 3, score: 92,
            checklist_present: true, date: '2026-04-02',
        },
        latest_assessment: {
            scope: 'broad', applicable_item_count: 35, score: 25, date: '2026-02-04',
        },
        grade: { score: 20, letter: 'F', base_score: 25, base_letter: 'F', adjusted: true },
        score_trend: [25, 94, 68],
    };
    const card = proto._hoverCardHTML.call(
        Object.assign(Object.create(proto), { _mode: 'full', _isActive: () => true }),
        { ...facility, trend: [['b', 20260204, 25, 35], ['f', 20260402, 3, 3]] });
    assert.doesNotMatch(card, /raw 92|score 92/, 'card still prints the raw score');
    assert.doesNotMatch(card, /\b92\b/, 'card still prints 92 somewhere');
    assert.match(card, /3\/3/);   // the honest signal survives — on the diamond

    // The list row is built inline inside `_rebuildList`, so pin it at the
    // source: the focused branch must carry the ratio alone, with no score
    // interpolated beside it.
    assert.match(source,
        /const eventLine = latest\.scope === 'focused'\s*\n\s*\? `Latest: focused · \$\{focusedOutcomePresentation\(latest\)\.label\}`/);
    assert.doesNotMatch(source, /· raw \$\{latest\.score\}/);
    assert.doesNotMatch(source, /sub\.push\(`score \$\{latest\.score\}`\)/);
});

test('detail copy does not claim a limited report is a clean full checklist', () => {
    assert.doesNotMatch(source, /clean report/i);
    assert.doesNotMatch(source, /Full food-code checklist/i);
    assert.match(source, /No violations recorded in this focused/);
    // The focused row's score line is gone outright. A focused raw score is
    // printed nowhere in the app now (#42 chart, #43 list/tooltip, this row),
    // and the grade-mechanics lecture that rode along with it went too — the
    // scope badge and the methodology page already carry that.
    assert.doesNotMatch(source, /Score \$\{view\.score\}/);
    assert.doesNotMatch(source, /adjusts the facility grade item-by-item/);
    // The under-plot legend was dropped; the trend card carries a caption and
    // the methodology page teaches the mark vocabulary.
    assert.doesNotMatch(source, /focused raw · ◆ written verdict/);
    assert.match(source, /food-grade-caption">Trend</);
    assert.match(source, /Broad scores oldest to newest/);
    // The compliance disclosure survives in the list view's column (the
    // hover card dropped the old "Broad compliance NN%" prose line when it
    // became the hero — the trend now shows the whole broad history instead).
    assert.match(source, /food-list-col-compliance/);
    assert.match(source, /compliance_rate \* 100/);
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

test('an adjusted grade circles its FINAL score; the base letter never leaks', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const facility = {
        name: 'Example', status: 'Permitted', address: '1 Main St', city: 'Richmond',
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
        trend: [['b', 20250117, 82, 31], ['f', 20250705, 0, 2]],
    };
    const html = proto._hoverCardHTML.call(
        Object.assign(Object.create(proto), { _mode: 'full', _isActive: () => true }),
        facility);
    // The circle carries the ADJUSTED verdict — the follow-ups' work shows.
    assert.match(html, /food-grade-letter">D</);
    assert.match(html, /food-grade-score">62</);
    // The base broad's 82 appears only as a trend point, never lettered.
    assert.doesNotMatch(html, /Grade B/);
    assert.doesNotMatch(html, /food-grade-letter">B</);
});

test('the grade hero is just the labeled circle and the trend line — no chips, no dates', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const html = proto._gradeHero.call(
        { _gradeCircle: proto._gradeCircle, _gradeBadgeCol: proto._gradeBadgeCol },
        {
            adjusted: true, score: 62, letter: 'D', baseScore: 82, baseLetter: 'B',
            baseDate: '2025-01-17', followups: 1, followupDate: '2025-07-05',
            restored: [22], failed: [47, 49], cos: [3], newItems: [16], unchecked: [5],
            restoredPoints: 3.9, extraPoints: 11,
        },
        '<svg data-spark></svg>');
    assert.match(html, /food-grade-circle/);
    assert.match(html, /food-grade-letter">D</);
    assert.match(html, /food-grade-score">62</);
    assert.match(html, /food-grade-caption">Grade</);      // "Grade" over the circle
    assert.match(html, /food-score-computed[^>]*>computed</); // "computed" under it
    assert.match(html, /data-spark/);
    // the breakdown chips and dated lines are gone from the hero
    assert.doesNotMatch(html, /verified fixed/);
    assert.doesNotMatch(html, /still out/);
    assert.doesNotMatch(html, /Last broad inspection/);
    assert.doesNotMatch(html, /standing/i);
});

test('hovering a trend mark always enlarges it — base and highlight sizes move together', () => {
    const css = readFileSync(
        new URL('../public/static/css/style.css', import.meta.url), 'utf8');
    const num = (re, text, what) => {
        const m = text.match(re);
        assert.ok(m, `could not read ${what}`);
        return parseFloat(m[1]);
    };
    // Marks live in viewBox units in the JS, their labels in the CSS. Resize
    // one half and the other has to follow, or hover stops reading as "bigger".
    const baseDot = num(/r="([\d.]+)" fill="\$\{c\}"/, source, 'base broad dot radius');
    const hlDot = num(/food-spark-hl-dot"[^>]*r="([\d.]+)"/, source, 'hover dot radius');
    assert.ok(hlDot > baseDot, `hover dot ${hlDot} must exceed base ${baseDot}`);
    const baseDia = num(/x="\$\{\(px - ([\d.]+)\)/, source, 'base diamond half-size');
    const hlDia = num(/const h = ([\d.]+);/, source, 'hover diamond half-size');
    assert.ok(hlDia > baseDia, `hover diamond ${hlDia} must exceed base ${baseDia}`);
    const baseScore = num(/\.food-spark-score \{ font-size: ([\d.]+)px/, css, 'base score label');
    const hlScore = num(/\.food-spark-score\.food-spark-hl-label \{ font-size: ([\d.]+)px/, css, 'hover score label');
    assert.ok(hlScore > baseScore, `hover label ${hlScore} must exceed base ${baseScore}`);
    const baseRaw = num(/\.food-spark-mark-label \{ font-size: ([\d.]+)px/, css, 'base mark label');
    const hlRaw = num(/\.food-spark-mark-label\.food-spark-hl-label \{ font-size: ([\d.]+)px/, css, 'hover mark label');
    assert.ok(hlRaw > baseRaw, `hover mark label ${hlRaw} must exceed base ${baseRaw}`);
    // Labels sit ABOVE their mark, so the top pad has to clear the tallest of
    // them or a perfect-100 score gets its hover label clipped out of the box.
    const padTop = num(/padTop = ([\d.]+)/, source, 'padTop');
    assert.ok(padTop >= hlScore * 1.84,
        `padTop ${padTop} must clear the hover label with hairline headroom`);
});

test('the hero keeps badge and trend on one row — copy never pushes the trend off it', () => {
    const css = readFileSync(
        new URL('../public/static/css/style.css', import.meta.url), 'utf8');
    // Explanatory copy takes a zero basis so its natural width never votes on
    // the row. With `auto` it wins the row and strands the trend on line two.
    assert.match(css, /\.food-score-meta \{ flex: 1 1 0;/);
    // The trend is height-locked to the grade circle but grows sideways to fill
    // the row (flex-grow); _bindSparkline re-spaces the points to the width, so it
    // stays on the row and never wraps off it — only the copy (full basis) wraps.
    assert.match(css, /\.food-spark \{[^}]*flex: 1 1 0;/);
    assert.match(css, /\.food-spark svg \{ height: [\d.]+rem; width: auto;/);
    // The height-lock-with-sideways-spread is driven in JS: the sparkline
    // re-renders at a viewBox width matched to the render, kept fitted on resize.
    assert.match(source, /_sparkSvg\(series, /);
    assert.match(source, /new ResizeObserver\(/);
    // Only the hero that carries BOTH copy and a trend wraps, and it wraps the
    // copy (full basis) — never the trend.
    assert.match(css, /\.food-grade-hero-none \{[^}]*flex-wrap: wrap;/);
    assert.match(css, /\.food-grade-hero-none \.food-score-meta \{ flex-basis: 100%; \}/);
    assert.doesNotMatch(css, /\.food-grade-hero \{[^}]*flex-wrap/);
});

test('the no-grade hero states its verdict in the badge pill, not as prose', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const html = proto._noGradeHero.call(
        { _gradeBadgeCol: proto._gradeBadgeCol },
        { scope: 'focused', count: 4 }, '<svg data-spark></svg>');
    // Same slot "computed" occupies on a graded facility — caption / circle / pill.
    assert.match(html, /food-grade-caption">Grade</);
    assert.match(html, /food-grade-circle-none/);
    assert.match(html, /food-score-computed food-grade-tag-none">no grade yet</);
    // The verdict lives in the pill now, so it is not ALSO a headline beside it.
    assert.doesNotMatch(html, /food-score-grade">/);
    // The explanation stays, and the trend rides along.
    assert.match(html, /focused 4-item check/);
    assert.match(html, /data-spark/);
});

test('grade dates render as two labeled objects below the hero, numeric M/D/YYYY', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const both = proto._gradeDates.call({}, '2025-01-17', '2025-07-05');
    assert.match(both, /food-grade-dates/);
    assert.match(both, /Last broad inspection<\/span>\s*<span class="food-grade-date-value">1\/17\/2025/);
    assert.match(both, /Last visit<\/span>\s*<span class="food-grade-date-value">7\/5\/2025/);
    // no broad date (newly-permitted facility) → the box stays, value is a dash
    const visitOnly = proto._gradeDates.call({}, null, '2025-07-05');
    assert.match(visitOnly, /Last broad inspection<\/span>\s*<span class="food-grade-date-value">—/);
    assert.match(visitOnly, /Last visit<\/span>\s*<span class="food-grade-date-value">7\/5\/2025/);
    // nothing to show at all → empty
    assert.equal(proto._gradeDates.call({}, null, null), '');
});

test('grade filter, marker fill, and score sort all key off facility.grade', () => {
    const src = readFileSync(
        new URL('../public/static/js/foodDashboard.js', import.meta.url), 'utf8');
    assert.match(src, /facilityPresentation\(f\)\.grade\?\.letter/);
    assert.match(src, /return gradeColor\(facilityPresentation\(f\)\.grade\?\.letter \|\| null\);/);
    assert.match(src, /case 'score': return fp\.grade\?\.score \?\? -1;/);
    assert.doesNotMatch(src, /\bstandingPresentation\b/);
});

test('newly permitted keys off the exporter flag, not merely "no grade"', () => {
    const proto = dashboard.FoodDashboard.prototype;
    assert.equal(proto._isNew.call(proto, { newly_permitted: true }), true);
    assert.equal(proto._isNew.call(proto, { newly_permitted: false }), false);
    // "active + no grade" is NOT enough on its own anymore — an unparsed routine
    // with violations (the E'din bug) reached here and read as "cleared to open".
    assert.equal(proto._isNew.call(proto, { status: 'Permitted' }), false);
    assert.equal(proto._isNew.call(proto, { status: 'Permitted', grade: { score: 82, letter: 'B' } }), false);
    assert.equal(proto._isNew.call(proto, {}), false);
});

test('the newly-permitted hero is a blue NEW badge with simple copy and no sparkline', () => {
    const proto = dashboard.FoodDashboard.prototype;
    const html = proto._newHero.call(proto, { scope: 'unknown' });
    assert.match(html, /food-grade-circle-new/);
    assert.match(html, /food-grade-new-label">NEW</);
    assert.match(html, /--grade-color:#1c7ed6/);
    assert.match(html, /food-score-grade-new">Permitted</);   // headline is just "Permitted"
    assert.match(html, /Cleared to open; grade pending its first broad inspection/);
    assert.doesNotMatch(html, /—/);                      // no em-dashes (AI-copy tell)
    assert.match(html, /food-grade-caption">Status</);   // "Status", not "Grade"
    assert.doesNotMatch(html, /food-spark/);             // no sparkline in this hero
    // a focused-latest new facility gets the re-check variant of the copy
    assert.match(proto._newHero.call(proto, { scope: 'focused', count: 3 }), /focused re-check/);
});

test('newly-permitted wiring: blue marker fill, a Show new filter, and the NEW list chip', () => {
    const src = readFileSync(
        new URL('../public/static/js/foodDashboard.js', import.meta.url), 'utf8');
    assert.match(src, /const NEW_COLOR = '#1c7ed6';/);
    assert.match(src, /this\._isNew\(f\) \? NEW_COLOR : this\._markerColor\(f\)/);
    assert.match(src, /if \(!lite && !showNew && this\._isNew\(f\)\) return false;/);
    assert.match(src, /food-list-score-new/);
    assert.match(src, /const flagsHtml = \(latest && !isNew\)/);   // red flags hidden for newly-permitted
});
