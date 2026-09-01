/**
 * Presentation math — pure functions, no DOM (ports `presentation.js` per
 * design ref §5): the VDH permit link, the grade palette lookup, one
 * inspection's scope / count / outcome contract, the narrative-verdict and
 * facility-grade presentations, the Contract V4 overlay adapters, the scope
 * series behind the trend instrument, and the date formatters. Every
 * displayed judgment keeps deriving client-side from the overlay/detail
 * (C1, C9); the grade letter is never shipped — always `gradeForScore`.
 *
 * The old module's HTML emitters (`esc`, `focusedOutcomeBadge`) do not port:
 * React owns markup. The grade-receipt mirror (`receipt.js`) ports with the
 * report-card modal at CRV-a, alongside its suite.
 */

import { AGGREGATE_TENANT, GRADE_COLORS, PORTAL_BASE, RF_MAX_ITEM } from '../constants'
import type {
    Adjudication, DecodedChecklistRow, GradeBlock, Inspection, OverlayRow,
    VisitEntry, Violation,
} from './types'

/** Anything the presentation reads facility-shaped: a V4 roster row, a
 *  closed row, or a detail facility. All fields optional — degrade, never
 *  throw. Explicit (no index signature) so concrete rows assign cleanly. */
export interface FacilityLike {
    permit_id?: string
    name?: string | null
    address?: string | null
    address2?: string | null
    city?: string | null
    zip?: string | null
    tenant?: string
    is_restaurant?: boolean
    mobile?: boolean
    permit_type?: string
    pt?: number
    lat?: number | null
    lon?: number | null
    loc?: number
    status?: string
    newly_permitted?: boolean
    o?: OverlayRow
    grade?: GradeBlock
    latest?: Inspection | null
    latest_assessment?: Inspection | null
    location?: { lat?: number | null; lon?: number | null; source?: string }
}

// ── Contract V4 roster row adapters ─────────────────────────────────────

export const OVERLAY_SCOPES = ['unknown', 'broad', 'focused'] as const

/** "Declining" is banded (CRP-M1b, Cannon 2026-08-31): strictly MORE than
 *  this many points of grade-to-grade drop. Mirrors the exporter's
 *  cf_export_site.TREND_DECLINE_BAND and the old client's
 *  static/js/presentation.js — change all three together. */
export const TREND_DECLINE_BAND = 5
// Codes are identity, not a quality ordering. `venue` is a better pin than
// `street` but is APPENDED at 3, because the exporter may only ever append.
export const LOCATION_CLASS = { rooftop: 0, street: 1, zip_centroid: 2, venue: 3 } as const

/** yyyymmdd int → ISO date, or null. */
export function isoFromYmd(value: unknown): string | null {
    if (!Number.isInteger(value) || (value as number) <= 0) return null
    const text = String(value).padStart(8, '0')
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
}

/** Effective coordinates of a roster row (V4: top-level lat/lon) or a
 *  detail facility (nested location). */
export function coordsOf(f: FacilityLike | null | undefined): { lat: number | null; lon: number | null } {
    const lat = f?.lat ?? f?.location?.lat ?? null
    const lon = f?.lon ?? f?.location?.lon ?? null
    return { lat, lon }
}

/** The finder's `loc` code, or derived from a detail's location.source. */
export function locationClass(f: FacilityLike | null | undefined): number {
    if (f && Number.isInteger(f.loc)) return f.loc as number
    const source = f?.location?.source
    if (source === 'zip_centroid') return LOCATION_CLASS.zip_centroid
    if (source === 'venue_anchor') return LOCATION_CLASS.venue
    if (source === 'census_batch' || source === 'census_oneline'
        || source === 'vgin_street') return LOCATION_CLASS.street
    return LOCATION_CLASS.rooftop
}

/** Short qualifier for an approximate pin, '' when it is rooftop-quality.
 *  One switch, so a new class cannot be qualified in one surface and
 *  silently unqualified in the other (C9: both tiers qualify all three). */
