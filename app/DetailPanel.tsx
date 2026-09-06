/**
 * The detail panel (§6.2, CRVa-M2) — right sheet on desktop, bottom sheet
 * on mobile. Header: name/address + the Source button (the external
 * grammar) + close; the fact line renders permanent facts structurally
 * (kind as icon + word, status as dot + word) with `≈ approximate
 * location` as the ONE badge; the grade hero is a single centered
 * TAPPABLE box that opens the report-card modal; the trend section is the
 * shared §6.0 instrument (panel variant, interactive); inspection history
 * renders the full inventory (InspectionRow).
 *
 * Detail arrives on click only (+standards once, inside the client); the
 * panel never fetches — App owns the load and hands the result down. The
 * basic map keeps the old identity + official-VDH hand-off (P6/C8).
 */

import { lazy, Suspense, useState } from 'react'
import {
    ExternalLink, FileText, Landmark, MoveRight, Store, TrendingDown, TrendingUp,
    Truck, Utensils, X,
} from 'lucide-react'
import {
    approximateLabel, facilityPresentation, fmtDate, gradeColor,
    isActivePermit, isFairfax, isNewlyPermitted, permitUrl, sourceDepartment, visitsOf,
} from './data/presentation'
import type { ScopeSeries } from './data/presentation'
import { buildScopeSeries } from './data/presentation'
import { gradeReceiptPresentation } from './data/receipt'
// The report-card modal loads on its first open (CRP-M5): the receipt
// MATH stays here (it gates the hero's affordance), the modal's markup
// leaves the entry chunk. A chunk is a static asset — no Worker request.
const ReceiptModal = lazy(() => import('./ReceiptModal').then((m) => ({ default: m.ReceiptModal })))
import { TrendSection } from './TrendSection'
import { InspectionRow } from './InspectionRow'
import type { DetailFacility, FacilityDetail, Inspection, RosterRow } from './data/types'

export type DetailState =
    | { status: 'loading' }
    | { status: 'ready'; detail: FacilityDetail }

function KindIcon({ f }: { f: RosterRow | DetailFacility }) {
    const Icon = f.mobile ? Truck : f.is_restaurant !== false ? Utensils : Store
    return <Icon size={13} aria-hidden="true" className="text-cp-ink-3" />
}

function TrendChip({ delta }: { delta: number | null }) {
    if (delta == null) return null
    const [Icon, word, color] = delta < 0
        ? [TrendingDown, 'Declining', 'var(--cp-grade-d)']
        : delta > 0
            ? [TrendingUp, 'Improving', 'var(--cp-grade-a)']
            : [MoveRight, 'Steady', 'var(--cp-ink-3)']
    return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color }}>
            <Icon size={13} aria-hidden="true" />
            {word}
        </span>
    )
}

/** The §6.2 hero: one centered box — circle → score + trend chip → anchor
 *  line → divider → the blue tap hint. The WHOLE box opens the breakdown. */
