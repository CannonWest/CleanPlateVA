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
 *   · theme swap is map.setStyle(light↔dark) + re-adding the data source and
 *     layers on the next `style.load`.
 *
 * THE SCORE IS COMPUTED, NOT VDH'S (they publish none) — every score surface
 * here says "computed".
 */

const RESTAURANTS_ONLY_KEY = 'cleanplateva.food.restaurantsOnly';
const SHOW_CLOSED_KEY = 'cleanplateva.food.showClosed';

const PORTAL_PERMIT_URL =
    'https://inspections.myhealthdepartment.com/virginia/permit/?permitID=';

// Grade palette — fixed hues that read on light + dark (data color, not
// chrome; chrome themes via CSS).
const GRADE_COLORS = {
    A: '#2f9e44',   // green
    B: '#94be1b',   // lime
    C: '#f59f00',   // amber
    D: '#e8590c',   // orange
    F: '#e03131',   // red
    none: '#868e96', // unscored — gray
};

// CARTO vector basemaps. Attribution rides in the style's sources;
// MapLibre's AttributionControl surfaces it.
const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Map home: centroid-ish of the covered zipcode footprint.
// [lng, lat] (MapLibre order).
const HOME_CENTER = [-77.55, 37.618];
const HOME_ZOOM = 11;

