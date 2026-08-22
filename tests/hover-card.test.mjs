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
const { facilityPresentation, isoFromYmd, visitsOf, buildScopeSeries,
    approximateLabel, locationClass, fitAnchor, needsReflow, LOCATION_CLASS } = dashboard;

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

test('the card is kept inside the map, on whichever axis the map shrank', () => {
    // `.food-map-wrap` clips its overflow, so a card past the map's edge is
    // not merely ugly — the overhang is cut off. And BOTH edges move now: the
    // splitter trades width with the side panel and height with the stacked
    // bottom bar, so the box a card must fit is the map's own rect, which
    // shrinks on whichever axis was dragged. Measured with the panel open: a
    // card near the right edge ran 66px past it. MapLibre flips at the left
    // and top edges by itself, but did not at the right.
    //
    // Anchor names say where the POPUP'S corner sits, so they read inverted:
    // hanging off the RIGHT edge is fixed by anchoring 'right', which puts the
    // card to the LEFT of its point.
    const view = { left: 100, top: 100, right: 800, bottom: 700 };
    const card = (left, top, w = 220, h = 60) =>
        ({ left, top, right: left + w, bottom: top + h });

    // Comfortably inside: nothing to do, so nothing re-renders.
    assert.equal(fitAnchor(card(300, 300), view), null);

    // Off one edge at a time.
    assert.equal(fitAnchor(card(700, 300), view), 'right');       // over the RIGHT
    assert.equal(fitAnchor(card(20, 300), view), 'left');         // over the LEFT
    assert.equal(fitAnchor(card(300, 680), view), 'bottom');      // over the BOTTOM
    assert.equal(fitAnchor(card(300, 60), view), 'top');          // over the TOP

    // A corner needs both, vertical component first (MapLibre's order).
    assert.equal(fitAnchor(card(700, 680), view), 'bottom-right');
    assert.equal(fitAnchor(card(20, 60), view), 'top-left');

    // Correcting an anchor that already has a component REPLACES the opposite
    // one rather than stacking a contradiction like "left-right".
    assert.equal(fitAnchor(card(700, 300), view, 'left'), 'right');
    assert.equal(fitAnchor(card(700, 300), view, 'top'), 'top-right');
    assert.equal(fitAnchor(card(300, 680), view, 'top'), 'bottom');

    // The stacked case: the bottom bar has taken the lower half, so the map's
    // box ends higher and a card that used to fit now does not.
    const short = { left: 100, top: 100, right: 800, bottom: 400 };
    assert.equal(fitAnchor(card(300, 360), short), 'bottom');   // bottom 420 > 400
    assert.equal(fitAnchor(card(300, 300), short), null);       // bottom 360 still fits
    // The very same card is fine in the taller box — which is the point: the
    // fit is against the map's CURRENT rect, so dragging the bottom bar up
    // changes the answer without anything else being told.
    assert.equal(fitAnchor(card(300, 360), view), null);
});

