/**
 * Same-coordinate stacks — the geometry (exact 6dp key, ring radii, spider
 * seat offsets) and the interaction that fans a stack out into DOM legs.
 * The pure helpers are module-level exports; the `stackMethods` bundle is
 * installed on FoodDashboard.prototype by foodDashboard.js (`this` is the
 * dashboard).
 */

import {
    CLOSED_COLOR, GRADE_COLORS, LITE_MARKER_COLOR, LYR_STACKS, LYR_STACK_COUNT, LYR_STACK_RING,
    NEW_COLOR,
} from './constants.js';

// ── same-coordinate stacks ─────────────────────────────────────────────
//
// VDH hands many permits one point: a food court, a campus dining hall, a
// strip mall sharing a parcel centroid, a re-permitted sibling the merge
// rules deliberately keep separate. Those markers sit exactly on top of each
// other at EVERY zoom — proximity clustering never resolves them, because
// they never separate — and only the topmost is hoverable or clickable.
// Measured against the 2026-08 Lite roster, default public view: 1,421 stacks
// holding 4,480 of 22,357 markers, of which 3,059 could not be reached at all.
//
// Grouping is exact at 6dp (~0.11m), the same key the CannonAI refinement
// editor spiderfies on. A metre-scale tolerance was measured and rejected: it
// adds 62 pairs statewide and turns a stable key into transitive clustering,
// which is the order-dependence trap cannon-food's merge arc already fought
// and lost once (MERGE-M2). A genuine 1m-apart duplicate is a data bug for
// the location layer, not a rendering tolerance.
const STACK_DP = 6;
export const STACK_RADII = [11, 13, 15];   // core radius by member count: <10, <50, 50+
export const STACK_RING_GAP = 4;           // halo sits this far outside the core

// Zoom floor when a stack opens. The web is drawn in SCREEN space, so zoom
// does not make it bigger — this is about clearing the ground underneath it.
// CARTO's 512px tiles run ~1 zoom tighter than usual, so at 37.5°N z17 is
// about 0.47 m/px: a neighbour 30m away lands ~63px out, clear of even the
// 92px outer ring of the largest stack in the state. At z15 that neighbour
// would sit 16px away, tangled in the ring. Never zooms OUT.
const STACK_OPEN_ZOOM = 17;

// Above this zoom points stand alone and stacks are drawn; at or below it
// proximity clustering swallows them. ONE constant because two consumers must
// agree exactly: the source clusters on it, and an open web is dismissed when
// the camera crosses back over it. Set them apart and you get either legs
// hanging over a clustered map or a web that vanishes while its bubble is
// still on screen.
export const CLUSTER_MAX_ZOOM = 12;

// Dashed halos are pre-drawn images because MapLibre circle layers have no
// dash property. The refinement editor gets `border: 2px dashed` free from
// CSS since every dot there is a real DOM element; that is not an option
// across 19k markers, so the ring becomes one small icon per (colour, size).
export const STACK_RING_COLORS = {
    A: GRADE_COLORS.A, B: GRADE_COLORS.B, C: GRADE_COLORS.C,
    D: GRADE_COLORS.D, F: GRADE_COLORS.F, none: GRADE_COLORS.none,
    closed: CLOSED_COLOR, new: NEW_COLOR, lite: LITE_MARKER_COLOR,
};

// A cluster feature has point_count and no `stack`; every source feature has
// `stack` (1 when it is the only place at its point). Never mutate these —
// _setStackFilter spreads them into a narrowed copy.
export const LONE_PLACE_FILTER = ['all', ['!', ['has', 'point_count']], ['==', ['get', 'stack'], 1]];
export const STACK_FILTER = ['all', ['!', ['has', 'point_count']], ['>', ['get', 'stack'], 1]];

/** Exact coordinate identity. Longitude first, matching the editor's key. */
export function stackKey(lat, lon) {
    return `${Number(lon).toFixed(STACK_DP)}|${Number(lat).toFixed(STACK_DP)}`;
}

