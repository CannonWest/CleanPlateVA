/**
 * One inspection history row (§6.2, CRVa-M2) — the full old
 * `inspection.js` inventory, restyled to the ratified mockup:
 *
 *   collapsed  = outcome badge (score pill · X/Y OUT · adjudicated ✓-chip
 *                · ?) · date · purpose · scope badge (suppressed when an
 *                adjudication chip shows) · boxed VDH link-out (the
 *                external grammar) · caret · count chips;
 *   expanded   = per-violation blocks (severity left-rail, red for risk
 *                factors; disposition + #item + fixed/repeat flags; the ↳
 *                per-violation corrective line) · the grouped checklist
 *                ("N distinct applicable code items · N published rows ·
 *                N OUT") with per-category pass bars · Inspector comments
 *                (general + Additional text) · Temperatures & sanitizer
 *                as its own collapsible.
 *
 * Grade letters never appear on individual inspections — scores only; the
 * letter is the facility's (C1/C9).
 */

import { ChevronDown, ExternalLink } from 'lucide-react'
import { GRADE_COLORS } from './constants'
import {
    fmtDate, focusedOutcomePresentation, gradeColor, gradeForScore,
    inspectionCountsPresentation, inspectionPresentation,
    narrativeVerdictPresentation,
} from './data/presentation'
import { TONE_COLORS } from './trend'
import type { DecodedChecklistRow, Inspection } from './data/types'

function rowsOf(insp: Inspection): DecodedChecklistRow[] {
    return Array.isArray(insp.checklist)
        ? (insp.checklist as DecodedChecklistRow[]).filter((r) => r && typeof r === 'object')
        : []
}

/** item#s by disposition — the authoritative structured source for the
 *  fixed / open / repeat badges on violation blocks. */
function disposSets(rows: DecodedChecklistRow[]) {
    const cos = new Set<number>()
    const open = new Set<number>()
    const repeat = new Set<number>()
    for (const r of rows) {
        if (r.item == null) continue
        if (r.cos) cos.add(r.item)
        if (r.violation && !r.cos) open.add(r.item)
        if (r.repeat) repeat.add(r.item)
    }
    return { cos, open, repeat }
}

function Flag({ kind, children }: { kind: 'viol' | 'cos' | 'rep' | 'ok'; children: React.ReactNode }) {
    const bg = kind === 'viol' ? GRADE_COLORS.F
        : kind === 'cos' ? GRADE_COLORS.A
            : kind === 'rep' ? GRADE_COLORS.D
                : 'var(--cp-surface-3)'
    return (
        <span
            className="rounded-[4px] px-1.5 py-[3px] text-[9px] font-bold"
            style={{ background: bg, color: kind === 'ok' ? 'var(--cp-ink-2)' : '#fff' }}
        >
            {children}
        </span>
    )
}

function toneColor(tone: string): string {
    return TONE_COLORS[tone] ?? TONE_COLORS.unknown ?? '#868e96'
}

/** The collapsed row's outcome signal — a score pill for a broad visit
 *  (score, never a letter), the X/Y OUT ratio for a focused one, the
 *  verdict glyph for an adjudicated comment, '?' for a plain unknown. */
function OutcomeBadge({ insp }: { insp: Inspection }) {
    const view = inspectionPresentation(insp)
    if (view.scope === 'broad') {
        return (
            <span
                className="inline-flex min-w-[34px] items-center justify-center rounded-[6px] px-1.5 py-1 text-[12px] font-bold text-white tabular-nums"
                style={{ background: view.score != null ? gradeColor(gradeForScore(view.score)) : GRADE_COLORS.none }}
                title="Inspection score (0–100, no letter — letters are a facility grade)"
            >
                {view.score ?? '—'}
            </span>
        )
    }
    if (view.scope === 'focused') {
        const outcome = focusedOutcomePresentation(view)
        return (
            <span
                className="text-[12.5px] font-bold tabular-nums"
                style={{ color: toneColor(outcome.tone) }}
                title={outcome.description}
            >
                {outcome.label}
            </span>
        )
    }
    const adj = narrativeVerdictPresentation(insp)
    if (adj) {
        return (
            <span
                className="text-[12.5px] font-bold"
                style={{ color: toneColor(adj.tone) }}
                role="img"
                title={adj.detail}
                aria-label={adj.detail}
            >
                {adj.glyph}{adj.count ? <small className="ml-0.5">{adj.count}</small> : null}
            </span>
        )
    }
    return <span className="text-[12.5px] font-bold text-cp-ink-3">?</span>
}

