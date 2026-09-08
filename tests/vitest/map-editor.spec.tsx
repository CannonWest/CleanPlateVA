// @vitest-environment jsdom
/**
 * The map edit mode's chrome (CPE-M2 + M3, app/admin/MapEditor.tsx): the
 * banner, the pins drawer and what a row says, the note that persists, Undo
 * and Reset all, the stale-snapshot note, the wiring to a map — the
 * row-press handler handed up, the controller torn down — and Submit: one
 * draft per stack, a stored draft's pins leaving the device, a refusal's
 * reason, the session loss handed up, a build without the Worker saying so,
 * and the Submitted panel.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DRAWER_BOTTOM, EDIT_BANNER, fmtMetres, fmtSavedAt, MapEditor } from '../../app/admin/MapEditor'
import { attachDetail, loadPins, movePin, newPin, savePins, SRC_PROPOSALS } from '../../app/admin/mapDraft'
import type { ProbeFetch, ProbeResponse } from '../../app/admin/session'
import type { RosterRow } from '../../app/data/types'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    window.localStorage.clear()
})

afterEach(async () => {
    await act(async () => { root?.unmount() })
    root = null
    host.remove()
})

function row(pid: string, over: Partial<RosterRow> = {}): RosterRow {
    return {
        permit_id: pid, name: `Place ${pid}`, address: '1 Main St', address2: null, city: 'X', zip: '23220',
        tenant: 'virginia', is_restaurant: true, mobile: false, pt: 0, lat: 37.5, lon: -77.4, loc: 0,
        ffx_oid: null, ...over,
    }
}

const noDetail = async () => ({ available: false, reason: 'test' })

type Call = { url: string; init: RequestInit }
type Partial_ = Partial<ProbeResponse> & { body?: unknown; contentType?: string }

/** A transport the spec scripts: every call is logged and answered by `handle`. */
function transportOf(handle: (call: Call) => Partial_): { calls: Call[]; fetchImpl: ProbeFetch } {
    const calls: Call[] = []
    const fetchImpl: ProbeFetch = async (url, init) => {
        const call = { url, init }
        calls.push(call)
        const partial = handle(call)
        const headers = new Map<string, string>()
        if (partial.contentType) headers.set('content-type', partial.contentType)
        return {
            type: partial.type ?? 'basic',
            status: partial.status ?? 200,
            ok: partial.ok ?? ((partial.status ?? 200) >= 200 && (partial.status ?? 200) < 300),
            headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
            json: partial.json ?? (async () => partial.body),
        }
    }
    return { calls, fetchImpl }
}

/** A build without the Worker: every route answers the SPA shell. */
const shell = () => transportOf(() => ({ status: 200, contentType: 'text/html' }))
const JSON_ = 'application/json; charset=utf-8'

async function render(props: Partial<Parameters<typeof MapEditor>[0]> = {}) {
    root = createRoot(host)
    const all = {
        map: null, rows: [], snapshotId: 'snap', dark: true, coarse: false, basemap: 'map' as const, lite: true,
        getDetail: noDetail, bindRowDrag: () => {}, onExit: () => {}, onSessionLost: () => {},
        transport: shell().fetchImpl, ...props,
    }
    await act(async () => {
        root?.render(<StrictMode><MapEditor {...all} /></StrictMode>)
    })
}

const click = (el: Element | null) => act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})

const submitButton = () => host.querySelector('[data-cp-submit]') as HTMLButtonElement

test('the banner, an empty drawer, Submit held at zero pins, and the Submitted panel in a build without the Worker', async () => {
    const transport = shell()
    await render({ transport: transport.fetchImpl })
    expect(host.querySelector('[role="note"]')?.textContent).toBe(EDIT_BANNER)
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('0')
    expect(host.textContent).toContain('No pins yet')
    expect(submitButton().disabled).toBe(true)
    expect(submitButton().textContent).toBe('Submit 0 pins')
    expect(host.textContent).not.toContain('one per place or stack')
    const reset = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Reset all') as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    // The panel asked the route (once per mount — StrictMode mounts twice),
    // and the shell reads as "not listed here".
    expect(transport.calls.length).toBeGreaterThanOrEqual(1)
    for (const call of transport.calls) expect([call.url, call.init.method]).toEqual(['/admin/api/proposals', 'GET'])
    expect(host.querySelector('[data-cp-submitted-panel]')?.textContent)
        .toContain('Submitted drafts are not listed in this build (no proposals route in this build)')
    // The drawer stops above the control lane from `sm` up (OQ-F).
    expect(host.querySelector('aside')?.className).toContain(DRAWER_BOTTOM)
    expect(DRAWER_BOTTOM).toMatch(/^sm:bottom-\[\d+px\]$/)
})

