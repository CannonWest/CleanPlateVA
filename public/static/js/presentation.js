/**
 * Presentation math — pure functions, no DOM: the VDH permit link, HTML
 * escaping, the grade palette lookup, one inspection's scope / count /
 * outcome contract, the narrative-verdict and facility-grade presentations,
 * the Contract V4 overlay adapters (a roster row's `o` → the same
 * presentation shapes the detail panel reads), the scope series behind the
 * sparkline, and the date formatters. The grade-receipt mirror lives in
 * receipt.js.
 */

import {
    AGGREGATE_TENANT, FAIRFAX_EXPERIENCE_SOURCE, FAIRFAX_EXPERIENCE_URL, FAIRFAX_RECORDS_URL,
    FAIRFAX_TENANT, GRADE_COLORS, PORTAL_BASE, RF_MAX_ITEM,
} from './constants.js';

// ── Contract V4 roster row adapters ─────────────────────────────────────
// A V4 roster row is a finder row (identity + lat/lon/loc) plus, on the Full
// tier, `o` — the overlay row decoded by its shard's column names. These read
// that shape; the detail-panel path (a V3-shaped facility with `latest`,
// `grade`, …) is untouched, so one presentation serves both.

export const OVERLAY_SCOPES = ['unknown', 'broad', 'focused'];
// "Declining" is banded (CRP-M1b, Cannon 2026-08-31): strictly MORE than
// this many points of grade-to-grade drop lights the dashed ring. Mirrors
// the exporter's cf_export_site.TREND_DECLINE_BAND and the React client's
// app/data/presentation.ts — change all three together.
export const TREND_DECLINE_BAND = 5;
// Codes are identity, not a quality ordering. `venue` is a better pin than
// `street` but is APPENDED at 3, because the exporter may only ever append:
// a shard already on disk has to keep meaning what it meant.
export const LOCATION_CLASS = { rooftop: 0, street: 1, zip_centroid: 2, venue: 3 };

