/**
 * Marker-bound hover card — the display-only popup a mouse gets over a
 * marker, and the roster-only hero preview it renders. `hoverMethods` is
 * installed on FoodDashboard.prototype by foodDashboard.js (`this` is the
 * dashboard).
 */

import {
    esc, gradePresentation, inspectionPresentation, trendInspections,
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
    },

    // The hover card previews the detail panel's grade hero from the roster
    // alone: name + address, then the same circle / NEW badge / no-grade dash,
    // static sparkline, and date cards. No flat "Grade A · 94" text — the
    // circle is the verdict, and a focused raw score prints nowhere
    // (the #42/#43 invariant carries over by construction: the shared
    // sparkline plots ratios, not raw scores). Controls are deliberately
    // omitted here; those belong to the clicked detail panel.
    _hoverCardHTML(f) {
        if (this._mode === 'lite') {
            return `<strong>${esc(f.name)}</strong><br>`
                + `${esc(f.address || '')}${f.city ? ', ' + esc(f.city) : ''}`
                + (f.location?.source === 'zip_centroid'
                    ? '<br><span class="food-tip-sub">≈ approximate location</span>' : '');
        }
        const grade = gradePresentation(f);
        const latestView = inspectionPresentation(f.latest || null);
        const isNew = this._isNew(f);
        const active = this._isActive(f);
        const pseudo = trendInspections(f.trend);
        const sparkHtml = (pseudo.length && !isNew) ? this._sparkline(pseudo) : '';
        const hero = grade
            ? this._gradeHero(grade, sparkHtml, false)
            : isNew
                ? this._newHero(latestView)
                : this._noGradeHero(latestView, sparkHtml);
        // A pre-`trend` payload (or a facility with real history whose tuples
        // are somehow absent) still gets its hero — circle + dates, just no
        // sparkline. Only a facility with nothing at all says so.
        const heroBlock = (grade || isNew || pseudo.length || f.latest?.date)
            ? `${hero}${this._gradeDates(grade?.baseDate || null, f.latest?.date || null)}`
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
