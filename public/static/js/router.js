/**
 * Routes and URL state (CPR-M1b, design ref §4 — D-URL-1..4, D-URL-6,
 * D-DATA-11).
 *
 * The three views are real paths — `/` (Map, canonical; `/map` is accepted
 * and normalized), `/list`, `/about` — and the state a visitor can share
 * rides in the query string: `q · grade · restaurants · closed · new ·
 * mobile · permit` on every view, plus List-only `sort · dir · page`.
 * `zip` is RETIRED — the ZIP select folded into the search box, which now
 * matches a ZIP by prefix — so a legacy `?zip=23220` is read once, folded
 * into `q`, and cleared from the address bar.
 * Only NON-DEFAULT state is written, so shared links stay short, and foreign
 * params (`?tier=lite`, the dev override) pass through untouched. On load and
 * on popstate the URL wins for every key it names; a key the URL omits falls
 * back to its default — and "default" means exactly what an omitted key
 * would fall back to: empty search / ZIP / grade, the tier's default sort,
 * page 1, no selection, and for the four toggles their PERSISTED value
 * (localStorage). So a toggle is written only when it differs from the
 * visitor's own persisted default, which is what makes the address bar
 * reload-stable: what you see is what a refresh gives you. Toggle prefs are
 * the visitor's; the content state (place, filters, sort, page, selection)
 * is what a shared link carries. The URL never writes localStorage — a
 * shared link overrides one visit; only the visitor's own clicks persist.
 *
 * `page` is load-more's position (D-DATA-11): `page=N` reveals N chunks of
 * `LIST_PAGE_SIZE` rows, and it resets when the filters or sort change.
 *
 * The site knows where it is mounted from `<base href>` (`/` on
 * cleanplateva.com and the local servers; `/cleanplate/` inside the CannonAI
 * Food tab, whose passthrough rewrites the base) — assets, data fetches and
 * this router all derive from that one declaration, so any path depth is
 * safe under the static host's single-page-application fallback.
 *
 * History: `pushState` on a view change and on selecting a facility (Back
 * closes the panel / returns to the previous view), `replaceState` for
 * filter / sort / page writes and for the load-time normalization. When the
 * page is framed (the CannonAI embed) everything is `replaceState`: the
 * parent owns its history, the frame just keeps its URL current so a reload
 * or a copied link lands where the visitor was.
 *
 * The pure helpers below are unit-tested (tests/routes.test.mjs);
 * `routerMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard).
 */

import { LIST_PAGE_SIZE } from './constants.js';

export const VIEWS = ['map', 'list', 'about'];
const VIEW_SEGMENT = { map: '', list: 'list', about: 'about' };
const SEGMENT_VIEW = { '': 'map', map: 'map', list: 'list', about: 'about' };

// The keys the router OWNS: parsed on the way in, and cleared from the query
// before every write. `zip` stays on this list precisely BECAUSE it is retired
// — that is what strips a legacy `?zip=` from the address once its value has
// been folded into `q`. It is never written back.
export const URL_KEYS = ['q', 'zip', 'grade', 'restaurants', 'closed', 'new', 'mobile',
    'permit', 'sort', 'dir', 'page'];
export const SORT_KEYS = ['address', 'name', 'zip', 'score', 'compliance', 'trend', 'date'];
const GRADES = ['A', 'B', 'C', 'D', 'F'];
// The four persisted toggles: URL key → filter field → shipped default.
export const FLAG_FIELDS = {
    restaurants: 'restaurantsOnly',
    closed: 'showClosed',
    new: 'showNew',
    mobile: 'showMobile',
};
export const FLAG_DEFAULTS = {
    restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false,
};
const MAX_PAGE = 10000;

/** The mount the page is served under, from `document.baseURI`
 *  ('/' on the public site, '/cleanplate/' in the CannonAI embed). Always
 *  ends with '/'. Anything unparseable degrades to '/'. */
export function mountFromBaseURI(baseURI) {
    let pathname;
    try { pathname = new URL(baseURI).pathname; } catch (_) { return '/'; }
    if (!pathname) return '/';
    return pathname.endsWith('/') ? pathname : pathname.slice(0, pathname.lastIndexOf('/') + 1);
}

/** pathname → `{ view, canonical }`. `/` and `/map` are the Map (only `/`
 *  is canonical); a trailing slash or any unknown path is non-canonical, and
 *  unknown paths resolve to the Map so the client can normalize to `/`
 *  (D-URL-1, D-URL-2). Case-insensitive on the segment. */
export function viewFromPath(pathname, mount = '/') {
    const path = String(pathname || '/');
    let rest = path.startsWith(mount) ? path.slice(mount.length) : path.replace(/^\/+/, '');
    rest = rest.replace(/\/+$/, '');
    const view = SEGMENT_VIEW[rest.toLowerCase()];
    if (!view) return { view: 'map', canonical: false };
    return { view, canonical: path === pathForView(view, mount) };
}

/** The canonical path for a view under a mount. */
export function pathForView(view, mount = '/') {
    return `${mount}${VIEW_SEGMENT[view] ?? ''}`;
}