test('a stored pin renders its row: name, kind, distance, the site badge, the detail note', async () => {
    const site = row('s', { loc: 2, address: '9 Pier Rd' })
    const pin = attachDetail(movePin([newPin(site, [site, row('t', { loc: 2, address: '9 Pier Rd' })], 'snap')], 's', { lat: 37.501, lon: -77.4 }), 's', null)[0]!
    savePins(window.localStorage, [pin])
    await render({ rows: [site] })
    const item = host.querySelector('[data-cp-pin="s"]')
    expect(item).not.toBeNull()
    expect(item?.textContent).toContain('Place s')
    expect(item?.textContent).toContain('Site fix')
    expect(item?.querySelector('[data-cp-pin-moved]')?.textContent).toBe('111 m')
    expect(item?.textContent).toContain('Moves 2 permits at 9 Pier Rd')
    expect(item?.textContent).toContain('Site detail was not available')
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('1')
})

test('a note persists as it is typed; Undo removes the pin; Reset all clears the draft', async () => {
    const a = row('a')
    const b = row('b')
    savePins(window.localStorage, [
        attachDetail([newPin(a, [], 'snap')], 'a', null)[0]!,
        attachDetail([newPin(b, [], 'snap')], 'b', null)[0]!,
    ])
    await render({ rows: [a, b] })
    const note = host.querySelector('[data-cp-pin="a"] textarea') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
        setter?.call(note, 'the door is on the side street')
        note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(loadPins(window.localStorage).find((p) => p.permit_id === 'a')?.note).toBe('the door is on the side street')

    await click(host.querySelector('[data-cp-pin="a"] button[aria-label^="Undo"]'))
    expect(host.querySelector('[data-cp-pin="a"]')).toBeNull()
    expect(loadPins(window.localStorage).map((p) => p.permit_id)).toEqual(['b'])

    await click(Array.from(host.querySelectorAll('button')).find((el) => el.textContent === 'Reset all') ?? null)
    expect(host.textContent).toContain('No pins yet')
    expect(loadPins(window.localStorage)).toEqual([])
})

test('a pin drafted against another snapshot says so', async () => {
    const a = row('a')
    savePins(window.localStorage, [attachDetail([newPin(a, [], 'old-snap')], 'a', null)[0]!])
    await render({ rows: [a], snapshotId: 'new-snap' })
    expect(host.querySelector('[data-cp-pin="a"]')?.textContent).toContain('older snapshot')
})

