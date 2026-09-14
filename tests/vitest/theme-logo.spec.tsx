// @vitest-environment jsdom
/**
 * ThemeLogo renders ONE face, never two (2026-09-14).
 *
 * The component used to render both PNGs and hide one with the `light:`
 * variant. `display: none` does not stop an <img> from loading, so every
 * visitor downloaded both: measured on launch traffic, logo-light 575
 * requests and logo-dark 591 against ~470 arrivals — 10.5% of the day's
 * bandwidth, half of it for artwork nobody saw.
 *
 * So the contract these tests hold is: exactly one <img> in the DOM, showing
 * the face the RESOLVED theme calls for, and following a live theme change.
 * `.theme-light` on <html> is the light hook (app/theme.ts); its absence is
 * the dark base.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { ThemeLogo } from '../../app/ThemeLogo'

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
    document.documentElement.classList.remove('theme-light')
})

async function mount(light: boolean) {
    document.documentElement.classList.toggle('theme-light', light)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(<ThemeLogo className="h-40 w-auto" />)
    })
    return host
}

function imgs(el: HTMLElement) {
    return Array.from(el.querySelectorAll('img'))
}

test('dark theme renders exactly one <img>, and it is the dark face', async () => {
    const el = await mount(false)
    const found = imgs(el)
    expect(found.length).toBe(1)
    expect(found[0]?.getAttribute('src')).toContain('logo-dark')
    expect(found[0]?.getAttribute('src')).not.toContain('logo-light')
})

test('light theme renders exactly one <img>, and it is the light face', async () => {
    const el = await mount(true)
    const found = imgs(el)
    expect(found.length).toBe(1)
    expect(found[0]?.getAttribute('src')).toContain('logo-light')
})

test('a live theme change swaps the face without adding a second <img>', async () => {
    const el = await mount(false)
    const before = imgs(el)[0]?.getAttribute('src')

    await act(async () => {
        document.documentElement.classList.add('theme-light')
    })

    const after = imgs(el)
    expect(after.length).toBe(1)
    expect(after[0]?.getAttribute('src')).not.toBe(before)
    expect(after[0]?.getAttribute('src')).toContain('logo-light')
})

test('each face reserves its own intrinsic box, so the swap costs no layout shift', async () => {
    const el = await mount(false)
    const dark = imgs(el)[0]
    expect(dark?.getAttribute('width')).toBe('1855')
    expect(dark?.getAttribute('height')).toBe('897')

    await act(async () => {
        document.documentElement.classList.add('theme-light')
    })
    const lightImg = imgs(el)[0]
    expect(lightImg?.getAttribute('width')).toBe('1972')
    expect(lightImg?.getAttribute('height')).toBe('954')
})

test('the alt text is the wordmark, and an empty alt hides it from the tree', async () => {
    const el = await mount(false)
    expect(imgs(el)[0]?.getAttribute('alt')).toBe('CleanPlateVA')

    await act(async () => {
        root?.render(<ThemeLogo alt="" />)
    })
    expect(imgs(el)[0]?.getAttribute('aria-hidden')).toBe('true')
})
