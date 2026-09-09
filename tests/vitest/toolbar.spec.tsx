// @vitest-environment jsdom
/**
 * The §6.2 band (CRVa-M0): one card carrying brand · view switcher ·
 * search · A–F chips · Filters · counts, with the ported
 * tier rules — the basic map hides the judgment controls (grade chips,
 * Show closed, Show newly permitted) and keeps search, Restaurants only,
 * Mobile food units, and the counts (P6). The search box debounces 150 ms
 * into the canonical C6 form; grade chips are single-select against the
 * frozen `grade` key (select again to clear).
 *
 * Filters is a hand-rolled panel of real checkboxes (2026-09-09) — no
 * portal and no positioning library, so every assertion here reads the
 * band's own subtree. SHOW CLOSED is one of those rows: it was a band pill
 * until that date, and the band must no longer carry it.
 *
 * TWO OBJECTS since 2026-09-09: identity (mark · name · switcher) in one
 * card, the query (search · chips · Filters · counts) in a second, ovular,
 * frosted one — beside it while the width allows, under it when it does
 * not. jsdom has no layout, so what is pinned here is the STRUCTURE the
 * layout rests on — which control sits in which object, and that identity
 * holds nothing else, so it stays one row on a phone under the detail
 * sheet. The flow and the paint — side by side or stacked, the search never
 * clipping its placeholder, the shapes, the translucency, the sheet
 * stopping at the identity card — are the e2e's
 * (`tests/e2e/band-lines.spec.ts`).
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Toolbar } from '../../app/Toolbar'
import type { RouterActions } from '../../app/useAppRouter'
import { initialAppState } from '../../app/store'
import type { AppState } from '../../app/store'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null
let calls: Array<[string, ...unknown[]]>

function recordingActions(): RouterActions {
    const record = (name: string) => (...args: unknown[]) => {
        calls.push([name, ...args])
    }
    return {
        setView: record('setView'),
        setSearch: record('setSearch'),
        setGrade: record('setGrade'),
        setFlag: record('setFlag'),
        select: record('select'),
        closePanel: record('closePanel'),
        setSort: record('setSort'),
        setPage: record('setPage'),
    }
}

async function mount(over: {
    state?: Partial<AppState>
    lite?: boolean
    shown?: number
    total?: number
} = {}) {
    const state: AppState = { ...initialAppState(), ...over.state }
    if (root) {
        await act(async () => {
            root?.unmount()
        })
    }
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <StrictMode>
                <Toolbar
                    state={state}
                    actions={recordingActions()}
                    lite={over.lite ?? false}
                    shown={over.shown ?? 25164}
                    total={over.total ?? 25164}
                />
            </StrictMode>,
        )
    })
}

function buttons(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll('button'))
}

function byText(text: string): HTMLButtonElement | undefined {
    return buttons().find((b) => b.textContent?.trim() === text)
}

/** Open the Filters panel and hand it back. */
async function openFilters(): Promise<HTMLElement> {
    const trigger = buttons().find((b) => b.textContent?.trim().startsWith('Filters'))
    if (!trigger) throw new Error('no Filters trigger on the band')
    await act(async () => {
        trigger.click()
    })
    const panel = host.querySelector('[role="group"][aria-label="Filters"]')
    if (!(panel instanceof HTMLElement)) throw new Error('the Filters panel did not open')
    return panel
}

/** The panel's checkbox rows, by their label. */
function rows(panel: HTMLElement): Map<string, HTMLInputElement> {
    return new Map(Array.from(panel.querySelectorAll('label'))
        .map((label) => [label.textContent?.trim() ?? '', label.querySelector('input')!]))
}

beforeEach(() => {
    calls = []
    host = document.createElement('div')
    document.body.appendChild(host)
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    host.remove()
    vi.useRealTimers()
})

test('the full-tier band carries every §6.2 control', async () => {
    await mount({ shown: 412 })
    expect(host.textContent).toContain('CleanPlateVA')
    for (const label of ['Map', 'List', 'About']) expect(byText(label)).toBeTruthy()
    expect(host.querySelector('input[type="search"]')).toBeTruthy()
    for (const grade of ['A', 'B', 'C', 'D', 'F']) expect(byText(grade)).toBeTruthy()
    expect(byText('Filters')).toBeTruthy()
    // Show closed left the band for the Filters menu (2026-09-09).
    expect(byText('Show closed')).toBeUndefined()
    expect(host.textContent).not.toContain('Show closed')
    // Filtered counts read "shown of total".
    expect(host.textContent).toContain('412')
    expect(host.textContent).toContain('of')
    expect(host.textContent).toContain('25,164')
    expect([...rows(await openFilters()).keys()])
        .toEqual(['Restaurants only', 'Show newly permitted', 'Show closed', 'Show mobile food units'])
})

