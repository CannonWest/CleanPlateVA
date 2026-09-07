// @vitest-environment jsdom
/**
 * The §6.0 trend instrument (CRVa-M1) — the ratified scale + mark grammar,
 * pinned against the decision record's own numbers
 * (docs/mockups/trend-compare.html):
 *
 *   · resting domain 100→55 (the F threshold always in frame), with 18px
 *     of top headroom (bandTop 26) so a 100-mark's always-on label and
 *     its hover enlargement stay inside the frame (2026-08-30);
 *   · extend-on-demand when a real claimed height falls below the floor —
 *     thresholds keep their absolute values and compress upward;
 *   · NEVER normalized to the data's own min/max;
 *   · broad dots on the line at score height · hollow focused diamonds at
 *     COMPLIANCE height (raw focused scores never plot) · filled verdict
 *     diamonds (all-corrected rides the 100 line) · baseline ticks;
 *   · every claiming mark prints its LABEL above itself, always — score,
 *     bare X/Y ratio (no ' OUT'), or ✓-glyph (the below-floor outlier's
 *     number rides its label like every other mark's);
 *   · a scoreless broad visit holds its x-slot with no mark;
 *   · panel variant carries furniture + hover; card variant is bare/static.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { visitsOf } from '../../app/data/presentation'
import { trendFloor, trendLayout } from '../../app/trend'
import { TrendInstrument } from '../../app/TrendInstrument'
import type { RosterRow } from '../../app/data/types'
import type { VisitEntry } from '../../app/data/types'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function rowWith(visits: VisitEntry[]): RosterRow {
    return {
        permit_id: 'T-1', name: 'Test', address: null, address2: null,
        city: null, zip: null, tenant: 'richmond', is_restaurant: true,
        mobile: false, pt: 1, lat: 37.5, lon: -77.4, loc: 0,
        o: { visits },
    }
}

const series = (visits: VisitEntry[]) => visitsOf(rowWith(visits))

test('the resting domain is 100→55 and maps the decision record\'s own pixels', () => {
    // trend-compare case 1: 85 · 84 · 80 · unknown tick · 78 · 76.
    const layout = trendLayout(series([
        [1, 20250315, 85], [1, 20250612, 84], [1, 20250915, 80],
        [0, 20251201], [1, 20260310, 78], [1, 20260715, 76],
    ]), 'panel')
    expect(layout.floor).toBe(55)
    const ys = layout.marks.filter((m) => m.kind === 'broad').map((m) => +m.y.toFixed(1))
    // The decision record's pixels + the 18px label headroom (bandTop 26).
    expect(ys).toEqual([50, 51.6, 58, 61.2, 64.4])
    // Threshold furniture: 90/80/70/60 hairlines, the 60 dashed.
    expect(layout.hairlines.map((h) => [h.score, +h.y.toFixed(1), h.dashed])).toEqual([
        [90, 42, false], [80, 58, false], [70, 74, false], [60, 90, true],
    ])
    // Band labels A · C · F only; endpoint dates start/end anchored.
    expect(layout.bandLabels.map((b) => b.text)).toEqual(['A', 'C', 'F'])
    expect(layout.dates).toEqual({ start: '2025-03', end: '2026-07' })
    // The tick holds the below-band zone.
    const tick = layout.marks.find((m) => m.kind === 'tick')
    expect(tick).toBeTruthy()
    expect(tick && tick.y > 90).toBe(true)
})

test('a 29 extends the domain to 25; thresholds compress upward; the outlier keeps its number', () => {
    // trend-compare case 2: 92 · 94 · 29 · verdict diamond · 88 · 91.
    const layout = trendLayout(series([
        [1, 20250315, 92], [1, 20250612, 94], [1, 20250915, 29],
        [3, 20251201, 1], [1, 20260310, 88], [1, 20260715, 91],
    ]), 'panel')
    expect(layout.floor).toBe(25)
    const dip = layout.marks.find((m) => m.label === '29')
    expect(dip?.kind).toBe('broad')
    expect(+((dip?.y ?? 0).toFixed(1))).toBe(94.2)
    expect(layout.hairlines.map((h) => +h.y.toFixed(1))).toEqual([35.6, 45.2, 54.8, 64.4])
    // The verdict diamond is FILLED at the 100 line (all corrected).
    const verdict = layout.marks.find((m) => m.kind === 'narrative')
    expect(verdict?.y).toBe(26)
    expect(verdict?.label).toBe('✓')
})

test('the range is never normalized to the data\'s own min/max', () => {
    const layout = trendLayout(series([[1, 20250101, 95], [1, 20260101, 98]]), 'panel')
    expect(layout.floor).toBe(55)
    // Two high-90s dots sit near the top, not stretched over the band.
    for (const mark of layout.marks) expect(mark.y).toBeLessThan(38)
})

test('a flush minimum steps the floor one notch further down', () => {
    expect(trendFloor([30])).toBe(25)
    expect(trendFloor([29])).toBe(25)
    expect(trendFloor([55, 80])).toBe(55)
    expect(trendFloor([0])).toBe(0)
    expect(trendFloor([])).toBe(55)
})

test('focused re-checks plot at their COMPLIANCE height, outcome-toned; unknown ratio = tick', () => {
    const layout = trendLayout(series([
        [1, 20250101, 90],
        [2, 20250601, 1, 3],   // 1/3 OUT → 66.7% compliance
        [2, 20250901],          // ratio unknown → tick
    ]), 'panel')
    const dia = layout.marks.find((m) => m.kind === 'focused')
    expect(dia?.label).toBe('1/3') // the claim says '1/3 OUT'; the label drops the suffix
    // 66.67 on the resting scale: 26 + (33.33/45)*72 ≈ 79.3.
    expect(+((dia?.y ?? 0).toFixed(1))).toBe(79.3)
    expect(dia?.color).toBe('var(--cp-grade-c)') // watch tone speaks the ramp's token, so it follows the palette
    expect(layout.marks.filter((m) => m.kind === 'tick')).toHaveLength(1)
})

test('an enumerated items verdict claims its counted height and label', () => {
    const layout = trendLayout(series([[3, 20250601, 4, 2, 1]]), 'panel')
    const mark = layout.marks[0]
    expect(mark?.kind).toBe('narrative')
    expect(mark?.label).toBe('✓2')
    // 2 of 3 corrected → height 67.
    expect(+((mark?.y ?? 0).toFixed(1))).toBe(+(26 + ((100 - 67) / 45) * 72).toFixed(1))
})

test('a scoreless broad visit holds its x-slot with no mark', () => {
    const layout = trendLayout(series([
        [1, 20250101, 90], [1, 20250601], [1, 20260101, 80],
    ]), 'panel')
    expect(layout.marks).toHaveLength(2)          // no mark for the middle slot
    expect(layout.line).toHaveLength(2)
    const [a, b] = layout.line
    // Three slots: the two dots sit at slots 0 and 2 — a full slot apart.
    expect(a && b && Math.abs(b.x - a.x)).toBeCloseTo(326, 0)
})

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    host?.remove()
    host = null
})

async function render(el: React.ReactElement) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(el)
    })
    return host
}

test('the panel variant carries always-on labels above the marks; the card is bare and static', async () => {
    const s = series([
        [1, 20250315, 85], [2, 20250601, 1, 3], [0, 20250901], [1, 20260101, 78],
    ])
    const el = await render(
        <>
            <TrendInstrument series={s} variant="panel" />
            <TrendInstrument series={s} variant="card" />
        </>,
    )
    const [panel, card] = Array.from(el.querySelectorAll('svg'))
    expect(panel?.classList.contains('cp-trend--interactive')).toBe(true)
    expect(panel?.querySelectorAll('g.tp')).toHaveLength(4)
    // The labels are ordinary visible text (no hover-gated .tr remains).
    const labels = Array.from(panel?.querySelectorAll('text.tl') ?? []).map((t) => t.textContent)
    expect(labels).toEqual(['85', '1/3', '78'])   // ticks carry no label; ' OUT' dropped
    expect(panel?.querySelector('text.tr')).toBeNull()
    // The hollow re-check vs the filled dot.
    expect(panel?.querySelector('rect[fill="none"]')).toBeTruthy()
    expect(card?.classList.contains('cp-trend--interactive')).toBe(false)
    expect(card?.querySelectorAll('g.tp')).toHaveLength(0)
    expect(card?.querySelectorAll('text')).toHaveLength(0) // no furniture text at all
})