export function approximateLabel(f: FacilityLike | null | undefined): string {
    switch (locationClass(f)) {
        case LOCATION_CLASS.zip_centroid: return 'approximate location'
        case LOCATION_CLASS.venue: return 'venue-level'
        case LOCATION_CLASS.street: return 'street-level'
        default: return ''
    }
}

/** The last-visit date of a roster row or detail facility, ISO or null. */
export function latestDateOf(f: FacilityLike | null | undefined): string | null {
    return f?.latest?.date ?? isoFromYmd(f?.o?.latest_yyyymmdd) ?? null
}

/** Newly permitted, from the overlay (`new`) or a detail's flag. */
export function isNewlyPermitted(f: FacilityLike | null | undefined): boolean {
    return f?.newly_permitted === true || f?.o?.new === 1
}

/** Whether a roster row / facility is an active permit. V4 finder rows carry
 *  no status (active by construction); closed rows and details do. */
export function isActivePermit(f: FacilityLike | null | undefined): boolean {
    if (f?.status == null) return true
    return String(f.status).toLowerCase().includes('permitted')
}

function overlayGrade(o: FacilityLike['o']): { score: number; base_date: string | null } | null {
    if (!o || o.grade_score == null || !Number.isFinite(Number(o.grade_score))) return null
    return { score: Number(o.grade_score), base_date: isoFromYmd(o.base_yyyymmdd) }
}

export interface InspectionView {
    scope: string
    count: number | null
    formCount: number | null
    broadEligible: boolean
    gradeEligible: boolean
    score: number | null
    compliant: number | null
    out: number | null
    outIsDistinct: boolean
    date?: string | null
}

/** The latest visit as an InspectionView, from the overlay: scope + count
 *  (+ OUT for a focused visit). No score for a single visit — the facility
 *  grade is the verdict. */
function overlayLatestPresentation(o: NonNullable<FacilityLike['o']>): InspectionView {
    const scopeCode = o?.latest_scope_code
    const scope = (Number.isInteger(scopeCode) && OVERLAY_SCOPES[scopeCode as number]) || 'unknown'
    const count = Number.isFinite(Number(o?.latest_items)) && o.latest_items != null
        ? Number(o.latest_items) : null
    const out = Number.isFinite(Number(o?.latest_out)) && o.latest_out != null
        ? Number(o.latest_out) : null
    return {
        scope, count, formCount: count,
        broadEligible: scope === 'broad', gradeEligible: false,
        score: null, compliant: null, out,
        outIsDistinct: scope === 'focused' && out != null,
        date: isoFromYmd(o?.latest_yyyymmdd),
    }
}

/** Deep link to a facility's official VDH permit page — tenant-SCOPED (P8):
 *  a facility a district claimed is ABSENT from the `virginia` aggregate.
 *  Pre-tenant payloads degrade to the aggregate — never a broken link. */
export function permitUrl(f: FacilityLike | null | undefined, tenant?: string): string {
    const t = tenant || f?.tenant || AGGREGATE_TENANT
    return `${PORTAL_BASE}/${encodeURIComponent(t)}/permit/?permitID=`
        + encodeURIComponent(f?.permit_id ?? '')
}

export function gradeColor(grade: string | null | undefined): string {
    return (grade && GRADE_COLORS[grade]) || (GRADE_COLORS['none'] as string)
}

export function gradeForScore(score: number): string {
    if (score >= 90) return 'A'
    if (score >= 80) return 'B'
    if (score >= 70) return 'C'
    if (score >= 60) return 'D'
    return 'F'
}

const BROAD_MIN_FORM_ITEMS = 20

function decodedRows(checklist: Inspection['checklist']): DecodedChecklistRow[] {
    if (!Array.isArray(checklist)) return []
    // The client decodes checklists on the click path; raw positional cells
    // reaching here would mean an undecoded payload — treat as no rows.
    return checklist.filter((row): row is DecodedChecklistRow =>
        !!row && typeof row === 'object' && !Array.isArray(row))
}

