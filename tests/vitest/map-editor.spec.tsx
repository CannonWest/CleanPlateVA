// @vitest-environment jsdom
/**
 * The map edit mode's chrome (CPE-M2, app/admin/MapEditor.tsx): the banner,
 * the pins drawer and what a row says, the note that persists, Undo and
 * Reset all, the no-Submit line, the stale-snapshot note, and the wiring
 * to a map — the row-press handler handed up, the controller torn down.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EDIT_BANNER, fmtMetres, MapEditor, NO_SUBMIT_NOTE } from '../../app/admin/MapEditor'
import { attachDetail, loadPins, movePin, newPin, savePins, SRC_PROPOSALS } from '../../app/admin/mapDraft'
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

async function render(props: Partial<Parameters<typeof MapEditor>[0]> = {}) {
    root = createRoot(host)
    const all = {
        map: null, rows: [], snapshotId: 'snap', dark: true, coarse: false,
        getDetail: noDetail, bindRowDrag: () => {}, onExit: () => {}, ...props,
    }
    await act(async () => {
        root?.render(<StrictMode><MapEditor {...all} /></StrictMode>)
    })
}

const click = (el: Element | null) => act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})

test('the banner, an empty drawer, and the no-Submit line', async () => {
    await render()
    expect(host.querySelector('[role="note"]')?.textContent).toBe(EDIT_BANNER)
    expect(host.querySelector('[data-cp-pin-count]')?.textContent).toBe('0')
    expect(host.textContent).toContain('No pins yet')
    expect(host.textContent).toContain(NO_SUBMIT_NOTE)
    expect(host.textContent).not.toContain('Submit</button>')
    const reset = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Reset all') as HTMLButtonElement
    expect(reset.disabled).toBe(true)
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

test('metres read as metres, then kilometres', () => {
    expect(fmtMetres(0)).toBe('0 m')
    expect(fmtMetres(37.4)).toBe('37 m')
    expect(fmtMetres(1234)).toBe('1.23 km')
    expect(fmtMetres(Number.NaN)).toBe('—')
})