test('with a map: the row-press handler is handed up, Exit edit calls out, unmount tears the layers down', async () => {
    const layers: string[] = []
    const sources = new Set<string>()
    const listeners = new Map<string, Set<unknown>>()
    const map = {
        on: (ev: string, fn: unknown) => { (listeners.get(ev) ?? listeners.set(ev, new Set()).get(ev))!.add(fn) },
        off: (ev: string, fn: unknown) => { listeners.get(ev)?.delete(fn) },
        getSource: (id: string) => (sources.has(id) ? { setData: () => {} } : undefined),
        addSource: (id: string) => { sources.add(id) },
        addLayer: (spec: { id: string }) => { layers.push(spec.id) },
        getLayer: (id: string) => (layers.includes(id) ? {} : undefined),
        removeLayer: (id: string) => { layers.splice(layers.indexOf(id), 1) },
        removeSource: (id: string) => { sources.delete(id) },
        project: () => ({ x: 0, y: 0 }),
        unproject: () => ({ lng: 0, lat: 0 }),
        queryRenderedFeatures: () => [],
        getCanvas: () => ({ style: { cursor: '' }, getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
        getZoom: () => 14,
    }
    const bindRowDrag = vi.fn()
    const onExit = vi.fn()
    await render({ map: map as never, bindRowDrag, onExit })
    expect(sources.has(SRC_PROPOSALS)).toBe(true)
    expect(layers).toHaveLength(3)
    expect(bindRowDrag).toHaveBeenCalled()
    expect(typeof bindRowDrag.mock.calls.at(-1)?.[0]).toBe('function')

    await click(Array.from(host.querySelectorAll('button')).find((el) => el.textContent === 'Exit edit') ?? null)
    expect(onExit).toHaveBeenCalledTimes(1)

    await act(async () => { root?.unmount() })
    root = null
    expect(bindRowDrag.mock.calls.at(-1)?.[0]).toBeNull()
    expect(layers).toHaveLength(0)
    expect(sources.has(SRC_PROPOSALS)).toBe(false)
})

test('metres read as metres, then kilometres; a saved_at reads in the device\'s clock', () => {
    expect(fmtMetres(0)).toBe('0 m')
    expect(fmtMetres(37.4)).toBe('37 m')
    expect(fmtMetres(1234)).toBe('1.23 km')
    expect(fmtMetres(Number.NaN)).toBe('—')
    expect(fmtSavedAt(null)).toBe('—')
    expect(fmtSavedAt('not a time')).toBe('not a time')
    expect(fmtSavedAt('2026-09-08T19:15:03Z')).toContain('2026')
})

// ── Submit (CPE-M3) ─────────────────────────────────────────────────────

/** Two pins at one point and one alone — two drafts' worth. */
function threePins() {
    const a = row('a', { lat: 37.5, lon: -77.4 })
    const b = row('b', { lat: 37.5, lon: -77.4 })
    const c = row('c', { lat: 37.6, lon: -77.3 })
    const rows = [a, b, c]
    let pins = [newPin(a, rows, 'snap'), newPin(b, rows, 'snap'), newPin(c, rows, 'snap')]
    pins = movePin(pins, 'a', { lat: 37.501, lon: -77.4 })
    pins = movePin(pins, 'b', { lat: 37.502, lon: -77.4 })
    pins = movePin(pins, 'c', { lat: 37.6, lon: -77.301 })
    pins = attachDetail(attachDetail(attachDetail(pins, 'a', null), 'b', null), 'c', null)
    return { rows, pins }
}

/** A Worker that stores every draft under a key made from its stack, and
 *  lists what it stored. */
function storingWorker() {
    const stored: Record<string, unknown>[] = []
    const transport = transportOf(({ init }) => {
        if (init.method === 'POST') {
            const draft = JSON.parse(String(init.body)) as { batch: { stack_key: string }; pins: unknown[] }
            const name = `20260908T191503Z-${draft.batch.stack_key.replace(/[^0-9]/g, '').slice(0, 8)}`
            stored.push({
                key: `drafts/${name}.json`, name, saved_at: '2026-09-08T19:15:03Z', pins: draft.pins.length,
                sha256: 'ab'.repeat(32), stack_key: draft.batch.stack_key, snapshot_id: 'snap', submitted_by: 'x@example.test',
                size: 1, uploaded: '2026-09-08T19:15:03.000Z', pulled: false,
            })
            return { status: 201, contentType: JSON_, body: { ok: true, key: `drafts/${name}.json`, sha256: 'ab'.repeat(32), pins: draft.pins.length, saved_at: '2026-09-08T19:15:03Z', existing: false } }
        }
        return { status: 200, contentType: JSON_, body: { ok: true, drafts: [...stored].reverse(), truncated: false } }
    })
    return { ...transport, stored }
}

test('Submit posts one draft per stack; a stored draft\'s pins leave the device; the results and the Submitted panel follow', async () => {
    const { rows, pins } = threePins()
    savePins(window.localStorage, pins)
    const worker = storingWorker()
    await render({ rows, transport: worker.fetchImpl, basemap: 'aerial', lite: false, dark: false })
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('3')
    expect(submitButton().disabled).toBe(false)
    expect(submitButton().textContent).toBe('Submit 3 pins')
    expect(host.querySelector('[data-cp-draft-count]')?.textContent).toBe('2 drafts — one per place or stack')
    expect(host.querySelector('[data-cp-submitted-count]')?.textContent).toBe('0')

    await click(submitButton())
    const posts = worker.calls.filter((c) => c.init.method === 'POST')
    expect(posts).toHaveLength(2)
    const drafts = posts.map((c) => JSON.parse(String(c.init.body)) as Record<string, unknown>)
    expect(drafts.map((d) => (d.batch as { stack_key: string }).stack_key)).toEqual(['37.500000,-77.400000', '37.600000,-77.300000'])
    expect(drafts.map((d) => (d.pins as unknown[]).length)).toEqual([2, 1])
    expect(drafts[0]).toMatchObject({ contract: 'cleanplateva.map-draft.v1', tier: 'full', basemap: { style: 'aerial', zoom: 0 } })
    for (const draft of drafts) {
        for (const field of ['operator', 'instrument', 'saved_at', 'submitted_by']) expect(draft).not.toHaveProperty(field)
    }
    // Every pin stored, so the device holds none.
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('0')
    expect(loadPins(window.localStorage)).toEqual([])
    const results = Array.from(host.querySelectorAll('[data-cp-result]'))
    expect(results.map((el) => el.getAttribute('data-cp-result'))).toEqual(['stored', 'stored'])
    expect(results[0]?.textContent).toContain('Stored')
    expect(results[0]?.textContent).toContain('2 pins (Place a + 1)')
    expect(results[1]?.textContent).toContain('1 pin (Place c)')
    // The list was asked again after the store (the last call), and the
    // panel shows both drafts.
    expect(worker.calls.at(-1)?.init.method).toBe('GET')
    expect(worker.calls.findIndex((c) => c.init.method === 'POST')).toBeLessThan(worker.calls.length - 1)
    expect(host.querySelector('[data-cp-submitted-count]')?.textContent).toBe('2')
    expect(host.querySelectorAll('[data-cp-submitted]')).toHaveLength(2)
    expect(host.querySelector('[data-cp-submitted-panel]')?.textContent).toContain('Awaiting pull')
})

test('a refused draft keeps its pins and shows the Worker\'s reason; the other draft still stores', async () => {
    const { rows, pins } = threePins()
    savePins(window.localStorage, pins)
    const transport = transportOf(({ init }) => {
        if (init.method !== 'POST') return { status: 200, contentType: JSON_, body: { ok: true, drafts: [], truncated: false } }
        const draft = JSON.parse(String(init.body)) as { pins: unknown[] }
        if (draft.pins.length === 2) return { status: 400, contentType: JSON_, body: { ok: false, reason: '$.pins[1].after: identical to the published point — the pin proposes nothing' } }
        return { status: 201, contentType: JSON_, body: { ok: true, key: 'drafts/k.json', sha256: 'x', pins: 1, saved_at: 's', existing: false } }
    })
    await render({ rows, transport: transport.fetchImpl })
    await click(submitButton())
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('2')
    expect(loadPins(window.localStorage).map((p) => p.permit_id)).toEqual(['a', 'b'])
    const results = Array.from(host.querySelectorAll('[data-cp-result]'))
    expect(results.map((el) => el.getAttribute('data-cp-result'))).toEqual(['refused', 'stored'])
    expect(results[0]?.textContent).toContain('Refused (Place a + 1) — $.pins[1].after: identical to the published point')
})

test('Access\'s redirect on Submit hands the session loss up and keeps the draft', async () => {
    const { rows, pins } = threePins()
    savePins(window.localStorage, pins)
    const onSessionLost = vi.fn()
    const transport = transportOf(({ init }) => (init.method === 'POST'
        ? { type: 'opaqueredirect', status: 0, ok: false }
        : { status: 200, contentType: JSON_, body: { ok: true, drafts: [], truncated: false } }))
    await render({ rows, transport: transport.fetchImpl, onSessionLost })
    await click(submitButton())
    expect(onSessionLost).toHaveBeenCalledTimes(1)
    expect(transport.calls.filter((c) => c.init.method === 'POST')).toHaveLength(1)
    expect(loadPins(window.localStorage)).toHaveLength(3)
})

test('a build without the Worker never pretends: the pins stay and the line says so', async () => {
    const { rows, pins } = threePins()
    savePins(window.localStorage, pins)
    const transport = shell()
    await render({ rows, transport: transport.fetchImpl })
    await click(submitButton())
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('3')
    const results = Array.from(host.querySelectorAll('[data-cp-result]'))
    expect(results.map((el) => el.getAttribute('data-cp-result'))).toEqual(['unavailable'])
    expect(results[0]?.textContent).toContain('this build cannot store drafts (no proposals route in this build)')
    // The run stopped at the first draft — the second was never posted.
    expect(transport.calls.filter((c) => c.init.method === 'POST')).toHaveLength(1)
})

test('a pin still waiting for its detail holds Submit', async () => {
    const a = row('a')
    const listeners = new Map<string, Set<unknown>>()
    const map = {
        on: (ev: string, fn: unknown) => { (listeners.get(ev) ?? listeners.set(ev, new Set()).get(ev))!.add(fn) },
        off: (ev: string, fn: unknown) => { listeners.get(ev)?.delete(fn) },
        getSource: () => ({ setData: () => {} }),
        addSource: () => {},
        addLayer: () => {},
        getLayer: () => ({}),
        removeLayer: () => {},
        removeSource: () => {},
        project: () => ({ x: 0, y: 0 }),
        unproject: () => ({ lng: -77.401, lat: 37.501 }),
        queryRenderedFeatures: () => [],
        getCanvas: () => ({ style: { cursor: '' }, getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
        getZoom: () => 14,
    }
    let handler: ((permitId: string, event: { clientX: number; clientY: number }) => void) | null = null
    const bindRowDrag = (fn: typeof handler) => { handler = fn }
    const never = () => new Promise<never>(() => {})
    await render({ map: map as never, rows: [a], bindRowDrag: bindRowDrag as never, getDetail: never })
    // A row dragged out of a stack: the press, the travel past the threshold, the release.
    await act(async () => {
        handler?.('a', { clientX: 10, clientY: 10 })
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 40 }))
        window.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 40 }))
    })
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('1')
    expect(submitButton().disabled).toBe(true)
    expect(host.textContent).toContain('Waiting for site detail before submitting.')
})
