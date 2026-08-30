/**
 * The marker-bound hover card (§6.2, CRVa-M1) — the display-only preview a
 * fine pointer gets over a marker. Renders INSTANTLY and COMPLETELY from
 * the roster row (finder + overlay): identity + the grade circle, the two
 * anchor boxes (last broad · last visit), and the compact trend instrument
 * drawn from the overlay's `visits`. ZERO fetches (C3) — on Workers Free
 * the metered unit is the request, and a curious mouse must cost nothing.
 *
 * The basic map keeps the slim name + address tip (P6: no judgment). Both
 * tiers qualify an approximate pin (C9). Nothing here is a control —
 * interactive trend/receipt behavior belongs to the clicked panel (M2).
 */

import {
    approximateLabel, facilityPresentation, gradeColor, isActivePermit,
    isNewlyPermitted, visitsOf,
} from './data/presentation'
import type { ScopeEvent } from './data/presentation'
import { trendClaim } from './trend'
import { TrendInstrument } from './TrendInstrument'
import type { RosterRow } from './data/types'

function AnchorBox({ label, date, value }: {
    label: string
    date: string | null
    value: string | null
}) {
    return (
        <div className="rounded-[6px] border border-cp-hairline bg-cp-surface-2 px-2 py-1.5">
            <div className="text-[9.5px] tracking-[.06em] text-cp-ink-3 uppercase">{label}</div>
            <div className="text-[12px] font-semibold tabular-nums">
                {date ?? '—'}
                {value ? ` · ${value}` : ''}
            </div>
        </div>
    )
}

/** The "last visit" box speaks the same claim its trend mark makes. */
function visitValue(event: ScopeEvent | undefined): string | null {
    if (!event) return null
    const claim = trendClaim(event)
    return claim.readout || null
}

export function HoverCard({ f, lite }: { f: RosterRow; lite: boolean }) {
    const approx = approximateLabel(f)
    const addressLine = [f.address || '', f.city || '', f.zip || '']
        .filter(Boolean)
        .join(' · ')

    if (lite) {
        return (
            <div className="w-56 text-cp-ink">
                <div className="text-[13px] font-semibold">{f.name}</div>
                <div className="text-[11.5px] text-cp-ink-3">{addressLine}</div>
                {approx && <div className="mt-0.5 text-[11px] text-cp-ink-3">≈ {approx}</div>}
            </div>
        )
    }

    const view = facilityPresentation(f)
    const grade = view.grade
    const isNew = isNewlyPermitted(f)
    const active = isActivePermit(f)
    const series = visitsOf(f)
    const lastBroad = series.broad[series.broad.length - 1]
    const lastVisit = series.events[series.events.length - 1]

    return (
        <div className="w-[262px] text-cp-ink">
            <div className="flex items-center gap-2.5">
                <div
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-full font-bold text-white"
                    style={{
                        background: grade ? gradeColor(grade.letter)
                            : isNew ? 'var(--cp-new)' : 'var(--cp-grade-none)',
                        fontSize: grade ? 18 : 10.5,
                    }}
                >
                    {grade ? grade.letter : isNew ? 'NEW' : '—'}
                </div>
                <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold">
                        {f.name}
                        {!active && (
                            <span className="ml-1.5 align-middle text-[10px] font-semibold text-cp-ink-3 uppercase">
                                {f.status || 'closed'}
                            </span>
                        )}
                    </div>
                    <div className="truncate text-[11.5px] text-cp-ink-3">{addressLine}</div>
                    {approx && <div className="text-[11px] text-cp-ink-3">≈ {approx}</div>}
                </div>
            </div>
            {isNew && (
                <p className="mt-2 text-[11.5px] text-cp-ink-2">
                    Newly permitted — cleared to open; no graded inspection yet.
                </p>
            )}
            {(lastBroad || lastVisit) && (
                <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                    <AnchorBox
                        label="Last broad inspection"
                        date={lastBroad?.inspection.date ?? null}
                        value={lastBroad?.presentation.score != null
                            ? String(lastBroad.presentation.score) : null}
                    />
                    <AnchorBox
                        label="Last visit"
                        date={lastVisit?.inspection.date ?? null}
                        value={visitValue(lastVisit)}
                    />
                </div>
            )}
            {!isNew && series.events.length > 0 && (
                <div className="mt-2">
                    <TrendInstrument series={series} variant="card" />
                </div>
            )}
            {!isNew && !series.events.length && !grade && (
                <p className="mt-2 text-[11.5px] text-cp-ink-3">No inspections on record yet.</p>
            )}
        </div>
    )
}
