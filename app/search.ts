/**
 * The filter predicate + the one search box — ports the pure half of the old
 * `filters.js` (C6's search semantics are the spec). Three rules stack:
 *
 *   1. WITHIN A TERM, name / address / city match anywhere; the ZIP matches
 *      from the START ("231" means the 231** ZIPs, not Alexandria's 22311).
 *   2. ACROSS TERMS, whitespace splits and EVERY term must land, each free
 *      to land in a DIFFERENT field ("richmond taco").
 *   3. A "QUOTED PHRASE" is one term found whole inside a SINGLE field —
 *      fields are tested separately so a phrase can never straddle the seam
 *      ("taco bell" must not match a Taqueria on Bell St via the join).
 *
 * The counts pill and toolbar wiring are chrome (CRV); nothing DOM here.
 */

import { facilityPresentation, isActivePermit, isNewlyPermitted } from './data/presentation'
import type { FacilityLike } from './data/presentation'

let lastQuery: string | null = null
let lastTerms: readonly string[] = []

/** Split a query into the terms every row must satisfy. A quoted phrase is
 *  ONE term (an unterminated quote is forgiving — the closing quote is
 *  usually just not typed yet); empty quotes contribute nothing. Memoised on
 *  the query because the predicate runs once per ROW — ~25k times per
 *  keystroke. */
export function searchTerms(q: string): readonly string[] {
    if (q === lastQuery) return lastTerms
    const terms: string[] = []
    const token = /"([^"]*)"?|(\S+)/g
    let m: RegExpExecArray | null
    while ((m = token.exec(q)) !== null) {
        const term = (m[1] ?? m[2] ?? '').trim().toLowerCase()
        if (term) terms.push(term)
    }
    lastQuery = q
    lastTerms = Object.freeze(terms)
    return lastTerms
}

/** Mobile food unit = VDH's permit type, or the exporter's `mobile` boolean
 *  (the same predicate applied at export time — how the switch works on the
 *  basic map, which ships no permit_type). Strict `=== true` so payload
 *  drift can't hide real places. */
export function isMobileUnit(f: FacilityLike): boolean {
    return f.mobile === true
        || (f.permit_type || '').toLowerCase().includes('mobile food')
}

export interface FilterState {
    q?: string
    grade?: string
    restaurantsOnly?: boolean
    showClosed?: boolean
    showNew?: boolean
    showMobile?: boolean
}

/** The filter match every view applies — a pure function of the row, the
 *  filter state, and the tier (the old `_matchesFilters` without `this`). */
export function matchesFilters(f: FacilityLike, filters: FilterState, mode = 'full'): boolean {
    const { q, grade, restaurantsOnly, showClosed, showNew, showMobile } = filters
    const lite = mode === 'lite'
    // Explicit === false so payloads without the field pass through.
    if (restaurantsOnly && f.is_restaurant === false) return false
    // Lite records carry no status (active-only by construction) and no
    // grades — those filters are hidden and inert there.
    if (!lite && !showClosed && !isActivePermit(f)) return false
    if (!lite && !showNew && isNewlyPermitted(f)) return false
    // Mobile units hide unless asked for — BOTH tiers (the truck's pin is
    // the permit's filing address, not where it parks).
    if (!showMobile && isMobileUnit(f)) return false
    if (!lite && grade) {
        const letter = facilityPresentation(f).grade?.letter || null
        if (!letter || !grade.includes(letter)) return false
    }
    if (q) {
        // Each field tested SEPARATELY (a phrase must not span the seam);
        // the ZIP matches by PREFIX only.
        const fields = [f.name || '', f.address || '', f.city || '']
        const zip = String(f.zip || '')
        for (const term of searchTerms(q)) {
            if (!fields.some((s) => s.toLowerCase().includes(term))
                && !zip.startsWith(term)) return false
        }
    }
    return true
}
