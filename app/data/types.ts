/**
 * Contract V4 row shapes (architecture-v4.md §6.2, ratified CPD-M0) as
 * checked types — D-CR-LANG-1's payoff surface. Two disciplines these types
 * encode on purpose:
 *
 *   · `loc` / `pt` / `latest_scope_code` are numbers, NEVER closed unions:
 *     the vocabularies are append-only (a code is positional identity), and a
 *     union would make the client reject a legally appended class (§5, C9).
 *   · The overlay decodes by the shard's own `columns` — the decoded row is
 *     the fields we know today plus whatever a future contract adds.
 *
 * Runtime validation stays in the client's contract checks; these types
 * document what the checks admit.
 */

/** A finder row — active permits, judgment-free identity/location (§6.2). */
export interface FinderRow {
    permit_id: string
    name: string
    address: string | null
    address2: string | null
    city: string | null
    zip: string | null
    tenant: string
    is_restaurant: boolean
    mobile: boolean
    /** Code into `manifest.vocab.permit_type` (append-only). */
    pt: number
    lat: number
    lon: number
    /** Location class: 0 rooftop · 1 street · 2 zip_centroid · 3 venue · … (append-only). */
    loc: number
}

/** One `visits` entry — `[kind, yyyymmdd, ...values]` (D-DATA-13); kinds
 *  share the scope code space (0 unknown · 1 broad · 2 focused) plus 3
 *  narrative. Variable arity by design. */
export type VisitEntry = readonly number[]

/** A decoded overlay row (position-aligned to its finder row, decoded by the
 *  shard's `columns`). Nine fields + `visits` today; open to appends. */
export interface OverlayRow {
    grade_score?: number | null
    new?: number | null
    trend_delta?: number | null
    latest_yyyymmdd?: number | null
    base_yyyymmdd?: number | null
    latest_scope_code?: number | null
    latest_out?: number | null
    latest_items?: number | null
    compliance_pct?: number | null
    visits?: VisitEntry[] | null
    [column: string]: unknown
}

/** A roster row as the app holds it: finder fields, plus `o` on the full
 *  tier, plus `status` once the closed family merges in. */
export interface RosterRow extends FinderRow {
    o?: OverlayRow
    status?: string
}

/** A closed-family row on the wire: finder fields + status + positional `o`. */
export interface ClosedWireRow extends FinderRow {
    status: string
    o: readonly unknown[]
}

export interface ShardDescriptor {
    path: string
    bucket: number
    sha256: string
    bytes: number
    records: number
}

export interface ManifestVocab {
    permit_type: string[]
    loc: string[]
    scope: string[]
}

export interface ManifestFreshness {
    snapshot_id: string
    newest_report: string
}

interface ManifestBase {
    contract: string
    schema_version: number
    available: boolean
    mode: string
    snapshot_id: string
    fetched_at: string
    freshness: ManifestFreshness
    vocab: ManifestVocab
}

export interface LiteManifest extends ManifestBase {
    counts: { total: number; by_zip?: Record<string, number> }
    resources: { finder: { shards: ShardDescriptor[] } }
}

export interface FullManifest extends ManifestBase {
    counts: {
        total: number
        active: number
        closed: number
        by_grade?: Record<string, number>
        by_zip?: Record<string, number>
    }
    resources: {
        finder: { shards: ShardDescriptor[] }
        overlay: { shards: ShardDescriptor[] }
        closed: { shards: ShardDescriptor[] }
        standards: { path: string }
        details: { path_template: string; records?: number }
    }
}

export interface FinderShard {
    contract: string
    schema_version: number
    bucket: string
    facilities: FinderRow[]
}

export interface OverlayShard {
    contract: string
    schema_version: number
    bucket: string
    finder_sha256: string
    columns: string[]
    rows: readonly (readonly unknown[])[]
}

export interface ClosedShard {
    contract: string
    schema_version: number
    bucket: string
    facilities: ClosedWireRow[]
}

/** A raw checklist cell — `[item, disposition, flags, override?]`. */
export type ChecklistCell = readonly [
    number | null,
    string,
    number,
    { c?: string; t?: string }?,
]

