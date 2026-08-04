/**
 * Restaurant-inspection map dashboard.
 *
 * Renders the facility archive served by `/api/food/*` — never a live feed;
 * data is collected and scored by a separate pipeline, and this page only
 * reads the archived snapshot.
 *
 * Map engine is MapLibre GL JS (classic CDN script) rendering CARTO's vector
 * basemaps (positron / dark-matter), with clustering done by MapLibre's
 * GeoJSON source (`cluster: true`).
 *
 * Engine notes:
 *   · coordinates are [lng, lat];
 *   · CARTO GL styles serve 512px tiles, so zoom levels run ~1 lower than
 *     256px-tile maps;
 *   · markers are a data-driven circle layer (paint props read per-feature
 *     properties baked in _toGeoJSON);
 *   · theme swap is map.setStyle(light↔dark) + re-adding the data source and
 *     layers on the next `style.load`.
 *
 * TWO COMPUTED THINGS, VDH PUBLISHES NEITHER. An INSPECTION has a SCORE — a
 * 0-100 number, no letter (rounded-square badges). A FACILITY has a GRADE — a
 * score plus an A-F letter (the circle badge), the latest broad assessment
 * adjusted by what post-broad focused re-checks verified, shipped by the
 * exporter as `facility.grade`. Marker fill, A-F chips, sort, hover, and the
 * detail headline all key off the grade; the letter never appears on a single
 * inspection.
 */

const RESTAURANTS_ONLY_KEY = 'cleanplateva.food.restaurantsOnly';
const SHOW_CLOSED_KEY = 'cleanplateva.food.showClosed';
const SHOW_NEW_KEY = 'cleanplateva.food.showNew';
const SHOW_MOBILE_KEY = 'cleanplateva.food.showMobile';

const PORTAL_BASE = 'https://inspections.myhealthdepartment.com';
// The `virginia` aggregate: correct only for facilities no district claimed.
const AGGREGATE_TENANT = 'virginia';

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
 *  broken link.
 */
export function permitUrl(f, tenant) {
    const t = tenant || f?.tenant || AGGREGATE_TENANT;
    return `${PORTAL_BASE}/${encodeURIComponent(t)}/permit/?permitID=`
        + encodeURIComponent(f?.permit_id ?? '');
}

// Grade palette — fixed hues that read on light + dark (data color, not
// chrome; chrome themes via CSS).
const GRADE_COLORS = {
    A: '#2f9e44',   // green
    B: '#94be1b',   // lime
    C: '#f59f00',   // amber
    D: '#e8590c',   // orange
    F: '#e03131',   // red
    none: '#868e96', // unscored — gray
};

// Newly permitted (an active permit with no scored broad assessment yet, so no
// grade): a blue that reads "cleared to open, grade still to come" — distinct
// from every A–F hue and on-brand with --cp-accent. Data color (map marker +
// panel badge), so it lives alongside GRADE_COLORS.
const NEW_COLOR = '#1c7ed6';

// CARTO vector basemaps. Attribution rides in the style's sources;
// MapLibre's AttributionControl surfaces it.
const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Map home: the whole state, framed by fitBounds so the initial view
// scales to the viewport instead of a fixed zoom. Virginia is far wider
// than it is tall, so on desktop the east–west span is the constraint and
// the full north–south border always clears; on a portrait phone the state
// lands as a horizontal band (near-VA visitors get auto-located past it).
// [[west, south], [east, north]] — padded a touch beyond the true extent.
const VA_BOUNDS = [[-83.7, 36.5], [-75.2, 39.5]];
const VA_FIT = { padding: 20 };

// MapLibre source + layer ids (data layers re-added on every style swap).
const SRC = 'food-facilities';
const LYR_CLUSTERS = 'food-clusters';
const LYR_CLUSTER_COUNT = 'food-cluster-count';
const LYR_POINTS = 'food-points';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function gradeColor(grade) {
    return GRADE_COLORS[grade] || GRADE_COLORS.none;
}

function gradeForScore(score) {
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

function focusedOutcomeBadge(view, hero = false) {
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
    const g = facility.grade || null;
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

// ── grade receipt ───────────────────────────────────────────────────────
// The per-facility "how was this grade computed" breakdown behind the hero's
// grade circle: the methodology page's worked example, with this facility's
// real numbers. It mirrors the engine's dock math (cf_lib.violation_dock_map
// + facility_grade) over the SAME published rows the engine consumed, then
// RECONCILES every derived figure against the published grade block —
// base_score, final score, the 1-dp aggregates, bucket membership, follow-up
// counts. Any mismatch flips `verified` off and the modal silently degrades
// to bucket-level prose (published numbers only, no per-item points): the
// engine stays the single authority; the mirror only ever ADDS resolution,
// never contradicts. Membership shown to the user always comes from the
// PUBLISHED buckets, even when verified.
//
// All arithmetic runs in integer TEN-THOUSANDTHS of a point: every weight
// the formula can produce (6/2 · ×1.5 repeat · ×0.75 COS · ×0.65/×0.35
// restore) is exact in that unit, so float drift can neither fabricate a
// reconcile failure nor mask a real one.

const RECEIPT_SCALE = 10000;                    // ten-thousandths of a point
const W_RF_TT = 6 * RECEIPT_SCALE;              // risk-factor violation
const W_GRP_TT = 2 * RECEIPT_SCALE;             // Good-Retail-Practice violation
const RF_MAX_ITEM = 29;                         // cf_lib.RISK_FACTOR_MAX_ITEM

const receiptIsRepeatText = (text) => /\brepeat\b/i.test(text || '');
// cf_lib.is_followup: purpose/type marks the visit a re-check.
const receiptIsFollowup = (insp) =>
    /follow/.test(`${insp?.purpose || ''} ${insp?.insp_type || ''}`.toLowerCase());

// cf_lib.doc_scope: the STORED scope wins (the exporter computed it with the
// engine's own rules); breadth-derivation is only the legacy fallback. This
// deliberately differs from inspectionPresentation's stale-label guard —
// the receipt must see the rows exactly as the grade engine saw them.
function receiptScope(insp) {
    const scope = insp?.scope;
    if (scope === 'broad' || scope === 'focused' || scope === 'unknown') return scope;
    return inspectionPresentation(insp).scope;
}

// cf_lib.checklist_item_words: item → {word: IN|OUT|OUT_COS, repeat}. Any
// OUT row makes the item OUT; it softens to OUT_COS only when every OUT row
// was corrected on site. N/A and N/O rows do not address the item.
function receiptItemWords(checklist) {
    const seen = new Map();
    for (const row of checklist || []) {
        const item = Number.isInteger(row.item) ? row.item : null;
        if (item == null || row.is_sentinel) continue;
        if (!(row.compliant || row.violation)) continue;
        const cur = seen.get(item) || { word: 'IN', repeat: false };
        if (row.violation) {
            if (cur.word === 'IN') cur.word = row.cos ? 'OUT_COS' : 'OUT';
            else if (cur.word === 'OUT_COS' && !row.cos) cur.word = 'OUT';
        }
        cur.repeat = cur.repeat || !!row.repeat;
        seen.set(item, cur);
    }
    return seen;
}

// cf_lib.violation_dock_map in ten-thousandths: item|null → the item's base
// deduction. `pointsTT` carries the ×0.75 COS discount; `fullTT` is what a
// failed re-check would revoke back to. Item-less observations ride under
// null at face value — they can never be re-checked by item.
function receiptDockMap(base) {
    const rows = base.checklist || [];
    const repeatItems = new Set(rows
        .filter((r) => r.repeat && Number.isInteger(r.item)).map((r) => r.item));
    const cosItems = new Set([...receiptItemWords(rows)]
        .filter(([, w]) => w.word === 'OUT_COS').map(([item]) => item));
    const docks = new Map();
    for (const obs of base.violations || []) {
        const item = Number.isInteger(obs.item) ? obs.item : null;
        let weightTT = item != null && item <= RF_MAX_ITEM ? W_RF_TT : W_GRP_TT;
        const repeat = receiptIsRepeatText(obs.text) || repeatItems.has(item);
        if (repeat) weightTT = weightTT * 3 / 2;
        const cos = item != null && cosItems.has(item);
        const dock = docks.get(item)
            || { pointsTT: 0, fullTT: 0, count: 0, repeat: false, cos: false, texts: [] };
        dock.pointsTT += cos ? weightTT * 3 / 4 : weightTT;
        dock.fullTT += weightTT;
        dock.count += 1;
        dock.repeat = dock.repeat || repeat;
        dock.cos = dock.cos || cos;
        if (obs.text) dock.texts.push(obs.text);
        docks.set(item, dock);
    }
    return docks;
}

// cf_lib.narrative_item_words: an adjudicated verdict resolved against the
// base dock map — narrative words can restore or re-charge an existing dock,
// never mint one, and blankets skip item-less docks (checklist parity).
function receiptNarrativeWords(insp, docks) {
    const adj = insp.adjudication || {};
    const words = new Map();
    if (adj.status !== 'adjudicated') return words;
    const docked = [...docks.keys()].filter((item) => item != null);
    if (adj.verdict === 'all_corrected') {
        docked.forEach((item) => words.set(item, { word: 'IN', repeat: false }));
    } else if (adj.verdict === 'none_corrected') {
        docked.forEach((item) => words.set(item, { word: 'OUT', repeat: false }));
    } else if (adj.verdict === 'priority_corrected') {
        docked.filter((item) => item <= RF_MAX_ITEM)
            .forEach((item) => words.set(item, { word: 'IN', repeat: false }));
    } else if (adj.verdict === 'items') {
        for (const [k, v] of Object.entries(adj.items || {})) {
            const item = Number(k);
            const word = String(v).toUpperCase();
            if (Number.isInteger(item) && docks.has(item)
                && (word === 'IN' || word === 'OUT')) {
                words.set(item, { word, repeat: false });
            }
        }
    }
    return words;
}

/**
 * The grade-receipt model for one facility: the broad anchor's per-item
 * docks, the post-broad re-checks and what each governed item's outcome did
 * to the number, and the base → adjustments → grade ledger. Returns null
 * when the facility has no grade (mirrors gradePresentation). Per-item point
 * values are only trustworthy when `verified` is true.
 */
export function gradeReceiptPresentation(facility = {}, inspections = []) {
    const grade = gradePresentation(facility);
    if (!grade) return null;
    const g = facility.grade || {};

    const dated = (inspections || []).filter((i) => i && i.date);
    let base = grade.baseInspectionId
        ? dated.find((i) => i.inspection_id === grade.baseInspectionId) || null : null;
    if (!base) {
        // Legacy payloads without base_inspection_id: newest scored broad,
        // exactly the engine's own base selection.
        base = dated
            .filter((i) => receiptScope(i) === 'broad' && Number.isFinite(Number(i.score)))
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0] || null;
    }

    const isNarr = (i) => receiptIsFollowup(i)
        && (i.adjudication || {}).status === 'adjudicated';

    // cf_lib.facility_grade's follow-up selection: post-broad by date, or
    // same-day when the purpose marks it a Follow-Up; newest first.
    const docks = base ? receiptDockMap(base) : new Map();
    const followups = base ? dated
        .filter((i) => ((Array.isArray(i.checklist) && i.checklist.length
            && receiptScope(i) === 'focused') || isNarr(i))
            && (i.date > base.date || (i.date === base.date && receiptIsFollowup(i))))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) : [];

    const latestWord = new Map();       // newest word per item, both channels
    const narrativeItems = new Set();   // items whose governing word is narrative
    let narrativeCount = 0;
    const followupViews = [];
    for (const fup of followups) {
        const narrative = isNarr(fup);
        const structured = Array.isArray(fup.checklist) && fup.checklist.length
            && receiptScope(fup) === 'focused';
        const verdict = narrative ? narrativeVerdictPresentation(fup) : null;
        if (narrative) narrativeCount += 1;
        if (structured) {
            const view = inspectionPresentation(fup);
            const outcome = focusedOutcomePresentation(view);
            followupViews.push({
                date: fup.date, kind: narrative ? 'hybrid' : 'checklist',
                tone: outcome.tone,
                label: outcome.ratioKnown
                    ? `${outcome.out}/${outcome.total} OUT` : outcome.label,
                detail: verdict?.detail
                    ? `${outcome.description}; ${verdict.detail}`
                    : outcome.description,
            });
        } else {
            followupViews.push({
                date: fup.date, kind: 'narrative',
                tone: verdict?.tone || 'unknown',
                label: verdict?.label || 'Written verdict',
                detail: verdict?.detail || '',
            });
        }
        const narrativeWords = narrative
            ? receiptNarrativeWords(fup, docks) : new Map();
        const words = new Map(narrativeWords);
        const sourcedNarrative = new Set(narrativeWords.keys());
        if (structured) {
            for (const [item, word] of receiptItemWords(fup.checklist)) {
                words.set(item, word);
                sourcedNarrative.delete(item);
            }
        }
        for (const [item, w] of words) {
            if (!latestWord.has(item)) {
                latestWord.set(item, w);
                if (sourcedNarrative.has(item)) narrativeItems.add(item);
            }
        }
    }

    // Base facts first — the anchor's total and its item-less riders exist
    // whether or not anything re-checked them.
    let baseTT = 0;
    let itemless = null;
    for (const [item, dock] of docks) {
        baseTT += dock.pointsTT;
        if (item == null) itemless = { count: dock.count, pointsTT: dock.pointsTT };
    }

    // Outcome walk — the exact branch structure of facility_grade, including
    // its no-followup early return: with nothing to adjust, the buckets stay
    // EMPTY (nothing is "unchecked" when no re-check ever happened) and the
    // grade is the broad score, exactly.
    let totalTT = 0, restoredTT = 0, extraTT = 0;
    const derived = { restored: [], failed: [], cos: [], new: [], unchecked: [] };
    if (followups.length) {
        for (const [item, dock] of docks) {
            const w = item != null ? latestWord.get(item) : undefined;
            if (!w) {
                totalTT += dock.pointsTT;
                if (item != null) derived.unchecked.push(item);
            } else if (w.word === 'IN') {
                totalTT += dock.pointsTT * 35 / 100;
                restoredTT += dock.pointsTT * 65 / 100;
                derived.restored.push(item);
            } else if (w.word === 'OUT_COS') {
                totalTT += dock.fullTT;                 // credit revoked, no mult
                extraTT += dock.fullTT - dock.pointsTT;
                derived.cos.push(item);
            } else {
                totalTT += dock.fullTT * 3 / 2;         // revoked + structural repeat
                extraTT += dock.fullTT * 3 / 2 - dock.pointsTT;
                derived.failed.push(item);
            }
        }
        for (const [item, w] of latestWord) {
            if (docks.has(item) || w.word !== 'OUT') continue;  // OUT_COS new items dock nothing
            let weightTT = item <= RF_MAX_ITEM ? W_RF_TT : W_GRP_TT;
            if (w.repeat) weightTT = weightTT * 3 / 2;
            totalTT += weightTT;
            extraTT += weightTT;
            derived.new.push(item);
        }
    }

    // cf_lib.published_score / _one_dp, integer-exact (ROUND_HALF_UP).
    const scoreTT = (tt) => {
        const raw = 100 * RECEIPT_SCALE - tt;
        if (raw <= 0) return 0;
        const q = Math.floor(raw / RECEIPT_SCALE);
        return raw % RECEIPT_SCALE >= RECEIPT_SCALE / 2 ? q + 1 : q;
    };
    const oneDpTT = (tt) => {
        const q = Math.floor(tt / (RECEIPT_SCALE / 10));
        return (tt % (RECEIPT_SCALE / 10) >= RECEIPT_SCALE / 20 ? q + 1 : q) / 10;
    };
    const derivedBase = scoreTT(baseTT);
    const derivedScore = followups.length ? scoreTT(totalTT) : derivedBase;

    const sameItems = (mine, published) => {
        const a = [...mine].sort((m, n) => m - n);
        const b = (published || []).map(Number).sort((m, n) => m - n);
        return a.length === b.length && a.every((v, i) => v === b[i]);
    };
    const verified = !!base
        && derivedBase === grade.baseScore
        && derivedScore === grade.score
        && followups.length === grade.followups
        && (!!g.adjusted) === (followups.length > 0)
        && narrativeCount === grade.narrativeFollowups
        && oneDpTT(restoredTT) === grade.restoredPoints
        && oneDpTT(extraTT) === grade.extraPoints
        && sameItems(derived.restored, grade.restored)
        && sameItems(derived.failed, grade.failed)
        && sameItems(derived.cos, grade.cos)
        && sameItems(derived.new, grade.newItems)
        && sameItems(derived.unchecked, grade.unchecked)
        && sameItems([...narrativeItems], grade.narrativeItems);

    // Full text, no truncation — this is the detailed report card; the modal
    // body scrolls, so long observations are welcome.
    const textFor = (item) => {
        const dock = docks.get(item);
        if (dock && dock.texts.length) return dock.texts[0];
        for (const fup of followups) {      // new items: found by a re-check
            const hit = (fup.violations || []).find((v) => v.item === item && v.text);
            if (hit) return hit.text;
        }
        return '';
    };
    // Display membership is the PUBLISHED buckets; derived numbers decorate
    // them only when the reconcile passed.
    const publishedNarrative = new Set((grade.narrativeItems || []).map(Number));
    const journey = (bucket, items) => items.map(Number).map((item) => {
        const dock = docks.get(item);
        const row = {
            item, bucket, text: textFor(item),
            category: item <= RF_MAX_ITEM ? 'risk_factor' : 'grp',
            narrative: publishedNarrative.has(item),
            repeat: !!dock?.repeat, cosBase: !!dock?.cos,
            dockPts: null, delta: null,
        };
        if (verified && dock) {
            row.dockPts = oneDpTT(dock.pointsTT);
            if (bucket === 'restored') row.delta = oneDpTT(dock.pointsTT * 65 / 100);
            else if (bucket === 'failed') row.delta = oneDpTT(dock.fullTT * 3 / 2 - dock.pointsTT);
            else if (bucket === 'cos') row.delta = oneDpTT(dock.fullTT - dock.pointsTT);
        }
        if (verified && bucket === 'new') {
            const w = latestWord.get(item);
            let weightTT = item <= RF_MAX_ITEM ? W_RF_TT : W_GRP_TT;
            if (w?.repeat) weightTT = weightTT * 3 / 2;
            row.delta = oneDpTT(weightTT);
            row.repeat = !!w?.repeat;
        }
        return row;
    });

    const baseItems = [...docks].filter(([item]) => item != null)
        .sort((a, b) => a[0] - b[0])
        .map(([item, dock]) => ({
            item, category: item <= RF_MAX_ITEM ? 'risk_factor' : 'grp',
            repeat: dock.repeat, cos: dock.cos, count: dock.count,
            points: verified ? oneDpTT(dock.pointsTT) : null,
            text: dock.texts.length ? dock.texts[0] : '',
        }));

    // The ledger states the published triplet; `exact` decides whether the
    // round-once footnote appears (components are 1-dp receipts, the score
    // rounds once at the end — they may not visibly sum).
    const ledgerSum = Math.round(
        (grade.baseScore + grade.restoredPoints - grade.extraPoints) * 10) / 10;
    return {
        grade,
        verified,
        adjusted: !!g.adjusted,
        base: {
            found: !!base,
            inspectionId: base?.inspection_id || null,
            date: grade.baseDate || base?.date || null,
            score: grade.baseScore, letter: grade.baseLetter,
            violationCount: base ? (base.violations || []).length : null,
            rfCount: base ? (base.violations || [])
                .filter((v) => Number.isInteger(v.item) && v.item <= RF_MAX_ITEM).length : null,
            grpCount: base ? (base.violations || [])
                .filter((v) => !(Number.isInteger(v.item) && v.item <= RF_MAX_ITEM)).length : null,
            items: baseItems,
            itemless: itemless
                ? { count: itemless.count, points: verified ? oneDpTT(itemless.pointsTT) : null }
                : null,
        },
        followups: followupViews,
        journeys: {
            restored: journey('restored', grade.restored),
            failed: journey('failed', grade.failed),
            cos: journey('cos', grade.cos),
            new: journey('new', grade.newItems),
            unchecked: journey('unchecked', grade.unchecked),
        },
        ledger: {
            baseScore: grade.baseScore, baseLetter: grade.baseLetter,
            restored: grade.restoredPoints, added: grade.extraPoints,
            score: grade.score, letter: grade.letter,
            exact: ledgerSum === grade.score,
        },
    };
}

