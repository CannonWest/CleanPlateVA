// @vitest-environment jsdom
/**
 * The Layers pill (2026-09-09) — what the move off the map's bottom-right
 * lane has to keep true. `tests/e2e/aerial.spec.ts` is still what proves the
 * flip actually repaints the map; this pins the CHROME, and one rule in
 * particular that Cannon named when he asked for the move: the button must
 * not vanish or go see-through under a click.
 *
 * That is a real hazard with a named cause. In the control lane the button
 * lived inside `.maplibregl-ctrl`, and maplibre-gl.css carries
 * `.maplibregl-ctrl button:not(:disabled):active { background-color:
 * rgba(0,0,0,.05) }` — (0,3,1) against a Tailwind utility's (0,1,0), so
 * while the mouse was down it replaced our opaque surface with a 5%-black
 * wash and the map showed through. Out here the only thing that decides how
 * the trigger looks is this file, so the pin is: the SURFACE token is the
 * same in both states and nothing dims it. Only the BORDER changes, to the
 * accent that says "this one" everywhere else on the site.
 *
 * Placement is App's — the top column's row, at the band's left edge — and
 * is not pinned here. Settings is NOT beside it: it spent one revision at
 * the band's other end and went to the map's bottom-left corner the same
 * day. What survives that is the CHROME, which is why the pill is still
 * measured against SettingsButton's classes below: the two are the site's
 * two presentation controls and should read as the same kind of thing from
 * opposite corners.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LayersControl } from '../../app/LayersControl'
import { BASEMAPS } from '../../app/basemap'
import type { Basemap } from '../../app/basemap'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null
let picked: Basemap[]
let opens: boolean[]

async function mount({ basemap = 'map' as Basemap, open = false } = {}) {
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <StrictMode>
                <LayersControl
                    basemap={basemap}
                    open={open}
                    onOpenChange={(next) => { opens.push(next) }}
                    onBasemap={(next) => { picked.push(next) }}
                />
            </StrictMode>,
        )
    })
    const trigger = host.querySelector('button[aria-expanded]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('no trigger rendered')
    return trigger
}

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    picked = []
    opens = []
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

test('a labelled pill, not an icon: the word rides with the glyph, as Settings does', async () => {
    const trigger = await mount()
    expect(trigger.textContent?.trim()).toBe('Layers')
    // The accessible name is the visible word — no aria-label shadowing it.
    expect(trigger.getAttribute('aria-label')).toBeNull()
    expect(trigger.querySelector('svg')?.getAttribute('class')).toContain('lucide-layers')
    // Settings' own clothes (SettingsButton), so the pair reads as a pair.
    for (const cls of ['rounded-cp-pill', 'bg-cp-surface-2', 'px-4', 'py-2.5', 'text-cp-13', 'shadow-cp']) {
        expect(trigger.className).toContain(cls)
    }
})

test('the trigger stays solid when the list is open — same surface, no dimming', async () => {
    const shut = await mount({ open: false })
    await act(async () => { root?.unmount() })
    root = null
    const open = await mount({ open: true })

    // The one thing Cannon asked for: clicking it must not make it vanish or
    // fade. The surface token is the same in both states, and nothing in
    // either state touches opacity, visibility or transparency.
    expect(shut.className).toContain('bg-cp-surface-2')
    expect(open.className).toContain('bg-cp-surface-2')
    for (const state of [shut, open]) {
        expect(state.className).not.toMatch(/\bopacity-/)
        expect(state.className).not.toMatch(/\binvisible\b/)
        expect(state.className).not.toMatch(/\bhidden\b/)
        expect(state.className).not.toMatch(/bg-transparent/)
        // No slash-alpha on the surface either (`bg-cp-surface-2/70`).
        expect(state.className).not.toMatch(/bg-cp-surface-2\//)
    }
    // Open is said with the BORDER, the site's "this one" signal.
    expect(shut.className).toContain('border-cp-hairline')
    expect(open.className).toContain('border-cp-accent')
})

test('the list hangs BELOW the trigger and is taken out of flow, so nothing under it moves', async () => {
    await mount({ open: true })
    const group = host.querySelector('[role="radiogroup"]')
    if (!(group instanceof HTMLElement)) throw new Error('no radiogroup rendered')
    expect(group.getAttribute('aria-label')).toBe('Basemap')
    // Absolute and downward: the column's settings hint sits under this row,
    // and opening the list must not push it down the screen.
    expect(group.className).toContain('absolute')
    expect(group.className).toContain('top-[calc(100%+6px)]')
    expect(group.className).toContain('left-0')
    // Its own anchor, and no portal — the band's rule since the Filters
    // panel: nothing on this view is positioned by a library.
    expect(host.querySelector('.relative')?.contains(group)).toBe(true)
    expect(document.body.querySelectorAll('[role="radiogroup"]')).toHaveLength(1)
})

test('every basemap is an entry, the current one checked, and a pick reports and collapses', async () => {
    await mount({ basemap: 'aerial', open: true })
    const radios = Array.from(host.querySelectorAll('[role="radio"]'))
    expect(radios).toHaveLength(BASEMAPS.length)
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toContain('Aerial')

    const drawn = radios.find((r) => r.textContent?.includes('Map'))
    if (!(drawn instanceof HTMLElement)) throw new Error('no Map entry')
    await act(async () => { drawn.click() })
    expect(picked).toEqual(['map'])
    expect(opens).toEqual([false])
})

test('the trigger toggles, and Escape collapses an open list', async () => {
    const trigger = await mount({ open: false })
    await act(async () => { trigger.click() })
    expect(opens).toEqual([true])

    await act(async () => { root?.unmount() })
    root = null
    opens = []
    await mount({ open: true })
    await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(opens).toEqual([false])
})

test('a mousedown outside collapses it; one inside does not', async () => {
    await mount({ open: true })
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    await act(async () => {
        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(opens).toEqual([false])

    opens = []
    const inside = host.querySelector('[role="radio"]')
    await act(async () => {
        inside?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(opens).toEqual([])
    outside.remove()
})
