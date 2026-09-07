// @vitest-environment jsdom
/**
 * The hint under the Settings pill (2026-09-07): a note, not a dialog — no
 * focus to trap, one control, and it never dismisses itself (the App owns
 * and persists that). The words are the public copy; the tip is chrome and
 * hidden from the accessible name. Placement is App's (the map view's top
 * column, third under the pill) and is not pinned here.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { SETTINGS_HINT_TEXT, SettingsHint } from '../../app/SettingsHint'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null
let dismissed: number

async function mount() {
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <StrictMode>
                <SettingsHint onDismiss={() => { dismissed += 1 }} />
            </StrictMode>,
        )
    })
    const note = host.querySelector('[role="note"]')
    if (!(note instanceof HTMLElement)) throw new Error('no hint rendered')
    return note
}

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    dismissed = 0
})

afterEach(async () => {
    if (root) {
        await act(async () => {
            root?.unmount()
        })
        root = null
    }
    host.remove()
})

test('a note that names the settings, in the formal register', async () => {
    const note = await mount()
    expect(SETTINGS_HINT_TEXT).toBe('Theme and accessibility options are in Settings.')
    expect(note.textContent).toContain(SETTINGS_HINT_TEXT)
    // Not a dialog: nothing to trap focus in, nothing modal about it.
    expect(note.getAttribute('role')).toBe('note')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
})

test('one control — the dismiss ✕ — and the tip is chrome, hidden from the name', async () => {
    const note = await mount()
    const buttons = Array.from(note.querySelectorAll('button'))
    expect(buttons).toHaveLength(1)
    const close = buttons[0]
    expect(close?.getAttribute('aria-label')).toBe('Dismiss')
    expect(close?.querySelector('svg')?.getAttribute('class')).toContain('lucide-x')
    // The tip is a rotated square, aria-hidden, carrying no text.
    const tip = note.querySelector('[aria-hidden="true"]:not(svg)')
    expect(tip).toBeTruthy()
    expect(tip?.textContent).toBe('')
    expect(tip?.className).toContain('rotate-45')
})

test('it asks to be dismissed and never dismisses itself (the App persists)', async () => {
    const note = await mount()
    const close = note.querySelector('button')
    await act(async () => {
        close?.click()
    })
    expect(dismissed).toBe(1)
    // Still rendered: the App decides, exactly as the switches do.
    expect(host.querySelector('[role="note"]')).toBeTruthy()
})
