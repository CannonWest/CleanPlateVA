/**
 * Marker-bound hover card — the display-only popup a mouse gets over a
 * marker. Contract V4: the card renders INSTANTLY and COMPLETELY from the
 * roster row — the finder + overlay: name, address, grade circle / NEW /
 * no-grade dash, the "Last broad inspection · Last visit" date cards, and
 * the trend sparkline drawn from the overlay's `visits` column (CPH,
 * D-DATA-13). Nothing is fetched on hover: on Workers Free the metered unit
 * is the request, and a curious mouse must cost zero. The click panel still
 * fetches the facility detail (P5). `hoverMethods` is installed on
 * FoodDashboard.prototype by foodDashboard.js (`this` is the dashboard).
 */

import {
    approximateLabel, esc, gradePresentation, facilityPresentation, isActivePermit,
    isNewlyPermitted, latestDateOf, visitsOf,
} from './presentation.js';

// How much of the stack panel a hover card may sit on before the card is moved
// to the other side of its marker. Cannon's line, 2026-08-19: a card covering
// the WHOLE panel has to move; one clipping its edge is honestly fine. Area,
// not a rectangle test — an overlap that leaves the header and most rows
// readable is not worth making the card jump.
const PANEL_COVER_LIMIT = 0.6;

// Floors for the card's own box. Below these it is not a card any more, and a
// map that small is not really being read — better a card that overhangs a
// sliver than one squeezed to nothing.
const TIP_MIN_WIDTH = 220;
const TIP_MIN_HEIGHT = 96;

/** Correct a popup anchor so the card lands INSIDE the map.
 *
 *  `.food-map-wrap` clips its overflow, so a card that runs past the map's
 *  edge is not merely ugly — the part of it beyond the edge is cut off, and
 *  the edge that matters most is the one the detail panel or the stacked
 *  bottom bar has just moved inward. Measured with the panel open: a card near
 *  the right edge ran 66px past it and lost that strip. MapLibre flips at the
 *  left and top edges on its own but did not at the right.
 *
 *  Anchor names say where the POPUP'S OWN corner sits, so they read inverted:
 *  hanging off the right edge is fixed by anchoring `right`, which puts the
 *  card to the LEFT of its point. Returns null when nothing needs moving, so
 *  the common case re-renders nothing.
 */
export function fitAnchor(card, view, anchor = null) {
    const parts = new Set(String(anchor || '').split('-').filter(Boolean));
    let moved = false;
    if (card.right > view.right) { parts.delete('left'); parts.add('right'); moved = true; }
    else if (card.left < view.left) { parts.delete('right'); parts.add('left'); moved = true; }
    if (card.bottom > view.bottom) { parts.delete('top'); parts.add('bottom'); moved = true; }
    else if (card.top < view.top) { parts.delete('bottom'); parts.add('top'); moved = true; }
    if (!moved) return null;
    // MapLibre wants the vertical component first.
    const vertical = parts.has('top') ? 'top' : (parts.has('bottom') ? 'bottom' : '');
    const horizontal = parts.has('left') ? 'left' : (parts.has('right') ? 'right' : '');
    return [vertical, horizontal].filter(Boolean).join('-') || null;
}

