/**
 * Marker paint — one facility's fill / opacity / stroke, the mean-grade
 * inputs a point carries for cluster tinting, a stack's summary look, the
 * filtered roster → GeoJSON (one feature per distinct point), and the
 * rebuild that pushes it to the map. `markerMethods` is installed on
 * FoodDashboard.prototype by foodDashboard.js (`this` is the dashboard).
 */

import {
    CLOSED_COLOR, CLUSTER_RADII, CLUSTER_STEPS, GRADE_COLORS, HIT_SLOP_COARSE, HIT_SLOP_FINE,
    LITE_MARKER_COLOR, LYR_CLUSTERS, LYR_POINTS, LYR_STACKS, NEW_COLOR, POINT_RADIUS_COARSE,
    POINT_RADIUS_FINE, SRC,
} from './constants.js';
import { stackKey, stackRadius, stackRingIcon } from './stacks.js';
import { coordsOf, facilityPresentation, gradeColor, gradeForScore } from './presentation.js';

// ── hit testing ─────────────────────────────────────────────────────────
//
// You should not have to land on a 7px dot exactly. Pointer events are
// therefore resolved against a padded box rather than the mark itself, and
// something has to decide who wins when several marks are in reach.
//
// The rule keeps precise pointing EXACTLY as it was. If the pointer is
// genuinely inside a mark, the answer is the one the map paints on top —
// stacks over lone dots over clusters — which is what MapLibre's own
// layer-scoped events did. Slop only ever ADDS reach; it never changes who
// wins when you were already on target.
//
// Outside every mark, nearest wins by the gap to the mark's EDGE, not by the
// distance to its centre. A mark's centre is not where anyone is pointing —
// its rim is what they see. Measured from centres, a cursor 6px off a big
// cluster's rim answers with a small dot 8px off its own, purely because the
// dot's middle is nearer than the cluster's; the edge gap answers with the
// thing the cursor is nearly touching. So this favours the BIG mark you are
// beside, which is the right way round.

export const MARK_RANK = { [LYR_STACKS]: 3, [LYR_POINTS]: 2, [LYR_CLUSTERS]: 1 };

export function pointRadius(coarse) {
    return coarse ? POINT_RADIUS_COARSE : POINT_RADIUS_FINE;
}

export function hitSlop(coarse) {
    return coarse ? HIT_SLOP_COARSE : HIT_SLOP_FINE;
}

/** Cluster bubble radius for a place count — the JS twin of the layer's
 *  `step` expression, which is built from the same constants. */
export function clusterRadius(sum) {
    const n = Number(sum) || 0;
    if (n >= CLUSTER_STEPS[1]) return CLUSTER_RADII[2];
    return n >= CLUSTER_STEPS[0] ? CLUSTER_RADII[1] : CLUSTER_RADII[0];
}

/** What a rendered feature's radius is, by the layer it came from. */
export function markRadius(layerId, properties = {}, coarse = false) {
    if (layerId === LYR_CLUSTERS) return clusterRadius(properties.sum);
    if (layerId === LYR_STACKS) return stackRadius(Number(properties.stack) || 1);
    return pointRadius(coarse);
}

/** Choose the mark a pointer meant, from candidates already measured against
 *  it. Each candidate is `{ layerId, dx, dy, radius }` in screen pixels plus
 *  whatever the caller wants carried through. Returns the winner annotated
 *  with `gap` and `inside`, or null when nothing is within `slop`. */
export function pickMark(candidates, slop) {
    let best = null;
    for (const candidate of candidates) {
        const gap = Math.hypot(candidate.dx, candidate.dy) - candidate.radius;
        if (gap > slop) continue;                       // out of reach entirely
        const inside = gap <= 0;
        const rank = MARK_RANK[candidate.layerId] ?? 0;
        const next = { ...candidate, gap, inside, rank };
        if (!best) { best = next; continue; }
        // Being ON a mark always beats being merely near one.
        if (inside !== best.inside) { if (inside) best = next; continue; }
        if (inside) {
            // Both under the pointer: what is painted on top wins, exactly as
            // before slop existed. Centre-most breaks a tie within one layer.
            if (rank > best.rank || (rank === best.rank && gap < best.gap)) best = next;
        } else if (gap < best.gap || (gap === best.gap && rank > best.rank)) {
            // Neither is under the pointer: nearest edge wins, and only a true
            // tie falls back to the layer order.
            best = next;
        }
    }
    return best;
}

