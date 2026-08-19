/** The marker-bound hover card under Contract V4: a display-only preview of
 *  the detail panel's grade hero.
 *
 *  The card renders INSTANTLY and COMPLETELY from the roster row — the finder
 *  fields plus the overlay (`o`, decoded by the shard's column names): grade
 *  circle / NEW badge / no-grade dash, the "Last broad inspection · Last
 *  visit" date cards, and the trend sparkline drawn from the overlay's
 *  `visits` column (CPH, D-DATA-13, 2026-08-18). Nothing is fetched on hover:
 *  the per-hover detail prefetch (D-DATA-10) is retired — on Workers Free the
 *  metered unit is the request. `visitsOf()` turns `visits` back into the
 *  series shape `buildScopeSeries()` builds from a detail, and the SAME
 *  `_sparkSvg` draws both, so the card cannot drift from the panel by
 *  construction — pinned byte-for-byte below. The roster's V3 `trend` tuple
 *  stream and its `trendInspections` decoder stay retired (design ref §14.1). retired-ok: the suite names what must stay retired
 *
 *  Hover never owns interaction. Leaving the marker removes the card
 *  immediately; clicking the marker opens the detail panel, where the trend
 *  and grade receipt remain interactive.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboard, dashboardSource as source } from './support/dashboard.mjs';

const proto = dashboard.FoodDashboard.prototype;
const { facilityPresentation, isoFromYmd, visitsOf, buildScopeSeries } = dashboard;

const rows = (count, out = 0, dupes = 0) => {
    const list = Array.from({ length: count }, (_, index) => ({
        item: index + 1,
        disposition: index < out ? 'OUT' : 'IN',
        compliant: index >= out,
        violation: index < out,
        is_sentinel: false,
    }));
    for (let i = 0; i < dupes; i++) list.push({ ...list[0] });
    return list;
};

// A Contract V4 Full roster row: finder fields + the decoded overlay.
const overlay = (extra = {}) => ({
    grade_score: null, new: 0, trend_delta: null, latest_yyyymmdd: null,
    base_yyyymmdd: null, latest_scope_code: 0, latest_out: null,
    latest_items: null, compliance_pct: null, ...extra,
});
const row = (extra = {}, o = {}) => ({
    permit_id: 'P-1', name: 'Lakeside Grill', address: '6920 Lakeside Ave',
    address2: '', city: 'Richmond', zip: '23228', tenant: 'va-henrico',
    is_restaurant: true, mobile: false, pt: 1, lat: 37.6205521, lon: -77.5256119,
    loc: 0, o: overlay(o), ...extra,
});
// Lakeside Grill's row: the overlay carries the hover series — the same three
// visits the detail below holds, oldest-first, in the ratified encoding:
// the broad 25, then two focused re-checks at 3 OUT of 3 addressed (the
// second's checklist carries a duplicate row; the DISTINCT ratio stays 3/3,
// which is what the exporter writes and the renderer derives).
const lakesideVisits = () => [[1, 20260204, 25], [2, 20260306, 3, 3], [2, 20260402, 3, 3]];
const lakeside = () => row({}, {
    grade_score: 20, trend_delta: -5, latest_yyyymmdd: 20260402, base_yyyymmdd: 20260204,
    latest_scope_code: 2, latest_out: 3, latest_items: 3, visits: lakesideVisits(),
});
// The detail the click panel fetches — real inspections, newest first.
const lakesideDetail = () => ({
    available: true,
    facility: { permit_id: 'P-1' },
    inspections: [
        { date: '2026-04-02', score: 92, checklist_present: true, checklist: rows(3, 3, 1) },
        { date: '2026-03-06', score: null, checklist_present: true, checklist: rows(3, 3) },
        { date: '2026-02-04', score: 25, checklist_present: true, checklist: rows(35, 3) },
    ],
});

const cardCtx = (mode = 'full') => Object.assign(Object.create(proto), {
    _mode: mode,
});

// ── overlay → presentation ─────────────────────────────────────────────

test('overlay dates decode from yyyymmdd and the last-visit date reads from the row', () => {
    assert.equal(isoFromYmd(20260204), '2026-02-04');
    assert.equal(isoFromYmd(0), null);
    assert.equal(isoFromYmd(null), null);
    const fp = facilityPresentation(lakeside());
    assert.equal(fp.latestDate, '2026-04-02');
    assert.equal(fp.latest.scope, 'focused');
    assert.deepEqual([fp.latest.out, fp.latest.count], [3, 3]);
    assert.equal(fp.grade.letter, 'F');
    assert.equal(fp.grade.baseDate, '2026-02-04');
    assert.equal(fp.trendDelta, -5);
    assert.equal(fp.declining, true);
    assert.deepEqual(fp.trend, [], 'no series rides the roster under V4');
});

// ── the card itself ────────────────────────────────────────────────────

test('the instant card is the whole hero: circle + sparkline + date cards, no flat grade text, no fetch', () => {
    const html = proto._hoverCardHTML.call(cardCtx(), lakeside());
    // The hero circle carries the verdict…
    assert.match(html, /food-grade-circle/);
    assert.match(html, /food-grade-letter">F</);
    assert.match(html, /food-grade-score">20</);
    assert.doesNotMatch(html, /data-grade-receipt/);   // display-only preview
    // …the provenance rides as the two date cards from the overlay…
    assert.match(html, /Last broad inspection/);
    assert.match(html, /2\/4\/2026/);
    assert.match(html, /Last visit/);
    assert.match(html, /4\/2\/2026/);
    // …the sparkline is already there, drawn from the row's `visits`…
    assert.match(html, /food-spark/);
    assert.match(html, /3\/3/);          // the honest focused ratio, on the diamond
    assert.doesNotMatch(html, /No inspections on record yet/);
    // …and there is no flat text and no raw focused score anywhere.
    assert.doesNotMatch(html, /Grade F · /);
    assert.doesNotMatch(html, /\b92\b/);
    assert.match(html, /6920 Lakeside Ave/);
});

test('one renderer: the card\'s sparkline from `visits` is byte-identical to the panel\'s from the detail', () => {
    const ctx = { _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg,
        _sparklineFromSeries: proto._sparklineFromSeries };
    const fromRows = proto._sparkline.call(ctx, lakesideDetail().inspections);
    const fromVisits = proto._sparklineFromSeries.call(ctx, visitsOf(lakeside()));
    assert.ok(fromRows.length > 200, 'the panel draws a real plot');
    assert.equal(fromVisits, fromRows, 'same marks, same geometry, same labels');
    const html = proto._hoverCardHTML.call(cardCtx(), lakeside());
    assert.ok(html.includes(fromRows), 'the card embeds the panel sparkline verbatim');
});

test('visitsOf decodes every kind into the series shape buildScopeSeries builds', () => {
    // A history that exercises every mark family, as the exporter encodes it
    // (oldest-first): a tick, a scored broad, an unscored broad (x-slot only),
    // a focused ratio-known, a focused tick, three blanket verdicts, an items
    // verdict, and an unknown verdict code that must degrade to a tick.
    const visits = [
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
    ];
    const series = visitsOf(row({}, { visits }));
    assert.equal(series.events.length, 10);                          // every visit is an x-slot
    assert.deepEqual(series.events.map((e) => e.inspection.date),
        ['2024-01-01', '2024-03-01', '2024-04-01', '2024-05-01', '2024-06-01',
            '2024-07-01', '2024-08-01', '2024-09-01', '2024-10-01', '2024-11-01']);
    assert.deepEqual(series.events.map((e) => e.historyIndex), [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    assert.deepEqual(series.broad.map((e) => [e.index, e.presentation.score]), [[1, 88]]);
    assert.equal(series.events[2].presentation.scope, 'broad');       // the unscored broad…
    assert.equal(series.events[2].presentation.gradeEligible, false); // …is a slot with no mark
    assert.deepEqual(series.focused.map((e) => e.index), [3, 4]);
    const known = dashboard.focusedOutcomePresentation(series.events[3].presentation);
    assert.deepEqual([known.ratioKnown, known.out, known.total, known.tone], [true, 1, 4, 'good']);
    assert.equal(dashboard.focusedOutcomePresentation(series.events[4].presentation).ratioKnown, false);
    assert.deepEqual(series.unknown.map((e) => e.index), [0, 5, 6, 7, 8, 9]);
    const verdicts = series.unknown.map((e) => dashboard.narrativeVerdictPresentation(e.inspection));
    assert.equal(verdicts[0], null);                                  // the plain tick
    assert.deepEqual(verdicts.slice(1, 4).map((v) => [v.verdict, v.height, v.glyph, v.tone, v.count]), [
        ['all_corrected', 100, '✓', 'clear', null],
        ['priority_corrected', 85, '✓', 'good', null],
        ['none_corrected', 0, '✗', 'severe', null],
    ]);
    assert.deepEqual([verdicts[4].verdict, verdicts[4].height, verdicts[4].glyph, verdicts[4].tone, verdicts[4].count],
        ['items', 67, '✓', 'watch', 2]);
    assert.equal(verdicts[5], null);                                  // unknown code → tick
    // Absent, malformed, or non-array visits are simply an empty series.
    assert.equal(visitsOf(row()).events.length, 0);
    assert.equal(visitsOf({ o: { visits: 'nope' } }).events.length, 0);
    assert.equal(visitsOf({ o: { visits: [null, 7] } }).events.length, 2); // slots, both ticks
});

test('the same history through the detail and through visits draws one plot — every kind', () => {
    // The detail-side rows that the visits above encode; the SVGs must agree.
    const detailRows = [
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
        { date: '2024-05-01', score: null, checklist_present: true, checklist: rows(4, 1) },
        { date: '2024-04-01', score: null, checklist_present: true, checklist: rows(30) },
        { date: '2024-03-01', score: 88, checklist_present: true, checklist: rows(30, 2) },
        { date: '2024-01-01', checklist_present: false, checklist: [] },
    ];
    const visits = [
        [0, 20240101], [1, 20240301, 88], [1, 20240401], [2, 20240501, 1, 4], [2, 20240601],
        [3, 20240701, 1], [3, 20240801, 2], [3, 20240901, 3], [3, 20241001, 4, 2, 1], [3, 20241101, 9],
    ];
    const ctx = { _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg,
        _sparklineFromSeries: proto._sparklineFromSeries };
    const fromRows = proto._sparklineFromSeries.call(ctx, buildScopeSeries(detailRows));
    const fromVisits = proto._sparklineFromSeries.call(ctx, visitsOf(row({}, { visits })));
    assert.equal(fromVisits, fromRows);
    assert.match(fromRows, /✓2/);                                     // the counted items verdict
    assert.match(fromRows, /1\/4/);                                   // the focused ratio label
});

test('no grade and newly-permitted keep their hero variants in the card', () => {
    const noGrade = proto._hoverCardHTML.call(cardCtx(), row({ name: 'X' }, {
        latest_yyyymmdd: 20260101, latest_scope_code: 2, latest_out: 0, latest_items: 2,
    }));
    assert.match(noGrade, /No grade yet|no grade yet/);
    assert.match(noGrade, /focused 2-item check/);
    assert.doesNotMatch(noGrade, /data-grade-receipt/); // nothing to break down
    const isNew = proto._hoverCardHTML.call(cardCtx(), row({ name: 'Y' }, {
        new: 1, latest_yyyymmdd: 20260101, visits: [[1, 20260101, 100]],
    }));
    assert.match(isNew, /food-grade-circle-new/);
    assert.doesNotMatch(isNew, /food-spark/);           // nothing to trend yet, even with a visit
});

test('a graded row whose overlay carries no visits circles the grade — sparkless, never blank', () => {
    const html = proto._hoverCardHTML.call(cardCtx(), row({ name: 'Cafe' }, {
        grade_score: 88, latest_yyyymmdd: 20260501, base_yyyymmdd: 20260501,
        latest_scope_code: 1, latest_items: 30,
    }));
    assert.match(html, /food-grade-letter">B</);
    assert.match(html, /Last broad inspection/);
    assert.doesNotMatch(html, /food-spark/);
    assert.doesNotMatch(html, /No inspections on record yet/);
    // A row with nothing at all says so, plainly.
    const bare = proto._hoverCardHTML.call(cardCtx(), row({ name: 'New Place' }));
    assert.match(bare, /No inspections on record yet/);
    assert.doesNotMatch(bare, /food-spark|Last visit/);
});

test('a closed row (the lazy family) shows its status chip', () => {
    const html = proto._hoverCardHTML.call(cardCtx(), row(
        { status: 'Business Closed' }, { grade_score: 71 }));
    assert.match(html, /food-tip-closed">Business Closed</);
});

test('lite keeps the slim finder tip — no hero, no judgment', () => {
    const html = proto._hoverCardHTML.call(cardCtx('lite'), {
        permit_id: 'T', name: 'Taco Truck', address: '1 Main St', city: 'Richmond',
        lat: 37.5, lon: -77.4, loc: 2, mobile: true,
    });
    assert.match(html, /Taco Truck/);
    assert.match(html, /≈ approximate location/);
    for (const banned of ['food-grade-circle', 'food-spark', 'Last visit',
        'data-grade-receipt']) {
        assert.doesNotMatch(html, new RegExp(banned), banned);
    }
});

test('Contract V4 map geometry reads the finder row\'s top-level coordinates', () => {
    // Bound to the prototype, not a bare literal: _toGeoJSON delegates paint
    // to _markerPaint so the map and the spiderfied legs cannot diverge.
    const geojson = cardCtx('lite')._toGeoJSON([{ permit_id: 'P-1', lat: 37.6205521, lon: -77.5256119 }]);
    assert.deepEqual(geojson.features[0].geometry.coordinates,
        [-77.5256119, 37.6205521]);
    // A detail-shaped facility (nested location) still plots — one helper
    // (coordsOf) reads both — and a row with no point is skipped, not thrown.
    assert.equal(cardCtx('lite')._toGeoJSON([
        { permit_id: 'D', location: { lat: 37.6, lon: -77.5 } },
        { permit_id: 'NONE' },
    ]).features.length, 1);
});

test('the shared-site text is gone, not just hidden', () => {
    assert.doesNotMatch(source, /_sharedSiteNote|effectivePointCounts/);
    assert.doesNotMatch(source, /shared by \$\{count\} facility records/);
});

// ── marker-bound dismissal + panel-only interaction (source pins) ─────

test('the card exists only while the pointer remains on its marker', () => {
    // One map-level mousemove now resolves every mark type at once — a padded
    // hit test has to see them together to judge which is nearest — so the
    // card is dismissed by the miss branch rather than by a layer mouseleave.
    assert.match(source, /_onMapHover\(e\) \{[\s\S]{0,240}?if \(!hit\) \{[\s\S]{0,160}?_hideHoverCard\(\)/);
    // Leaving the canvas is not a mousemove, so it needs its own exit.
    assert.match(source, /map\.on\('mouseout'[\s\S]{0,200}?_hideHoverCard\(\)/);
    assert.doesNotMatch(source, /_scheduleHoverHide|_cancelHoverHide|_hoverHideTimer/);
    // Hovering within the same marker still avoids needless re-renders.
    assert.match(source, /if \(this\._hoverPid === f\.permit_id\) return;/);
});

test('hover fetches nothing: no prefetch, no detail read, no dwell timer — the request diet', () => {  // retired-ok: names the retired policy in the test title
    // The hover path touches no API method at all (CPH-M2): the card is a
    // pure function of the roster row. `prefetchDetail` is retired from the  // retired-ok: explains what is asserted absent below
    // client entirely (dead = deleted); the click panel keeps
    // getFoodFacilityDetail + the LRU.
    assert.doesNotMatch(source, /prefetchDetail/);  // retired-ok: asserts the retired prefetch is gone
    assert.doesNotMatch(source, /_showHoverCard[\s\S]{0,900}?getFoodFacilityDetail/);
    assert.doesNotMatch(source, /_hoverCardHTML\(f, detail/);
    assert.doesNotMatch(source, /_hoverDwell|hoverDwellTimer/);
    assert.match(source, /_hoverCardHTML\(f\) \{/);
    assert.match(source, /const series = visitsOf\(f\);/);
    // The retired tuple decoder stays gone from the whole dashboard.
    assert.doesNotMatch(source, /trendInspections|_trend_event|f\.trend\b/);  // retired-ok: asserts the retired roster decoders are gone
});

test('hover is display-only; trend and receipt interactions stay in the clicked panel', () => {
    assert.doesNotMatch(source, /_bindHoverCard/);
    assert.match(source, /this\._bindSparkline\(inner, detail\.inspections\)/);
    assert.match(source, /this\._bindGradeReceipt\(inner, detail\.facility, detail\.inspections\)/);
    const interactiveHero = proto._gradeHero.call(cardCtx(), { letter: 'A', score: 97 }, '');
    assert.match(interactiveHero, /data-grade-receipt/);
});

test('the card dismisses when its ground shifts: select, cluster zoom, rebuild', () => {
    assert.match(source, /this\._hideHoverCard\(\);   \/\/ the panel takes over/);
    assert.match(source, /_hideHoverCard\(\);   \/\/ the anchor marker is about to dissolve/);
    assert.match(source, /_rebuildMarkers\(\) \{[\s\S]{0,600}?_hideHoverCard\(\);/);
});

test('the popup sizes per tier and the hero card gets its width', () => {
    assert.match(source, /setMaxWidth\(lite \? '280px' : '380px'\)/);
    assert.match(source, /dashboard\._sparkSvg\(series, 280\)/);   // one plot markup for both surfaces
    const css = readFileSync(
        new URL('../public/static/css/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.food-tip,\s*\n\.food-tip \.maplibregl-popup-content \{ pointer-events: none; \}/);
    assert.match(css, /\.food-tip \.food-hover-card \{ width: 352px/);
    assert.match(css, /\.food-tip:has\(\.food-hover-card\) \.maplibregl-popup-content/);
});