function distinctFormItems(checklist: Inspection['checklist']): number {
    const items = new Set<number>()
    for (const row of decodedRows(checklist)) {
        const item = Number.isInteger(row.item) ? row.item : null
        if (item != null && item !== 99 && !row.is_sentinel) items.add(item)
    }
    return items.size
}

function distinctApplicableItems(checklist: Inspection['checklist']): number {
    const items = new Set<number>()
    for (const row of decodedRows(checklist)) {
        const item = Number.isInteger(row.item) ? row.item : null
        const applicable = ['IN', 'OUT'].includes(String(row.disposition || '').toUpperCase())
        if (item != null && item !== 99 && !row.is_sentinel && applicable) items.add(item)
    }
    return items.size
}

function distinctOutItems(checklist: Inspection['checklist']): number {
    const items = new Set<number>()
    for (const row of decodedRows(checklist)) {
        const item = Number.isInteger(row.item) ? row.item : null
        const isOut = row.violation || String(row.disposition || '').toUpperCase() === 'OUT'
        if (item != null && item !== 99 && !row.is_sentinel && isOut) items.add(item)
    }
    return items.size
}

/** One inspection's single presentation contract: broad, focused, or
 *  unknown. An inspection has a SCORE, never a letter — `gradeEligible`
 *  only means broad + scored (eligible to ANCHOR the facility grade). */
export function inspectionPresentation(insp: Inspection | null = null): InspectionView {
    if (!insp) {
        return {
            scope: 'unknown', count: null, formCount: null,
            broadEligible: false, gradeEligible: false,
            score: null, compliant: null, out: null, outIsDistinct: false,
        }
    }
    const cs = insp.checklist_summary || {}
    // Focused hybrid reports can address more items than their structured
    // checklist carries; the exporter publishes that union as
    // addressed_item_count. Broad reports retain the raw denominator.
    let count = insp.addressed_item_count
        ?? insp.applicable_item_count ?? cs.applicable_item_count ?? null
    let formCount = insp.form_item_count ?? cs.form_item_count ?? null
    const hasChecklistShape = Array.isArray(insp.checklist)
        && (insp.checklist.length > 0 || insp.checklist_present === true)
    if (count == null && hasChecklistShape) {
        count = distinctApplicableItems(insp.checklist)
    }
    if (formCount == null && hasChecklistShape) {
        formCount = distinctFormItems(insp.checklist)
    }
    // Pre-M3 compact records carried only the breadth count.
    if (formCount == null) formCount = count
    if (count != null) count = Math.max(0, Number(count) || 0)
    if (formCount != null) formCount = Math.max(0, Number(formCount) || 0)
    // Breadth is the gate: never let a stale scope label promote a
    // 0- or 1–19-form-item report into a grade.
    const scope = insp.checklist_present === false || formCount == null || formCount === 0
        ? 'unknown' : formCount >= BROAD_MIN_FORM_ITEMS ? 'broad' : 'focused'
    const score = Number.isFinite(Number(insp.score)) && insp.score !== null
        ? Number(insp.score) : null
    const broadEligible = scope === 'broad'
    const gradeEligible = broadEligible && score != null
    const compliant = insp.checklist_compliant ?? cs.compliant
        ?? (Array.isArray(insp.checklist)
            ? decodedRows(insp.checklist).filter((row) =>
                String(row.disposition || '').toUpperCase() === 'IN').length : null)
    const hasChecklistRows = Array.isArray(insp.checklist) && insp.checklist.length > 0
    const publishedDistinctOut = insp.out_item_count ?? cs.out_item_count ?? null
    const outIsDistinct = hasChecklistRows || publishedDistinctOut != null
    const hasEffectiveUnion = insp.addressed_item_count != null && publishedDistinctOut != null
    const out = hasEffectiveUnion
        ? publishedDistinctOut
        : hasChecklistRows
            ? distinctOutItems(insp.checklist)
            : publishedDistinctOut ?? insp.checklist_out ?? cs.out ?? null
    return {
        scope, count, formCount, broadEligible, gradeEligible, score,
        compliant, out, outIsDistinct,
    }
}

