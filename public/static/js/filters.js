/**
 * Toolbar filters — the active / newly-permitted / mobile-unit predicates,
 * the filter match every view applies, and the counts pill.
 * `filterMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard).
 */

import { esc, facilityPresentation, isActivePermit, isNewlyPermitted } from './presentation.js';

export const filterMethods = {
    // Active = a live permit. Contract V4 finder rows carry no status — the
    // finder IS the active set — while closed rows (the lazy `closed/*`
    // family) and detail facilities carry it; anything but "…permitted…"
    // (Business Closed / Withdrawn / Expired / Pending / *Closure / Suspended
    // / Surrendered) is "closed".
    _isActive(f) {
        return isActivePermit(f);
    },

    // Newly permitted = the exporter's authoritative flag (overlay `new`, or
    // a detail's newly_permitted): active + no grade + a pre-opening on
    // record + no routine/risk-factor inspection + zero violations. "No
    // grade" alone is NOT enough — an unparsed routine that carries
    // violations must never read as "cleared to open" (see cf_export_site
    // _newly_permitted). Absent flag degrades safely to false.
    _isNew(f) {
        return isNewlyPermitted(f);
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
        const { q, grade, restaurantsOnly, showClosed, showNew, showMobile } = this._filters;
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
        if (q) {
            // ZIP is folded into this one box (the select is retired). The text
            // fields match ANYWHERE; the ZIP matches from the START. That
            // asymmetry is the whole point: "231" should mean the 231** ZIPs,
            // and a substring test also returns 22311 / 22312 / 22314 / 22315 —
            // Alexandria, 425 rows, when the visitor typed a Richmond prefix
            // (measured against the committed roster). A full "23220" still
            // matches, and a digit run that is really a street number is still
            // found through `hay`.
            const hay = `${f.name || ''} ${f.address || ''} ${f.city || ''}`.toLowerCase();
            if (!hay.includes(q) && !String(f.zip || '').startsWith(q)) return false;
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
};
