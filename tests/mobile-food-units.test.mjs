/** "Show mobile food units" — the off-by-default toggle for trucks/carts.
 *
 *  A mobile unit's pin is the permit's filing address, not where it parks, so
 *  it answers a different question than the rest of the map and stays hidden
 *  until asked for. The toggle is FULL-TIER ONLY: the lite record is ten
 *  fields and `permit_type` is not one of them, so lite can neither filter
 *  them out nor honestly offer the switch.
 *
 *  Archive shape these pin against (frozen 2026-07-20): 1,881 of 19,147
 *  facilities carry permit_type "Mobile Food Unit", 1,525 of them active.
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
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');

const proto = dashboard.FoodDashboard.prototype;

// _matchesFilters only ever reads _filters, _mode, and the three predicates,
// so a plain object stands in for a booted dashboard.
const ctx = (filters = {}, mode = 'full') => ({
    _mode: mode,
    _filters: {
        q: '', zip: '', grade: '', restaurantsOnly: false,
        showClosed: true, showNew: true, showMobile: false, ...filters,
    },
    _isActive: proto._isActive,
    _isNew: proto._isNew,
    _isMobileUnit: proto._isMobileUnit,
});
const matches = (f, filters, mode) => proto._matchesFilters.call(ctx(filters, mode), f);

const TRUCK = { permit_type: 'Mobile Food Unit', status: 'Permitted', name: 'Taco Truck', zip: '23220' };
const BRICK = { permit_type: 'Full Service Restaurant', status: 'Permitted', name: 'Kyoto', zip: '23220' };

// Every other permit_type VDH publishes, verbatim from the archive.
const OTHER_TYPES = [
    'Full Service Restaurant', 'Fast Food', 'Educational Facility Food Service',
    'Child Care Food Service', 'Carry Out', 'Caterer', 'Commissary', 'Vending',
    'Long Term Care and Other Custodial Living Centers', 'Continental Breakfast',
    'Convenience Store Food Service', 'Hospital Food Service',
    'Correctional Facility', 'Summer Camp Food Service',
];

test('_isMobileUnit reads permit_type, and nothing else in the archive collides', () => {
    assert.equal(proto._isMobileUnit(TRUCK), true);
    for (const t of OTHER_TYPES) {
        assert.equal(proto._isMobileUnit({ permit_type: t }), false, t);
    }
    // Lowercase-substring (the _isActive idiom) so VDH casing or a class
    // suffix still lands. No other type contains the phrase.
    assert.equal(proto._isMobileUnit({ permit_type: 'MOBILE FOOD UNITS' }), true);
    assert.equal(proto._isMobileUnit({ permit_type: 'Mobile Food Unit - Class 3' }), true);
    // A payload without the field must not read as a truck.
    assert.equal(proto._isMobileUnit({}), false);
    assert.equal(proto._isMobileUnit({ permit_type: null }), false);
});

test('trucks are hidden by default and return when the switch goes on', () => {
    assert.equal(matches(TRUCK), false);
    assert.equal(matches(TRUCK, { showMobile: true }), true);
    // The toggle is orthogonal to every other filter — it must not touch
    // brick-and-mortar either way.
    assert.equal(matches(BRICK), true);
    assert.equal(matches(BRICK, { showMobile: true }), true);
});

test('hiding trucks does not smuggle in the other filters', () => {
    // A truck that is also closed/new is still just one exclusion; and with
    // the switch on it obeys the OTHER toggles normally.
    const closedTruck = { ...TRUCK, status: 'Business Closed' };
    assert.equal(matches(closedTruck, { showMobile: true, showClosed: false }), false);
    assert.equal(matches(closedTruck, { showMobile: true, showClosed: true }), true);
    const newTruck = { ...TRUCK, newly_permitted: true };
    assert.equal(matches(newTruck, { showMobile: true, showNew: false }), false);
    // Search and zip still apply to a shown truck.
    assert.equal(matches(TRUCK, { showMobile: true, q: 'taco' }), true);
    assert.equal(matches(TRUCK, { showMobile: true, q: 'sushi' }), false);
});

test('lite is untouched: no permit_type to filter on, so nothing is hidden', () => {
    // The lite record has no permit_type at all. Filtering there would either
    // do nothing (best case) or blank real places, so the guard is `!lite`.
    const liteRecord = { name: 'Taco Truck', zip: '23220', is_restaurant: true };
    assert.equal(matches(liteRecord, {}, 'lite'), true);
    // Even a record that somehow carried the type stays visible in lite.
    assert.equal(matches(TRUCK, {}, 'lite'), true);
    assert.match(
        source,
        /if \(!lite && !showMobile && this\._isMobileUnit\(f\)\) return false;/,
    );
});

test('the switch is wired, persisted, and off unless the key says otherwise', () => {
    assert.match(source, /const SHOW_MOBILE_KEY = 'cleanplateva\.food\.showMobile';/);
    // Default OFF — a missing key must read as hide (=== '1'), the same
    // polarity as Show closed and the inverse of Show new.
    assert.match(source, /showMobile: localStorage\.getItem\(SHOW_MOBILE_KEY\) === '1',/);
    assert.match(source, /getElementById\('foodShowMobile'\)/);
    assert.match(source, /localStorage\.setItem\(SHOW_MOBILE_KEY,/);

    assert.match(html, /id="foodShowMobileWrap"/);
    assert.match(html, /id="foodShowMobile"/);
    assert.match(html, /Show mobile food units<\/label>/);
    // The tooltip has to explain the pin, or "off by default" reads as a bug.
    assert.match(html, /not where the unit parks/);
});

test('every inert lite switch hides — the list matches the !lite guards', () => {
    // A switch that moves nothing is worse than no switch. Show new shipped
    // without its entry here and rendered dead on the public site; this test
    // is the tripwire so the next one does not.
    const rule = css.match(/\.food-mode-lite #foodGradeChips,([\s\S]*?)\}/)?.[1] || '';
    for (const id of ['#foodShowClosedWrap', '#foodShowNewWrap', '#foodShowMobileWrap']) {
        assert.match(rule, new RegExp(`\\.food-mode-lite ${id},`), id);
    }
    assert.match(rule, /display:\s*none/);

    // Each hidden switch must have a matching `!lite` guard, and vice versa.
    const guards = [...source.matchAll(/if \(!lite && !(\w+) &&/g)].map((m) => m[1]);
    assert.deepEqual(guards.sort(), ['showClosed', 'showMobile', 'showNew']);
});
