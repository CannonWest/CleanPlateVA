/**
 * Toolbar filters — the active / newly-permitted / mobile-unit predicates,
 * the filter match every view applies, the counts pill, and the ZIP select.
 * `filterMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard).
 */

import { esc, facilityPresentation } from './presentation.js';

export const filterMethods = {
    // Active = a live permit. Anything else (Business Closed / Withdrawn /
    // Expired / Pending / *Closure / Suspended / Surrendered) is "closed".
    _isActive(f) {
        return (f.status || '').toLowerCase().includes('permitted');
    },

    // Newly permitted = the exporter's authoritative flag: active + no grade +
    // a pre-opening on record + no routine/risk-factor inspection + zero
    // violations. "No grade" alone is NOT enough — an unparsed routine that
    // carries violations must never read as "cleared to open" (see cf_export_site
    // _newly_permitted). Absent flag (older payload) degrades safely to false.
    _isNew(f) {
        return f.newly_permitted === true;
    },

    // Mobile food unit = VDH's permit type, verbatim from the exporter. Matched
    // lowercase-substring (same idiom as _isActive) so a VDH pluralization or
    // class suffix still lands; no other permit type contains "mobile food".
    // Lite records carry no permit_type but DO carry the exporter's `mobile`
    // boolean (the same predicate, applied at export time) — so the switch
    // works on both tiers off this one test.
    _isMobileUnit(f) {
        return f.mobile === true
            || (f.permit_type || '').toLowerCase().includes('mobile food');
    },

    _matchesFilters(f) {
        const { q, zip, grade, restaurantsOnly, showClosed, showNew, showMobile } = this._filters;
        const lite = this._mode === 'lite';
        // Explicit === false so payloads without the field pass through
        // rather than blanking the map.
        if (restaurantsOnly && f.is_restaurant === false) return false;
        // Lite records carry no status (active-only by construction) and no
        // grades — those filters are hidden and inert there.
        if (!lite && !showClosed && !this._isActive(f)) return false;
        // Newly-permitted (active, ungraded) places get their own toggle.
        if (!lite && !showNew && this._isNew(f)) return false;
        // Mobile food units are hidden unless asked for — BOTH tiers: the
        // lite record carries the exporter's `mobile` boolean precisely so
        // this filter works on the public site too (a truck's pin is the
        // permit's filing address, not where it parks).
        if (!showMobile && this._isMobileUnit(f)) return false;
        if (!lite && grade) {
            const letter = facilityPresentation(f).grade?.letter || null;
            if (letter !== grade) return false;
        }
        if (zip && f.zip !== zip) return false;
        if (q) {
            const hay = `${f.name || ''} ${f.address || ''} ${f.city || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    },

    _updateCounts(filteredLen) {
        const countsEl = document.getElementById('foodCounts');
        if (!countsEl) return;
        const total = this._facilities.length;
        const filtered = filteredLen !== total;
        // Thousands separators: the statewide archive is five digits now, and
        // "19147" reads as a code rather than a quantity without them.
        const shown = filtered
            ? `${filteredLen.toLocaleString()} of ${total.toLocaleString()}`
            : total.toLocaleString();
        // "facilities" is the first thing to go when the toolbar gets tight —
        // the glyph carries the noun once the word drops, so the narrow pill
        // still reads as a count of places. CSS owns the breakpoint; the
        // title carries the full phrasing at every width.
        countsEl.innerHTML = '<i class="bi bi-buildings" aria-hidden="true"></i>'
            + `${esc(shown)}<span class="food-count-unit"> facilities</span>`;
        countsEl.classList.toggle('is-filtered', filtered);
        countsEl.title = filtered
            ? `${filteredLen.toLocaleString()} of ${total.toLocaleString()} facilities match the active filters`
            : `${total.toLocaleString()} facilities in this snapshot`;
    },

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
    },
};