test('and the last few pixels are nudged, because an anchor cannot centre it', () => {
    // An anchor only ever puts the card to one SIDE of its point. Once the card
    // is nearly as wide as the map, BOTH sides overflow and flipping just
    // trades which edge is lost — measured on production with the panel at
    // 900px: a 341px card in a 349px map went over the left edge, was
    // re-anchored, and then hung 178px over the right. Only an offset can sit
    // a card on the MAP's centre rather than on its point's.
    assert.match(source, /_nudgeCardIntoView\(\) \{/);
    assert.match(source, /if \(card\.right > view\.right\) ex = view\.right - card\.right;/);
    assert.match(source, /if \(card\.bottom > view\.bottom\) ey = view\.bottom - card\.bottom;/);
    assert.match(source, /popup\.setOffset\(\[Math\.round\(dx\), Math\.round\(dy\)\]\)/);
    // Two passes, and the second is not belt-and-braces: swapping the plain
    // standoff for an explicit offset moves the card BY that standoff, so a
    // correction measured under the old regime lands one standoff short —
    // measured live as exactly 12px of overhang left behind.
    assert.match(source, /for \(let pass = 0; pass < 2; pass \+= 1\)/);
    // It runs AFTER the anchor pass, so it only has the remainder to fix.
    assert.match(source, /if \(fixed\) place\(fixed\);[\s\S]{0,600}?this\._nudgeCardIntoView\(\);/);
    // ...and every card starts from the plain standoff, or a nudge left over
    // from the last one would bias the measurement taken after this one.
    assert.match(source, /popup\.setOffset\(TIP_OFFSET\);/);
    // A map with no box yet constrains nothing. Insetting a zero rect inverts
    // it, and the nudge then "corrects" against an impossible box — seen live
    // in a tab that had not laid out: a 220px card shoved to a [232, 118]
    // offset because the map measured 0 wide.
    assert.match(source, /if \(!r \|\| r\.width <= 0 \|\| r\.height <= 0\) \{/);
    assert.match(source, /left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity/);
    assert.match(source, /Number\.isFinite\(room\)/);
});

test('the card exists only while the pointer remains on its marker', () => {
    // One map-level mousemove now resolves every mark type at once — a padded
    // hit test has to see them together to judge which is nearest — so the
    // card is dismissed by the miss branch rather than by a layer mouseleave.
    assert.match(source, /_onMapHover\(e\) \{[\s\S]{0,1000}?if \(!hit\) \{[\s\S]{0,160}?_hideHoverCard\(\)/);
    // ...but a mousemove that came from a spider leg is that LEG's business:
    // it opens its own card, and this handler must not hide it right back.
    assert.match(source, /closest\?\.\('\.maplibregl-marker'\)\) return;[\s\S]{0,120}?_pickMarkAt/);
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
    assert.match(source, /_rebuildMarkers\(\) \{[\s\S]{0,1200}?_hideHoverCard\(\);/);
});

test('the popup sizes per tier and the hero card gets its width', () => {
    // The tier still decides the card's ambition, but the MAP decides its
    // ceiling: neither width may exceed the box it is drawn in, because the
    // wrap clips its overflow. Measured with the panel dragged to 900px on a
    // 1280px window — a 349px map against a 380px hero, 217px lost off the
    // right edge — and the same on the other axis once the stacked bar is
    // dragged up: a 193px map against a 263px card, 179px lost into the panel.
    assert.match(source, /Math\.max\(TIP_MIN_WIDTH, Math\.min\(tier, room\)\) : tier/);
    assert.match(source, /const tier = lite \? 280 : 380;/);
    assert.match(source, /content\.style\.maxHeight = Number\.isFinite\(headroom\)/);
    // The cap lands on the CONTENT while the overflow is measured on the
    // OUTER box, so the popup's own chrome comes off the allowance —
    // measured, not hardcoded, because the slim tip and the hero card pad
    // differently. Live it was 9px, left over the top of a 245px map.
    assert.match(source, /const chrome = el\.getBoundingClientRect\(\)\.height/);
    assert.match(source, /const TIP_MIN_WIDTH = 220;/);
    // The height floor is near-nothing on purpose: anything above the room
    // available means the card hangs over the very bar this keeps it off —
    // 18px of overhang on a 95px map when the floor was 96.
    assert.match(source, /const TIP_MIN_HEIGHT = 40;/);
    assert.match(source, /dashboard\._sparkSvg\(series, 280\)/);   // one plot markup for both surfaces
    const css = readFileSync(
        new URL('../public/static/css/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.food-tip,\s*\n\.food-tip \.maplibregl-popup-content \{ pointer-events: none; \}/);
    assert.match(css, /\.food-tip \.food-hover-card \{ width: 352px/);
    // The height cap is a variable because only the module knows the map's
    // current height — the splitter changes it on every drag frame.
    assert.match(css, /\.food-tip \.maplibregl-popup-content \{ overflow: hidden; \}/);
    assert.match(css, /\.food-tip:has\(\.food-hover-card\) \.maplibregl-popup-content/);
});

// ── approximate-location qualifiers (venue-anchor arc, 2026-08-19) ─────

test('the loc vocabulary is append-only and venue is the appended class', () => {
    // A `loc` code is positional identity: renumbering would make every shard
    // already on disk mean something else.
    assert.deepEqual(LOCATION_CLASS,
        { rooftop: 0, street: 1, zip_centroid: 2, venue: 3 });
});

test('a VGIN road centreline is street-level, not rooftop', () => {
    // The exporter left `vgin_street` out of V4_LOC_CLASS from CPD-M1 until
    // 2026-08-22, so 83 live rows published a road centreline as an
    // unqualified building pin. Both halves of the map now agree.
    assert.equal(locationClass({ location: { source: 'vgin_street' } }),
        LOCATION_CLASS.street);
    assert.equal(approximateLabel({ location: { source: 'vgin_street' } }),
        'street-level');
});

test('a venue-anchored site classifies and labels as venue-level', () => {
    assert.equal(locationClass({ loc: 3 }), LOCATION_CLASS.venue);
    // A detail-shaped facility derives the same class from its source.
    assert.equal(locationClass({ location: { source: 'venue_anchor' } }),
        LOCATION_CLASS.venue);
    assert.equal(approximateLabel({ loc: 3 }), 'venue-level');
});

test('every class but rooftop is qualified, and rooftop is never qualified', () => {
    assert.equal(approximateLabel({ loc: 0 }), '');
    assert.equal(approximateLabel({ loc: 1 }), 'street-level');
    assert.equal(approximateLabel({ loc: 2 }), 'approximate location');
    assert.equal(approximateLabel({ loc: 3 }), 'venue-level');
});

test('BOTH tiers qualify an approximate pin on hover, not just lite', () => {
    // Until 2026-08-19 only the lite card carried the note, so the tier with
    // MORE information gave LESS warning: a full-tier hover over a DCA
    // concession showed a Crystal City rooftop with no hint it was a centroid.
    const row = (loc) => ({
        permit_id: 'V', name: 'DCA - Five Guys', address: 'WNA- Concourse D',
        city: 'Arlington', lat: 38.8527, lon: -77.0427, loc,
    });
    for (const [loc, label] of [[2, 'approximate location'], [3, 'venue-level'],
        [1, 'street-level']]) {
        for (const mode of ['lite', 'full']) {
            const html = proto._hoverCardHTML.call(cardCtx(mode), row(loc));
            assert.match(html, new RegExp(`≈ ${label}`), `${mode} loc=${loc}`);
        }
    }
    for (const mode of ['lite', 'full']) {
        assert.doesNotMatch(proto._hoverCardHTML.call(cardCtx(mode), row(0)), /≈ /,
            `${mode} must not qualify a rooftop pin`);
    }
});

test('the detail panel explains the venue class rather than claiming a building', () => {
    const note = proto._geoNote.call(cardCtx('full'), { loc: 3 });
    assert.match(note, /≈ venue-level/);
    assert.match(note, /food-approx-venue/);
    // The claim has to hold for the WEAKEST case the class covers — a campus
    // spread over many buildings — so it must not say "the building".
    assert.doesNotMatch(note, /not the building/);
    assert.match(note, /not at its own unit/);
    assert.equal(proto._geoNote.call(cardCtx('full'), { loc: 0 }), '');
});

test('an open card is placed AGAIN when the map moves out from under it', () => {
    // Placement is only true for the geometry it was measured in, and two
    // things move that geometry while a card is still on screen: the splitter
    // (horizontally against the sidebar, vertically against the bottom bar)
    // and a pan or zoom sliding the card's own point across the map. Measured
    // on production before this existed — a card placed in an 814px map sat
    // 147px behind the sidebar after a drag to 341px, and a 160px pan carried
    // another one exactly 160px out.
    const view = { left: 100, top: 100, right: 800, bottom: 700 };
    const card = (left, top, w = 300, h = 120) => ({
        left, top, width: w, height: h, right: left + w, bottom: top + h,
    });

    const short = { left: 100, top: 100, right: 800, bottom: 400 };
    const placed = (v, nudged) => ({ view: v, nudged });

    // Nothing owed: inside the box, no offset being carried.
    assert.equal(needsReflow(card(300, 300), view, placed(view, false)), false);

    // Each edge on its own — the sidebar's edge and the bottom bar's edge are
    // the two this exists for, but all four are the same rule.
    assert.equal(needsReflow(card(600, 300), view, placed(view, false)), true); // past RIGHT
    assert.equal(needsReflow(card(20, 300), view, placed(view, false)), true);  // past LEFT
    assert.equal(needsReflow(card(300, 650), view, placed(view, false)), true); // past BOTTOM
    assert.equal(needsReflow(card(300, 40), view, placed(view, false)), true);  // past TOP

    // A card sitting flush against the edge is INSIDE — the nudge lands them
    // there deliberately, and treating flush as stale would re-show for ever.
    assert.equal(needsReflow(card(500, 300), view, placed(view, false)), false); // right = 800

    // A NUDGED card whose map has since changed shape: the offset was owed to
    // the old box, and holding it once the splitter hands the room back leaves
    // the card stranded away from its marker.
    assert.equal(needsReflow(card(300, 300), view, placed(short, true)), true);

    // ...but a nudged card in the SAME box is where it belongs. This is the
    // difference that makes the rule affordable: "nudged" is permanent — a
    // card pinned to an edge stays pinned — so reflowing on it alone would
    // re-show on every move event for ever, ~24ms a time against 25k markers.
    assert.equal(needsReflow(card(300, 300), view, placed(view, true)), false);
    // Sub-pixel jitter in the measured rect is not the splitter moving —
    // checked on every edge, because rounding one of the four and not the
    // rest puts the reflow straight back onto every frame.
    for (const edge of ['left', 'top', 'right', 'bottom']) {
        const jitter = { ...view, [edge]: view[edge] + 0.3 };
        assert.equal(needsReflow(card(300, 300), jitter, placed(view, true)), false,
            `sub-pixel jitter on ${edge} must not count as the box moving`);
    }
    // A whole pixel is: that is the splitter, and the nudge is owed to the box
    // it was measured in.
    for (const edge of ['left', 'top', 'right', 'bottom']) {
        const moved = { ...view, [edge]: view[edge] + (edge === 'right' || edge === 'bottom' ? -40 : 40) };
        assert.equal(needsReflow(card(300, 300), moved, placed(view, true)), true,
            `a real move of ${edge} must re-place a nudged card`);
    }

    // An un-nudged card in a changed box is fine where it is — it was never
    // relying on the room that moved.
    assert.equal(needsReflow(card(300, 300), view, placed(short, false)), false);

    // An unmeasured map constrains nothing, so nothing about it is stale —
    // otherwise a booting or hidden tab reflows on every frame.
    const nowhere = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    assert.equal(needsReflow(card(300, 300), nowhere, placed(view, true)), false);
    assert.equal(needsReflow(card(-9e9, -9e9), nowhere, placed(view, false)), false);

    // A card with no box has not been laid out; there is nothing to measure.
    assert.equal(needsReflow(card(300, 300, 0, 0), view, placed(short, true)), false);
    assert.equal(needsReflow(null, view, placed(short, true)), false);
    // And no placement record at all — the first move after a boot — is not a
    // reason to re-show something that is sitting inside the map.
    assert.equal(needsReflow(card(300, 300), view, null), false);

    // The stacked axis specifically: the same card, the same position, but the
    // bottom bar has taken the lower half. Stale in the short box, fine in the
    // tall one — which is the whole point of measuring rather than caching.
    assert.equal(needsReflow(card(300, 320), short, placed(short, false)), true); // 440 > 400
    assert.equal(needsReflow(card(300, 320), view, placed(view, false)), false);
});

test('...and the reflow is wired to both map events, and remembers what to re-place', () => {
    // A resize is not a move and a move is not a resize: the splitter fires
    // one, a pan fires the other, and each leaves a card behind on its own.
    assert.match(source, /map\.on\('resize',\s*\(\)\s*=>\s*this\._scheduleHoverReflow\(\)\)/);
    assert.match(source, /map\.on\('move',\s*\(\)\s*=>\s*this\._scheduleHoverReflow\(\)\)/);
    // SCHEDULED, never called straight from the listener. These are registered
    // when the map is built, before any popup exists, so they run before
    // MapLibre has moved the card — measured live, the listener read the
    // card's top as 185 while it was really at 385, and a single jump pushed
    // a card clean out of the map with the gate seeing nothing wrong.
    assert.doesNotMatch(source, /map\.on\('(?:move|resize)',\s*\(\)\s*=>\s*this\._reflowHoverCard\(\)\)/);
    // A microtask, so the correction lands before paint rather than a frame
    // later, and coalesced, because one splitter drag fires move AND resize.
    const sched = /_scheduleHoverReflow\(\) \{([\s\S]*?)\n    \},/.exec(source);
    assert.ok(sched, 'the reflow must be schedulable');
    assert.match(sched[1], /queueMicrotask/);
    assert.match(sched[1], /if \(this\._hoverReflowQueued\) return;/);
    assert.match(sched[1], /this\._hoverReflowQueued = false;[\s\S]*?this\._reflowHoverCard\(\)/);

    // Re-placing needs the arguments the card was shown with; nothing else
    // holds them, since the popup knows its position but not its facility.
    assert.match(source, /this\._hoverShown\s*=\s*\{\s*lngLat,\s*f,\s*below\s*\}/);
    assert.match(source, /_hideHoverCard\(\)\s*\{[\s\S]{0,160}?this\._hoverShown\s*=\s*null/);
    assert.match(source, /_hideHoverCard\(\)\s*\{[\s\S]{0,200}?this\._hoverPlaced\s*=\s*null/);
    // The placement record is taken AFTER the nudge, or it would never see one.
    const nudgeAt = source.indexOf('this._nudgeCardIntoView();');
    const placedAt = source.indexOf('this._hoverPlaced = {');
    assert.ok(nudgeAt > -1 && placedAt > nudgeAt,
        'the placement box must be recorded after the nudge that may set the flag');
    // ...and it must record the flag the nudge actually set. Pinning it to a
    // constant compiles, passes, and quietly means a card never hands its
    // offset back when the splitter returns the room.
    assert.match(source,
        /this\._hoverPlaced\s*=\s*\{\s*view:\s*this\._mapViewBox\(\),\s*nudged:\s*this\._hoverNudged\s*\}/);

    // The nudge flag is cleared BEFORE the early returns, not after: a stale
    // flag left by the previous card would re-place this one for no reason,
    // every frame of every pan.
    const nudge = source.slice(source.indexOf('_nudgeCardIntoView()'));
    const cleared = nudge.indexOf('this._hoverNudged = false');
    const firstReturn = nudge.indexOf('return;');
    assert.ok(cleared > -1 && cleared < firstReturn,
        'the nudge flag must be cleared before _nudgeCardIntoView can return early');

    // Panel coverage must stay OUT of the gate. `is-yielded` is opacity, not
    // layout, so a yielded panel keeps its box: a card resting over one stays
    // "covering" it and would re-show on every frame for ever.
    // Anchored on the DEFINITION, not the first mention: map.js's wiring calls
    // `this._reflowHoverCard()` and appears earlier in the concatenated
    // source, so slicing from the bare name reads the wrong module and the
    // assertion passes no matter what the method does.
    const gate = /_reflowHoverCard\(\) \{([\s\S]*?)\n    \},/.exec(source);
    assert.ok(gate, 'the reflow method must be defined');
    assert.doesNotMatch(gate[1], /_panelCoveredBy/);
});
