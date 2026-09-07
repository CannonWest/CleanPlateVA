/**
 * The trend instrument's GEOMETRY (§6.0, CRVa-M1) — one pure layout for
 * both consumers (the hover card's compact instance and the panel's full
 * section). React renders what this returns; every rule is testable here
 * without a DOM.
 *
 * The ratified scale (decision record: docs/mockups/trend-compare.html):
 *   · y is ABSOLUTE over the grade domain, resting at 100→55 so the F
 *     threshold is always in frame;
 *   · when a real claimed height falls below the floor the domain EXTENDS
 *     to include it — thresholds keep their absolute values and compress
 *     upward; a real value is never clipped, and the range is never
 *     normalized to the data's own min/max (the outlier's score shows in
 *     its always-on label like every other mark).
 *
 * The mark grammar (ports the old `sparkline.js` semantics):
 *   · line + dots = BROAD scores only, dot filled with the score's grade
 *     color; a scoreless broad visit holds its x-slot with no mark;
 *   · hollow DIAMONDS = focused re-checks at their COMPLIANCE height
 *     (never the raw VDH score — the #42/#43 invariant), outcome-toned,
 *     never joined to the line; no trustworthy ratio ⇒ a baseline tick;
 *   · FILLED diamond = adjudicated written verdict at its verdict height
 *     (all-corrected rides the 100 line);
 *   · baseline tick below the band = an event with nothing claimable;
 *   · every claiming mark carries its LABEL — score, bare X/Y ratio, or
 *     verdict glyph — printed ABOVE the mark always (Cannon's 2026-08-30
 *     preview call, the old sparkline's grammar in the new style); the
 *     panel geometry reserves headroom so a 100-height mark's label and
 *     its 1.7× hover enlargement both stay in frame. This retires the
 *     hover-only readout and the below-floor beside-the-mark side label.
 */

import {
    focusedOutcomePresentation, gradeColor, gradeForScore,
    narrativeVerdictPresentation,
} from './data/presentation'
import type { ScopeEvent, ScopeSeries } from './data/presentation'

export const TREND_REST_FLOOR = 55

/** The old outcome tones spoken in the ramp — as the grade TOKENS, so the
 *  instrument's SVG follows the visitor's palette like every other surface
 *  (presentation attributes take a `var()`). */
export const TONE_COLORS: Record<string, string> = {
    clear: gradeColor('A'),
    good: gradeColor('B'),
    watch: gradeColor('C'),
    warning: gradeColor('D'),
    severe: gradeColor('F'),
    unknown: gradeColor(null),
}

export type TrendVariant = 'panel' | 'card'

export interface TrendGeometry {
    width: number
    height: number
    /** Right gutter start — plot content ends here; band labels sit past it. */
    plotRight: number
    padLeft: number
    padRight: number
    bandTop: number
    bandBottom: number
    tickTop: number
    tickBottom: number
    dotRadius: number
    /** Half-diagonal box size of a diamond (the square before rotation). */
    diamondHalf: number
    furniture: boolean
    datesY: number
}

// bandTop carries 18px more headroom than the CRVa-M1 original (8→26,
// span preserved): the always-on labels sit ~12px above their marks, and
// a 100-height mark — label included, hover-enlarged included — must
// stay inside the frame.
const PANEL_GEO: TrendGeometry = {
    width: 364, height: 128, plotRight: 344, padLeft: 10, padRight: 8,
    bandTop: 26, bandBottom: 98, tickTop: 96, tickBottom: 108,
    dotRadius: 5.5, diamondHalf: 5.5, furniture: true, datesY: 120,
}

const CARD_GEO: TrendGeometry = {
    width: 262, height: 46, plotRight: 262, padLeft: 8, padRight: 8,
    bandTop: 5, bandBottom: 30, tickTop: 29, tickBottom: 37,
    dotRadius: 3.5, diamondHalf: 4, furniture: false, datesY: 0,
}

export function trendGeometry(variant: TrendVariant, width?: number): TrendGeometry {
    const base = variant === 'panel' ? PANEL_GEO : CARD_GEO
    if (!width || width === base.width) return base
    const gutter = base.width - base.plotRight
    return { ...base, width, plotRight: width - gutter }
}

/** The domain floor: 55 resting; extended DOWN to a multiple of 5 strictly
 *  below the lowest claimed height (never flush, so the mark keeps air
 *  under it), clamped at 0. */
export function trendFloor(heights: number[]): number {
    const real = heights.filter((h) => Number.isFinite(h))
    if (!real.length) return TREND_REST_FLOOR
    const min = Math.min(...real)
    if (min >= TREND_REST_FLOOR) return TREND_REST_FLOOR
    let floor = 5 * Math.floor(min / 5)
    if (floor === min) floor -= 5
    return Math.max(0, floor)
}

export interface TrendMark {
    kind: 'broad' | 'focused' | 'narrative' | 'tick'
    x: number
    y: number
    /** Fill for broad/narrative; stroke for the hollow focused diamond. */
    color: string
    /** Printed ABOVE the mark always — score, bare X/Y, or ✓-glyph
     *  (the claim's readout with the ' OUT' suffix dropped); '' = tick. */
    label: string
    historyIndex: number
}