/** Per-view document title: the page's own title is the Map's; List and
 *  About prefix it so history entries and tabs read as what they are. */
export function titleForView(view, baseTitle) {
    if (view === 'list') return `List · ${baseTitle}`;
    if (view === 'about') return `About · ${baseTitle}`;
    return baseTitle;
}

/** Query string → the state it names. Only keys the URL carries (and that
 *  validate) appear in the result; everything else is the caller's default.
 *  Values are normalized the way the dashboard stores them (`q` lower-cased
 *  and trimmed, flags as booleans, `page` a positive integer). */
export function parseUrlState(search) {
    const p = new URLSearchParams(search || '');
    const s = {};
    if (p.has('q')) {
        const q = p.get('q').trim().toLowerCase();
        if (q) s.q = q;
    }
    // Legacy `?zip=23220` from the retired ZIP select. The search box matches
    // ZIP by prefix, so folding the value into `q` preserves what the shared
    // link meant. A URL carrying BOTH keeps its `q`: the two cannot be AND-ed
    // in one field, and `q` is what the visitor actually typed.
    if (s.q === undefined && p.has('zip') && /^\d{5}$/.test(p.get('zip').trim())) {
        s.q = p.get('zip').trim();
    }
    if (p.has('grade') && GRADES.includes(p.get('grade').toUpperCase())) {
        s.grade = p.get('grade').toUpperCase();
    }
    for (const [key, field] of Object.entries(FLAG_FIELDS)) {
        if (!p.has(key)) continue;
        const v = p.get(key).trim().toLowerCase();
        if (v === '1' || v === 'true' || v === 'on') s[field] = true;
        else if (v === '0' || v === 'false' || v === 'off') s[field] = false;
    }
    if (p.has('permit') && /^[0-9A-Za-z-]{4,64}$/.test(p.get('permit').trim())) {
        s.permit = p.get('permit').trim();
    }
    if (p.has('sort') && SORT_KEYS.includes(p.get('sort').trim().toLowerCase())) {
        s.sortKey = p.get('sort').trim().toLowerCase();
    }
    if (p.has('dir')) {
        const d = p.get('dir').trim().toLowerCase();
        if (d === 'asc' || d === 'desc') s.sortDir = d;
    }
    if (p.has('page')) {
        const n = Number(p.get('page'));
        if (Number.isInteger(n) && n >= 1) s.page = Math.min(n, MAX_PAGE);
    }
    return s;
}

/** Dashboard state → the query string to show. Writes only non-default
 *  keys (a toggle counts as non-default when it differs from
 *  `flagDefaults` — the visitor's persisted values, which is what an omitted
 *  toggle falls back to); List-only keys only on the List view; keeps every
 *  foreign param already in `current` (`?tier=lite`). Returns '' or '?…'. */
export function serializeUrlState(state, {
    current = '', defaultSort = { key: 'score', dir: 'asc' }, flagDefaults = FLAG_DEFAULTS,
} = {}) {
    const p = new URLSearchParams(current || '');
    for (const k of URL_KEYS) p.delete(k);
    const filters = state.filters || {};
    if (filters.q) p.set('q', filters.q);
    if (filters.grade) p.set('grade', filters.grade);
    for (const [key, field] of Object.entries(FLAG_FIELDS)) {
        const fallback = flagDefaults[field] ?? FLAG_DEFAULTS[field];
        const value = filters[field] ?? fallback;
        if (value !== fallback) p.set(key, value ? '1' : '0');
    }
    if (state.permit) p.set('permit', state.permit);
    if (state.view === 'list') {
        const sort = state.sort || defaultSort;
        if (sort.key !== defaultSort.key || sort.dir !== defaultSort.dir) {
            p.set('sort', sort.key);
            p.set('dir', sort.dir);
        }
        if (Number(state.page) > 1) p.set('page', String(state.page));
    }
    const qs = p.toString();
    return qs ? `?${qs}` : '';
}

/** Load-more (D-DATA-11): how many of `total` rows page `page` reveals. */
export function revealCount(total, page) {
    const chunks = Math.max(1, Number.isInteger(page) ? page : 1);
    return Math.min(Math.max(0, total), chunks * LIST_PAGE_SIZE);
}

/** The largest page that still reveals something new for `total` rows. */
export function maxPage(total) {
    return Math.max(1, Math.ceil(Math.max(0, total) / LIST_PAGE_SIZE));
}

/** The four toggles' persisted defaults, read fresh from localStorage — what a
 *  URL that omits a toggle falls back to (D-URL-4). Keys are the dashboard's
 *  filter fields; a missing key means the shipped default. */
export function storedFlagDefaults(storage, keys) {
    const read = (k) => { try { return storage.getItem(k); } catch (_) { return null; } };
    return {
        restaurantsOnly: read(keys.RESTAURANTS_ONLY_KEY) === '1',
        showClosed: read(keys.SHOW_CLOSED_KEY) === '1',
        showNew: read(keys.SHOW_NEW_KEY) !== '0',
        showMobile: read(keys.SHOW_MOBILE_KEY) === '1',
    };
}

