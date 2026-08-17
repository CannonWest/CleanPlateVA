/**
 * Marker-bound hover card — the display-only popup a mouse gets over a
 * marker. Contract V4: the card renders INSTANTLY from the roster row (the
 * finder + overlay: name, address, grade circle / NEW / no-grade dash, the
 * "Last broad inspection · Last visit" date cards) and is then ENRICHED with
 * the trend sparkline once the facility detail arrives — fetched immediately
 * on hover through the same LRU cache the click panel reads (D-DATA-10,
 * Cannon 2026-08-16: fetch on hover, no dwell). `hoverMethods` is installed
 * on FoodDashboard.prototype by foodDashboard.js (`this` is the dashboard).
 */

import {
    esc, gradePresentation, facilityPresentation, isActivePermit, isNewlyPermitted,
    latestDateOf, locationClass, LOCATION_CLASS,
} from './presentation.js';

export const hoverMethods = {
    // ── marker-bound hover card ────────────────────────────────────────
    _hideHoverCard() {
        this._hoverPid = null;
        this._hoverPopup?.remove();
    },

    _showHoverCard(lngLat, f) {
        const popup = this._hoverPopup;
        if (!popup) return;
        this._hoverPid = f.permit_id;
        const lite = this._mode === 'lite';
        // Lite keeps the slim name+address tip; the hero card needs the room.
        popup.setMaxWidth(lite ? '280px' : '380px');
        popup.setLngLat(lngLat).setHTML(this._hoverCardHTML(f)).addTo(this._map);
        if (lite || typeof this.api?.prefetchDetail !== 'function') return;
        // Enrich: the detail (p50 ~3 KB on the wire) brings the inspection
        // history the sparkline plots. If the pointer has moved on by the
        // time it lands, the fetch still warmed the cache for the click.
        const pid = f.permit_id;
        this.api.prefetchDetail(pid).then((detail) => {
            if (this._hoverPid !== pid || !detail?.available) return;
            if (!Array.isArray(detail.inspections) || !detail.inspections.length) return;
            popup.setHTML(this._hoverCardHTML(f, detail));
        });
    },

    // The hover card previews the detail panel's grade hero: name + address,
    // then the same circle / NEW badge / no-grade dash, the static sparkline
    // (once the detail is in), and the date cards. No flat "Grade A · 94"
    // text — the circle is the verdict, and a focused raw score prints
    // nowhere (the #42/#43 invariant carries over by construction: the
    // shared sparkline plots ratios, not raw scores). Controls are
    // deliberately omitted here; those belong to the clicked detail panel.
    _hoverCardHTML(f, detail = null) {
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
        // The sparkline plots the detail's real inspection history through the
        // exact `_sparkline`/`buildScopeSeries` pipeline the panel uses — one
        // renderer, one data source. Before the detail lands (or for a
        // facility with no history) the hero is circle + dates, no plot.
        const inspections = detail?.available && Array.isArray(detail.inspections)
            ? detail.inspections : [];
        const sparkHtml = (inspections.length && !isNew) ? this._sparkline(inspections) : '';
        const hero = grade
            ? this._gradeHero(grade, sparkHtml, false)
            : isNew
                ? this._newHero(latestView)
                : this._noGradeHero(latestView, sparkHtml);
        const latestDate = latestDateOf(f);
        const heroBlock = (grade || isNew || inspections.length || latestDate)
            ? `${hero}${this._gradeDates(grade?.baseDate || null, latestDate)}`
            : '<div class="text-muted small mb-2">No inspection detail available yet.</div>';
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
