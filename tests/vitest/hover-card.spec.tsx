// @vitest-environment jsdom
/**
 * The §6.2 hover card (CRVa-M1; re-laid 2026-08-30 to the old client's
 * zones at Cannon's preview call, anchor boxes cut on the same day's
 * pass 3): rendered WHOLLY from the roster row — the bordered identity
 * head, the grade hero (circle + score + anchor date), and the panel's
 * trend section borrowed WHOLESALE (shared TrendSection: furniture, dates,
 * legend) — with ZERO fetches (C3). The basic map keeps the slim name +
 * address tip (P6); both tiers qualify an approximate pin (C9); NEW is
 * blue, letterless, and untrended.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { HoverCard } from '../../app/HoverCard'
import type { RosterRow } from '../../app/data/types'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

async function render(f: RosterRow, lite = false) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const fetches: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL) => {
        fetches.push(String(input))
        return Promise.reject(new Error('the hover card must not fetch'))
    }) as typeof fetch
    try {
        await act(async () => {
            root?.render(<HoverCard f={f} lite={lite} />)
        })
    } finally {
        globalThis.fetch = realFetch
    }
    expect(fetches).toEqual([])
    return host
}

function row(over: Partial<RosterRow> = {}): RosterRow {
    return {
        permit_id: 'H-1', name: 'Sub Rosa Bakery', address: '620 N 25th St',
        address2: null, city: 'Richmond', zip: '23223', tenant: 'richmond',
        is_restaurant: true, mobile: false, pt: 1,
        lat: 37.5334, lon: -77.4171, loc: 0,
        ...over,
    }
}

test('the full-tier card: head, grade hero, and the borrowed panel trend', async () => {
    const el = await render(row({
        o: {
            grade_score: 94,
            trend_delta: 2,
            base_yyyymmdd: 20260611,
            latest_yyyymmdd: 20260802,
            visits: [
                [1, 20250315, 88],
                [1, 20260611, 94],
                [2, 20260802, 0, 3],
            ],
        },
    }))
    expect(el.textContent).toContain('Sub Rosa Bakery')
    expect(el.textContent).toContain('620 N 25th St · Richmond · 23223')
    // The circle wears the letter (§6.0: the letter always rides the color).
    expect(el.textContent).toContain('A')
    // The hero speaks the score and its anchoring broad inspection.
    expect(el.textContent).toContain('94')
    expect(el.textContent).toContain('/100')
    expect(el.textContent).toContain('Broad inspection · Jun 11, 2026')
    // The anchor boxes were cut (pass 3): the hero carries the broad
    // date, the trend's endpoint dates carry the span.
    expect(el.textContent).not.toContain('Last broad inspection')
    expect(el.textContent).not.toContain('Last visit')
    // The expanded view's trend, borrowed wholesale: the panel variant
    // (its hover interactivity is inert — the popup is mouse-transparent)
    // with the section header and the mark-grammar legend.
    const svg = el.querySelector('svg.cp-trend')
    expect(svg).toBeTruthy()
    expect(svg?.classList.contains('cp-trend--interactive')).toBe(true)
    expect(el.textContent).toContain('Trend · 3 visits')
    expect(el.textContent).toContain('broad score')
    expect(el.textContent).toContain('re-check')
    expect(el.textContent).toContain('scope unknown')
})

test('the basic map keeps the slim name + address tip (P6)', async () => {
    const el = await render(row({
        loc: 2,
        o: { grade_score: 94, visits: [[1, 20260611, 94]] },
    }), true)
    expect(el.textContent).toContain('Sub Rosa Bakery')
    expect(el.textContent).not.toContain('Last broad inspection')
    expect(el.querySelector('svg')).toBeNull()
    // C9: the approximate pin is qualified on this tier too.
    expect(el.textContent).toContain('≈ approximate location')
})

test('NEW is blue-lettered NEW, untrended, with its own line', async () => {
    const el = await render(row({
        o: { grade_score: null, new: 1, visits: [[0, 20260701]] },
    }))
    expect(el.textContent).toContain('NEW')
    // The old client's NEW hero: a positive state, not a missing grade.
    expect(el.textContent).toContain('Permitted')
    expect(el.textContent).toContain('Cleared to open')
    expect(el.querySelector('svg.cp-trend')).toBeNull()
})

test('a closed row carries its status beside the name', async () => {
    const el = await render(row({
        status: 'Business Closed',
        o: { grade_score: 88, visits: [[1, 20250101, 88]] },
    }))
    expect(el.textContent).toContain('Business Closed')
})

test('no history reads as exactly that', async () => {
    const el = await render(row({ o: { grade_score: null, new: 0, visits: [] } }))
    expect(el.textContent).toContain('No inspections on record yet')
})