/** The violation-count chip row — total + risk-factor / retail-practice
 *  split. `show` is false ONLY on a scope-unknown row with nothing recorded
 *  (a green zero there reads as "verified clean" when breadth is unknown). */
export function inspectionCountsPresentation(insp: Inspection | null = null): {
    n: number; rf: number; grp: number; show: boolean
} {
    const violations: Violation[] = (insp && insp.violations) || []
    const n = violations.length
    const rf = violations.filter((v) => Number.isInteger(v.item) && (v.item as number) <= RF_MAX_ITEM).length
    const grp = n - rf
    const show = n > 0 || inspectionPresentation(insp).scope !== 'unknown'
    return { n, rf, grp, show }
}

export interface FocusedOutcome {
    out: number | null
    total: number | null
    label: string
    complianceRate: number | null
    tone: string
    ratioKnown: boolean
    description: string
}

/** Compliance-colored focused outcome, deliberately separate from grading. */
export function focusedOutcomePresentation(view: Partial<InspectionView> = {}): FocusedOutcome {
    const totalValue = Number(view.count)
    const outValue = Number(view.out)
    const total = Number.isFinite(totalValue) && totalValue > 0 ? Math.trunc(totalValue) : null
    const out = view.out !== null && view.out !== undefined
        && Number.isFinite(outValue) && outValue >= 0
        ? Math.trunc(outValue) : null
    if (view.outIsDistinct === false) {
        const label = out == null
            ? 'OUT count unavailable'
            : `${out} OUT marking${out === 1 ? '' : 's'}`
        return {
            out, total, label, complianceRate: null, tone: 'unknown', ratioKnown: false,
            description: out == null
                ? 'Focused OUT count is unavailable'
                : `${label}; distinct OUT-item ratio is unavailable`,
        }
    }
    const consistent = total != null && out != null && out <= total
    if (!consistent) {
        const label = `${out ?? '?'}/${total ?? '?'} OUT`
        return {
            out, total, label, complianceRate: null, tone: 'unknown', ratioKnown: false,
            description: out != null && total != null
                ? `${label}; focused outcome counts are inconsistent`
                : `${label}; focused OUT count is unavailable`,
        }
    }
    const complianceRate = (total - out) / total
    const tone = out === 0 ? 'clear'
        : complianceRate >= 0.75 ? 'good'
            : complianceRate >= 0.5 ? 'watch'
                : out < total ? 'warning' : 'severe'
    const pct = Math.round(complianceRate * 100)
    return {
        out, total, label: `${out}/${total} OUT`, complianceRate, tone, ratioKnown: true,
        description: `${out} of ${total} focused items marked OUT; ${pct}% in compliance`,
    }
}

export interface NarrativeVerdictView {
    verdict: string
    tone: string
    glyph: string
    height: number
    count: number | null
    label: string
    detail: string
}

/** An adjudicated follow-up's actionable verdict, or null. `height` is the
 *  trend plot height (0–100); `count` distinguishes a targeted credit (✓2)
 *  from a blanket clear (bare ✓). */
