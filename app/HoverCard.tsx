/**
 * The marker-bound hover card (§6.2) — the display-only preview a fine
 * pointer gets over a marker. Renders INSTANTLY and COMPLETELY from the
 * roster row (finder + overlay). ZERO fetches (C3) — on Workers Free the
 * metered unit is the request, and a curious mouse must cost nothing.
 *
 * Re-laid to the OLD client's defined zones at Cannon's preview-review
 * call (2026-08-30; supersedes the CRVa-M1 compact card): a bordered head
 * (identity), a grade hero (the circle beside its score and anchor date),
 * then the panel's trend section borrowed WHOLESALE — hairlines, band
 * labels, endpoint dates, legend — via the shared TrendSection (one
 * module, two mounts; it cannot drift from the expanded view). The
 * anchor boxes (last broad · last visit) were cut on the same day's
 * pass 3: the hero and the trend's endpoint dates already say it. The
 * popup is mouse-transparent, so the panel variant's hover interactivity
 * simply never triggers here: static furniture only.
 *
 * The basic map keeps the slim name + address tip (P6: no judgment). Both
 * tiers qualify an approximate pin (C9). Nothing here is a control —
 * interactive trend/receipt behavior belongs to the clicked panel.
 */

import {
    approximateLabel, facilityPresentation, fmtDate, gradeColor, isActivePermit,
    isNewlyPermitted, visitsOf,
} from './data/presentation'
import { TrendSection } from './TrendSection'
import type { RosterRow } from './data/types'

/** The card is w-[340px]; the trend frame's px-3 leaves this much plot. */
const HOVER_TREND_WIDTH = 316

export function HoverCard({ f, lite }: { f: RosterRow; lite: boolean }) {
    const approx = approximateLabel(f)
    const addressLine = [f.address || '', f.city || '', f.zip || '']
        .filter(Boolean)
        .join(' · ')

    if (lite) {
        return (
            <div className="w-56 text-cp-ink">
                <div className="text-cp-13 font-semibold">{f.name}</div>
                <div className="text-cp-11.5 text-cp-ink-3">{addressLine}</div>
                {approx && <div className="mt-0.5 text-cp-11 text-cp-ink-3">≈ {approx}</div>}
            </div>
        )
    }

    const view = facilityPresentation(f)
    const grade = view.grade
    const isNew = isNewlyPermitted(f)
    const active = isActivePermit(f)
    const series = visitsOf(f)
    const hasRecord = Boolean(grade || isNew || series.events.length)

    return (
        <div className="w-[340px] text-cp-ink">
            {/* The head: identity, its own bordered zone (the old
                .food-hover-card-head). */}
            <div className="border-b border-cp-hairline pb-2">
                <div className="text-cp-13.5 font-semibold">
                    {f.name}
                    {!active && (
                        <span className="ml-1.5 align-middle text-cp-10 font-semibold text-cp-ink-3 uppercase">
                            {f.status || 'closed'}
                        </span>
                    )}
                </div>
                <div className="text-cp-11.5 text-cp-ink-3">{addressLine}</div>
                {approx && <div className="text-cp-11 text-cp-ink-3">≈ {approx}</div>}
            </div>

            {/* The grade hero: the verdict circle beside its number and
                anchor date (the old .food-grade-hero, sans controls). */}
            <div className="mt-2.5 flex items-center gap-3">
                <div
                    className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full font-bold text-white"
                    style={{
                        background: grade ? gradeColor(grade.letter)
                            : isNew ? 'var(--cp-new)' : 'var(--cp-grade-none)',
                        fontSize: `calc(${grade ? 22 : isNew ? 11.5 : 20}px * var(--cp-text-scale))`,
                    }}
                >
                    {grade ? grade.letter : isNew ? 'NEW' : '–'}
                </div>
                <div className="min-w-0">
                    {grade ? (
                        <>
                            <div className="text-cp-22 leading-none font-bold tabular-nums">
                                {grade.score}
                                <small className="text-cp-13 font-semibold text-cp-ink-3">/100</small>
                            </div>
                            <div className="mt-1 text-cp-11.5 text-cp-ink-3 tabular-nums">
                                Broad inspection · {fmtDate(grade.baseDate)}
                            </div>
                        </>
                    ) : isNew ? (
                        <>
                            <div className="text-cp-14 font-bold">Permitted</div>
                            <div className="mt-0.5 text-cp-11.5 text-cp-ink-2">
                                Cleared to open; grade pending its first broad inspection.
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="text-cp-12 font-semibold text-cp-ink-2">no grade yet</div>
                            <div className="mt-0.5 text-cp-11.5 text-cp-ink-2">
                                No broad inspection (20+ items) captured yet.
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* The expanded view's trend, borrowed wholesale. */}
            {!isNew && <TrendSection series={series} width={HOVER_TREND_WIDTH} />}

            {!hasRecord && (
                <p className="mt-2 text-cp-11.5 text-cp-ink-3">No inspections on record yet.</p>
            )}
        </div>
    )
}
