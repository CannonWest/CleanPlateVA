// @vitest-environment jsdom
/**
 * The theme switch: a real switch — role, checked state, the words — that
 * asks for the OTHER state on click and never flips itself (the App owns
 * and persists the choice), and two Lucide glyphs in the colors Cannon
 * called (2026-09-06): an off-white moon and a yellow sun, each solid
 * (fill + stroke), so they read on the fixed night-slate track in either
 * theme. Placement is App's (the top-left row) and is not pinned here.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { MOON_COLOR, SUN_COLOR, ThemeSwitch } from '../../app/ThemeSwitch'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null
let asked: boolean[]

async function mount(dark: boolean) {
    if (root) {
        await act(async () => {
            root?.unmount()
        })
    }
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <StrictMode>
                <ThemeSwitch dark={dark} onTheme={(next) => { asked.push(next) }} />
            </StrictMode>,
        )
    })
    const button = host.querySelector('button[role="switch"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('no switch rendered')
    return button
}

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    asked = []
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

test('light: reports unchecked, offers the dark theme, asks for DARK on click', async () => {
    const button = await mount(false)
    expect(button.getAttribute('aria-checked')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('Dark theme')
    expect(button.title).toBe('Switch to the dark theme')
    await act(async () => {
        button.click()
    })
    expect(asked).toEqual([true])
    // The control does not flip itself — the App does, on persisting.
    expect(button.getAttribute('aria-checked')).toBe('false')
})

test('dark: reports checked, offers the light theme, asks for LIGHT on click', async () => {
    const button = await mount(true)
    expect(button.getAttribute('aria-checked')).toBe('true')
    expect(button.title).toBe('Switch to the light theme')
    await act(async () => {
        button.click()
    })
    expect(asked).toEqual([false])
})

test('two Lucide glyphs, no emoji or text (§6.0): an off-white moon, a yellow sun, both solid', async () => {
    const button = await mount(false)
    const glyphs = button.querySelectorAll('svg')
    expect(glyphs).toHaveLength(2)
    expect(button.textContent?.trim()).toBe('')
    const [moon, sun] = Array.from(glyphs)
    expect(moon?.getAttribute('class')).toContain('lucide-moon')
    expect(sun?.getAttribute('class')).toContain('lucide-sun')
    // Cannon's call (2026-09-06): the colors are the glyphs' own, fixed in
    // either theme, and each is filled as well as stroked.
    expect(MOON_COLOR).toBe('#f1f3f5')
    expect(SUN_COLOR).toBe('#fcc419')
    expect(moon?.getAttribute('fill')).toBe(MOON_COLOR)
    expect(moon?.getAttribute('stroke')).toBe(MOON_COLOR)
    expect(sun?.getAttribute('fill')).toBe(SUN_COLOR)
    expect(sun?.getAttribute('stroke')).toBe(SUN_COLOR)
})

test('the thumb is the state: the disc sits under the sun for light, under the moon for dark', async () => {
    const light = await mount(false)
    const [moonCell, sunCell] = Array.from(light.querySelectorAll(':scope > span'))
    expect(sunCell?.className).toContain('bg-')
    expect(moonCell?.className).not.toContain('bg-')
    const dark = await mount(true)
    const [moonCellDark, sunCellDark] = Array.from(dark.querySelectorAll(':scope > span'))
    expect(moonCellDark?.className).toContain('bg-')
    expect(sunCellDark?.className).not.toContain('bg-')
})