export function stackRadius(count) {
    if (count >= 50) return STACK_RADII[2];
    return count >= 10 ? STACK_RADII[1] : STACK_RADII[0];
}

export function stackRingIcon(ringKey, count) {
    return `stack-ring-${ringKey}-${stackRadius(count)}`;
}

/** Screen-space ring offsets for a spiderfied stack.
 *
 *  Ring count is the smallest whose cumulative seating covers `count`; seats
 *  are then distributed across those rings in proportion to capacity, by
 *  largest remainder so they sum exactly. Filling each ring to capacity
 *  instead — the refinement editor's original shape — strands the remainder
 *  alone in the outermost ring: Dulles's 57 permits seat 9/16/24 and fling
 *  the last 8 out to r=92 reading as strays rather than as a ring.
 *
 *  `spacing` is centre-to-centre arc length, so it has to clear the dot
 *  DIAMETER. Markers are 7px radius under a mouse and 10px on a coarse
 *  pointer, which is why the editor's 16px would overlap on a phone.
 */
export function spiderOffsets(count, { spacing = 18, first = 26, step = 22 } = {}) {
    if (count <= 1) return [[0, 0]];
    const seatsAt = (ring) => Math.max(
        6, Math.floor((2 * Math.PI * (first + step * ring)) / spacing));
    const caps = [];
    for (let total = 0; total < count; total += caps[caps.length - 1]) {
        caps.push(seatsAt(caps.length));
    }
    const capSum = caps.reduce((a, b) => a + b, 0);
    const exact = caps.map((c) => (count * c) / capSum);
    const seats = exact.map((v) => Math.floor(v));
    let spare = count - seats.reduce((a, b) => a + b, 0);
    exact
        .map((v, i) => [v - seats[i], i])
        .sort((a, b) => b[0] - a[0])
        .forEach(([, i]) => { if (spare > 0) { seats[i] += 1; spare -= 1; } });
    const offsets = [];
    seats.forEach((n, ring) => {
        const radius = first + step * ring;
        // Half-seat twist on alternate rings so dots don't line up into
        // spokes, which reads as a pattern rather than a set of places.
        const twist = ring % 2 ? Math.PI / n : 0;
        for (let i = 0; i < n; i += 1) {
            const angle = ((2 * Math.PI * i) / n) - (Math.PI / 2) + twist;
            offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
        }
    });
    return offsets;
}

