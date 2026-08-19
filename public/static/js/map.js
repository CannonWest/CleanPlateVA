/**
 * Map plumbing — MapLibre construction, auto-locate, the facilities source
 * and cluster / point / stack layers, the pre-drawn ring images, delegated
 * map interactions, locate feedback, cluster tint, theme restyle, and the
 * dark-matter major-road label fix. `mapMethods` is installed on
 * FoodDashboard.prototype by foodDashboard.js (`this` is the dashboard).
 */

import {
    CLUSTER_RADII, CLUSTER_STEPS, DARK_MAJOR_ROAD_LABEL_COLOR, DARK_MAJOR_ROAD_LABEL_LAYER,
    GRADE_COLORS, LYR_CLUSTERS, LYR_CLUSTER_COUNT, LYR_POINTS, LYR_STACKS, LYR_STACK_COUNT,
    LYR_STACK_RING, SRC, STYLE_DARK, STYLE_LIGHT, VA_BOUNDS, VA_FIT,
} from './constants.js';
import {
    CLUSTER_MAX_ZOOM, LONE_PLACE_FILTER, STACK_FILTER, STACK_RADII, STACK_RING_COLORS,
    STACK_RING_GAP,
} from './stacks.js';
import { hitSlop, markRadius, pickMark, pointRadius } from './markers.js';
import { coordsOf } from './presentation.js';

