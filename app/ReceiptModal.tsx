/**
 * The report-card modal (§6.2, CRVa-M2) — the grade breakdown behind the
 * panel's tappable hero: broad anchor → follow-up effects → ledger, from
 * `gradeReceiptPresentation` (app/data/receipt.ts). When the engine-mirror
 * reconcile failed (`verified` false) per-item point values are absent and
 * the receipt leans on the published aggregates — membership and copy
 * render either way. Escape and the backdrop close it; focus is lightly
 * contained (small dialog, no full trap machinery).
 */

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { fmtDate, fmtDateNum, gradeColor, gradeForScore } from './data/presentation'
import type { GradeReceipt, JourneyBucket, ReceiptJourneyRow } from './data/receipt'

const fmt1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function CatChip({ category, points }: { category: string; points: boolean }) {
    const rf = category === 'risk_factor'
    return (
        <span
            className="rounded-[4px] border px-1.5 py-[3px] text-cp-10.5 font-semibold"
            style={{
                color: rf ? 'var(--cp-grade-d)' : 'var(--cp-ink-2)',
                borderColor: rf ? 'var(--cp-grade-d)' : 'var(--cp-hairline)',
            }}
            title={rf
                ? 'Foodborne-illness risk factor (form items 1–29) — 6 points per violation'
                : 'Good Retail Practices (items 30+) — 2 points per violation'}
        >
            {rf ? (points ? 'risk factor −6' : 'risk factor') : (points ? 'retail practice −2' : 'retail practice')}
        </span>
    )
}

function Chip({ text, title, className, style }: {
    text: string
    title?: string
    className?: string
    style?: React.CSSProperties
}) {
    return (
        <span
            className={`rounded-[4px] px-1.5 py-[3px] text-cp-10.5 font-semibold ${className ?? ''}`}
            style={style}
            title={title}
        >
            {text}
        </span>
    )
}

const REPEAT_CHIP = { background: 'color-mix(in srgb, var(--cp-grade-d) 18%, transparent)', color: 'var(--cp-grade-d)' }
const COS_CHIP = { background: 'color-mix(in srgb, var(--cp-grade-a) 18%, transparent)', color: 'var(--cp-grade-a)' }
const NARR_CHIP = { background: 'var(--cp-surface-3)', color: 'var(--cp-ink-2)' }

/** Whether the base's corrected-on-site discount SURVIVES into the grade
 *  for a journey bucket — `failed` and `cos` charge full, so badging the
 *  credit there would advertise a discount the arithmetic took back. */
const creditHeld = (bucket: JourneyBucket) => bucket === 'restored' || bucket === 'unchecked'

function ItemShell({ rf, children }: { rf: boolean; children: React.ReactNode }) {
    return (
        <div
            className="my-1.5 rounded-[0_6px_6px_0] border-l-[3px] bg-cp-surface-1 px-2.5 py-2"
            style={{ borderLeftColor: rf ? 'var(--cp-grade-f)' : 'var(--cp-grade-d)' }}
        >
            {children}
        </div>
    )
}

