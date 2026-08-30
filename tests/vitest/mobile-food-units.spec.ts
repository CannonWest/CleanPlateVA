/** "Show mobile food units" on the CR stack — ports the predicate + filter
 *  tests of `tests/mobile-food-units.test.mjs` against `app/search.ts` (C9:
 *  `mobile` ≡ "Mobile Food Unit", `is_restaurant` never derived from `pt`).
 *  The old suite's toolbar-wiring/CSS pins guard the served client and stay
 *  with the .mjs original; CRV re-pins the new chrome.
 */
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isMobileUnit, matchesFilters, type FilterState } from '../../app/search'
import type { FacilityLike } from '../../app/data/presentation'

const matches = (f: FacilityLike, filters: FilterState = {}, mode = 'full') =>
    matchesFilters(f, {
        q: '', grade: '', restaurantsOnly: false,
        showClosed: true, showNew: true, showMobile: false, ...filters,
    }, mode)

const TRUCK: FacilityLike = { permit_type: 'Mobile Food Unit', status: 'Permitted', name: 'Taco Truck', zip: '23220' }
const BRICK: FacilityLike = { permit_type: 'Full Service Restaurant', status: 'Permitted', name: 'Kyoto', zip: '23220' }

// Every other permit_type VDH publishes, verbatim from the archive.
const OTHER_TYPES = [
    'Full Service Restaurant', 'Fast Food', 'Educational Facility Food Service',
    'Child Care Food Service', 'Carry Out', 'Caterer', 'Commissary', 'Vending',
    'Long Term Care and Other Custodial Living Centers', 'Continental Breakfast',
    'Convenience Store Food Service', 'Hospital Food Service',
    'Correctional Facility', 'Summer Camp Food Service',
]

test('isMobileUnit reads permit_type, and nothing else in the archive collides', () => {
    assert.equal(isMobileUnit(TRUCK), true)
    for (const t of OTHER_TYPES) {
        assert.equal(isMobileUnit({ permit_type: t }), false, t)
    }
    // Lowercase-substring so VDH casing or a class suffix still lands.
    assert.equal(isMobileUnit({ permit_type: 'MOBILE FOOD UNITS' }), true)
    assert.equal(isMobileUnit({ permit_type: 'Mobile Food Unit - Class 3' }), true)
    // A payload without the field must not read as a truck.
    assert.equal(isMobileUnit({}), false)
    assert.equal(isMobileUnit({ permit_type: undefined }), false)
})

test('isMobileUnit reads the lite mobile boolean — strictly', () => {
    // `=== true` so a truthy accident (a string, a 1) from payload drift
    // can't hide real places.
    assert.equal(isMobileUnit({ mobile: true }), true)
    assert.equal(isMobileUnit({ mobile: false }), false)
    assert.equal(isMobileUnit({ mobile: 1 as unknown as boolean }), false)
    assert.equal(isMobileUnit({ mobile: 'true' as unknown as boolean }), false)
    // Either signal suffices; full-tier records may carry both.
    assert.equal(isMobileUnit({ mobile: true, permit_type: 'Fast Food' }), true)
})

test('trucks are hidden by default and return when the switch goes on', () => {
    assert.equal(matches(TRUCK), false)
    assert.equal(matches(TRUCK, { showMobile: true }), true)
    // The toggle is orthogonal — it must not touch brick-and-mortar.
    assert.equal(matches(BRICK), true)
    assert.equal(matches(BRICK, { showMobile: true }), true)
})

test('hiding trucks does not smuggle in the other filters', () => {
    const closedTruck = { ...TRUCK, status: 'Business Closed' }
    assert.equal(matches(closedTruck, { showMobile: true, showClosed: false }), false)
    assert.equal(matches(closedTruck, { showMobile: true, showClosed: true }), true)
    const newTruck = { ...TRUCK, newly_permitted: true }
    assert.equal(matches(newTruck, { showMobile: true, showNew: false }), false)
    // Search still applies to a shown truck.
    assert.equal(matches(TRUCK, { showMobile: true, q: 'taco' }), true)
    assert.equal(matches(TRUCK, { showMobile: true, q: 'sushi' }), false)
})

test('lite hides trucks too — the mobile boolean made the switch live there', () => {
    const liteTruck: FacilityLike = { name: 'Taco Truck', zip: '23220', is_restaurant: true, mobile: true }
    assert.equal(matches(liteTruck, {}, 'lite'), false)
    assert.equal(matches(liteTruck, { showMobile: true }, 'lite'), true)
    // Unflagged (or pre-boolean) lite records always stay visible.
    const liteBrick: FacilityLike = { name: 'Kyoto', zip: '23220', is_restaurant: true, mobile: false }
    assert.equal(matches(liteBrick, {}, 'lite'), true)
    const preBoolean: FacilityLike = { name: 'Old Payload', zip: '23220', is_restaurant: true }
    assert.equal(matches(preBoolean, {}, 'lite'), true)
})