export interface TrendHairline {
    score: number
    y: number
    dashed: boolean
}

export interface TrendBandLabel {
    text: string
    y: number
    tone: 'muted' | 'f'
}

export interface TrendLayout {
    geometry: TrendGeometry
    floor: number
    /** Broad line vertices, oldest → newest. */
    line: Array<{ x: number; y: number }>
    marks: TrendMark[]
    hairlines: TrendHairline[]
    bandLabels: TrendBandLabel[]
    /** Endpoint dates (YYYY-MM), start-anchored and end-anchored. */
    dates: { start: string; end: string } | null
    visitCount: number
}

function ym(iso: string | null | undefined): string {
    return iso ? iso.slice(0, 7) : ''
}

export interface TrendClaim {
    height: number | null
    kind: TrendMark['kind']
    readout: string
    color: string
}

/** The height (0–100 score space) an event claims, or null (tick), plus
 *  the readout that names it — shared by the marks and the hover card's
 *  "Last visit" anchor box so the two never disagree. */
export function trendClaim(event: ScopeEvent): TrendClaim {
    const p = event.presentation
    if (p.gradeEligible && p.score != null) {
        return {
            height: p.score,
            kind: 'broad',
            readout: String(p.score),
            color: gradeColor(gradeForScore(p.score)),
        }
    }
    if (p.scope === 'focused') {
        const outcome = focusedOutcomePresentation(p)
        if (outcome.ratioKnown && outcome.complianceRate != null) {
            return {
                height: outcome.complianceRate * 100,
                kind: 'focused',
                readout: outcome.label,
                color: TONE_COLORS[outcome.tone] ?? TONE_COLORS.unknown ?? '#868e96',
            }
        }
        return { height: null, kind: 'tick', readout: '', color: '' }
    }
    if (p.scope === 'unknown') {
        const adj = narrativeVerdictPresentation(event.inspection)
        if (adj) {
            return {
                height: adj.height,
                kind: 'narrative',
                readout: `${adj.glyph}${adj.count ?? ''}`,
                color: TONE_COLORS[adj.tone] ?? TONE_COLORS.unknown ?? '#868e96',
            }
        }
        return { height: null, kind: 'tick', readout: '', color: '' }
    }
    // A scoreless broad visit: an x-slot, no mark at all.
    return { height: null, kind: 'broad', readout: '', color: '' }
}

/** Lay the series out for a variant. Pure — same series, same layout. */
export function trendLayout(series: ScopeSeries, variant: TrendVariant, width?: number): TrendLayout {
    const geometry = trendGeometry(variant, width)
    const events = series.events
    const n = events.length
    const claims = events.map(trendClaim)

    const floor = trendFloor(claims.map((c) => c.height).filter((h): h is number => h != null))
    const bandSpan = geometry.bandBottom - geometry.bandTop
    const y = (height: number) => geometry.bandTop + ((100 - height) / (100 - floor)) * bandSpan

    const x0 = geometry.padLeft
    const x1 = geometry.plotRight - geometry.padRight
    const x = (i: number) => (n === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (n - 1))

    const marks: TrendMark[] = []
    const line: Array<{ x: number; y: number }> = []
    events.forEach((event, i) => {
        const claim = claims[i]
        if (!claim) return
        const px = x(i)
        if (claim.height == null) {
            if (claim.kind === 'tick') {
                marks.push({
                    kind: 'tick',
                    x: px,
                    y: (geometry.tickTop + geometry.tickBottom) / 2,
                    color: '',
                    label: '',
                    historyIndex: event.historyIndex,
                })
            }
            return // the scoreless broad x-slot: spacing, no mark
        }
        const py = y(claim.height)
        if (claim.kind === 'broad') line.push({ x: px, y: py })
        marks.push({
            kind: claim.kind,
            x: px,
            y: py,
            color: claim.color,
            // The compact above-mark form: the old sparkline printed bare
            // ratios ("3/5"); the claim's fuller "3/5 OUT" stays the anchor
            // vocabulary elsewhere.
            label: claim.readout.replace(/ OUT$/, ''),
            historyIndex: event.historyIndex,
        })
    })

    const hairlines: TrendHairline[] = geometry.furniture
        ? [90, 80, 70, 60].map((score) => ({ score, y: y(score), dashed: score === 60 }))
        : []

    const bandLabels: TrendBandLabel[] = geometry.furniture
        ? [
            { text: 'A', y: (y(100) + y(90)) / 2 + 4.5, tone: 'muted' as const },
            { text: 'C', y: (y(80) + y(70)) / 2 + 4.5, tone: 'muted' as const },
            { text: 'F', y: (y(60) + geometry.bandBottom) / 2 + 4.5, tone: 'f' as const },
        ]
        : []

    const first = events[0]?.inspection?.date
    const last = events[n - 1]?.inspection?.date
    const dates = geometry.furniture && n > 0 && (first || last)
        ? { start: ym(first), end: ym(last) }
        : null

    return { geometry, floor, line, marks, hairlines, bandLabels, dates, visitCount: n }
}
