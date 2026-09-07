// @vitest-environment jsdom
/**
 * Geolocate + the coverage note (CRP-M3): the pure coverage math, and the
 * hook's wiring against a recording GeolocateControl — the ratified control
 * options, bottom-right placement, the note for a fix outside the mapped
 * area and for a failed fix, the follow lock's two-way tracking, and "Back
 * to Virginia" dropping the lock before it fits the state. And the
 * auto-locate's timing (2026-09-07): install asks the browser for nothing;
 * `autoLocate` is the one request, once.
 */
import { act, StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { VA_BOUNDS, VA_FIT } from '../../app/constants'
import type { RosterRow } from '../../app/data/types'

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

const {
    COVERAGE_PAD, LOCATION_FAILED_NOTE, OUTSIDE_COVERAGE_NOTE, coverageBounds, useGeolocate, withinCoverage,
} = await import('../../app/useGeolocate')
type Geolocate = ReturnType<typeof useGeolocate>

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let seq = 0
function row(lat: number | null, lon: number | null): RosterRow {
    seq += 1
    return {
        permit_id: `P-${seq}`, name: `Place ${seq}`, address: '1 Main St', address2: null,
        city: 'Richmond', zip: '23220', tenant: 'richmond', is_restaurant: true, mobile: false,
        pt: 1, lat, lon, loc: 0,
    } as unknown as RosterRow
}

// Richmond → Norfolk-ish: n 37.6 / s 36.8 / e -76.2 / w -77.5
const ROWS = [row(37.6, -77.5), row(36.8, -76.2), row(37.2, -76.9), row(null, null)]

test('coverageBounds is the box of the LOCATED rows; nothing located → null', () => {
    expect(coverageBounds(ROWS)).toEqual({ n: 37.6, s: 36.8, e: -76.2, w: -77.5 })
    expect(coverageBounds([])).toBeNull()
    expect(coverageBounds([row(null, null), row(null, -77)])).toBeNull()
})

test('withinCoverage pads the box ~20 km and says nothing when nothing is located yet', () => {
    expect(COVERAGE_PAD).toBe(0.2)
    expect(withinCoverage(ROWS, 37.2, -76.9)).toBe(true)                  // inside
    expect(withinCoverage(ROWS, 37.6 + 0.19, -77.5 - 0.19)).toBe(true)    // in the pad
    expect(withinCoverage(ROWS, 37.6 + 0.21, -76.9)).toBe(false)          // north of the pad
    expect(withinCoverage(ROWS, 37.2, -76.2 + 0.21)).toBe(false)          // east of the pad
    expect(withinCoverage(ROWS, 40.7, -74.0)).toBe(false)                 // New York
    expect(withinCoverage([], 40.7, -74.0)).toBe(true)                    // nothing loaded: say nothing
})

// ── the hook ────────────────────────────────────────────────────────────

let host: HTMLDivElement
let root: Root | null = null
let latest: Geolocate | null = null

function Probe({ rows }: { rows: readonly RosterRow[] }) {
    const ref = useRef(rows)
    ref.current = rows
    const geo = useGeolocate(ref)
    useEffect(() => { latest = geo })
    return <i>{geo.note?.text ?? ''}</i>
}

async function mount(rows: readonly RosterRow[] = ROWS) {
    root = createRoot(host)
    await act(async () => {
        root?.render(<StrictMode><Probe rows={rows} /></StrictMode>)
    })
    if (!latest) throw new Error('hook never rendered')
    return latest
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
    expect(geo.note).toBeNull()
})

test('a fix outside the mapped area raises the coverage note with the way back; one inside clears it', async () => {
    const geo = await mount()
    const { map } = fakeMap()
    act(() => { geo.install(map) })
    const control = FakeGeolocateControl.instances[0]!
    act(() => { control.emit('geolocate', { coords: { latitude: 40.7, longitude: -74.0 } }) })
    expect(latest?.note).toEqual({ text: OUTSIDE_COVERAGE_NOTE, back: true })
    expect(host.textContent).toContain("you're outside it")
    act(() => { control.emit('geolocate', { coords: { latitude: 37.2, longitude: -76.9 } }) })
    expect(latest?.note).toBeNull()
})

test('a failed fix says to check location access, with no way back offered', async () => {
    const geo = await mount()
    const { map } = fakeMap()
    act(() => { geo.install(map) })
    act(() => { FakeGeolocateControl.instances[0]!.emit('error') })
    expect(latest?.note).toEqual({ text: LOCATION_FAILED_NOTE, back: false })
    act(() => { latest?.dismissNote() })
    expect(latest?.note).toBeNull()
})

test('the follow lock tracks the control both ways, and Back to Virginia drops it before fitting the state', async () => {
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
    act(() => { control.emit('geolocate', { coords: { latitude: 40.7, longitude: -74.0 } }) })
    expect(latest?.note?.back).toBe(true)

    act(() => { latest?.backToVirginia(map) })
    // Following → trigger() first (switching the lock off), then the fit.
    expect(control.triggered).toBe(1)
    expect(calls.fitBounds).toEqual([[VA_BOUNDS, VA_FIT]])
    expect(latest?.note).toBeNull()

    control.emit('trackuserlocationend')
    expect(geo.following.current).toBe(false)
    act(() => { latest?.backToVirginia(map) })
    expect(control.triggered).toBe(1)          // not following: no trigger
    expect(calls.fitBounds).toHaveLength(2)

    // release() alone: the lock-drop without the fit (a selection's camera).
    geo.release()
    expect(control.triggered).toBe(1)          // not following: nothing to drop
    control.emit('trackuserlocationstart')
    geo.release()
    expect(control.triggered).toBe(2)
    expect(calls.fitBounds).toHaveLength(2)    // no fit
})

test('the imperative half keeps its identity across renders; dispose forgets the control', async () => {
    const geo = await mount()
    const { map } = fakeMap()
    act(() => { geo.install(map) })
    const control = FakeGeolocateControl.instances[0]!
    act(() => { control.emit('error') })         // a re-render
    expect(latest).not.toBeNull()
    expect(latest?.install).toBe(geo.install)
    expect(latest?.backToVirginia).toBe(geo.backToVirginia)
    expect(latest?.release).toBe(geo.release)
    expect(latest?.following).toBe(geo.following)
    control.emit('trackuserlocationstart')
    geo.dispose()
    act(() => { latest?.backToVirginia(map) })
    expect(control.triggered).toBe(0)           // the control is forgotten; the fit still happens
})
