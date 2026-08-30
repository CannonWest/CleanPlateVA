/** The one search box on the CR stack — ports the behavioral tests of
 *  `tests/search.test.mjs` against `app/search.ts` (C6's search semantics).
 *  The old suite's markup/CSS pins (ZIP select gone, glyph, clear button)
 *  guard the served client and stay with the .mjs original; CRV re-pins the
 *  new chrome per §6.2.
 */
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { matchesFilters, searchTerms, type FilterState } from '../../app/search'
import type { FacilityLike } from '../../app/data/presentation'

const match = (f: FacilityLike, filters: FilterState = {}, mode = 'full') =>
    matchesFilters(f, {
        q: '', grade: '', restaurantsOnly: false,
        showClosed: true, showNew: true, showMobile: true, ...filters,
    }, mode)
const hits = (rows: FacilityLike[], q: string, mode?: string) => rows
    .filter((f) => match(f, { q }, mode))
    .map((f) => f.name)

const ROWS: FacilityLike[] = [
    { name: 'Kyoto', address: '4069 Cox Rd', city: 'Glen Allen', zip: '23060', status: 'Permitted' },
    { name: 'Taco Bell', address: '1401 W Broad St', city: 'Richmond', zip: '23220', status: 'Permitted' },
    { name: 'Sub Rosa', address: '620 N 25th St', city: 'Richmond', zip: '23223', status: 'Permitted' },
    // An Alexandria ZIP that CONTAINS "231" without starting with it.
    { name: 'Del Ray Cafe', address: '205 E Howell Ave', city: 'Alexandria', zip: '22311', status: 'Permitted' },
    // A street number that looks like a ZIP prefix — found through the text.
    { name: 'Number House', address: '232 Mill St', city: 'Occoquan', zip: '22125', status: 'Permitted' },
    // The taqueria on Bell Street: unquoted "taco bell" finds it; quoted, no.
    { name: 'Taqueria El Taco', address: '900 Bell St', city: 'Richmond', zip: '23224', status: 'Permitted' },
    // Joined into one haystack this row reads "casa taco bell ave norfolk".
    { name: 'Casa Taco', address: 'Bell Ave', city: 'Norfolk', zip: '23510', status: 'Permitted' },
]

test('a term matches name, address, and city anywhere in the field', () => {
    assert.deepEqual(hits(ROWS, 'taco'), ['Taco Bell', 'Taqueria El Taco', 'Casa Taco'])
    assert.deepEqual(hits(ROWS, 'broad'), ['Taco Bell']) // mid-address
    assert.deepEqual(hits(ROWS, 'richmond'), ['Taco Bell', 'Sub Rosa', 'Taqueria El Taco'])
    assert.deepEqual(hits(ROWS, 'rosa'), ['Sub Rosa']) // mid-name
    assert.deepEqual(hits(ROWS, 'zzz'), [])
})

test('the ZIP half of a term matches by PREFIX, so "231" is 231** and not 22311', () => {
    assert.deepEqual(hits(ROWS, '232'),
        ['Taco Bell', 'Sub Rosa', 'Number House', 'Taqueria El Taco'])
    assert.deepEqual(hits(ROWS, '231'), [])
    assert.deepEqual(hits(ROWS, '23220'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, '22311'), ['Del Ray Cafe'])
    // Prefix, not substring: the tail of a ZIP is not a way in.
    assert.deepEqual(hits(ROWS, '3220'), [])
})

test('every term must match, and each term may match a DIFFERENT field', () => {
    assert.deepEqual(hits(ROWS, 'richmond taco'), ['Taco Bell', 'Taqueria El Taco'])
    assert.deepEqual(hits(ROWS, 'taco richmond'), ['Taco Bell', 'Taqueria El Taco'])
    assert.deepEqual(hits(ROWS, 'rosa richmond'), ['Sub Rosa'])
    assert.deepEqual(hits(ROWS, '23220 taco'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, '232 rosa'), ['Sub Rosa'])
    assert.deepEqual(hits(ROWS, '231 taco'), [])
    assert.deepEqual(hits(ROWS, 'taco zzz'), [])
    assert.deepEqual(hits(ROWS, 'richmond alexandria'), [])
    assert.deepEqual(hits(ROWS, 'richmond   taco'), ['Taco Bell', 'Taqueria El Taco'])
})

test('a quoted phrase keeps words together, and inside ONE field', () => {
    assert.deepEqual(hits(ROWS, 'taco bell'),
        ['Taco Bell', 'Taqueria El Taco', 'Casa Taco'])
    assert.deepEqual(hits(ROWS, '"taco bell"'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, '"Taco Bell"'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, '"TACO BELL"'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, '"bell ave"'), ['Casa Taco'])
    assert.deepEqual(hits(ROWS, '"w broad st"'), ['Taco Bell'])
    // A phrase that exists only across a seam matches nothing.
    assert.deepEqual(hits(ROWS, '"taco bell ave"'), [])
    assert.deepEqual(hits(ROWS, '"taco bell" richmond'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, '"taco bell" norfolk'), [])
    assert.deepEqual(hits(ROWS, '"casa taco" 235'), ['Casa Taco'])
})

test('an unterminated quote is a phrase, not a dead term', () => {
    assert.deepEqual(hits(ROWS, '"taco bell'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, '"taco'), ['Taco Bell', 'Taqueria El Taco', 'Casa Taco'])
    assert.deepEqual(hits(ROWS, '""'), ROWS.map((f) => f.name))
    assert.deepEqual(hits(ROWS, '"" taco'), ['Taco Bell', 'Taqueria El Taco', 'Casa Taco'])
})

test('searchTerms: quotes group, whitespace splits, empties vanish', () => {
    assert.deepEqual(searchTerms('richmond taco'), ['richmond', 'taco'])
    assert.deepEqual(searchTerms('"taco bell"'), ['taco bell'])
    assert.deepEqual(searchTerms('"taco bell" richmond'), ['taco bell', 'richmond'])
    assert.deepEqual(searchTerms('richmond "taco bell"'), ['richmond', 'taco bell'])
    assert.deepEqual(searchTerms('"taco bell'), ['taco bell']) // unterminated
    assert.deepEqual(searchTerms('a "b c" d'), ['a', 'b c', 'd'])
    assert.deepEqual(searchTerms('  a   b  '), ['a', 'b'])
    assert.deepEqual(searchTerms('""'), [])
    assert.deepEqual(searchTerms('"'), [])
    assert.deepEqual(searchTerms(''), [])
})

test('search works on the basic map too — it is judgment-free state', () => {
    assert.deepEqual(hits(ROWS, '23220', 'lite'), ['Taco Bell'])
    assert.deepEqual(hits(ROWS, 'richmond', 'lite'), ['Taco Bell', 'Sub Rosa', 'Taqueria El Taco'])
    assert.deepEqual(hits(ROWS, '"taco bell"', 'lite'), ['Taco Bell'])
})