export function narrativeVerdictPresentation(insp: Inspection | null = null): NarrativeVerdictView | null {
    const adj: Adjudication | undefined = insp?.adjudication
    if (!adj || adj.status !== 'adjudicated' || !adj.verdict) return null
    switch (adj.verdict) {
        case 'all_corrected':
            return {
                verdict: 'all_corrected', tone: 'clear', glyph: '✓', height: 100, count: null,
                label: 'All violations corrected',
                detail: 'Inspector recorded every prior violation corrected on this follow-up.',
            }
        case 'priority_corrected':
            return {
                verdict: 'priority_corrected', tone: 'good', glyph: '✓', height: 85, count: null,
                label: 'Priority violations corrected',
                detail: 'Inspector recorded the priority (risk-factor) violations corrected; remaining items were not addressed.',
            }
        case 'none_corrected':
            return {
                verdict: 'none_corrected', tone: 'severe', glyph: '✗', height: 0, count: null,
                label: 'Violations not corrected',
                detail: 'Inspector recorded the prior violations NOT corrected on this follow-up.',
            }
        case 'items': {
            const items = adj.items && typeof adj.items === 'object' ? adj.items : null
            if (!items) return null
            const byWord = (want: string) => Object.keys(items)
                .filter((k) => String(items[k]).toUpperCase() === want)
                .sort((a, b) => Number(a) - Number(b)).map((k) => `#${k}`)
            const ins = byWord('IN')
            const outs = byWord('OUT')
            if (!ins.length && !outs.length) return null
            const label = outs.length
                ? (ins.length ? `Items ${ins.join(', ')} corrected · ${outs.join(', ')} still out`
                    : `Items ${outs.join(', ')} still out`)
                : `Items ${ins.join(', ')} corrected`
            const count = ins.length || outs.length
            const noun = ins.length
                ? `${ins.length} item${ins.length === 1 ? '' : 's'} corrected`
                : `${outs.length} item${outs.length === 1 ? '' : 's'} still out`
            return {
                verdict: 'items', glyph: ins.length ? '✓' : '✗',
                tone: outs.length ? (ins.length ? 'watch' : 'severe') : 'good',
                height: Math.round((100 * ins.length) / (ins.length + outs.length)),
                count, label,
                detail: `Inspector enumerated item-by-item outcomes in the comments — ${noun}`
                    + `${ins.length && outs.length ? `, ${outs.length} still out` : ''}.`
                    + ' Only the named items adjust the grade; anything unmentioned keeps its full deduction.',
            }
        }
        default:
            return null
    }
}

export interface GradeView {
    score: number
    letter: string
    adjusted: boolean
    baseScore: number
    baseLetter: string
    baseDate: string | null
    followups: number
    followupDate: string | null
    restored: number[]
    failed: number[]
    cos: number[]
    newItems: number[]
    unchecked: number[]
    restoredFindings: number[] | null
    failedFindings: number[] | null
    cosFindings: number[] | null
    uncheckedFindings: number[] | null
    restoredPoints: number
    extraPoints: number
    narrativeFollowups: number
    narrativeItems: number[]
    baseInspectionId: string | null
}

/** The facility grade — a SCORE plus a derived LETTER; null when there is no
 *  scored broad assessment. No fallback: a grade exists or it doesn't. */
export function gradePresentation(facility: FacilityLike = {}): GradeView | null {
    const g: GradeBlock | { score: number; base_date: string | null } | null =
        facility.grade || overlayGrade(facility.o) || null
    const score = g != null && Number.isFinite(Number(g.score)) ? Number(g.score) : null
    if (score == null || g == null) return null
    const gb = g as GradeBlock
    const baseScore = Number.isFinite(Number(gb.base_score)) ? Number(gb.base_score) : score
    return {
        score,
        letter: gb.letter || gradeForScore(score),
        adjusted: !!gb.adjusted,
        baseScore,
        baseLetter: gb.base_letter || gradeForScore(baseScore),
        baseDate: gb.base_date || null,
        followups: Number(gb.followups) || 0,
        followupDate: gb.followup_date || null,
        restored: gb.restored_items || [],
        failed: gb.failed_items || [],
        cos: gb.cos_items || [],
        newItems: gb.new_items || [],
        unchecked: gb.unchecked_items || [],
        restoredFindings: gb.restored_findings || null,
        failedFindings: gb.failed_findings || null,
        cosFindings: gb.cos_findings || null,
        uncheckedFindings: gb.unchecked_findings || null,
        restoredPoints: Number(gb.restored_points) || 0,
        extraPoints: Number(gb.extra_points) || 0,
        narrativeFollowups: Number(gb.narrative_followups) || 0,
        narrativeItems: gb.narrative_items || [],
        baseInspectionId: gb.base_inspection_id || null,
    }
}