/** yyyymmdd int → ISO date, or null. */
export function isoFromYmd(value) {
    if (!Number.isInteger(value) || value <= 0) return null;
    const text = String(value).padStart(8, '0');
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

/** Effective coordinates of a roster row (V4: top-level lat/lon) or a
 *  detail facility (nested location). */
export function coordsOf(f) {
    const lat = f?.lat ?? f?.location?.lat ?? null;
    const lon = f?.lon ?? f?.location?.lon ?? null;
    return { lat, lon };
}

/** 0 rooftop-quality · 1 street-level (Census centerline) · 2 ZIP centroid ·
 *  3 venue-level (seated on the venue, not the unit) — the finder's `loc`
 *  code, or derived from a detail's location.source. */
export function locationClass(f) {
    if (Number.isInteger(f?.loc)) return f.loc;
    const source = f?.location?.source;
    if (source === 'zip_centroid') return LOCATION_CLASS.zip_centroid;
    if (source === 'venue_anchor') return LOCATION_CLASS.venue;
    // A VGIN road centreline is the same KIND of claim as a Census one —
    // the road, not the building. The exporter classed it as rooftop until
    // 2026-08-22 simply because it was missing from the map.
    if (source === 'census_batch' || source === 'census_oneline'
        || source === 'vgin_street') return LOCATION_CLASS.street;
    return LOCATION_CLASS.rooftop;
}

/** Short qualifier for an approximate pin, '' when it is rooftop-quality.
 *  Deliberately just the class name: the hover is a glance, and the detail
 *  panel's `_geoNote` carries the explanation and the tooltip. One switch so a new class cannot be qualified in one surface
 *  and silently unqualified in the other — which is exactly what happened to
 *  ZIP centroids, warned on the Lite hover and nowhere on the Full one. */
export function approximateLabel(f) {
    switch (locationClass(f)) {
        case LOCATION_CLASS.zip_centroid: return 'approximate location';
        case LOCATION_CLASS.venue: return 'venue-level';
        case LOCATION_CLASS.street: return 'street-level';
        default: return '';
    }
}

/** The last-visit date of a roster row or detail facility, ISO or null. */
export function latestDateOf(f) {
    return f?.latest?.date ?? isoFromYmd(f?.o?.latest_yyyymmdd) ?? null;
}

/** Newly permitted, from the overlay (`new`) or a detail's flag. */
export function isNewlyPermitted(f) {
    return f?.newly_permitted === true || f?.o?.new === 1;
}

/** Whether a roster row / facility is an active permit. V4 finder rows carry
 *  no status (active by construction); closed rows and detail facilities do. */
export function isActivePermit(f) {
    if (f?.status == null) return true;
    // VDH's roster word is `Permitted` (substring); the Fairfax Health
    // District's is `Active`, matched exactly so `Inactive` can never pass —
    // the same predicate as the exporter's cannon_food.merge.is_active.
    const status = String(f.status).trim().toLowerCase();
    return status.includes('permitted') || status === 'active';
}

/** A Fairfax Health District facility (FFX-M4): the exporter's tenant
 *  sentinel, carried by finder, closed and detail records alike. */
export function isFairfax(f) {
    return f?.tenant === FAIRFAX_TENANT;
}

/** The health department whose record a facility's links open: its full
 *  name (the panel line, the attribution), the hand-off phrase the link
 *  controls use ("on VDH" / "at Fairfax County"), and its public search page. */
export function sourceDepartment(f) {
    return isFairfax(f)
        ? { name: 'Fairfax County Health Department', handoff: 'at Fairfax County', url: FAIRFAX_RECORDS_URL }
        : { name: 'Virginia Department of Health', handoff: 'on VDH', url: `${PORTAL_BASE}/${AGGREGATE_TENANT}` };
}

function overlayGrade(o) {
    if (!o || o.grade_score == null || !Number.isFinite(Number(o.grade_score))) return null;
    return { score: Number(o.grade_score), base_date: isoFromYmd(o.base_yyyymmdd) };
}

/** The latest visit as an inspectionPresentation-shaped view, from the
 *  overlay: scope + count (+ OUT for a focused visit). No score is shipped
 *  for a single visit; the facility grade is the verdict. */
function overlayLatestPresentation(o) {
    const scope = OVERLAY_SCOPES[o?.latest_scope_code] || 'unknown';
    const count = Number.isFinite(Number(o?.latest_items)) && o.latest_items != null
        ? Number(o.latest_items) : null;
    const out = Number.isFinite(Number(o?.latest_out)) && o.latest_out != null
        ? Number(o.latest_out) : null;
    return {
        scope, count, formCount: count,
        broadEligible: scope === 'broad', gradeEligible: false,
        score: null, compliant: null, out,
        outIsDistinct: scope === 'focused' && out != null,
        date: isoFromYmd(o?.latest_yyyymmdd),
    };
}

/** Deep link to a facility's official VDH permit page.
 *
 *  Tenant-SCOPED, exactly like the per-inspection `report_url` the exporter
 *  bakes: VDH renders each district under its own path, and a facility a
 *  district claimed is ABSENT from the `virginia` aggregate — that URL returns
 *  an identity-less husk whose permit status is stale (Golden Unicorn read
 *  "Pending" on the aggregate while va-henrico had it Permitted). So route by
 *  the exporter's `tenant` field, present on marker, lite, and detail records.
 *
 *  `f` may be a full/lite marker, a detail facility, or a merged_from entry.
 *  Pre-tenant payloads degrade to the aggregate — the old behaviour, never a
 *  broken link. A Fairfax facility (FFX-M4) has no portal page at all: its
 *  link is the county's ArcGIS Experience map, selecting the facility by the
 *  row's `ffx_oid` (the county's OBJECTID); without one — a merged-in
 *  predecessor, or a row published before the key — it is the county's
 *  inspection-reports search. Each report links itself either way.
 */
export function permitUrl(f, tenant) {
    const t = tenant || f?.tenant || AGGREGATE_TENANT;
    if (t === FAIRFAX_TENANT) {
        const oid = f?.ffx_oid;
        return Number.isInteger(oid)
            ? `${FAIRFAX_EXPERIENCE_URL}#data_s=id%3A${FAIRFAX_EXPERIENCE_SOURCE}%3A${oid}`
            : FAIRFAX_RECORDS_URL;
    }
    return `${PORTAL_BASE}/${encodeURIComponent(t)}/permit/?permitID=`
        + encodeURIComponent(f?.permit_id ?? '');
}

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

export function gradeColor(grade) {
    return GRADE_COLORS[grade] || GRADE_COLORS.none;
}

export function gradeForScore(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
}

const BROAD_MIN_FORM_ITEMS = 20;

function distinctFormItems(checklist) {
    const items = new Set();
    for (const row of (checklist || [])) {
        const item = Number.isInteger(row.item) ? row.item : null;
        if (item != null && item !== 99 && !row.is_sentinel) items.add(item);
    }
    return items.size;
}

function distinctApplicableItems(checklist) {
    const items = new Set();
    for (const row of (checklist || [])) {
        const item = Number.isInteger(row.item) ? row.item : null;
        const applicable = ['IN', 'OUT'].includes(
            String(row.disposition || '').toUpperCase());
        if (item != null && item !== 99 && !row.is_sentinel && applicable) items.add(item);
    }
    return items.size;
}

function distinctOutItems(checklist) {
    const items = new Set();
    for (const row of (checklist || [])) {
        const item = Number.isInteger(row.item) ? row.item : null;
        const isOut = row.violation
            || String(row.disposition || '').toUpperCase() === 'OUT';
        if (item != null && item !== 99 && !row.is_sentinel && isOut) items.add(item);
    }
    return items.size;
}

/** One inspection's single presentation contract: broad, focused, or unknown.
 *  An inspection has a SCORE, never a letter — `gradeEligible` only means the
 *  report is broad + scored (eligible to ANCHOR the facility grade). */
export function inspectionPresentation(insp = null) {
    if (!insp) return {
        scope: 'unknown', count: null, formCount: null,
        broadEligible: false, gradeEligible: false,
        score: null, compliant: null, out: null, outIsDistinct: false,
    };
    const cs = insp.checklist_summary || {};
    // Focused hybrid reports can address more items than their structured
    // checklist carries: comments enumerate corrected prior items while the
    // form contains only the remaining OUT rows. The exporter publishes that
    // union as addressed_item_count; broad reports retain the raw applicable
    // denominator.
    let count = insp.addressed_item_count
        ?? insp.applicable_item_count ?? cs.applicable_item_count ?? null;
    let formCount = insp.form_item_count ?? cs.form_item_count ?? null;
    const hasChecklistShape = Array.isArray(insp.checklist)
        && (insp.checklist.length || insp.checklist_present);
    if (count == null && hasChecklistShape) {
        count = distinctApplicableItems(insp.checklist);
    }
    if (formCount == null && hasChecklistShape) {
        formCount = distinctFormItems(insp.checklist);
    }
    // Pre-M3 compact records carried only the historical breadth count under
    // applicable_item_count. Preserve that contract while old payloads age out.
    if (formCount == null) formCount = count;
    if (count != null) count = Math.max(0, Number(count) || 0);
    if (formCount != null) formCount = Math.max(0, Number(formCount) || 0);
    // Breadth is the gate. Never let a stale/contradictory scope label promote
    // a zero- or 1–19-form-item report into a grade.
    const scope = insp.checklist_present === false || formCount == null || formCount === 0
        ? 'unknown' : formCount >= BROAD_MIN_FORM_ITEMS ? 'broad' : 'focused';
    const score = Number.isFinite(Number(insp.score)) && insp.score !== null
        ? Number(insp.score) : null;
    const broadEligible = scope === 'broad';
    const gradeEligible = broadEligible && score != null;
    const compliant = insp.checklist_compliant ?? cs.compliant
        ?? (Array.isArray(insp.checklist)
            ? insp.checklist.filter((row) =>
                String(row.disposition || '').toUpperCase() === 'IN').length : null);
    // The focused X/Y signal compares distinct OUT item IDs with every
    // distinct item addressed across the checklist + adjudicated comments.
    // Compact marker records have no rows, so retain their published summary.
    const hasChecklistRows = Array.isArray(insp.checklist) && insp.checklist.length > 0;
    const publishedDistinctOut = insp.out_item_count ?? cs.out_item_count ?? null;
    const outIsDistinct = hasChecklistRows || publishedDistinctOut != null;
    const hasEffectiveUnion = insp.addressed_item_count != null
        && publishedDistinctOut != null;
    const out = hasEffectiveUnion
        ? publishedDistinctOut
        : hasChecklistRows
        ? distinctOutItems(insp.checklist)
        : publishedDistinctOut ?? insp.checklist_out ?? cs.out ?? null;
    return {
        scope, count, formCount, broadEligible, gradeEligible, score,
        compliant, out, outIsDistinct,
    };
}

/** The violation-count chip row for an inspection summary — the same total +
 *  risk-factor / retail-practice split the grade receipt shows on its anchor,
 *  ported down onto every history row (replaces the old "N viol." text).
 *  Classification matches the receipt: an integer item ≤ RF_MAX_ITEM is a
 *  risk factor; everything else (higher items, item-less rows) is retail
 *  practice. `show` is false ONLY on a scope-unknown row with nothing
 *  recorded: a green "0 violations" there reads as "verified clean" when the
 *  breadth is simply unknown — the misleading skim the narrative channel was
 *  built to avoid. Unknown rows WITH findings still show the red badge, and
 *  broad/focused keep an honest green zero (there, zero is a real clean docket). */
export function inspectionCountsPresentation(insp = null) {
    const violations = (insp && insp.violations) || [];
    const n = violations.length;
    const rf = violations.filter((v) => Number.isInteger(v.item) && v.item <= RF_MAX_ITEM).length;
    const grp = n - rf;
    const show = n > 0 || inspectionPresentation(insp).scope !== 'unknown';
    return { n, rf, grp, show };
}

/** Compliance-colored focused outcome, deliberately separate from grading. */
export function focusedOutcomePresentation(view = {}) {
    const totalValue = Number(view.count);
    const outValue = Number(view.out);
    const total = Number.isFinite(totalValue) && totalValue > 0
        ? Math.trunc(totalValue) : null;
    const out = view.out !== null && view.out !== undefined
        && Number.isFinite(outValue) && outValue >= 0
        ? Math.trunc(outValue) : null;
    if (view.outIsDistinct === false) {
        const label = out == null
            ? 'OUT count unavailable'
            : `${out} OUT marking${out === 1 ? '' : 's'}`;
        return {
            out, total, label, complianceRate: null, tone: 'unknown', ratioKnown: false,
            description: out == null
                ? 'Focused OUT count is unavailable'
                : `${label}; distinct OUT-item ratio is unavailable`,
        };
    }
    const consistent = total != null && out != null && out <= total;
    if (!consistent) {
        const label = `${out ?? '?'}/${total ?? '?'} OUT`;
        return {
            out, total, label, complianceRate: null, tone: 'unknown', ratioKnown: false,
            description: out != null && total != null
                ? `${label}; focused outcome counts are inconsistent`
                : `${label}; focused OUT count is unavailable`,
        };
    }

    const complianceRate = (total - out) / total;
    // Reserve green for an actually clear focused check and red for a check in
    // which every assessed item was OUT. Partial outcomes step through
    // lime/amber/orange without assigning a grade.
    const tone = out === 0 ? 'clear'
        : complianceRate >= 0.75 ? 'good'
            : complianceRate >= 0.5 ? 'watch'
                : out < total ? 'warning' : 'severe';
    const pct = Math.round(complianceRate * 100);
    return {
        out, total, label: `${out}/${total} OUT`, complianceRate, tone, ratioKnown: true,
        description: `${out} of ${total} focused items marked OUT; ${pct}% in compliance`,
    };
}

export function focusedOutcomeBadge(view, hero = false) {
    const outcome = focusedOutcomePresentation(view);
    const classes = hero
        ? 'food-score-badge food-focused-outcome'
        : 'food-insp-score food-insp-score-focused food-insp-signal';
    return `<span class="${classes} food-outcome-${outcome.tone}" role="img"`
        + ` title="${esc(outcome.description)}" aria-label="${esc(outcome.description)}">`
        + `<span aria-hidden="true">${esc(outcome.out ?? '?')}/${esc(outcome.total ?? '?')}</span>`
        + '<small aria-hidden="true">OUT</small></span>';
}

/** NARRATIVE arc: some VDH follow-ups carry no checklist at all; others are
 *  hybrid reports whose checklist contains only the remaining OUT rows while
 *  comments enumerate corrected prior items. The exporter ships actionable
 *  comment evidence as an `adjudication` block and the grade engine composes
 *  it with the structured channel. Returns null unless the verdict is
 *  actionable. */
export function narrativeVerdictPresentation(insp = null) {
    const adj = insp && insp.adjudication;
    if (!adj || adj.status !== 'adjudicated' || !adj.verdict) return null;
    // `height` is the sparkline plot height (0-100): the verdict's analog on
    // the raw-score axis. "All corrected" IS the checklist full-clear the
    // comment claims, so it sits where an r100 would; "not corrected" is the
    // all-OUT re-check, r0; priority-scoped sits high but not total, and an
    // enumeration plots at its IN-share.
    //
    // `count` is how many ITEMS the verdict names — rendered on the badge
    // (✓2) so a targeted credit is distinguishable at a glance from a
    // blanket clear, which carries a bare ✓. Blankets are semantic (they
    // resolve against whatever the base docketed), so they have no count:
    // that absence is the signal. Targeted verdicts are the common case —
    // they govern 270 of the 350 narrative-consuming facilities and name a
    // median ~33% of the base docket, so reading identically to a full
    // clear was actively misleading (Cannon, 2026-07-20).
    switch (adj.verdict) {
        case 'all_corrected':
            return { verdict: 'all_corrected', tone: 'clear', glyph: '✓', height: 100,
                count: null,
                label: 'All violations corrected',
                detail: 'Inspector recorded every prior violation corrected on this follow-up.' };
        case 'priority_corrected':
            return { verdict: 'priority_corrected', tone: 'good', glyph: '✓', height: 85,
                count: null,
                label: 'Priority violations corrected',
                detail: 'Inspector recorded the priority (risk-factor) violations corrected; remaining items were not addressed.' };
        case 'none_corrected':
            return { verdict: 'none_corrected', tone: 'severe', glyph: '✗', height: 0,
                count: null,
                label: 'Violations not corrected',
                detail: 'Inspector recorded the prior violations NOT corrected on this follow-up.' };
        case 'items': {
            const items = adj.items && typeof adj.items === 'object' ? adj.items : null;
            if (!items) return null;
            const byWord = (want) => Object.keys(items)
                .filter((k) => String(items[k]).toUpperCase() === want)
                .sort((a, b) => a - b).map((k) => `#${k}`);
            const ins = byWord('IN');
            const outs = byWord('OUT');
            if (!ins.length && !outs.length) return null;
            const label = outs.length
                ? (ins.length ? `Items ${ins.join(', ')} corrected · ${outs.join(', ')} still out`
                    : `Items ${outs.join(', ')} still out`)
                : `Items ${ins.join(', ')} corrected`;
            // The badge counts what the glyph asserts: items corrected when
            // the verdict credits, items still out when it only charges.
            const count = ins.length || outs.length;
            const noun = ins.length
                ? `${ins.length} item${ins.length === 1 ? '' : 's'} corrected`
                : `${outs.length} item${outs.length === 1 ? '' : 's'} still out`;
            return { verdict: 'items', glyph: ins.length ? '✓' : '✗',
                tone: outs.length ? (ins.length ? 'watch' : 'severe') : 'good',
                height: Math.round(100 * ins.length / (ins.length + outs.length)),
                count, label,
                detail: `Inspector enumerated item-by-item outcomes in the comments — ${noun}`
                    + `${ins.length && outs.length ? `, ${outs.length} still out` : ''}.`
                    + ' Only the named items adjust the grade; anything unmentioned keeps its full deduction.' };
        }
        default:
            return null;
    }
}

/**
 * The facility grade — a SCORE plus an A-F LETTER, the latest broad assessment
 * adjusted by post-broad focused re-checks, computed by the exporter
 * (`facility.grade`). Returns null when the facility has no scored broad
 * assessment (so no grade). No fallback: a grade exists or it doesn't.
 */
export function gradePresentation(facility = {}) {
    // A detail facility carries the full grade object; a V4 roster row
    // carries only the score (+ base date) on its overlay — the letter is
    // derived, never shipped (design ref §10.6).
    const g = facility.grade || overlayGrade(facility.o) || null;
    const score = g != null && Number.isFinite(Number(g.score)) ? Number(g.score) : null;
    if (score == null) return null;
    const baseScore = Number.isFinite(Number(g.base_score)) ? Number(g.base_score) : score;
    return {
        score,
        letter: g.letter || gradeForScore(score),
        adjusted: !!g.adjusted,
        baseScore,
        baseLetter: g.base_letter || gradeForScore(baseScore),
        baseDate: g.base_date || null,
        followups: Number(g.followups) || 0,
        followupDate: g.followup_date || null,
        restored: g.restored_items || [],
        failed: g.failed_items || [],
        cos: g.cos_items || [],
        newItems: g.new_items || [],
        unchecked: g.unchecked_items || [],
        // Finding-level membership, indexing the BASE report's violations
        // list. An item whose findings met different fates appears in more
        // than one of the item lists above; only these say WHICH finding went
        // where. Absent on payloads published before per-finding resolution —
        // the receipt falls back to item-level membership for those.
        restoredFindings: g.restored_findings || null,
        failedFindings: g.failed_findings || null,
        cosFindings: g.cos_findings || null,
        uncheckedFindings: g.unchecked_findings || null,
        restoredPoints: Number(g.restored_points) || 0,
        extraPoints: Number(g.extra_points) || 0,
        // NARRATIVE arc: how many of the follow-ups were adjudicated from
        // the inspector's written comments (and which items they governed).
        narrativeFollowups: Number(g.narrative_followups) || 0,
        narrativeItems: g.narrative_items || [],
        // The broad report that anchors the grade — the receipt modal joins
        // it back to its full inspection row for the per-item breakdown.
        baseInspectionId: g.base_inspection_id || null,
    };
}

/** Pair the newest event with the one facility-level grade assessment. */
export function facilityPresentation(facility = {}) {
    if (facility.o && !facility.latest) {
        // A Contract V4 roster row: everything the map and the List need at
        // boot rides on the overlay. `trend` stays empty here — the sparkline
        // reads the row's `visits` through visitsOf() (hover) or the detail's
        // inspections through buildScopeSeries() (panel), one renderer.
        const o = facility.o;
        const latest = overlayLatestPresentation(o);
        const compliance = Number.isFinite(Number(o.compliance_pct)) && o.compliance_pct != null
            ? Number(o.compliance_pct) / 100 : null;
        const baseDate = isoFromYmd(o.base_yyyymmdd);
        const assessmentRecord = baseDate != null || compliance != null
            ? { date: baseDate, compliance_rate: compliance } : null;
        const trendDelta = Number.isFinite(Number(o.trend_delta)) && o.trend_delta != null
            ? Number(o.trend_delta) : null;
        return {
            latest,
            latestDate: latest.date,
            assessment: assessmentRecord ? { ...latest, scope: 'broad', broadEligible: true } : null,
            assessmentRecord,
            grade: gradePresentation(facility),
            trend: [],
            trendDelta,
            // Banded + grade-to-grade since CRP-M1b: the exporter ships
            // current adjusted grade minus the previous era's; the ring
            // fires only past TREND_DECLINE_BAND points of drop.
            declining: trendDelta != null && trendDelta < -TREND_DECLINE_BAND,
        };
    }
    const latest = inspectionPresentation(facility.latest || null);
    const candidate = facility.latest_assessment || null;
    let assessmentRecord = candidate;
    let assessment = candidate ? inspectionPresentation(candidate) : null;
    if (assessment && !assessment.gradeEligible) {
        assessment = null;
        assessmentRecord = null;
    }
    if (!assessment && latest.gradeEligible) {
        assessment = latest;
        assessmentRecord = facility.latest;
    }
    // A detail-shaped facility carries no series at this level: the panel
    // plots its trend from the real inspection history (buildScopeSeries),
    // and the roster's V3 `trend` tuple stream is retired with Contract V4.
    // `score_trend` stays unread here (its retirement predates V4).
    return {
        latest,
        latestDate: facility.latest?.date ?? null,
        assessment,
        assessmentRecord,
        grade: gradePresentation(facility),
        trend: [],
        trendDelta: null,
        declining: false,
    };
}

// ── the overlay's `visits` → the sparkline series (CPH, D-DATA-13) ────────
// One entry per inspection, oldest-first, `[kind, yyyymmdd, value…]`:
//   [1, d, score]           broad with a published score — the score line
//   [1, d]                  broad, no score — an x-slot with no mark
//   [2, d, out, addressed]  focused, ratio known — ◇ at (addressed − out)/addressed
//   [2, d]                  focused, ratio unknown — baseline tick
//   [3, d, code]            adjudicated verdict — 1 all_corrected · 2 priority_corrected · 3 none_corrected
//   [3, d, 4, ins, outs]    adjudicated `items` verdict — the IN / OUT counts
//   [0, d]                  nothing claimable — baseline tick
// The exporter (cannon-food `_visit_event`) writes exactly what the renderer
// would derive from the detail; visitsOf() turns it back into the series
// shape buildScopeSeries() builds, so the SAME presentation functions and
// the SAME `_sparkSvg` draw the hover card and the click panel. Cross-checked
// 27,919 / 27,919 across the archive at CPH-M0/M1 (tools/visits-crosscheck.mjs).
export const VISIT_KIND = { unknown: 0, broad: 1, focused: 2, narrative: 3 };
export const VISIT_VERDICT = { 1: 'all_corrected', 2: 'priority_corrected', 3: 'none_corrected', 4: 'items' };

const EMPTY_PRESENTATION = {
    count: null, formCount: null, broadEligible: false, gradeEligible: false,
    score: null, compliant: null, out: null, outIsDistinct: false,
};

/** An adjudication block that narrativeVerdictPresentation() reads the same
 *  way it reads the detail's: only the IN / OUT counts matter to the
 *  sparkline (height, glyph, tone, count), so the item numbers are
 *  placeholders — the hover card never prints them. */
function syntheticItems(ins, outs) {
    const items = {};
    for (let i = 1; i <= ins; i++) items[String(i)] = 'IN';
    for (let i = 1; i <= outs; i++) items[String(ins + i)] = 'OUT';
    return items;
}

function visitEvent(entry, index, total) {
    const [kind, ymd, ...rest] = Array.isArray(entry) ? entry : [];
    const date = isoFromYmd(Number.isInteger(ymd) ? ymd : 0);
    const inspection = { date };
    let presentation = { ...EMPTY_PRESENTATION, scope: 'unknown' };
    if (kind === VISIT_KIND.broad) {
        const score = Number.isFinite(rest[0]) ? Number(rest[0]) : null;
        inspection.score = score;
        presentation = { ...EMPTY_PRESENTATION, scope: 'broad', broadEligible: true,
            gradeEligible: score != null, score };
    } else if (kind === VISIT_KIND.focused) {
        const known = rest.length >= 2 && Number.isFinite(rest[0]) && Number.isFinite(rest[1]);
        presentation = known
            ? { ...EMPTY_PRESENTATION, scope: 'focused', count: Number(rest[1]),
                formCount: Number(rest[1]), out: Number(rest[0]), outIsDistinct: true }
            : { ...EMPTY_PRESENTATION, scope: 'focused' };
    } else if (kind === VISIT_KIND.narrative) {
        const verdict = VISIT_VERDICT[rest[0]];
        if (verdict === 'items') {
            const ins = Number.isInteger(rest[1]) ? rest[1] : 0;
            const outs = Number.isInteger(rest[2]) ? rest[2] : 0;
            if (ins || outs) {
                inspection.adjudication = { status: 'adjudicated', verdict, items: syntheticItems(ins, outs) };
            }
        } else if (verdict) {
            inspection.adjudication = { status: 'adjudicated', verdict };
        }
    }
    return { inspection, presentation, index, historyIndex: total - 1 - index };
}

/** A Contract V4 roster row's `visits` as the series the sparkline draws —
 *  the same shape buildScopeSeries() returns for a detail's inspections. */
export function visitsOf(f) {
    const visits = Array.isArray(f?.o?.visits) ? f.o.visits : [];
    const events = visits.map((entry, index) => visitEvent(entry, index, visits.length));
    return {
        events,
        broad: events.filter((event) => event.presentation.gradeEligible),
        focused: events.filter((event) => event.presentation.scope === 'focused'),
        unknown: events.filter((event) => event.presentation.scope === 'unknown'),
    };
}

/** Oldest-first event positions; only broad points belong to the score line. */
export function buildScopeSeries(inspections = []) {
    const events = [...inspections].reverse().map((inspection, index) => ({
        inspection,
        presentation: inspectionPresentation(inspection),
        index,
        // Exact position in the newest-first inspection history. Dates and
        // report IDs are not guaranteed unique, so trend clicks use this
        // render-order identity instead of a best-effort content match.
        historyIndex: inspections.length - 1 - index,
    }));
    return {
        events,
        broad: events.filter((event) => event.presentation.gradeEligible),
        // Every focused event, scored or not: the trend plots these by their
        // OUT/addressed compliance, so a missing raw score no longer decides
        // whether the re-check appears at all (it used to vanish silently while
        // still consuming an x slot).
        focused: events.filter((event) => event.presentation.scope === 'focused'),
        unknown: events.filter((event) => event.presentation.scope === 'unknown'),
    };
}

export function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Year-less date (M/D) for the toolbar's narrow freshness variant. The
// archive is always within the current year in practice, and the full
// variant (plus the tooltip) still carries the year.
export function fmtDateShort(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Compact numeric date (M/D/YYYY) for the grade hero's provenance lines.
export function fmtDateNum(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
}
