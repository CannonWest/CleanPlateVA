// @vitest-environment jsdom
/**
 * The theme switch: a real switch — role, checked state, the words — that
 * asks for the OTHER state on click and never flips itself (the App owns
 * and persists the choice); a track that is chrome, so it lightens with
 * the theme (Cannon's call 2026-09-06); and two Lucide glyphs carrying
 * their own inks — a yellow sun in both themes, a moon that is off-white
 * on the dark track and mid-slate on the light one. Placement is App's
 * (the map view's top column) and is not pinned here.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { MOON_COLOR, MOON_COLOR_LIGHT, SUN_COLOR, ThemeSwitch } from '../../app/ThemeSwitch'

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

function cells(button: HTMLButtonElement): HTMLElement[] {
    return Array.from(button.querySelectorAll(':scope > span'))
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

test('two Lucide glyphs, no emoji or text (§6.0), each filled and stroked in its cell\'s ink', async () => {
    const button = await mount(false)
    const glyphs = Array.from(button.querySelectorAll('svg'))
    expect(glyphs).toHaveLength(2)
    expect(button.textContent?.trim()).toBe('')
    const [moon, sun] = glyphs
    expect(moon?.getAttribute('class')).toContain('lucide-moon')
    expect(sun?.getAttribute('class')).toContain('lucide-sun')
    // Both follow their cell's text color, so the rules below are the only
    // place a glyph color is decided.
    for (const glyph of glyphs) {
        expect(glyph?.getAttribute('fill')).toBe('currentColor')
        expect(glyph?.getAttribute('stroke')).toBe('currentColor')
    }
})

test('the inks: an off-white moon on dark, a mid-slate moon on light, the sun yellow in both', async () => {
    const button = await mount(false)
    const [moonCell, sunCell] = cells(button)
    expect(MOON_COLOR).toBe('#f1f3f5')
    expect(MOON_COLOR_LIGHT).toBe('#495057')
    expect(SUN_COLOR).toBe('#fcc419')
    // The constants mirror literal class strings (Tailwind scans source
    // text, so a hex cannot reach the stylesheet through a constant); this
    // is what keeps the two from drifting.
    expect(moonCell?.className).toContain(`text-[${MOON_COLOR}]`)
    expect(moonCell?.className).toContain(`light:text-[${MOON_COLOR_LIGHT}]`)
    expect(sunCell?.className).toContain(`text-[${SUN_COLOR}]`)
    expect(sunCell?.className).not.toContain('light:text-')
})

test('the track is chrome (Cannon 2026-09-06): the theme\'s own surface, so it lightens with it', async () => {
    const button = await mount(false)
    // The surface + hairline the band and the cluster switch wear — near
    // white on the light theme, the same #1d2126 as before on the dark one.
    expect(button.className).toContain('bg-cp-surface-2')
    expect(button.className).toContain('border-cp-hairline')
    expect(button.className).not.toContain('bg-[#')
    expect(button.className).not.toContain('border-white/')
})

test('the thumb is the state: the disc sits under the sun for light, under the moon for dark', async () => {
    const light = await mount(false)
    const [moonCell, sunCell] = cells(light)
    expect(sunCell?.className).toContain('bg-')
    expect(moonCell?.className).not.toContain('bg-')
    expect(moonCell?.className).toContain('opacity-50')
    const dark = await mount(true)
    const [moonCellDark, sunCellDark] = cells(dark)
    expect(moonCellDark?.className).toContain('bg-')
    expect(sunCellDark?.className).not.toContain('bg-')
    expect(sunCellDark?.className).toContain('opacity-50')
})
