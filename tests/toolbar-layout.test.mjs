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

test('toolbar splits into a filter cluster and a status cluster', () => {
    assert.match(html, /class="food-toolbar-filters[^"]*"/);
    assert.match(html, /class="food-toolbar-status[^"]*"/);

    // The status cluster is one readout: count + freshness, no wrap.
    const status = html.match(/<div class="food-toolbar-status[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    assert.match(status, /flex-nowrap/);
    assert.match(status, /id="foodCounts"/);
    assert.match(status, /id="foodFetchedAt"/);

    // ms-auto belongs to the group, never to a member of it — that was the bug.
    assert.match(status, /ms-auto/);
    assert.doesNotMatch(html, /class="text-muted small ms-auto" id="foodCounts"/);
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
    // Tier 2 (<1500): short dates, count sheds its unit, narrower search.
    const tier2 = css.match(/@media \(max-width: 1499\.98px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(tier2, /\.food-freshness-full\s*\{\s*display:\s*none/);
    assert.match(tier2, /\.food-freshness-short\s*\{\s*display:\s*inline/);
    assert.match(tier2, /\.food-count-unit\s*\{\s*display:\s*none/);
    assert.match(tier2, /\.food-search\s*\{\s*max-width/);

    // Tier 3 (<1250): freshness hides outright.
    const tier3 = css.match(/@media \(max-width: 1249\.98px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(tier3, /\.food-freshness\s*\{\s*display:\s*none/);

    // Default state is the full phrasing; short is the exception.
    assert.match(css, /\.food-freshness-short\s*\{\s*display:\s*none/);
});

test('nothing the tiers hide is lost — tooltips and About still carry it', () => {
    // Freshness keeps the full phrasing in its own tooltip at every width it
    // is visible; About carries both dates once it hides at the narrowest.
    assert.match(dashboardSource, /Archive snapshot published/);
    // The count keeps its full phrasing regardless of the unit span.
    assert.match(dashboardSource, /countsEl\.title = filtered/);
    assert.match(dashboardSource, /facilities match the active filters/);
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
