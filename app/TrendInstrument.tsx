/**
 * The trend instrument (§6.0, CRVa-M1) — ONE component for both consumers:
 * the hover card's compact static instance (`variant="card"`) and the
 * detail panel's full framed section (`variant="panel"`, CRVa-M2). All
 * geometry comes from `trend.ts`; this file only draws it.
 *
 * The ratified split the mockups encode: the PANEL instance carries the
 * furniture (threshold hairlines w/ dashed 60, A·C·F band labels, endpoint
 * dates) and the hover interactivity (enlarge 1.7× / dim the rest to 30%,
 * per-mark readout — CSS in theme.css, `.cp-trend--interactive`); the CARD
 * instance is bare marks over a baseline divider and mouse-transparent —
 * interactive trend behavior belongs to the clicked panel, never the
 * hover preview.
 */

import { trendLayout } from './trend'
import type { TrendMark, TrendVariant } from './trend'
import type { ScopeSeries } from './data/presentation'
import { fmtDate } from './data/presentation'

function markShape(mark: TrendMark, dot: number, half: number) {
    if (mark.kind === 'broad') {
        return <circle cx={mark.x} cy={mark.y} r={dot} fill={mark.color} />
    }
    if (mark.kind === 'focused') {
        // Hollow: a re-check's checklist outcome, never joined to the line.
        return (
            <rect
                x={mark.x - half}
                y={mark.y - half}
                width={half * 2}
                height={half * 2}
                transform={`rotate(45 ${mark.x} ${mark.y})`}
                fill="none"
                stroke={mark.color}
                strokeWidth={2}
            />
        )
    }
    // Filled: an adjudicated written verdict at its claimed height.
    return (
        <rect
            x={mark.x - half}
            y={mark.y - half}
            width={half * 2}
            height={half * 2}
            transform={`rotate(45 ${mark.x} ${mark.y})`}
            fill={mark.color}
        />
    )
}

function summaryOf(series: ScopeSeries): string {
    const broad = series.broad.length
        ? `Broad scores oldest to newest: ${series.broad
            .map((e) => `${fmtDate(e.inspection.date)} ${e.presentation.score}`)
            .join(', ')}`
        : 'No broad scores captured'
    const focused = series.focused.length
        ? `${series.focused.length} focused re-check${series.focused.length === 1 ? '' : 's'}`
        : 'no focused re-checks'
    return `${broad}; ${focused}; ${series.unknown.length} unknown-scope event${series.unknown.length === 1 ? '' : 's'}.`
}

export function TrendInstrument({ series, variant, width }: {
    series: ScopeSeries
    variant: TrendVariant
    width?: number
}) {
    const layout = trendLayout(series, variant, width)
    const g = layout.geometry
    const interactive = variant === 'panel'

    if (!layout.marks.length && !layout.line.length) return null

    return (
        <svg
            viewBox={`0 0 ${g.width} ${g.height}`}
            role="img"
            aria-label={summaryOf(series)}
            className={`cp-trend ${interactive ? 'cp-trend--interactive' : ''}`}
        >
            {layout.hairlines.map((line) => (
                <line
                    key={line.score}
                    className="grid"
                    x1={0}
                    y1={line.y}
                    x2={g.plotRight}
                    y2={line.y}
                    stroke={line.dashed ? 'var(--cp-grade-f)' : 'var(--cp-hairline)'}
                    strokeOpacity={line.dashed ? 0.45 : 1}
                    strokeDasharray={line.dashed ? '4 4' : undefined}
                />
            ))}
            {!g.furniture && (
                // The card's one piece of furniture: the baseline divider
                // the ticks straddle (the ratified compact look).
                <line
                    className="grid"
                    x1={0}
                    y1={(g.tickTop + g.tickBottom) / 2}
                    x2={g.width}
                    y2={(g.tickTop + g.tickBottom) / 2}
                    stroke="var(--cp-hairline)"
                />
            )}
            {layout.bandLabels.map((label) => (
                <text
                    key={label.text}
                    className="grid"
                    x={g.plotRight + 8}
                    y={label.y}
                    fontSize={13}
                    fill={label.tone === 'f' ? 'var(--cp-grade-f)' : 'var(--cp-ink-3)'}
                    fillOpacity={label.tone === 'f' ? 0.85 : 1}
                >
                    {label.text}
                </text>
            ))}
            {layout.line.length > 1 && (
                <polyline
                    className="tline"
                    points={layout.line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                    fill="none"
                    stroke="var(--cp-ink-3)"
                    strokeWidth={2}
                />
            )}
            {layout.marks.map((mark, i) => {
                const shape = mark.kind === 'tick' ? (
                    <line
                        x1={mark.x}
                        y1={g.tickTop}
                        x2={mark.x}
                        y2={g.tickBottom}
                        stroke="var(--cp-ink-3)"
                        strokeWidth={variant === 'panel' ? 3 : 2.5}
                    />
                ) : (
                    markShape(mark, g.dotRadius, g.diamondHalf)
                )
                if (!interactive) {
                    return (
                        <g key={i}>
                            {shape}
                            {mark.sideLabel && (
                                <text
                                    className="nums"
                                    x={mark.x + 10}
                                    y={mark.y + 4}
                                    fontSize={10.5}
                                    fontWeight={700}
                                    fill="var(--cp-grade-f)"
                                >
                                    {mark.sideLabel}
                                </text>
                            )}
                        </g>
                    )
                }
                return (
                    <g key={i} className="tp" data-history-index={mark.historyIndex}>
                        {/* Forgiving hover target — the visible mark is small. */}
                        <circle cx={mark.x} cy={mark.y} r={12} fill="transparent" />
                        <g className="tm">{shape}</g>
                        {mark.readout && (
                            <text
                                className="tr nums"
                                x={mark.x}
                                y={mark.y - 14}
                                fontSize={12}
                                fontWeight={600}
                                textAnchor="middle"
                                fill="var(--cp-ink)"
                            >
                                {mark.readout}
                            </text>
                        )}
                        {mark.sideLabel && (
                            <text
                                className="nums"
                                x={mark.x + 14}
                                y={mark.y + 6}
                                fontSize={13}
                                fontWeight={700}
                                fill="var(--cp-grade-f)"
                            >
                                {mark.sideLabel}
                            </text>
                        )}
                    </g>
                )
            })}
            {layout.dates && (
                <>
                    <text className="grid nums" x={0} y={g.datesY} fontSize={13} fill="var(--cp-ink-3)" textAnchor="start">
                        {layout.dates.start}
                    </text>
                    <text className="grid nums" x={g.width} y={g.datesY} fontSize={13} fill="var(--cp-ink-3)" textAnchor="end">
                        {layout.dates.end}
                    </text>
                </>
            )}
        </svg>
    )
}
