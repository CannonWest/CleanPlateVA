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
        const popup = this._hoverPopupFor(below ? 'top' : null);
        if (!popup) return;
        this._hoverPid = f.permit_id;
        const lite = this._mode === 'lite';
        // Lite keeps the slim name+address tip; the hero card needs the room.
        popup.setMaxWidth(lite ? '280px' : '380px');
        popup.setLngLat(lngLat).setHTML(this._hoverCardHTML(f)).addTo(this._map);
        this._yieldStackPanel(this._hoverCardCollides());
    },

    /** Does the open card land on top of the stack panel? Both are placed to
     *  avoid it — the panel sits clear of the web's outer reach, and the card
     *  hangs off a leg inside it — but a tall card on a short map runs out of
     *  room, and then something has to give. */
    _hoverCardCollides() {
        const panel = this._stackPanel?.el;
        const card = this._hoverPopup?.getElement();
        if (!panel || !card) return false;
        const a = panel.getBoundingClientRect();
        const b = card.getBoundingClientRect();
        if (!a.width || !b.width) return false;
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
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