function GradeHero({ fac, delta, onOpen }: {
    fac: DetailFacility
    delta: number | null
    onOpen: () => void
}) {
    const grade = facilityPresentation(fac).grade
    const isNew = isNewlyPermitted(fac)
    if (grade) {
        return (
            <button
                type="button"
                onClick={onOpen}
                aria-haspopup="dialog"
                aria-label={`Grade ${grade.letter}, score ${grade.score} of 100 — open the grade breakdown`}
                className="flex w-full flex-col items-center rounded-cp-card border border-cp-hairline bg-cp-surface-2 px-4 pt-4 pb-2.5 text-center hover:border-cp-accent"
            >
                <span
                    className="flex h-[58px] w-[58px] items-center justify-center rounded-full text-[26px] font-bold text-white"
                    style={{ background: gradeColor(grade.letter) }}
                >
                    {grade.letter}
                </span>
                <span className="mt-2.5 flex items-baseline gap-2.5">
                    <span className="text-[30px] leading-none font-bold tabular-nums">
                        {grade.score}
                        <small className="text-[15px] font-semibold text-cp-ink-3">/100</small>
                    </span>
                    <TrendChip delta={delta} />
                </span>
                <span className="mt-1.5 text-[11.5px] text-cp-ink-3 tabular-nums">
                    Broad inspection · {fmtDate(grade.baseDate)}
                </span>
                {isFairfax(fac) && (
                    // OQ-G disclosure (FFX-M4): the county records every visit
                    // as a complete inspection, so no re-check channel exists.
                    <span className="mt-1 text-[11px] leading-snug text-cp-ink-3">
                        Fairfax County grades are anchored on the most recent full inspection.
                    </span>
                )}
                <span className="mt-3 flex w-full items-center justify-center gap-1.5 border-t border-cp-hairline pt-2.5 text-[11px] font-semibold text-cp-accent">
                    <FileText size={13} aria-hidden="true" />
                    Tap to see Grade breakdown
                </span>
            </button>
        )
    }
    if (isNew) {
        return (
            <div className="flex w-full flex-col items-center rounded-cp-card border border-cp-hairline bg-cp-surface-2 px-4 py-4 text-center">
                <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: 'var(--cp-new)' }}>
                    NEW
                </span>
                <span className="mt-2 text-[14px] font-bold">Permitted</span>
                <span className="mt-1 text-[11.5px] text-cp-ink-2">
                    Cleared to open; grade pending its first broad inspection.
                </span>
            </div>
        )
    }
    return (
        <div className="flex w-full flex-col items-center rounded-cp-card border border-cp-hairline bg-cp-surface-2 px-4 py-4 text-center">
            <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-cp-grade-none text-[26px] font-bold text-white">
                –
            </span>
            <span className="mt-2 rounded-cp-pill border border-cp-hairline bg-cp-surface-3 px-2 py-1 text-[10.5px] font-semibold text-cp-ink-2">
                no grade yet
            </span>
            <span className="mt-1.5 text-[11.5px] text-cp-ink-2">
                No broad inspection (20+ items) captured yet, so no grade — the
                inspections below stand on their own.
            </span>
        </div>
    )
}

