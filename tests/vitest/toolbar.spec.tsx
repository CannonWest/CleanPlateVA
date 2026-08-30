// @vitest-environment jsdom
/**
 * The §6.2 band (CRVa-M0): one card carrying brand · view switcher ·
 * search · A–F chips · Filters · Show closed · counts, with the ported
 * tier rules — the basic map hides the judgment controls (grade chips,
 * Show closed, Show newly permitted) and keeps search, Restaurants only,
 * Mobile food units, and the counts (P6). The search box debounces 150 ms
 * into the canonical C6 form; grade chips are single-select against the
 * frozen `grade` key (select again to clear).
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
                    panelOpen={false}
                    dark
                    onTheme={() => {}}
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
    expect(byText('Show closed')).toBeTruthy()
    // Filtered counts read "shown of total".
    expect(host.textContent).toContain('412')
    expect(host.textContent).toContain('of')
    expect(host.textContent).toContain('25,164')
})

test('the basic map hides the judgment controls and keeps the rest (P6)', async () => {
    await mount({ lite: true })
    for (const grade of ['A', 'B', 'C', 'D', 'F']) expect(byText(grade)).toBeUndefined()
    expect(byText('Show closed')).toBeUndefined()
    expect(host.querySelector('input[type="search"]')).toBeTruthy()
    await act(async () => {
        byText('Filters')?.click()
    })
    expect(host.textContent).toContain('Restaurants only')
    expect(host.textContent).toContain('Show mobile food units')
    expect(host.textContent).not.toContain('Show newly permitted')
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

test('the Filters pill counts deviations from the shipped defaults', async () => {
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
})

test('the toggles dispatch through setFlag', async () => {
    await mount()
    await act(async () => {
        byText('Show closed')?.click()
    })
    expect(calls).toContainEqual(['setFlag', 'showClosed', true])
    await act(async () => {
        byText('Filters')?.click()
    })
    const restaurants = Array.from(host.querySelectorAll('label'))
        .find((l) => l.textContent?.includes('Restaurants only'))
        ?.querySelector('input')
    await act(async () => {
        restaurants?.click()
    })
    expect(calls).toContainEqual(['setFlag', 'restaurantsOnly', true])
})
