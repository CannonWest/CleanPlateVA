/**
 * Toolbar filters — the active / newly-permitted / mobile-unit predicates,
 * the filter match every view applies, and the counts pill.
 * `filterMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard).
 */

import { esc, facilityPresentation, isActivePermit, isNewlyPermitted } from './presentation.js';

/** Split a query into the terms every row must satisfy.
 *
 *  A `"quoted phrase"` is ONE term and must be found whole; everything else
 *  splits on whitespace. An unterminated quote is forgiving — `"taco bell`
 *  is the phrase `taco bell`, because the closing quote is usually just not
 *  typed yet and the alternative is a term beginning with `"` that can never
 *  match anything. Empty quotes contribute nothing.
 *
 *  Terms come back lower-cased. Both entry points already lower-case `q` (the
 *  search box and `parseUrlState`), but folding it in here means the predicate
 *  is case-insensitive on its own terms rather than on its callers' manners.
 */
let lastQuery = null;
let lastTerms = [];

export function searchTerms(q) {
    // Memoised on the query because _matchesFilters calls this once per ROW —
    // 24,990 times per keystroke. Parsing per row cost 28.6 ms per full pass
    // against 13.6 ms hoisted; the earlier whitespace-only `split` was 10.4 vs
    // 8.2, which is why it was left uncached until the tokeniser arrived. This
    // is a memo of one derived value, not a second copy of the query: it keys
    // off `q` itself, so nothing can go stale and no caller has to remember to
    // refresh it. Frozen because the array is shared with every caller.
    if (q === lastQuery) return lastTerms;
    const terms = [];
    const token = /"([^"]*)"?|(\S+)/g;
    let m;
    while ((m = token.exec(q)) !== null) {
        const term = (m[1] ?? m[2]).trim().toLowerCase();
        if (term) terms.push(term);
    }
    lastQuery = q;
    lastTerms = Object.freeze(terms);
    return lastTerms;
}

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
            // Each field is tested SEPARATELY rather than joined into one
            // haystack, because a quoted phrase must not span the seam between
            // two fields. Joined, `"taco bell"` also matches a place named
            // "...Taco" standing on "Bell St" — the taqueria-on-Bell-Street
            // case quotes exist to exclude. The roster carries 28,250 distinct
            // seam bigrams and NONE of them occur inside a single field, so
            // every one would have been a phantom phrase hit ("hwy madison" =
            // "4764 S Amherst Hwy" + "Madison Heights"). Bare words are
            // unaffected either way: a word has no space, so it can never
            // straddle the seam to begin with.
            const fields = [f.name || '', f.address || '', f.city || ''];
            const zip = String(f.zip || '');
            // EVERY term must land, but each is free to land in a DIFFERENT
            // field — that is what one whole-query substring cannot express,
            // since the address sits between the two fields a visitor pairs:
            // "richmond taco" is taco in the NAME and Richmond in the CITY, and
            // it read as 0 results until this loop. Order-independent by
            // construction, so "taco richmond" is the same query. A ZIP joins in
            // as just another term: "23220 taco". Quoting rejoins words that
            // must travel together: `"taco bell"` is one term and one field.
            //
            // `searchTerms` memoises on `q`, so this is one string compare
            // per row rather than a re-parse (see the note there).
            for (const term of searchTerms(q)) {
                if (!fields.some((s) => s.toLowerCase().includes(term))
                    && !zip.startsWith(term)) return false;
            }
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
