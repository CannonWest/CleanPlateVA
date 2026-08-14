/** The marker-bound hover card: a display-only preview of the detail panel's
 *  grade hero rendered from the roster alone.
 *
 *  The roster marker ships a compact `trend` array (cf_export_site
 *  ._trend_event — one oldest-first tuple per inspection), and
 *  `trendInspections` decodes it into pseudo-inspections that feed the SAME
 *  presentation + sparkline pipeline the detail panel uses. That shared
 *  renderer is the whole design: the card can't drift from the panel because
 *  there is no second drawing path. The parity test here is the tripwire —
 *  a facility rendered from full checklist rows and from its exporter tuples
 *  must produce byte-identical trend SVGs.
 *
 *  Hover never fetches and never owns interaction. Leaving the marker removes
 *  the card immediately; clicking the marker opens the detail panel, where the
 *  trend and grade receipt remain interactive.
 */
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
const proto = dashboard.FoodDashboard.prototype;
const { trendInspections, inspectionPresentation, buildScopeSeries,
    focusedOutcomePresentation, narrativeVerdictPresentation } = dashboard;

const rows = (count, out = 0, dupes = 0) => {
    const list = Array.from({ length: count }, (_, index) => ({
        item: index + 1,
        disposition: index < out ? 'OUT' : 'IN',
        compliant: index >= out,
        violation: index < out,
        is_sentinel: false,
    }));
    // Duplicate rows under an already-OUT item: the archive shape that makes
    // row-counted OUT lie (Lakeside had 4 rows against 3 distinct items).
    for (let i = 0; i < dupes; i++) list.push({ ...list[0] });
    return list;
};

// ── tuple decoding ─────────────────────────────────────────────────────

test('broad tuples decode to grade-eligible pseudo-inspections, dated', () => {
    const [b] = trendInspections([['b', 20260204, 25, 0, 35]]);
    assert.equal(b.date, '2026-02-04');
    const view = inspectionPresentation(b);
    assert.equal(view.scope, 'broad');
    assert.equal(view.formCount, 35);
    assert.equal(view.count, 0);
    assert.equal(view.gradeEligible, true);
    assert.equal(view.score, 25);
});

test('an unscored broad tuple still holds its slot without joining the line', () => {
    const [b] = trendInspections([['b', 20260204, null, 35]]);
    const view = inspectionPresentation(b);
    assert.equal(view.scope, 'broad');
    assert.equal(view.gradeEligible, false);   // no score → not on the line
});

test('focused tuples carry the distinct-OUT ratio the diamonds plot', () => {
    const [f] = trendInspections([['f', 20260306, 3, 3, 10]]);
    const view = inspectionPresentation(f);
    assert.equal(view.scope, 'focused');
    assert.equal(view.formCount, 10);
    assert.equal(view.out, 3);
    assert.equal(view.outIsDistinct, true);
    const outcome = focusedOutcomePresentation(view);
    assert.equal(outcome.label, '3/3 OUT');
    assert.equal(outcome.tone, 'severe');
    assert.equal(outcome.ratioKnown, true);
});

test('hybrid focused tuples count comment corrections in the addressed denominator', () => {
    const [f] = trendInspections([['f', 20260604, 3, 17, 3]]);
    const view = inspectionPresentation(f);
    const outcome = focusedOutcomePresentation(view);

    assert.equal(f.addressed_item_count, 17);
    assert.equal(view.formCount, 3);
    assert.equal(outcome.label, '3/17 OUT');
    assert.equal(outcome.ratioKnown, true);
    const ctx = { _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg };
    assert.match(proto._sparkline.call(ctx, [f]), />3\/17<\/text>/);
});

test('a focused tuple with a null OUT count claims no ratio (baseline tick)', () => {
    const [f] = trendInspections([['f', 20260306, null, 3]]);
    const view = inspectionPresentation(f);
    assert.equal(view.scope, 'focused');
    assert.equal(view.outIsDistinct, false);
    assert.equal(focusedOutcomePresentation(view).ratioKnown, false);
});

