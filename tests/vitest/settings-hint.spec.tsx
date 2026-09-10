// @vitest-environment jsdom
/**
 * The hint beside the Settings pill (2026-09-07): a note, not a dialog — no
 * focus to trap, one control, and it never dismisses itself (the App owns
 * and persists that). The words are the public copy; the tip is chrome and
 * hidden from the accessible name. Placement is App's — since 2026-09-09 the
 * map's bottom-left corner, above the pill and over the attribution chip —
 * and is not pinned here.
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

test('it does not whisper: a 2px accent outline the tip carries too, and text ABOVE the 14px body', async () => {
    // The pointer AT the accessibility choices is the one floating control
    // that must read at a glance over a busy map (design review, 2026-09-07), so
    // these are contract, not styling incidentals: every other floating
    // control sits at 11.5–13px inside a hairline.
    const note = await mount()
    expect(note.className).toContain('border-2')
    expect(note.className).toContain('border-cp-accent')
    expect(note.className).not.toContain('border-cp-hairline')
    expect(note.className).toContain('text-cp-15') // 15 × the visitor's scale
    expect(note.className).toContain('font-medium')
    expect(note.className).toContain('text-cp-ink') // not the muted ink-2/ink-3
    // The tip carries the card's outline at the card's weight — which two
    // of its four edges is a matter of which way it points, and that has
    // changed with every move of the pill (2026-09-09: up-and-left, then
    // up-and-right, then down). So the contract is EXACTLY TWO 2px accent
    // edges, adjacent ones — a rotated square shows two — not a named pair.
    const tip = note.querySelector('[aria-hidden="true"]:not(svg)')
    const edges = ['t', 'r', 'b', 'l'].filter((side) => tip?.className.includes(`border-${side}-2`))
    expect(edges).toHaveLength(2)
    expect(edges.join('')).not.toBe('tb')
    expect(edges.join('')).not.toBe('rl')
    expect(tip?.className).toContain('border-cp-accent')
    // Its fill is the card's own surface, so it covers the outline behind it.
    expect(tip?.className).toContain('bg-cp-surface-1')
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
