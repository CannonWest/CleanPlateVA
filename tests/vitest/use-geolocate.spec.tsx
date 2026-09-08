// @vitest-environment jsdom
/**
 * Geolocate (CRP-M3): the hook's wiring against a recording GeolocateControl
 * — the ratified control options, bottom-right placement, and the follow
 * lock's two-way tracking. And the auto-locate's timing (2026-09-07):
 * install asks the browser for nothing; `autoLocate` is the one request,
 * once.
 *
 * The note UI was deleted 2026-09-08 (Cannon's call): no message for a fix
 * outside the mapped area, no way back offered, no message for a failed
 * fix, no coverage math. The specs that pinned them are gone, and one that
 * pins their ABSENCE takes their place — a hook that quietly regrew a
 * `geolocate` or `error` listener, or that moved the camera on its own, is
 * a red test.
 */
import { act, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

class FakeGeolocateControl {
    static instances: FakeGeolocateControl[] = []
    handlers = new Map<string, Array<(arg: unknown) => void>>()
    triggered = 0
    constructor(public readonly options: Record<string, unknown>) {
        FakeGeolocateControl.instances.push(this)
    }
    on(event: string, fn: (arg: unknown) => void) {
        const list = this.handlers.get(event) ?? []
        list.push(fn)
        this.handlers.set(event, list)
        return this
    }
    emit(event: string, arg?: unknown) {
        for (const fn of this.handlers.get(event) ?? []) fn(arg)
    }
    trigger() { this.triggered += 1; return true }
}

vi.mock('maplibre-gl', () => ({ GeolocateControl: FakeGeolocateControl }))

const { useGeolocate } = await import('../../app/useGeolocate')
type Geolocate = ReturnType<typeof useGeolocate>

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ── the hook ────────────────────────────────────────────────────────────

let host: HTMLDivElement
let root: Root | null = null
let latest: Geolocate | null = null

/** `tick` exists to force a re-render: the hook holds no state of its own
 *  since the note went, so nothing it does can re-render the tree. */
function Probe({ tick = 0 }: { tick?: number }) {
    const geo = useGeolocate()
    useEffect(() => { latest = geo })
    return <i>{tick}</i>
}

async function mount() {
    root = createRoot(host)
    await act(async () => {
        root?.render(<StrictMode><Probe /></StrictMode>)
    })
    if (!latest) throw new Error('hook never rendered')
    return latest
}

async function rerender(tick: number) {
    await act(async () => {
        root?.render(<StrictMode><Probe tick={tick} /></StrictMode>)
    })
}

function fakeMap() {
    const calls = { addControl: [] as Array<[unknown, string]>, fitBounds: [] as Array<[unknown, unknown]> }
    const map = {
        addControl: (c: unknown, pos: string) => { calls.addControl.push([c, pos]) },
        fitBounds: (b: unknown, o: unknown) => { calls.fitBounds.push([b, o]) },
    } as unknown as import('maplibre-gl').Map
    return { map, calls }
}

/** A recording stand-in for the browser's geolocation + Permissions API
 *  (jsdom has neither): the REQUEST is what the specs count — the prompt
 *  it would raise is browser chrome. */
function stubGeolocation(permission: 'prompt' | 'denied' | 'granted' = 'prompt') {
    const getCurrentPosition = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
    Object.defineProperty(navigator, 'permissions', {
        configurable: true, value: { query: vi.fn(async () => ({ state: permission })) },
    })
    return getCurrentPosition
}

/** Let the auto-locate's awaited permission query settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    FakeGeolocateControl.instances = []
    latest = null
})

afterEach(async () => {
    if (root) {
        await act(async () => { root?.unmount() })
        root = null
    }
    host.remove()
    delete (navigator as unknown as { geolocation?: unknown }).geolocation
    delete (navigator as unknown as { permissions?: unknown }).permissions
})

test('install asks the browser for nothing; autoLocate asks once, patiently, and hands a fix to the control', async () => {
    const getCurrentPosition = stubGeolocation('prompt')
    const geo = await mount()
    const { map } = fakeMap()
    act(() => { geo.install(map) })
    await flush()
    // The control is up; no request has left the page (a first-time visitor
    // sees the terms dialog at this moment — no location prompt under it).
    expect(FakeGeolocateControl.instances).toHaveLength(1)
    expect(getCurrentPosition).not.toHaveBeenCalled()

    geo.autoLocate()
    await flush()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    // Its own PATIENT request: the prompt's decision time counts against it.
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
    // A fix hands over to the control (the first kick lands: the control is ready).
    const onFix = getCurrentPosition.mock.calls[0]?.[0] as () => void
    onFix()
    expect(FakeGeolocateControl.instances[0]!.triggered).toBe(1)

    // Once per mount: a second release is a no-op.
    geo.autoLocate()
    await flush()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
})

test('a permission already denied never asks', async () => {
    const getCurrentPosition = stubGeolocation('denied')
    const geo = await mount()
    act(() => { geo.install(fakeMap().map) })
    geo.autoLocate()
    await flush()
    await flush()
    expect(getCurrentPosition).not.toHaveBeenCalled()
})

test('install: the ratified control, bottom-right, once', async () => {
    const geo = await mount()
    const { map, calls } = fakeMap()
    act(() => { geo.install(map) })
    expect(FakeGeolocateControl.instances).toHaveLength(1)
    const control = FakeGeolocateControl.instances[0]!
    expect(control.options).toEqual({
        positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 },
        trackUserLocation: true,
        fitBoundsOptions: { maxZoom: 13 },
    })
    expect(calls.addControl).toEqual([[control, 'bottom-right']])
})

test('the hook is SILENT: it listens for the follow lock and nothing else, and never moves the camera itself', async () => {
    const geo = await mount()
    const { map, calls } = fakeMap()
    act(() => { geo.install(map) })
    const control = FakeGeolocateControl.instances[0]!

    // The note UI is gone: a fix and a failure are both unlistened-for.
    expect([...control.handlers.keys()].sort()).toEqual([
        'trackuserlocationend', 'trackuserlocationstart', 'userlocationfocus', 'userlocationlostfocus',
    ])
    expect(control.handlers.has('geolocate')).toBe(false)
    expect(control.handlers.has('error')).toBe(false)

    // Emitting them anyway is inert — nothing renders, nothing throws.
    act(() => {
        control.emit('geolocate', { coords: { latitude: 40.7, longitude: -74.0 } })  // New York
        control.emit('error')
    })
    expect(host.textContent).toBe('0')

    // The camera is the caller's; the hook fits nothing on its own.
    expect(calls.fitBounds).toEqual([])
})

test('the follow lock tracks the control both ways; release drops it without moving the camera', async () => {
    const geo = await mount()
    const { map, calls } = fakeMap()
    act(() => { geo.install(map) })
    const control = FakeGeolocateControl.instances[0]!
    expect(geo.following.current).toBe(false)
    control.emit('trackuserlocationstart')
    expect(geo.following.current).toBe(true)
    control.emit('userlocationlostfocus')
    expect(geo.following.current).toBe(false)
    control.emit('userlocationfocus')
    expect(geo.following.current).toBe(true)

    // Following → trigger() switches the lock off. No fit: a zoom-changing
    // move is the caller's to make (mapCamera.ts).
    geo.release()
    expect(control.triggered).toBe(1)
    expect(calls.fitBounds).toEqual([])

    control.emit('trackuserlocationend')
    expect(geo.following.current).toBe(false)
    geo.release()
    expect(control.triggered).toBe(1)          // not following: nothing to drop
})

test('the imperative half keeps its identity across renders; dispose forgets the control', async () => {
    const geo = await mount()
    const { map } = fakeMap()
    act(() => { geo.install(map) })
    const control = FakeGeolocateControl.instances[0]!
    await rerender(1)
    expect(latest).not.toBeNull()
    expect(latest).toBe(geo)                     // no state left: the object itself is stable
    expect(latest?.install).toBe(geo.install)
    expect(latest?.release).toBe(geo.release)
    expect(latest?.following).toBe(geo.following)

    control.emit('trackuserlocationstart')
    geo.dispose()
    latest?.release()
    expect(control.triggered).toBe(0)            // the control is forgotten
})