test('narrative tuples re-arm narrativeVerdictPresentation exactly', () => {
    const [blanket, enumerated, bare] = trendInspections([
        ['n', 20260406, 'all_corrected'],
        ['n', 20260408, 'items', { 2: 'IN', 16: 'IN', 25: 'OUT' }],
        ['n', 20260409, 'items'],               // map-less: degrades to a tick
    ]).reverse();                               // back to wire order for clarity
    const b = narrativeVerdictPresentation(blanket);
    assert.equal(b.verdict, 'all_corrected');
    assert.equal(b.height, 100);
    const e = narrativeVerdictPresentation(enumerated);
    assert.equal(e.verdict, 'items');
    assert.equal(e.height, Math.round(100 * 2 / 3));
    assert.equal(e.count, 2);
    assert.equal(narrativeVerdictPresentation(bare), null);
});

test('narrative trend labels count the IN items beside checks and OUT items beside X marks', () => {
    const inspections = [
        { date: '2026-04-08', checklist_present: false,
            adjudication: { status: 'adjudicated', verdict: 'items',
                items: { 2: 'IN', 16: 'IN', 25: 'IN' } } },
        { date: '2026-04-07', checklist_present: false,
            adjudication: { status: 'adjudicated', verdict: 'items',
                items: { 7: 'OUT', 21: 'OUT' } } },
        { date: '2026-04-06', checklist_present: false,
            adjudication: { status: 'adjudicated', verdict: 'all_corrected' } },
    ];
    const ctx = { _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg };
    const html = proto._sparkline.call(ctx, inspections);
    const nodes = JSON.parse(
        html.match(/data-spark-nodes="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    const narrative = nodes.filter((node) => node.k === 'narr');

    assert.deepEqual(narrative.map((node) => node.s), ['✓', '✗2', '✓3']);
    assert.match(html, />✗2<\/text>/);
    assert.match(html, />✓3<\/text>/);
    assert.doesNotMatch(html, />✓0<\/text>|>✓null<\/text>/);
    assert.match(proto._sparkHighlight(narrative[1]), />✗2<\/text>/);
    assert.match(proto._sparkHighlight(narrative[2]), />✓3<\/text>/);
});

test('unknown tuples and zero dates decode to bare undated events', () => {
    const [u] = trendInspections([['u', 0]]);
    assert.equal(u.date, null);
    assert.equal(inspectionPresentation(u).scope, 'unknown');
    assert.equal(narrativeVerdictPresentation(u), null);
});

test('tuples arrive oldest-first and decode newest-first (the panel order)', () => {
    const events = trendInspections([
        ['b', 20250101, 80, 25],
        ['f', 20260306, 1, 3],
    ]);
    assert.equal(events[0].date, '2026-03-06');   // newest first, like a fetch
    const series = buildScopeSeries(events);
    assert.equal(series.events[0].inspection.date, '2025-01-01');
    assert.deepEqual(series.broad.map((e) => e.index), [0]);
    assert.deepEqual(series.focused.map((e) => e.index), [1]);
});

// ── the parity tripwire ────────────────────────────────────────────────

test('exporter tuples and full checklist rows render byte-identical trend SVGs', () => {
    // One facility, four visits, told two ways: the detail fetch's full rows
    // and the roster's compact tuples. Same renderer, so the SVGs must be
    // IDENTICAL — nodes, labels, aria summary, every byte.
    const full = [
        { date: '2026-04-06', checklist: [], checklist_present: false,
            adjudication: { status: 'adjudicated', verdict: 'all_corrected' } },
        { date: '2026-03-06', score: 92, checklist_present: true,
            checklist: rows(3, 3, 1) },          // 4 OUT rows, 3 distinct items
        { date: '2026-02-06', checklist: [], checklist_present: false },
        { date: '2026-02-04', score: 25, checklist_present: true,
            checklist: rows(35, 3) },
    ];
    const tuples = [
        ['b', 20260204, 25, 35],
        ['u', 20260206],
        ['f', 20260306, 3, 3],
        ['n', 20260406, 'all_corrected'],
    ];
    const ctx = { _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg };
    const fromRows = proto._sparkline.call(ctx, full);
    const fromTuples = proto._sparkline.call(ctx, trendInspections(tuples));
    assert.equal(fromTuples, fromRows);
    // And the raw focused score prints nowhere in either rendering.
    assert.doesNotMatch(fromRows, /\b92\b/);
});

// ── the card itself ────────────────────────────────────────────────────

const cardCtx = (mode = 'full') => Object.assign(Object.create(proto), {
    _mode: mode,
    _isActive: () => true,
});

test('the hover card is the hero: circle + trend + date cards, no flat grade text', () => {
    const facility = {
        name: 'Lakeside Grill', address: '6920 Lakeside Ave', city: 'Richmond',
        status: 'Permitted',
        latest: { scope: 'focused', applicable_item_count: 3, score: 92,
            out_item_count: 3, checklist_present: true, date: '2026-04-02' },
        latest_assessment: { scope: 'broad', applicable_item_count: 35,
            score: 25, date: '2026-02-04' },
        grade: { score: 20, letter: 'F', base_score: 25, base_letter: 'F',
            base_date: '2026-02-04', adjusted: true, followups: 2 },
        trend: [['b', 20260204, 25, 35], ['f', 20260306, 3, 3],
            ['f', 20260402, 3, 3]],
    };
    const html = proto._hoverCardHTML.call(cardCtx(), facility);
    // The hero circle carries the verdict…
    assert.match(html, /food-grade-circle/);
    assert.match(html, /food-grade-letter">F</);
    assert.match(html, /food-grade-score">20</);
    assert.doesNotMatch(html, /data-grade-receipt/);   // display-only preview
    // …the trend is the real sparkline with the honest ratio labels…
    assert.match(html, /food-spark/);
    assert.match(html, /3\/3/);
    // …the provenance rides as the two date cards…
    assert.match(html, /Last broad inspection/);
    assert.match(html, /2\/4\/2026/);
    assert.match(html, /Last visit/);
    assert.match(html, /4\/2\/2026/);
    // …and the old flat text — and the focused RAW score — are gone.
    assert.doesNotMatch(html, /Grade F · /);
    assert.doesNotMatch(html, /\b92\b/);
    assert.match(html, /6920 Lakeside Ave/);
});

test('no grade and newly-permitted keep their hero variants in the card', () => {
    const noGrade = proto._hoverCardHTML.call(cardCtx(), {
        name: 'X', address: '1 St', city: 'Richmond', status: 'Permitted',
        latest: { scope: 'focused', applicable_item_count: 2, score: 100,
            date: '2026-01-01' },
        trend: [['f', 20260101, 0, 2]],
    });
    assert.match(noGrade, /No grade yet|no grade yet/);
    assert.doesNotMatch(noGrade, /data-grade-receipt/); // nothing to break down
    const isNew = proto._hoverCardHTML.call(cardCtx(), {
        name: 'Y', address: '2 St', city: 'Richmond', status: 'Permitted',
        newly_permitted: true,
        latest: { scope: 'unknown', date: '2026-01-01' },
        trend: [['u', 20260101]],
    });
    assert.match(isNew, /food-grade-circle-new/);
    assert.doesNotMatch(isNew, /food-spark/);           // no history to trend
});

test('a pre-trend payload still circles the grade — sparkless, never blank', () => {
    // The R2 roster can lag a code deploy; a graded facility whose marker
    // carries no `trend` array must degrade to circle + dates, not to the
    // "no detail" line.
    const html = proto._hoverCardHTML.call(cardCtx(), {
        name: 'Stale Payload Cafe', address: '9 Old Rd', city: 'Richmond',
        status: 'Permitted',
        latest: { scope: 'broad', applicable_item_count: 30, score: 88,
            date: '2026-05-01' },
        grade: { score: 88, letter: 'B', base_score: 88, base_letter: 'B',
            base_date: '2026-05-01', adjusted: false },
    });
    assert.match(html, /food-grade-letter">B</);
    assert.match(html, /Last broad inspection/);
    assert.doesNotMatch(html, /food-spark/);
    assert.doesNotMatch(html, /No inspection detail available yet/);
});

test('lite keeps the slim finder tip — no hero, no judgment', () => {
    const html = proto._hoverCardHTML.call(cardCtx('lite'), {
        name: 'Taco Truck', address: '1 Main St', city: 'Richmond',
        location: { source: 'zip_centroid' }, mobile: true,
    });
    assert.match(html, /Taco Truck/);
    assert.match(html, /≈ approximate location/);
    for (const banned of ['food-grade-circle', 'food-spark', 'Last visit',
        'data-grade-receipt']) {
        assert.doesNotMatch(html, new RegExp(banned), banned);
    }
});

test('Contract V3 map geometry reads only the nested effective location', () => {
    const facility = {
        permit_id: 'P-1', location: { lat: 37.6205521, lon: -77.5256119 },
    };
    // Bound to the prototype, not a bare literal: _toGeoJSON delegates paint
    // to _markerPaint so the map and the spiderfied legs cannot diverge.
    const geojson = cardCtx('lite')._toGeoJSON([facility]);
    assert.deepEqual(geojson.features[0].geometry.coordinates,
        [-77.5256119, 37.6205521]);
    assert.equal(cardCtx('lite')._toGeoJSON([
        { permit_id: 'OLD', lat: 37.6, lon: -77.5 },
    ]).features.length, 0, 'retired top-level coordinates must not be accepted');
});

test('the shared-site text is gone, not just hidden', () => {
    // Stacks fan out on the map now (MAP-M1) — the panel calling out a
    // shared point was the only way to learn that before, and is redundant
    // with it now. Guards against a silent re-add, not just a re-hide.
    assert.doesNotMatch(source, /_sharedSiteNote|effectivePointCounts/);
    assert.doesNotMatch(source, /shared by \$\{count\} facility records/);
});

// ── marker-bound dismissal + panel-only interaction (source pins) ─────

test('the card exists only while the pointer remains on its marker', () => {
    assert.match(source, /map\.on\('mouseleave', LYR_POINTS[\s\S]{0,120}?_hideHoverCard\(\)/);
    assert.doesNotMatch(source, /_scheduleHoverHide|_cancelHoverHide|_hoverHideTimer/);
    // Hovering within the same marker still avoids needless re-renders.
    assert.match(source, /if \(this\._hoverPid === f\.permit_id\) return;/);
});

test('hover is display-only; trend and receipt interactions stay in the clicked panel', () => {
    assert.doesNotMatch(source, /_bindHoverCard/);
    assert.doesNotMatch(source, /_showHoverCard[\s\S]{0,600}?getFoodFacilityDetail/);
    assert.match(source, /this\._bindSparkline\(inner, detail\.inspections\)/);
    assert.match(source, /this\._bindGradeReceipt\(inner, detail\.facility, detail\.inspections\)/);
    const interactiveHero = proto._gradeHero.call(cardCtx(), { letter: 'A', score: 97 }, '');
    assert.match(interactiveHero, /data-grade-receipt/);
});

test('the card dismisses when its ground shifts: select, cluster zoom, rebuild', () => {
    assert.match(source, /this\._hideHoverCard\(\);   \/\/ the panel takes over/);
    assert.match(source, /_hideHoverCard\(\);   \/\/ the anchor marker is about to dissolve/);
    // The window is proximity, not contract — it only has to prove the call
    // is at the TOP of the rebuild rather than buried after the redraw.
    assert.match(source, /_rebuildMarkers\(\) \{[\s\S]{0,600}?_hideHoverCard\(\);/);
});

test('the popup sizes per tier and the hero card gets its width', () => {
    assert.match(source, /setMaxWidth\(lite \? '280px' : '380px'\)/);
    // The static preview never runs _bindSparkline, so its initial viewBox must
    // carry enough horizontal room for the enlarged labels to remain distinct.
    assert.match(source, /this\._sparkSvg\(series, 280\)/);
    const css = readFileSync(
        new URL('../public/static/css/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.food-tip,\s*\n\.food-tip \.maplibregl-popup-content \{ pointer-events: none; \}/);
    assert.match(css, /\.food-tip \.food-hover-card \{ width: 352px/);
    assert.match(css, /\.food-tip:has\(\.food-hover-card\) \.maplibregl-popup-content/);
});
