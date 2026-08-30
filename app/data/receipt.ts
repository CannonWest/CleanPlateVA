/**
 * Grade receipt (CRVa-M2) — the client-side mirror of the engine's dock
 * math (cf_lib.violation_dock_map + facility_grade) that reconciles against
 * the published grade block. Pure functions, no DOM; ported from the old
 * `receipt.js` with its semantics intact (the engine-certified fixture
 * suite pins them — tests/vitest/grade-receipt.spec.ts).
 *
 * The mirror RECONCILES every derived figure against the published grade
 * block — base_score, final score, the 1-dp aggregates, bucket membership,
 * follow-up counts. Any mismatch flips `verified` off and the modal
 * degrades to bucket-level prose (published numbers only, no per-item
 * points): the engine stays the single authority; the mirror only ever
 * ADDS resolution, never contradicts. Membership shown to the user always
 * comes from the PUBLISHED buckets, even when verified.
 *
 * All arithmetic runs in integer TEN-THOUSANDTHS of a point: every weight
 * the formula can produce (6/2 · ×1.5 repeat · ×0.75 COS · ×0.65/×0.35
 * restore) is exact in that unit, so float drift can neither fabricate a
 * reconcile failure nor mask a real one.
 */

import { RF_MAX_ITEM } from '../constants'
import {
    focusedOutcomePresentation, gradePresentation, inspectionPresentation,
    narrativeVerdictPresentation,
} from './presentation'
import type { FacilityLike } from './presentation'
import type { GradeBlock, Inspection, Violation } from './types'

const RECEIPT_SCALE = 10000                     // ten-thousandths of a point
const W_RF_TT = 6 * RECEIPT_SCALE               // risk-factor violation
const W_GRP_TT = 2 * RECEIPT_SCALE              // Good-Retail-Practice violation

interface ChecklistRowLike {
    item?: number | null
    violation?: boolean
    compliant?: boolean
    cos?: boolean
    repeat?: boolean
    is_sentinel?: boolean
}

function checklistRows(insp: Inspection | null | undefined): ChecklistRowLike[] {
    // The click path always decodes cells into rows before the receipt runs
    // (client.ts); a raw-cell array would simply produce no words here.
    return Array.isArray(insp?.checklist)
        ? (insp.checklist as unknown as ChecklistRowLike[])
        : []
}

const receiptIsRepeatText = (text: string | undefined) => /\brepeat\b/i.test(text || '')
// cf_lib.is_followup: purpose/type marks the visit a re-check.
const receiptIsFollowup = (insp: Inspection | null | undefined) =>
    /follow/.test(`${insp?.purpose || ''} ${insp?.insp_type || ''}`.toLowerCase())

// cf_lib.doc_scope: the STORED scope wins (the exporter computed it with the
// engine's own rules); breadth-derivation is only the legacy fallback. This
// deliberately differs from inspectionPresentation's stale-label guard —
// the receipt must see the rows exactly as the grade engine saw them.
function receiptScope(insp: Inspection): string {
    const scope = insp?.scope
    if (scope === 'broad' || scope === 'focused' || scope === 'unknown') return scope
    return inspectionPresentation(insp).scope
}

interface ItemWord {
    word: 'IN' | 'OUT' | 'OUT_COS'
    repeat: boolean
}

// cf_lib.checklist_item_words: item → {word: IN|OUT|OUT_COS, repeat}. Any
// OUT row makes the item OUT; it softens to OUT_COS only when every OUT row
// was corrected on site. N/A and N/O rows do not address the item.
function receiptItemWords(checklist: ChecklistRowLike[]): Map<number, ItemWord> {
    const seen = new Map<number, ItemWord>()
    for (const row of checklist || []) {
        const item = Number.isInteger(row.item) ? (row.item as number) : null
        if (item == null || row.is_sentinel) continue
        if (!(row.compliant || row.violation)) continue
        const cur = seen.get(item) || { word: 'IN' as const, repeat: false }
        if (row.violation) {
            if (cur.word === 'IN') cur.word = row.cos ? 'OUT_COS' : 'OUT'
            else if (cur.word === 'OUT_COS' && !row.cos) cur.word = 'OUT'
        }
        cur.repeat = cur.repeat || !!row.repeat
        seen.set(item, cur)
    }
    return seen
}

