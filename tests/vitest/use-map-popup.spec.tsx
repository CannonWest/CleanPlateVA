// @vitest-environment jsdom
/**
 * The popup controller (CRP-M3): one MapLibre Popup + one persistent React
 * root, created lazily, reused across shows, and torn down by dispose —
 * with the content committed SYNCHRONOUSLY before the popup is placed (the
 * popup measures real content when it picks its anchor). MapLibre's Popup
 * is a recorder here; what it is handed is the contract.
 */
import { act, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

class FakePopup {
    static instances: FakePopup[] = []
    lngLat: unknown = null
    content: HTMLElement | null = null
    map: unknown = null
    removed = 0
    constructor(public readonly options: Record<string, unknown>) {
        FakePopup.instances.push(this)
    }
    setLngLat(lngLat: unknown) { this.lngLat = lngLat; return this }
    setDOMContent(el: HTMLElement) { this.content = el; return this }
    addTo(map: unknown) { this.map = map; return this }
    remove() { this.removed += 1; this.map = null; return this }
}

vi.mock('maplibre-gl', () => ({ Popup: FakePopup }))

const { createMapPopup, useMapPopup } = await import('../../app/useMapPopup')
type MapPopup = ReturnType<typeof createMapPopup>

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS = { className: 'cp-tip', offset: 14, maxWidth: '380px' }
const MAP = { fake: 'map' } as unknown as import('maplibre-gl').Map

beforeEach(() => {
    FakePopup.instances = []
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
})

test('show creates ONE popup with the options and places the synchronously-rendered content on the map', () => {
    const popup = createMapPopup(OPTIONS)
    act(() => { popup.show(MAP, [-77.4, 37.5], <b>Umi Japanese Cuisine</b>) })
    expect(FakePopup.instances).toHaveLength(1)
    const p = FakePopup.instances[0]!
    expect(p.options).toEqual({
        closeButton: false, closeOnClick: false, offset: 14, maxWidth: '380px', className: 'cp-tip',
    })
    expect(p.lngLat).toEqual([-77.4, 37.5])
    expect(p.map).toBe(MAP)
    // The content was committed before setDOMContent — no empty first frame.
    expect(p.content?.innerHTML).toBe('<b>Umi Japanese Cuisine</b>')
})

test('a second show reuses the popup and the root; the content is replaced, not appended', () => {
    const popup = createMapPopup(OPTIONS)
    act(() => { popup.show(MAP, [-77.4, 37.5], <span>first</span>) })
    act(() => { popup.show(MAP, [-78.0, 38.0], <span>second</span>) })
    expect(FakePopup.instances).toHaveLength(1)
    const p = FakePopup.instances[0]!
    expect(p.lngLat).toEqual([-78.0, 38.0])
    expect(p.content?.textContent).toBe('second')
})

test('hide takes the popup off the map and clears the key; the next show re-adds the SAME popup', () => {
    const popup = createMapPopup(OPTIONS)
    popup.key.current = 'P-1'
    act(() => { popup.show(MAP, [-77.4, 37.5], <span>card</span>) })
    popup.hide()
    const p = FakePopup.instances[0]!
    expect(p.removed).toBe(1)
    expect(popup.key.current).toBeNull()
    act(() => { popup.show(MAP, [-77.4, 37.5], <span>again</span>) })
    expect(FakePopup.instances).toHaveLength(1)
    expect(p.map).toBe(MAP)
})

test('hide before any show is a no-op (the data / switch / theme effects call it freely)', () => {
    const popup = createMapPopup(OPTIONS)
    expect(() => popup.hide()).not.toThrow()
    expect(FakePopup.instances).toHaveLength(0)
})

test('dispose removes the popup, unmounts the root on the next tick, and starts over on a later show', () => {
    const popup = createMapPopup(OPTIONS)
    popup.key.current = 'stack:1'
    act(() => { popup.show(MAP, [-77.4, 37.5], <span>card</span>) })
    const first = FakePopup.instances[0]!
    const host = first.content!
    popup.dispose()
    expect(first.removed).toBe(1)
    expect(popup.key.current).toBeNull()
    expect(host.textContent).toBe('card')      // still mounted — the commit React is in must finish first
    act(() => { vi.runAllTimers() })
    expect(host.textContent).toBe('')          // unmounted outside the commit
    act(() => { popup.show(MAP, [-77.4, 37.5], <span>fresh</span>) })
    expect(FakePopup.instances).toHaveLength(2) // a new popup + root, not the disposed ones
    expect(FakePopup.instances[1]!.content?.textContent).toBe('fresh')
})

test('useMapPopup hands the SAME controller to every render of a mount', async () => {
    const seen: MapPopup[] = []
    function Probe({ tick }: { tick: number }) {
        const popup = useMapPopup(OPTIONS)
        useEffect(() => { seen.push(popup) }, [popup, tick])
        return <i>{tick}</i>
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    let root: Root | null = null
    await act(async () => {
        root = createRoot(host)
        root.render(<StrictMode><Probe tick={1} /></StrictMode>)
    })
    await act(async () => { root?.render(<StrictMode><Probe tick={2} /></StrictMode>) })
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seen).size).toBe(1)
    await act(async () => { root?.unmount() })
    host.remove()
})
