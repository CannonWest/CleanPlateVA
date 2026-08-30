/** Routes + URL state on the CR stack — ports the PURE-function tests of
 *  `tests/routes.test.mjs` against `app/router.ts` (C6 is the spec; §4
 *  D-CR-ROUTE-1). The old suite's address-bar-writer block (`_syncUrl`) and
 *  its source/infra greps stay with the .mjs original — the writer becomes
 *  CRV's router hook and gets re-pinned there.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'vitest'
import {
    FLAG_FIELDS, URL_KEYS, VIEWS, maxPage, mountFromBaseURI, parseUrlState, pathForView,
    revealCount, serializeUrlState, storedFlagDefaults, titleForView, viewFromPath,
} from '../../app/router'

const rootHtml = readFileSync(resolve(import.meta.dirname, '..', '..', 'index.html'), 'utf8')

test('the mount comes from <base href> and always ends in a slash', () => {
    assert.equal(mountFromBaseURI('https://cleanplateva.com/'), '/')
    assert.equal(mountFromBaseURI('http://localhost:8080/cleanplate/'), '/cleanplate/')
    assert.equal(mountFromBaseURI('http://localhost:8080/cleanplate/index.html'), '/cleanplate/')
    assert.equal(mountFromBaseURI('not a url'), '/')
    assert.equal(mountFromBaseURI(''), '/')
})

test('D-URL-1/2: / is the canonical Map, /map is an alias, unknown and trailing-slash paths normalize', () => {
    assert.deepEqual(VIEWS, ['map', 'list', 'about'])
    assert.deepEqual(viewFromPath('/'), { view: 'map', canonical: true })
    assert.deepEqual(viewFromPath('/map'), { view: 'map', canonical: false })
    assert.deepEqual(viewFromPath('/list'), { view: 'list', canonical: true })
    assert.deepEqual(viewFromPath('/about'), { view: 'about', canonical: true })
    assert.deepEqual(viewFromPath('/List'), { view: 'list', canonical: false })
    assert.deepEqual(viewFromPath('/list/'), { view: 'list', canonical: false })
    assert.deepEqual(viewFromPath('/nonsense'), { view: 'map', canonical: false })
    assert.deepEqual(viewFromPath('/list/23294'), { view: 'map', canonical: false })
    // under the CannonAI mount
    assert.deepEqual(viewFromPath('/cleanplate/', '/cleanplate/'), { view: 'map', canonical: true })
    assert.deepEqual(viewFromPath('/cleanplate/list', '/cleanplate/'), { view: 'list', canonical: true })
    assert.deepEqual(viewFromPath('/cleanplate/map', '/cleanplate/'), { view: 'map', canonical: false })
    assert.deepEqual(viewFromPath('/cleanplate', '/cleanplate/'), { view: 'map', canonical: false })
    assert.equal(pathForView('map'), '/')
    assert.equal(pathForView('list'), '/list')
    assert.equal(pathForView('about'), '/about')
    assert.equal(pathForView('list', '/cleanplate/'), '/cleanplate/list')
    for (const view of VIEWS) {
        assert.equal(viewFromPath(pathForView(view)).canonical, true, view)
        assert.equal(viewFromPath(pathForView(view, '/cleanplate/'), '/cleanplate/').view, view)
    }
})

test('document.title names the view; the Map keeps the page title', () => {
    const base = 'CleanPlateVA — archived VDH inspection finder'
    assert.equal(titleForView('map', base), base)
    assert.equal(titleForView('list', base), `List · ${base}`)
    assert.equal(titleForView('about', base), `About · ${base}`)
    // The CR entry carries the same identity the old shell does.
    assert.match(rootHtml, /<title>CleanPlateVA — archived VDH inspection finder<\/title>/)
})

test('D-URL-3: the URL state set — filters, permit, and List sort/dir/page — parses and validates', () => {
    assert.deepEqual(URL_KEYS, ['q', 'zip', 'grade', 'restaurants', 'closed', 'new', 'mobile',
        'permit', 'sort', 'dir', 'page'])
    const s = parseUrlState('?q=Pizza+Hut&zip=23294&grade=b&restaurants=1&closed=1&new=0&mobile=1'
        + '&permit=0006F03C-9C54-4D3D-8253-0E4663C55669&sort=score&dir=desc&page=3&tier=lite')
    assert.deepEqual(s, {
        q: 'pizza hut', grade: 'B',
        restaurantsOnly: true, showClosed: true, showNew: false, showMobile: true,
        permit: '0006F03C-9C54-4D3D-8253-0E4663C55669', sortKey: 'score', sortDir: 'desc', page: 3,
    })
    // only what the URL names, validated
    assert.deepEqual(parseUrlState(''), {})
    assert.deepEqual(parseUrlState('?tier=lite'), {})
    assert.deepEqual(parseUrlState('?q=+++'), {})
    assert.deepEqual(parseUrlState('?zip=2329&grade=Z&dir=sideways&page=0&sort=colour&permit=<x>'), {})
    assert.deepEqual(parseUrlState('?page=2.5&page2=1'), {})
    assert.deepEqual(parseUrlState('?closed=true&new=false&mobile=off'), { showClosed: true, showNew: false, showMobile: false })
    assert.deepEqual(parseUrlState('?closed=maybe'), {})
    assert.deepEqual(parseUrlState('?page=999999999'), { page: 10000 })
    // Legacy `?zip=` folds into the search box, keeping old shared links.
    assert.deepEqual(parseUrlState('?zip=23294'), { q: '23294' })
    assert.deepEqual(parseUrlState('?zip=23294&grade=a'), { q: '23294', grade: 'A' })
    // A URL carrying both keeps `q` — it is what the visitor actually typed.
    assert.deepEqual(parseUrlState('?q=taco&zip=23294'), { q: 'taco' })
    assert.deepEqual(parseUrlState('?zip=2329'), {})
    assert.deepEqual(parseUrlState('?zip=abcde'), {})
    // Words are separated, not spelled: whitespace runs collapse.
    assert.deepEqual(parseUrlState('?q=Richmond+++Taco'), { q: 'richmond taco' })
    assert.deepEqual(parseUrlState('?q=%20%20richmond%20%20taco%20%20'), { q: 'richmond taco' })
})

test('D-URL-4: only non-default state is written; List-only keys only on the List; foreign params survive', () => {
    const defaults = { q: '', grade: '', restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false }
    assert.equal(serializeUrlState({ view: 'map', filters: defaults, permit: null, sort: { key: 'score', dir: 'asc' }, page: 1 }), '')
    assert.equal(serializeUrlState({ view: 'list', filters: defaults, sort: { key: 'score', dir: 'asc' }, page: 1 }), '')
    // toggles: the shipped default is unwritten in either direction
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showNew: false } }), '?new=0')
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: true, showMobile: true, restaurantsOnly: true } }),
        '?restaurants=1&closed=1&mobile=1')
    // List-only keys
    const listState = { view: 'list', filters: { ...defaults, q: '23294' }, sort: { key: 'name', dir: 'desc' }, page: 3 }
    assert.equal(serializeUrlState(listState), '?q=23294&sort=name&dir=desc&page=3')
    assert.equal(serializeUrlState({ ...listState, view: 'map' }), '?q=23294')
    // the tier's default sort is unwritten; a non-default dir writes with its key
    assert.equal(serializeUrlState({ view: 'list', filters: defaults, sort: { key: 'name', dir: 'asc' } },
        { defaultSort: { key: 'name', dir: 'asc' } }), '')
    assert.equal(serializeUrlState({ view: 'list', filters: defaults, sort: { key: 'score', dir: 'desc' } }), '?sort=score&dir=desc')
    // permit and search
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, q: 'pizza hut' }, permit: 'ABC-123' }), '?q=pizza+hut&permit=ABC-123')
    // ?tier=lite (and anything else foreign) passes through; owned stale keys
    // are replaced, and a stale `zip` is CLEARED rather than carried.
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, q: '23294' } }, { current: '?tier=lite&zip=00000&page=9' }),
        '?tier=lite&q=23294')
    // Reload-stable: a toggle's "default" is the visitor's PERSISTED value.
    const stored = { restaurantsOnly: false, showClosed: true, showNew: true, showMobile: true }
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: false, showMobile: true } }, { flagDefaults: stored }), '?closed=0')
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: true, showMobile: true } }, { flagDefaults: stored }), '')
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: true, showMobile: false } }, { flagDefaults: stored }), '?mobile=0')
    for (const flags of [
        { restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false },
        { restaurantsOnly: true, showClosed: false, showNew: false, showMobile: true },
        { restaurantsOnly: false, showClosed: true, showNew: true, showMobile: true },
    ]) {
        const written = parseUrlState(serializeUrlState({ view: 'map', filters: { ...defaults, ...flags } }, { flagDefaults: stored }))
        const reloaded = Object.fromEntries(Object.values(FLAG_FIELDS).map((f) => [f, written[f] ?? stored[f]]))
        assert.deepEqual(reloaded, flags)
    }
})

test('URL state round-trips: parse(serialize(state)) names exactly the non-default state', () => {
    const state = {
        view: 'list',
        filters: { q: 'taco', grade: 'F', restaurantsOnly: true, showClosed: true, showNew: false, showMobile: true },
        permit: 'B4E2CB07-3B0F-4B27-B1BE-4B7A0E7A9F1E',
        sort: { key: 'date', dir: 'desc' },
        page: 4,
    }
    const parsed = parseUrlState(serializeUrlState(state))
    assert.deepEqual(parsed, {
        q: 'taco', grade: 'F',
        restaurantsOnly: true, showClosed: true, showNew: false, showMobile: true,
        permit: state.permit, sortKey: 'date', sortDir: 'desc', page: 4,
    })
})

test('D-DATA-11: load-more reveals N chunks of 50 and the page clamps to what the list has', () => {
    assert.equal(revealCount(22378, 1), 50)
    assert.equal(revealCount(22378, 3), 150)
    assert.equal(revealCount(120, 3), 120)
    assert.equal(revealCount(120, 99), 120)
    assert.equal(revealCount(0, 5), 0)
    assert.equal(revealCount(30, undefined), 30)
    assert.equal(maxPage(0), 1)
    assert.equal(maxPage(50), 1)
    assert.equal(maxPage(51), 2)
    assert.equal(maxPage(22378), 448)
})

test('URL-omitted toggles fall back to the persisted defaults, never the other way round', () => {
    const keys = { RESTAURANTS_ONLY_KEY: 'r', SHOW_CLOSED_KEY: 'c', SHOW_NEW_KEY: 'n', SHOW_MOBILE_KEY: 'm' }
    const storage = (map: Record<string, string>) => ({ getItem: (k: string) => (k in map ? map[k]! : null) })
    assert.deepEqual(storedFlagDefaults(storage({}), keys),
        { restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false })
    assert.deepEqual(storedFlagDefaults(storage({ r: '1', n: '0' }), keys),
        { restaurantsOnly: true, showClosed: false, showNew: false, showMobile: false })
    assert.deepEqual(storedFlagDefaults({ getItem(): string | null { throw new Error('private mode') } }, keys),
        { restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false })
})
