// @vitest-environment jsdom
/**
 * The map edit mode's draft model (CPE-M2, app/admin/mapDraft.ts): what
 * kind of fix a place is, what a site fix moves, the pin's shape, the
 * distance and the discard reach, the per-device store, and the drawing
 * the map takes from it.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { MAP_DRAFT_KEY } from '../../app/constants'
import {
    addressKey, attachDetail, badgeText, buildProposalGeoJSON, coveredPermits, distanceM, haversineM,
    loadPins, movePin, newPin, pinFor, pinKind, pointKey, removePin, savePins, setNote, STORAGE_KEY,
    upsertPin, withinDiscard,
} from '../../app/admin/mapDraft'
import type { ProposalPin } from '../../app/admin/mapDraft'
import type { RosterRow } from '../../app/data/types'

function row(over: Partial<RosterRow> & { permit_id: string }): RosterRow {
    return {
        name: 'Place', address: '123 Main St', address2: null, city: 'Richmond', zip: '23220',
        tenant: 'virginia', is_restaurant: true, mobile: false, pt: 0, lat: 37.5, lon: -77.4, loc: 0,
        ffx_oid: null, ...over,
    }
}

describe('what kind of fix a place is', () => {
    test('rooftop, street and venue places are refinements; a ZIP centroid is a site fix', () => {
        expect(pinKind(row({ permit_id: 'a', loc: 0 }))).toBe('refinement')
        expect(pinKind(row({ permit_id: 'a', loc: 1 }))).toBe('refinement')
        expect(pinKind(row({ permit_id: 'a', loc: 3 }))).toBe('refinement')
        expect(pinKind(row({ permit_id: 'a', loc: 2 }))).toBe('site')
    })

    test('the address key folds case, punctuation and spacing, and carries the ZIP', () => {
        expect(addressKey({ address: '123  Main St.', zip: '23220' })).toBe('123 main st|23220')
        expect(addressKey({ address: '123 MAIN ST', zip: '23220' })).toBe('123 main st|23220')
        expect(addressKey({ address: '123 Main St', zip: '23221' })).not.toBe(addressKey({ address: '123 Main St', zip: '23220' }))
        expect(addressKey({ address: null, zip: '23220' })).toBeNull()
        expect(addressKey({ address: '  ', zip: '23220' })).toBeNull()
    })

    test('a site fix moves every permit at the address; a refinement moves its own permit', () => {
        const a = row({ permit_id: 'a', loc: 2 })
        const b = row({ permit_id: 'b', loc: 2, address: '123 MAIN ST.' })
        const c = row({ permit_id: 'c', loc: 2, address: '9 Other Rd' })
        const d = row({ permit_id: 'd', loc: 0 })
        const rows = [a, b, c, d]
        expect(coveredPermits(a, rows)).toEqual(['a', 'b', 'd'])
        expect(coveredPermits(d, rows)).toEqual(['d'])
        expect(coveredPermits(row({ permit_id: 'e', loc: 2, address: null }), rows)).toEqual(['e'])
    })
})

describe('a pin', () => {
    test('stands on the published point, keyed by it, covering what it moves', () => {
        const a = row({ permit_id: 'a', loc: 2, lat: 37.1234567, lon: -77.7654321 })
        const pin = newPin(a, [a, row({ permit_id: 'b', loc: 2 })], 'snap-1', 1000)
        expect(pin).toMatchObject({
            permit_id: 'a', name: 'Place', kind: 'site', stack_key: pointKey(37.1234567, -77.7654321),
            published: { lat: 37.1234567, lon: -77.7654321, loc: 2, location: null },
            after: { lat: 37.1234567, lon: -77.7654321 },
            note: null, address: '123 Main St', covers: ['a', 'b'], snapshot_id: 'snap-1',
            detail: 'pending', created_at: 1000,
        })
        expect(pointKey(37.1234567, -77.7654321)).toBe('37.123457,-77.765432')
    })

    test('the badge names what a site fix moves; a refinement wears none', () => {
        expect(badgeText({ kind: 'site', covers: ['a', 'b', 'c'], address: '123 Main St' })).toBe('Moves 3 permits at 123 Main St')
        expect(badgeText({ kind: 'site', covers: ['a'], address: '123 Main St' })).toBe('Moves 1 permit at 123 Main St')
        expect(badgeText({ kind: 'site', covers: ['a'], address: null })).toBe('Moves 1 permit at this address')
        expect(badgeText({ kind: 'refinement', covers: ['a'], address: '123 Main St' })).toBeNull()
    })

    test('distance is great-circle metres', () => {
        expect(haversineM({ lat: 37.5, lon: -77.4 }, { lat: 37.5, lon: -77.4 })).toBe(0)
        // A thousandth of a degree of latitude is ~111.2 m anywhere.
        expect(haversineM({ lat: 37.5, lon: -77.4 }, { lat: 37.501, lon: -77.4 })).toBeCloseTo(111.2, 0)
        const pin = newPin(row({ permit_id: 'a' }), [], null)
        expect(distanceM(movePin([pin], 'a', { lat: 37.501, lon: -77.4 })[0]!)).toBeCloseTo(111.2, 0)
    })

    test('"dropped back on its dot" is the click reach plus the two radii', () => {
        // slop 10 + dot 5 + pin 8 = 23 px
        expect(withinDiscard(23, 10, 5)).toBe(true)
        expect(withinDiscard(23.5, 10, 5)).toBe(false)
        expect(withinDiscard(0, 10, 5)).toBe(true)
    })
})

describe('the draft list', () => {
    const base = () => newPin(row({ permit_id: 'a' }), [], 'snap', 1)

    test('upsert replaces by permit; remove drops; move rounds to 7 dp; a blank note is null', () => {
        let pins = upsertPin([], base())
        pins = upsertPin(pins, { ...base(), name: 'Renamed' })
        expect(pins).toHaveLength(1)
        expect(pins[0]!.name).toBe('Renamed')
        pins = movePin(pins, 'a', { lat: 37.123456789, lon: -77.987654321 })
        expect(pins[0]!.after).toEqual({ lat: 37.1234568, lon: -77.9876543 })
        pins = setNote(pins, 'a', '  parking lot, not the door  ')
        expect(pins[0]!.note).toBe('  parking lot, not the door  ')
        pins = setNote(pins, 'a', '   ')
        expect(pins[0]!.note).toBeNull()
        expect(pinFor(pins, 'a')).not.toBeNull()
        expect(pinFor(removePin(pins, 'a'), 'a')).toBeNull()
    })

    test('the detail attaches when it arrives, or is marked unavailable', () => {
        const location = { lat: 37.5, lon: -77.4, site_lat: 37.5, site_lon: -77.4, site_source: 'vgin_addresspoint' }
        const attached = attachDetail([base()], 'a', location)[0]!
        expect(attached.detail).toBe('attached')
        expect(attached.published.location).toEqual(location)
        const missing = attachDetail([base()], 'a', null)[0]!
        expect(missing.detail).toBe('unavailable')
        expect(missing.published.location).toBeNull()
    })
})

describe('the per-device store', () => {
    beforeEach(() => window.localStorage.clear())

    test('the key is the constant, and a draft round-trips', () => {
        expect(STORAGE_KEY).toBe(MAP_DRAFT_KEY)
        const pins = [attachDetail([newPin(row({ permit_id: 'a' }), [], 'snap', 1)], 'a', null)[0]!]
        savePins(window.localStorage, pins)
        expect(loadPins(window.localStorage)).toEqual(pins)
    })

    test('an empty draft clears the key rather than storing []', () => {
        savePins(window.localStorage, [newPin(row({ permit_id: 'a' }), [], null)])
        savePins(window.localStorage, [])
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    test('a pin still pending when it was stored comes back unavailable — its fetch died with its page', () => {
        savePins(window.localStorage, [newPin(row({ permit_id: 'a' }), [], null)])
        expect(loadPins(window.localStorage)[0]!.detail).toBe('unavailable')
    })

    test('garbage, wrong shapes and an unreadable store read as no draft, never a throw', () => {
        window.localStorage.setItem(STORAGE_KEY, 'not json')
        expect(loadPins(window.localStorage)).toEqual([])
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ pins: [{ permit_id: 'a' }, 7, null] }))
        expect(loadPins(window.localStorage)).toEqual([])
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
        expect(loadPins(window.localStorage)).toEqual([])
        expect(loadPins(null)).toEqual([])
        const thrower = {
            getItem: () => { throw new Error('private') },
            setItem: () => { throw new Error('private') },
            removeItem: () => { throw new Error('private') },
        }
        expect(loadPins(thrower)).toEqual([])
        expect(() => savePins(thrower, [])).not.toThrow()
    })
})

describe('the drawing', () => {
    test('one tether then one pin per proposal; the badge rides the pin and is empty for a refinement', () => {
        const a: ProposalPin = movePin([newPin(row({ permit_id: 'a' }), [], null)], 'a', { lat: 37.51, lon: -77.41 })[0]!
        const site = row({ permit_id: 's', loc: 2, lat: 36.9, lon: -76.3, address: '1 Pier Rd' })
        const s: ProposalPin = movePin([newPin(site, [site, row({ permit_id: 't', loc: 2, address: '1 Pier Rd', lat: 36.9, lon: -76.3 })], null)], 's', { lat: 36.91, lon: -76.31 })[0]!
        const collection = buildProposalGeoJSON([a, s])
        expect(collection.type).toBe('FeatureCollection')
        expect(collection.features.map((f) => `${f.properties.role}:${f.properties.pid}`)).toEqual([
            'tether:a', 'pin:a', 'tether:s', 'pin:s',
        ])
        expect(collection.features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [[-77.4, 37.5], [-77.41, 37.51]] })
        expect(collection.features[1]!.geometry).toEqual({ type: 'Point', coordinates: [-77.41, 37.51] })
        expect(collection.features[1]!.properties.badge).toBe('')
        expect(collection.features[3]!.properties).toMatchObject({ kind: 'site', badge: 'Moves 2 permits at 1 Pier Rd' })
        expect(buildProposalGeoJSON([]).features).toEqual([])
    })
})