function JourneyRow({ row, delta }: { row: ReceiptJourneyRow; delta: React.ReactNode }) {
    const texts = row.texts
    return (
        <ItemShell rf={row.category === 'risk_factor'}>
            <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-cp-11 font-bold text-cp-ink-3 tabular-nums">#{row.item}</span>
                <CatChip category={row.category} points={false} />
                {row.count > 1 && (
                    <Chip
                        text={`×${row.count} findings`}
                        style={NARR_CHIP}
                        title={row.countSums
                            ? 'Several violations were cited under this item; the re-check resolves the whole item at once'
                            : 'Several violations were cited under this item on the re-check — the item docks once, at its category weight'}
                    />
                )}
                {row.repeat && (
                    <Chip
                        text={row.repeatCount && row.repeatCount < row.count
                            ? `${row.repeatCount} of ${row.count} repeat ×1.5`
                            : 'repeat ×1.5'}
                        style={REPEAT_CHIP}
                        title="Repeats weigh 1.5× — charged to the findings the inspector badged"
                    />
                )}
                {row.cosBase && creditHeld(row.bucket) && (
                    <Chip
                        text={row.cosCount && row.cosCount < row.count
                            ? `${row.cosCount} of ${row.count} fixed on site`
                            : 'fixed on site ×0.75'}
                        style={COS_CHIP}
                        title="Corrected while the inspector watched — docks 75% of that finding's weight, provisionally"
                    />
                )}
                {row.narrative && (
                    <Chip
                        text="written verdict"
                        style={NARR_CHIP}
                        title="Outcome read from the inspector's written comments (adjudicated)"
                    />
                )}
                <span className="ml-auto">{delta}</span>
            </div>
            {texts.length > 1 ? (
                <ul className="mt-1 list-disc pl-4">
                    {texts.map((t, i) => (
                        <li key={i} className="text-cp-12.5">{t}</li>
                    ))}
                </ul>
            ) : texts.length === 1 ? (
                <div className="mt-1 text-cp-12.5">{texts[0]}</div>
            ) : null}
        </ItemShell>
    )
}

function Delta({ kind, value }: { kind: 'pos' | 'neg' | 'mut'; value: string }) {
    const color = kind === 'pos' ? 'var(--cp-grade-a)' : kind === 'neg' ? 'var(--cp-danger)' : 'var(--cp-ink-3)'
    return <span className="text-cp-12 font-bold tabular-nums" style={{ color }}>{value}</span>
}

const JOURNEY_GROUPS: Array<{
    bucket: JourneyBucket
    title: string
    sub: string
    delta: (row: ReceiptJourneyRow) => React.ReactNode
}> = [
    {
        bucket: 'restored', title: 'Verified fixed', sub: "restores 65% of the item's deduction",
        delta: (row) => (row.delta != null ? <Delta kind="pos" value={`+${fmt1(row.delta)}`} /> : null),
    },
    {
        bucket: 'failed', title: 'Found OUT again', sub: 'full weight ×1.5 — any on-site credit revoked',
        delta: (row) => (row.delta != null ? <Delta kind="neg" value={`−${fmt1(row.delta)} more`} /> : null),
    },
    {
        bucket: 'cos', title: 'OUT again, re-fixed on the spot', sub: 'full weight — the base on-site credit is revoked',
        delta: (row) => (row.delta != null
            ? (row.delta > 0
                ? <Delta kind="neg" value={`−${fmt1(row.delta)} more`} />
                : <Delta kind="mut" value="±0" />)
            : null),
    },
    {
        bucket: 'new', title: 'New findings on re-checks', sub: 'dock at category weight',
        delta: (row) => (row.delta != null ? <Delta kind="neg" value={`−${fmt1(row.delta)}`} /> : null),
    },
    {
        bucket: 'unchecked', title: 'Not re-checked', sub: 'the deduction stands as-is',
        delta: (row) => (row.dockPts != null ? <Delta kind="mut" value={`−${fmt1(row.dockPts)} carried`} /> : null),
    },
]

