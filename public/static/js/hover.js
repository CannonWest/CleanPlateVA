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
    esc, gradePresentation, facilityPresentation, isActivePermit, isNewlyPermitted,
    latestDateOf, locationClass, visitsOf, LOCATION_CLASS,
} from './presentation.js';

// How much of the stack panel a hover card may sit on before the card is moved
// to the other side of its marker. Cannon's line, 2026-08-19: a card covering
// the WHOLE panel has to move; one clipping its edge is honestly fine. Area,
// not a rectangle test — an overlap that leaves the header and most rows
// readable is not worth making the card jump.
const PANEL_COVER_LIMIT = 0.6;

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
        const place = (anchor) => {
            const popup = this._hoverPopupFor(anchor);
            // Lite keeps the slim name+address tip; the hero card needs room.
            popup.setMaxWidth(lite ? '280px' : '380px');
            popup.setLngLat(lngLat).setHTML(html).addTo(this._map);
        };
        place(below ? 'top' : null);
        // Any card that would bury the stack panel moves to the other side of
        // its own marker — not just the legs inside the web (Cannon,
        // 2026-08-19). Measured after placing rather than predicted: a card is
        // a slim tip in Lite and a hero with a sparkline in Full, so its
        // height is not knowable up front. Both placements happen in one task,
        // so nothing is painted in between and the move is invisible.
        if (this._stackPanel && !below && this._panelCoveredBy() > PANEL_COVER_LIMIT) {
            place('top');
        }
        // Only if moving it did not help does the panel step aside.
        this._yieldStackPanel(this._panelCoveredBy() > PANEL_COVER_LIMIT);
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
        if (this._mode === 'lite') {
            return `<strong>${esc(f.name)}</strong><br>`
                + `${esc(f.address || '')}${f.city ? ', ' + esc(f.city) : ''}`
                + (locationClass(f) === LOCATION_CLASS.zip_centroid
                    ? '<br><span class="food-tip-sub">≈ approximate location</span>' : '');
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
                    <div class="food-tip-sub">${esc(f.address || '')}${f.address2 ? ' ' + esc(f.address2) : ''}${f.city ? ', ' + esc(f.city) : ''}</div>
                </div>
                ${heroBlock}
            </div>`;
    },
};
