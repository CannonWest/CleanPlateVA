/** The toolbar is a one-row budget, and it used to blow it.
 *
 *  Nine flat flex children with the match count carrying `ms-auto` meant an
 *  overflowing toolbar stranded the count on row 1 while freshness + refresh
 *  dropped to row 2 — the status readout torn in half, ~39px of map gone. It
 *  overflowed at 1445px, i.e. on every 1366 and 1440 laptop.
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

test('toolbar splits into a filter cluster and a status cluster', () => {
    assert.match(html, /class="food-toolbar-filters[^"]*"/);
    assert.match(html, /class="food-toolbar-status[^"]*"/);

    // The status cluster is one readout: count, freshness, refresh, no wrap.
    const status = html.match(/<div class="food-toolbar-status[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    assert.match(status, /flex-nowrap/);
    assert.match(status, /id="foodCounts"/);
    assert.match(status, /id="foodFetchedAt"/);
    assert.match(status, /id="foodRefreshBtn"/);

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

    // Tier 3 (<1220): freshness hides outright.
    const tier3 = css.match(/@media \(max-width: 1219\.98px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(tier3, /\.food-freshness\s*\{\s*display:\s*none/);

    // Default state is the full phrasing; short is the exception.
    assert.match(css, /\.food-freshness-short\s*\{\s*display:\s*none/);
});

test('nothing the tiers hide is lost — tooltips and About still carry it', () => {
    // Freshness hides entirely under 1220px, so refresh inherits the dates.
    assert.match(dashboardSource, /refreshBtn\.title = `Re-read the inspection data/);
    // The count keeps its full phrasing regardless of the unit span.
    assert.match(dashboardSource, /countsEl\.title = filtered/);
    assert.match(dashboardSource, /facilities match the active filters/);
});

test('counts read as a quantity, not a code', () => {
    // Five-digit statewide totals need separators: "19147" reads as an id.
    assert.match(dashboardSource, /total\.toLocaleString\(\)/);
    assert.match(dashboardSource, /filteredLen\.toLocaleString\(\)/);
    // An active filter is announced on the pill, not just in the number.
    assert.match(dashboardSource, /classList\.toggle\('is-filtered', filtered\)/);
    assert.match(css, /\.food-count\.is-filtered\s*\{/);
});