export function ReceiptModal({ receipt, name, onClose, onAbout, fairfax = false }: {
    receipt: GradeReceipt
    name: string
    onClose: () => void
    onAbout: () => void
    /** The facility's record is the Fairfax Health District's (FFX-M4):
     *  the footer carries the OQ-G disclosure. */
    fairfax?: boolean
}) {
    const dialog = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        // Light focus containment: anything tabbing out is pulled back.
        const onFocus = (e: FocusEvent) => {
            if (dialog.current && !dialog.current.contains(e.target as Node)) {
                dialog.current.focus()
            }
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('focusin', onFocus)
        dialog.current?.focus()
        return () => {
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('focusin', onFocus)
        }
    }, [onClose])

    const r = receipt
    const b = r.base
    const n = b.violationCount || 0

    return (
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-cp-scrim p-4 max-sm:items-end max-sm:p-0"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <div
                ref={dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="cpReceiptTitle"
                tabIndex={-1}
                className="flex max-h-[86vh] w-[560px] max-w-full flex-col overflow-hidden rounded-cp-card border border-cp-hairline bg-cp-surface-1 shadow-cp outline-none max-sm:max-h-[92vh] max-sm:rounded-b-none"
            >
                <div className="flex items-center gap-3 border-b border-cp-hairline px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-cp-10.5 font-semibold tracking-[.07em] text-cp-ink-3 uppercase">
                            How this grade was computed
                        </div>
                        <h2 id="cpReceiptTitle" className="truncate text-cp-15 font-bold">{name}</h2>
                    </div>
                    <span
                        className="flex h-10 w-10 flex-none flex-col items-center justify-center rounded-full text-white"
                        style={{ background: gradeColor(r.grade.letter) }}
                        role="img"
                        aria-label={`Grade ${r.grade.letter}, score ${r.grade.score} of 100`}
                    >
                        <span className="text-cp-10 leading-none font-bold">{r.grade.letter}</span>
                        <span className="text-cp-13 leading-tight font-bold tabular-nums">{r.grade.score}</span>
                    </span>
                    <button type="button" aria-label="Close" onClick={onClose} className="flex-none text-cp-ink-3 hover:text-cp-ink">
                        <X size={17} aria-hidden="true" />
                    </button>
                </div>

                <div className="overflow-y-auto px-4 py-3">
                    {/* section 1: the broad anchor */}
                    <section className="mb-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-cp-12.5 font-semibold">Broad inspection — {fmtDate(b.date)}</span>
                            <span
                                className="rounded-[6px] px-2 py-1 text-cp-12 font-bold text-white tabular-nums"
                                style={{ background: gradeColor(gradeForScore(b.score)) }}
                                title="This inspection's score — the grade's base"
                            >
                                {b.score}
                            </span>
                        </div>
                        {b.found && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                <Chip
                                    text={`${n} violation${n === 1 ? '' : 's'}`}
                                    className="text-white"
                                    style={{ background: n ? gradeColor('F') : gradeColor('A') }}
                                />
                                {!!b.rfCount && <Chip text={`${b.rfCount} risk factor`} style={REPEAT_CHIP} title="Foodborne-illness risk factors (form items 1–29)" />}
                                {!!b.grpCount && <Chip text={`${b.grpCount} retail practice`} style={NARR_CHIP} title="Good Retail Practices (items 30+)" />}
                            </div>
                        )}
                        {!b.found ? (
                            <p className="mt-1.5 text-cp-12 text-cp-ink-2">
                                The anchoring broad inspection isn't in the shipped history, so the
                                per-item breakdown is unavailable — the published totals below still stand.
                            </p>
                        ) : !b.items.length && !b.itemless ? (
                            <p className="mt-1.5 text-cp-12 text-cp-ink-2">
                                No violations recorded: a clean 100-point inspection.
                            </p>
                        ) : (
                            <>
                                {b.items.map((it, i) => (
                                    <ItemShell key={i} rf={it.category === 'risk_factor'}>
                                        <div className="flex flex-wrap items-baseline gap-1.5">
                                            <span className="text-cp-11 font-bold text-cp-ink-3 tabular-nums">#{it.item}</span>
                                            <CatChip category={it.category} points />
                                            {it.repeat && <Chip text="repeat ×1.5" style={REPEAT_CHIP} title="The inspector badged THIS finding a repeat — 1.5× its weight" />}
                                            {it.cos && <Chip text="fixed on site ×0.75" style={COS_CHIP} title="This finding was corrected while the inspector watched — docks 75% of its weight, provisionally" />}
                                            {it.points != null && (
                                                <span className="ml-auto text-cp-12 font-bold text-cp-danger tabular-nums">−{fmt1(it.points)}</span>
                                            )}
                                        </div>
                                        {it.text && <div className="mt-1 text-cp-12.5">{it.text}</div>}
                                    </ItemShell>
                                ))}
                                {b.itemless && (
                                    <p className="mt-1.5 text-cp-12 text-cp-ink-2">
                                        {b.itemless.count} observation{b.itemless.count === 1 ? '' : 's'} without
                                        a form item number — dock{b.itemless.count === 1 ? 's' : ''} at face value
                                        {b.itemless.points != null ? ` (−${fmt1(b.itemless.points)})` : ''} and can't
                                        be re-checked by item.
                                    </p>
                                )}
                            </>
                        )}
                    </section>

                    {/* section 2: follow-ups and their effects */}
                    {r.adjusted && (
                        <section className="mb-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 p-2.5">
                            <div className="text-cp-12.5 font-semibold">
                                Since then — {r.followups.length} re-check{r.followups.length === 1 ? '' : 's'}
                            </div>
                            {r.followups.map((v, i) => (
                                <div key={i} className="mt-1.5 flex flex-wrap items-center gap-2 text-cp-12">
                                    <span className="text-cp-ink-3 tabular-nums">{fmtDateNum(v.date)}</span>
                                    <Chip text={v.label} style={NARR_CHIP} title={v.detail} />
                                    <span className="text-cp-ink-3">
                                        {v.kind === 'narrative' ? 'written verdict' : 'focused re-check'}
                                    </span>
                                </div>
                            ))}
                            <p className="mt-2 text-cp-11.5 text-cp-ink-3">
                                For each item the broad visit docked, the newest re-check governs:
                            </p>
                            {JOURNEY_GROUPS.filter(({ bucket }) => r.journeys[bucket].length).map(({ bucket, title, sub, delta }) => (
                                <div key={bucket} className="mt-2">
                                    <div className="text-cp-12 font-semibold">
                                        {title} <small className="font-normal text-cp-ink-3">{sub}</small>
                                    </div>
                                    {r.journeys[bucket].map((row, i) => (
                                        <JourneyRow key={i} row={row} delta={delta(row)} />
                                    ))}
                                </div>
                            ))}
                        </section>
                    )}

                    {/* section 3: the ledger */}
                    {r.adjusted && (
                        <section className="mb-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 p-2.5 text-cp-12.5">
                            <div className="flex justify-between py-0.5"><span>Base broad score</span><b className="tabular-nums">{r.ledger.baseScore}</b></div>
                            <div className="flex justify-between py-0.5">
                                <span>Restored by verified fixes</span>
                                <b className="tabular-nums" style={{ color: 'var(--cp-grade-a)' }}>+{fmt1(r.ledger.restored)}</b>
                            </div>
                            <div className="flex justify-between py-0.5">
                                <span>Added by failed re-checks &amp; new findings</span>
                                <b className="tabular-nums" style={{ color: 'var(--cp-danger)' }}>−{fmt1(r.ledger.added)}</b>
                            </div>
                            <div className="mt-1 flex items-center justify-between border-t border-cp-hairline pt-1.5 font-bold">
                                <span>Facility grade</span>
                                <span className="rounded-[6px] px-2 py-0.5 text-white tabular-nums" style={{ background: gradeColor(r.ledger.letter) }}>
                                    {r.ledger.score} {r.ledger.letter}
                                </span>
                            </div>
                            {!r.ledger.exact && (
                                <p className="mt-1.5 text-cp-11 text-cp-ink-3">
                                    Components are shown to one decimal; the score itself rounds once,
                                    at the end (halves up), so the lines may not visibly sum.
                                </p>
                            )}
                        </section>
                    )}

                    <p className="pb-1 text-cp-11 text-cp-ink-3">
                        {fairfax && (
                            <>
                                Fairfax County grades are anchored on the most recent full inspection.
                                The county records every visit as a complete inspection, so no
                                follow-up or re-check adjustment applies.{' '}
                            </>
                        )}
                        CleanPlateVA computes this score and grade; neither the Virginia Department
                        of Health nor the Fairfax County Health Department publishes a numeric score
                        of its own. Read the full method on the{' '}
                        <button type="button" className="text-cp-accent hover:underline" onClick={onAbout}>
                            About
                        </button>{' '}
                        page.
                    </p>
                </div>
            </div>
        </div>
    )
}
