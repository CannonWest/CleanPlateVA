// @vitest-environment jsdom
/**
 * The §6.3 List (CRVb-M0): the seven C6 sort keys with the old `list.js`
 * comparator semantics (null sentinels: score/compliance −1 · trend 0 ·
 * date ''), the dense table's cells (grade chip + score · name over
 * address · compliance % · trend arrow + signed delta, em-dash null ·
 * last visit date + scope/outcome), the CLOSED/NEW word-badges,
 * load-more per D-DATA-11 ("Show 50 more · N match", page=N), row click
 * into the shared panel, header clicks driving `sort`/`dir`, and the
 * basic map's identity-only columns (P6).
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { ListView, sortRows, sortValue } from '../../app/ListView'
import type { Sort } from '../../app/store'
import type { RosterRow } from '../../app/data/types'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let seq = 0
function row(over: Partial<RosterRow> = {}): RosterRow {
    seq += 1
    return {
        permit_id: `L-${seq}`, name: `Place ${seq}`, address: '1 Main St',
        address2: null, city: 'Richmond', zip: '23220', tenant: 'richmond',
        is_restaurant: true, mobile: false, pt: 1,
        lat: 37.5, lon: -77.4, loc: 0,
        ...over,
    }
}

test('sort values keep the old list.js sentinels and forms', () => {
    const graded = row({ name: 'Bravo', zip: '23225', o: { grade_score: 82, trend_delta: -4, latest_yyyymmdd: 20260301, base_yyyymmdd: 20260101, compliance_pct: 90 } })
    const bare = row({ name: 'alpha', address: '9 Z St', address2: 'Suite 2' })
    expect(sortValue(graded, 'score')).toBe(82)
    expect(sortValue(bare, 'score')).toBe(-1)          // ungraded sorts first asc
    expect(sortValue(graded, 'compliance')).toBe(0.9)
    expect(sortValue(bare, 'compliance')).toBe(-1)
    expect(sortValue(graded, 'trend')).toBe(-4)
    expect(sortValue(bare, 'trend')).toBe(0)
    expect(sortValue(graded, 'date')).toBe('2026-03-01')
    expect(sortValue(bare, 'date')).toBe('')
    expect(sortValue(bare, 'name')).toBe('alpha')       // lower-cased
    expect(sortValue(bare, 'address')).toBe('9 z st suite 2')
    expect(sortValue(graded, 'zip')).toBe('23225')
})

test('sortRows: worst actual grades lead; rows missing the value go LAST both directions', () => {
    // Cannon's CRVb-M1-boundary call: the old −1 sentinel floated the
    // ungraded/NEW block to the top of worst-first — now graded rows lead
    // and value-less rows trail on every value sort, asc and desc alike.
    const a = row({ o: { grade_score: 95 } })
    const f = row({ o: { grade_score: 42 } })
    const none = row({})
    const asc = sortRows([a, none, f], { key: 'score', dir: 'asc' })
    expect(asc.map((r) => r.permit_id)).toEqual([f.permit_id, a.permit_id, none.permit_id])
    const desc = sortRows([a, none, f], { key: 'score', dir: 'desc' })
    expect(desc.map((r) => r.permit_id)).toEqual([a.permit_id, f.permit_id, none.permit_id])
    // Same rule on the other value sorts.
    const dated = row({ o: { latest_yyyymmdd: 20260101 } })
    const dateless = row({})
    expect(sortRows([dateless, dated], { key: 'date', dir: 'desc' })[0]?.permit_id)
        .toBe(dated.permit_id)
    // Stable within equal keys: the input order survives.
    const x = row({ o: { grade_score: 80 } })
    const y = row({ o: { grade_score: 80 } })
    expect(sortRows([x, y], { key: 'score', dir: 'asc' }).map((r) => r.permit_id))
        .toEqual([x.permit_id, y.permit_id])
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

interface Overrides {
    rows: RosterRow[]
    lite?: boolean
    sort?: Sort
    page?: number
    onSort?: (key: string) => void
    onMore?: () => void
    onPick?: (pid: string) => void
}

async function render(over: Overrides) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <ListView
                rows={over.rows}
                lite={over.lite ?? false}
                sort={over.sort ?? { key: 'score', dir: 'asc' }}
                page={over.page ?? 1}
                selectedPermit={null}
                onSort={over.onSort ?? (() => {})}
                onMore={over.onMore ?? (() => {})}
                onPick={over.onPick ?? (() => {})}
            />,
        )
    })
    return host
}

test('the full-tier cells: chip+score, address line, compliance, trend, last visit + outcome', async () => {
    const el = await render({
        rows: [
            row({ name: 'Quick Stop Grill', o: { grade_score: 42, trend_delta: -11, latest_yyyymmdd: 20260811, base_yyyymmdd: 20260811, latest_scope_code: 1, compliance_pct: 61 } }),
            row({ name: 'Golden Dragon', o: { grade_score: 78, trend_delta: -7, latest_yyyymmdd: 20260730, base_yyyymmdd: 20260519, latest_scope_code: 2, latest_out: 2, latest_items: 9, compliance_pct: 83 } }),
            row({ name: 'Casa Del Barco', o: { grade_score: 85, trend_delta: 3, latest_yyyymmdd: 20260624, base_yyyymmdd: 20260624, latest_scope_code: 1, compliance_pct: 88 } }),
        ],
    })
    // Worst first: F 42 → C 78 → B 85 (score asc default).
    const names = Array.from(el.querySelectorAll('tbody tr')).map((tr) => tr.textContent)
    expect(names[0]).toContain('Quick Stop Grill')
    expect(names[0]).toContain('F')
    expect(names[0]).toContain('42')
    expect(names[0]).toContain('61%')
    expect(names[0]).toContain('-11')
    expect(names[0]).toContain('2026-08-11')
    expect(names[0]).toContain('· broad')
    expect(names[1]).toContain('· 2/9 OUT')          // focused outcome, never a raw score
    expect(names[2]).toContain('+3')                 // signed positive delta
    // The active header carries the sort accent + arrow.
    const active = el.querySelector('th[aria-sort="ascending"]')
    expect(active?.textContent).toContain('Score')
})

test('CLOSED renders muted with the word-badge; NEW is the blue-dot word-badge; null trend is an em-dash', async () => {
    const el = await render({
        rows: [
            row({ name: 'Broad St Deli', status: 'Business Closed', o: { grade_score: 75, compliance_pct: 80, latest_yyyymmdd: 20251218, latest_scope_code: 1 } }),
            row({ name: 'Pho Saigon 23', o: { grade_score: null, new: 1, latest_yyyymmdd: 20260805, latest_scope_code: 1 } }),
        ],
        sort: { key: 'name', dir: 'asc' },
    })
    const [closedRow, newRow] = Array.from(el.querySelectorAll('tbody tr'))
    expect(closedRow?.textContent).toContain('closed')
    expect(closedRow?.className).toContain('opacity-55')
    expect(newRow?.textContent).toContain('new')
    expect(newRow?.textContent).toContain('NEW')     // the score cell's pending pill
    expect(newRow?.textContent).toContain('—')       // no delta yet
})

test('load-more reveals 50 per chunk, labels per the mockup, and drives page=N', async () => {
    let more = 0
    const rows = Array.from({ length: 120 }, () => row({ o: { grade_score: 80 } }))
    const el = await render({ rows, onMore: () => { more += 1 } })
    expect(el.querySelectorAll('tbody tr')).toHaveLength(50)
    const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('more'))
    expect(btn?.textContent).toContain('Show 50 more')
    expect(btn?.textContent).toContain('120')
    expect(btn?.textContent).toContain('match')
    await act(async () => {
        btn?.click()
    })
    expect(more).toBe(1)
    // page=3 reveals all 120; the tail chunk is the remainder.
    const el2 = await (async () => {
        await act(async () => {
            root?.unmount()
        })
        host?.remove()
        return render({ rows, page: 2 })
    })()
    const btn2 = Array.from(el2.querySelectorAll('button')).find((b) => b.textContent?.includes('more'))
    expect(el2.querySelectorAll('tbody tr')).toHaveLength(100)
    expect(btn2?.textContent).toContain('Show 20 more')
})

test('a stale URL page clamps to what the list has; all-shown gets its grace note', async () => {
    const rows = Array.from({ length: 60 }, () => row({ o: { grade_score: 80 } }))
    const el = await render({ rows, page: 99 })
    expect(el.querySelectorAll('tbody tr')).toHaveLength(60)
    expect(el.textContent).toContain('All 60 shown')
})

test('row click picks the permit; header click reports the key', async () => {
    const picks: string[] = []
    const sorts: string[] = []
    const target = row({ name: 'Pick Me', o: { grade_score: 70 } })
    const el = await render({
        rows: [target],
        onPick: (pid) => picks.push(pid),
        onSort: (key) => sorts.push(key),
    })
    await act(async () => {
        ;(el.querySelector('tbody tr') as HTMLElement).click()
    })
    expect(picks).toEqual([String(target.permit_id)])
    const nameHeader = Array.from(el.querySelectorAll('th')).find((th) => th.textContent?.includes('Name'))
    await act(async () => {
        nameHeader?.click()
    })
    expect(sorts).toEqual(['name'])
})

test('the basic map keeps identity columns only (P6)', async () => {
    const el = await render({
        rows: [row({ name: 'Lite Row', o: { grade_score: 90, compliance_pct: 95 } })],
        lite: true,
        sort: { key: 'name', dir: 'asc' },
    })
    const headers = Array.from(el.querySelectorAll('th')).map((th) => th.textContent?.trim())
    expect(headers.filter(Boolean).map((h) => h?.replace(/[▲▼]/g, '').trim())).toEqual(['Name'])
    expect(el.textContent).not.toContain('90')
    expect(el.textContent).not.toContain('%')
    expect(el.textContent).toContain('Lite Row')
    expect(el.textContent).toContain('1 Main St')
})