export const routerMethods = {
    /** Called once at the top of init(): learn the mount, read the URL
     *  (migrating the legacy `#about` hash), apply its state, normalize the
     *  address bar, and follow Back / Forward from then on. */
    _installRouter() {
        this._mount = mountFromBaseURI(document.baseURI);
        // Framed (the CannonAI Food tab): the parent owns history — see the
        // module comment. Cross-origin frames throw on `window.top` access;
        // treat that as framed too.
        try { this._embedded = window.self !== window.top; } catch (_) { this._embedded = true; }
        this._baseTitle = document.title;
        this._applyLocation();
        // Normalize: `/map` → `/`, trailing slashes and unknown paths → the
        // Map's canonical path, and the legacy `#about` hash → `/about`.
        // Same-document replaceState, so nothing reloads.
        this._syncUrl({ push: false });
        window.addEventListener('popstate', () => this._applyLocation());
    },

    /** Read window.location into dashboard state and the DOM. Every URL key
     *  the address carries wins; absent keys fall back to their defaults —
     *  the persisted toggles from localStorage, empty search / grade,
     *  the tier's default sort, page 1, no selection. */
    _applyLocation() {
        const legacyAbout = window.location.hash.toLowerCase() === '#about';
        const { view } = viewFromPath(window.location.pathname, this._mount);
        const state = parseUrlState(window.location.search);
        const stored = storedFlagDefaults(window.localStorage, this._storageKeys);
        this._filters.q = state.q ?? '';
        this._filters.grade = state.grade ?? '';
        for (const field of Object.values(FLAG_FIELDS)) {
            this._filters[field] = state[field] ?? stored[field];
        }
        const dflt = this._defaultSort();
        this._sort = {
            key: state.sortKey ?? dflt.key,
            dir: state.sortDir ?? (state.sortKey ? 'asc' : dflt.dir),
        };
        this._page = state.page ?? 1;
        this._syncToolbarFromState();
        // The selection needs the roster; refresh() applies it once loaded.
        this._pendingPermit = state.permit ?? null;
        this._applyPendingPermit();
        this._setView(legacyAbout ? 'about' : view, { write: false });
        // /about#aboutTerms — the footer's terms link as a cold-loadable URL.
        // The normalizing replaceState that follows drops the hash, so the
        // scroll is ours to do, not the browser's (ack.js).
        if (view === 'about' && window.location.hash.toLowerCase() === '#aboutterms') {
            this._showTermsSection?.();
        }
    },

    /** Push dashboard filter state into the toolbar controls (search box,
     *  grade chips, the four toggles). */
    _syncToolbarFromState() {
        const search = document.getElementById('foodSearch');
        if (search && search.value.trim().toLowerCase() !== this._filters.q) search.value = this._filters.q;
        document.querySelectorAll('#foodGradeChips button[data-grade]').forEach((b) => {
            b.classList.toggle('active', (b.dataset.grade || '') === this._filters.grade);
        });
        const boxes = {
            foodRestaurantsOnly: 'restaurantsOnly', foodShowClosed: 'showClosed',
            foodShowNew: 'showNew', foodShowMobile: 'showMobile',
        };
        for (const [id, field] of Object.entries(boxes)) {
            const el = document.getElementById(id);
            if (el) el.checked = !!this._filters[field];
        }
    },

    /** Open the panel for the URL's `permit` (or close it when the URL has
     *  none) once the roster is in. Called from _applyLocation and refresh(). */
    _applyPendingPermit() {
        if (this._pendingPermit === undefined) return;
        if (!this._facilities.length) return;          // roster not in yet
        const permit = this._pendingPermit;
        this._pendingPermit = undefined;
        if (permit) {
            if (permit === this._selectedPermit) return;
            const f = this._byPermit.get(permit);
            if (f) this._select(f, { write: false });
        } else if (this._selectedPermit) {
            this._closeDetail({ write: false });
        }
    },

    /** The List's default sort — worst-first by score, or by name in Lite,
     *  which ships no scores. */
    _defaultSort() {
        return this._mode === 'lite' ? { key: 'name', dir: 'asc' } : { key: 'score', dir: 'asc' };
    },

    /** Write the current view + state to the address bar. `push` adds a
     *  history entry (view change, facility selection) unless the page is
     *  framed; everything else replaces. A no-op when nothing changed. */
    _syncUrl({ push = false } = {}) {
        if (!this._mount) return;   // router not installed (bare instances in tests)
        const path = pathForView(this._viewMode, this._mount);
        const search = serializeUrlState({
            view: this._viewMode,
            filters: this._filters,
            permit: this._selectedPermit,
            sort: this._sort,
            page: this._page,
        }, {
            current: window.location.search,
            defaultSort: this._defaultSort(),
            flagDefaults: storedFlagDefaults(window.localStorage, this._storageKeys),
        });
        const next = `${path}${search}`;
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (next === current) return;
        const method = push && !this._embedded ? 'pushState' : 'replaceState';
        try { window.history[method](null, '', next); } catch (_) { /* opaque origin / sandbox */ }
    },
};