/** Pair the newest event with the one facility-level grade assessment. */
export function facilityPresentation(facility = {}) {
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
    // V3 carries one oldest-first compact event stream. Derive the
    // newest-first broad series here so storage never duplicates scores.
    const trend = (facility.trend || [])
        .filter((event) => event?.[0] === 'b' && Number.isFinite(event[2]))
        .map((event) => event[2])
        .reverse()
        .slice(0, 6);
    return {
        latest,
        assessment,
        assessmentRecord,
        grade: gradePresentation(facility),
        trend,
        declining: trend.length >= 2 && trend[0] < trend[1],
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

/** The roster marker's compact `trend` tuples → pseudo-inspections, NEWEST
 *  first (the order every real inspections array arrives in), so the hover
 *  card feeds the exact `_sparkline`/`buildScopeSeries` pipeline the detail
 *  panel uses — one renderer, two data sources, no parallel drawing code.
 *
 *  Tuple kinds (cf_export_site._trend_event, oldest-first on the wire):
 *      ["b", d, score, applicable, form]  broad — form gates breadth
 *      ["f", d, out, addressed, form]     focused — OUT/addressed ratio
 *      ["n", d, verdict(, items)]  adjudicated written verdict ◆
 *      ["u", d]                    scope-unknown baseline tick
 *  d = yyyymmdd int, 0 when unknown.
 *
 *  Each pseudo-inspection carries exactly the fields inspectionPresentation
 *  and narrativeVerdictPresentation read, nothing else. Degenerate stored
 *  scopes (a "b"/"f" whose count is null) degrade to the baseline tick here
 *  while the panel — which holds the real checklist rows — can still derive
 *  a count; that divergence is confined to pre-v2 straggler documents. */
export function trendInspections(trend = []) {
    const iso = (d) => {
        const s = String(d || '');
        return s.length === 8
            ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
    };
    const events = [];
    for (const t of Array.isArray(trend) ? trend : []) {
        if (!Array.isArray(t) || !t.length) continue;
        const [kind, d] = t;
        const date = iso(d);
        if (kind === 'b') {
            events.push({
                date, score: t[2] ?? null,
                applicable_item_count: t[3] ?? null,
                form_item_count: t[4] ?? t[3] ?? null,
                checklist_present: true,
            });
        } else if (kind === 'f') {
            events.push({
                date, score: null,
                addressed_item_count: t[3] ?? null,
                form_item_count: t[4] ?? t[3] ?? null,
                out_item_count: t[2] ?? null, checklist_present: true,
            });
        } else if (kind === 'n') {
            const adjudication = { status: 'adjudicated', verdict: t[2] || null };
            if (t[3] && typeof t[3] === 'object') adjudication.items = t[3];
            events.push({ date, checklist_present: false, adjudication });
        } else {
            events.push({ date, checklist_present: false });
        }
    }
    return events.reverse();
}

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Year-less date (M/D) for the toolbar's narrow freshness variant. The
// archive is always within the current year in practice, and the full
// variant (plus the tooltip) still carries the year.
function fmtDateShort(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Compact numeric date (M/D/YYYY) for the grade hero's provenance lines.
function fmtDateNum(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export class FoodDashboard {
    constructor(api) {
        this.api = api;
        // 'full' = complete inspection archive (authenticated channel);
        // 'lite' = the public finder payload — gray markers, name + address
        // + VDH link, no judgment surfaces. Set from the payload's mode.
        this._mode = 'full';
        this._loaded = false;
        this._map = null;
        this._mapReady = false;      // first style.load has run (source exists)
        this._styleIsDark = null;
        this._hoverPopup = null;
        this._hoverPid = null;       // permit under the open hover card
        this._geojson = null;        // last-built FeatureCollection (re-applied on style swaps)
        this._facilities = [];
        this._byPermit = new Map();
        this._counts = null;
        this._filters = {
            q: '', zip: '', grade: '',
            // "Restaurants only" — hide the permits nobody eats out at
            // (schools / daycares / care homes / hospitals / hotel breakfast
            // bars / caterers / commissaries / private clubs / camps).
            // Classified server-side as is_restaurant; persisted across reloads.
            restaurantsOnly: localStorage.getItem(RESTAURANTS_ONLY_KEY) === '1',
            // Hide non-active permits (Business Closed / Withdrawn / Expired /
            // Pending / etc.) by default — a "where to eat" map shows live
            // places, not closed pins wearing their last grade.
            showClosed: localStorage.getItem(SHOW_CLOSED_KEY) === '1',
            // Newly-permitted places (active, no broad assessment yet) plot blue
            // and show by default; the toggle lets a graded-only view hide them.
            // Default ON — a missing key means show.
            showNew: localStorage.getItem(SHOW_NEW_KEY) !== '0',
            // Mobile food units (trucks, carts, trailers) answer a different
            // question than the rest of the map: their pin is the permit's
            // filing address, not a place you can drive to tonight. Hidden by
            // default so the map stays "where can we eat"; the toggle brings
            // them back. Default OFF — a missing key means hide.
            showMobile: localStorage.getItem(SHOW_MOBILE_KEY) === '1',
        };
        this._viewMode = 'map';     // 'map' | 'list' | 'about'
        this._sort = { key: 'score', dir: 'asc' };  // list sort — worst-first default
        this._selectedPermit = null;
        this._searchDebounce = null;
        this._mapNote = null;       // locate-feedback notice over the map
        this._geolocate = null;     // the GeolocateControl instance
        this._geoFollowing = false; // camera locked to the user's position?
        this._receiptHost = null;   // grade-receipt modal DOM (body-appended)
        this._receiptTrigger = null; // button to restore focus to on close
        this._receiptKeydown = null;
        this._receiptFocusin = null;
    }

    init() {
        const search = document.getElementById('foodSearch');
        search?.addEventListener('input', () => {
            clearTimeout(this._searchDebounce);
            this._searchDebounce = setTimeout(() => {
                this._filters.q = (search.value || '').trim().toLowerCase();
                this._rebuildMarkers();
            }, 150);
        });

        document.getElementById('foodZipFilter')?.addEventListener('change', (e) => {
            this._filters.zip = e.target.value;
            this._rebuildMarkers();
        });

        document.getElementById('foodGradeChips')
            ?.querySelectorAll('button[data-grade]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._filters.grade = btn.dataset.grade;
                    document.querySelectorAll('#foodGradeChips button').forEach(
                        (b) => b.classList.toggle('active', b === btn));
                    this._rebuildMarkers();
                });
            });

        const restaurantsToggle = document.getElementById('foodRestaurantsOnly');
        if (restaurantsToggle) {
            restaurantsToggle.checked = this._filters.restaurantsOnly;
            restaurantsToggle.addEventListener('change', () => {
                this._filters.restaurantsOnly = restaurantsToggle.checked;
                try {
                    localStorage.setItem(RESTAURANTS_ONLY_KEY,
                        restaurantsToggle.checked ? '1' : '0');
                } catch (_) { /* private mode */ }
                this._rebuildMarkers();
            });
        }

        const closedToggle = document.getElementById('foodShowClosed');
        if (closedToggle) {
            closedToggle.checked = this._filters.showClosed;
            closedToggle.addEventListener('change', () => {
                this._filters.showClosed = closedToggle.checked;
                try {
                    localStorage.setItem(SHOW_CLOSED_KEY,
                        closedToggle.checked ? '1' : '0');
                } catch (_) { /* private mode */ }
                this._rebuildMarkers();
            });
        }

        const newToggle = document.getElementById('foodShowNew');
        if (newToggle) {
            newToggle.checked = this._filters.showNew;
            newToggle.addEventListener('change', () => {
                this._filters.showNew = newToggle.checked;
                try {
                    localStorage.setItem(SHOW_NEW_KEY,
                        newToggle.checked ? '1' : '0');
                } catch (_) { /* private mode */ }
                this._rebuildMarkers();
            });
        }

        const mobileToggle = document.getElementById('foodShowMobile');
        if (mobileToggle) {
            mobileToggle.checked = this._filters.showMobile;
            mobileToggle.addEventListener('change', () => {
                this._filters.showMobile = mobileToggle.checked;
                try {
                    localStorage.setItem(SHOW_MOBILE_KEY,
                        mobileToggle.checked ? '1' : '0');
                } catch (_) { /* private mode */ }
                this._rebuildMarkers();
            });
        }

        // View toggle (Map | List | About)
        document.getElementById('foodViewToggle')
            ?.querySelectorAll('button[data-view]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const view = btn.dataset.view;
                    this._setView(view);
                    // About is a document, not a pane: send it back to the top
                    // and put focus on its title so keyboard and screen-reader
                    // users land in the content rather than wherever the last
                    // view left them. This used to hang off the footer's
                    // methodology link — the only [data-view-link] on the page
                    // — so it moved here when the footer shed it.
                    if (view === 'about') {
                        const wrap = document.getElementById('foodAboutWrap');
                        if (wrap) wrap.scrollTop = 0;
                        requestAnimationFrame(() => {
                            document.getElementById('foodAboutTitle')?.focus({ preventScroll: true });
                        });
                    }
                });
            });

        if (window.location.hash.toLowerCase() === '#about') this._setView('about', false);

        // List sort headers — click to sort, click again to flip direction
        document.getElementById('foodListTable')
            ?.querySelectorAll('th[data-sort]').forEach((th) => {
                th.addEventListener('click', () => {
                    const k = th.dataset.sort;
                    if (this._sort.key === k) this._sort.dir = this._sort.dir === 'asc' ? 'desc' : 'asc';
                    else this._sort = { key: k, dir: 'asc' };
                    this._rebuildList();
                });
            });

        // Restyle the basemap when the body's theme class changes.
        new MutationObserver(() => this._applyTheme())
            .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    /** Kick off the first load once the page is ready. */
    load() {
        if (!this._loaded) {
            this._loaded = true;
            this.refresh();
        } else if (this._map) {
            setTimeout(() => this._map.resize(), 50);
        }
    }

    async refresh() {
        const countsEl = document.getElementById('foodCounts');
        if (countsEl) countsEl.textContent = 'Loading…';

        const payload = await this.api.getFoodFacilities();
        if (!payload || !payload.available) {
            const reason = payload?.reason || payload?.error || 'data unreachable';
            if (countsEl) countsEl.textContent = `Unavailable — ${reason}`;
            this._updateAboutUnavailable();
            const mapEl = document.getElementById('foodMap');
            if (mapEl && !this._map) {
                mapEl.innerHTML = `<div class="food-map-error p-4 text-muted">`
                    + `Inspection data unavailable: ${esc(reason)}.</div>`;
            }
            return;
        }

        const lite = payload.mode === 'lite';
        if (lite !== (this._mode === 'lite')) {
            this._mode = lite ? 'lite' : 'full';
            // Lite has no scores to sort by — fall back to name.
            if (lite && this._sort.key === 'score') this._sort = { key: 'name', dir: 'asc' };
        }
        document.body.classList.toggle('food-mode-lite', lite);
        // The sign-in affordance only makes sense when there's something
        // more to sign in TO.
        document.getElementById('signInBtn')?.classList.toggle('d-none', !lite);

        this._facilities = payload.facilities || [];
        this._byPermit = new Map(this._facilities.map((f) => [f.permit_id, f]));
        this._counts = payload.counts || null;

        const fetchedEl = document.getElementById('foodFetchedAt');
        if (fetchedEl) {
            const snap = payload.fetched_at ? payload.fetched_at.slice(0, 10) : null;
            // Keep publication time and source-record recency distinct:
            // export generation does not mean every report is that new.
            // Lite ships no inspection dates, so it states snapshot alone.
            let latest = null;
            if (!lite) {
                const dates = this._facilities.map((f) => f.latest?.date).filter(Boolean);
                latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
            }
            this._renderFreshness(fetchedEl, snap, latest);
        }

        // Coverage in the footer is the ZIP count alone. The facility total
        // was redundant with the toolbar pill, which states it live against
        // the active filters; About carries both for the record.
        const coverageEl = document.getElementById('foodCoverage');
        if (coverageEl && this._counts) {
            const zips = Object.keys(this._counts.by_zip || {}).filter((z) => z !== '?').length;
            coverageEl.textContent = ` · ${zips} ${zips === 1 ? 'ZIP' : 'ZIPs'}`;
        }

        this._updateAboutStatus(payload, lite);

        this._populateZipFilter();
        this._ensureMap();
        // If the map predates a mode flip, restyle the cluster tint to match.
        if (this._mapReady) {
            this._map.setPaintProperty(LYR_CLUSTERS, 'circle-color', this._clusterColors());
        }
        this._rebuildMarkers();
    }

    // ── map plumbing ────────────────────────────────────────────────────

    _isDark() {
        return document.body.classList.contains('theme-dark');
    }

    _ensureMap() {
        if (this._map) return;
        if (typeof maplibregl === 'undefined') {
            const countsEl = document.getElementById('foodCounts');
            if (countsEl) countsEl.textContent = 'MapLibre failed to load (CDN unreachable?)';
            return;
        }
        const mapEl = document.getElementById('foodMap');
        if (!mapEl) return;
        mapEl.innerHTML = '';

        const dark = this._isDark();
        this._styleIsDark = dark;
        this._map = new maplibregl.Map({
            container: 'foodMap',
            style: dark ? STYLE_DARK : STYLE_LIGHT,
            bounds: VA_BOUNDS,
            fitBoundsOptions: VA_FIT,
            maxZoom: 19,
        });
        this._map.addControl(
            new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
        // "Find me" — browser geolocation. Drops the blue dot + accuracy
        // circle (DOM markers, so they survive theme style-swaps) and follows
        // until the user pans away. The control self-disables at add time
        // when the permissions probe says geolocation is unavailable
        // (insecure origin, prior denial); the colored error states only
        // happen when a position request fails after a successful add.
        const geolocate = new maplibregl.GeolocateControl({
            // Full object on purpose — the control's option merge is shallow,
            // so a partial one would silently drop these. The 6s timeout keeps
            // a MANUAL button press snappy: it's a deliberate ask, so a genuine
            // failure earns the error note quickly. maximumAge lets the control
            // reuse the fix auto-locate just acquired (see _autoLocate) rather
            // than firing a second lookup on the programmatic hand-off.
            positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 },
            trackUserLocation: true,
            // Land at neighborhood radius: clusters dissolve above zoom 12,
            // and CARTO's 512px tiles render ~1 zoom tighter than usual —
            // the library-default 15 would frame a couple of residential
            // blocks with zero markers in them.
            fitBoundsOptions: { maxZoom: 13 },
        });
        geolocate.on('geolocate', (pos) => this._onGeolocate(pos));
        geolocate.on('error', () => this._showMapNote(
            'We couldn\'t find your location. Check that location access is on for your browser.'));
        // Follow-mode bookkeeping via the control's public events: the
        // coverage note's back-link must know whether to switch the control
        // off before moving the camera (see _showMapNote).
        this._geolocate = geolocate;
        geolocate.on('trackuserlocationstart', () => { this._geoFollowing = true; });
        geolocate.on('userlocationfocus', () => { this._geoFollowing = true; });
        geolocate.on('trackuserlocationend', () => { this._geoFollowing = false; });
        geolocate.on('userlocationlostfocus', () => { this._geoFollowing = false; });
        this._map.addControl(geolocate, 'top-left');
        this._autoLocate();

        // Fires on the initial style AND after every setStyle (theme swap) —
        // custom sources/layers don't survive a style swap, so this is the
        // one place they're (re-)installed.
        this._map.on('style.load', () => this._installDataLayers());

        this._bindMapInteractions();

        // The container may have been zero-sized at construction (hidden
        // tab, flex height not yet resolved), which would bake a wrong zoom
        // into the bounds fit. Resize to the real dimensions, then re-fit the
        // state to them once — unless a location fix has already claimed the
        // camera, in which case the visitor's own view wins.
        setTimeout(() => {
            this._map.resize();
            if (!this._geoFollowing) this._map.fitBounds(VA_BOUNDS, { ...VA_FIT, duration: 0 });
        }, 50);
    }

    /** Ask for the visitor's location on open instead of waiting for a
     *  button press — a finder map should start from where they stand.
     *  First visit surfaces the browser's permission prompt; a standing
     *  grant flies straight to their neighborhood. */
    async _autoLocate() {
        // A standing denial renders the control disabled, but trigger()
        // has no disabled-check — it would still fire a doomed request.
        // Probe and stay quiet.
        try {
            const perm = await navigator.permissions.query({ name: 'geolocation' });
            if (perm.state === 'denied') return;
        } catch (_) { /* no Permissions API — the request below finds out */ }
        // Auto-locate is unsolicited and best-effort, so it runs its OWN
        // request rather than the control's, for two reasons:
        //  1. A patient timeout. The browser counts the seconds the permission
        //     prompt sits unanswered against this timeout, so it has to cover
        //     human decision time — not just fix latency. 20s means a visitor
        //     who takes a beat to click Allow still gets flown in, where the
        //     control's snappy 6s would have "timed out" mid-decision.
        //  2. Silence on every failure — denial, timeout, no signal. Nobody
        //     asked to be located and the statewide map stands on its own, so
        //     a miss just leaves it be. The error note is reserved for a
        //     manual button press (a deliberate ask), which keeps the 6s.
        // On success the control takes over to draw the dot and follow; it
        // reuses this just-acquired fix via its maximumAge (no second lookup).
        navigator.geolocation?.getCurrentPosition(
            () => {
                // The control finishes its own setup async (same permissions
                // probe); trigger() returns false until then.
                const kick = (attemptsLeft) => {
                    if (this._geolocate?.trigger() || attemptsLeft <= 0) return;
                    setTimeout(() => kick(attemptsLeft - 1), 200);
                };
                kick(10);
            },
            () => { /* silent: unsolicited, and the map already shows the state */ },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
        );
    }

    /** Add the facilities source + cluster/point layers to the CURRENT style.
     *  Idempotent per style — style.load hands us a bare basemap each time. */
    _installDataLayers() {
        if (!this._map || this._map.getSource(SRC)) return;
        this._mapReady = true;

        this._map.addSource(SRC, {
            type: 'geojson',
            data: this._geojson || { type: 'FeatureCollection', features: [] },
            // Bubbles dissolve as you zoom in: grouped at metro view, plain
            // dots from neighborhood zoom up.
            cluster: true,
            clusterMaxZoom: 12,
            clusterRadius: 40,
        });

        // Cluster bubbles — sized/tinted by member count. In lite the tint
        // stays neutral: on a gray finder map, green/orange bubbles would
        // read as judgment.
        this._map.addLayer({
            id: LYR_CLUSTERS,
            type: 'circle',
            source: SRC,
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': this._clusterColors(),
                'circle-radius': ['step', ['get', 'point_count'],
                    12, 10, 16, 50, 22],
                'circle-opacity': 0.85,
                'circle-stroke-width': 4,
                'circle-stroke-color': 'rgba(255, 255, 255, 0.35)',
            },
        });
        this._map.addLayer({
            id: LYR_CLUSTER_COUNT,
            type: 'symbol',
            source: SRC,
            filter: ['has', 'point_count'],
            layout: {
                'text-field': '{point_count_abbreviated}',
                // Must exist in the CARTO glyphs endpoint (both positron and
                // dark-matter carry the Montserrat stack).
                'text-font': ['Montserrat Regular'],
                'text-size': 12,
                'text-allow-overlap': true,
            },
            paint: { 'text-color': '#212529' },
        });

        // Individual facilities — all paint channels are per-feature
        // properties baked in _toGeoJSON (grade fill, declining ring, closed
        // grey+dim).
        this._map.addLayer({
            id: LYR_POINTS,
            type: 'circle',
            source: SRC,
            filter: ['!', ['has', 'point_count']],
            paint: {
                // 7px circles are sub-finger touch targets — bump on
                // coarse-pointer devices; tap→detail stays the primary path.
                'circle-radius': window.matchMedia('(pointer: coarse)').matches ? 10 : 7,
                'circle-color': ['get', 'fill'],
                'circle-opacity': ['get', 'fillOpacity'],
                'circle-stroke-color': ['get', 'stroke'],
                'circle-stroke-width': ['get', 'strokeW'],
            },
        });
    }

    /** One-time delegated event wiring. MapLibre keys these by layer id, so
     *  they survive style swaps (they just idle while the layer is absent). */
    _bindMapInteractions() {
        const map = this._map;
        const coarse = window.matchMedia('(pointer: coarse)').matches;

        // Marker-bound hover preview (skipped on touch devices — tap opens the
        // detail panel directly). The popup is display-only and mouse-
        // transparent: leaving the marker removes it immediately. Full tier
        // still renders the grade hero from the roster's `trend` payload, but
        // interactive trend/receipt behavior belongs only to the clicked panel.
        if (!coarse) {
            this._hoverPopup = new maplibregl.Popup({
                closeButton: false, closeOnClick: false,
                offset: 12, maxWidth: '280px',
                className: 'food-tip',
            });
            map.on('mousemove', LYR_POINTS, (e) => {
                const feat = e.features?.[0];
                const f = feat && this._byPermit.get(feat.properties.pid);
                if (!f) return;
                map.getCanvas().style.cursor = 'pointer';
                // Same facility → leave the card alone. Re-rendering on every
                // mousemove is needless work while the pointer stays on its
                // marker.
                if (this._hoverPid === f.permit_id) return;
                this._showHoverCard(feat.geometry.coordinates.slice(), f);
            });
            map.on('mouseleave', LYR_POINTS, () => {
                map.getCanvas().style.cursor = '';
                this._hideHoverCard();
            });
            map.on('mouseenter', LYR_CLUSTERS, () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', LYR_CLUSTERS, () => {
                map.getCanvas().style.cursor = '';
            });
        }

        map.on('click', LYR_POINTS, (e) => {
            const feat = e.features?.[0];
            const f = feat && this._byPermit.get(feat.properties.pid);
            if (f) {
                this._hideHoverCard();   // the panel takes over
                this._select(f);
            }
        });

        // Cluster click → zoom to the level where it breaks apart
        // (getClusterExpansionZoom is Promise-based in MapLibre).
        map.on('click', LYR_CLUSTERS, async (e) => {
            const feat = e.features?.[0];
            if (!feat) return;
            this._hideHoverCard();   // the anchor marker is about to dissolve
            try {
                const zoom = await map.getSource(SRC)
                    .getClusterExpansionZoom(feat.properties.cluster_id);
                map.easeTo({ center: feat.geometry.coordinates, zoom: zoom + 0.5 });
            } catch (_) { /* cluster dissolved mid-click */ }
        });
    }

    // ── marker-bound hover card ────────────────────────────────────────
    _hideHoverCard() {
        this._hoverPid = null;
        this._hoverPopup?.remove();
    }

    _showHoverCard(lngLat, f) {
        const popup = this._hoverPopup;
        if (!popup) return;
        this._hoverPid = f.permit_id;
        const lite = this._mode === 'lite';
        // Lite keeps the slim name+address tip; the hero card needs the room.
        popup.setMaxWidth(lite ? '280px' : '380px');
        popup.setLngLat(lngLat).setHTML(this._hoverCardHTML(f)).addTo(this._map);
    }

    // ── locate feedback ─────────────────────────────────────────────────

    /** Padded bounding box of the loaded facilities — "the mapped area". */
    _coverageBounds() {
        let n = -90, s = 90, e = -180, w = 180;
        for (const f of this._facilities) {
            const { lat, lon } = f.location || {};
            if (lat == null || lon == null) continue;
            n = Math.max(n, lat); s = Math.min(s, lat);
            e = Math.max(e, lon); w = Math.min(w, lon);
        }
        if (n < s) return null;   // nothing located yet
        const PAD = 0.2;          // ~20 km — near-edge users still see markers
        return { n: n + PAD, s: s - PAD, e: e + PAD, w: w - PAD };
    }

    /** Tell out-of-coverage visitors why the map around them is empty —
     *  and hand them a way back — instead of stranding them on a blank
     *  basemap. */
    _onGeolocate(pos) {
        const { latitude: lat, longitude: lon } = pos.coords;
        const b = this._coverageBounds();
        if (!b || (lat <= b.n && lat >= b.s && lon <= b.e && lon >= b.w)) {
            this._hideMapNote();
            return;
        }
        this._showMapNote(
            'This map only covers Virginia, and you\'re outside it.',
            true);
    }

    /** Small dismissible notice over the map. Static strings only — the
     *  markup goes through innerHTML. */
    _showMapNote(text, withReturnLink = false) {
        const wrap = document.getElementById('foodMapWrap');
        if (!wrap) return;
        if (this._mapNote?.dataset.note === text) return;   // already showing
        this._hideMapNote();
        const note = document.createElement('div');
        note.className = 'food-map-note';
        note.dataset.note = text;
        note.innerHTML = '<button type="button" class="btn-close" aria-label="Dismiss"></button>'
            + `<span>${text}</span>`
            + (withReturnLink ? '<button type="button" class="food-map-note-back">Back to Virginia</button>' : '');
        note.querySelector('.btn-close')
            .addEventListener('click', () => this._hideMapNote());
        note.querySelector('.food-map-note-back')?.addEventListener('click', () => {
            // A zoom-changing camera move (fitBounds included) does NOT drop
            // the control's follow lock (its movestart handler skips zooming
            // moves), so switch the control off first — otherwise the next
            // fix flies the camera right back out of coverage.
            if (this._geoFollowing) this._geolocate?.trigger();
            this._map?.fitBounds(VA_BOUNDS, VA_FIT);
            this._hideMapNote();
        });
        wrap.appendChild(note);
        this._mapNote = note;
    }

    _hideMapNote() {
        this._mapNote?.remove();
        this._mapNote = null;
    }

    _clusterColors() {
        if (this._mode === 'lite') {
            return ['step', ['get', 'point_count'],
                '#9aa1a9', 10, '#8b929b', 50, '#7d848d'];
        }
        return ['step', ['get', 'point_count'],
            '#6ecc39', 10, '#f0c20c', 50, '#f18017'];
    }

    _applyTheme() {
        if (!this._map || typeof maplibregl === 'undefined') return;
        const dark = this._isDark();
        if (this._styleIsDark === dark) return;
        this._styleIsDark = dark;
        this._mapReady = false;   // source dies with the old style
        // style.load re-installs the data layers over the new basemap.
        this._map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT);
    }

    // Active = a live permit. Anything else (Business Closed / Withdrawn /
    // Expired / Pending / *Closure / Suspended / Surrendered) is "closed".
    _isActive(f) {
        return (f.status || '').toLowerCase().includes('permitted');
    }

    // Newly permitted = the exporter's authoritative flag: active + no grade +
    // a pre-opening on record + no routine/risk-factor inspection + zero
    // violations. "No grade" alone is NOT enough — an unparsed routine that
    // carries violations must never read as "cleared to open" (see cf_export_site
    // _newly_permitted). Absent flag (older payload) degrades safely to false.
    _isNew(f) {
        return f.newly_permitted === true;
    }

    // Mobile food unit = VDH's permit type, verbatim from the exporter. Matched
    // lowercase-substring (same idiom as _isActive) so a VDH pluralization or
    // class suffix still lands; no other permit type contains "mobile food".
    // Lite records carry no permit_type but DO carry the exporter's `mobile`
    // boolean (the same predicate, applied at export time) — so the switch
    // works on both tiers off this one test.
    _isMobileUnit(f) {
        return f.mobile === true
            || (f.permit_type || '').toLowerCase().includes('mobile food');
    }

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
    }

    // Marker fill = the facility grade color. (`gradeColor` is the data palette.)
    _markerColor(f) {
        return gradeColor(facilityPresentation(f).grade?.letter || null);
    }

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
    }

    /** Filtered facilities → FeatureCollection with per-feature paint props. */
    _toGeoJSON(filtered) {
        const lite = this._mode === 'lite';
        const features = [];
        for (const f of filtered) {
            const { lat, lon } = f.location || {};
            if (lat == null || lon == null) continue;
            // Closed permits (shown only when "Show closed" is on) plot greyed
            // + dimmed so they read as not-currently-open at a glance.
            const active = lite || this._isActive(f);
            const declining = !lite && facilityPresentation(f).declining;
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: {
                    pid: f.permit_id,
                    // Lite is the finder view: every marker a uniform neutral —
                    // the map locates places, it doesn't judge them. Full tier:
                    // graded → grade color, newly-permitted → blue, closed → gray.
                    fill: lite ? '#8d939c'
                        : !active ? '#9aa0a6'
                            : this._isNew(f) ? NEW_COLOR : this._markerColor(f),
                    fillOpacity: active ? 0.88 : 0.42,
                    // declining facilities get a heavier warning ring on any color-mode.
                    stroke: !active ? 'rgba(130, 130, 130, 0.55)'
                        : declining ? GRADE_COLORS.F : 'rgba(20, 20, 20, 0.55)',
                    strokeW: declining ? 2.5 : 1.5,
                },
            });
        }
        return { type: 'FeatureCollection', features };
    }

    _rebuildMarkers() {
        if (this._viewMode === 'list') { this._rebuildList(); return; }
        if (!this._map) return;
        // A filter flip can remove the very marker the open card anchors to;
        // don't leave the card floating over nothing.
        this._hideHoverCard();

        const filtered = this._facilities.filter((f) => this._matchesFilters(f));
        this._geojson = this._toGeoJSON(filtered);
        // If a style swap is mid-flight the source is briefly absent —
        // style.load re-installs it with this._geojson as its data.
        if (this._mapReady) this._map.getSource(SRC)?.setData(this._geojson);
        this._updateCounts(filtered.length);
    }

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
    }

    // Freshness reads at two lengths: the full phrasing where the footer has
    // room, a trimmed one under 1500px (CSS picks — see .food-freshness).
    // Both stay in the DOM so the swap is layout-only, no re-render on resize.
    _renderFreshness(el, snapshotIso, latestIso) {
        if (!snapshotIso && !latestIso) {
            el.innerHTML = '';
            el.removeAttribute('title');
            return;
        }
        const full = [];
        const short = [];
        if (snapshotIso) {
            full.push(`snapshot ${fmtDate(snapshotIso)}`);
            short.push(`snap ${fmtDateShort(snapshotIso)}`);
        }
        if (latestIso) {
            full.push(`newest report ${fmtDate(latestIso)}`);
            short.push(`report ${fmtDateShort(latestIso)}`);
        }
        el.innerHTML = `<span class="food-freshness-full">${esc(full.join(' · '))}</span>`
            + `<span class="food-freshness-short">${esc(short.join(' · '))}</span>`;
        // The tooltip always spells out the distinction the short form drops.
        // In the footer the label never hides outright — it wraps to its own
        // row instead — so the hover target survives at every width. About
        // still states both dates in full as the durable record.
        el.title = [
            snapshotIso ? `Archive snapshot published ${fmtDate(snapshotIso)}` : null,
            latestIso ? `Newest inspection report in it: ${fmtDate(latestIso)}` : null,
        ].filter(Boolean).join('\n');
    }

    _updateAboutStatus(payload, lite) {
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        const zips = Object.keys(this._counts?.by_zip || {}).filter((z) => z !== '?').length;
        const total = this._counts?.total ?? this._facilities.length;
        const dates = this._facilities.map((f) => f.latest?.date).filter(Boolean);
        const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
        const snapshot = payload.fetched_at ? fmtDate(payload.fetched_at.slice(0, 10)) : 'Not recorded';

        setText('aboutTierLabel', lite ? 'Public finder' : 'Authenticated archive');
        setText('aboutTierDetail', lite
            ? 'Identity, geocoded location, and retained permit ID'
            : 'Inspection histories plus CleanPlateVA-derived signals');
        setText('aboutSnapshotDate', snapshot);
        const totalNumber = Number(total || 0);
        setText('aboutCoverageCount', `${totalNumber.toLocaleString()} `
            + `${totalNumber === 1 ? 'facility' : 'facilities'} · ${zips} ${zips === 1 ? 'ZIP' : 'ZIPs'}`);
        setText('aboutLatestDate', latest ? fmtDate(latest) : (lite ? 'Not exposed publicly' : 'No dated report'));
    }

    _updateAboutUnavailable() {
        const values = {
            aboutTierLabel: 'Data unavailable',
            aboutTierDetail: 'Methodology remains available; try refresh',
            aboutSnapshotDate: 'Unavailable',
            aboutCoverageCount: 'Unavailable',
            aboutLatestDate: 'Unavailable',
        };
        Object.entries(values).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
    }

    _setView(mode, syncHash = true) {
        if (!['map', 'list', 'about'].includes(mode)) return;
        this._viewMode = mode;
        document.querySelectorAll('#foodViewToggle button[data-view]').forEach((b) => {
            b.classList.toggle('active', b.dataset.view === mode);
            b.setAttribute('aria-pressed', String(b.dataset.view === mode));
        });
        document.getElementById('foodMapWrap')?.classList.toggle('d-none', mode !== 'map');
        document.getElementById('foodListWrap')?.classList.toggle('d-none', mode !== 'list');
        document.getElementById('foodAboutWrap')?.classList.toggle('d-none', mode !== 'about');
        document.body.classList.toggle('food-view-list', mode === 'list');
        document.body.classList.toggle('food-view-about', mode === 'about');
        if (syncHash && window.history?.replaceState) {
            const hash = mode === 'about' ? '#about' : '';
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
        }
        if (mode === 'map') {
            setTimeout(() => this._map?.resize(), 60);
            this._rebuildMarkers();
        } else if (mode === 'list') {
            this._rebuildList();
        }
    }


    _rebuildList() {
        const body = document.getElementById('foodListBody');
        if (!body) return;
        const filtered = this._facilities.filter((f) => this._matchesFilters(f));
        const { key, dir } = this._sort;
        const val = (f) => {
            const lt = f.latest || {};
            const fp = facilityPresentation(f);
            const assessment = fp.assessmentRecord || {};
            switch (key) {
                case 'address': return `${f.address || ''} ${f.address2 || ''}`.trim().toLowerCase();
                case 'name': return (f.name || '').toLowerCase();
                case 'zip': return f.zip || '';
                case 'score': return fp.grade?.score ?? -1;
                case 'compliance': return assessment.compliance_rate ?? -1;
                case 'trend': return fp.trend.length >= 2 ? fp.trend[0] - fp.trend[1] : 0;
                case 'date': return lt.date || '';
                default: return 0;
            }
        };
        filtered.sort((a, b) => {
            const va = val(a), vb = val(b);
            if (va < vb) return dir === 'asc' ? -1 : 1;
            if (va > vb) return dir === 'asc' ? 1 : -1;
            return 0;
        });
        const CAP = 600;
        const rows = filtered.slice(0, CAP);
        body.innerHTML = rows.map((f) => {
            const lt = f.latest || {};
            const fp = facilityPresentation(f);
            const latest = fp.latest;
            const g = fp.grade;
            const assessmentRecord = fp.assessmentRecord || {};
            const address = [f.address, f.address2].filter(Boolean).join(' ');
            const t = fp.trend;
            const arrow = t.length >= 2 ? (t[0] < t[1] ? '▼' : t[0] > t[1] ? '▲' : '▬') : '';
            const tcol = t.length >= 2 ? '#228be6' : '';
            // Focused rows carry the OUT ratio only — no raw score. See the
            // note in `_tooltipHTML`.
            const eventLine = latest.scope === 'focused'
                ? `Latest: focused · ${focusedOutcomePresentation(latest).label}`
                : latest.scope === 'broad'
                    ? `Latest: broad · ${latest.count ?? '?'} items`
                    : 'Latest: checklist scope unavailable';
            const rowCls = [this._selectedPermit === f.permit_id ? 'sel' : '',
                (this._mode === 'lite' || this._isActive(f)) ? '' : 'food-closed'].filter(Boolean).join(' ');
            return `<tr data-permit="${esc(f.permit_id)}"${rowCls ? ` class="${rowCls}"` : ''}>
                <td class="food-list-col-address">${esc(address)}</td>
                <td class="food-list-name food-list-col-name">${esc(f.name)}<span class="food-list-event food-list-full-only">${esc(eventLine)}</span></td>
                <td class="food-list-col-zip">${esc(f.zip || '')}</td>
                <td class="food-list-full-only food-list-col-score">${g ? `<span class="food-list-score" style="background:${gradeColor(g.letter)}" title="${g.adjusted
                    ? `Grade after ${g.followups} follow-up${g.followups === 1 ? '' : 's'} · from broad ${esc(g.baseScore)}${assessmentRecord.date ? ` on ${esc(fmtDate(assessmentRecord.date))}` : ''}`
                    : assessmentRecord.date ? `Grade from the broad inspection on ${esc(fmtDate(assessmentRecord.date))}` : 'Facility grade'}">${esc(g.letter)} ${esc(g.score)}</span>`
                    : this._isNew(f)
                        ? '<span class="food-list-score food-list-score-new" title="Newly permitted; grade pending a broad inspection">NEW</span>'
                        : '<span class="food-list-score food-list-score-none" title="No broad inspection captured">—</span>'}</td>
                <td class="food-list-full-only food-list-col-compliance">${assessmentRecord.compliance_rate != null ? Math.round(assessmentRecord.compliance_rate * 100) + '%' : '—'}</td>
                <td class="food-list-full-only food-list-col-trend" style="color:${tcol}">${arrow || '—'}</td>
                <td class="food-list-date food-list-full-only food-list-col-date">${fmtDate(lt.date)}</td>
                <td class="food-list-col-vdh"><a class="food-list-vdh-link" href="${permitUrl(f)}" target="_blank" rel="noopener" aria-label="View ${esc(f.name)} on VDH" title="View ${esc(f.name)} on VDH"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a></td>
            </tr>`;
        }).join('') + (filtered.length > CAP
            ? `<tr class="food-list-more"><td colspan="${this._mode === 'lite' ? 4 : 8}">Showing first ${CAP} of ${filtered.length} — narrow the filters to see the rest.</td></tr>` : '');
        body.querySelectorAll('tr[data-permit]').forEach((tr) => {
            tr.addEventListener('click', (event) => {
                // The VDH link is its own destination; don't also open the
                // facility detail panel when the click bubbles to the row.
                if (event.target.closest('a')) return;
                const f = this._facilities.find((x) => x.permit_id === tr.dataset.permit);
                if (f) this._select(f);
            });
        });
        document.querySelectorAll('#foodListTable th[data-sort]').forEach((th) => {
            const on = th.dataset.sort === key;
            th.classList.toggle('sorted', on);
            th.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
        });
        this._updateCounts(filtered.length);
    }

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
    }

    // ── detail panel ────────────────────────────────────────────────────

    async _select(f) {
        this._closeReceipt();   // a stale receipt must not outlive its facility
        this._selectedPermit = f.permit_id;
        const panel = document.getElementById('foodDetail');
        const inner = document.getElementById('foodDetailInner');
        if (!panel || !inner) return;
        panel.classList.remove('d-none');
        setTimeout(() => this._map?.resize(), 60);

        // Lite: everything shown is already in the roster record — render
        // locally and hand off to the official VDH page for the substance.
        if (this._mode === 'lite') {
            inner.innerHTML = this._renderLiteDetail(f);
            inner.querySelector('.food-detail-close')
                ?.addEventListener('click', () => this._closeDetail());
            if (this._viewMode === 'list') this._rebuildList();
            return;
        }

        inner.innerHTML = `<div class="p-3 text-muted">Loading ${esc(f.name)}…</div>`;

        const detail = await this.api.getFoodFacilityDetail(f.permit_id);
        if (this._selectedPermit !== f.permit_id) return;  // user clicked away
        if (!detail || !detail.available) {
            inner.innerHTML = `<div class="p-3 text-muted">Failed to load: `
                + `${esc(detail?.reason || detail?.error || 'unknown')}</div>`;
            return;
        }
        inner.innerHTML = this._renderDetail(detail.facility, detail.inspections);
        inner.querySelector('.food-detail-close')
            ?.addEventListener('click', () => this._closeDetail());
        // The per-inspection report link lives inside the <summary>; keep a click
        // on it from also toggling the row open/closed.
        inner.querySelectorAll('.food-insp-report').forEach((a) =>
            a.addEventListener('click', (e) => e.stopPropagation()));
        this._bindSparkline(inner, detail.inspections);
        this._bindGradeReceipt(inner, detail.facility, detail.inspections);
    }

    _closeDetail() {
        this._closeReceipt();
        this._selectedPermit = null;
        document.getElementById('foodDetail')?.classList.add('d-none');
        setTimeout(() => this._map?.resize(), 60);
    }

    /** Lite detail panel: identity + the hand-off to the official record. */
    _renderLiteDetail(f) {
        const geoNote = this._geoNote(f.location?.source);
        const siteNote = this._sharedSiteNote(f.location);
        return `
            <div class="food-detail-head">
                <div class="food-detail-title">
                    <h5>${esc(f.name)}</h5>
                    <button type="button" class="btn-close food-detail-close" aria-label="Close"></button>
                </div>
                <div class="text-muted small">
                    ${esc(f.address)}${f.address2 ? ' ' + esc(f.address2) : ''}${f.city ? ', ' + esc(f.city) : ''}, VA ${esc(f.zip || '')}
                    ${geoNote}
                </div>
                ${siteNote}
            </div>
            <div class="food-lite-cta">
                <a class="btn btn-sm btn-primary" target="_blank" rel="noopener"
                   href="${permitUrl(f)}">
                    View inspections on VDH <i class="bi bi-box-arrow-up-right"></i>
                </a>
                <div class="text-muted small mt-2">
                    Inspection reports live on the official VDH portal — this map is a finder.
                </div>
            </div>`;
    }

    _geoNote(source) {
        // Rooftop-quality geocode sources get no flag.
        if (source === 'zip_centroid') {
            return '<span class="food-approx" title="Address didn\'t geocode — marker sits at the ZIP centroid, not the building">≈ ZIP-centroid</span>';
        }
        if (source === 'census_batch' || source === 'census_oneline') {
            return '<span class="food-approx food-approx-street" title="Street-level only (Census centerline) — pin may sit ~50 m off, on the road rather than the building">≈ street-level</span>';
        }
        return '';
    }

    _sharedSiteNote(location) {
        const count = Number(location?.site_count);
        if (!Number.isInteger(count) || count < 2) return '';
        return `<div class="text-muted small food-shared-site">This physical site is shared by ${count} facility records.</div>`;
    }

    _renderDetail(fac, inspections) {
        const latest = inspections[0] || null;
        const latestView = inspectionPresentation(latest);
        const geoNote = this._geoNote(fac.location?.source);
        const siteNote = this._sharedSiteNote(fac.location);
        const sets = this._disposSets(latest?.checklist);

        // The facility GRADE circle leads the panel for every facility; the
        // latest inspection is just the first (open) card in the history below.
        const grade = gradePresentation(fac);
        // Newly permitted → a blue NEW badge and no sparkline (no broad-score
        // history to trend). Uses the exporter's flag (see _isNew), not merely
        // "no grade".
        const isNew = this._isNew(fac);
        const sparkHtml = (latest && !isNew) ? this._sparkline(inspections) : '';
        const latestDate = latest?.date || null;
        const gradeHero = grade
            ? this._gradeHero(grade, sparkHtml)
            : isNew
                ? this._newHero(latestView)
                : this._noGradeHero(latestView, sparkHtml);
        // NARRATIVE arc provenance is carried by the history row's verdict chip
        // and the sparkline's ◆ legend — the hero stays the verdict itself, no
        // channel commentary under the circle.
        const scoreHero = (latest || isNew)
            ? `${gradeHero}${this._gradeDates(grade?.baseDate || null, latestDate)}`
            : '<div class="text-muted small mb-2">No inspection detail available yet.</div>';

        const statusNote = (fac.status_onpage && fac.status
            && fac.status_onpage.toLowerCase() !== (fac.status || '').toLowerCase()) ? `
            <div class="food-status-note" title="The inspection page reports a different status than the permit roster">
                <i class="bi bi-exclamation-triangle"></i> inspection page says: ${esc(fac.status_onpage)}</div>` : '';

        const flags = (latest?.red_flags || []);
        // Newly-permitted places have no real inspection to flag — skip the
        // red-flag section entirely (it would only ever say "none").
        const flagsHtml = (latest && !isNew) ? (flags.length ? `
            <div class="food-flags">
                <div class="food-section-title">Biggest red flags — latest report</div>
                ${flags.map((fl) => `
                    <div class="food-flag${fl.category === 'risk_factor' ? ' food-flag-rf' : ''}">
                        ${this._disposBadge(fl.item, sets)}
                        <span class="food-flag-item" title="VA form item ${esc(fl.item ?? '?')} · ${esc(fl.code || 'no code')}">#${esc(fl.item ?? '?')}</span>
                        ${(fl.repeat || sets.repeat.has(fl.item)) ? '<span class="food-flag-repeat">repeat</span>' : ''}
                        <span class="food-flag-text">${esc(fl.text)}</span>
                    </div>`).join('')}
            </div>` : '<div class="food-flags"><div class="food-section-title">Biggest red flags — latest report</div><div class="text-muted small">None prioritized by the display heuristic; this is not a safety finding.</div></div>') : '';

        const history = inspections.length ? `
            <div class="food-section-title">Inspection history (${inspections.length})</div>
            ${inspections.map((insp, i) => this._renderInspection(insp, i === 0, i)).join('')}`
            : '';

        return `
            <div class="food-detail-head">
                <div class="food-detail-title">
                    <h5>${esc(fac.name)}</h5>
                    <div class="food-detail-title-right">
                        <a class="food-insp-report food-detail-source" href="${permitUrl(fac)}"
                            target="_blank" rel="noopener" title="Open this facility's VDH record"><i class="bi bi-file-earmark-text"></i><span>Source</span><i class="bi bi-box-arrow-up-right"></i></a>
                        <button type="button" class="btn-close food-detail-close" aria-label="Close"></button>
                    </div>
                </div>
            </div>
            <div class="food-detail-sub">
                <div class="text-muted small">
                    ${esc(fac.address)}${fac.address2 ? ' ' + esc(fac.address2) : ''}, ${esc(fac.city)}, ${esc(fac.state)} ${esc(fac.zip)}
                    ${geoNote}
                </div>
                ${siteNote}
                <div class="text-muted small">
                    ${esc(fac.permit_type)} · ${esc(fac.status)}
                </div>
                ${statusNote}
                ${(fac.merged_from || []).length ? `
                <div class="text-muted small" title="Same address, near-identical name — a re-issued permit. History below spans all permits.">
                    Includes earlier permit${fac.merged_from.length === 1 ? '' : 's'}:
                    ${fac.merged_from.map((m) =>
                        // A merged_from entry carries no tenant of its own —
                        // a re-permit group shares one address, so the
                        // surviving facility's district fixes the path for all
                        // (mirrors the exporter's claimed_tenant grouping).
                        `<a href="${permitUrl(m, fac.tenant)}" target="_blank" rel="noopener">${esc(m.name)}</a>`).join(' · ')}
                </div>` : ''}
            </div>
            ${scoreHero}
            ${flagsHtml}
            <div class="food-history">${history}</div>`;
    }

    // The circular grade badge: one circle, small letter over big score. The
    // CIRCLE is the facility verdict; rounded SQUARES below are the inspections.
    _gradeCircle(letter, score, extraClass = '') {
        return `<span class="food-grade-circle${extraClass ? ' ' + extraClass : ''}" style="--grade-color:${gradeColor(letter)}" role="img" aria-label="Grade ${esc(letter)}, score ${esc(score)} of 100">
            <span class="food-grade-letter">${esc(letter)}</span>
            <span class="food-grade-score">${esc(score)}</span></span>`;
    }

    // Caption over the circle, a pill under it — one centered stack that reads
    // as a single labeled badge. The pill answers "where does this verdict
    // come from": `computed` when there's a grade, `no grade yet` when there's
    // nothing to compute from. Same slot, same shape, either way.
    _gradeBadgeCol(circleHtml, caption = 'Grade', tagHtml = '') {
        return `
            <div class="food-grade-badge-col">
                <span class="food-grade-caption">${caption}</span>
                ${circleHtml}
                ${tagHtml}
            </div>`;
    }

    // The grade hero: the facility verdict, on top of every full detail panel.
    // Just the badge and the broad-score trend line — the dated provenance
    // rides below in its own objects (_gradeDates). In the detail panel the
    // circle and `computed` pill are buttons that open the grade-receipt modal;
    // the hover preview requests the same visuals without those controls.
    _gradeHero(g, sparkHtml = '', interactive = true) {
        const tag = '<span class="food-score-computed" title="CleanPlateVA formula; VDH publishes no numeric score">computed</span>';
        const circle = this._gradeCircle(g.letter, g.score);
        const circleControl = interactive
            ? `<button type="button" class="food-receipt-trigger" data-grade-receipt`
                + ` aria-haspopup="dialog" title="See how this grade was computed"`
                + ` aria-label="Grade ${esc(g.letter)}, score ${esc(g.score)} of 100 — open the score breakdown">`
                + `${circle}</button>`
            : circle;
        const tagControl = interactive
            ? `<button type="button" class="food-receipt-trigger food-receipt-trigger-pill" data-grade-receipt`
                + ` aria-haspopup="dialog" aria-label="Open the score breakdown">${tag}</button>`
            : tag;
        return `
            <div class="food-score-hero food-grade-hero">
                ${this._gradeBadgeCol(circleControl, 'Grade', tagControl)}
                ${sparkHtml}
            </div>`;
    }

    // Newly permitted: an active permit with no broad assessment yet. A blue
    // NEW badge + a simple headline says "cleared to open, grade still to
    // come" — a positive state, not the neutral "no data" dash. No sparkline
    // and no trend: there's no broad-score history yet.
    _newHero(latestView) {
        const detail = latestView && latestView.scope === 'focused'
            ? 'Grade pending a broad inspection; latest visit was a focused re-check.'
            : 'Cleared to open; grade pending its first broad inspection.';
        const circle = `<span class="food-grade-circle food-grade-circle-new" style="--grade-color:${NEW_COLOR}" role="img" aria-label="Newly permitted, grade pending a broad inspection">
                    <span class="food-grade-new-label">NEW</span></span>`;
        return `
            <div class="food-score-hero food-grade-hero food-grade-hero-new">
                ${this._gradeBadgeCol(circle, 'Status')}
                <div class="food-score-meta">
                    <div class="food-score-grade food-score-grade-new">Permitted</div>
                    <div class="text-muted small">${esc(detail)}</div>
                </div>
            </div>`;
    }

    // No scored broad assessment → no grade. A neutral circle keeps the panel
    // shape, and the note says what a grade would need. "No grade yet" rides in
    // the pill slot where a graded facility says "computed" — the verdict sits
    // with the badge, so the prose beside it is only the explanation.
    _noGradeHero(latestView, sparkHtml = '') {
        const detail = latestView.scope === 'focused'
            ? `The latest report is a focused ${latestView.count}-item check. A grade needs a broad inspection (20+ items).`
            : 'No broad inspection (20+ items) captured yet, so no grade — the inspections below stand on their own.';
        const circle = `<span class="food-grade-circle food-grade-circle-none" role="img" aria-label="No grade yet">
                    <span class="food-grade-letter">–</span>
                    <span class="food-grade-score">n/a</span></span>`;
        const tag = '<span class="food-score-computed food-grade-tag-none">no grade yet</span>';
        // Badge and trend take the row exactly as they do on a graded facility;
        // the explanation follows on the line beneath. Three objects across a
        // 400px panel would leave both the copy and the plot too narrow to read.
        return `
            <div class="food-score-hero food-grade-hero food-grade-hero-none">
                ${this._gradeBadgeCol(circle, 'Grade', tag)}
                ${sparkHtml}
                <div class="food-score-meta">
                    <div class="text-muted small">${esc(detail)}</div>
                </div>
            </div>`;
    }

    // Dated provenance as its own graphical objects below the hero: the broad
    // that anchors the grade, and the most recent visit of any kind.
    _gradeDates(baseDate, latestDate) {
        if (!baseDate && !latestDate) return '';
        // Both boxes always render when there's anything to show; a missing
        // date is a dash — a newly-permitted place keeps "Last broad inspection"
        // as "—" rather than dropping the box.
        const obj = (label, iso) => `
            <div class="food-grade-date">
                <span class="food-grade-date-label">${label}</span>
                <span class="food-grade-date-value">${iso ? fmtDateNum(iso) : '—'}</span>
            </div>`;
        return `<div class="food-grade-dates">`
            + obj('Last broad inspection', baseDate)
            + obj('Last visit', latestDate)
            + `</div>`;
    }

    // ── grade-receipt modal ─────────────────────────────────────────────
    // The breakdown behind the hero's grade circle: broad anchor → follow-up
    // effects → ledger. Data model comes from gradeReceiptPresentation; when
    // its engine-mirror reconcile failed (`verified` false), per-item point
    // values are absent and the receipt leans on the published aggregates —
    // membership and copy render either way.

    _bindGradeReceipt(root, fac, inspections) {
        root.querySelectorAll('[data-grade-receipt]').forEach((btn) => {
            btn.addEventListener('click', () => this._openReceipt(fac, inspections, btn));
        });
    }

    _openReceipt(fac, inspections, trigger = null) {
        const receipt = gradeReceiptPresentation(fac, inspections);
        if (!receipt) return;
        this._closeReceipt();
        const host = document.createElement('div');
        host.className = 'food-receipt-host';
        host.innerHTML = this._renderGradeReceipt(receipt, fac.name);
        document.body.appendChild(host);
        document.body.classList.add('food-receipt-open');
        this._receiptHost = host;
        this._receiptTrigger = trigger;
        host.querySelectorAll('[data-receipt-close]').forEach((el) =>
            el.addEventListener('click', () => this._closeReceipt()));
        // The About link routes through the real header tab so its
        // scroll-to-top + focus-the-title behavior runs; the modal closes
        // first so focus restoration can't fight the About handoff.
        host.querySelector('[data-receipt-about]')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._closeReceipt();
            document.querySelector('#foodViewToggle button[data-view="about"]')?.click();
        });
        const backdrop = host.querySelector('.food-receipt-backdrop');
        backdrop?.addEventListener('click', (e) => {
            if (e.target === backdrop) this._closeReceipt();
        });
        this._receiptKeydown = (e) => {
            if (e.key === 'Escape') this._closeReceipt();
        };
        document.addEventListener('keydown', this._receiptKeydown);
        // Light focus containment: anything tabbing out of the dialog is
        // pulled back to it (small dialog, no full trap machinery needed).
        this._receiptFocusin = (e) => {
            if (this._receiptHost && !this._receiptHost.contains(e.target)) {
                this._receiptHost.querySelector('.food-receipt')?.focus();
            }
        };
        document.addEventListener('focusin', this._receiptFocusin);
        host.querySelector('.food-receipt')?.focus();
    }

    _closeReceipt() {
        if (!this._receiptHost) return;
        if (this._receiptKeydown) document.removeEventListener('keydown', this._receiptKeydown);
        if (this._receiptFocusin) document.removeEventListener('focusin', this._receiptFocusin);
        this._receiptKeydown = null;
        this._receiptFocusin = null;
        this._receiptHost.remove();
        this._receiptHost = null;
        document.body.classList.remove('food-receipt-open');
        const trigger = this._receiptTrigger;
        this._receiptTrigger = null;
        if (trigger && trigger.isConnected) trigger.focus();
    }

    _renderGradeReceipt(r, name) {
        const fmt1 = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
        const chip = (cls, text, title = '') =>
            `<span class="${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
        const catChip = (category) => (category === 'risk_factor'
            ? chip('food-receipt-cat food-receipt-cat-rf', 'risk factor −6',
                'Foodborne-illness risk factor (form items 1–29) — 6 points per violation')
            : chip('food-receipt-cat food-receipt-cat-grp', 'retail practice −2',
                'Good Retail Practices (items 30+) — 2 points per violation'));

        // One item row, shared by the base list and the journey groups.
        const itemRow = (it, deltaHtml) => `
            <div class="food-receipt-item${it.category === 'risk_factor' ? ' food-receipt-item-rf' : ''}">
                <div class="food-receipt-item-head">
                    <span class="food-receipt-item-no">#${esc(it.item)}</span>
                    ${catChip(it.category)}
                    ${it.count > 1 ? chip('food-receipt-cat', `×${it.count} findings`,
                        'Multiple violations were cited under this item — their weights sum') : ''}
                    ${it.repeat ? chip('food-flag-repeat', 'repeat ×1.5') : ''}
                    ${it.cos || it.cosBase ? chip('food-dispos food-dispos-cos', 'fixed on site ×0.75',
                        'Corrected while the inspector watched — docks 75% of its weight, provisionally') : ''}
                    ${it.narrative ? chip('food-receipt-narr', 'written verdict',
                        'Outcome read from the inspector\'s written comments (adjudicated)') : ''}
                    ${deltaHtml}
                </div>
                ${it.text ? `<div class="food-receipt-item-text">${esc(it.text)}</div>` : ''}
            </div>`;

        // ── section 1: the broad anchor ────────────────────────────────
        const b = r.base;
        let baseBody;
        if (!b.found) {
            baseBody = `<div class="food-receipt-note">The anchoring broad inspection isn't in the
                shipped history, so the per-item breakdown is unavailable — the published totals below still stand.</div>`;
        } else if (!b.items.length && !b.itemless) {
            baseBody = '<div class="food-receipt-note">No violations recorded: a clean 100-point inspection.</div>';
        } else {
            baseBody = b.items.map((it) => itemRow(it, it.points != null
                ? `<span class="food-receipt-pts">−${fmt1(it.points)}</span>` : '')).join('')
                + (b.itemless ? `<div class="food-receipt-note">${b.itemless.count} observation${b.itemless.count === 1 ? '' : 's'}
                    without a form item number — dock${b.itemless.count === 1 ? 's' : ''} at face value${b.itemless.points != null
                        ? ` (−${fmt1(b.itemless.points)})` : ''} and can't be re-checked by item.</div>` : '');
        }
        // Counts as a chip row: total in a filled box (red when any, green at
        // zero — data hues, inline like every grade color), category counts
        // in the same red/amber bubbles the item rows use, weights omitted
        // (the items below carry the −6/−2).
        const n = b.violationCount || 0;
        const baseCounts = b.found ? `
            <div class="food-receipt-counts">
                <span class="food-receipt-count" style="background:${n ? GRADE_COLORS.F : GRADE_COLORS.A}">${n} violation${n === 1 ? '' : 's'}</span>
                ${b.rfCount ? chip('food-receipt-cat food-receipt-cat-rf', `${b.rfCount} risk factor`,
                    'Foodborne-illness risk factors (form items 1–29)') : ''}
                ${b.grpCount ? chip('food-receipt-cat food-receipt-cat-grp', `${b.grpCount} retail practice`,
                    'Good Retail Practices (items 30+)') : ''}
            </div>` : '';
        const baseSection = `
            <div class="food-receipt-sec">
                <div class="food-receipt-sec-title">
                    <span>Broad inspection — ${fmtDate(b.date)}</span>
                    <span class="food-insp-score" style="background:${this._scoreColor(b.score)}"
                        title="This inspection's score — the grade's base">${esc(b.score)}</span>
                </div>
                ${baseCounts}
                ${baseBody}
            </div>`;

        // ── section 2: follow-ups and their effects ────────────────────
        let followupSection = '';
        if (r.adjusted) {
            const visits = r.followups.map((v) => `
                <div class="food-receipt-visit">
                    <span class="food-receipt-visit-date">${fmtDateNum(v.date)}</span>
                    <span class="food-adj-chip food-outcome-${esc(v.tone)}" title="${esc(v.detail)}">${esc(v.label)}</span>
                    <span class="food-receipt-visit-kind">${v.kind === 'narrative' ? 'written verdict' : 'focused re-check'}</span>
                </div>`).join('');
            const groups = [
                ['restored', 'Verified fixed', 'restores 65% of the item\'s deduction',
                    (row) => (row.delta != null
                        ? `<span class="food-receipt-pts food-receipt-delta-pos">+${fmt1(row.delta)}</span>` : '')],
                ['failed', 'Found OUT again', 'full weight ×1.5 — any on-site credit revoked',
                    (row) => (row.delta != null
                        ? `<span class="food-receipt-pts food-receipt-delta-neg">−${fmt1(row.delta)} more</span>` : '')],
                ['cos', 'OUT again, re-fixed on the spot', 'full weight — the base on-site credit is revoked',
                    // With no base COS credit to revoke, the charge is unchanged: ±0.
                    (row) => (row.delta != null
                        ? (row.delta > 0
                            ? `<span class="food-receipt-pts food-receipt-delta-neg">−${fmt1(row.delta)} more</span>`
                            : '<span class="food-receipt-pts food-receipt-delta-mut">±0</span>') : '')],
                ['new', 'New findings on re-checks', 'dock at category weight',
                    (row) => (row.delta != null
                        ? `<span class="food-receipt-pts food-receipt-delta-neg">−${fmt1(row.delta)}</span>` : '')],
                ['unchecked', 'Not re-checked', 'the deduction stands as-is',
                    (row) => (row.dockPts != null
                        ? `<span class="food-receipt-pts food-receipt-delta-mut">−${fmt1(row.dockPts)} carried</span>` : '')],
            ];
            const journeyHtml = groups
                .filter(([bucket]) => r.journeys[bucket].length)
                .map(([bucket, title, sub, delta]) => `
                    <div class="food-receipt-group">${title} <small>${sub}</small></div>
                    ${r.journeys[bucket].map((row) => itemRow(row, delta(row))).join('')}`)
                .join('');
            followupSection = `
                <div class="food-receipt-sec">
                    <div class="food-receipt-sec-title"><span>Since then —
                        ${r.followups.length} re-check${r.followups.length === 1 ? '' : 's'}</span></div>
                    ${visits}
                    <div class="food-receipt-sub">For each item the broad visit docked, the newest re-check governs:</div>
                    ${journeyHtml}
                </div>`;
        }
        // Unadjusted: no follow-up section at all — the base IS the grade,
        // and the header circle already says so.

        // ── section 3: the ledger ──────────────────────────────────────
        const ledger = r.adjusted ? `
            <div class="food-receipt-ledger">
                <div class="food-receipt-ledger-row"><span>Base broad score</span><b>${r.ledger.baseScore}</b></div>
                <div class="food-receipt-ledger-row"><span>Restored by verified fixes</span>
                    <b class="food-receipt-delta-pos">+${fmt1(r.ledger.restored)}</b></div>
                <div class="food-receipt-ledger-row"><span>Added by failed re-checks &amp; new findings</span>
                    <b class="food-receipt-delta-neg">−${fmt1(r.ledger.added)}</b></div>
                <div class="food-receipt-ledger-row food-receipt-ledger-total"><span>Facility grade</span>
                    <span class="food-receipt-ledger-grade" style="--grade-color:${gradeColor(r.ledger.letter)}">${r.ledger.score} ${esc(r.ledger.letter)}</span></div>
                ${r.ledger.exact ? '' : `<div class="food-receipt-foot">Components are shown to one decimal;
                    the score itself rounds once, at the end (halves up), so the lines may not visibly sum.</div>`}
            </div>` : '';

        return `
            <div class="food-receipt-backdrop">
                <div class="food-receipt" role="dialog" aria-modal="true" aria-labelledby="foodReceiptTitle" tabindex="-1">
                    <div class="food-receipt-head">
                        <div>
                            <div class="food-receipt-kicker">How this grade was computed</div>
                            <h5 id="foodReceiptTitle">${esc(name)}</h5>
                        </div>
                        ${this._gradeCircle(r.grade.letter, r.grade.score, 'food-grade-circle-sm')}
                        <button type="button" class="btn-close" data-receipt-close aria-label="Close"></button>
                    </div>
                    <div class="food-receipt-body">
                        ${baseSection}
                        ${followupSection}
                        ${ledger}
                        <div class="food-receipt-foot">CleanPlateVA computes this score and grade;
                            VDH publishes no numeric score of its own.
                            Read the full method on the <a href="#about" data-receipt-about>About</a> tab.</div>
                    </div>
                </div>
            </div>`;
    }

    // item#s by disposition, from a parsed checklist — used to badge violations
    // "fixed on site" / "open" / "repeat" (the authoritative structured source).
    _disposSets(checklist) {
        const cos = new Set(), open = new Set(), repeat = new Set();
        for (const r of (checklist || [])) {
            if (r.item == null) continue;
            if (r.cos) cos.add(r.item);
            if (r.violation && !r.cos) open.add(r.item);
            if (r.repeat) repeat.add(r.item);
        }
        return { cos, open, repeat };
    }

    _disposBadge(item, sets) {
        if (item != null && sets.cos.has(item))
            return '<span class="food-dispos food-dispos-cos" title="Corrected on site during the inspection">fixed</span>';
        if (item != null && sets.open.has(item))
            return '<span class="food-dispos food-dispos-open" title="Cited and left open at the inspection">open</span>';
        return '';
    }

    // Per-score grade color (the A≥90 … F<60 bands / GRADE_COLORS).
    _scoreColor(s) {
        return s >= 90 ? GRADE_COLORS.A : s >= 80 ? GRADE_COLORS.B
            : s >= 70 ? GRADE_COLORS.C : s >= 60 ? GRADE_COLORS.D : GRADE_COLORS.F;
    }

    // One comparison history: broad assessments form the connected line;
    // focused inspections keep their time position as unconnected raw-formula
    // diamonds, colored by their own OUT/addressed compliance outcome. They do
    // not join the broad score line. Unknown-scope events are baseline ticks.
    _sparkline(inspections) {
        const series = buildScopeSeries(inspections);
        if (!series.events.length) return '';
        // Initial render at the default viewBox width; _bindSparkline re-renders
        // at a width matched to the card's rendered size so the points spread to
        // fill it (the height stays locked — see _sparkSvg and the CSS).
        const { svg, nodes } = this._sparkSvg(series, 280);
        return `<div class="food-spark" data-spark-nodes="${esc(JSON.stringify(nodes))}">
            <span class="food-grade-caption">Trend</span>
            ${svg}
        </div>`;
    }

    // The trend SVG for a given viewBox width W, plus the hover node registry.
    // Only the x-spacing depends on W: the vertical geometry (H and the pads) is
    // fixed, so the plot HEIGHT is locked (CSS renders the svg at 5.0775rem).
    // Re-running with a wider W — _bindSparkline matches it to
    // the rendered width — spreads the points to fill the room WITHOUT resizing
    // the marks, because the scale stays uniform. `padTop = 45.55` leaves
    // hairline headroom above the 1.5x hover label; innerH 34 is the score band.
    _sparkSvg(series, W) {
        const H = 101.55, padX = 27, padTop = 45.55, padBot = 22;
        const innerH = H - padTop - padBot;
        const x = (i) => series.events.length === 1 ? W / 2
            : padX + i * ((W - padX * 2) / (series.events.length - 1));
        const y = (s) => padTop + (1 - s / 100) * innerH;
        // Hover hit-test registry: one entry per plotted mark, in viewBox
        // units. `_bindSparkline` reads this back off the DOM to enlarge the
        // nearest node. Replaces the per-node <title> tooltips (pure-visual
        // hover — the score labels already sit on-canvas).
        const nodes = [];
        const coords = series.broad.map((event) =>
            `${x(event.index).toFixed(1)},${y(event.presentation.score).toFixed(1)}`);
        const broadDots = series.broad.map((event) => {
            const px = x(event.index), py = y(event.presentation.score);
            const c = this._scoreColor(event.presentation.score);
            nodes.push({
                k: 'broad', x: +px.toFixed(1), y: +py.toFixed(1),
                s: event.presentation.score, c, historyIndex: event.historyIndex,
            });
            return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.95" fill="${c}"/>`;
        }).join('');
        const broadLabels = series.broad.map((event) =>
            `<text class="food-spark-score" x="${x(event.index).toFixed(1)}" y="${(y(event.presentation.score) - 9).toFixed(1)}" text-anchor="middle">${event.presentation.score}</text>`).join('');
        // Neutral baseline tick, below the score band: an event happened here
        // and the record doesn't support claiming how it went.
        const baselineTick = (px, event) => {
            const y1 = H - padBot + 1, y2 = H - 6;
            nodes.push({
                k: 'unknown', x: +px.toFixed(1),
                y: +((y1 + y2) / 2).toFixed(1), y1, y2,
                historyIndex: event.historyIndex,
            });
            return `<line class="food-spark-unknown" x1="${px.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${px.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
        };
        // A focused re-check plots at its COMPLIANCE — the IN-share of the few
        // items actually re-examined — and is labeled with that same X/Y OUT
        // ratio. It is NOT plotted at its raw VDH score, and the raw score is
        // not shown here at all.
        //
        // The raw score is `100 − the point weights of the items looked at`, so
        // on a 3-item follow-up docket it is structurally pinned near 100 no
        // matter how the visit went: its denominator is the whole 100-point
        // inspection while its numerator is a handful of items. Lakeside Grill
        // (6920 Lakeside Ave) is the case that surfaced it — its 2026-03-06 and
        // 2026-04-02 follow-ups were 3/3 OUT, nothing corrected either time, and
        // they plotted as r90 and r92 at the top of the chart inside the A band.
        // The line even ROSE between them, because the second inspector wrote
        // one fewer violation row for the identical three failed items.
        // Compliance is the axis the failure actually lives on — and it is the
        // axis the narrative verdicts below already plot against, so all three
        // mark families now speak one language.
        const focusedMarks = series.focused.map((event) => {
            const px = x(event.index);
            const outcome = focusedOutcomePresentation(event.presentation);
            // No trustworthy distinct-OUT ratio ⇒ no height to claim.
            if (!outcome.ratioKnown) return baselineTick(px, event);
            const py = y(outcome.complianceRate * 100);
            const label = `${outcome.out}/${outcome.total}`;
            nodes.push({
                k: 'focused', x: +px.toFixed(1), y: +py.toFixed(1),
                s: label, tone: outcome.tone, historyIndex: event.historyIndex,
            });
            return `<rect class="food-spark-focused food-outcome-${outcome.tone}" x="${(px - 6.3).toFixed(1)}" y="${(py - 6.3).toFixed(1)}" width="12.6" height="12.6" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`
                + `<text class="food-spark-mark-label" x="${px.toFixed(1)}" y="${(py - 11.25).toFixed(1)}" text-anchor="middle">${label}</text>`;
        }).join('');
        // Scope-unknown events: an adjudicated written verdict plots as a
        // FILLED diamond at the height its verdict describes — "all
        // corrected" up at the 100 line (it IS the full-clear the comment
        // claims), "not corrected" down at 0, priority/enumerated between
        // (adj.height). Filled = comment verdict; hollow = focused checklist
        // re-check. Un-adjudicated events keep the neutral baseline tick,
        // below the score area, claiming nothing.
        let narrCount = 0;
        const unknownMarks = series.unknown.map((event) => {
            const px = x(event.index);
            const adj = narrativeVerdictPresentation(event.inspection);
            if (adj) {
                narrCount += 1;
                const py = y(adj.height);
                // Enumerated written verdicts already know how many items the
                // glyph asserts: IN beside a check, OUT beside an X. Carry the
                // same counted label used by the history badge onto both the
                // static trend and its enlarged hover clone. Blanket verdicts
                // deliberately stay unnumbered because they name no item set.
                const label = `${adj.glyph}${adj.count ?? ''}`;
                nodes.push({
                    k: 'narr', x: +px.toFixed(1), y: +py.toFixed(1),
                    tone: adj.tone, g: adj.glyph, s: label,
                    historyIndex: event.historyIndex,
                });
                return `<rect class="food-spark-narr food-outcome-${adj.tone}" x="${(px - 6.3).toFixed(1)}" y="${(py - 6.3).toFixed(1)}" width="12.6" height="12.6" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`
                    + `<text class="food-spark-mark-label" x="${px.toFixed(1)}" y="${(py - 11.25).toFixed(1)}" text-anchor="middle">${label}</text>`;
            }
            return baselineTick(px, event);
        }).join('');
        // Vertical gradient in user space: top (score 100) → bottom (score 0),
        // stops at the grade-band boundaries (A green · B lime · C amber · D
        // orange · F red).
        const grad = `<linearGradient id="food-spark-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${y(100).toFixed(1)}" x2="0" y2="${y(0).toFixed(1)}">`
            + `<stop offset="0" stop-color="${GRADE_COLORS.A}"/>`
            + `<stop offset="0.1" stop-color="${GRADE_COLORS.A}"/>`
            + `<stop offset="0.2" stop-color="${GRADE_COLORS.B}"/>`
            + `<stop offset="0.3" stop-color="${GRADE_COLORS.C}"/>`
            + `<stop offset="0.4" stop-color="${GRADE_COLORS.D}"/>`
            + `<stop offset="0.45" stop-color="${GRADE_COLORS.F}"/>`
            + `<stop offset="1" stop-color="${GRADE_COLORS.F}"/>`
            + `</linearGradient>`;
        const line = coords.length > 1
            ? `<polyline points="${coords.join(' ')}" fill="none" stroke="url(#food-spark-grad)" stroke-width="2.625" stroke-linejoin="round" stroke-linecap="round"/>` : '';
        const broadSummary = series.broad.length
            ? `Broad scores oldest to newest: ${series.broad.map((event) => `${fmtDate(event.inspection.date)} ${event.presentation.score}`).join(', ')}`
            : 'No broad scores captured';
        const focusedSummary = series.focused.length
            ? `Focused re-checks: ${series.focused.map((event) => `${fmtDate(event.inspection.date)} ${focusedOutcomePresentation(event.presentation).description}`).join(' · ')}`
            : 'No focused re-checks';
        const accessibleSummary = `${broadSummary}. ${focusedSummary}. `
            + `${series.unknown.length} unknown-scope event${series.unknown.length === 1 ? '' : 's'}`
            + (narrCount ? `, ${narrCount} with an adjudicated written verdict` : '') + '.';
        // No width/height attrs — CSS sizes the svg (fixed height, 100% width);
        // the viewBox width W (matched to the render by _bindSparkline) is what
        // spreads the points. No legend under the plot: the About page teaches
        // the line-vs-◇ vocabulary, and hover + the aria summary carry the rest.
        const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(accessibleSummary)}">
                <defs>${grad}</defs>
                ${line}
                ${broadDots}
                ${broadLabels}
                ${focusedMarks}
                ${unknownMarks}
                <g class="food-spark-hl" pointer-events="none"></g>
                <rect class="food-spark-overlay" x="0" y="0" width="${W}" height="${H}"/>
            </svg>`;
        return { svg, nodes };
    }

    // Enlarged foreground clone of the hovered node — pure visual, no text
    // tooltip. Shape mirrors the base mark (dot / rotated square / baseline
    // tick); painted into the top <g> so it lifts above its neighbours.
    _sparkHighlight(n) {
        if (n.k === 'broad') {
            return `<circle class="food-spark-hl-dot" cx="${n.x}" cy="${n.y}" r="9.9" fill="${n.c}"/>`
                + `<text class="food-spark-score food-spark-hl-label" x="${n.x}" y="${(n.y - 19.125).toFixed(1)}" text-anchor="middle">${n.s}</text>`;
        }
        if (n.k === 'focused') {
            const h = 10.35;
            return `<rect class="food-spark-focused food-spark-hl-dia food-outcome-${n.tone}" x="${(n.x - h).toFixed(1)}" y="${(n.y - h).toFixed(1)}" width="${(h * 2).toFixed(1)}" height="${(h * 2).toFixed(1)}" transform="rotate(45 ${n.x} ${n.y})"/>`
                + `<text class="food-spark-mark-label food-spark-hl-label" x="${n.x}" y="${(n.y - 21.375).toFixed(1)}" text-anchor="middle">${n.s}</text>`;
        }
        if (n.k === 'narr') {
            const h = 10.35;
            return `<rect class="food-spark-narr food-spark-hl-dia food-outcome-${n.tone}" x="${(n.x - h).toFixed(1)}" y="${(n.y - h).toFixed(1)}" width="${(h * 2).toFixed(1)}" height="${(h * 2).toFixed(1)}" transform="rotate(45 ${n.x} ${n.y})"/>`
                + `<text class="food-spark-mark-label food-spark-hl-label" x="${n.x}" y="${(n.y - 21.375).toFixed(1)}" text-anchor="middle">${n.s ?? n.g}</text>`;
        }
        return `<line class="food-spark-unknown food-spark-hl-tick" x1="${n.x}" y1="${n.y1}" x2="${n.x}" y2="${n.y2}"/>`;
    }

    // Open the exact history row represented by a trend node, then bring the
    // expanded card into view inside the scrolling detail panel.
    _openInspectionFromTrend(root, historyIndex) {
        if (!Number.isInteger(historyIndex) || historyIndex < 0) return false;
        const target = root.querySelector(
            `.food-insp[data-inspection-index="${historyIndex}"]`);
        if (!target) return false;
        target.open = true;
        // Scroll the compact summary, not the potentially multi-screen details
        // body. Pin it directly below the sticky facility title so the selected
        // inspection reads as the new top of the view, regardless of title
        // height or how tall the expanded violation copy is.
        const anchor = target.querySelector('summary') || target;
        const scroller = root.closest?.('.food-detail');
        const stickyHead = root.querySelector('.food-detail-head');
        requestAnimationFrame(() => {
            if (!scroller || !stickyHead) {
                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            const top = scroller.scrollTop
                + anchor.getBoundingClientRect().top
                - stickyHead.getBoundingClientRect().bottom
                - 1; // clear the sticky header's bottom border after subpixel rounding
            scroller.scrollTo({ top, behavior: 'smooth' });
        });
        return true;
    }

    // Desktop hover: enlarge the single nearest node within a max radius and
    // lift it to the foreground; clicking that highlighted node expands and
    // scrolls to its exact inspection row. Nothing activates outside the
    // radius. No-op on touch (no mousemove). Rebound on every detail render —
    // a stale closure would address phantom points after a scope/facility
    // change.
    _bindSparkline(root, inspections) {
        const container = root.querySelector('.food-spark');
        if (!container) return;
        const series = buildScopeSeries(inspections || []);
        if (!series.events.length) return;

        // Enlarge the single nearest node within a max radius and lift it to the
        // foreground. Re-queries the current svg each call, so it re-binds
        // cleanly after a resize re-render — the old overlay (and its listener)
        // is replaced, never stacked.
        const bindHover = () => {
            const svg = container.querySelector('svg');
            const hl = container.querySelector('.food-spark-hl');
            const overlay = container.querySelector('.food-spark-overlay');
            if (!svg || !hl || !overlay) return;
            let nodes;
            try { nodes = JSON.parse(container.dataset.sparkNodes || '[]'); }
            catch { nodes = []; }
            if (!nodes.length) return;
            const vb = svg.viewBox.baseVal;
            const MAX_R = 12;                 // max-boundary, viewBox units
            // Base score labels: the active node's small label hides while its
            // enlarged one shows, so the two sizes don't overlap and smear.
            const baseLabels = [...svg.querySelectorAll('text.food-spark-score, text.food-spark-mark-label')];
            let activeIdx = -1;
            const clear = () => {
                overlay.classList.remove('food-spark-overlay-active');
                if (activeIdx === -1) return;
                hl.textContent = '';
                baseLabels.forEach((t) => { t.style.visibility = ''; });
                activeIdx = -1;
            };
            overlay.addEventListener('mousemove', (evt) => {
                const rect = svg.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const px = (evt.clientX - rect.left) / rect.width * vb.width;
                const py = (evt.clientY - rect.top) / rect.height * vb.height;
                let best = -1, bestD = MAX_R * MAX_R;
                for (let i = 0; i < nodes.length; i++) {
                    const dx = nodes[i].x - px, dy = nodes[i].y - py;
                    const d = dx * dx + dy * dy;
                    if (d <= bestD) { bestD = d; best = i; }
                }
                if (best === -1) { clear(); return; }
                if (best !== activeIdx) {
                    hl.innerHTML = this._sparkHighlight(nodes[best]);
                    const nx = nodes[best].x;
                    baseLabels.forEach((t) => {
                        t.style.visibility = Math.abs(parseFloat(t.getAttribute('x')) - nx) < 0.6 ? 'hidden' : '';
                    });
                    activeIdx = best;
                    overlay.classList.add('food-spark-overlay-active');
                }
            });
            overlay.addEventListener('click', () => {
                const node = nodes[activeIdx];
                if (node) this._openInspectionFromTrend(root, node.historyIndex);
            });
            overlay.addEventListener('mouseleave', clear);
        };

        // Match the viewBox width to the rendered width so the points spread to
        // fill the card while the marks keep their size (uniform scale) and the
        // height stays locked. Returns true when it actually re-rendered.
        const fit = () => {
            const svg = container.querySelector('svg');
            if (!svg) return false;
            const svgH = svg.getBoundingClientRect().height;   // the locked height, px
            if (!svgH) return false;
            const H = svg.viewBox.baseVal.height;
            const cs = getComputedStyle(container);
            const availW = container.clientWidth
                - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
            if (availW <= 0) return false;
            // The viewBox width tracks the available px width at the locked height,
            // so the svg's intrinsic size (width:auto) fills the card — the points
            // spread and the scale stays uniform. Round DOWN so intrinsic ≤ availW.
            const W = Math.max(120, Math.floor(availW * H / svgH));
            if (Math.abs(svg.viewBox.baseVal.width - W) < 1) return false;
            const next = this._sparkSvg(series, W);
            container.dataset.sparkNodes = JSON.stringify(next.nodes);
            svg.outerHTML = next.svg;      // old svg + its hover listener go with it
            return true;
        };

        bindHover();                       // wire the initial (default-width) svg
        if (fit()) bindHover();            // fit to the render, re-wire if it changed
        // Keep it fitted as the panel/viewport changes width (rAF-debounced; a
        // re-render never changes the container width, so this can't loop).
        if (typeof ResizeObserver !== 'undefined') {
            let raf = 0;
            const ro = new ResizeObserver(() => {
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => { if (fit()) bindHover(); });
            });
            ro.observe(container);
        }
    }

    _renderInspection(insp, openByDefault, historyIndex = null) {
        const view = inspectionPresentation(insp);
        const violations = insp.violations || [];
        const sets = this._disposSets(insp.checklist);
        // An adjudicated comment can stand alone on a scope-unknown report or
        // supplement a focused checklist whose rows contain only what remains
        // OUT. The focused badge shows the combined OUT/addressed ratio; the
        // verdict chip below names the comment-side corrections.
        const adj = narrativeVerdictPresentation(insp);
        const badge = view.scope === 'broad'
            ? `<span class="food-insp-score food-insp-signal" style="background:${view.score != null ? this._scoreColor(view.score) : GRADE_COLORS.none}" title="Inspection score (0–100, no letter — letters are a facility grade)">${view.score ?? '—'}</span>`
            : view.scope === 'focused'
                ? focusedOutcomeBadge(view)
                : adj
                    ? `<span class="food-insp-score food-insp-score-adj food-insp-signal food-outcome-${adj.tone}" role="img" title="${esc(adj.detail)}" aria-label="${esc(adj.detail)}"><span aria-hidden="true">${adj.glyph}</span>${adj.count ? `<small aria-hidden="true">${adj.count}</small>` : ''}</span>`
                    : '<span class="food-insp-score food-insp-score-unknown food-insp-signal">?</span>';
        // An adjudicated row shows its VERDICT chip instead of a scope label:
        // "Scope unknown" describes the missing checklist, which is exactly the
        // thing the adjudication resolved — showing both reads as a
        // contradiction. Un-adjudicated unknowns keep the honest label.
        const scopeBadge = adj && view.scope === 'unknown' ? ''
            : `<span class="food-scope-badge food-scope-badge-${view.scope}">${view.scope === 'broad' ? 'Broad' : view.scope === 'focused' ? 'Focused' : 'Scope unknown'}</span>`;
        const adjChip = adj
            ? `<span class="food-adj-chip food-outcome-${adj.tone}" title="${esc(adj.detail)}">${esc(adj.label)}</span>` : '';
        // Violation counts as the grade-receipt chip row, ported onto the summary
        // (replaces the old muted "N viol." text). The count split + the
        // scope-unknown-zero suppression live in inspectionCountsPresentation so
        // they're a tested contract; here we just paint it — a filled box (red for
        // any, green at zero) then the rf / retail-practice bubbles the receipt uses.
        const counts = inspectionCountsPresentation(insp);
        const inspCounts = !counts.show ? '' : `<span class="food-insp-counts">
                <span class="food-receipt-count" style="background:${counts.n ? GRADE_COLORS.F : GRADE_COLORS.A}">${counts.n} violation${counts.n === 1 ? '' : 's'}</span>
                ${counts.rf ? `<span class="food-receipt-cat food-receipt-cat-rf" title="Foodborne-illness risk factors (form items 1–29)">${counts.rf} risk factor</span>` : ''}
                ${counts.grp ? `<span class="food-receipt-cat food-receipt-cat-grp" title="Good Retail Practices (items 30+)">${counts.grp} retail practice</span>` : ''}
            </span>`;
        const noViolations = view.scope === 'broad'
            ? `No violations recorded across ${view.count} distinct applicable code items.`
            : view.scope === 'focused'
                ? `No violations recorded in this focused ${view.count}-item check.`
                // Adjudicated rows suppress this line entirely — their
                // raw-score line states the missing checklist and the chip
                // states the verdict.
                : 'No violations recorded; checklist breadth was not published.';
        // The VDH report link rides in the collapsed summary row (right of the
        // metadata, next to the caret) as an icon-only control. stopPropagation
        // is bound in _select so a click opens VDH without also toggling the row.
        const sourceLink = insp.report_url
            ? `<a class="food-insp-report" href="${esc(insp.report_url)}" target="_blank" rel="noopener"
                aria-label="Open the official VDH report for this inspection"
                title="Open the official VDH report for this inspection"><i class="bi bi-file-earmark-text" aria-hidden="true"></i><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>`
            : '';
        return `
        <details class="food-insp"${Number.isInteger(historyIndex) ? ` data-inspection-index="${historyIndex}"` : ''}${openByDefault ? ' open' : ''}>
            <summary>
                ${badge}
                <span class="food-insp-r1">
                    <span class="food-insp-when">${fmtDate(insp.date)}</span>
                    <span class="food-insp-kind text-muted">${esc(insp.purpose)}</span>
                    ${scopeBadge}
                    <span class="food-insp-r1-right">
                        ${sourceLink}
                        <span class="food-insp-caret" aria-hidden="true"></span>
                    </span>
                </span>
                ${adj ? `<span class="food-insp-counts">${adjChip}</span>` : inspCounts}
            </summary>
            <div class="food-insp-body">
                ${adj
                    ? `<div class="food-raw-score">No checklist published; verdict read from the inspector's written comments.</div>` : ''}
                ${violations.length ? violations.map((v) => `
                    <div class="food-viol${(v.item != null && v.item <= 29) ? ' food-viol-rf' : ''}">
                        <div class="food-viol-head">
                            ${this._disposBadge(v.item, sets)}
                            <span class="food-viol-item" title="${esc(v.code || 'no regulation code')}">#${esc(v.item ?? '?')}</span>
                            ${sets.repeat.has(v.item) ? '<span class="food-flag-repeat">repeat</span>' : ''}
                            <span class="food-viol-text">${esc(v.text)}</span>
                        </div>
                        ${v.corrective ? `<div class="food-viol-corrective">↳ ${esc(v.corrective)}</div>` : ''}
                    </div>`).join('')
                : adj ? ''
                    : `<div class="text-muted small px-1">${esc(noViolations)}</div>`}
                ${this._renderChecklist(insp.checklist, view)}
                ${insp.comments ? `<div class="food-insp-comments"><strong>Inspector comments:</strong> ${esc(insp.comments)}</div>` : ''}
                ${this._renderTemps(insp.temps_v2, insp.temps)}
            </div>
        </details>`;
    }

    // The inspection's published checklist rows (passing items too), grouped by category,
    // each category collapsible with a pass-rate bar. Sentinel rows excluded.
    _renderChecklist(checklist, presentation = {}) {
        const rows = (checklist || []).filter((r) => !r.is_sentinel);
        if (!rows.length) return '';
        const cats = [], byCat = new Map();
        for (const r of rows) {
            const c = r.category || 'Other';
            if (!byCat.has(c)) { byCat.set(c, []); cats.push(c); }
            byCat.get(c).push(r);
        }
        const out = rows.filter((r) => r.violation).length;
        const cats_html = cats.map((c) => {
            const cr = byCat.get(c);
            const cOk = cr.filter((r) => r.compliant).length;
            const cOut = cr.filter((r) => r.violation).length;
            const denom = cOk + cOut;
            const okPct = denom ? Math.round((cOk / denom) * 100) : 100;
            const rowsHtml = cr.map((r) => {
                const cls = r.compliant ? 'in' : (r.violation ? 'out' : 'na');
                return `<div class="food-cl-row food-cl-${cls}">
                    <span class="food-cl-disp food-cl-disp-${cls}">${esc(r.disposition || (r.compliant ? 'IN' : 'OUT'))}</span>
                    <span class="food-cl-item">#${esc(r.item ?? '?')}</span>
                    ${r.cos ? '<span class="food-dispos food-dispos-cos">fixed</span>' : ''}
                    ${r.repeat ? '<span class="food-flag-repeat">repeat</span>' : ''}
                    <span class="food-cl-text">${esc(r.standard_text)}</span>
                </div>`;
            }).join('');
            return `<details class="food-cl-cat${cOut ? ' has-out' : ''}">
                <summary>
                    <span class="food-cl-cat-name">${esc(c)}</span>
                    <span class="food-cl-cat-count">${cOk}/${denom}</span>
                    <span class="food-cl-cat-bar"><span style="width:${okPct}%"></span></span>
                </summary>
                <div class="food-cl-rows">${rowsHtml}</div>
            </details>`;
        }).join('');
        return `<details class="food-checklist">
            <summary class="text-muted small">Inspection checklist — ${presentation.count ?? 0} distinct applicable code items · ${rows.length} published rows · ${out} OUT</summary>
            <div class="food-checklist-body">${cats_html}</div>
        </details>`;
    }

    _renderTemps(tv, fallback) {
        const has = tv && (tv.food_present || tv.warewashing_present || tv.equipment_present);
        if (!has) return this._renderTempsLegacy(fallback);
        const out = [];
        if (tv.food_present && (tv.food || []).length) {
            out.push(`<div class="food-temp-cat">Food temperatures</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Item</th><th>Temp</th><th>State</th></tr>`
                + tv.food.map((r) => {
                    const bad = this._foodTempBad(r);
                    return `<tr class="${bad ? 'food-temp-bad' : ''}"><td>${esc(r.description || '')}</td>`
                        + `<td>${esc(r.temperature || '')}</td><td>${esc(r.state_of_food || '')}`
                        + `${bad ? ' <i class="bi bi-exclamation-triangle" title="outside the safe holding range"></i>' : ''}</td></tr>`;
                }).join('') + `</table></div>`);
        }
        if (tv.warewashing_present && (tv.warewashing || []).length) {
            out.push(`<div class="food-temp-cat">Warewashing &amp; sanitizer</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Machine</th><th>Method</th><th>PPM</th><th>Temp</th></tr>`
                + tv.warewashing.map((r) => {
                    const bad = this._sanitizerBad(r);
                    const chem = [r.method, r.sanitizer_type || r.sanitizer_name].filter(Boolean).join(' ');
                    return `<tr class="${bad ? 'food-temp-bad' : ''}"><td>${esc(r.machine || '')}</td>`
                        + `<td>${esc(chem)}</td><td>${r.ppm != null ? esc(r.ppm) : ''}`
                        + `${bad ? ' <i class="bi bi-exclamation-triangle" title="sanitizer concentration / temp out of range"></i>' : ''}</td>`
                        + `<td>${esc(r.temperature || '')}</td></tr>`;
                }).join('') + `</table></div>`);
        }
        if (tv.equipment_present && (tv.equipment || []).length) {
            out.push(`<div class="food-temp-cat">Equipment temperatures</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Equipment</th><th>Temp</th></tr>`
                + tv.equipment.map((r) =>
                    `<tr><td>${esc(r.description || '')}</td><td>${esc(r.temperature || '')}</td></tr>`).join('')
                + `</table></div>`);
        }
        if (!out.length) return this._renderTempsLegacy(fallback);
        const n = (tv.food || []).length + (tv.warewashing || []).length + (tv.equipment || []).length;
        return `<details class="food-temps"><summary class="text-muted small">Temperatures &amp; sanitizer (${n} readings)</summary>${out.join('')}</details>`;
    }

    _renderTempsLegacy(temps) {
        if (!temps || !temps.length) return '';
        return `<details class="food-temps">
            <summary class="text-muted small">Temperature log (${temps.reduce((n, t) => n + t.rows.length, 0)} readings)</summary>
            ${temps.map((t) => `<div class="food-temp-cat">${esc(t.category)}</div>`
                + `<div class="food-temp-scroll"><table class="food-temp-table">${t.rows.map((r) =>
                    `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`).join('')}
        </details>`;
    }

    _foodTempBad(r) {
        const t = typeof r.temperature_f === 'number' ? r.temperature_f : null;
        if (t == null) return false;
        const s = (r.state_of_food || '').toLowerCase();
        if (s.includes('cold')) return t > 41;
        if (s.includes('hot')) return t < 135;
        return false;
    }

    _sanitizerBad(r) {
        const method = (r.method || '').toLowerCase();
        if (method.includes('high') || method.includes('heat'))
            return typeof r.temperature_f === 'number' && r.temperature_f < 160;
        const ppm = typeof r.ppm === 'number' ? r.ppm : null;
        if (ppm == null) return false;
        const type = (r.sanitizer_type || r.sanitizer_name || '').toLowerCase();
        if (type.includes('chlor')) return ppm < 50 || ppm > 200;
        if (type.includes('quat')) return ppm < 150 || ppm > 400;
        return ppm < 50;
    }
}