export function DetailPanel({ row, lite, state, onClose, onAbout }: {
    row: RosterRow
    lite: boolean
    state: DetailState
    onClose: () => void
    onAbout: () => void
}) {
    const [receiptOpen, setReceiptOpen] = useState(false)
    const approx = approximateLabel(row)

    const detail = state.status === 'ready' && state.detail.available ? state.detail : null
    const fac: DetailFacility = detail?.facility ?? (row as DetailFacility)
    const inspections: Inspection[] = detail?.inspections ?? []
    const series = detail ? buildScopeSeries(inspections) : visitsOf(row)
    const isNew = isNewlyPermitted(fac)
    const active = isActivePermit(fac)
    const delta = facilityPresentation(row).trendDelta
    const receipt = detail && !lite ? gradeReceiptPresentation(fac, inspections) : null
    // Whose record the links open (FFX-M4): VDH, or the Fairfax Health
    // District — named in the fact line, the Source button and the hand-off.
    const fairfax = isFairfax(fac)
    const dept = sourceDepartment(fac)

    return (
        <aside
            className="fixed top-3 right-3 bottom-3 z-30 flex w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-cp-card border border-cp-hairline bg-cp-surface-1 shadow-cp max-sm:top-auto max-sm:right-0 max-sm:bottom-0 max-sm:max-h-[62vh] max-sm:w-full max-sm:rounded-b-none"
            aria-label={`${row.name} details`}
        >
            <header className="border-b border-cp-hairline px-4 pt-4 pb-3">
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-[16px] leading-tight font-bold">{fac.name ?? row.name}</h2>
                        <p className="mt-0.5 text-[12px] text-cp-ink-2">
                            {[row.address, row.address2, row.city, row.zip].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                    <a
                        href={permitUrl(row)}
                        target="_blank"
                        rel="noopener"
                        title={fairfax
                            ? (Number.isInteger(row.ffx_oid)
                                ? "Open this facility's official Fairfax County Health Department record"
                                : "Find this facility's official record at the Fairfax County Health Department")
                            : "Open this facility's official VDH record"}
                        className="inline-flex flex-none items-center gap-1.5 self-center rounded-cp-control border border-cp-accent px-2.5 py-1.5 text-[12px] font-semibold text-cp-accent hover:bg-cp-surface-3"
                    >
                        Source
                        <ExternalLink size={13} aria-hidden="true" />
                    </a>
                    <button type="button" aria-label="Close" onClick={onClose} className="flex-none self-start text-cp-ink-3 hover:text-cp-ink">
                        <X size={17} aria-hidden="true" />
                    </button>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-cp-ink-2">
                        <KindIcon f={fac} />
                        {(fac.permit_type as string) || (row.is_restaurant ? 'Restaurant' : 'Food facility')}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-cp-ink-2">
                        <span
                            className="h-[7px] w-[7px] rounded-full"
                            style={{ background: active ? 'var(--cp-grade-a)' : 'var(--cp-closed)' }}
                            aria-hidden="true"
                        />
                        {(fac.status as string) || (active ? 'Permitted' : 'Closed')}
                    </span>
                    <span
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-cp-ink-2"
                        title={`Inspection records published by the ${dept.name}`}
                    >
                        <Landmark size={13} aria-hidden="true" className="text-cp-ink-3" />
                        {dept.name}
                    </span>
                    {approx && (
                        <span className="rounded-cp-pill border border-cp-hairline bg-cp-surface-2 px-2 py-1 text-[10.5px] font-semibold" style={{ color: 'var(--cp-grade-c)' }}>
                            ≈ {approx}
                        </span>
                    )}
                </div>
            </header>

            <div className="flex-1 overflow-y-auto [scrollbar-color:var(--cp-surface-3)_transparent] [scrollbar-width:thin]">
                {lite ? (
                    <div className="px-4 py-4">
                        <a
                            href={permitUrl(row)}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex items-center gap-1.5 rounded-cp-control bg-cp-accent-solid px-3 py-2 text-[12.5px] font-semibold text-cp-accent-ink"
                        >
                            View inspections {dept.handoff}
                            <ExternalLink size={13} aria-hidden="true" />
                        </a>
                        <p className="mt-2.5 text-[12px] text-cp-ink-3">
                            Inspection reports live on the official {fairfax ? 'Fairfax County Health Department site' : 'VDH portal'} — this map is a finder.
                        </p>
                    </div>
                ) : state.status === 'loading' ? (
                    <p className="px-4 py-4 text-[12.5px] text-cp-ink-3">Loading {row.name}…</p>
                ) : !detail ? (
                    <p className="px-4 py-4 text-[12.5px] text-cp-ink-3">
                        Failed to load: {(state.status === 'ready' && state.detail.reason) || 'unknown'}
                    </p>
                ) : (
                    <>
                        {typeof fac.status_onpage === 'string' && fac.status
                            && fac.status_onpage.toLowerCase() !== (fac.status as string).toLowerCase() && (
                            <p className="px-4 pt-2.5 text-[11.5px]" style={{ color: 'var(--cp-grade-c)' }} title="The inspection page reports a different status than the permit roster">
                                ⚠ inspection page says: {fac.status_onpage}
                            </p>
                        )}
                        {Array.isArray(fac.merged_from) && fac.merged_from.length > 0 && (
                            <p className="px-4 pt-2.5 text-[11.5px] text-cp-ink-3" title="Same address, near-identical name — a re-issued permit. History below spans all permits.">
                                Includes earlier permit{fac.merged_from.length === 1 ? '' : 's'}:{' '}
                                {(fac.merged_from as Array<{ name?: string; permit_id?: string }>).map((m, i) => (
                                    <span key={i}>
                                        {i > 0 && ' · '}
                                        <a
                                            href={permitUrl(m, row.tenant)}
                                            target="_blank"
                                            rel="noopener"
                                            className="text-cp-accent hover:underline"
                                        >
                                            {m.name}
                                        </a>
                                    </span>
                                ))}
                            </p>
                        )}
                        <div className="px-4 pt-3.5">
                            {inspections.length || isNew ? (
                                <GradeHero fac={fac} delta={delta} onOpen={() => setReceiptOpen(true)} />
                            ) : (
                                <p className="text-[12.5px] text-cp-ink-3">No inspection detail available yet.</p>
                            )}
                        </div>
                        {!isNew && (
                            <div className="px-4">
                                <TrendSection series={series} />
                            </div>
                        )}
                        {inspections.length > 0 && (
                            <div className="px-2.5 pt-2.5 pb-4">
                                <h3 className="px-2 py-1.5 text-[10.5px] font-semibold tracking-[.07em] text-cp-ink-3 uppercase">
                                    Inspection history · {inspections.length} visit{inspections.length === 1 ? '' : 's'}
                                </h3>
                                {inspections.map((insp, i) => (
                                    <InspectionRow key={i} insp={insp} openByDefault={i === 0} fairfax={fairfax} />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {receiptOpen && receipt && (
                <Suspense fallback={null}>
                    <ReceiptModal
                        receipt={receipt}
                        name={(fac.name as string) ?? row.name}
                        fairfax={fairfax}
                        onClose={() => setReceiptOpen(false)}
                        onAbout={() => {
                            setReceiptOpen(false)
                            onAbout()
                        }}
                    />
                </Suspense>
            )}
        </aside>
    )
}
