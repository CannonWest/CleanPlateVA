/**
 * CPR-M1b — routes + URL state (design ref §4: D-URL-1..4, D-URL-6,
 * D-DATA-11). Pins the router's pure helpers, the address-bar writer's
 * push/replace discipline, and the three serving fallbacks (Cloudflare SPA
 * setting, the dev server, the <base> mount) so a regression in any of them
 * fails here before it ships.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboardSource as source, moduleSource } from './support/dashboard.mjs';

const router = await import('../public/static/js/router.js');
const {
    VIEWS, URL_KEYS, FLAG_FIELDS, mountFromBaseURI, viewFromPath, pathForView, titleForView,
    parseUrlState, serializeUrlState, revealCount, maxPage, storedFlagDefaults,
    routerMethods,
} = router;
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const appPy = readFileSync(new URL('../app.py', import.meta.url), 'utf8');

test('the mount comes from <base href> and always ends in a slash', () => {
    assert.equal(mountFromBaseURI('https://cleanplateva.com/'), '/');
    assert.equal(mountFromBaseURI('http://localhost:8080/cleanplate/'), '/cleanplate/');
    assert.equal(mountFromBaseURI('http://localhost:8080/cleanplate/index.html'), '/cleanplate/');
    assert.equal(mountFromBaseURI('not a url'), '/');
    assert.equal(mountFromBaseURI(''), '/');
});

test('D-URL-1/2: / is the canonical Map, /map is an alias, unknown and trailing-slash paths normalize', () => {
    assert.deepEqual(VIEWS, ['map', 'list', 'about']);
    assert.deepEqual(viewFromPath('/'), { view: 'map', canonical: true });
    assert.deepEqual(viewFromPath('/map'), { view: 'map', canonical: false });
    assert.deepEqual(viewFromPath('/list'), { view: 'list', canonical: true });
    assert.deepEqual(viewFromPath('/about'), { view: 'about', canonical: true });
    assert.deepEqual(viewFromPath('/List'), { view: 'list', canonical: false });
    assert.deepEqual(viewFromPath('/list/'), { view: 'list', canonical: false });
    assert.deepEqual(viewFromPath('/nonsense'), { view: 'map', canonical: false });
    assert.deepEqual(viewFromPath('/list/23294'), { view: 'map', canonical: false });
    // under the CannonAI mount
    assert.deepEqual(viewFromPath('/cleanplate/', '/cleanplate/'), { view: 'map', canonical: true });
    assert.deepEqual(viewFromPath('/cleanplate/list', '/cleanplate/'), { view: 'list', canonical: true });
    assert.deepEqual(viewFromPath('/cleanplate/map', '/cleanplate/'), { view: 'map', canonical: false });
    assert.deepEqual(viewFromPath('/cleanplate', '/cleanplate/'), { view: 'map', canonical: false });
    assert.equal(pathForView('map'), '/');
    assert.equal(pathForView('list'), '/list');
    assert.equal(pathForView('about'), '/about');
    assert.equal(pathForView('list', '/cleanplate/'), '/cleanplate/list');
    for (const view of VIEWS) {
        assert.equal(viewFromPath(pathForView(view)).canonical, true, view);
        assert.equal(viewFromPath(pathForView(view, '/cleanplate/'), '/cleanplate/').view, view);
    }
});

test('document.title names the view; the Map keeps the page title', () => {
    const base = 'CleanPlateVA — archived VDH inspection finder';
    assert.equal(titleForView('map', base), base);
    assert.equal(titleForView('list', base), `List · ${base}`);
    assert.equal(titleForView('about', base), `About · ${base}`);
    assert.match(html, /<title>CleanPlateVA — archived VDH inspection finder<\/title>/);
});

test('D-URL-3: the URL state set — filters, permit, and List sort/dir/page — parses and validates', () => {
    assert.deepEqual(URL_KEYS, ['q', 'zip', 'grade', 'restaurants', 'closed', 'new', 'mobile',
        'permit', 'sort', 'dir', 'page']);
    const s = parseUrlState('?q=Pizza+Hut&zip=23294&grade=b&restaurants=1&closed=1&new=0&mobile=1'
        + '&permit=0006F03C-9C54-4D3D-8253-0E4663C55669&sort=score&dir=desc&page=3&tier=lite');
    assert.deepEqual(s, {
        q: 'pizza hut', zip: '23294', grade: 'B',
        restaurantsOnly: true, showClosed: true, showNew: false, showMobile: true,
        permit: '0006F03C-9C54-4D3D-8253-0E4663C55669', sortKey: 'score', sortDir: 'desc', page: 3,
    });
    // only what the URL names, validated
    assert.deepEqual(parseUrlState(''), {});
    assert.deepEqual(parseUrlState('?tier=lite'), {});
    assert.deepEqual(parseUrlState('?q=+++'), {});
    assert.deepEqual(parseUrlState('?zip=2329&grade=Z&dir=sideways&page=0&sort=colour&permit=<x>'), {});
    assert.deepEqual(parseUrlState('?page=2.5&page2=1'), {});
    assert.deepEqual(parseUrlState('?closed=true&new=false&mobile=off'), { showClosed: true, showNew: false, showMobile: false });
    assert.deepEqual(parseUrlState('?closed=maybe'), {});
    assert.deepEqual(parseUrlState('?page=999999999'), { page: 10000 });
});

test('D-URL-4: only non-default state is written; List-only keys only on the List; foreign params survive', () => {
    const defaults = { q: '', zip: '', grade: '', restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false };
    assert.equal(serializeUrlState({ view: 'map', filters: defaults, permit: null, sort: { key: 'score', dir: 'asc' }, page: 1 }), '');
    assert.equal(serializeUrlState({ view: 'list', filters: defaults, sort: { key: 'score', dir: 'asc' }, page: 1 }), '');
    // toggles: the shipped default is unwritten in either direction
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showNew: false } }), '?new=0');
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: true, showMobile: true, restaurantsOnly: true } }),
        '?restaurants=1&closed=1&mobile=1');
    // List-only keys
    const listState = { view: 'list', filters: { ...defaults, zip: '23294' }, sort: { key: 'name', dir: 'desc' }, page: 3 };
    assert.equal(serializeUrlState(listState), '?zip=23294&sort=name&dir=desc&page=3');
    assert.equal(serializeUrlState({ ...listState, view: 'map' }), '?zip=23294');
    // the tier's default sort is unwritten; a non-default dir alone is written with its key
    assert.equal(serializeUrlState({ view: 'list', filters: defaults, sort: { key: 'name', dir: 'asc' } },
        { defaultSort: { key: 'name', dir: 'asc' } }), '');
    assert.equal(serializeUrlState({ view: 'list', filters: defaults, sort: { key: 'score', dir: 'desc' } }), '?sort=score&dir=desc');
    // permit and search
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, q: 'pizza hut' }, permit: 'ABC-123' }), '?q=pizza+hut&permit=ABC-123');
    // ?tier=lite (and anything else foreign) passes through; our stale keys are replaced
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, zip: '23294' } }, { current: '?tier=lite&zip=00000&page=9' }),
        '?tier=lite&zip=23294');
    // Reload-stable: "default" for a toggle is what an OMITTED key falls back to —
    // the visitor's persisted value — so a toggle equal to it is unwritten and one
    // that differs is written even when it sits at the shipped default. Otherwise
    // `?closed=0` over a persisted closed=1 would vanish and flip back on refresh.
    const stored = { restaurantsOnly: false, showClosed: true, showNew: true, showMobile: true };
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: false, showMobile: true } }, { flagDefaults: stored }), '?closed=0');
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: true, showMobile: true } }, { flagDefaults: stored }), '');
    assert.equal(serializeUrlState({ view: 'map', filters: { ...defaults, showClosed: true, showMobile: false } }, { flagDefaults: stored }), '?mobile=0');
    for (const flags of [
        { restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false },
        { restaurantsOnly: true, showClosed: false, showNew: false, showMobile: true },
        { restaurantsOnly: false, showClosed: true, showNew: true, showMobile: true },
    ]) {
        const written = parseUrlState(serializeUrlState({ view: 'map', filters: { ...defaults, ...flags } }, { flagDefaults: stored }));
        const reloaded = Object.fromEntries(Object.values(FLAG_FIELDS).map((f) => [f, written[f] ?? stored[f]]));
        assert.deepEqual(reloaded, flags);
    }
});

test('URL state round-trips: parse(serialize(state)) names exactly the non-default state', () => {
    const state = {
        view: 'list',
        filters: { q: 'taco', zip: '24060', grade: 'F', restaurantsOnly: true, showClosed: true, showNew: false, showMobile: true },
        permit: 'B4E2CB07-3B0F-4B27-B1BE-4B7A0E7A9F1E',
        sort: { key: 'date', dir: 'desc' },
        page: 4,
    };
    const parsed = parseUrlState(serializeUrlState(state));
    assert.deepEqual(parsed, {
        q: 'taco', zip: '24060', grade: 'F',
        restaurantsOnly: true, showClosed: true, showNew: false, showMobile: true,
        permit: state.permit, sortKey: 'date', sortDir: 'desc', page: 4,
    });
});

test('D-DATA-11: load-more reveals N chunks of 50 and the page clamps to what the list has', () => {
    assert.equal(revealCount(22378, 1), 50);
    assert.equal(revealCount(22378, 3), 150);
    assert.equal(revealCount(120, 3), 120);
    assert.equal(revealCount(120, 99), 120);
    assert.equal(revealCount(0, 5), 0);
    assert.equal(revealCount(30, undefined), 30);
    assert.equal(maxPage(0), 1);
    assert.equal(maxPage(50), 1);
    assert.equal(maxPage(51), 2);
    assert.equal(maxPage(22378), 448);
    // the List no longer caps at 600; it slices to the revealed count and offers more
    const list = moduleSource('list.js');
    assert.doesNotMatch(list, /CAP = 600/);
    assert.match(list, /revealCount\(filtered\.length, this\._page\)/);
    assert.match(list, /food-list-more-btn/);
    assert.match(list, /this\._page \+= 1;\s*this\._rebuildList\(\);\s*this\._syncUrl\(\);/);
    assert.match(source, /LIST_PAGE_SIZE = 50/);
});

test('URL-omitted toggles fall back to the persisted defaults, never the other way round', () => {
    const keys = { RESTAURANTS_ONLY_KEY: 'r', SHOW_CLOSED_KEY: 'c', SHOW_NEW_KEY: 'n', SHOW_MOBILE_KEY: 'm' };
    const storage = (map) => ({ getItem: (k) => (k in map ? map[k] : null) });
    assert.deepEqual(storedFlagDefaults(storage({}), keys),
        { restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false });
    assert.deepEqual(storedFlagDefaults(storage({ r: '1', n: '0' }), keys),
        { restaurantsOnly: true, showClosed: false, showNew: false, showMobile: false });
    assert.deepEqual(storedFlagDefaults({ getItem() { throw new Error('private mode'); } }, keys),
        { restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false });
    // the router applies URL flags to state and reads storage as the fallback — it never writes storage
    const src = moduleSource('router.js');
    assert.match(src, /state\[field\] \?\? stored\[field\]/);
    assert.doesNotMatch(src, /localStorage\.setItem|storage\.setItem/);
});

test('_syncUrl: pushState for a view change / selection, replaceState otherwise, never push when framed, no-op when unchanged', () => {
    const calls = [];
    const fakeWindow = (path, search = '', hash = '') => ({
        location: { pathname: path, search, hash },
        localStorage: { getItem: () => null },
        history: {
            pushState: (_s, _t, url) => calls.push(['push', url]),
            replaceState: (_s, _t, url) => calls.push(['replace', url]),
        },
    });
    const dash = (over = {}) => ({
        _mount: '/', _embedded: false, _viewMode: 'map',
        _filters: { q: '', zip: '', grade: '', restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false },
        _selectedPermit: null, _sort: { key: 'score', dir: 'asc' }, _page: 1, _mode: 'full',
        _storageKeys: { RESTAURANTS_ONLY_KEY: 'r', SHOW_CLOSED_KEY: 'c', SHOW_NEW_KEY: 'n', SHOW_MOBILE_KEY: 'm' },
        _defaultSort: routerMethods._defaultSort,
        ...over,
    });
    const run = (win, d, opts) => { globalThis.window = win; calls.length = 0; routerMethods._syncUrl.call(d, opts); return calls.slice(); };
    try {
        assert.deepEqual(run(fakeWindow('/'), dash(), { push: true }), []);                       // unchanged → nothing
        assert.deepEqual(run(fakeWindow('/'), dash({ _viewMode: 'list' }), { push: true }), [['push', '/list']]);
        assert.deepEqual(run(fakeWindow('/'), dash({ _viewMode: 'list' }), {}), [['replace', '/list']]);
        assert.deepEqual(run(fakeWindow('/', '', '#about'), dash({ _viewMode: 'about' }), {}), [['replace', '/about']]);
        assert.deepEqual(run(fakeWindow('/map'), dash(), {}), [['replace', '/']]);              // alias normalizes
        assert.deepEqual(run(fakeWindow('/nonsense'), dash(), {}), [['replace', '/']]);         // unknown normalizes
        assert.deepEqual(run(fakeWindow('/', '?tier=lite'), dash({ _mode: 'lite', _selectedPermit: 'P-1' }), { push: true }),
            [['push', '/?tier=lite&permit=P-1']]);
        assert.deepEqual(run(fakeWindow('/list', '?sort=name&dir=asc'), dash({ _viewMode: 'list', _mode: 'lite', _sort: { key: 'name', dir: 'asc' } }), {}),
            [['replace', '/list']]);                                                          // Lite's default sort is unwritten
        // framed (CannonAI embed): the parent owns history
        assert.deepEqual(run(fakeWindow('/cleanplate/'), dash({ _mount: '/cleanplate/', _embedded: true, _viewMode: 'list' }), { push: true }),
            [['replace', '/cleanplate/list']]);
        // router not installed (bare instance) → nothing touches history
        assert.deepEqual(run(fakeWindow('/'), dash({ _mount: null, _viewMode: 'list' }), { push: true }), []);
    } finally {
        delete globalThis.window;
    }
});

test('the legacy #about hash migrates to /about and view switches route through _setView', () => {
    const src = moduleSource('router.js');
    assert.match(src, /window\.location\.hash\.toLowerCase\(\) === '#about'/);
    assert.match(src, /this\._setView\(legacyAbout \? 'about' : view, \{ write: false \}\)/);
    assert.match(src, /window\.addEventListener\('popstate', \(\) => this\._applyLocation\(\)\)/);
    const orch = moduleSource('foodDashboard.js');
    assert.match(orch, /init\(\) \{[\s\S]{0,600}?this\._installRouter\(\);/);       // first thing init does
    assert.doesNotMatch(orch, /replaceState\(null, '', `\$\{window\.location\.pathname\}/); // the old hash writer is gone
    assert.match(orch, /_setView\(mode, \{ write = true \} = \{\}\)/);
    assert.match(orch, /if \(write\) this\._syncUrl\(\{ push: changed \}\);/);
    assert.match(orch, /document\.title = titleForView\(mode, this\._baseTitle\)/);
    assert.match(orch, /routerMethods\]/);
    // selecting a facility pushes ?permit=; closing replaces it away
    const detail = moduleSource('detail.js');
    assert.match(detail, /async _select\(f, \{ write = true \} = \{\}\)[\s\S]{0,400}?if \(write\) this\._syncUrl\(\{ push: true \}\);/);
    assert.match(detail, /_closeDetail\(\{ write = true \} = \{\}\)[\s\S]{0,200}?if \(write\) this\._syncUrl\(\);/);
});

test('every filter change resets the load-more position and mirrors into the URL', () => {
    const orch = moduleSource('foodDashboard.js');
    assert.match(orch, /const filtersChanged = \(\) => \{\s*this\._page = 1;\s*this\._rebuildMarkers\(\);\s*this\._syncUrl\(\);\s*\};/);
    // search, zip, grade chips, and the four toggles all go through it
    assert.equal((orch.match(/filtersChanged\(\);/g) || []).length, 4);
    assert.match(orch, /for \(const \[id, field, storageKey\] of toggles\)/);
    // sort headers reset the page too
    assert.match(orch, /this\._sort = \{ key: k, dir: 'asc' \};\s*this\._page = 1;\s*this\._rebuildList\(\);\s*this\._syncUrl\(\);/);
    // the ZIP select restores a URL-carried zip once its options exist
    assert.match(moduleSource('filters.js'), /const current = sel\.value \|\| this\._filters\.zip;/);
});

test('serving fallbacks: <base href> mount, Cloudflare SPA not-found handling, dev server view paths', () => {
    // <base> precedes every relative URL in the head, and the router reads it
    const baseAt = html.indexOf('<base href="/">');
    assert.ok(baseAt > 0, '<base href="/"> present');
    assert.ok(baseAt < html.indexOf('<link rel="stylesheet"'), '<base> comes before the stylesheets');
    assert.ok(baseAt < html.indexOf('static/js/app.js'));
    assert.match(moduleSource('router.js'), /mountFromBaseURI\(document\.baseURI\)/);
    // relative asset + data URLs stay relative (the embed depends on it)
    assert.match(html, /href="static\/css\/style\.css"/);
    assert.match(html, /src="static\/js\/app\.js"/);
    // Cloudflare: any non-asset path gets index.html; the data routing is untouched
    assert.match(wrangler, /"not_found_handling":\s*"single-page-application"/);
    assert.match(wrangler, /"run_worker_first":\s*\["\/data\/manifest\.json", "\/data\/finder\/\*"\]/);
    // app.py: files are served, extension-less paths get index.html, missing assets 404
    assert.match(appPy, /static_folder=None/);
    assert.match(appPy, /if target is not None and target\.is_file\(\):\s*return send_from_directory\(PUBLIC, subpath\)/);
    assert.match(appPy, /if "\." in last:\s*abort\(404\)/);
    assert.match(appPy, /return send_from_directory\(PUBLIC, "index\.html"\)/);
    assert.match(appPy, /SEND_FILE_MAX_AGE_DEFAULT"\] = 0/);
});