export interface DecodedChecklistRow {
    item: number | null
    disposition: string
    category: string
    standard_text: string
    compliant: boolean
    violation: boolean
    cos: boolean
    repeat: boolean
    is_sentinel: boolean
}

export interface Violation {
    item?: number | null
    code?: string | null
    text?: string
    [key: string]: unknown
}

export interface Adjudication {
    status?: string
    verdict?: string
    items?: Record<string, string>
    findings?: { item?: number | null; code?: string | null; word?: string }[]
}

/** One inspection as the detail carries it (V3-shaped since before V4;
 *  fields optional — payload generations vary, presentation degrades). */
export interface Inspection {
    date?: string | null
    score?: number | null
    scope?: string
    purpose?: string
    insp_type?: string
    inspection_id?: string
    report_url?: string
    /** The inspecting department's own recorded outcome (the Fairfax Health
     *  District: Passed / Partial Pass / Failed …) — provenance shown with its
     *  explanation, never an input to the score (FFX-M4, OQ-D). VDH rows
     *  carry none. */
    source_outcome?: string | null
    /** `false` on a visit the department lists but whose report the archive
     *  does not hold (FFX-M4, OQ-I): scope unknown, on its date, linking to
     *  the department's copy. Absent on every loaded report. */
    report_available?: boolean
    comments?: string
    checklist?: DecodedChecklistRow[] | ChecklistCell[]
    checklist_present?: boolean
    checklist_summary?: {
        applicable_item_count?: number | null
        form_item_count?: number | null
        out_item_count?: number | null
        compliant?: number | null
        out?: number | null
    }
    addressed_item_count?: number | null
    applicable_item_count?: number | null
    form_item_count?: number | null
    out_item_count?: number | null
    checklist_compliant?: number | null
    checklist_out?: number | null
    violations?: Violation[]
    adjudication?: Adjudication
    [key: string]: unknown
}

export interface GradeBlock {
    score?: number | null
    letter?: string
    adjusted?: boolean
    base_score?: number | null
    base_letter?: string
    base_date?: string | null
    followups?: number
    followup_date?: string | null
    restored_items?: number[]
    failed_items?: number[]
    cos_items?: number[]
    new_items?: number[]
    unchecked_items?: number[]
    restored_findings?: number[] | null
    failed_findings?: number[] | null
    cos_findings?: number[] | null
    unchecked_findings?: number[] | null
    restored_points?: number
    extra_points?: number
    narrative_followups?: number
    narrative_items?: number[]
    base_inspection_id?: string | null
}

/** The per-facility detail (`facility/{permit_id}.json`), or the client's
 *  honest unavailable shape. */
export interface FacilityDetail {
    contract?: string
    schema_version?: number
    available: boolean
    reason?: string
    _httpStatus?: number
    facility?: DetailFacility
    inspections?: Inspection[]
}

/** The facility object inside a detail — detail fields over the merged
 *  roster row (the client spreads the roster row underneath it). */
export interface DetailFacility extends Partial<RosterRow> {
    permit_id?: string
    /** Named only on the Fairfax Health District's details (FFX-M4); the
     *  `tenant` sentinel is what the presentation branches on. */
    jurisdiction_source?: string
    grade?: GradeBlock
    latest?: Inspection | null
    latest_assessment?: Inspection | null
    newly_permitted?: boolean
    permit_type?: string
    location?: {
        lat?: number | null
        lon?: number | null
        source?: string
        [key: string]: unknown
    }
    [key: string]: unknown
}

/** What `getFoodFacilities()` resolves to on a loaded tier. */
export interface LoadedRoster {
    contract: string
    schema_version: number
    mode: string
    snapshot_id: string
    freshness: ManifestFreshness
    vocab: ManifestVocab
    facilities: RosterRow[]
    [key: string]: unknown
}

/** …or the honest failure shape when nothing could be read. */
export interface RosterUnavailable {
    available: false
    reason: string
    _httpStatus?: number
}

export type RosterResult = LoadedRoster | RosterUnavailable

export const STANDARDS_FALLBACK: Record<string, { category?: string; text?: string }> = {}