export const hoverMethods = {
    // ── marker-bound hover card ────────────────────────────────────────
    _hideHoverCard() {
        this._hoverPid = null;
        this._hoverPopup?.remove();
        this._yieldStackPanel(false);
    },

    /** The popup to use, built with the anchor this moment needs.
     *
     *  MapLibre opens a popup UPWARD by default, and the stack panel stands
     *  above the web — so a leg's card and the panel compete for the same
     *  strip of screen and the panel would yield on nearly every hover. That
     *  is worse than it sounds: the row the leg lights up lives IN the panel,
     *  so yielding hides the very highlight the hover just produced. Anchoring
     *  a leg's card to 'top' hangs it BELOW the leg instead, where the panel
     *  is not, and the two coexist the way they should. Recreated rather than
     *  mutated because `anchor` is a construction option. */
    _hoverPopupFor(anchor) {
        if (this._hoverPopup && this._hoverPopupAnchor === anchor) return this._hoverPopup;
        if (typeof maplibregl === 'undefined') return this._hoverPopup;
        this._hoverPopup?.remove();
        this._hoverPopup = new maplibregl.Popup({
            closeButton: false, closeOnClick: false,
            offset: 12, maxWidth: '280px', className: 'food-tip',
            ...(anchor ? { anchor } : {}),
        });
        this._hoverPopupAnchor = anchor;
        return this._hoverPopup;
    },

    _showHoverCard(lngLat, f, { below = false } = {}) {
        if (!this._hoverPopupFor(below ? 'top' : null)) return;
        this._hoverPid = f.permit_id;
        const lite = this._mode === 'lite';
        const html = this._hoverCardHTML(f);
        const view = this._mapViewBox();
        const place = (anchor) => {
            const popup = this._hoverPopupFor(anchor);
            // Lite keeps the slim name+address tip; the hero card needs room —
            // but neither may be WIDER THAN THE MAP. `.food-map-wrap` clips its
            // overflow, so a card bigger than its container is not re-anchored
            // out of trouble, it is sliced. The splitter made that reachable:
            // drag the panel to 70% and a 1280px window leaves a 349px map
            // against a 380px hero, which lost 217px off its right edge.
            const room = Math.round(view.right - view.left);
            popup.setMaxWidth(`${Math.max(TIP_MIN_WIDTH, Math.min(lite ? 280 : 380, room))}px`);
            popup.setLngLat(lngLat).setHTML(html).addTo(this._map);
            // The same argument on the other axis, which the stacked splitter
            // reaches sooner: drag the bottom bar up and a 193px map faces the
            // same 263px card, overflowing 179px INTO the panel. Capped here
            // rather than in the stylesheet because only this knows the map's
            // current height. A card with no room left is abbreviated, which
            // is at least a clean edge inside the map instead of a slice.
            popup.getElement().style.setProperty(
                '--cp-tip-max-h', `${Math.max(TIP_MIN_HEIGHT, Math.round(view.bottom - view.top))}px`);
        };
        let anchor = below ? 'top' : null;
        place(anchor);
        // Any card that would bury the stack panel moves to the other side of
        // its own marker — not just the legs inside the web (Cannon,
        // 2026-08-19). Measured after placing rather than predicted: a card is
        // a slim tip in Lite and a hero with a sparkline in Full, so its
        // height is not knowable up front. Both placements happen in one task,
        // so nothing is painted in between and the move is invisible.
        if (this._stackPanel && !below && this._panelCoveredBy() > PANEL_COVER_LIMIT) {
            anchor = 'top';
            place(anchor);
        }
        // ...and whatever it settled on, keep the card inside the map, because
        // the wrap clips what hangs over the edge. Last, so it corrects the
        // final placement rather than one the rule above may replace. One
        // pass: the corrected anchor moves the card AWAY from the edge it
        // overshot, so a second could only chase it back.
        const fixed = fitAnchor(
            this._hoverPopup.getElement().getBoundingClientRect(),
            this._mapViewBox(), anchor);
        if (fixed) place(fixed);
        // Only if moving it did not help does the panel step aside.
        this._yieldStackPanel(this._panelCoveredBy() > PANEL_COVER_LIMIT);
    },

    /** The box a card has to stay inside: the map itself, whose wrapper clips
     *  overflow. Inset slightly so a card does not sit flush against the edge
     *  it was just moved off. */
    _mapViewBox() {
        const el = document.getElementById('foodMap');
        if (!el) return { left: 0, top: 0, right: Infinity, bottom: Infinity };
        const r = el.getBoundingClientRect();
        const inset = 4;
        return {
            left: r.left + inset, top: r.top + inset,
            right: r.right - inset, bottom: r.bottom - inset,
        };
    },

    /** How much of the stack panel the open card sits on, 0–1 of its area.
     *
     *  A fraction rather than a yes/no because clipping a corner is fine and
     *  burying the thing is not: a card that leaves most of the panel readable
     *  can stay where it is, which keeps cards from hopping around every time
     *  they brush an edge. */
    _panelCoveredBy() {
        const panel = this._stackPanel?.el;
        const card = this._hoverPopup?.getElement();
        if (!panel || !card) return 0;
        const a = panel.getBoundingClientRect();
        const b = card.getBoundingClientRect();
        if (!a.width || !a.height || !b.width) return 0;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w <= 0 || h <= 0) return 0;
        return (w * h) / (a.width * a.height);
    },

    /** The active hover wins (Cannon, 2026-08-19): the panel is a standing
     *  reference, the card is what the pointer is asking about right now. It
     *  comes back the moment the pointer leaves. */
    _yieldStackPanel(yielding) {
        this._stackPanel?.el?.classList.toggle('is-yielded', !!yielding);
    },

    // The hover card previews the detail panel's grade hero: name + address,
    // then the same circle / NEW badge / no-grade dash, the static sparkline,
    // and the date cards. No flat "Grade A · 94" text — the circle is the
    // verdict, and a focused raw score prints nowhere (the #42/#43 invariant
    // carries over by construction: the shared sparkline plots ratios, not
    // raw scores). Controls are deliberately omitted here; those belong to
    // the clicked detail panel.
    _hoverCardHTML(f) {
        // Both tiers qualify an approximate pin. Until 2026-08-19 only Lite
        // did, so the tier carrying MORE information gave LESS warning: a
        // Full-tier hover over a DCA concession showed a Crystal City rooftop
        // with no hint, and you had to click into the panel to learn it was a
        // centroid.
        const approx = approximateLabel(f);
        const approxLine = approx
            ? `<br><span class="food-tip-sub">≈ ${esc(approx)}</span>` : '';
        if (this._mode === 'lite') {
            return `<strong>${esc(f.name)}</strong><br>`
                + `${esc(f.address || '')}${f.city ? ', ' + esc(f.city) : ''}`
                + approxLine;
        }
        const grade = gradePresentation(f);
        const latestView = facilityPresentation(f).latest;
        const isNew = isNewlyPermitted(f);
        const active = isActivePermit(f);
        // The sparkline plots the row's `visits` — one entry per inspection,
        // the marks the detail would yield — through the exact `_sparkSvg`
        // pipeline the panel uses: one renderer, two sources, no fetch. A
        // facility with no history has no plot; a newly permitted one has
        // nothing to trend.
        const series = visitsOf(f);
        const sparkHtml = (series.events.length && !isNew) ? this._sparklineFromSeries(series) : '';
        const hero = grade
            ? this._gradeHero(grade, sparkHtml, false)
            : isNew
                ? this._newHero(latestView)
                : this._noGradeHero(latestView, sparkHtml);
        const latestDate = latestDateOf(f);
        const heroBlock = (grade || isNew || series.events.length || latestDate)
            ? `${hero}${this._gradeDates(grade?.baseDate || null, latestDate)}`
            : '<div class="text-muted small mb-2">No inspections on record yet.</div>';
        return `
            <div class="food-hover-card">
                <div class="food-hover-card-head">
                    <strong>${esc(f.name)}</strong>
                    ${active ? '' : `<span class="food-tip-closed">${esc(f.status || 'closed')}</span>`}
                    <div class="food-tip-sub">${esc(f.address || '')}${f.address2 ? ' ' + esc(f.address2) : ''}${f.city ? ', ' + esc(f.city) : ''}${approxLine}</div>
                </div>
                ${heroBlock}
            </div>`;
    },
};