export interface FacilityView {
    latest: InspectionView
    latestDate: string | null
    assessment: InspectionView | null
    assessmentRecord: unknown
    grade: GradeView | null
    trend: never[]
    trendDelta: number | null
    declining: boolean
}

/** Pair the newest event with the one facility-level grade assessment. */
export function facilityPresentation(facility: FacilityLike = {}): FacilityView {
    if (facility.o && !facility.latest) {
        // A Contract V4 roster row: everything the map and List need at boot
        // rides on the overlay.
        const o = facility.o
        const latest = overlayLatestPresentation(o)
        const compliance = Number.isFinite(Number(o.compliance_pct)) && o.compliance_pct != null
            ? Number(o.compliance_pct) / 100 : null
        const baseDate = isoFromYmd(o.base_yyyymmdd)
        const assessmentRecord = baseDate != null || compliance != null
            ? { date: baseDate, compliance_rate: compliance } : null
        // trend_delta is GRADE-to-grade since CRP-M1b (Cannon 2026-08-31):
        // the exporter ships current adjusted grade minus the previous
        // era's (second-newest scored broad + ITS follow-ups). Payloads
        // published before the republish carry the retired raw
        // broad-to-broad difference until they age out.
        const trendDelta = Number.isFinite(Number(o.trend_delta)) && o.trend_delta != null
            ? Number(o.trend_delta) : null
        return {
            latest,
            latestDate: latest.date ?? null,
            assessment: assessmentRecord ? { ...latest, scope: 'broad', broadEligible: true } : null,
            assessmentRecord,
            grade: gradePresentation(facility),
            trend: [],
            trendDelta,
            // BANDED (CRP-M1b): the flag — and the map's ↓ that reads it —
            // fires only past TREND_DECLINE_BAND points of drop. A −5
            // exactly is not declining. Mirrors the exporter's one
            // definition (cannon-food cf_export_site.TREND_DECLINE_BAND).
            declining: trendDelta != null && trendDelta < -TREND_DECLINE_BAND,
        }
    }
    const latest = inspectionPresentation(facility.latest || null)
    const candidate = facility.latest_assessment || null
    let assessmentRecord: Inspection | null = candidate
    let assessment: InspectionView | null = candidate ? inspectionPresentation(candidate) : null
    if (assessment && !assessment.gradeEligible) {
        assessment = null
        assessmentRecord = null
    }
    if (!assessment && latest.gradeEligible) {
        assessment = latest
        assessmentRecord = facility.latest ?? null
    }
    return {
        latest,
        latestDate: facility.latest?.date ?? null,
        assessment,
        assessmentRecord,
        grade: gradePresentation(facility),
        trend: [],
        trendDelta: null,
        declining: false,
    }
}

// ── the overlay's `visits` → the trend series (CPH, D-DATA-13) ───────────

export const VISIT_KIND = { unknown: 0, broad: 1, focused: 2, narrative: 3 } as const
export const VISIT_VERDICT: Record<number, string> = {
    1: 'all_corrected', 2: 'priority_corrected', 3: 'none_corrected', 4: 'items',
}

const EMPTY_PRESENTATION = {
    count: null, formCount: null, broadEligible: false, gradeEligible: false,
    score: null, compliant: null, out: null, outIsDistinct: false,
} satisfies Omit<InspectionView, 'scope'>

export interface ScopeEvent {
    inspection: Inspection
    presentation: InspectionView
    index: number
    historyIndex: number
}

export interface ScopeSeries {
    events: ScopeEvent[]
    broad: ScopeEvent[]
    focused: ScopeEvent[]
    unknown: ScopeEvent[]
}

