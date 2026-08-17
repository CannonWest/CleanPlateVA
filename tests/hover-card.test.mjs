/** The marker-bound hover card under Contract V4: a display-only preview of
 *  the detail panel's grade hero.
 *
 *  The card renders INSTANTLY from the roster row — the finder fields plus
 *  the overlay (`o`, decoded by the shard's column names): grade circle /
 *  NEW badge / no-grade dash and the "Last broad inspection · Last visit"
 *  date cards. It is then ENRICHED with the trend sparkline once the facility
 *  detail arrives — fetched immediately on hover through the same LRU cache
 *  the click panel reads (D-DATA-10, Cannon 2026-08-16). The sparkline plots
 *  the detail's real inspection history through the exact
 *  `_sparkline`/`buildScopeSeries` pipeline the panel uses: one renderer, one
 *  data source, so the card cannot drift from the panel by construction. The
 *  roster's V3 `trend` tuple stream and its `trendInspections` decoder are
 *  retired (design ref §14.1).
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
const { facilityPresentation, isoFromYmd } = dashboard;

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
const lakeside = () => row({}, {
    grade_score: 20, trend_delta: -5, latest_yyyymmdd: 20260402, base_yyyymmdd: 20260204,
    latest_scope_code: 2, latest_out: 3, latest_items: 3,
});
// The detail the hover prefetches — real inspections, newest first.
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

test('the instant card is the hero: circle + date cards, no sparkline yet, no flat grade text', () => {
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
    // …the sparkline waits for the detail…
    assert.doesNotMatch(html, /food-spark/);
    assert.doesNotMatch(html, /No inspection detail available yet/);
    // …and there is no flat text and no raw focused score anywhere.
    assert.doesNotMatch(html, /Grade F · /);
    assert.doesNotMatch(html, /\b92\b/);
    assert.match(html, /6920 Lakeside Ave/);
});

test('the enriched card adds the sparkline from the detail — the panel\'s renderer, the panel\'s rows', () => {
    const html = proto._hoverCardHTML.call(cardCtx(), lakeside(), lakesideDetail());
    assert.match(html, /food-spark/);
    assert.match(html, /3\/3/);          // the honest focused ratio, on the diamond
    assert.doesNotMatch(html, /\b92\b/); // the raw focused score prints nowhere
    assert.match(html, /food-grade-letter">F</);
    // Byte-identical to what the panel's sparkline draws from the same rows.
    const ctx = { _scoreColor: proto._scoreColor, _sparkSvg: proto._sparkSvg };
    const fromRows = proto._sparkline.call(ctx, lakesideDetail().inspections);
    assert.ok(html.includes(fromRows), 'the card embeds the panel sparkline verbatim');
});

test('no grade and newly-permitted keep their hero variants in the card', () => {
    const noGrade = proto._hoverCardHTML.call(cardCtx(), row({ name: 'X' }, {
        latest_yyyymmdd: 20260101, latest_scope_code: 2, latest_out: 0, latest_items: 2,
    }));
    assert.match(noGrade, /No grade yet|no grade yet/);
    assert.match(noGrade, /focused 2-item check/);
    assert.doesNotMatch(noGrade, /data-grade-receipt/); // nothing to break down
    const isNew = proto._hoverCardHTML.call(cardCtx(), row({ name: 'Y' }, {
        new: 1, latest_yyyymmdd: 20260101,
    }), lakesideDetail());
    assert.match(isNew, /food-grade-circle-new/);
    assert.doesNotMatch(isNew, /food-spark/);           // no history to trend
});

test('a graded row with no detail yet circles the grade — sparkless, never blank', () => {
    const html = proto._hoverCardHTML.call(cardCtx(), row({ name: 'Cafe' }, {
        grade_score: 88, latest_yyyymmdd: 20260501, base_yyyymmdd: 20260501,
        latest_scope_code: 1, latest_items: 30,
    }));
    assert.match(html, /food-grade-letter">B</);
    assert.match(html, /Last broad inspection/);
    assert.doesNotMatch(html, /food-spark/);
    assert.doesNotMatch(html, /No inspection detail available yet/);
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
    assert.match(source, /map\.on\('mouseleave', LYR_POINTS[\s\S]{0,120}?_hideHoverCard\(\)/);
    assert.doesNotMatch(source, /_scheduleHoverHide|_cancelHoverHide|_hoverHideTimer/);
    // Hovering within the same marker still avoids needless re-renders.
    assert.match(source, /if \(this\._hoverPid === f\.permit_id\) return;/);
});

test('hover prefetches through the shared detail cache and never re-renders a stale card', () => {
    // The hover path warms the LRU (prefetchDetail), not the click path.
    assert.match(source, /_showHoverCard[\s\S]{0,900}?this\.api\.prefetchDetail\(pid\)/);
    assert.doesNotMatch(source, /_showHoverCard[\s\S]{0,900}?getFoodFacilityDetail/);
    // A late detail for a marker the pointer already left is dropped.
    assert.match(source, /if \(this\._hoverPid !== pid \|\| !detail\?\.available\) return;/);
    // No dwell timer: fetch on hover (D-DATA-10, Cannon).
    assert.doesNotMatch(source, /_hoverDwell|hoverDwellTimer|setTimeout\([^)]*prefetchDetail/);
    // The retired tuple decoder is gone from the whole dashboard.
    assert.doesNotMatch(source, /trendInspections|_trend_event|f\.trend\b/);
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
    assert.match(source, /this\._sparkSvg\(series, 280\)/);
    const css = readFileSync(
        new URL('../public/static/css/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.food-tip,\s*\n\.food-tip \.maplibregl-popup-content \{ pointer-events: none; \}/);
    assert.match(css, /\.food-tip \.food-hover-card \{ width: 352px/);
    assert.match(css, /\.food-tip:has\(\.food-hover-card\) \.maplibregl-popup-content/);
});
