/**
 * Restaurant-inspection map dashboard.
 *
 * Renders the facility archive served by `/api/food/*` — never a live feed;
 * data is collected and scored by a separate pipeline, and this page only
 * reads the archived snapshot.
 *
 * Map engine is MapLibre GL JS (classic CDN script) rendering CARTO's vector
 * basemaps (positron / dark-matter), with clustering done by MapLibre's
 * GeoJSON source (`cluster: true`).
 *
 * Engine notes:
 *   · coordinates are [lng, lat];
 *   · CARTO GL styles serve 512px tiles, so zoom levels run ~1 lower than
 *     256px-tile maps;
 *   · markers are a data-driven circle layer (paint props read per-feature
 *     properties baked in _toGeoJSON);
 *   · one feature per DISTINCT POINT, not per facility — permits sharing a
 *     coordinate become one stack bubble carrying its count, and clicking it
 *     fans the members out as DOM markers at pixel offsets (_expandStack);
 *   · theme swap is map.setStyle(light↔dark) + re-adding the data source and
 *     layers on the next `style.load`.
 *
 * TWO COMPUTED THINGS, VDH PUBLISHES NEITHER. An INSPECTION has a SCORE — a
 * 0-100 number, no letter (rounded-square badges). A FACILITY has a GRADE — a
 * score plus an A-F letter (the circle badge), the latest broad assessment
 * adjusted by what post-broad focused re-checks verified, shipped by the
 * exporter as `facility.grade`. Marker fill, A-F chips, sort, hover, and the
 * detail headline all key off the grade; the letter never appears on a single
 * inspection.
 *
 * MODULE LAYOUT (CPR-M1a, 2026-08-16). This file is the orchestrator:
 * constructor, toolbar wiring, load/refresh, and the view switch. Every
 * other concern lives in a sibling module and is installed onto
 * FoodDashboard.prototype below, byte-for-byte the methods that used to
 * sit in this class:
 *   constants.js     shared vocabulary (keys, palette, styles, layer ids)
 *   stacks.js        same-coordinate stack geometry + spiderfy interaction
 *   presentation.js  pure presentation math (scope, grade, trend, dates)
 *   receipt.js       pure grade-receipt mirror of the engine's dock math
 *   map.js           MapLibre plumbing, layers, interactions, locate, theme
 *   markers.js       marker paint, GeoJSON, marker rebuild
 *   hover.js         marker-bound hover card
 *   filters.js       filter predicates, counts pill, ZIP select
 *   list.js          List view
 *   about.js         footer freshness + About live cards
 *   detail.js        detail panel, grade hero, grade-receipt modal
 *   sparkline.js     trend sparkline (static + fitted/interactive)
 *   inspection.js    inspection history rows
 *   router.js        routes + URL state (CPR-M1b): paths, query state, history
 * The pure functions tests and other consumers import are re-exported
 * from here so this module stays the dashboard's public surface.
 */

import {
    LYR_CLUSTERS, RESTAURANTS_ONLY_KEY, SHOW_CLOSED_KEY, SHOW_MOBILE_KEY, SHOW_NEW_KEY,
} from './constants.js';
import { CLUSTER_MAX_ZOOM, stackMethods } from './stacks.js';
import { esc } from './presentation.js';
import { VIEWS, routerMethods, titleForView } from './router.js';
import { mapMethods } from './map.js';
import { markerMethods } from './markers.js';
import { hoverMethods } from './hover.js';
import { filterMethods } from './filters.js';
import { aboutMethods } from './about.js';
import { listMethods } from './list.js';
import { detailMethods } from './detail.js';
import { sparklineMethods } from './sparkline.js';
import { inspectionMethods } from './inspection.js';

export { spiderOffsets, stackKey, stackRadius, stackRingIcon } from './stacks.js';
export {
    buildScopeSeries, coordsOf, facilityPresentation, focusedOutcomePresentation,
    gradePresentation, inspectionCountsPresentation, inspectionPresentation,
    isActivePermit, isNewlyPermitted, isoFromYmd, latestDateOf, locationClass,
    narrativeVerdictPresentation, permitUrl,
} from './presentation.js';
export { gradeReceiptPresentation } from './receipt.js';