/** cf_lib.observation_badges: each observation's OWN [repeat, cos] badges,
 *  parallel to `violations`. The portal renders one checklist row per
 *  violation, so both are properties of the violation, not of the item
 *  number, and the pairing is POSITIONAL: the k-th OUT row for an item
 *  belongs to that item's k-th observation. Where the counts disagree, or
 *  no checklist was published, the item falls back to the older item-level
 *  merge — strictly harsher, so it can only over-charge, never invent a
 *  credit the source did not record. */
function receiptObservationBadges(
    violations: Violation[],
    checklist: ChecklistRowLike[],
): Array<[boolean, boolean]> {
    const obs = violations || []
    const rows = new Map<number, ChecklistRowLike[]>()
    for (const r of checklist || []) {
        if (!Number.isInteger(r.item) || r.is_sentinel || !r.violation) continue
        const item = r.item as number
        if (!rows.has(item)) rows.set(item, [])
        rows.get(item)?.push(r)
    }
    const repeatItems = new Set((checklist || [])
        .filter((r) => r.repeat && Number.isInteger(r.item)).map((r) => r.item as number))
    const cosItems = new Set([...receiptItemWords(checklist || [])]
        .filter(([, w]) => w.word === 'OUT_COS').map(([item]) => item))

    const totals = new Map<number | null, number>()
    for (const o of obs) {
        const item = Number.isInteger(o.item) ? (o.item as number) : null
        totals.set(item, (totals.get(item) || 0) + 1)
    }
    const seen = new Map<number | null, number>()
    return obs.map((o): [boolean, boolean] => {
        const item = Number.isInteger(o.item) ? (o.item as number) : null
        const paired = item != null ? rows.get(item) : undefined
        const n = seen.get(item) || 0
        seen.set(item, n + 1)
        if (paired && paired.length === totals.get(item)) {
            const row = paired[n]
            return [!!row?.repeat, !!row?.cos]
        }
        return [item != null && repeatItems.has(item), item != null && cosItems.has(item)]
    })
}

// cf_lib.norm_violation_code — the key a re-check's violations join back to
// the base's by. Must normalise identically on both sides of the wire.
function receiptNormCode(code: unknown): string | null {
    const text = String(code == null ? '' : code).trim().toUpperCase()
    return text || null
}

interface BaseFinding {
    idx: number
    item: number | null
    code: string | null
    text: string
    pointsTT: number
    fullTT: number
    repeat: boolean
    cos: boolean
}

// cf_lib.base_findings in ten-thousandths: one entry per VIOLATION, in the
// base report's own order. `idx` IS that order — the identity a code cannot
// supply. `pointsTT` carries the ×0.75 COS discount; `fullTT` is what a
// failed re-check revokes back to.
function receiptBaseFindings(base: Inspection): BaseFinding[] {
    const obs = base.violations || []
    const badges = receiptObservationBadges(obs, checklistRows(base))
    return obs.map((observation, i) => {
        const [rowRepeat, rowCos] = badges[i] ?? [false, false]
        const item = Number.isInteger(observation.item) ? (observation.item as number) : null
        let weightTT = item != null && item <= RF_MAX_ITEM ? W_RF_TT : W_GRP_TT
        const repeat = receiptIsRepeatText(observation.text) || rowRepeat
        if (repeat) weightTT = weightTT * 3 / 2
        return {
            idx: i,
            item,
            code: receiptNormCode(observation.code),
            text: observation.text || '',
            pointsTT: rowCos ? weightTT * 3 / 4 : weightTT,
            fullTT: weightTT,
            repeat,
            cos: rowCos,
        }
    })
}

interface Dock {
    pointsTT: number
    fullTT: number
    count: number
    repeat: boolean
    cos: boolean
    repeatCount: number
    cosCount: number
    findings: BaseFinding[]
}