export const markerMethods = {
    // Marker fill = the facility grade color. (`gradeColor` is the data palette.)
    _markerColor(f) {
        return gradeColor(facilityPresentation(f).grade?.letter || null);
    },

    /** Paint channels for ONE facility's dot. Shared by the canvas point
     *  layer and by the DOM legs of an expanded stack, so a spiderfied
     *  marker can never drift from the same facility's plain marker. */
    _markerPaint(f) {
        const lite = this._mode === 'lite';
        // Closed permits (shown only when "Show closed" is on) plot greyed
        // + dimmed so they read as not-currently-open at a glance.
        const active = lite || this._isActive(f);
        const declining = !lite && facilityPresentation(f).declining;
        return {
            // Lite is the finder view: every marker a uniform neutral — the
            // map locates places, it doesn't judge them. Full tier: graded →
            // grade color, newly-permitted → blue, closed → gray.
            fill: lite ? LITE_MARKER_COLOR
                : !active ? CLOSED_COLOR
                    : this._isNew(f) ? NEW_COLOR : this._markerColor(f),
            fillOpacity: active ? 0.88 : 0.42,
            // declining facilities get a heavier warning ring on any color-mode.
            stroke: !active ? 'rgba(130, 130, 130, 0.55)'
                : declining ? GRADE_COLORS.F : 'rgba(20, 20, 20, 0.55)',
            strokeW: declining ? 2.5 : 1.5,
        };
    },

    /** Mean-grade inputs for one point: the live, scored places standing on it.
     *
     *  Emitted per feature as raw SUM and COUNT rather than a mean, because
     *  proximity clusters aggregate these through clusterProperties — adding
     *  sums and counts gives a cluster the mean over its PLACES, where
     *  averaging per-point means would weight a lone diner equally against a
     *  57-permit food court. Closed permits are excluded for the same reason
     *  they plot grey alone: a shuttered restaurant's last grade is not a
     *  fact about the address today. */
    _gradeAggregate(members) {
        // Lite publishes no grades at all, so there is nothing to average.
        const live = this._mode === 'lite'
            ? [] : members.filter((m) => this._isActive(m));
        const scores = live
            .map((m) => facilityPresentation(m).grade?.score)
            .filter((s) => Number.isFinite(s));
        return {
            live,
            gradeSum: scores.reduce((a, b) => a + b, 0),
            gradeCount: scores.length,
        };
    },

    /** A stack's summary look: the mean grade of the places inside it.
     *
     *  A stack has no grade of its own, so it borrows the average — and the
     *  moment it opens, every leg carries its own. An all-closed stack reads
     *  closed; an ungraded one reads unscored, or new when every live permit
     *  inside it is newly permitted. Proximity clusters wear the same mean
     *  (see _clusterColors), so one hue means one thing on every mark. */
    _stackAppearance(members) {
        const base = { stroke: 'rgba(20, 20, 20, 0.55)', strokeW: 1.5 };
        if (this._mode === 'lite') {
            return { ...base, fill: LITE_MARKER_COLOR, fillOpacity: 0.88, ringKey: 'lite' };
        }
        const { live, gradeSum, gradeCount } = this._gradeAggregate(members);
        if (!live.length) {
            return {
                ...base,
                fill: CLOSED_COLOR,
                fillOpacity: 0.42,
                stroke: 'rgba(130, 130, 130, 0.55)',
                ringKey: 'closed',
            };
        }
        if (!gradeCount) {
            const isNew = live.every((m) => this._isNew(m));
            return {
                ...base,
                fill: isNew ? NEW_COLOR : GRADE_COLORS.none,
                fillOpacity: 0.88,
                ringKey: isNew ? 'new' : 'none',
            };
        }
        const letter = gradeForScore(gradeSum / gradeCount);
        return { ...base, fill: GRADE_COLORS[letter], fillOpacity: 0.88, ringKey: letter };
    },

    /** Filtered facilities → one feature per DISTINCT POINT.
     *
     *  Facilities sharing a coordinate collapse into a single stack feature
     *  carrying its member count; the members themselves stay in `_stacks`
     *  under the same key, which is what the spiderfy reads. Keeping the
     *  member list off the feature avoids depending on how
     *  queryRenderedFeatures round-trips array-valued properties. */
    _toGeoJSON(filtered) {
        const groups = new Map();
        for (const f of filtered) {
            const { lat, lon } = coordsOf(f);
            if (lat == null || lon == null) continue;
            const key = stackKey(lat, lon);
            const group = groups.get(key);
            if (group) group.members.push(f);
            else groups.set(key, { key, lat, lon, members: [f] });
        }
        this._stacks = groups;
        const features = [];
        for (const { key, lat, lon, members } of groups.values()) {
            const stack = members.length;
            const paint = stack === 1
                ? this._markerPaint(members[0])
                : this._stackAppearance(members);
            const { gradeSum, gradeCount } = this._gradeAggregate(members);
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: {
                    pid: members[0].permit_id,
                    skey: key,
                    stack,
                    // Cluster-colour inputs. Every feature carries them for
                    // the same reason it carries `stack`: the accumulators
                    // must never meet a null.
                    gradeSum,
                    gradeCount,
                    fill: paint.fill,
                    fillOpacity: paint.fillOpacity,
                    stroke: paint.stroke,
                    strokeW: paint.strokeW,
                    ring: stack > 1 ? stackRingIcon(paint.ringKey, stack) : '',
                },
            });
        }
        return { type: 'FeatureCollection', features };
    },

    _rebuildMarkers() {
        if (this._viewMode === 'list') { this._rebuildList(); return; }
        if (!this._map) return;
        // A filter flip can remove the very marker the open card anchors to;
        // don't leave the card floating over nothing. The same flip can
        // dissolve or re-count the stack an open web belongs to, and its legs
        // are DOM markers that setData knows nothing about — so the web is
        // torn down here and re-seated below against the NEW membership
        // (Cannon, 2026-08-19: a filter change should update the open stack,
        // not close it out from under the visitor).
        const open = this._spider
            ? { key: this._spider.key, page: this._stackPanel?.page || 1 }
            : null;
        this._hideHoverCard();
        this._dismissSpider();

        const filtered = this._facilities.filter((f) => this._matchesFilters(f));
        this._geojson = this._toGeoJSON(filtered);
        // If a style swap is mid-flight the source is briefly absent —
        // style.load re-installs it with this._geojson as its data.
        if (this._mapReady) this._map.getSource(SRC)?.setData(this._geojson);
        this._updateCounts(filtered.length);
        // Re-seat the web on what survived. `_expandStack` declines a stack
        // that is gone or down to one member, which is exactly the wanted
        // behaviour: the last place standing is a lone dot, not a ring of one.
        // No recentre — the visitor moved a switch, not the camera.
        if (open) this._expandStack(open.key, { recenter: false, page: open.page });
    },
};
