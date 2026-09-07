// @vitest-environment jsdom
/**
 * The settings dialog (2026-09-06): Radix primitives, so the suite pins the
 * CONTRACT they render — a modal dialog named "Settings" with its
 * description wired (aria-modal / labelledby / describedby), portaled over
 * the page; the theme as a radio group of three (Light · Dark · System, in
 * that order) that reports the current choice and asks for the pressed one;
 * "Group nearby places" as a labeled switch that asks for the other state;
 * the text size as a slider 12..20 by 1 that reports its value and asks by
 * keyboard; the readout and the reset that appears off the default; and
 * every way out — ✕, Done, Escape — asking to close. The dialog never flips
 * its own state: the App owns and persists every choice.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { SettingsDialog, THEME_OPTIONS } from '../../app/SettingsDialog'
import type { ThemeChoice } from '../../app/theme'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Radix's slider measures its thumb with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
    observe() { /* jsdom */ }
    unobserve() { /* jsdom */ }
    disconnect() { /* jsdom */ }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

interface Asked {
    theme: ThemeChoice[]
    clusters: boolean[]
    textSize: number[]
    open: boolean[]
}

let host: HTMLDivElement
let root: Root | null = null
let asked: Asked

async function mount(props: Partial<{
    theme: ThemeChoice
    systemDark: boolean
    clusters: boolean
    textSize: number
}> = {}) {
    if (root) {
        await act(async () => {
            root?.unmount()
        })
    }
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <StrictMode>
                <SettingsDialog
                    open
                    onOpenChange={(open) => { asked.open.push(open) }}
                    theme={props.theme ?? 'system'}
                    systemDark={props.systemDark ?? false}
                    clusters={props.clusters ?? false}
                    textSize={props.textSize ?? 14}
                    onTheme={(choice) => { asked.theme.push(choice) }}
                    onClusters={(on) => { asked.clusters.push(on) }}
                    onTextSize={(size) => { asked.textSize.push(size) }}
                />
            </StrictMode>,
        )
    })
    // Radix portals the dialog to <body>, not into the host.
    const dialog = document.querySelector('[role="dialog"]')
    if (!(dialog instanceof HTMLElement)) throw new Error('no dialog rendered')
    return dialog
}

function radios(dialog: HTMLElement): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>('[role="radio"]'))
}

async function press(target: HTMLElement, key: string) {
    await act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
}

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    asked = { theme: [], clusters: [], textSize: [], open: [] }
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

test('a modal dialog named Settings, described, portaled over the page', async () => {
    const dialog = await mount()
    expect(dialog.getAttribute('data-state')).toBe('open')
    expect(host.contains(dialog)).toBe(false)
    // Modal the Radix way: the page behind it is hidden from assistive
    // technology while it is open (no aria-modal attribute is stamped).
    expect(host.getAttribute('aria-hidden')).toBe('true')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent).toBe('Settings')
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(description?.textContent).toContain('kept on this device')
})

test('the theme is a radio group of three in order; the current one is checked; pressing another asks for it', async () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual(['light', 'dark', 'system'])
    expect(THEME_OPTIONS.map((option) => option.label)).toEqual(['Light', 'Dark', 'System'])
    const dialog = await mount({ theme: 'system' })
    const items = radios(dialog)
    expect(items.map((item) => item.textContent?.trim())).toEqual(['Light', 'Dark', 'System'])
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    // Lucide glyphs beside the words, none of them emoji (§6.0).
    expect(items.every((item) => item.querySelector('svg'))).toBe(true)
    await act(async () => {
        items[1]?.click()
    })
    expect(asked.theme).toEqual(['dark'])
    // The control does not flip itself — the App does, on persisting.
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    // Pressing the checked option again is not a request for nothing.
    await act(async () => {
        items[2]?.click()
    })
    expect(asked.theme).toEqual(['dark'])
})

test('the hint names what System resolves to right now, and only under System', async () => {
    let dialog = await mount({ theme: 'system', systemDark: true })
    expect(dialog.textContent).toContain('System follows the device\'s appearance (dark now).')
    dialog = await mount({ theme: 'system', systemDark: false })
    expect(dialog.textContent).toContain('(light now).')
    dialog = await mount({ theme: 'light', systemDark: true })
    expect(dialog.textContent).toContain('System follows the device\'s appearance.')
    expect(dialog.textContent).not.toContain('now)')
})

test('Group nearby places is a labeled switch that asks for the other state', async () => {
    const dialog = await mount({ clusters: false })
    const toggle = dialog.querySelector<HTMLElement>('[role="switch"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    const label = Array.from(dialog.querySelectorAll('label')).find((el) => el.htmlFor === toggle?.id)
    expect(label?.textContent).toBe('Group nearby places')
    await act(async () => {
        toggle?.click()
    })
    expect(asked.clusters).toEqual([true])
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    const on = await mount({ clusters: true })
    const onToggle = on.querySelector<HTMLElement>('[role="switch"]')
    expect(onToggle?.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
        onToggle?.click()
    })
    expect(asked.clusters).toEqual([true, false])
})

test('the text size is a slider 12..20 by 1 reporting its value, asking by keyboard', async () => {
    const dialog = await mount({ textSize: 14 })
    const thumb = dialog.querySelector<HTMLElement>('[role="slider"]')
    expect(thumb).toBeTruthy()
    expect(thumb?.getAttribute('aria-valuemin')).toBe('12')
    expect(thumb?.getAttribute('aria-valuemax')).toBe('20')
    expect(thumb?.getAttribute('aria-valuenow')).toBe('14')
    expect(thumb?.getAttribute('aria-valuetext')).toBe('14 pixels')
    expect(thumb?.getAttribute('aria-label')).toBe('Text size')
    expect(dialog.textContent).toContain('14 px · default')
    await act(async () => {
        thumb?.focus()
    })
    await press(thumb as HTMLElement, 'ArrowRight')
    await press(thumb as HTMLElement, 'ArrowLeft')
    await press(thumb as HTMLElement, 'End')
    await press(thumb as HTMLElement, 'Home')
    expect(asked.textSize).toEqual([15, 13, 20, 12])
    // Controlled: the thumb reports the App's value, not its own.
    expect(thumb?.getAttribute('aria-valuenow')).toBe('14')
})

test('off the default the readout drops the word and a reset appears, asking for 14', async () => {
    const dialog = await mount({ textSize: 16 })
    expect(dialog.textContent).toContain('16 px')
    expect(dialog.textContent).not.toContain('default')
    const reset = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Reset to 14 px')
    expect(reset).toBeTruthy()
    await act(async () => {
        reset?.click()
    })
    expect(asked.textSize).toEqual([14])
    const atDefault = await mount({ textSize: 14 })
    expect(Array.from(atDefault.querySelectorAll('button')).some((b) => b.textContent?.startsWith('Reset'))).toBe(false)
})

test('every way out asks to close — ✕, Done, Escape — and none of them is a decision', async () => {
    const dialog = await mount()
    const close = dialog.querySelector<HTMLElement>('button[aria-label="Close"]')
    await act(async () => {
        close?.click()
    })
    const done = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Done')
    await act(async () => {
        done?.click()
    })
    await press(dialog, 'Escape')
    expect(asked.open).toEqual([false, false, false])
    expect(asked.theme).toEqual([])
    expect(asked.clusters).toEqual([])
    expect(asked.textSize).toEqual([])
})