// cf_lib.violation_dock_map: item|null → the item's base deduction, the
// per-item FOLD of receiptBaseFindings so the two cannot drift.
function receiptDockMap(base: Inspection): Map<number | null, Dock> {
    const docks = new Map<number | null, Dock>()
    for (const f of receiptBaseFindings(base)) {
        const dock = docks.get(f.item)
            || {
                pointsTT: 0, fullTT: 0, count: 0, repeat: false, cos: false,
                repeatCount: 0, cosCount: 0, findings: [],
            }
        dock.pointsTT += f.pointsTT
        dock.fullTT += f.fullTT
        dock.count += 1
        dock.repeat = dock.repeat || f.repeat
        dock.cos = dock.cos || f.cos
        if (f.repeat) dock.repeatCount += 1
        if (f.cos) dock.cosCount += 1
        dock.findings.push(f)
        docks.set(f.item, dock)
    }
    return docks
}

// cf_lib.attribute_finding_word — which of an item's base findings a
// re-check's word addresses. Where a code cannot discriminate the whole
// item keeps the older reading — strictly harsher.
function receiptAttribute(word: string, group: BaseFinding[], cited: string[]): BaseFinding[] {
    if (word === 'IN') return group           // a compliant line clears all
    if (group.length === 1 || !cited.length) return group
    const codes = group.map((f) => f.code)
    if (codes.some((c) => c == null)) return group
    if (new Set(codes).size !== codes.length) return group
    const want = new Set(cited)
    const matched = group.filter((f) => f.code != null && want.has(f.code))
    return matched.length ? matched : group
}

// cf_lib.narrative_item_words: an adjudicated verdict resolved against the
// base dock map — narrative words can restore or re-charge an existing
// dock, never mint one, and blankets skip item-less docks.
function receiptNarrativeWords(
    insp: Inspection,
    docks: Map<number | null, Dock>,
): Map<number, ItemWord> {
    const adj = insp.adjudication || {}
    const words = new Map<number, ItemWord>()
    if (adj.status !== 'adjudicated') return words
    const docked = [...docks.keys()].filter((item): item is number => item != null)
    if (adj.verdict === 'all_corrected') {
        docked.forEach((item) => words.set(item, { word: 'IN', repeat: false }))
    } else if (adj.verdict === 'none_corrected') {
        docked.forEach((item) => words.set(item, { word: 'OUT', repeat: false }))
    } else if (adj.verdict === 'priority_corrected') {
        docked.filter((item) => item <= RF_MAX_ITEM)
            .forEach((item) => words.set(item, { word: 'IN', repeat: false }))
    } else if (adj.verdict === 'items') {
        for (const [k, v] of Object.entries(adj.items || {})) {
            const item = Number(k)
            const word = String(v).toUpperCase()
            if (Number.isInteger(item) && docks.has(item)
                && (word === 'IN' || word === 'OUT')) {
                words.set(item, { word, repeat: false })
            }
        }
    }
    return words
}

const RECEIPT_CODE_PREFIX_RE = /^12VAC\d+-\d+-/

function receiptSplitCodePrefix(code: string): [string, string] {
    const m = RECEIPT_CODE_PREFIX_RE.exec(code)
    return m ? [code.slice(0, m[0].length), code.slice(m[0].length)] : ['', code]
}

// Archive-verified 2026-08-15: prefixed codes ("12VAC5-421-820.A.2") always
// use dots; unprefixed raw fragments ("0820 (A2)") use parenthesized groups
// — same regulation, two districts' scrape conventions. Collapsing
// space/parens to dots and inserting a dot at a letter<->digit boundary
// makes both forms compare equal (zero false positives archive-wide).
function receiptNormalizeCodeSuffix(suffix: string): string {
    let s = suffix.trim().toUpperCase()
    s = s.replace(/[\s()]+/g, '.')
    s = s.replace(/(?<=[A-Z])(?=[0-9])/g, '.')
    s = s.replace(/(?<=[0-9])(?=[A-Z])/g, '.')
    s = s.replace(/\.+/g, '.')
    s = s.replace(/^\.+|\.+$/g, '')
    // One district zero-pads the section number against the other's
    // unpadded prefixed form.
    return s.replace(/^0+(?=\d)/, '')
}