// MapLibre source + layer ids (data layers re-added on every style swap).
const SRC = 'food-facilities';
const LYR_CLUSTERS = 'food-clusters';
const LYR_CLUSTER_COUNT = 'food-cluster-count';
const LYR_POINTS = 'food-points';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function gradeColor(grade) {
    return GRADE_COLORS[grade] || GRADE_COLORS.none;
}

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

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
        this._geojson = null;        // last-built FeatureCollection (re-applied on style swaps)
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
        };
        this._viewMode = 'map';     // 'map' | 'list'
        this._colorMode = 'grade';  // 'grade' | 'compliance' | 'repeat'
        this._sort = { key: 'score', dir: 'asc' };  // list sort — worst-first default
        this._selectedPermit = null;
        this._searchDebounce = null;
    }

    init() {
        document.getElementById('foodRefreshBtn')
            ?.addEventListener('click', () => this.forceRefresh());

        const search = document.getElementById('foodSearch');
        search?.addEventListener('input', () => {
            clearTimeout(this._searchDebounce);
            this._searchDebounce = setTimeout(() => {
                this._filters.q = (search.value || '').trim().toLowerCase();
                this._rebuildMarkers();
            }, 150);
        });

        document.getElementById('foodZipFilter')?.addEventListener('change', (e) => {
            this._filters.zip = e.target.value;
            this._rebuildMarkers();
        });

        document.getElementById('foodGradeChips')
            ?.querySelectorAll('button[data-grade]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._filters.grade = btn.dataset.grade;
                    document.querySelectorAll('#foodGradeChips button').forEach(
                        (b) => b.classList.toggle('active', b === btn));
                    this._rebuildMarkers();
                });
            });

        const restaurantsToggle = document.getElementById('foodRestaurantsOnly');
        if (restaurantsToggle) {
            restaurantsToggle.checked = this._filters.restaurantsOnly;
            restaurantsToggle.addEventListener('change', () => {
                this._filters.restaurantsOnly = restaurantsToggle.checked;
                try {
                    localStorage.setItem(RESTAURANTS_ONLY_KEY,
                        restaurantsToggle.checked ? '1' : '0');
                } catch (_) { /* private mode */ }
                this._rebuildMarkers();
            });
        }

        const closedToggle = document.getElementById('foodShowClosed');
        if (closedToggle) {
            closedToggle.checked = this._filters.showClosed;
            closedToggle.addEventListener('change', () => {
                this._filters.showClosed = closedToggle.checked;
                try {
                    localStorage.setItem(SHOW_CLOSED_KEY,
                        closedToggle.checked ? '1' : '0');
                } catch (_) { /* private mode */ }
                this._rebuildMarkers();
            });
        }

        // View toggle (Map | List)
        document.getElementById('foodViewToggle')
            ?.querySelectorAll('button[data-view]').forEach((btn) => {
                btn.addEventListener('click', () => this._setView(btn.dataset.view));
            });

        // Marker color-mode (grade / compliance / open repeats)
        document.getElementById('foodColorMode')?.addEventListener('change', (e) => {
            this._colorMode = e.target.value;
            this._updateColorLegend();
            this._rebuildMarkers();
        });

        // List sort headers — click to sort, click again to flip direction
        document.getElementById('foodListTable')
            ?.querySelectorAll('th[data-sort]').forEach((th) => {
                th.addEventListener('click', () => {
                    const k = th.dataset.sort;
                    if (this._sort.key === k) this._sort.dir = this._sort.dir === 'asc' ? 'desc' : 'asc';
                    else this._sort = { key: k, dir: 'asc' };
                    this._rebuildList();
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

    async refresh(forceRefresh = false) {
        const countsEl = document.getElementById('foodCounts');
        if (countsEl) countsEl.textContent = 'Loading…';

        const payload = await this.api.getFoodFacilities(forceRefresh);
        if (!payload || !payload.available) {
            const reason = payload?.reason || payload?.error || 'data unreachable';
            if (countsEl) countsEl.textContent = `Unavailable — ${reason}`;
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

        const fetchedEl = document.getElementById('foodFetchedAt');
        if (fetchedEl) {
            if (lite) {
                fetchedEl.textContent = payload.fetched_at
                    ? `snapshot ${fmtDate(payload.fetched_at.slice(0, 10))}` : '';
            } else {
                // The freshest inspection held = the latest data collected.
                const dates = this._facilities.map((f) => f.latest?.date).filter(Boolean);
                const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
                fetchedEl.textContent = latest ? `as of ${fmtDate(latest)}` : '';
            }
        }

        const coverageEl = document.getElementById('foodCoverage');
        if (coverageEl && this._counts) {
            const zips = Object.keys(this._counts.by_zip || {}).filter((z) => z !== '?').length;
            coverageEl.textContent =
                `Covering ${(this._counts.total || 0).toLocaleString()} facilities across ${zips} Virginia zipcodes.`;
        }

        this._populateZipFilter();
        this._updateColorLegend();
        this._ensureMap();
        // If the map predates a mode flip, restyle the cluster tint to match.
        if (this._mapReady) {
            this._map.setPaintProperty(LYR_CLUSTERS, 'circle-color', this._clusterColors());
        }
        this._rebuildMarkers();
    }

    forceRefresh() {
        this.refresh(true);
    }

    // ── map plumbing ────────────────────────────────────────────────────

    _isDark() {
        return document.body.classList.contains('theme-dark');
    }

    _ensureMap() {
        if (this._map) return;
        if (typeof maplibregl === 'undefined') {
            const countsEl = document.getElementById('foodCounts');
            if (countsEl) countsEl.textContent = 'MapLibre failed to load (CDN unreachable?)';
            return;
        }
        const mapEl = document.getElementById('foodMap');
        if (!mapEl) return;
        mapEl.innerHTML = '';

        const dark = this._isDark();
        this._styleIsDark = dark;
        this._map = new maplibregl.Map({
            container: 'foodMap',
            style: dark ? STYLE_DARK : STYLE_LIGHT,
            center: HOME_CENTER,
            zoom: HOME_ZOOM,
            maxZoom: 19,
        });
        this._map.addControl(
            new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

        // Fires on the initial style AND after every setStyle (theme swap) —
        // custom sources/layers don't survive a style swap, so this is the
        // one place they're (re-)installed.
        this._map.on('style.load', () => this._installDataLayers());

        this._bindMapInteractions();

        // The container may have been display:none moments ago.
        setTimeout(() => this._map.resize(), 50);
    }

    /** Add the facilities source + cluster/point layers to the CURRENT style.
     *  Idempotent per style — style.load hands us a bare basemap each time. */
    _installDataLayers() {
        if (!this._map || this._map.getSource(SRC)) return;
        this._mapReady = true;

        this._map.addSource(SRC, {
            type: 'geojson',
            data: this._geojson || { type: 'FeatureCollection', features: [] },
            // Bubbles dissolve as you zoom in: grouped at metro view, plain
            // dots from neighborhood zoom up.
            cluster: true,
            clusterMaxZoom: 12,
            clusterRadius: 40,
        });

        // Cluster bubbles — sized/tinted by member count. In lite the tint
        // stays neutral: on a gray finder map, green/orange bubbles would
        // read as judgment.
        this._map.addLayer({
            id: LYR_CLUSTERS,
            type: 'circle',
            source: SRC,
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': this._clusterColors(),
                'circle-radius': ['step', ['get', 'point_count'],
                    12, 10, 16, 50, 22],
                'circle-opacity': 0.85,
                'circle-stroke-width': 4,
                'circle-stroke-color': 'rgba(255, 255, 255, 0.35)',
            },
        });
        this._map.addLayer({
            id: LYR_CLUSTER_COUNT,
            type: 'symbol',
            source: SRC,
            filter: ['has', 'point_count'],
            layout: {
                'text-field': '{point_count_abbreviated}',
                // Must exist in the CARTO glyphs endpoint (both positron and
                // dark-matter carry the Montserrat stack).
                'text-font': ['Montserrat Regular'],
                'text-size': 12,
                'text-allow-overlap': true,
            },
            paint: { 'text-color': '#212529' },
        });

        // Individual facilities — all paint channels are per-feature
        // properties baked in _toGeoJSON (grade fill, declining ring, closed
        // grey+dim).
        this._map.addLayer({
            id: LYR_POINTS,
            type: 'circle',
            source: SRC,
            filter: ['!', ['has', 'point_count']],
            paint: {
                // 7px circles are sub-finger touch targets — bump on
                // coarse-pointer devices; tap→detail stays the primary path.
                'circle-radius': window.matchMedia('(pointer: coarse)').matches ? 10 : 7,
                'circle-color': ['get', 'fill'],
                'circle-opacity': ['get', 'fillOpacity'],
                'circle-stroke-color': ['get', 'stroke'],
                'circle-stroke-width': ['get', 'strokeW'],
            },
        });
    }

    /** One-time delegated event wiring. MapLibre keys these by layer id, so
     *  they survive style swaps (they just idle while the layer is absent). */
    _bindMapInteractions() {
        const map = this._map;
        const coarse = window.matchMedia('(pointer: coarse)').matches;

        // Hover tooltip (skipped on touch devices — tap opens the detail
        // panel directly).
        if (!coarse) {
            this._hoverPopup = new maplibregl.Popup({
                closeButton: false, closeOnClick: false,
                offset: 12, maxWidth: '280px',
                className: 'food-tip',
            });
            map.on('mousemove', LYR_POINTS, (e) => {
                const feat = e.features?.[0];
                const f = feat && this._byPermit.get(feat.properties.pid);
                if (!f) return;
                map.getCanvas().style.cursor = 'pointer';
                this._hoverPopup
                    .setLngLat(feat.geometry.coordinates.slice())
                    .setHTML(this._tooltipHTML(f))
                    .addTo(map);
            });
            map.on('mouseleave', LYR_POINTS, () => {
                map.getCanvas().style.cursor = '';
                this._hoverPopup?.remove();
            });
            map.on('mouseenter', LYR_CLUSTERS, () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', LYR_CLUSTERS, () => {
                map.getCanvas().style.cursor = '';
            });
        }

        map.on('click', LYR_POINTS, (e) => {
            const feat = e.features?.[0];
            const f = feat && this._byPermit.get(feat.properties.pid);
            if (f) this._select(f);
        });

        // Cluster click → zoom to the level where it breaks apart
        // (getClusterExpansionZoom is Promise-based in MapLibre).
        map.on('click', LYR_CLUSTERS, async (e) => {
            const feat = e.features?.[0];
            if (!feat) return;
            try {
                const zoom = await map.getSource(SRC)
                    .getClusterExpansionZoom(feat.properties.cluster_id);
                map.easeTo({ center: feat.geometry.coordinates, zoom: zoom + 0.5 });
            } catch (_) { /* cluster dissolved mid-click */ }
        });
    }

    _clusterColors() {
        if (this._mode === 'lite') {
            return ['step', ['get', 'point_count'],
                '#9aa1a9', 10, '#8b929b', 50, '#7d848d'];
        }
        return ['step', ['get', 'point_count'],
            '#6ecc39', 10, '#f0c20c', 50, '#f18017'];
    }

    _applyTheme() {
        if (!this._map || typeof maplibregl === 'undefined') return;
        const dark = this._isDark();
        if (this._styleIsDark === dark) return;
        this._styleIsDark = dark;
        this._mapReady = false;   // source dies with the old style
        // style.load re-installs the data layers over the new basemap.
        this._map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT);
    }

    // Active = a live permit. Anything else (Business Closed / Withdrawn /
    // Expired / Pending / *Closure / Suspended / Surrendered) is "closed".
    _isActive(f) {
        return (f.status || '').toLowerCase().includes('permitted');
    }

    _matchesFilters(f) {
        const { q, zip, grade, restaurantsOnly, showClosed } = this._filters;
        const lite = this._mode === 'lite';
        // Explicit === false so payloads without the field pass through
        // rather than blanking the map.
        if (restaurantsOnly && f.is_restaurant === false) return false;
        // Lite records carry no status (active-only by construction) and no
        // grades — those filters are hidden and inert there.
        if (!lite && !showClosed && !this._isActive(f)) return false;
        if (!lite && grade) {
            if (grade === 'F' && f.latest?.grade !== 'F') return false;
            else if (grade !== 'F' && f.latest?.grade !== grade) return false;
        }
        if (zip && f.zip !== zip) return false;
        if (q) {
            const hay = `${f.name || ''} ${f.address || ''} ${f.city || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    }

    // Marker fill by the active color-mode. (`gradeColor` is the data palette.)
    _markerColor(f) {
        const lt = f.latest || {};
        if (this._colorMode === 'compliance') {
            const c = lt.compliance_rate;
            if (c == null) return GRADE_COLORS.none;
            return c >= 0.9 ? GRADE_COLORS.A : c >= 0.75 ? GRADE_COLORS.B
                : c >= 0.6 ? GRADE_COLORS.C : c >= 0.4 ? GRADE_COLORS.D : GRADE_COLORS.F;
        }
        if (this._colorMode === 'repeat') {
            if ((lt.open_repeat || 0) > 0) return GRADE_COLORS.F;
            return lt.score == null ? GRADE_COLORS.none : GRADE_COLORS.A;
        }
        return gradeColor(lt.grade || null);
    }

    _tooltipHTML(f) {
        if (this._mode === 'lite') {
            return `<strong>${esc(f.name)}</strong><br>`
                + `${esc(f.address || '')}${f.city ? ', ' + esc(f.city) : ''}`
                + (f.approx ? '<br><span class="food-tip-sub">≈ approximate location</span>' : '');
        }
        const lt = f.latest || {};
        const grade = lt.grade || null;
        const score = lt.score;
        const trend = (f.score_trend || []).filter((s) => s != null);
        const arrow = trend.length >= 2
            ? (trend[0] < trend[1] ? ' ▼' : trend[0] > trend[1] ? ' ▲' : '') : '';
        const active = this._isActive(f);
        const sub = [];
        if (lt.compliance_rate != null) sub.push(`${Math.round(lt.compliance_rate * 100)}% compliant`);
        if (lt.open_repeat) sub.push(`${lt.open_repeat} open repeat`);
        return `<strong>${esc(f.name)}</strong><br>`
            + `${score != null ? `${score} · ${grade}${arrow}` : 'no scored inspection'}`
            + ` — ${esc(lt.date ? fmtDate(lt.date) : 'n/a')}`
            + (active ? '' : `<br><span class="food-tip-closed">${esc(f.status || 'closed')}</span>`)
            + (sub.length ? `<br><span class="food-tip-sub">${esc(sub.join(' · '))}</span>` : '');
    }

    /** Filtered facilities → FeatureCollection with per-feature paint props. */
    _toGeoJSON(filtered) {
        const lite = this._mode === 'lite';
        const features = [];
        for (const f of filtered) {
            if (f.lat == null || f.lon == null) continue;
            // Closed permits (shown only when "Show closed" is on) plot greyed
            // + dimmed so they read as not-currently-open at a glance.
            const active = lite || this._isActive(f);
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
                properties: {
                    pid: f.permit_id,
                    // Lite is the finder view: every marker a uniform neutral —
                    // the map locates places, it doesn't judge them.
                    fill: lite ? '#8d939c' : active ? this._markerColor(f) : '#9aa0a6',
                    fillOpacity: active ? 0.88 : 0.42,
                    // declining facilities get a heavier warning ring on any color-mode.
                    stroke: !active ? 'rgba(130, 130, 130, 0.55)'
                        : (!lite && f.declining) ? GRADE_COLORS.F : 'rgba(20, 20, 20, 0.55)',
                    strokeW: (!lite && f.declining) ? 2.5 : 1.5,
                },
            });
        }
        return { type: 'FeatureCollection', features };
    }

    _rebuildMarkers() {
        if (this._viewMode === 'list') { this._rebuildList(); return; }
        if (!this._map) return;

        const filtered = this._facilities.filter((f) => this._matchesFilters(f));
        this._geojson = this._toGeoJSON(filtered);
        // If a style swap is mid-flight the source is briefly absent —
        // style.load re-installs it with this._geojson as its data.
        if (this._mapReady) this._map.getSource(SRC)?.setData(this._geojson);
        this._updateCounts(filtered.length);
    }

    _updateCounts(filteredLen) {
        const countsEl = document.getElementById('foodCounts');
        if (!countsEl) return;
        const filterNote = filteredLen !== this._facilities.length ? `${filteredLen} of ` : '';
        countsEl.textContent = `${filterNote}${this._facilities.length} facilities`;
    }

    _setView(mode) {
        this._viewMode = mode;
        document.querySelectorAll('#foodViewToggle button[data-view]').forEach(
            (b) => b.classList.toggle('active', b.dataset.view === mode));
        document.getElementById('foodMapWrap')?.classList.toggle('d-none', mode !== 'map');
        document.getElementById('foodListWrap')?.classList.toggle('d-none', mode !== 'list');
        if (mode === 'map') {
            setTimeout(() => this._map?.resize(), 60);
            this._rebuildMarkers();
        } else {
            this._rebuildList();
        }
    }

    _updateColorLegend() {
        const el = document.getElementById('foodColorLegend');
        if (!el) return;
        if (this._mode === 'lite') {
            el.textContent = '';
            return;
        }
        el.textContent = ({
            grade: 'fill: grade (green A → red F)',
            compliance: 'fill: checklist compliance (green high → red low)',
            repeat: 'fill: red = open repeat violation',
        }[this._colorMode] || '') + ' · red ring = declining';
    }

    _rebuildList() {
        const body = document.getElementById('foodListBody');
        if (!body) return;
        const filtered = this._facilities.filter((f) => this._matchesFilters(f));
        const { key, dir } = this._sort;
        const val = (f) => {
            const lt = f.latest || {};
            switch (key) {
                case 'name': return (f.name || '').toLowerCase();
                case 'zip': return f.zip || '';
                case 'score': return lt.score == null ? -1 : lt.score;
                case 'compliance': return lt.compliance_rate == null ? -1 : lt.compliance_rate;
                case 'trend': { const t = (f.score_trend || []).filter((s) => s != null); return t.length >= 2 ? t[0] - t[1] : 0; }
                case 'date': return lt.date || '';
                default: return 0;
            }
        };
        filtered.sort((a, b) => {
            const va = val(a), vb = val(b);
            if (va < vb) return dir === 'asc' ? -1 : 1;
            if (va > vb) return dir === 'asc' ? 1 : -1;
            return 0;
        });
        const CAP = 600;
        const rows = filtered.slice(0, CAP);
        body.innerHTML = rows.map((f) => {
            const lt = f.latest || {};
            const t = (f.score_trend || []).filter((s) => s != null);
            const arrow = t.length >= 2 ? (t[0] < t[1] ? '▼' : t[0] > t[1] ? '▲' : '▬') : '';
            const tcol = t.length >= 2 ? (t[0] < t[1] ? GRADE_COLORS.F : t[0] > t[1] ? GRADE_COLORS.A : GRADE_COLORS.none) : '';
            const rowCls = [this._selectedPermit === f.permit_id ? 'sel' : '',
                (this._mode === 'lite' || this._isActive(f)) ? '' : 'food-closed'].filter(Boolean).join(' ');
            return `<tr data-permit="${esc(f.permit_id)}"${rowCls ? ` class="${rowCls}"` : ''}>
                <td class="food-list-name">${esc(f.name)}<div class="food-list-addr">${esc(f.address || '')}</div></td>
                <td>${esc(f.zip || '')}</td>
                <td><span class="food-list-score" style="background:${gradeColor(lt.grade || null)}">${lt.score ?? '—'}</span></td>
                <td>${lt.compliance_rate != null ? Math.round(lt.compliance_rate * 100) + '%' : '—'}</td>
                <td style="color:${tcol}">${arrow || '—'}</td>
                <td class="food-list-date">${fmtDate(lt.date)}</td>
            </tr>`;
        }).join('') + (filtered.length > CAP
            ? `<tr class="food-list-more"><td colspan="6">Showing first ${CAP} of ${filtered.length} — narrow the filters to see the rest.</td></tr>` : '');
        body.querySelectorAll('tr[data-permit]').forEach((tr) => {
            tr.addEventListener('click', () => {
                const f = this._facilities.find((x) => x.permit_id === tr.dataset.permit);
                if (f) this._select(f);
            });
        });
        document.querySelectorAll('#foodListTable th[data-sort]').forEach((th) => {
            const on = th.dataset.sort === key;
            th.classList.toggle('sorted', on);
            th.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
        });
        this._updateCounts(filtered.length);
    }

    _populateZipFilter() {
        const sel = document.getElementById('foodZipFilter');
        if (!sel) return;
        const current = sel.value;
        const zips = this._counts?.by_zip || {};
        const sorted = Object.keys(zips).sort();
        sel.innerHTML = '<option value="">All zips</option>'
            + sorted.map((z) =>
                `<option value="${esc(z)}">${esc(z)} (${zips[z]})</option>`).join('');
        if (sorted.includes(current)) sel.value = current;
    }

    // ── detail panel ────────────────────────────────────────────────────

    async _select(f) {
        this._selectedPermit = f.permit_id;
        const panel = document.getElementById('foodDetail');
        const inner = document.getElementById('foodDetailInner');
        if (!panel || !inner) return;
        panel.classList.remove('d-none');
        setTimeout(() => this._map?.resize(), 60);

        // Lite: everything shown is already in the roster record — render
        // locally and hand off to the official VDH page for the substance.
        if (this._mode === 'lite') {
            inner.innerHTML = this._renderLiteDetail(f);
            inner.querySelector('.food-detail-close')
                ?.addEventListener('click', () => this._closeDetail());
            if (this._viewMode === 'list') this._rebuildList();
            return;
        }

        inner.innerHTML = `<div class="p-3 text-muted">Loading ${esc(f.name)}…</div>`;

        const detail = await this.api.getFoodFacilityDetail(f.permit_id);
        if (this._selectedPermit !== f.permit_id) return;  // user clicked away
        if (!detail || !detail.available) {
            inner.innerHTML = `<div class="p-3 text-muted">Failed to load: `
                + `${esc(detail?.reason || detail?.error || 'unknown')}</div>`;
            return;
        }
        inner.innerHTML = this._renderDetail(detail.facility, detail.inspections);
        inner.querySelector('.food-detail-close')
            ?.addEventListener('click', () => this._closeDetail());
    }

    _closeDetail() {
        this._selectedPermit = null;
        document.getElementById('foodDetail')?.classList.add('d-none');
        setTimeout(() => this._map?.resize(), 60);
    }

    /** Lite detail panel: identity + the hand-off to the official record. */
    _renderLiteDetail(f) {
        return `
            <div class="food-detail-head">
                <div class="food-detail-title">
                    <h5>${esc(f.name)}</h5>
                    <button type="button" class="btn-close food-detail-close" aria-label="Close"></button>
                </div>
                <div class="text-muted small">
                    ${esc(f.address)}${f.address2 ? ' ' + esc(f.address2) : ''}${f.city ? ', ' + esc(f.city) : ''}, VA ${esc(f.zip || '')}
                    ${f.approx ? '<span class="food-approx" title="Address didn\'t geocode — marker sits near the ZIP center, not the building">≈ approximate location</span>' : ''}
                </div>
            </div>
            <div class="food-lite-cta">
                <a class="btn btn-sm btn-primary" target="_blank" rel="noopener"
                   href="${PORTAL_PERMIT_URL}${encodeURIComponent(f.permit_id)}">
                    View inspections on VDH <i class="bi bi-box-arrow-up-right"></i>
                </a>
                <div class="text-muted small mt-2">
                    Inspection reports live on the official VDH portal — this map is a finder.
                </div>
            </div>`;
    }

    _geoNote(source) {
        // Rooftop-quality geocode sources get no flag.
        if (source === 'zip_centroid') {
            return '<span class="food-approx" title="Address didn\'t geocode — marker sits at the ZIP centroid, not the building">≈ ZIP-centroid</span>';
        }
        if (source === 'census_batch' || source === 'census_oneline') {
            return '<span class="food-approx food-approx-street" title="Street-level only (Census centerline) — pin may sit ~50 m off, on the road rather than the building">≈ street-level</span>';
        }
        return '';
    }

    _renderDetail(fac, inspections) {
        const latest = inspections[0] || null;
        const grade = latest?.grade || null;
        const score = latest?.score;
        const geoNote = this._geoNote(fac.geocode?.source);
        const cs = latest?.checklist_summary || null;
        const sets = this._disposSets(latest?.checklist);

        const scoreHero = latest ? `
            <div class="food-score-hero">
                <span class="food-score-badge" style="background:${gradeColor(grade)}">
                    ${score != null ? esc(score) : '—'}
                </span>
                <div class="food-score-meta">
                    <div class="food-score-grade">Grade ${esc(grade || '—')}
                        <span class="food-score-computed" title="VDH publishes no numeric score — this one is computed from the cited violations (see the note below the map)">computed</span></div>
                    <div class="text-muted small">${esc(latest.insp_type)} · ${esc(latest.purpose)} · ${fmtDate(latest.date)}</div>
                    <div class="text-muted small">${latest.violation_count} violation${latest.violation_count === 1 ? '' : 's'}
                        (${latest.risk_factor_count} risk-factor)</div>
                </div>
                ${this._sparkline(inspections)}
            </div>
            ${this._complianceBar(cs)}` : '<div class="text-muted small mb-2">No inspection detail available yet.</div>';

        const statusNote = (fac.status_onpage && fac.status
            && fac.status_onpage.toLowerCase() !== (fac.status || '').toLowerCase()) ? `
            <div class="food-status-note" title="The inspection page reports a different status than the permit roster">
                <i class="bi bi-exclamation-triangle"></i> inspection page says: ${esc(fac.status_onpage)}</div>` : '';

        const flags = (latest?.red_flags || []);
        const flagsHtml = latest ? (flags.length ? `
            <div class="food-flags">
                <div class="food-section-title">Biggest red flags — last report</div>
                ${flags.map((fl) => `
                    <div class="food-flag${fl.category === 'risk_factor' ? ' food-flag-rf' : ''}">
                        ${this._disposBadge(fl.item, sets)}
                        <span class="food-flag-item" title="VA form item ${esc(fl.item ?? '?')} · ${esc(fl.code || 'no code')}">#${esc(fl.item ?? '?')}</span>
                        ${(fl.repeat || sets.repeat.has(fl.item)) ? '<span class="food-flag-repeat">repeat</span>' : ''}
                        <span class="food-flag-text">${esc(fl.text)}</span>
                    </div>`).join('')}
            </div>` : '<div class="food-flags"><div class="food-section-title">Biggest red flags — last report</div><div class="text-muted small">None — nothing on the last report would make a diner wince.</div></div>') : '';

        const history = inspections.length ? `
            <div class="food-section-title">Inspection history (${inspections.length})</div>
            ${inspections.map((insp, i) => this._renderInspection(insp, i === 0)).join('')}`
            : '';

        return `
            <div class="food-detail-head">
                <div class="food-detail-title">
                    <h5>${esc(fac.name)}</h5>
                    <button type="button" class="btn-close food-detail-close" aria-label="Close"></button>
                </div>
                <div class="text-muted small">
                    ${esc(fac.address)}${fac.address2 ? ' ' + esc(fac.address2) : ''}, ${esc(fac.city)}, ${esc(fac.state)} ${esc(fac.zip)}
                    ${geoNote}
                </div>
                <div class="text-muted small">
                    ${esc(fac.permit_type)} · ${esc(fac.status)} ·
                    <a href="${PORTAL_PERMIT_URL}${encodeURIComponent(fac.permit_id)}" target="_blank" rel="noopener">VDH record</a>
                </div>
                ${statusNote}
                ${(fac.merged_from || []).length ? `
                <div class="text-muted small" title="Same address, near-identical name — a re-issued permit. History below spans all permits.">
                    Includes earlier permit${fac.merged_from.length === 1 ? '' : 's'}:
                    ${fac.merged_from.map((m) =>
                        `<a href="${PORTAL_PERMIT_URL}${encodeURIComponent(m.permit_id)}" target="_blank" rel="noopener">${esc(m.name)}</a>`).join(' · ')}
                </div>` : ''}
            </div>
            ${scoreHero}
            ${flagsHtml}
            <div class="food-history">${history}</div>`;
    }

    // item#s by disposition, from a parsed checklist — used to badge violations
    // "fixed on site" / "open" / "repeat" (the authoritative structured source).
    _disposSets(checklist) {
        const cos = new Set(), open = new Set(), repeat = new Set();
        for (const r of (checklist || [])) {
            if (r.item == null) continue;
            if (r.cos) cos.add(r.item);
            if (r.violation && !r.cos) open.add(r.item);
            if (r.repeat) repeat.add(r.item);
        }
        return { cos, open, repeat };
    }

    _disposBadge(item, sets) {
        if (item != null && sets.cos.has(item))
            return '<span class="food-dispos food-dispos-cos" title="Corrected on site during the inspection">fixed</span>';
        if (item != null && sets.open.has(item))
            return '<span class="food-dispos food-dispos-open" title="Cited and left open at the inspection">open</span>';
        return '';
    }

    // Per-score grade color (the A≥90 … F<60 bands / GRADE_COLORS).
    _scoreColor(s) {
        return s >= 90 ? GRADE_COLORS.A : s >= 80 ? GRADE_COLORS.B
            : s >= 70 ? GRADE_COLORS.C : s >= 60 ? GRADE_COLORS.D : GRADE_COLORS.F;
    }

    // Small inline score sparkline (oldest → newest, left → right), each vertex
    // labelled with its score. The line is a STATIC vertical gradient keyed to
    // the SCORE axis; green at the top (100), red at the bottom (0), with stops
    // on the grade bands so a point's height reads as its grade.
    _sparkline(inspections) {
        const pts = (inspections || []).map((i) => i.score).filter((s) => s != null).reverse();
        if (pts.length < 2) return '';
        const W = 120, H = 44, padX = 12, padTop = 16, padBot = 8;
        const innerH = H - padTop - padBot;
        const x = (i) => padX + i * ((W - padX * 2) / (pts.length - 1));
        const y = (s) => padTop + (1 - s / 100) * innerH;
        const coords = pts.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`);
        const last = pts[pts.length - 1];
        const dots = pts.map((s, i) =>
            `<circle cx="${x(i).toFixed(1)}" cy="${y(s).toFixed(1)}" r="1.8" fill="${this._scoreColor(s)}"/>`).join('');
        const labels = pts.map((s, i) =>
            `<text class="food-spark-score" x="${x(i).toFixed(1)}" y="${(y(s) - 4).toFixed(1)}" text-anchor="middle">${s}</text>`).join('');
        // Vertical gradient in user space: top (score 100) → bottom (score 0),
        // stops at the grade-band boundaries (A green · B lime · C amber · D
        // orange · F red).
        const grad = `<linearGradient id="food-spark-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${y(100).toFixed(1)}" x2="0" y2="${y(0).toFixed(1)}">`
            + `<stop offset="0" stop-color="${GRADE_COLORS.A}"/>`
            + `<stop offset="0.1" stop-color="${GRADE_COLORS.A}"/>`
            + `<stop offset="0.2" stop-color="${GRADE_COLORS.B}"/>`
            + `<stop offset="0.3" stop-color="${GRADE_COLORS.C}"/>`
            + `<stop offset="0.4" stop-color="${GRADE_COLORS.D}"/>`
            + `<stop offset="0.45" stop-color="${GRADE_COLORS.F}"/>`
            + `<stop offset="1" stop-color="${GRADE_COLORS.F}"/>`
            + `</linearGradient>`;
        return `<div class="food-spark" title="Computed score across the last ${pts.length} inspections">
            <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score across the last ${pts.length} inspections, latest ${last}">
                <defs>${grad}</defs>
                <polyline points="${coords.join(' ')}" fill="none" stroke="url(#food-spark-grad)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>
                ${dots}
                ${labels}
            </svg>
        </div>`;
    }

    // Compliance "breadth" bar — complements the severity score.
    _complianceBar(cs) {
        if (!cs || cs.compliance_rate == null) return '';
        const pct = Math.round(cs.compliance_rate * 100);
        const compliant = cs.compliant ?? 0, out = cs.out ?? 0;
        const sub = [];
        if (cs.cos) sub.push(`${cs.cos} corrected on site`);
        if (cs.repeat) sub.push(`${cs.repeat} repeat`);
        return `
        <div class="food-compliance" title="Share of applicable food-code items in compliance on the last report (excludes N/A · N/O)">
            <div class="food-compliance-head">
                <span class="food-compliance-label">Checklist compliance</span>
                <span class="food-compliance-pct">${pct}% — ${esc(compliant)} of ${esc(compliant + out)}</span>
            </div>
            <div class="food-compliance-bar">
                <span class="food-compliance-ok" style="width:${pct}%"></span>
                <span class="food-compliance-bad" style="width:${100 - pct}%"></span>
            </div>
            ${sub.length ? `<div class="food-compliance-sub">${esc(sub.join(' · '))}</div>` : ''}
        </div>`;
    }

    _renderInspection(insp, openByDefault) {
        const grade = insp.grade || null;
        const violations = insp.violations || [];
        const sets = this._disposSets(insp.checklist);
        const cs = insp.checklist_summary || null;
        return `
        <details class="food-insp"${openByDefault ? ' open' : ''}>
            <summary>
                <span class="food-insp-score" style="background:${gradeColor(grade)}">${insp.score ?? '—'}</span>
                <span class="food-insp-when">${fmtDate(insp.date)}</span>
                <span class="food-insp-kind text-muted">${esc(insp.insp_type)} · ${esc(insp.purpose)}</span>
                ${cs && cs.compliance_rate != null
                    ? `<span class="food-insp-compliance" title="checklist compliance">${Math.round(cs.compliance_rate * 100)}%</span>` : ''}
                <span class="food-insp-count text-muted">${violations.length} viol.</span>
            </summary>
            <div class="food-insp-body">
                ${violations.length ? violations.map((v) => `
                    <div class="food-viol${(v.item != null && v.item <= 29) ? ' food-viol-rf' : ''}">
                        <div class="food-viol-head">
                            ${this._disposBadge(v.item, sets)}
                            <span class="food-viol-item" title="${esc(v.code || 'no regulation code')}">#${esc(v.item ?? '?')}</span>
                            ${sets.repeat.has(v.item) ? '<span class="food-flag-repeat">repeat</span>' : ''}
                            <span class="food-viol-text">${esc(v.text)}</span>
                        </div>
                        ${v.corrective ? `<div class="food-viol-corrective">↳ ${esc(v.corrective)}</div>` : ''}
                    </div>`).join('')
                : '<div class="text-muted small px-1">No violations recorded — clean report.</div>'}
                ${this._renderChecklist(insp.checklist)}
                ${insp.comments ? `<div class="food-insp-comments"><strong>Inspector comments:</strong> ${esc(insp.comments)}</div>` : ''}
                ${this._renderTemps(insp.temps_v2, insp.temps)}
            </div>
        </details>`;
    }

    // The full food-code checklist (passing items too), grouped by category,
    // each category collapsible with a pass-rate bar. Sentinel rows excluded.
    _renderChecklist(checklist) {
        const rows = (checklist || []).filter((r) => !r.is_sentinel);
        if (!rows.length) return '';
        const cats = [], byCat = new Map();
        for (const r of rows) {
            const c = r.category || 'Other';
            if (!byCat.has(c)) { byCat.set(c, []); cats.push(c); }
            byCat.get(c).push(r);
        }
        const out = rows.filter((r) => r.violation).length;
        const cats_html = cats.map((c) => {
            const cr = byCat.get(c);
            const cOk = cr.filter((r) => r.compliant).length;
            const cOut = cr.filter((r) => r.violation).length;
            const denom = cOk + cOut;
            const okPct = denom ? Math.round((cOk / denom) * 100) : 100;
            const rowsHtml = cr.map((r) => {
                const cls = r.compliant ? 'in' : (r.violation ? 'out' : 'na');
                return `<div class="food-cl-row food-cl-${cls}">
                    <span class="food-cl-disp food-cl-disp-${cls}">${esc(r.disposition || (r.compliant ? 'IN' : 'OUT'))}</span>
                    <span class="food-cl-item">#${esc(r.item ?? '?')}</span>
                    ${r.cos ? '<span class="food-dispos food-dispos-cos">fixed</span>' : ''}
                    ${r.repeat ? '<span class="food-flag-repeat">repeat</span>' : ''}
                    <span class="food-cl-text">${esc(r.standard_text)}</span>
                </div>`;
            }).join('');
            return `<details class="food-cl-cat${cOut ? ' has-out' : ''}">
                <summary>
                    <span class="food-cl-cat-name">${esc(c)}</span>
                    <span class="food-cl-cat-count">${cOk}/${denom}</span>
                    <span class="food-cl-cat-bar"><span style="width:${okPct}%"></span></span>
                </summary>
                <div class="food-cl-rows">${rowsHtml}</div>
            </details>`;
        }).join('');
        return `<details class="food-checklist">
            <summary class="text-muted small">Full food-code checklist — ${rows.length} items, ${out} out of compliance</summary>
            <div class="food-checklist-body">${cats_html}</div>
        </details>`;
    }

    _renderTemps(tv, fallback) {
        const has = tv && (tv.food_present || tv.warewashing_present || tv.equipment_present);
        if (!has) return this._renderTempsLegacy(fallback);
        const out = [];
        if (tv.food_present && (tv.food || []).length) {
            out.push(`<div class="food-temp-cat">Food temperatures</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Item</th><th>Temp</th><th>State</th></tr>`
                + tv.food.map((r) => {
                    const bad = this._foodTempBad(r);
                    return `<tr class="${bad ? 'food-temp-bad' : ''}"><td>${esc(r.description || '')}</td>`
                        + `<td>${esc(r.temperature || '')}</td><td>${esc(r.state_of_food || '')}`
                        + `${bad ? ' <i class="bi bi-exclamation-triangle" title="outside the safe holding range"></i>' : ''}</td></tr>`;
                }).join('') + `</table></div>`);
        }
        if (tv.warewashing_present && (tv.warewashing || []).length) {
            out.push(`<div class="food-temp-cat">Warewashing &amp; sanitizer</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Machine</th><th>Method</th><th>PPM</th><th>Temp</th></tr>`
                + tv.warewashing.map((r) => {
                    const bad = this._sanitizerBad(r);
                    const chem = [r.method, r.sanitizer_type || r.sanitizer_name].filter(Boolean).join(' ');
                    return `<tr class="${bad ? 'food-temp-bad' : ''}"><td>${esc(r.machine || '')}</td>`
                        + `<td>${esc(chem)}</td><td>${r.ppm != null ? esc(r.ppm) : ''}`
                        + `${bad ? ' <i class="bi bi-exclamation-triangle" title="sanitizer concentration / temp out of range"></i>' : ''}</td>`
                        + `<td>${esc(r.temperature || '')}</td></tr>`;
                }).join('') + `</table></div>`);
        }
        if (tv.equipment_present && (tv.equipment || []).length) {
            out.push(`<div class="food-temp-cat">Equipment temperatures</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Equipment</th><th>Temp</th></tr>`
                + tv.equipment.map((r) =>
                    `<tr><td>${esc(r.description || '')}</td><td>${esc(r.temperature || '')}</td></tr>`).join('')
                + `</table></div>`);
        }
        if (!out.length) return this._renderTempsLegacy(fallback);
        const n = (tv.food || []).length + (tv.warewashing || []).length + (tv.equipment || []).length;
        return `<details class="food-temps"><summary class="text-muted small">Temperatures &amp; sanitizer (${n} readings)</summary>${out.join('')}</details>`;
    }

    _renderTempsLegacy(temps) {
        if (!temps || !temps.length) return '';
        return `<details class="food-temps">
            <summary class="text-muted small">Temperature log (${temps.reduce((n, t) => n + t.rows.length, 0)} readings)</summary>
            ${temps.map((t) => `<div class="food-temp-cat">${esc(t.category)}</div>`
                + `<div class="food-temp-scroll"><table class="food-temp-table">${t.rows.map((r) =>
                    `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`).join('')}
        </details>`;
    }

    _foodTempBad(r) {
        const t = typeof r.temperature_f === 'number' ? r.temperature_f : null;
        if (t == null) return false;
        const s = (r.state_of_food || '').toLowerCase();
        if (s.includes('cold')) return t > 41;
        if (s.includes('hot')) return t < 135;
        return false;
    }

    _sanitizerBad(r) {
        const method = (r.method || '').toLowerCase();
        if (method.includes('high') || method.includes('heat'))
            return typeof r.temperature_f === 'number' && r.temperature_f < 160;
        const ppm = typeof r.ppm === 'number' ? r.ppm : null;
        if (ppm == null) return false;
        const type = (r.sanitizer_type || r.sanitizer_name || '').toLowerCase();
        if (type.includes('chlor')) return ppm < 50 || ppm > 200;
        if (type.includes('quat')) return ppm < 150 || ppm > 400;
        return ppm < 50;
    }
}
