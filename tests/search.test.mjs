/** The one search box — name / address / city / ZIP, words, and phrases.
 *
 *  The ZIP select was retired 2026-08-18 and its exact-match dropdown folded
 *  into this box. Three rules stack, and each exists because the one below it
 *  was not enough:
 *
 *  1. WITHIN A TERM, name / address / city match anywhere, and the ZIP matches
 *     from the START. A substring test on the ZIP answers "231" with
 *     22311 / 22312 / 22314 / 22315 — Alexandria, 425 rows — when what was
 *     typed is a Richmond prefix (measured on the committed 24,990-row roster).
 *
 *  2. ACROSS TERMS, the query splits on whitespace and EVERY term must land,
 *     each free to land in a different field. "richmond taco" is taco in the
 *     name and Richmond in the city; no single substring of the row can say
 *     that, because the address sits between the two fields a visitor pairs.
 *
 *  3. A "QUOTED PHRASE" is one term that must be found whole, and — the part
 *     that is easy to get wrong — found whole *inside a single field*. Rule 2
 *     answers "taco bell" with every taqueria on a Bell Street; quoting is how
 *     a visitor says no to that. Testing the phrase against the fields JOINED
 *     would re-admit the same ghost through the seam: the roster holds 28,250
 *     distinct name|address and address|city boundary bigrams and not one of
 *     them occurs inside a single field, so every one would be a phantom hit.
 *
 *  Bare words are indifferent to rule 3's per-field split — a word has no
 *  space, so it can never straddle a seam — which is why rules 1 and 2 kept
 *  behaving identically when phrase support landed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboard, moduleSource } from './support/dashboard.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const proto = dashboard.FoodDashboard.prototype;
const { searchTerms } = dashboard;

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
    // An Alexandria ZIP that CONTAINS "231" without starting with it. A
    // substring rule drags this in on a Richmond search.
    { name: 'Del Ray Cafe', address: '205 E Howell Ave', city: 'Alexandria', zip: '22311', status: 'Permitted' },
    // A street number that looks like a ZIP prefix — found through the text.
    { name: 'Number House', address: '232 Mill St', city: 'Occoquan', zip: '22125', status: 'Permitted' },
    // The taqueria on Bell Street: unquoted "taco bell" finds it (taco in the
    // name, bell in the address); quoted, it must not appear.
    { name: 'Taqueria El Taco', address: '900 Bell St', city: 'Richmond', zip: '23224', status: 'Permitted' },
    // The structural version of the same trap. Joined into one haystack this
    // row reads "casa taco bell ave norfolk", so a phrase tested against the
    // JOIN rather than against each field comes back for a "taco bell" query.
    { name: 'Casa Taco', address: 'Bell Ave', city: 'Norfolk', zip: '23510', status: 'Permitted' },
];

test('a term matches name, address, and city anywhere in the field', () => {
    assert.deepEqual(hits(ROWS, 'taco'), ['Taco Bell', 'Taqueria El Taco', 'Casa Taco']);
    assert.deepEqual(hits(ROWS, 'broad'), ['Taco Bell']);          // mid-address
    assert.deepEqual(hits(ROWS, 'richmond'), ['Taco Bell', 'Sub Rosa', 'Taqueria El Taco']);
    assert.deepEqual(hits(ROWS, 'rosa'), ['Sub Rosa']);            // mid-name
    assert.deepEqual(hits(ROWS, 'zzz'), []);
});

test('the ZIP half of a term matches by PREFIX, so "231" is 231** and not 22311', () => {
    assert.deepEqual(hits(ROWS, '232'),
        ['Taco Bell', 'Sub Rosa', 'Number House', 'Taqueria El Taco']);
    // Nothing here starts 231, and Alexandria's 22311 must NOT answer.
    assert.deepEqual(hits(ROWS, '231'), []);
    // A full five-digit ZIP still names exactly one ZIP (the old select's job).
    assert.deepEqual(hits(ROWS, '23220'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, '22311'), ['Del Ray Cafe']);
    // Prefix, not substring: the tail of a ZIP is not a way in.
    assert.deepEqual(hits(ROWS, '3220'), []);
});

test('every term must match, and each term may match a DIFFERENT field', () => {
    // No single substring of a row can express this: the address sits between
    // the two fields a visitor pairs. "richmond taco" read as 0 before this.
    assert.deepEqual(hits(ROWS, 'richmond taco'), ['Taco Bell', 'Taqueria El Taco']);
    assert.deepEqual(hits(ROWS, 'taco richmond'), ['Taco Bell', 'Taqueria El Taco']);
    assert.deepEqual(hits(ROWS, 'rosa richmond'), ['Sub Rosa']);
    // A ZIP is just another term, and keeps its prefix rule inside the set.
    assert.deepEqual(hits(ROWS, '23220 taco'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, '232 rosa'), ['Sub Rosa']);
    assert.deepEqual(hits(ROWS, '231 taco'), []);
    // EVERY term, not any: one miss rejects the row.
    assert.deepEqual(hits(ROWS, 'taco zzz'), []);
    assert.deepEqual(hits(ROWS, 'richmond alexandria'), []);
    assert.deepEqual(hits(ROWS, 'richmond   taco'), ['Taco Bell', 'Taqueria El Taco']);
});

test('a quoted phrase keeps words together, and inside ONE field', () => {
    // Unquoted, the words are free to scatter — rule 2 doing its job, and
    // exactly what someone looking for the chain does not want.
    assert.deepEqual(hits(ROWS, 'taco bell'),
        ['Taco Bell', 'Taqueria El Taco', 'Casa Taco']);
    // Quoted, only the row that carries the phrase in one field. Taqueria El
    // Taco (bell is in its ADDRESS) and Casa Taco (whose join reads
    // "casa taco bell ave") both drop out.
    assert.deepEqual(hits(ROWS, '"taco bell"'), ['Taco Bell']);
    // Case-insensitive, like every other term.
    assert.deepEqual(hits(ROWS, '"Taco Bell"'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, '"TACO BELL"'), ['Taco Bell']);
    // A phrase may match any single field, not just the name.
    assert.deepEqual(hits(ROWS, '"bell ave"'), ['Casa Taco']);
    assert.deepEqual(hits(ROWS, '"w broad st"'), ['Taco Bell']);
    // A phrase that exists only across a seam matches nothing.
    assert.deepEqual(hits(ROWS, '"taco bell ave"'), []);
    // Phrases mix with bare terms, and still AND together.
    assert.deepEqual(hits(ROWS, '"taco bell" richmond'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, '"taco bell" norfolk'), []);
    assert.deepEqual(hits(ROWS, '"casa taco" 235'), ['Casa Taco']);
});

test('an unterminated quote is a phrase, not a dead term', () => {
    // The closing quote is usually just not typed yet; treating the whole of
    // `"taco bell` as a term beginning with a quote would match nothing ever.
    assert.deepEqual(hits(ROWS, '"taco bell'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, '"taco'), ['Taco Bell', 'Taqueria El Taco', 'Casa Taco']);
    // Empty quotes contribute no term rather than rejecting every row.
    assert.deepEqual(hits(ROWS, '""'), ROWS.map((f) => f.name));
    assert.deepEqual(hits(ROWS, '"" taco'), ['Taco Bell', 'Taqueria El Taco', 'Casa Taco']);
});

test('searchTerms: quotes group, whitespace splits, empties vanish', () => {
    assert.deepEqual(searchTerms('richmond taco'), ['richmond', 'taco']);
    assert.deepEqual(searchTerms('"taco bell"'), ['taco bell']);
    assert.deepEqual(searchTerms('"taco bell" richmond'), ['taco bell', 'richmond']);
    assert.deepEqual(searchTerms('richmond "taco bell"'), ['richmond', 'taco bell']);
    assert.deepEqual(searchTerms('"taco bell'), ['taco bell']);       // unterminated
    assert.deepEqual(searchTerms('a "b c" d'), ['a', 'b c', 'd']);
    assert.deepEqual(searchTerms('  a   b  '), ['a', 'b']);
    assert.deepEqual(searchTerms('""'), []);
    assert.deepEqual(searchTerms('"'), []);
    assert.deepEqual(searchTerms(''), []);
});

test('search works on the basic map too — it is judgment-free state', () => {
    // Lite carries name/address/city/zip on every finder row (both tiers share
    // the finder), so the public site searches without any judgment surface.
    assert.deepEqual(hits(ROWS, '23220', 'lite'), ['Taco Bell']);
    assert.deepEqual(hits(ROWS, 'richmond', 'lite'), ['Taco Bell', 'Sub Rosa', 'Taqueria El Taco']);
    assert.deepEqual(hits(ROWS, '"taco bell"', 'lite'), ['Taco Bell']);
});

test('the ZIP select is gone from the markup and the box says what it takes', () => {
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

test('one predicate owns the rules: per-field, per-term, ZIP by prefix', () => {
    const filters = moduleSource('filters.js');
    // Fields stay SEPARATE — this is what keeps a phrase off the seam.
    assert.match(filters, /const fields = \[f\.name \|\| '', f\.address \|\| '', f\.city \|\| ''\]/);
    assert.match(filters, /for \(const term of searchTerms\(q\)\)/);
    assert.match(filters, /fields\.some\(\(s\) => s\.toLowerCase\(\)\.includes\(term\)\)/);
    assert.match(filters, /!zip\.startsWith\(term\)/);
    // None of the three superseded shapes may come back: an exact ZIP filter,
    // a whole-query substring, or a joined haystack a phrase can straddle.
    assert.doesNotMatch(filters, /f\.zip !== zip/);
    assert.doesNotMatch(filters, /includes\(q\)/);
    assert.doesNotMatch(filters, /const hay =/);
});