// cf_lib.code_matches — comments cite the subsection alone; compares each
// side's suffix after its own stem is stripped, both normalized — never a
// raw substring test.
function receiptCodeMatches(baseCode: string | null, citedCode: string | null): boolean {
    if (!baseCode || !citedCode) return false
    if (baseCode === citedCode) return true
    const [, baseSuffix] = receiptSplitCodePrefix(baseCode)
    const [, citedSuffix] = receiptSplitCodePrefix(citedCode)
    return receiptNormalizeCodeSuffix(baseSuffix) === receiptNormalizeCodeSuffix(citedSuffix)
}

// cf_lib.narrative_finding_words: an adjudicated comment resolved onto BASE
// findings. A `findings` verdict names each citation and joins by code;
// every other verdict is an item-level claim and fans out to every finding
// under the item.
function receiptNarrativeFindingWords(
    insp: Inspection,
    findings: BaseFinding[],
    docks: Map<number | null, Dock>,
): Map<number, ItemWord> {
    const out = new Map<number, ItemWord>()
    const byItem = new Map<number | null, BaseFinding[]>()
    for (const f of findings) {
        if (!byItem.has(f.item)) byItem.set(f.item, [])
        byItem.get(f.item)?.push(f)
    }
    const adj = insp.adjudication || {}
    if (adj.status === 'adjudicated' && adj.verdict === 'findings') {
        for (const e of adj.findings || []) {
            if (!e || typeof e !== 'object') continue
            const code = receiptNormCode(e.code)
            const word = String(e.word || '').toUpperCase()
            if (word !== 'IN' && word !== 'OUT') continue
            for (const f of byItem.get(e.item ?? null) || []) {
                if (receiptCodeMatches(f.code, code)) {
                    out.set(f.idx, { word: word as 'IN' | 'OUT', repeat: false })
                }
            }
        }
        return out
    }
    for (const [item, w] of receiptNarrativeWords(insp, docks)) {
        for (const f of byItem.get(item) || []) out.set(f.idx, w)
    }
    return out
}

export type JourneyBucket = 'restored' | 'failed' | 'cos' | 'new' | 'unchecked'

export interface ReceiptFollowupView {
    date: string | null | undefined
    kind: 'checklist' | 'narrative' | 'hybrid'
    tone: string
    label: string
    detail: string
}

export interface ReceiptBaseItem {
    item: number
    category: 'risk_factor' | 'grp'
    repeat: boolean
    cos: boolean
    points: number | null
    text: string
}

export interface ReceiptJourneyRow {
    item: number
    idx: number | null
    bucket: JourneyBucket
    texts: string[]
    category: 'risk_factor' | 'grp'
    narrative: boolean
    repeat: boolean
    cosBase: boolean
    count: number
    countSums: boolean
    repeatCount: number
    cosCount: number
    dockPts: number | null
    delta: number | null
}

export interface GradeReceipt {
    grade: NonNullable<ReturnType<typeof gradePresentation>>
    verified: boolean
    adjusted: boolean
    base: {
        found: boolean
        inspectionId: string | null
        date: string | null
        score: number
        letter: string
        violationCount: number | null
        rfCount: number | null
        grpCount: number | null
        items: ReceiptBaseItem[]
        itemless: { count: number; points: number | null } | null
    }
    followups: ReceiptFollowupView[]
    journeys: Record<JourneyBucket, ReceiptJourneyRow[]>
    ledger: {
        baseScore: number
        baseLetter: string
        restored: number
        added: number
        score: number
        letter: string
        exact: boolean
    }
}

/**
 * The grade-receipt model for one facility: the broad anchor's per-item
 * docks, the post-broad re-checks and what each governed item's outcome did
 * to the number, and the base → adjustments → grade ledger. Returns null
 * when the facility has no grade (mirrors gradePresentation). Per-item
 * point values are only trustworthy when `verified` is true.
 */