export const stackMethods = {
    // ── spiderfied stacks ───────────────────────────────────────────────

    /** Fan a same-coordinate stack out into the places inside it.
     *
     *  The legs are DOM markers rather than canvas features because
     *  MapLibre's Marker offset is a SCREEN-space vector — exactly what a
     *  ring around one coordinate needs, surviving zoom and pan with no
     *  recompute. That is affordable here and only here: one web is open at a
     *  time, while the 19k-feature base map stays on the canvas. Building the
     *  whole map from DOM markers, the way the refinement editor can afford
     *  to over a single batch, is what this design is avoiding.
     *
     *  The stack's own bubble is filtered out while its web is open and
     *  replaced by a dimmed anchor, so the ring visibly belongs to the point
     *  it came from.
     */
    _expandStack(key) {
        const group = this._stacks?.get(key);
        if (!group || group.members.length < 2) return;
        this._dismissSpider();
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const lngLat = [group.lon, group.lat];
        const offsets = spiderOffsets(group.members.length,
            { spacing: coarse ? 24 : 18 });
        // Tethers first, so the anchor and the legs paint over their ends:
        // marker elements stack in creation order.
        const markers = [new maplibregl.Marker({ element: this._spiderWeb(offsets) })
            .setLngLat(lngLat).addTo(this._map)];
        const anchor = document.createElement('div');
        anchor.className = 'food-spider-anchor';
        markers.push(new maplibregl.Marker({ element: anchor })
            .setLngLat(lngLat).addTo(this._map));

        group.members.forEach((f, i) => {
            const paint = this._markerPaint(f);
            const el = document.createElement('div');
            el.className = 'food-spider-leg';
            el.style.setProperty('--leg-fill', paint.fill);
            el.style.setProperty('--leg-stroke', paint.stroke);
            el.style.setProperty('--leg-stroke-width', `${paint.strokeW}px`);
            el.style.opacity = String(paint.fillOpacity);
            el.title = f.name || '';
            el.addEventListener('click', (ev) => {
                // Markers are DOM siblings of the canvas, so this would
                // otherwise also read as a click on empty map and close the
                // web out from under the selection.
                ev.stopPropagation();
                this._hideHoverCard();
                this._select(f);
            });
            if (!coarse) {
                el.addEventListener('mouseenter', () => {
                    // The leg is drawn at a pixel offset from the shared
                    // point, so the card has to anchor at that offset
                    // unprojected against the current camera — otherwise
                    // every card in the ring points at the middle.
                    const p = this._map.project(lngLat);
                    this._showHoverCard(this._map.unproject(
                        [p.x + offsets[i][0], p.y + offsets[i][1]]), f);
                });
                el.addEventListener('mouseleave', () => this._hideHoverCard());
            }
            markers.push(new maplibregl.Marker({ element: el, offset: offsets[i] })
                .setLngLat(lngLat).addTo(this._map));
        });

        this._spider = { key, markers };
        this._setStackFilter(key);
        this._map.on('movestart', this._onSpiderMove);
        // `zoom`, not `zoomend` — the web should go as the camera crosses the
        // line, not once the gesture finishes. Safe against the easeTo below,
        // which only ever raises zoom.
        this._map.on('zoom', this._onSpiderZoom);
        // Centre the web and give it clear ground. Zoom never decreases: a
        // stack opened while already close in should not be pushed back out.
        this._map.easeTo({
            center: lngLat,
            zoom: Math.max(this._map.getZoom(), STACK_OPEN_ZOOM),
            duration: 550,
        });
    },

    /** The dashed tethers, as ONE marker rather than a line layer.
     *
     *  Legs are placed at screen-space offsets, so their geographic positions
     *  change with every zoom — a GeoJSON line layer would have to rebuild
     *  its geometry on each camera frame. An SVG centred on the shared point
     *  carries the whole web in local coordinates that never change, and
     *  MapLibre moves it exactly the way it moves the legs. */
    _spiderWeb(offsets) {
        const NS = 'http://www.w3.org/2000/svg';
        const reach = offsets.reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
        const span = Math.ceil(reach + 12) * 2;
        const mid = span / 2;
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', span);
        svg.setAttribute('height', span);
        svg.setAttribute('viewBox', `0 0 ${span} ${span}`);
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('food-spider-web');
        for (const [dx, dy] of offsets) {
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', mid);
            line.setAttribute('y1', mid);
            line.setAttribute('x2', mid + dx);
            line.setAttribute('y2', mid + dy);
            svg.appendChild(line);
        }
        return svg;
    },

    _dismissSpider() {
        if (!this._spider) return;
        this._map?.off('movestart', this._onSpiderMove);
        this._map?.off('zoom', this._onSpiderZoom);
        this._spider.markers.forEach((m) => m.remove());
        this._spider = null;
        this._hideHoverCard();
        this._setStackFilter(null);
    },

    /** Hide one stack's bubble while its web is open, or restore them all. */
    _setStackFilter(hiddenKey) {
        if (!this._map || !this._mapReady) return;
        const filter = hiddenKey
            ? [...STACK_FILTER, ['!=', ['get', 'skey'], hiddenKey]]
            : STACK_FILTER;
        for (const id of [LYR_STACK_RING, LYR_STACKS, LYR_STACK_COUNT]) {
            if (this._map.getLayer(id)) this._map.setFilter(id, filter);
        }
    },
};