/** An adjudication block narrativeVerdictPresentation() reads the same way
 *  it reads the detail's — only the IN/OUT counts matter to the trend, so
 *  item numbers are placeholders (the hover card never prints them). */
function syntheticItems(ins: number, outs: number): Record<string, string> {
    const items: Record<string, string> = {}
    for (let i = 1; i <= ins; i++) items[String(i)] = 'IN'
    for (let i = 1; i <= outs; i++) items[String(ins + i)] = 'OUT'
    return items
}

function visitEvent(entry: VisitEntry, index: number, total: number): ScopeEvent {
    const [kind, ymd, ...rest] = Array.isArray(entry) ? entry : []
    const date = isoFromYmd(Number.isInteger(ymd) ? ymd : 0)
    const inspection: Inspection = { date }
    let presentation: InspectionView = { ...EMPTY_PRESENTATION, scope: 'unknown' }
    if (kind === VISIT_KIND.broad) {
        const score = Number.isFinite(rest[0]) ? Number(rest[0]) : null
        inspection.score = score
        presentation = {
            ...EMPTY_PRESENTATION, scope: 'broad', broadEligible: true,
            gradeEligible: score != null, score,
        }
    } else if (kind === VISIT_KIND.focused) {
        const known = rest.length >= 2 && Number.isFinite(rest[0]) && Number.isFinite(rest[1])
        presentation = known
            ? {
                ...EMPTY_PRESENTATION, scope: 'focused', count: Number(rest[1]),
                formCount: Number(rest[1]), out: Number(rest[0]), outIsDistinct: true,
            }
            : { ...EMPTY_PRESENTATION, scope: 'focused' }
    } else if (kind === VISIT_KIND.narrative) {
        const verdict = rest[0] != null ? VISIT_VERDICT[rest[0]] : undefined
        if (verdict === 'items') {
            const ins = Number.isInteger(rest[1]) ? (rest[1] as number) : 0
            const outs = Number.isInteger(rest[2]) ? (rest[2] as number) : 0
            if (ins || outs) {
                inspection.adjudication = { status: 'adjudicated', verdict, items: syntheticItems(ins, outs) }
            }
        } else if (verdict) {
            inspection.adjudication = { status: 'adjudicated', verdict }
        }
    }
    return { inspection, presentation, index, historyIndex: total - 1 - index }
}

/** A Contract V4 roster row's `visits` as the series the trend draws — the
 *  same shape buildScopeSeries() returns for a detail's inspections. */
export function visitsOf(f: FacilityLike | null | undefined): ScopeSeries {
    const visits: VisitEntry[] = Array.isArray(f?.o?.visits) ? f.o.visits : []
    const events = visits.map((entry, index) => visitEvent(entry, index, visits.length))
    return {
        events,
        broad: events.filter((event) => event.presentation.gradeEligible),
        focused: events.filter((event) => event.presentation.scope === 'focused'),
        unknown: events.filter((event) => event.presentation.scope === 'unknown'),
    }
}

/** Oldest-first event positions; only broad points belong to the score
 *  line. `historyIndex` is the exact position in the newest-first history
 *  (dates and report IDs are not guaranteed unique). */
export function buildScopeSeries(inspections: Inspection[] = []): ScopeSeries {
    const events = [...inspections].reverse().map((inspection, index) => ({
        inspection,
        presentation: inspectionPresentation(inspection),
        index,
        historyIndex: inspections.length - 1 - index,
    }))
    return {
        events,
        broad: events.filter((event) => event.presentation.gradeEligible),
        focused: events.filter((event) => event.presentation.scope === 'focused'),
        unknown: events.filter((event) => event.presentation.scope === 'unknown'),
    }
}

export function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso + 'T12:00:00Z')
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Year-less date (M/D) for narrow freshness variants. */
export function fmtDateShort(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso + 'T12:00:00Z')
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Compact numeric date (M/D/YYYY) for provenance lines. */
export function fmtDateNum(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso + 'T12:00:00Z')
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' })
}