export function gradeReceiptPresentation(
    facility: FacilityLike = {},
    inspections: Inspection[] = [],
): GradeReceipt | null {
    const grade = gradePresentation(facility)
    if (!grade) return null
    const g: GradeBlock = facility.grade || {}

    const dated = (inspections || []).filter((i) => i && i.date)
    let base = grade.baseInspectionId
        ? dated.find((i) => i.inspection_id === grade.baseInspectionId) || null
        : null
    if (!base) {
        // Legacy payloads without base_inspection_id: newest scored broad,
        // exactly the engine's own base selection.
        base = dated
            .filter((i) => receiptScope(i) === 'broad' && Number.isFinite(Number(i.score)))
            .sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : (a.date ?? '') > (b.date ?? '') ? -1 : 0))[0] || null
    }

    const isNarr = (i: Inspection) => receiptIsFollowup(i)
        && (i.adjudication || {}).status === 'adjudicated'

    // cf_lib.facility_grade's follow-up selection: post-broad by date, or
    // same-day when the purpose marks it a Follow-Up; newest first.
    const docks = base ? receiptDockMap(base) : new Map<number | null, Dock>()
    const followups = base ? dated
        .filter((i) => ((checklistRows(i).length && receiptScope(i) === 'focused') || isNarr(i))
            && ((i.date ?? '') > (base?.date ?? '')
                || ((i.date ?? '') === (base?.date ?? '') && receiptIsFollowup(i))))
        .sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : (a.date ?? '') > (b.date ?? '') ? -1 : 0))
        : []

    const findings = base ? receiptBaseFindings(base) : []
    const byItem = new Map<number | null, BaseFinding[]>()
    for (const f of findings) {
        if (!byItem.has(f.item)) byItem.set(f.item, [])
        byItem.get(f.item)?.push(f)
    }
    const latestWord = new Map<number, ItemWord>()  // newest word per item
    const latestFinding = new Map<number, ItemWord>() // newest word per finding idx
    const narrativeFindings = new Set<number>()     // findings worded narratively
    const closed = new Set<number>()                // items a newer visit settled
    let narrativeCount = 0
    const followupViews: ReceiptFollowupView[] = []
    for (const fup of followups) {
        const narrative = isNarr(fup)
        const structured = checklistRows(fup).length > 0 && receiptScope(fup) === 'focused'
        const verdict = narrative ? narrativeVerdictPresentation(fup) : null
        if (narrative) narrativeCount += 1
        if (structured) {
            const view = inspectionPresentation(fup)
            const outcome = focusedOutcomePresentation(view)
            followupViews.push({
                date: fup.date,
                kind: narrative ? 'hybrid' : 'checklist',
                tone: outcome.tone,
                label: outcome.ratioKnown
                    ? `${outcome.out}/${outcome.total} OUT` : outcome.label,
                detail: verdict?.detail
                    ? `${outcome.description}; ${verdict.detail}`
                    : outcome.description,
            })
        } else {
            followupViews.push({
                date: fup.date,
                kind: 'narrative',
                tone: verdict?.tone || 'unknown',
                label: verdict?.label || 'Written verdict',
                detail: verdict?.detail || '',
            })
        }
        const narrativeWords = narrative
            ? receiptNarrativeWords(fup, docks) : new Map<number, ItemWord>()
        const structuredWords = structured
            ? receiptItemWords(checklistRows(fup)) : new Map<number, ItemWord>()
        const words = new Map(narrativeWords)
        for (const [item, word] of structuredWords) {
            words.set(item, word)
        }
        // cf_lib.recheck_finding_words: the structured row claims the
        // findings it re-cited by code, and an adjudicated comment covering
        // the same item speaks for the ones it did not — the two channels
        // compose per finding. `closed` keeps the doctrine that the NEWEST
        // visit to word an item governs the whole item.
        const cited = new Map<number | null, string[]>()
        for (const v of fup.violations || []) {
            const code = receiptNormCode(v.code)
            if (code == null) continue
            const key = Number.isInteger(v.item) ? (v.item as number) : null
            if (!cited.has(key)) cited.set(key, [])
            cited.get(key)?.push(code)
        }
        const claim = (f: BaseFinding, w: ItemWord, narr: boolean) => {
            if (latestFinding.has(f.idx)) return
            latestFinding.set(f.idx, w)
            if (narr) narrativeFindings.add(f.idx)
        }
        for (const [item, w] of words) {
            if (!latestWord.has(item)) latestWord.set(item, w)
        }
        const narrFindings = narrative
            ? receiptNarrativeFindingWords(fup, findings, docks)
            : new Map<number, ItemWord>()
        const narrate = (rest: BaseFinding[]) => {
            for (const f of rest) {
                const w = narrFindings.get(f.idx)
                if (!w || latestFinding.has(f.idx)) continue
                claim(f, w, true)
            }
        }
        const narrated = new Set<number | null>()
        for (const f of findings) {
            if (narrFindings.has(f.idx)) narrated.add(f.item)
        }
        for (const item of new Set([...narrated, ...structuredWords.keys()])) {
            if (item == null) continue
            const group = byItem.get(item)
            if (!group || closed.has(item)) continue
            const sWord = structuredWords.get(item)
            if (!sWord) {
                narrate(group)           // comment-only evidence for this item
                continue
            }
            const targets = receiptAttribute(sWord.word, group, cited.get(item) || [])
            const named = new Set(targets.map((f) => f.idx))
            for (const f of targets) claim(f, sWord, false)
            narrate(group.filter((f) => !named.has(f.idx)))
        }
        for (const item of words.keys()) closed.add(item)
    }

    // Base facts first — the anchor's total and its item-less riders exist
    // whether or not anything re-checked them.
    let baseTT = 0
    let itemless: { count: number; pointsTT: number } | null = null
    for (const [item, dock] of docks) {
        baseTT += dock.pointsTT
        if (item == null) itemless = { count: dock.count, pointsTT: dock.pointsTT }
    }

    // Outcome walk — the exact branch structure of facility_grade, including
    // its no-followup early return: with nothing to adjust, the buckets stay
    // EMPTY and the grade is the broad score, exactly.
    let totalTT = 0
    let restoredTT = 0
    let extraTT = 0
    const derived: Record<JourneyBucket, number[]> = {
        restored: [], failed: [], cos: [], new: [], unchecked: [],
    }
    if (followups.length) {
        for (const f of findings) {
            const w = f.item != null ? latestFinding.get(f.idx) : undefined
            if (!w) {
                totalTT += f.pointsTT
                if (f.item != null) derived.unchecked.push(f.idx)
            } else if (w.word === 'IN') {
                // NARRATIVE_RESTORE is at par with GRADE_RESTORE by doctrine,
                // so both channels restore 65%.
                totalTT += f.pointsTT * 35 / 100
                restoredTT += f.pointsTT * 65 / 100
                derived.restored.push(f.idx)
            } else if (w.word === 'OUT_COS') {
                totalTT += f.fullTT                     // credit revoked, no mult
                extraTT += f.fullTT - f.pointsTT
                derived.cos.push(f.idx)
            } else {
                totalTT += f.fullTT * 3 / 2             // revoked + structural repeat
                extraTT += f.fullTT * 3 / 2 - f.pointsTT
                derived.failed.push(f.idx)
            }
        }
        for (const [item, w] of latestWord) {
            if (docks.has(item) || w.word !== 'OUT') continue // OUT_COS new items dock nothing
            let weightTT = item <= RF_MAX_ITEM ? W_RF_TT : W_GRP_TT
            if (w.repeat) weightTT = weightTT * 3 / 2
            totalTT += weightTT
            extraTT += weightTT
            derived.new.push(item)
        }
    }

    // cf_lib.published_score / _one_dp, integer-exact (ROUND_HALF_UP).
    const scoreTT = (tt: number) => {
        const raw = 100 * RECEIPT_SCALE - tt
        if (raw <= 0) return 0
        const q = Math.floor(raw / RECEIPT_SCALE)
        return raw % RECEIPT_SCALE >= RECEIPT_SCALE / 2 ? q + 1 : q
    }
    const oneDpTT = (tt: number) => {
        const q = Math.floor(tt / (RECEIPT_SCALE / 10))
        return (tt % (RECEIPT_SCALE / 10) >= RECEIPT_SCALE / 20 ? q + 1 : q) / 10
    }
    const derivedBase = scoreTT(baseTT)
    const derivedScore = followups.length ? scoreTT(totalTT) : derivedBase

    const sameItems = (mine: Iterable<number>, published: number[] | null | undefined) => {
        const a = [...mine].sort((m, n) => m - n)
        const b = (published || []).map(Number).sort((m, n) => m - n)
        return a.length === b.length && a.every((v, i) => v === b[i])
    }
    // Item membership is DERIVED from finding membership, exactly as the
    // engine derives it.
    const byIdx = new Map(findings.map((f) => [f.idx, f]))
    const itemsOf = (idxs: number[]) => [...new Set(idxs
        .map((i) => byIdx.get(i)?.item)
        .filter((i): i is number => i != null))]
    const narrativeItems = new Set(itemsOf([...narrativeFindings]))
    // Reconcile at the finest granularity the payload publishes.
    const bucketOk = (
        idxs: number[],
        publishedFindings: number[] | null | undefined,
        publishedItems: number[] | null | undefined,
    ) => (publishedFindings ? sameItems(idxs, publishedFindings) : true)
        && sameItems(itemsOf(idxs), publishedItems)
    const verified = !!base
        && derivedBase === grade.baseScore
        && derivedScore === grade.score
        && followups.length === grade.followups
        && (!!g.adjusted) === (followups.length > 0)
        && narrativeCount === grade.narrativeFollowups
        && oneDpTT(restoredTT) === grade.restoredPoints
        && oneDpTT(extraTT) === grade.extraPoints
        && bucketOk(derived.restored, grade.restoredFindings, grade.restored)
        && bucketOk(derived.failed, grade.failedFindings, grade.failed)
        && bucketOk(derived.cos, grade.cosFindings, grade.cos)
        && sameItems(derived.new, grade.newItems)
        && bucketOk(derived.unchecked, grade.uncheckedFindings, grade.unchecked)
        && sameItems([...narrativeItems], grade.narrativeItems)

    // Full text, no truncation — EVERY observation cited under the item
    // comes back (VDH routinely files several unrelated findings under one
    // item number).
    const textsFor = (item: number): string[] => {
        const dock = docks.get(item)
        if (dock && dock.findings.length) {
            return dock.findings.map((f) => f.text).filter(Boolean)
        }
        for (const fup of followups) {       // new items: found by a re-check
            const hits = (fup.violations || [])
                .filter((v) => v.item === item && v.text)
                .map((v) => v.text as string)
            if (hits.length) return hits     // newest-first: the governing visit
        }
        return []
    }
    // Display membership is the PUBLISHED buckets; derived numbers decorate
    // them only when the reconcile passed.
    const publishedNarrative = new Set((grade.narrativeItems || []).map(Number))

    // Journey rows are per FINDING, symmetric with the base docket.
    const findingRow = (bucket: JourneyBucket, f: BaseFinding): ReceiptJourneyRow => {
        const row: ReceiptJourneyRow = {
            item: f.item as number,
            idx: f.idx,
            bucket,
            texts: f.text ? [f.text] : [],
            category: (f.item as number) <= RF_MAX_ITEM ? 'risk_factor' : 'grp',
            narrative: publishedNarrative.has(f.item as number),
            repeat: f.repeat,
            cosBase: f.cos,
            count: 1,
            countSums: true,
            repeatCount: f.repeat ? 1 : 0,
            cosCount: f.cos ? 1 : 0,
            dockPts: null,
            delta: null,
        }
        if (verified) {
            row.dockPts = oneDpTT(f.pointsTT)
            if (bucket === 'restored') row.delta = oneDpTT(f.pointsTT * 65 / 100)
            else if (bucket === 'failed') row.delta = oneDpTT(f.fullTT * 3 / 2 - f.pointsTT)
            else if (bucket === 'cos') row.delta = oneDpTT(f.fullTT - f.pointsTT)
        }
        return row
    }
    // With no base row to expand against, membership is all we have.
    const itemStub = (bucket: JourneyBucket, item: number): ReceiptJourneyRow => ({
        item,
        idx: null,
        bucket,
        texts: textsFor(item),
        category: item <= RF_MAX_ITEM ? 'risk_factor' : 'grp',
        narrative: publishedNarrative.has(item),
        repeat: false,
        cosBase: false,
        count: 0,
        countSums: false,
        repeatCount: 0,
        cosCount: 0,
        dockPts: null,
        delta: null,
    })
    // Payloads published before per-finding resolution carry no *_findings
    // list — expanding the item's dock reproduces exactly what they meant.
    const journey = (
        bucket: JourneyBucket,
        idxs: number[] | null | undefined,
        items: number[] | undefined,
    ): ReceiptJourneyRow[] => {
        if (idxs && findings.length) {
            return idxs.map(Number).map((i) => byIdx.get(i))
                .filter((f): f is BaseFinding => !!f)
                .map((f) => findingRow(bucket, f))
        }
        return (items || []).map(Number).flatMap((item) => {
            const dock = docks.get(item)
            return dock && dock.findings.length
                ? dock.findings.map((f) => findingRow(bucket, f))
                : [itemStub(bucket, item)]
        })
    }

    // New items have no base finding to key on: the item docks ONCE at its
    // category weight however many observations the re-check wrote.
    const journeyNew = (items: number[] | undefined): ReceiptJourneyRow[] =>
        (items || []).map(Number).map((item) => {
            const texts = textsFor(item)
            const w = latestWord.get(item)
            const row: ReceiptJourneyRow = {
                item,
                idx: null,
                bucket: 'new',
                texts,
                category: item <= RF_MAX_ITEM ? 'risk_factor' : 'grp',
                narrative: publishedNarrative.has(item),
                repeat: !!w?.repeat,
                cosBase: false,
                count: texts.length,
                countSums: false,
                repeatCount: 0,
                cosCount: 0,
                dockPts: null,
                delta: null,
            }
            if (verified) {
                let weightTT = item <= RF_MAX_ITEM ? W_RF_TT : W_GRP_TT
                if (w?.repeat) weightTT = weightTT * 3 / 2
                row.delta = oneDpTT(weightTT)
            }
            return row
        })

    // The base docket is per VIOLATION: each finding carries its own weight,
    // its own Repeat/COS badges and its own points. Findings sharing an item
    // stay adjacent (sorted by item, filed in document order).
    const baseItems: ReceiptBaseItem[] = [...docks]
        .filter((entry): entry is [number, Dock] => entry[0] != null)
        .sort((a, b) => a[0] - b[0])
        .flatMap(([item, dock]) => dock.findings.map((f) => ({
            item,
            category: (item <= RF_MAX_ITEM ? 'risk_factor' : 'grp') as 'risk_factor' | 'grp',
            repeat: f.repeat,
            cos: f.cos,
            points: verified ? oneDpTT(f.pointsTT) : null,
            text: f.text,
        })))

    // The ledger states the published triplet; `exact` decides whether the
    // round-once footnote appears.
    const ledgerSum = Math.round(
        (grade.baseScore + grade.restoredPoints - grade.extraPoints) * 10) / 10
    return {
        grade,
        verified,
        adjusted: !!g.adjusted,
        base: {
            found: !!base,
            inspectionId: base?.inspection_id || null,
            date: grade.baseDate || base?.date || null,
            score: grade.baseScore,
            letter: grade.baseLetter,
            violationCount: base ? (base.violations || []).length : null,
            rfCount: base ? (base.violations || [])
                .filter((v) => Number.isInteger(v.item) && (v.item as number) <= RF_MAX_ITEM).length : null,
            grpCount: base ? (base.violations || [])
                .filter((v) => !(Number.isInteger(v.item) && (v.item as number) <= RF_MAX_ITEM)).length : null,
            items: baseItems,
            itemless: itemless
                ? { count: itemless.count, points: verified ? oneDpTT(itemless.pointsTT) : null }
                : null,
        },
        followups: followupViews,
        journeys: {
            restored: journey('restored', grade.restoredFindings, grade.restored),
            failed: journey('failed', grade.failedFindings, grade.failed),
            cos: journey('cos', grade.cosFindings, grade.cos),
            new: journeyNew(grade.newItems),
            unchecked: journey('unchecked', grade.uncheckedFindings, grade.unchecked),
        },
        ledger: {
            baseScore: grade.baseScore,
            baseLetter: grade.baseLetter,
            restored: grade.restoredPoints,
            added: grade.extraPoints,
            score: grade.score,
            letter: grade.letter,
            exact: ledgerSum === grade.score,
        },
    }
}