export const mapMethods = {
    // ── map plumbing ────────────────────────────────────────────────────

    _isDark() {
        return document.body.classList.contains('theme-dark');
    },

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
            bounds: VA_BOUNDS,
            fitBoundsOptions: VA_FIT,
            maxZoom: 19,
            // Circle layers redraw from new tile data the instant a zoom
            // reclusters; symbol layers cross-fade over this duration (300ms
            // by default). The two disagreeing is very visible here because
            // the counts and the bubbles they belong to are the same object:
            // zooming left a scatter of orphaned numbers hanging over the map
            // for a beat after their bubbles had already moved or dissolved.
            // Circles have no matching fade to switch ON, so the halves are
            // squared by turning this one OFF. Map-level, so it survives the
            // theme swap's setStyle; it also stops the basemap's own labels
            // fading, which is the price of the two agreeing.
            fadeDuration: 0,
        });
        this._map.addControl(
            new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
        // "Find me" — browser geolocation. Drops the blue dot + accuracy
        // circle (DOM markers, so they survive theme style-swaps) and follows
        // until the user pans away. The control self-disables at add time
        // when the permissions probe says geolocation is unavailable
        // (insecure origin, prior denial); the colored error states only
        // happen when a position request fails after a successful add.
        const geolocate = new maplibregl.GeolocateControl({
            // Full object on purpose — the control's option merge is shallow,
            // so a partial one would silently drop these. The 6s timeout keeps
            // a MANUAL button press snappy: it's a deliberate ask, so a genuine
            // failure earns the error note quickly. maximumAge lets the control
            // reuse the fix auto-locate just acquired (see _autoLocate) rather
            // than firing a second lookup on the programmatic hand-off.
            positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 },
            trackUserLocation: true,
            // Land at neighborhood radius: clusters dissolve above zoom 12,
            // and CARTO's 512px tiles render ~1 zoom tighter than usual —
            // the library-default 15 would frame a couple of residential
            // blocks with zero markers in them.
            fitBoundsOptions: { maxZoom: 13 },
        });
        geolocate.on('geolocate', (pos) => this._onGeolocate(pos));
        geolocate.on('error', () => this._showMapNote(
            'We couldn\'t find your location. Check that location access is on for your browser.'));
        // Follow-mode bookkeeping via the control's public events: the
        // coverage note's back-link must know whether to switch the control
        // off before moving the camera (see _showMapNote).
        this._geolocate = geolocate;
        geolocate.on('trackuserlocationstart', () => { this._geoFollowing = true; });
        geolocate.on('userlocationfocus', () => { this._geoFollowing = true; });
        geolocate.on('trackuserlocationend', () => { this._geoFollowing = false; });
        geolocate.on('userlocationlostfocus', () => { this._geoFollowing = false; });
        this._map.addControl(geolocate, 'top-left');
        this._autoLocate();

        // Fires on the initial style AND after every setStyle (theme swap) —
        // custom sources/layers don't survive a style swap, so this is the
        // one place they're (re-)installed.
        this._map.on('style.load', () => {
            this._installDataLayers();
            this._fixDarkRoadLabelContrast();
        });

        this._bindMapInteractions();

        // The container may have been zero-sized at construction (hidden
        // tab, flex height not yet resolved), which would bake a wrong zoom
        // into the bounds fit. Resize to the real dimensions, then re-fit the
        // state to them once — unless a location fix has already claimed the
        // camera, in which case the visitor's own view wins.
        setTimeout(() => {
            this._map.resize();
            if (!this._geoFollowing) this._map.fitBounds(VA_BOUNDS, { ...VA_FIT, duration: 0 });
        }, 50);
    },

    /** Ask for the visitor's location on open instead of waiting for a
     *  button press — a finder map should start from where they stand.
     *  First visit surfaces the browser's permission prompt; a standing
     *  grant flies straight to their neighborhood. */
    async _autoLocate() {
        // A standing denial renders the control disabled, but trigger()
        // has no disabled-check — it would still fire a doomed request.
        // Probe and stay quiet.
        try {
            const perm = await navigator.permissions.query({ name: 'geolocation' });
            if (perm.state === 'denied') return;
        } catch (_) { /* no Permissions API — the request below finds out */ }
        // Auto-locate is unsolicited and best-effort, so it runs its OWN
        // request rather than the control's, for two reasons:
        //  1. A patient timeout. The browser counts the seconds the permission
        //     prompt sits unanswered against this timeout, so it has to cover
        //     human decision time — not just fix latency. 20s means a visitor
        //     who takes a beat to click Allow still gets flown in, where the
        //     control's snappy 6s would have "timed out" mid-decision.
        //  2. Silence on every failure — denial, timeout, no signal. Nobody
        //     asked to be located and the statewide map stands on its own, so
        //     a miss just leaves it be. The error note is reserved for a
        //     manual button press (a deliberate ask), which keeps the 6s.
        // On success the control takes over to draw the dot and follow; it
        // reuses this just-acquired fix via its maximumAge (no second lookup).
        navigator.geolocation?.getCurrentPosition(
            () => {
                // The control finishes its own setup async (same permissions
                // probe); trigger() returns false until then.
                const kick = (attemptsLeft) => {
                    if (this._geolocate?.trigger() || attemptsLeft <= 0) return;
                    setTimeout(() => kick(attemptsLeft - 1), 200);
                };
                kick(10);
            },
            () => { /* silent: unsolicited, and the map already shows the state */ },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
        );
    },

    /** Add the facilities source + cluster/point layers to the CURRENT style.
     *  Idempotent per style — style.load hands us a bare basemap each time. */
    _installDataLayers() {
        if (!this._map || this._map.getSource(SRC)) return;
        this._mapReady = true;

        this._installRingImages();

        this._map.addSource(SRC, {
            type: 'geojson',
            data: this._geojson || { type: 'FeatureCollection', features: [] },
            // Bubbles dissolve as you zoom in: grouped at metro view, plain
            // dots from neighborhood zoom up.
            cluster: true,
            clusterMaxZoom: CLUSTER_MAX_ZOOM,
            clusterRadius: 40,
            // Every feature carries `stack` (1 for a lone place), so a cluster
            // reports the PLACES inside it rather than the points it drew over.
            // Without this a cluster covering Dulles counts 57 permits as one.
            clusterProperties: {
                sum: ['+', ['get', 'stack']],
                // Raw sum + count, not a mean: adding them gives a cluster
                // the mean over its PLACES. Averaging per-point means would
                // weight a lone diner equally against a 57-permit food court.
                gradeSum: ['+', ['get', 'gradeSum']],
                gradeCount: ['+', ['get', 'gradeCount']],
            },
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
                // Sized by places, like the label counts them — a bubble over
                // one food court should not read smaller than its neighbours.
                // Same constants the hit test measures against (markers.js
                // clusterRadius) — a target that disagrees with the paint is
                // worse than no slop at all.
                'circle-radius': ['step', ['get', 'sum'],
                    CLUSTER_RADII[0], CLUSTER_STEPS[0], CLUSTER_RADII[1],
                    CLUSTER_STEPS[1], CLUSTER_RADII[2]],
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
                // `sum` (see clusterProperties), not point_count: a cluster
                // must count places, and one feature can stand for 57 of them.
                // point_count_abbreviated came free; abbreviate sum by hand.
                'text-field': ['case',
                    ['>=', ['get', 'sum'], 1000],
                    ['concat',
                        ['to-string', ['/', ['round', ['/', ['get', 'sum'], 100]], 10]],
                        'k'],
                    ['to-string', ['get', 'sum']]],
                // Must exist in the CARTO glyphs endpoint (both positron and
                // dark-matter carry the Montserrat stack).
                'text-font': ['Montserrat Regular'],
                'text-size': 12,
                'text-allow-overlap': true,
            },
            // White on a dark halo rather than near-black. The tint is a
            // grade now, and no flat label colour clears AA across that
            // palette — near-black is 3.4:1 on F red. The halo also fixes
            // lite, where near-black on the 50+ grey was 4.1:1 before the
            // 0.85 fill opacity dragged it to ~3.3:1 over dark-matter.
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(20, 20, 20, 0.85)',
                'text-halo-width': 1.6,
            },
        });

        // Individual facilities — all paint channels are per-feature
        // properties baked in _toGeoJSON (grade fill, declining ring, closed
        // grey+dim).
        this._map.addLayer({
            id: LYR_POINTS,
            type: 'circle',
            source: SRC,
            filter: LONE_PLACE_FILTER,
            paint: {
                // 7px circles are sub-finger touch targets — bump on
                // coarse-pointer devices; tap→detail stays the primary path.
                // Both radii live in constants.js because the hit test has to
                // measure against exactly what is drawn.
                'circle-radius': pointRadius(this._coarsePointer()),
                'circle-color': ['get', 'fill'],
                'circle-opacity': ['get', 'fillOpacity'],
                'circle-stroke-color': ['get', 'stroke'],
                'circle-stroke-width': ['get', 'strokeW'],
            },
        });

        // Stacks sit above the lone dots: a point standing for 57 places
        // outranks its neighbours, and its count must never be occluded.
        //
        // The halo is dashed where a proximity cluster's is a solid 4px white
        // ring, and the fill comes from the grade palette rather than the
        // count ramp — so the two bubbles never claim to mean the same thing.
        // Dashed-over-filled is the refinement editor's own ghost-badge
        // idiom ("things inside"), carried over so one mark reads one way on
        // both surfaces.
        this._map.addLayer({
            id: LYR_STACK_RING,
            type: 'symbol',
            source: SRC,
            filter: STACK_FILTER,
            layout: {
                'icon-image': ['get', 'ring'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
        });
        this._map.addLayer({
            id: LYR_STACKS,
            type: 'circle',
            source: SRC,
            filter: STACK_FILTER,
            paint: {
                'circle-radius': ['step', ['get', 'stack'],
                    STACK_RADII[0], 10, STACK_RADII[1], 50, STACK_RADII[2]],
                'circle-color': ['get', 'fill'],
                'circle-opacity': ['get', 'fillOpacity'],
                'circle-stroke-color': ['get', 'stroke'],
                'circle-stroke-width': ['get', 'strokeW'],
            },
        });
        this._map.addLayer({
            id: LYR_STACK_COUNT,
            type: 'symbol',
            source: SRC,
            filter: STACK_FILTER,
            layout: {
                'text-field': ['to-string', ['get', 'stack']],
                'text-font': ['Montserrat Regular'],
                'text-size': 11,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                // Outside the disc, up and to the right. Inside it no single
                // label colour survives the grade palette: white fails on
                // amber (2.1:1), near-black fails on red (3.4:1), and neither
                // clears AA on green. Outside with a dark halo it passes on
                // every fill.
                'text-offset': ['step', ['get', 'stack'],
                    ['literal', [1.4, -1.3]],
                    10, ['literal', [1.6, -1.5]],
                    50, ['literal', [1.8, -1.7]]],
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(20, 20, 20, 0.85)',
                'text-halo-width': 1.6,
            },
        });
    },

    /** Draw the dashed halos for this style. Cheap — nine colours by three
     *  sizes of ~40px canvas — but it has to rerun after every setStyle,
     *  which drops registered images along with the layers. */
    _installRingImages() {
        const ratio = 2;
        for (const [key, color] of Object.entries(STACK_RING_COLORS)) {
            for (const core of STACK_RADII) {
                const id = `stack-ring-${key}-${core}`;
                if (this._map.hasImage(id)) continue;
                const radius = core + STACK_RING_GAP;
                const box = radius + 2;                 // room for the stroke
                const size = Math.ceil(box * 2 * ratio);
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.scale(ratio, ratio);
                ctx.strokeStyle = color;
                ctx.globalAlpha = 0.8;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(box, box, radius, 0, 2 * Math.PI);
                ctx.stroke();
                this._map.addImage(
                    id, ctx.getImageData(0, 0, size, size), { pixelRatio: ratio });
            }
        }
    },

    _coarsePointer() {
        return window.matchMedia('(pointer: coarse)').matches;
    },

    /** Which mark did the pointer mean?
     *
     *  Events are resolved against a box padded by `hitSlop` rather than
     *  against the mark itself, so a 7px dot answers to roughly a 17px target.
     *  `pickMark` (markers.js) settles overlaps: on-target keeps the painted
     *  z-order exactly as MapLibre's layer-scoped events did, and only a
     *  pointer that is inside nothing falls back to nearest-edge.
     *
     *  Returns the winning candidate — `{ feature, layerId, gap, inside }` —
     *  or null when the pointer is not near anything. */
    _pickMarkAt(point) {
        const map = this._map;
        if (!map || !this._mapReady) return null;
        const layers = [LYR_STACKS, LYR_POINTS, LYR_CLUSTERS].filter((id) => map.getLayer(id));
        if (!layers.length) return null;
        const coarse = this._coarsePointer();
        const slop = hitSlop(coarse);
        const box = [
            [point.x - slop, point.y - slop],
            [point.x + slop, point.y + slop],
        ];
        let features;
        try {
            features = map.queryRenderedFeatures(box, { layers });
        } catch (_) {
            return null;            // style swap mid-move: the layers are gone
        }
        if (!features.length) return null;
        const candidates = features.map((feature) => {
            const at = map.project(feature.geometry.coordinates);
            return {
                feature,
                layerId: feature.layer.id,
                dx: at.x - point.x,
                dy: at.y - point.y,
                radius: markRadius(feature.layer.id, feature.properties, coarse),
            };
        });
        return pickMark(candidates, slop);
    },

    /** One-time event wiring. These hang off the MAP rather than off layer
     *  ids — a padded hit test has to see every mark type at once to judge
     *  which is nearest — so they survive style swaps on their own, and
     *  `_pickMarkAt` simply finds no layers while one is in flight. */
    _bindMapInteractions() {
        const map = this._map;
        const coarse = this._coarsePointer();

        // Marker-bound hover preview (skipped on touch devices — tap opens the
        // detail panel directly). The popup is display-only and mouse-
        // transparent: leaving the marker removes it immediately. Full tier
        // renders the whole card — grade hero, dates, sparkline — from the
        // overlay row in memory (hover.js); nothing is fetched on hover.
        // Interactive trend/receipt behavior belongs only to the clicked panel.
        if (!coarse) {
            this._hoverPopupFor(null);   // hover.js owns the construction
            map.on('mousemove', (e) => this._onMapHover(e));
            // Leaving the canvas is not a mousemove, so the card would hang.
            map.on('mouseout', () => {
                map.getCanvas().style.cursor = '';
                this._hideHoverCard();
            });
        }

        map.on('click', (e) => this._onMapClick(e));

        // Escape closes the web, unless the grade-receipt modal is up and
        // owns the key.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._spider && !this._receiptHost) {
                this._dismissSpider();
            }
        });
    },

    /** Hover: cursor, and the card for whatever the pointer means. */
    _onMapHover(e) {
        const map = this._map;
        // Markers are DOM children of the map CONTAINER, not siblings of it,
        // so a pointer over a spider leg or the stack panel still bubbles a
        // map-level mousemove. That is not "the pointer is over empty ground":
        // the leg owns that moment and has already opened its own card, and
        // without this guard the card is shown by the leg and hidden again by
        // this handler on the very same movement. Layer-scoped handlers never
        // had the problem because they only fired over their own features.
        if (e.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
        const hit = this._pickMarkAt(e.point);
        if (!hit) {
            map.getCanvas().style.cursor = '';
            this._hideHoverCard();
            return;
        }
        map.getCanvas().style.cursor = 'pointer';

        if (hit.layerId === LYR_CLUSTERS) {
            // A cluster is a camera control, not a place: cursor only.
            this._hideHoverCard();
            return;
        }

        if (hit.layerId === LYR_STACKS) {
            // A stack is a container, not a place, so it gets a line saying
            // what it holds and how to open it — never the facility card,
            // which would have to pick one of the permits to be about.
            const token = `stack:${hit.feature.properties.skey}`;
            if (this._hoverPid === token) return;
            this._hoverPid = token;
            const n = hit.feature.properties.stack;
            this._hoverPopup?.setMaxWidth('240px');
            this._hoverPopup
                ?.setLngLat(hit.feature.geometry.coordinates.slice())
                .setHTML('<div class="food-hover-card"><div class="food-hover-card-head">'
                    + `<strong>${n} places at this point</strong>`
                    + '<div class="food-tip-sub">click to fan them out</div>'
                    + '</div></div>')
                .addTo(map);
            return;
        }

        const f = this._byPermit.get(hit.feature.properties.pid);
        if (!f) return;
        // Same facility → leave the card alone. Re-rendering on every
        // mousemove is needless work while the pointer stays on its marker.
        if (this._hoverPid === f.permit_id) return;
        // Anchored to the MARKER, never to the pointer: the card points at the
        // thing it is about, which is the whole reason it has a tail.
        this._showHoverCard(hit.feature.geometry.coordinates.slice(), f);
    },

    /** Click: open a stack, select a place, or break a cluster apart. */
    _onMapClick(e) {
        const map = this._map;
        const hit = this._pickMarkAt(e.point);

        // Anything that is not this stack closes an open web — including empty
        // map, and including the open stack's own dimmed anchor, which is
        // filtered out of the stack layer while its web is up and so is never
        // a hit.
        if (this._spider && (!hit || hit.layerId !== LYR_STACKS)) this._dismissSpider();
        if (!hit) return;

        if (hit.layerId === LYR_STACKS) {
            this._hideHoverCard();
            this._expandStack(hit.feature.properties.skey);
            return;
        }

        if (hit.layerId === LYR_CLUSTERS) {
            this._hideHoverCard();   // the anchor marker is about to dissolve
            this._zoomToCluster(hit.feature);
            return;
        }

        const f = this._byPermit.get(hit.feature.properties.pid);
        if (f) {
            this._hideHoverCard();   // the panel takes over
            this._select(f);
        }
    },

    /** Cluster click → zoom to the level where it breaks apart
     *  (getClusterExpansionZoom is Promise-based in MapLibre). */
    async _zoomToCluster(feature) {
        const map = this._map;
        try {
            const zoom = await map.getSource(SRC)
                .getClusterExpansionZoom(feature.properties.cluster_id);
            map.easeTo({ center: feature.geometry.coordinates, zoom: zoom + 0.5 });
        } catch (_) { /* cluster dissolved mid-click */ }
    },

    // ── locate feedback ─────────────────────────────────────────────────

    /** Padded bounding box of the loaded facilities — "the mapped area". */
    _coverageBounds() {
        let n = -90, s = 90, e = -180, w = 180;
        for (const f of this._facilities) {
            const { lat, lon } = coordsOf(f);
            if (lat == null || lon == null) continue;
            n = Math.max(n, lat); s = Math.min(s, lat);
            e = Math.max(e, lon); w = Math.min(w, lon);
        }
        if (n < s) return null;   // nothing located yet
        const PAD = 0.2;          // ~20 km — near-edge users still see markers
        return { n: n + PAD, s: s - PAD, e: e + PAD, w: w - PAD };
    },

    /** Tell out-of-coverage visitors why the map around them is empty —
     *  and hand them a way back — instead of stranding them on a blank
     *  basemap. */
    _onGeolocate(pos) {
        const { latitude: lat, longitude: lon } = pos.coords;
        const b = this._coverageBounds();
        if (!b || (lat <= b.n && lat >= b.s && lon <= b.e && lon >= b.w)) {
            this._hideMapNote();
            return;
        }
        this._showMapNote(
            'This map only covers Virginia, and you\'re outside it.',
            true);
    },

    /** Small dismissible notice over the map. Static strings only — the
     *  markup goes through innerHTML. */
    _showMapNote(text, withReturnLink = false) {
        const wrap = document.getElementById('foodMapWrap');
        if (!wrap) return;
        if (this._mapNote?.dataset.note === text) return;   // already showing
        this._hideMapNote();
        const note = document.createElement('div');
        note.className = 'food-map-note';
        note.dataset.note = text;
        note.innerHTML = '<button type="button" class="btn-close" aria-label="Dismiss"></button>'
            + `<span>${text}</span>`
            + (withReturnLink ? '<button type="button" class="food-map-note-back">Back to Virginia</button>' : '');
        note.querySelector('.btn-close')
            .addEventListener('click', () => this._hideMapNote());
        note.querySelector('.food-map-note-back')?.addEventListener('click', () => {
            // A zoom-changing camera move (fitBounds included) does NOT drop
            // the control's follow lock (its movestart handler skips zooming
            // moves), so switch the control off first — otherwise the next
            // fix flies the camera right back out of coverage.
            if (this._geoFollowing) this._geolocate?.trigger();
            this._map?.fitBounds(VA_BOUNDS, VA_FIT);
            this._hideMapNote();
        });
        wrap.appendChild(note);
        this._mapNote = note;
    },

    _hideMapNote() {
        this._mapNote?.remove();
        this._mapNote = null;
    },

    /** Cluster tint.
     *
     *  Full tier: the mean grade of the live, scored places inside — the same
     *  number a stack bubble wears. This used to be a green/yellow/orange
     *  ramp keyed on member COUNT, which put "few places here" and "grade A"
     *  on the same hue one zoom apart, in a view where the dots underneath
     *  already spend green on grades. Size now says how many, colour says how
     *  good, and one hue means one thing on every mark the map draws.
     *
     *  Bands match gradeForScore. Division is guarded by the zero case above
     *  it — `case` only evaluates the branch it takes.
     *
     *  Lite keeps a neutral density ramp: it publishes no grades, so there is
     *  nothing to average and nothing for a count ramp to collide with. */
    _clusterColors() {
        if (this._mode === 'lite') {
            return ['step', ['get', 'sum'],
                '#9aa1a9', 10, '#8b929b', 50, '#7d848d'];
        }
        return ['case',
            ['==', ['get', 'gradeCount'], 0], GRADE_COLORS.none,
            ['step', ['/', ['get', 'gradeSum'], ['get', 'gradeCount']],
                GRADE_COLORS.F,
                60, GRADE_COLORS.D,
                70, GRADE_COLORS.C,
                80, GRADE_COLORS.B,
                90, GRADE_COLORS.A]];
    },

    _applyTheme() {
        if (!this._map || typeof maplibregl === 'undefined') return;
        const dark = this._isDark();
        if (this._styleIsDark === dark) return;
        // Close any open web first: its legs are DOM markers that would
        // outlive the style swap, and restoring the stack filter needs the
        // layers that are about to be torn down.
        this._dismissSpider();
        this._styleIsDark = dark;
        this._mapReady = false;   // source dies with the old style
        // style.load re-installs the data layers over the new basemap.
        this._map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT);
    },

    /** Patch a defect in the vendored dark-matter style, not ours: every
     *  road-name tier reads fine EXCEPT trunk/motorway (roadname_major),
     *  which ships #383838 text — 1.7:1 against the #0e0e0e background,
     *  effectively invisible. Positron carries none of this (every tier
     *  there is a flat, legible #838383), so it is isolated to one vendor
     *  layer on one theme, not a hierarchy this file is overriding on
     *  purpose. See DARK_MAJOR_ROAD_LABEL_COLOR for the contrast numbers.
     *
     *  Guarded on the layer existing: this is an unversioned, externally
     *  hosted style.json, and a vendor rename should silently no-op here
     *  rather than throw out of the style.load handler that also installs
     *  the facility data layers. Runs on every style.load, light included —
     *  cheap, and harmless when the layer's already correct. */
    _fixDarkRoadLabelContrast() {
        if (!this._styleIsDark) return;
        if (this._map.getLayer(DARK_MAJOR_ROAD_LABEL_LAYER)) {
            this._map.setPaintProperty(
                DARK_MAJOR_ROAD_LABEL_LAYER, 'text-color', DARK_MAJOR_ROAD_LABEL_COLOR);
        }
    },
};
