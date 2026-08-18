/** The one search box — name / address / city / ZIP.
 *
 *  The ZIP select is retired (2026-08-18): its exact-match dropdown folded
 *  into the search box, which now tests TWO things and passes a row on either.
 *
 *  The asymmetry is the contract, and it is deliberate:
 *
 *    · name / address / city match ANYWHERE — "taco" finds Taco Bell, "main
 *      st" finds every Main Street address;
 *    · the ZIP matches from the START — "232" means the 232** ZIPs.
 *
 *  A substring test on the ZIP would read the visitor's mind wrong. Measured
 *  against the committed roster (24,990 rows, 648 ZIPs): "231" as a substring
 *  also returns 22311 / 22312 / 22314 / 22315 — Alexandria, 425 extra rows —
 *  when what was typed is a Richmond prefix. The fixtures below carry that
 *  exact pair so the rule cannot be "simplified" back into one includes().
 *
 *  A digit run that is really a street number is still reachable, because the
 *  address rides in the text half: "232" finds "232 Main St" through `hay`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboard, moduleSource } from './support/dashboard.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const proto = dashboard.FoodDashboard.prototype;

// _matchesFilters only reads _filters, _mode, and the three predicates.
const ctx = (filters = {}, mode = 'full') => ({
    _mode: mode,
    _filters: {
        q: '', grade: '', restaurantsOnly: false,
        showClosed: true, showNew: true, showMobile: true, ...filters,
    },
    _isActive: proto._isActive,
    _isNew: proto._isNew,
    _isMobileUnit: proto._isMobileUnit,
});
const hits = (rows, q, mode) => rows
    .filter((f) => proto._matchesFilters.call(ctx({ q }, mode), f))
    .map((f) => f.name);

const ROWS = [
    { name: 'Kyoto', address: '4069 Cox Rd', city: 'Glen Allen', zip: '23060', status: 'Permitted' },
    { name: 'Taco Bell', address: '1401 W Broad St', city: 'Richmond', zip: '23220', status: 'Permitted' },
    { name: 'Sub Rosa', address: '620 N 25th St', city: 'Richmond', zip: '23223', status: 'Permitted' },
    // The counterexample: an Alexandria ZIP that CONTAINS "231" without
    // starting with it. A substring rule drags this in on a Richmond search.
    { name: 'Del Ray Cafe', address: '205 E Howell Ave', city: 'Alexandria', zip: '22311', status: 'Permitted' },
    // A street number that looks like a ZIP prefix — found through the text half.
    { name: 'Number House', address: '232 Mill St', city: 'Occoquan', zip: '22125', status: 'Permitted' },
];

test('the search box matches name, address, and city anywhere in the field', () => {
    assert.deepEqual(hits(ROWS, 'taco'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, 'broad'), ['Taco Bell']);          // mid-address
    assert.deepEqual(hits(ROWS, 'richmond'), ['Taco Bell', 'Sub Rosa']);
    assert.deepEqual(hits(ROWS, 'rosa'), ['Sub Rosa']);            // mid-name
    assert.deepEqual(hits(ROWS, 'zzz'), []);
});

test('the ZIP half matches by PREFIX, so "231" is the 231** ZIPs and not 22311', () => {
    // "232" — both Richmond ZIPs, plus the street number through the text half.
    assert.deepEqual(hits(ROWS, '232'), ['Taco Bell', 'Sub Rosa', 'Number House']);
    // "231" — nothing here starts 231, and the Alexandria 22311 must NOT answer.
    assert.deepEqual(hits(ROWS, '231'), []);
    // A full five-digit ZIP still names exactly one ZIP (the old select's job).
    assert.deepEqual(hits(ROWS, '23220'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, '22311'), ['Del Ray Cafe']);
    // Prefix, not substring: the tail of a ZIP is not a way in.
    assert.deepEqual(hits(ROWS, '3220'), []);
});

test('folding ZIP into search works on the basic map too — it is judgment-free state', () => {
    // Lite carries `zip` on every finder row (both tiers share the finder),
    // so the public site filters by ZIP without any judgment surface.
    assert.deepEqual(hits(ROWS, '23220', 'lite'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, 'richmond', 'lite'), ['Taco Bell', 'Sub Rosa']);
});

test('the ZIP select is gone from the markup and the search box says what it takes', () => {
    assert.doesNotMatch(html, /foodZipFilter|All zips/);   // retired-ok: asserting absence
    assert.doesNotMatch(html, /<select[^>]*id="food/);
    const input = html.match(/<input[^>]*id="foodSearch"[\s\S]*?>/)?.[0] || '';
    // The placeholder has to clear the SQUEEZED box (171px of inner width at
    // the lg breakpoint), not just the roomy one. "Search name, address, or
    // ZIP…" measured 188px and truncated; this is 145px, 26px to spare. The
    // verb is redundant on a type=search input — the aria-label carries the
    // full sentence for screen readers.
    assert.match(input, /placeholder="Name, address, or ZIP…"/);
    assert.match(input, /aria-label="[^"]*ZIP[^"]*"/);
});

test('one predicate owns the rule: the ZIP prefix lives beside the text substring', () => {
    const filters = moduleSource('filters.js');
    assert.match(filters, /!hay\.includes\(q\) && !String\(f\.zip \|\| ''\)\.startsWith\(q\)/);
    // No second, exact-match ZIP test survives alongside it.
    assert.doesNotMatch(filters, /f\.zip !== zip/);
});