function Checklist({ rows, count }: { rows: DecodedChecklistRow[]; count: number | null }) {
    const real = rows.filter((r) => !r.is_sentinel)
    if (!real.length) return null
    const cats: string[] = []
    const byCat = new Map<string, DecodedChecklistRow[]>()
    for (const r of real) {
        const c = r.category || 'Other'
        if (!byCat.has(c)) {
            byCat.set(c, [])
            cats.push(c)
        }
        byCat.get(c)?.push(r)
    }
    const out = real.filter((r) => r.violation).length
    return (
        <details className="mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[11.5px] text-cp-ink-3 [&::-webkit-details-marker]:hidden">
                <ChevronDown size={13} aria-hidden="true" className="caret shrink-0" />
                Inspection checklist — {count ?? 0} distinct applicable code items · {real.length} published rows · {out} OUT
            </summary>
            {cats.map((c) => {
                const cr = byCat.get(c) ?? []
                const cOk = cr.filter((r) => r.compliant).length
                const cOut = cr.filter((r) => r.violation).length
                const denom = cOk + cOut
                const okPct = denom ? Math.round((cOk / denom) * 100) : 100
                return (
                    <details key={c} className="my-1.5 rounded-[6px] border border-cp-hairline bg-cp-surface-1">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12px] text-cp-ink-2 [&::-webkit-details-marker]:hidden">
                            <span>{c}</span>
                            <span className="text-[11px] font-semibold text-cp-ink-3 tabular-nums">{cOk}/{denom}</span>
                            <span className="ml-2 h-1 min-w-[56px] flex-1 overflow-hidden rounded-[2px] bg-cp-surface-3">
                                <span
                                    className="block h-full"
                                    style={{ width: `${okPct}%`, background: cOut ? GRADE_COLORS.C : GRADE_COLORS.A }}
                                />
                            </span>
                        </summary>
                        <div className="border-t border-cp-hairline px-2.5 py-1">
                            {cr.map((r, i) => (
                                <div key={i} className="flex items-baseline gap-2 py-1 text-[12px] text-cp-ink-2">
                                    <span className="min-w-[22px] text-[10.5px] font-bold text-cp-ink-3 tabular-nums">{r.item ?? '?'}</span>
                                    <span>{r.standard_text}</span>
                                    <span className="ml-auto flex flex-none gap-1">
                                        {r.violation ? <Flag kind="viol">OUT</Flag> : <Flag kind="ok">{r.disposition || 'IN'}</Flag>}
                                        {r.cos && <Flag kind="cos">fixed</Flag>}
                                        {r.repeat && <Flag kind="rep">repeat</Flag>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </details>
                )
            })}
        </details>
    )
}

interface TempsV2 {
    food_present?: boolean
    warewashing_present?: boolean
    equipment_present?: boolean
    food?: Array<{ description?: string; temperature?: string; temperature_f?: number; state_of_food?: string }>
    warewashing?: Array<{
        machine?: string
        method?: string
        sanitizer_type?: string
        sanitizer_name?: string
        ppm?: number | null
        temperature?: string
        temperature_f?: number
    }>
    equipment?: Array<{ description?: string; temperature?: string }>
}

function foodTempBad(r: NonNullable<TempsV2['food']>[number]): boolean {
    const t = typeof r.temperature_f === 'number' ? r.temperature_f : null
    if (t == null) return false
    const s = (r.state_of_food || '').toLowerCase()
    if (s.includes('cold')) return t > 41
    if (s.includes('hot')) return t < 135
    return false
}

function sanitizerBad(r: NonNullable<TempsV2['warewashing']>[number]): boolean {
    const method = (r.method || '').toLowerCase()
    if (method.includes('high') || method.includes('heat')) {
        return typeof r.temperature_f === 'number' && r.temperature_f < 160
    }
    const ppm = typeof r.ppm === 'number' ? r.ppm : null
    if (ppm == null) return false
    const type = (r.sanitizer_type || r.sanitizer_name || '').toLowerCase()
    if (type.includes('chlor')) return ppm < 50 || ppm > 200
    if (type.includes('quat')) return ppm < 150 || ppm > 400
    return ppm < 50
}

function TempTable({ head, rows }: { head: string[]; rows: Array<{ cells: (string | number | null | undefined)[]; bad?: boolean }> }) {
    return (
        <div className="overflow-x-auto">
            <table className="mt-1 w-full text-[11.5px]">
                <thead>
                    <tr>
                        {head.map((h) => (
                            <th key={h} className="py-1 pr-3 text-left font-semibold text-cp-ink-3">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} style={r.bad ? { color: 'var(--cp-danger)' } : undefined}>
                            {r.cells.map((c, j) => (
                                <td key={j} className="py-0.5 pr-3 tabular-nums">
                                    {c ?? ''}
                                    {r.bad && j === r.cells.length - 1 ? ' ⚠' : ''}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function Temps({ insp }: { insp: Inspection }) {
    const tv = insp.temps_v2 as TempsV2 | undefined
    const legacy = insp.temps as Array<{ category?: string; rows: string[][] }> | undefined
    const has = tv && (tv.food_present || tv.warewashing_present || tv.equipment_present)
    const sections: React.ReactNode[] = []
    let n = 0
    if (has) {
        if (tv.food_present && tv.food?.length) {
            n += tv.food.length
            sections.push(
                <div key="food">
                    <div className="mt-2 text-[11px] font-semibold text-cp-ink-3 uppercase">Food temperatures</div>
                    <TempTable
                        head={['Item', 'Temp', 'State']}
                        rows={tv.food.map((r) => ({ cells: [r.description, r.temperature, r.state_of_food], bad: foodTempBad(r) }))}
                    />
                </div>,
            )
        }
        if (tv.warewashing_present && tv.warewashing?.length) {
            n += tv.warewashing.length
            sections.push(
                <div key="ware">
                    <div className="mt-2 text-[11px] font-semibold text-cp-ink-3 uppercase">Warewashing &amp; sanitizer</div>
                    <TempTable
                        head={['Machine', 'Method', 'PPM', 'Temp']}
                        rows={tv.warewashing.map((r) => ({
                            cells: [
                                r.machine,
                                [r.method, r.sanitizer_type || r.sanitizer_name].filter(Boolean).join(' '),
                                r.ppm,
                                r.temperature,
                            ],
                            bad: sanitizerBad(r),
                        }))}
                    />
                </div>,
            )
        }
        if (tv.equipment_present && tv.equipment?.length) {
            n += tv.equipment.length
            sections.push(
                <div key="equip">
                    <div className="mt-2 text-[11px] font-semibold text-cp-ink-3 uppercase">Equipment temperatures</div>
                    <TempTable
                        head={['Equipment', 'Temp']}
                        rows={tv.equipment.map((r) => ({ cells: [r.description, r.temperature] }))}
                    />
                </div>,
            )
        }
    }
    if (!sections.length) {
        if (!legacy?.length) return null
        const total = legacy.reduce((sum, t) => sum + (t.rows?.length ?? 0), 0)
        return (
            <details className="mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[11.5px] text-cp-ink-3 [&::-webkit-details-marker]:hidden">
                    <ChevronDown size={13} aria-hidden="true" className="caret shrink-0" />
                    Temperature log ({total} readings)
                </summary>
                {legacy.map((t, i) => (
                    <div key={i}>
                        <div className="mt-2 text-[11px] font-semibold text-cp-ink-3 uppercase">{t.category}</div>
                        <TempTable head={[]} rows={(t.rows ?? []).map((cells) => ({ cells }))} />
                    </div>
                ))}
            </details>
        )
    }
    return (
        <details className="mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[11.5px] text-cp-ink-3 [&::-webkit-details-marker]:hidden">
                <ChevronDown size={13} aria-hidden="true" className="caret shrink-0" />
                Temperatures &amp; sanitizer — {n} readings
            </summary>
            {sections}
        </details>
    )
}

export function InspectionRow({ insp, openByDefault, fairfax = false }: {
    insp: Inspection
    openByDefault: boolean
    /** The facility's record is the Fairfax Health District's (FFX-M4): the
     *  report link is a county PDF download, and the row may carry the
     *  county's own outcome or stand for a report the archive does not hold. */
    fairfax?: boolean
}) {
    const view = inspectionPresentation(insp)
    const violations = insp.violations || []
    const rows = rowsOf(insp)
    const sets = disposSets(rows)
    const adj = narrativeVerdictPresentation(insp)
    const counts = inspectionCountsPresentation(insp)
    // OQ-I: the department lists the visit; the archive holds no report.
    const unavailable = insp.report_available === false
    // OQ-D: the county's recorded outcome — shown with its explanation, never
    // a badge, never an input to the score.
    const outcome = typeof insp.source_outcome === 'string' && insp.source_outcome
        ? insp.source_outcome : null
    const linkLabel = unavailable
        ? 'Download the county’s copy of this report (PDF)'
        : fairfax
            ? 'Download the official Fairfax County Health Department report for this inspection (PDF)'
            : 'Open the official VDH report for this inspection'

    const noViolations = view.scope === 'broad'
        ? `No violations recorded across ${view.count} distinct applicable code items.`
        : view.scope === 'focused'
            ? `No violations recorded in this focused ${view.count}-item check.`
            : 'No violations recorded; checklist breadth was not published.'

    return (
        <details className="my-1.5 overflow-hidden rounded-[8px] border border-cp-hairline bg-cp-surface-2" open={openByDefault}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                <OutcomeBadge insp={insp} />
                <span className="text-[12.5px] font-semibold tabular-nums">{fmtDate(insp.date)}</span>
                <span className="text-[11.5px] text-cp-ink-3">{insp.purpose as string}</span>
                {/* An adjudicated unknown shows its VERDICT chip instead of a
                    scope label — "Scope unknown" describes the missing
                    checklist, which is exactly what the adjudication resolved. */}
                {!(adj && view.scope === 'unknown') && (
                    <span className="rounded-[4px] bg-cp-surface-3 px-1.5 py-1 text-[9.5px] font-semibold tracking-[.05em] text-cp-ink-2 uppercase">
                        {view.scope === 'broad' ? 'Broad' : view.scope === 'focused' ? 'Focused' : 'Scope unknown'}
                    </span>
                )}
                <span className="ml-auto inline-flex flex-none items-center gap-2">
                    {typeof insp.report_url === 'string' && insp.report_url && (
                        <a
                            href={insp.report_url}
                            target="_blank"
                            rel="noopener"
                            aria-label={linkLabel}
                            title={linkLabel}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex rounded-[6px] border border-cp-accent p-1.5 text-cp-accent hover:bg-cp-surface-3"
                        >
                            <ExternalLink size={13} aria-hidden="true" />
                        </a>
                    )}
                    <ChevronDown size={15} aria-hidden="true" className="caret text-cp-ink-3" />
                </span>
                {adj ? (
                    <span className="flex basis-full gap-1.5 pl-0.5">
                        <span
                            className="rounded-[4px] border px-1.5 py-[3px] text-[10.5px] font-semibold"
                            style={{ color: toneColor(adj.tone), borderColor: toneColor(adj.tone) }}
                            title={adj.detail}
                        >
                            {adj.label}
                        </span>
                    </span>
                ) : counts.show ? (
                    <span className="flex basis-full flex-wrap gap-1.5 pl-0.5">
                        <span
                            className="rounded-[4px] px-2 py-1 text-[10.5px] font-bold text-white"
                            style={{ background: counts.n ? GRADE_COLORS.F : GRADE_COLORS.A }}
                        >
                            {counts.n} violation{counts.n === 1 ? '' : 's'}
                        </span>
                        {!!counts.rf && (
                            <span
                                className="rounded-[4px] border px-1.5 py-[3px] text-[10.5px] font-semibold"
                                style={{ color: 'var(--cp-grade-d)', borderColor: 'var(--cp-grade-d)' }}
                                title="Foodborne-illness risk factors (form items 1–29)"
                            >
                                {counts.rf} risk factor
                            </span>
                        )}
                        {!!counts.grp && (
                            <span
                                className="rounded-[4px] border border-cp-hairline px-1.5 py-[3px] text-[10.5px] font-semibold text-cp-ink-2"
                                title="Good Retail Practices (items 30+)"
                            >
                                {counts.grp} retail practice
                            </span>
                        )}
                        {counts.n === 0 && view.scope !== 'unknown' && (
                            <span className="self-center text-[11px] text-cp-ink-3">
                                {view.count} items in compliance
                            </span>
                        )}
                    </span>
                ) : null}
            </summary>
            <div className="border-t border-cp-hairline px-3 py-2.5">
                {unavailable && (
                    <p className="mb-2 text-[12px] text-cp-ink-2">
                        No report is held for this visit; the county’s copy may be available.
                    </p>
                )}
                {outcome && (
                    <div className="mb-2 rounded-[6px] border border-cp-hairline bg-cp-bg px-2.5 py-2 text-[12px] leading-normal text-cp-ink-2">
                        <b className="mb-0.5 block text-[11px] tracking-[.05em] text-cp-ink uppercase">County outcome: {outcome}</b>
                        Outcome recorded by the Fairfax County Health Department for this visit. It is not derived from, and does not determine, CleanPlateVA’s computed score. Across the archived county reports, about 3 percent of visits recorded as Passed score in the D or F range under CleanPlateVA’s formula; the basis for the county’s outcome is not stated in the report.
                    </div>
                )}
                {adj && (
                    <p className="mb-2 text-[12px] text-cp-ink-2">
                        No checklist published; verdict read from the inspector's written comments.
                    </p>
                )}
                {unavailable ? null : violations.length ? violations.map((v, i) => {
                    const rf = v.item != null && v.item <= 29
                    return (
                        <div
                            key={i}
                            className="my-2 rounded-[0_6px_6px_0] border-l-[3px] bg-cp-surface-1 px-2.5 py-2"
                            style={{ borderLeftColor: rf ? 'var(--cp-grade-f)' : 'var(--cp-grade-d)' }}
                        >
                            <div className="flex flex-wrap items-baseline gap-1.5">
                                {v.item != null && sets.cos.has(v.item) ? (
                                    <Flag kind="cos">fixed</Flag>
                                ) : v.item != null && sets.open.has(v.item) ? (
                                    <Flag kind="viol">OUT</Flag>
                                ) : null}
                                <span className="text-[11px] font-bold text-cp-ink-3 tabular-nums" title={v.code || 'no regulation code'}>
                                    #{v.item ?? '?'}
                                </span>
                                {v.item != null && sets.repeat.has(v.item) && <Flag kind="rep">repeat</Flag>}
                                <span className="text-[12.5px]">{v.text}</span>
                            </div>
                            {typeof v.corrective === 'string' && v.corrective && (
                                <div className="mt-1 pl-1 text-[12px] text-cp-ink-2">
                                    <span className="text-cp-ink-3">↳ </span>
                                    {v.corrective}
                                </div>
                            )}
                        </div>
                    )
                }) : adj ? null : (
                    <p className="text-[12px] text-cp-ink-3">{noViolations}</p>
                )}
                {!unavailable && <Checklist rows={rows} count={view.count} />}
                {typeof insp.comments === 'string' && insp.comments && (
                    <div className="mt-2 rounded-[6px] border border-cp-hairline bg-cp-bg px-2.5 py-2 text-[12px] leading-normal text-cp-ink-2">
                        <b className="mb-0.5 block text-[11px] tracking-[.05em] text-cp-ink uppercase">Inspector comments</b>
                        {insp.comments}
                    </div>
                )}
                <Temps insp={insp} />
            </div>
        </details>
    )
}