export class FoodDashboard {
    constructor(api) {
        this.api = api;
        // 'full' = complete inspection archive (authenticated channel);
        // 'lite' = the public finder payload — gray markers, name + address
        // + VDH link, no judgment surfaces. Set from the payload's mode.
        this._mode = 'full';
        this._loaded = false;
        this._map = null;
        this._mapReady = false;      // first style.load has run (source exists)
        this._styleIsDark = null;
        this._hoverPopup = null;
        this._hoverPid = null;       // permit under the open hover card
        this._geojson = null;        // last-built FeatureCollection (re-applied on style swaps)
        this._stacks = new Map();    // coord key → { key, lat, lon, members }
        this._spider = null;         // the open stack's DOM legs, if any
        // Stable reference so the movestart listener can be removed again: a
        // web survives a camera move (its legs are screen offsets) but an open
        // hover card is pinned to a geographic point and would drift.
        this._onSpiderMove = () => this._hideHoverCard();
        // Zoom out far enough and the stack this web belongs to is swallowed
        // by a proximity cluster. The bubble is gone from the canvas at that
        // point, but the legs are DOM markers and would hang over the
        // clustered map until something else dismissed them.
        this._onSpiderZoom = () => {
            if (this._map && this._map.getZoom() <= CLUSTER_MAX_ZOOM) {
                this._dismissSpider();
            }
        };
        this._facilities = [];
        this._byPermit = new Map();
        this._counts = null;
        this._filters = {
            q: '', zip: '', grade: '',
            // "Restaurants only" — hide the permits nobody eats out at
            // (schools / daycares / care homes / hospitals / hotel breakfast
            // bars / caterers / commissaries / private clubs / camps).
            // Classified server-side as is_restaurant; persisted across reloads.
            restaurantsOnly: localStorage.getItem(RESTAURANTS_ONLY_KEY) === '1',
            // Hide non-active permits (Business Closed / Withdrawn / Expired /
            // Pending / etc.) by default — a "where to eat" map shows live
            // places, not closed pins wearing their last grade.
            showClosed: localStorage.getItem(SHOW_CLOSED_KEY) === '1',
            // Newly-permitted places (active, no broad assessment yet) plot blue
            // and show by default; the toggle lets a graded-only view hide them.
            // Default ON — a missing key means show.
            showNew: localStorage.getItem(SHOW_NEW_KEY) !== '0',
            // Mobile food units (trucks, carts, trailers) answer a different
            // question than the rest of the map: their pin is the permit's
            // filing address, not a place you can drive to tonight. Hidden by
            // default so the map stays "where can we eat"; the toggle brings
            // them back. Default OFF — a missing key means hide.
            showMobile: localStorage.getItem(SHOW_MOBILE_KEY) === '1',
        };
        this._viewMode = 'map';     // 'map' | 'list' | 'about'
        this._sort = { key: 'score', dir: 'asc' };  // list sort — worst-first default
        this._page = 1;             // List load-more position: chunks revealed (router.js)
        this._selectedPermit = null;
        this._pendingPermit = undefined;   // ?permit= awaiting the roster (router.js)
        // Router state (router.js _installRouter): the mount from <base href>,
        // whether we're framed (CannonAI embed), the page's own <title>, and
        // the localStorage keys the toggles persist under (URL-omitted toggles
        // fall back to them).
        this._mount = null;
        this._embedded = false;
        this._baseTitle = '';
        this._storageKeys = { RESTAURANTS_ONLY_KEY, SHOW_CLOSED_KEY, SHOW_NEW_KEY, SHOW_MOBILE_KEY };
        this._searchDebounce = null;
        this._mapNote = null;       // locate-feedback notice over the map
        this._geolocate = null;     // the GeolocateControl instance
        this._geoFollowing = false; // camera locked to the user's position?
        this._receiptHost = null;   // grade-receipt modal DOM (body-appended)
        this._receiptTrigger = null; // button to restore focus to on close
        this._receiptKeydown = null;
        this._receiptFocusin = null;
    }

