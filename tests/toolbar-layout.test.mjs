/** The toolbar is a one-row budget, and it used to blow it.
 *
 *  Nine flat flex children with the match count carrying `ms-auto` meant an
 *  overflowing toolbar stranded the count on row 1 while freshness (and the
 *  since-removed refresh button) dropped to row 2 — the status readout torn
 *  in half, ~39px of map gone. It overflowed at 1445px, i.e. on every 1366
 *  and 1440 laptop.
 *
 *  These pin the two things that fixed it: the status parts are one
 *  non-splitting group, and the readout degrades by tier instead of wrapping.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');
const dashboardSource = readFileSync(
    new URL('../public/static/js/foodDashboard.js', import.meta.url),
    'utf8',
);
const appSource = readFileSync(
    new URL('../public/static/js/app.js', import.meta.url),
    'utf8',
);

// When the window is too narrow for a side panel, the detail view stacks under
// the map. An open facility is the point, so the panel takes the MAJORITY of the
// height (map is context) — lock the intent, not the exact number (2026-07-22).
test('narrow layout: the stacked detail panel gets the majority of the height', () => {
    const stackQuery = css.match(/@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(stackQuery, 'the max-width:900px stacking query exists');
    const maxH = stackQuery[1].match(/\.food-detail\s*\{[\s\S]*?max-height:\s*(\d+)%/);
    assert.ok(maxH, '.food-detail sets a max-height in the stacking query');
    assert.ok(Number(maxH[1]) > 50,
        `stacked panel should take >50% of the body (map is context); got ${maxH[1]}%`);
});

test('toolbar splits into a filter cluster and a status cluster', () => {
    assert.match(html, /class="food-toolbar-filters[^"]*"/);
    assert.match(html, /class="food-toolbar-status[^"]*"/);

    // The status cluster is the count. Freshness moved to the footer (see
    // below); the cluster stays a group so anything added here wraps intact.
    const status = html.match(/<div class="food-toolbar-status[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    assert.match(status, /flex-nowrap/);
    assert.match(status, /id="foodCounts"/);
    assert.doesNotMatch(status, /id="foodFetchedAt"/);

    // ms-auto belongs to the group, never to a member of it — that was the bug.
    assert.match(status, /ms-auto/);
    assert.doesNotMatch(html, /class="text-muted small ms-auto" id="foodCounts"/);
});

test('freshness lives in the footer, opposite the provenance line', () => {
    const footer = html.match(/<div class="food-source-footer[\s\S]*?\n {8}<\/div>/)?.[0] || '';
    assert.ok(footer, 'footer markup found');
    assert.match(footer, /id="foodFetchedAt"/);
    assert.match(footer, /class="food-freshness"/);
    // text-muted would beat --cp-muted via Bootstrap's !important; the footer
    // comment says so, and the moved element must not drag it along.
    assert.doesNotMatch(footer, /text-muted/);

    // Provenance and dates are two flex children pushed apart, allowed to
    // wrap onto separate rows rather than either side truncating.
    const rule = css.match(/\.food-source-footer\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(rule, /display:\s*flex/);
    assert.match(rule, /flex-wrap:\s*wrap/);
    assert.match(rule, /justify-content:\s*space-between/);
});

test('filters cluster grows rather than trusting its wrap-folded max-content', () => {
    // A flex-wrap container reports an already-folded max-content width, so at
    // flex-basis:auto the cluster under-sizes itself and wraps a switch away
    // while free space sits unused beside it. flex-grow is the fix.
    const rule = css.match(/\.food-toolbar-filters\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(rule, /flex:\s*1\s+1\s+auto/);
    assert.match(rule, /min-width:\s*0/);
    assert.match(css, /\.food-toolbar-status\s*\{[^}]*flex:\s*0\s+0\s+auto/);
});

test('status degrades in tiers instead of wrapping the toolbar', () => {
    // Under 1500 the count sheds its unit and the search narrows, buying the
    // filter cluster room for its four switches.
    const blocks = [...css.matchAll(/@media \(max-width: 1499\.98px\)\s*\{([\s\S]*?)\n\}/g)]
        .map((m) => m[1]).join('\n');
    assert.match(blocks, /\.food-count-unit\s*\{\s*display:\s*none/);
    assert.match(blocks, /\.food-search\s*\{\s*max-width/);

    // Same width drops the dates to their short form before the footer wraps.
    assert.match(blocks, /\.food-freshness-full\s*\{\s*display:\s*none/);
    assert.match(blocks, /\.food-freshness-short\s*\{\s*display:\s*inline/);

    // Default state is the full phrasing; short is the exception.
    assert.match(css, /\.food-freshness-short\s*\{\s*display:\s*none/);
});

test('freshness is never hidden outright — that is why it left the toolbar', () => {
    // The old tier 3 dropped the dates entirely under 1250px because the bar
    // had no room. In the footer they wrap instead, so no rule may hide them.
    assert.doesNotMatch(css, /\.food-freshness\s*\{[^}]*display:\s*none/);
    // And nothing hides the footer that now holds them.
    assert.doesNotMatch(css, /\.food-source-footer\s*\{[^}]*display:\s*none/);
});

test('nothing the tiers hide is lost — tooltips and About still carry it', () => {
    // Freshness keeps the full phrasing in its own tooltip at every width.
    assert.match(dashboardSource, /Archive snapshot published/);
    // The count keeps its full phrasing regardless of the unit span.
    assert.match(dashboardSource, /countsEl\.title = filtered/);
    assert.match(dashboardSource, /facilities match the active filters/);
});

test('the footer states coverage as ZIPs; the facility total is the pill and About', () => {
    // The footer used to repeat the total the toolbar pill already shows
    // live against the active filters. ZIP coverage is the fact only it had.
    assert.match(dashboardSource, /coverageEl\.textContent = ` · \$\{zips\}/);
    assert.doesNotMatch(dashboardSource, /coverageEl\.textContent =[\s\S]{0,120}facilities/);
    // About remains the durable record of both numbers.
    assert.match(dashboardSource, /setText\('aboutCoverageCount'/);
});

test('the refresh button is gone, and so is its plumbing', () => {
    // It re-downloaded the 37MB roster with the HTTP cache bypassed to render
    // what was almost always the identical snapshot: publishing is manual, so
    // nothing changes between page load and a click. Scrapped 2026-07-19.
    assert.doesNotMatch(html, /foodRefreshBtn/);
    assert.doesNotMatch(dashboardSource, /foodRefreshBtn|forceRefresh/);
    assert.doesNotMatch(css, /food-refresh-btn/);
    // The button was the only caller that ever forced a reload, so the whole
    // cache-busting path goes with it — no dead parameter left threaded
    // through fetchJSON -> getFoodFacilities -> refresh.
    assert.doesNotMatch(appSource, /forceRefresh|cache: 'reload'/);
});

test('counts read as a quantity, not a code', () => {
    // Five-digit statewide totals need separators: "19147" reads as an id.
    assert.match(dashboardSource, /total\.toLocaleString\(\)/);
    assert.match(dashboardSource, /filteredLen\.toLocaleString\(\)/);
    // An active filter is announced on the pill, not just in the number.
    assert.match(dashboardSource, /classList\.toggle\('is-filtered', filtered\)/);
    assert.match(css, /\.food-count\.is-filtered\s*\{/);

    // The glyph holds the noun once the tier rules drop "facilities", so the
    // narrow pill never reduces to a bare number. Decorative, not announced.
    assert.match(dashboardSource, /class="bi bi-buildings" aria-hidden="true"/);
    assert.match(css, /\.food-count\s*\{[^}]*display:\s*inline-flex/);
});