test('the band is two objects: identity, then the query', async () => {
    await mount({ shown: 412 })
    const band = host.querySelector('header')!
    const lines = Array.from(band.children) as HTMLElement[]
    expect(lines).toHaveLength(2)
    const [identity, query] = lines as [HTMLElement, HTMLElement]

    // Identity is the mark, the name and the switcher — and nothing else, so
    // a phone renders it in one row and the detail sheet can stop under it.
    expect(identity.textContent).toContain('CleanPlateVA')
    expect(identity.querySelector('nav[aria-label="View"]')).toBeTruthy()
    expect(identity.querySelector('input[type="search"]')).toBeNull()
    expect(identity.textContent).not.toContain('412')

    // The query bar is every control that narrows the roster, and the count
    // they produce.
    expect(query.querySelector('input[type="search"]')).toBeTruthy()
    expect(query.querySelector('[role="group"][aria-label="Grade filter"]')).toBeTruthy()
    expect(Array.from(query.querySelectorAll('button'))
        .some((b) => b.textContent?.trim().startsWith('Filters'))).toBe(true)
    expect(query.textContent).toContain('412')
})

test('the band publishes its first line\'s bottom edge, and drops it on unmount', async () => {
    const root0 = document.documentElement
    expect(root0.style.getPropertyValue('--cp-band-line-1')).toBe('')
    await mount()
    // jsdom lays nothing out, so the card measures 0 and the edge is the
    // gutter alone. The property being SET, and being the gutter plus a
    // HEIGHT rather than a rect that scrolls, is the contract the phone
    // sheet reads; the real number is the e2e's.
    expect(root0.style.getPropertyValue('--cp-band-line-1')).toBe('12px')
    await act(async () => {
        root?.unmount()
    })
    root = null
    expect(root0.style.getPropertyValue('--cp-band-line-1')).toBe('')
})

test('the basic map hides the judgment controls and keeps the rest (P6)', async () => {
    await mount({ lite: true })
    for (const grade of ['A', 'B', 'C', 'D', 'F']) expect(byText(grade)).toBeUndefined()
    expect(host.querySelector('input[type="search"]')).toBeTruthy()
    const labels = [...rows(await openFilters()).keys()]
    expect(labels).toContain('Restaurants only')
    expect(labels).toContain('Show mobile food units')
    expect(labels).not.toContain('Show newly permitted')
    expect(labels).not.toContain('Show closed')
})

test('grade chips are single-select on the frozen key: select, and select again to clear', async () => {
    await mount()
    await act(async () => {
        byText('A')?.click()
    })
    expect(calls).toContainEqual(['setGrade', 'A'])
    calls = []
    await mount({ state: { filters: { ...initialAppState().filters, grade: 'A' } } })
    await act(async () => {
        byText('A')?.click()
    })
    expect(calls).toContainEqual(['setGrade', ''])
})

test('search debounces 150 ms into the canonical form; clearing is immediate', async () => {
    vi.useFakeTimers()
    await mount()
    const input = host.querySelector('input[type="search"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
        setter?.call(input, '  Taco   Richmond ')
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(calls).toEqual([])                      // still inside the debounce
    expect(input.value).toBe('  Taco   Richmond ') // the box keeps the typed characters
    await act(async () => {
        vi.advanceTimersByTime(150)
    })
    expect(calls).toContainEqual(['setSearch', 'taco richmond'])
    calls = []
    await act(async () => {
        ;(host.querySelector('button[aria-label="Clear search"]') as HTMLButtonElement)?.click()
    })
    expect(calls).toContainEqual(['setSearch', ''])
    expect(input.value).toBe('')
})

test('the Filters trigger counts deviations from the shipped defaults', async () => {
    await mount({
        state: {
            filters: {
                ...initialAppState().filters,
                restaurantsOnly: true,   // deviates
                showMobile: true,        // deviates
                showNew: true,           // the shipped default — no deviation
            },
        },
    })
    expect(byText('Filters · 2')).toBeTruthy()
    // Show closed counts from inside the menu the way it counted from the
    // band: off-default is off-default wherever its control sits.
    await mount({
        state: {
            filters: { ...initialAppState().filters, restaurantsOnly: true, showClosed: true },
        },
    })
    expect(byText('Filters · 2')).toBeTruthy()
})

test('the panel reports each flag and asks through setFlag', async () => {
    await mount({ state: { filters: { ...initialAppState().filters, showNew: true } } })
    const open = rows(await openFilters())
    // The rows REPORT the state they were given...
    expect(open.get('Show closed')?.checked).toBe(false)
    expect(open.get('Show newly permitted')?.checked).toBe(true)
    // ...and ask for the flip; they never flip themselves (the App owns it).
    await act(async () => {
        open.get('Show closed')?.click()
    })
    expect(calls).toContainEqual(['setFlag', 'showClosed', true])
    // The panel STAYS OPEN on a toggle, so a visit can set several filters.
    const still = rows(host.querySelector('[role="group"][aria-label="Filters"]') as HTMLElement)
    await act(async () => {
        still.get('Restaurants only')?.click()
    })
    expect(calls).toContainEqual(['setFlag', 'restaurantsOnly', true])
})

test('the panel closes on outside pointerdown and on Escape, which restores focus', async () => {
    await mount()
    await openFilters()
    await act(async () => {
        document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(host.querySelector('[role="group"][aria-label="Filters"]')).toBeNull()

    await openFilters()
    await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(host.querySelector('[role="group"][aria-label="Filters"]')).toBeNull()
    expect(document.activeElement).toBe(
        buttons().find((b) => b.textContent?.trim().startsWith('Filters')),
    )
})
