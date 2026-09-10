/**
 * The framed trend section (§6.0) — "TREND · N VISITS" header, the FULL
 * panel-variant instrument (threshold hairlines, A·C·F band labels,
 * endpoint dates), and the mark-grammar legend. ONE component for both
 * consumers: the detail panel (CRVa-M2) and — since the maintainer's 2026-08-30
 * preview-review call — the hover card, which borrows the expanded view's
 * trend wholesale (dates and legend included) instead of a compact
 * variant. One module, two mounts, so the two surfaces cannot drift (the
 * TermsBody discipline). `width` rescales the instrument's geometry for a
 * narrower host (trend.ts preserves the label gutter).
 */

import { TrendInstrument } from './TrendInstrument'
import type { ScopeSeries } from './data/presentation'

export function TrendSection({ series, width }: { series: ScopeSeries; width?: number }) {
    if (!series.events.length) return null
    return (
        <section className="mt-2.5 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3 pt-2.5 pb-2">
            <div className="text-cp-12 font-semibold tracking-[.07em] text-cp-ink-3 uppercase">
                Trend · {series.events.length} visit{series.events.length === 1 ? '' : 's'}
            </div>
            <div className="mt-1.5">
                <TrendInstrument series={series} variant="panel" width={width} />
            </div>
            <div className="mt-1 flex gap-4 text-cp-12.5 text-cp-ink-3">
                <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-[11px] w-[11px] rounded-full border-[1.5px] border-dashed border-cp-ink-3" aria-hidden="true" />
                    broad score
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-[9px] w-[9px] rotate-45 border-[1.5px] border-dashed border-cp-ink-3" aria-hidden="true" />
                    re-check
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-3 w-[3px] bg-cp-ink-3" aria-hidden="true" />
                    scope unknown
                </span>
            </div>
        </section>
    )
}