    init() {
        // Routes + URL state first (router.js): learn the mount, read the
        // address bar into filters / sort / page / view / pending permit,
        // normalize it, and follow Back / Forward. Everything below then reads
        // that state into the controls exactly as it did before routes.
        this._installRouter();

        // A filter changed under the visitor's hand: back to the first page
        // of the List, re-filter whichever view is up, and mirror the change
        // into the URL (replaceState — filter churn never spams history).
        const filtersChanged = () => {
            this._page = 1;
            this._rebuildMarkers();
            this._syncUrl();
        };

        const search = document.getElementById('foodSearch');
        search?.addEventListener('input', () => {
            clearTimeout(this._searchDebounce);
            this._searchDebounce = setTimeout(() => {
                this._filters.q = (search.value || '').trim().toLowerCase();
                filtersChanged();
            }, 150);
        });

        document.getElementById('foodZipFilter')?.addEventListener('change', (e) => {
            this._filters.zip = e.target.value;
            filtersChanged();
        });

        document.getElementById('foodGradeChips')
            ?.querySelectorAll('button[data-grade]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._filters.grade = btn.dataset.grade;
                    document.querySelectorAll('#foodGradeChips button').forEach(
                        (b) => b.classList.toggle('active', b === btn));
                    filtersChanged();
                });
            });

        // The four persisted toggles. A click persists to localStorage (the
        // default for URLs that omit the toggle — D-URL-4); the URL itself
        // never writes storage.
        const toggles = [
            ['foodRestaurantsOnly', 'restaurantsOnly', RESTAURANTS_ONLY_KEY],
            ['foodShowClosed', 'showClosed', SHOW_CLOSED_KEY],
            ['foodShowNew', 'showNew', SHOW_NEW_KEY],
            ['foodShowMobile', 'showMobile', SHOW_MOBILE_KEY],
        ];
        for (const [id, field, storageKey] of toggles) {
            const toggle = document.getElementById(id);
            if (!toggle) continue;
            toggle.checked = this._filters[field];
            toggle.addEventListener('change', async () => {
                this._filters[field] = toggle.checked;
                try {
                    localStorage.setItem(storageKey, toggle.checked ? '1' : '0');
                } catch (_) { /* private mode */ }
                // "Show closed" on the Full tier pulls the lazy closed family
                // the first time it is switched on; the boot never pays for
                // it (design ref §5, D-DATA-7).
                if (field === 'showClosed' && toggle.checked && this._mode !== 'lite') {
                    await this._ensureClosedLoaded();
                }
                filtersChanged();
            });
        }

        // View toggle (Map | List | About) — a real navigation: pushState.
        document.getElementById('foodViewToggle')
            ?.querySelectorAll('button[data-view]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const view = btn.dataset.view;
                    this._setView(view);
                    // About is a document, not a pane: send it back to the top
                    // and put focus on its title so keyboard and screen-reader
                    // users land in the content rather than wherever the last
                    // view left them. This used to hang off the footer's
                    // methodology link — the only [data-view-link] on the page
                    // — so it moved here when the footer shed it.
                    if (view === 'about') {
                        const wrap = document.getElementById('foodAboutWrap');
                        if (wrap) wrap.scrollTop = 0;
                        requestAnimationFrame(() => {
                            document.getElementById('foodAboutTitle')?.focus({ preventScroll: true });
                        });
                    }
                });
            });

        // List sort headers — click to sort, click again to flip direction.
        // A new sort starts the load-more position over.
        document.getElementById('foodListTable')
            ?.querySelectorAll('th[data-sort]').forEach((th) => {
                th.addEventListener('click', () => {
                    const k = th.dataset.sort;
                    if (this._sort.key === k) this._sort.dir = this._sort.dir === 'asc' ? 'desc' : 'asc';
                    else this._sort = { key: k, dir: 'asc' };
                    this._page = 1;
                    this._rebuildList();
                    this._syncUrl();
                });
            });

        // Restyle the basemap when the body's theme class changes.
        new MutationObserver(() => this._applyTheme())
            .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    /** Kick off the first load once the page is ready. */
    load() {
        if (!this._loaded) {
            this._loaded = true;
            this.refresh();
        } else if (this._map) {
            setTimeout(() => this._map.resize(), 50);
        }
    }

    async refresh() {
        const countsEl = document.getElementById('foodCounts');
        if (countsEl) countsEl.textContent = 'Loading…';

        const payload = await this.api.getFoodFacilities();
        if (!payload || !payload.available) {
            const reason = payload?.reason || payload?.error || 'data unreachable';
            if (countsEl) countsEl.textContent = `Unavailable — ${reason}`;
            this._updateAboutUnavailable();
            const mapEl = document.getElementById('foodMap');
            if (mapEl && !this._map) {
                mapEl.innerHTML = `<div class="food-map-error p-4 text-muted">`
                    + `Inspection data unavailable: ${esc(reason)}.</div>`;
            }
            return;
        }

        const lite = payload.mode === 'lite';
        if (lite !== (this._mode === 'lite')) {
            this._mode = lite ? 'lite' : 'full';
            // Lite has no scores to sort by — fall back to name.
            if (lite && this._sort.key === 'score') this._sort = { key: 'name', dir: 'asc' };
        }
        document.body.classList.toggle('food-mode-lite', lite);
        // The sign-in affordance only makes sense when there's something
        // more to sign in TO.
        document.getElementById('signInBtn')?.classList.toggle('d-none', !lite);

        this._facilities = payload.facilities || [];
        this._byPermit = new Map(this._facilities.map((f) => [f.permit_id, f]));
        this._counts = payload.counts || null;
        // Contract V4: the roster is the ACTIVE set; the closed permits are a
        // lazy family fetched once, on the first "Show closed" (design ref §5).
        this._closedLoaded = false;
        if (!lite && this._filters.showClosed) await this._ensureClosedLoaded();

        const fetchedEl = document.getElementById('foodFetchedAt');
        if (fetchedEl) {
            const snap = payload.fetched_at ? payload.fetched_at.slice(0, 10) : null;
            // Keep publication time and source-record recency distinct:
            // export generation does not mean every report is that new.
            // Contract V4 states the newest held report in the manifest on
            // both tiers (`freshness.newest_report`) — one archive-wide date,
            // no per-row scan, no per-facility judgment on the public tier.
            this._renderFreshness(fetchedEl, snap, payload.freshness?.newest_report || null);
        }

        // Coverage in the footer is the ZIP count alone. The facility total
        // was redundant with the toolbar pill, which states it live against
        // the active filters; About carries both for the record.
        const coverageEl = document.getElementById('foodCoverage');
        if (coverageEl && this._counts) {
            const zips = Object.keys(this._counts.by_zip || {}).filter((z) => z !== '?').length;
            coverageEl.textContent = ` · ${zips} ${zips === 1 ? 'ZIP' : 'ZIPs'}`;
        }

        this._updateAboutStatus(payload, lite);

        this._populateZipFilter();
        this._ensureMap();
        // If the map predates a mode flip, restyle the cluster tint to match.
        if (this._mapReady) {
            this._map.setPaintProperty(LYR_CLUSTERS, 'circle-color', this._clusterColors());
        }
        this._rebuildMarkers();
        // The roster is in: a `?permit=` deep link can open its panel now, and
        // the address bar can reflect the tier (Lite falls back to a name
        // sort, which the URL should mirror rather than a stale sort=score).
        this._applyPendingPermit();
        this._syncUrl();
    }

    /** Merge the lazy `closed/*` family into the roster once per load. The
     *  data client memoizes the fetch, so a second toggle costs nothing; a
     *  failed fetch leaves the toggle honest (closed rows simply absent) and
     *  retries on the next switch. */
    async _ensureClosedLoaded() {
        if (this._closedLoaded || this._mode === 'lite') return;
        if (typeof this.api?.loadClosed !== 'function') return;
        let closed;
        try {
            closed = await this.api.loadClosed();
        } catch (error) {
            console.error('[data] closed family unavailable:', error);
            return;
        }
        this._closedLoaded = true;
        for (const f of closed || []) {
            if (this._byPermit.has(f.permit_id)) continue;
            this._facilities.push(f);
            this._byPermit.set(f.permit_id, f);
        }
    }

    /** Switch views. Real navigation (router.js): the path becomes `/`,
     *  `/list`, or `/about`, pushed onto history when the view actually
     *  changed so Back returns to the previous view. `write: false` is the
     *  router's own call while applying a URL (load, popstate). */
    _setView(mode, { write = true } = {}) {
        if (!VIEWS.includes(mode)) return;
        const changed = this._viewMode !== mode;
        this._viewMode = mode;
        document.querySelectorAll('#foodViewToggle button[data-view]').forEach((b) => {
            b.classList.toggle('active', b.dataset.view === mode);
            b.setAttribute('aria-pressed', String(b.dataset.view === mode));
        });
        document.getElementById('foodMapWrap')?.classList.toggle('d-none', mode !== 'map');
        document.getElementById('foodListWrap')?.classList.toggle('d-none', mode !== 'list');
        document.getElementById('foodAboutWrap')?.classList.toggle('d-none', mode !== 'about');
        document.body.classList.toggle('food-view-list', mode === 'list');
        document.body.classList.toggle('food-view-about', mode === 'about');
        if (this._baseTitle) document.title = titleForView(mode, this._baseTitle);
        if (write) this._syncUrl({ push: changed });
        if (mode === 'map') {
            setTimeout(() => this._map?.resize(), 60);
            this._rebuildMarkers();
        } else if (mode === 'list') {
            this._rebuildList();
        }
    }
}

// Install the per-concern method bundles on the prototype exactly as if
// they had been declared in the class body above: non-enumerable, writable,
// configurable — the same descriptor a class method gets. Bodies are
// unchanged; only their file moved.
for (const bundle of [mapMethods, markerMethods, hoverMethods, stackMethods, filterMethods,
    listMethods, aboutMethods, detailMethods, sparklineMethods, inspectionMethods, routerMethods]) {
    for (const [name, fn] of Object.entries(bundle)) {
        Object.defineProperty(FoodDashboard.prototype, name, {
            value: fn, writable: true, configurable: true, enumerable: false,
        });
    }
}
