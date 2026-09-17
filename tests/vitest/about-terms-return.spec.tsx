// @vitest-environment jsdom
/**
 * Where About §05's tier decision LANDS (a design decision, 2026-09-17).
 *
 * The status panel states which tier this device is on and offers the one
 * way to the other; pressing that is a request to go and look at the
 * difference, so the decision hands the visitor the MAP. Until this, both
 * actions left them at the foot of the terms — the red one flipped the tier
 * in place, and the blue one opened the dialog whose Agree flipped it in
 * place too.
 *
 * Driven through the REAL App, from the real URL, because the claim is about
 * the address bar: the assertion is `location.pathname`, which no view test
 * can make (AboutView is handed two callbacks and knows nothing of routes).
 * `fetch` rejects throughout — the roster is unavailable, About renders its
 * cards as unavailable, and §05 is untouched by any of that.
 *
 * The origin matters, so the third and fourth cases pin the two places the
 * SAME dialog opens from: the detail panel's way back in decides in place
 * (the visitor is already looking at what it affects), and a dismissal
 * decides nothing and moves nobody.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { maplibreStub } from './support/maplibre'

// The map needs WebGL; jsdom has none, and the map's behavior is not what
// this spec is about (design ref §7 — the e2e is the only proof it paints).
vi.mock('maplibre-gl', () => maplibreStub())
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const { App } = await import('../../app/App')
const { ACK_AGREED, ACK_DECLINED, ACK_KEY } = await import('../../app/ack')
const { SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY } = await import('../../app/constants')

// Radix's Slider (the settings dialog's text size) measures its thumb with a
// ResizeObserver, which jsdom does not implement. Nothing here depends on a
// measurement, so an inert one is enough.
class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let host: HTMLDivElement | null = null
let root: Root | null = null
let realFetch: typeof globalThis.fetch

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    realFetch = globalThis.fetch
    globalThis.fetch = (() => Promise.reject(new Error('no network in this spec'))) as typeof fetch
    window.localStorage.clear()
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    host?.remove()
    host = null
    globalThis.fetch = realFetch
})

/** A device that has met the settings dialog already — it self-opens once on
 *  a first map view, and a scrim over the assertions is noise here. */
function settled(): void {
    window.localStorage.setItem(SETTINGS_SEEN_KEY, '1')
    window.localStorage.setItem(SETTINGS_HINT_KEY, '1')
}

/** Flush act cycles until `ready` holds. The views are `lazy()` behind a
 *  Suspense boundary (App §6.3/§6.4), so the FIRST mount in a file waits on
 *  a real dynamic `import()` — a macrotask, not a microtask — while every
 *  later one is served from the module cache. Hence a timer turn per pass
 *  and a predicate rather than a fixed count: the number of turns is an
 *  artifact of which test ran first, and nothing this spec means to assert. */
async function until(ready: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 40 && !ready(); i += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
    expect(ready(), `${what} never arrived`).toBe(true)
}

/** Mount the real App at `path` with `ack` already on the device, and wait
 *  for the About document to actually be on screen. */
async function mount(path: string, ack: string): Promise<HTMLDivElement> {
    window.localStorage.setItem(ACK_KEY, ack)
    settled()
    window.history.replaceState(null, '', path)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root!.render(<App />)
    })
    await until(
        () => !!host?.textContent?.includes('Terms of Use and Data Acknowledgment'),
        'the About document',
    )
    return host
}

/** The one button whose text is `label`, anywhere in `scope`. */
function button(scope: ParentNode, label: string): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll('button'))
        .filter((b) => b.textContent?.trim() === label)
    expect(found.length, `exactly one ${JSON.stringify(label)} button`).toBe(1)
    return found[0] as HTMLButtonElement
}

async function click(el: HTMLElement): Promise<void> {
    await act(async () => {
        el.click()
    })
}

test('§05 agreed: "Switch to the basic map" declines AND lands on the map', async () => {
    const page = await mount('/about', ACK_AGREED)
    expect(window.location.pathname).toBe('/about')

    await click(button(page, 'Switch to the basic map'))

    expect(window.location.pathname).toBe('/')
    expect(window.localStorage.getItem(ACK_KEY)).toBe(ACK_DECLINED)
    // And the document is genuinely gone — not merely a URL rewrite behind
    // the same page of terms.
    await until(
        () => !page.textContent?.includes('Terms of Use and Data Acknowledgment'),
        'the map view (About torn down)',
    )
})

test('§05 declined: the dialog opens over About, and AGREEING lands on the map', async () => {
    const page = await mount('/about', ACK_DECLINED)

    await click(button(page, 'Review the terms and view grades'))
    // The dialog is open and nothing has moved yet — the decision is the
    // event, not the opening.
    const dialog = page.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(window.location.pathname).toBe('/about')

    await click(button(dialog!, 'Agree and View Grades'))

    expect(window.location.pathname).toBe('/')
    expect(window.localStorage.getItem(ACK_KEY)).toBe(ACK_AGREED)
})

test('§05 declined: DECLINING again also lands on the map — the visitor asked to leave', async () => {
    const page = await mount('/about', ACK_DECLINED)
    await click(button(page, 'Review the terms and view grades'))
    const dialog = page.querySelector('[role="dialog"]')

    await click(button(dialog!, 'Decline and Use Basic Map'))

    expect(window.location.pathname).toBe('/')
    expect(window.localStorage.getItem(ACK_KEY)).toBe(ACK_DECLINED)
})

test('a dismissed dialog decides nothing and moves nobody — About stands', async () => {
    const page = await mount('/about', ACK_DECLINED)
    await click(button(page, 'Review the terms and view grades'))
    const dialog = page.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()

    const close = dialog!.querySelector('button[aria-label="Close"]') as HTMLButtonElement
    expect(close, 'a re-opened dialog carries a ✕ (§6.1)').toBeTruthy()
    await click(close)

    expect(page.querySelector('[role="dialog"]')).toBeNull()
    expect(window.location.pathname).toBe('/about')
    expect(window.localStorage.getItem(ACK_KEY)).toBe(ACK_DECLINED)
    // Still the terms document, still saying the same thing.
    expect(page.textContent).toContain('not acknowledged on this device')
})

test('the blocking first load carries no origin: deciding leaves the URL alone', async () => {
    // No stored answer at all — the provider withholds every fetch and the
    // dialog blocks (C2). A visitor who deep-linked to /about must still be
    // on /about once they have answered: they never asked to go anywhere.
    window.localStorage.clear()
    settled()
    window.history.replaceState(null, '', '/about')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root!.render(<App />)
    })
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()

    await click(button(dialog!, 'Agree and View Grades'))

    expect(window.location.pathname).toBe('/about')
    expect(window.localStorage.getItem(ACK_KEY)).toBe(ACK_AGREED)
})
