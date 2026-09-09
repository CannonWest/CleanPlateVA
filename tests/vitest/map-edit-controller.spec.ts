// @vitest-environment jsdom
/**
 * The map edit mode's hands (CPE-M2, app/admin/mapEditController.ts),
 * driven against a RECORDING map: the proposal layers and their order, the
 * dot drag from mousedown to drop — start, move, drop, discard on a change
 * of mind, the pan prevented — a drafted pin picked up again, the row drag
 * from the popover with its click-stays-a-click threshold, the "Go to a
 * coordinate" mark under them all (2026-09-09), the theme swap's reinstall, and
 * a clean dispose. Real DOM events are the e2e's job; this pins the state
 * machine.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LYR_POINTS } from '../../app/constants'
import { pointRadiusAt } from '../../app/mapHit'
import {
    LYR_PROPOSAL_BADGES, LYR_PROPOSAL_PINS, LYR_PROPOSAL_TETHERS, newPin, PIN_RADIUS, SRC_PROPOSALS,
} from '../../app/admin/mapDraft'
import type { LngLatPair, ProposalCollection, ProposalPin } from '../../app/admin/mapDraft'
import {
    GOTO_COLOR, GOTO_RADIUS, LYR_GOTO_CASE, LYR_GOTO_DOT, LYR_GOTO_RING, SRC_GOTO,
} from '../../app/admin/mapGoto'
import { createMapEditController, installProposalLayers, ROW_DRAG_THRESHOLD_PX } from '../../app/admin/mapEditController'
import type { ControllerDeps, EditHost } from '../../app/admin/mapEditController'
import type { RosterRow } from '../../app/data/types'

type Dot = { pid: string; lat: number; lon: number }
type Layer = { id: string; type: string; source?: string; filter?: unknown; paint?: Record<string, unknown>; layout?: Record<string, unknown> }

/** 1 px = 0.001°, origin at (−78, 38); the canvas sits at client (100, 50). */
const project = ([lon, lat]: [number, number]) => ({ x: (lon + 78) * 1000, y: (38 - lat) * 1000 })
const unproject = ([x, y]: [number, number]) => ({ lng: x / 1000 - 78, lat: 38 - y / 1000 })

/** MapView's own dot layer is always on the live map before the mode
 *  installs; the controller guards its queries on its presence. */
const DATA_LAYER: Layer = { id: LYR_POINTS, type: 'circle' }
const GOTO_IDS = [LYR_GOTO_CASE, LYR_GOTO_RING, LYR_GOTO_DOT]
const proposalLayers = (layers: Layer[]) =>
    layers.filter((l) => l.id !== LYR_POINTS && !GOTO_IDS.includes(l.id))
const gotoLayers = (layers: Layer[]) => layers.filter((l) => GOTO_IDS.includes(l.id))

function recorder(dots: Dot[] = [], zoom = 14) {
    const handlers = new Map<string, Set<(e: unknown) => void>>()
    const layers: Layer[] = [{ ...DATA_LAYER }]
    const sources = new Map<string, { data: ProposalCollection; setData: (d: ProposalCollection) => void }>()
    const calls = { addSource: 0, removeLayer: [] as string[], removeSource: [] as string[], setData: 0, prevented: 0 }
    const canvas = { style: { cursor: '' }, getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) }

    const inBox = (box: [[number, number], [number, number]], lon: number, lat: number) => {
        const p = project([lon, lat])
        return p.x >= box[0][0] && p.x <= box[1][0] && p.y >= box[0][1] && p.y <= box[1][1]
    }
    const map = {
        on: (ev: string, fn: (e: unknown) => void) => { (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev))!.add(fn) },
        off: (ev: string, fn: (e: unknown) => void) => { handlers.get(ev)?.delete(fn) },
        getSource: (id: string) => sources.get(id),
        addSource: (id: string, spec: { data: ProposalCollection }) => {
            calls.addSource += 1
            const entry = { data: spec.data, setData: (d: ProposalCollection) => { entry.data = d; calls.setData += 1 } }
            sources.set(id, entry)
        },
        addLayer: (spec: Layer) => { layers.push(spec) },
        getLayer: (id: string) => (layers.some((l) => l.id === id) ? {} : undefined),
        removeLayer: (id: string) => { calls.removeLayer.push(id); layers.splice(layers.findIndex((l) => l.id === id), 1) },
        removeSource: (id: string) => { calls.removeSource.push(id); sources.delete(id) },
        project,
        unproject,
        queryRenderedFeatures: (box: [[number, number], [number, number]], opts: { layers: string[] }) => {
            const [layer] = opts.layers
            if (layer === LYR_POINTS) {
                return dots.filter((d) => inBox(box, d.lon, d.lat)).map((d) => ({
                    geometry: { type: 'Point', coordinates: [d.lon, d.lat] }, properties: { pid: d.pid }, layer: { id: layer },
                }))
            }
            if (layer === LYR_PROPOSAL_PINS) {
                const data = sources.get(SRC_PROPOSALS)?.data
                return (data?.features ?? [])
                    .filter((f) => f.properties.role === 'pin' && f.geometry.type === 'Point')
                    .filter((f) => inBox(box, (f.geometry.coordinates as [number, number])[0], (f.geometry.coordinates as [number, number])[1]))
                    .map((f) => ({ geometry: f.geometry, properties: { pid: f.properties.pid }, layer: { id: layer } }))
            }
            return []
        },
        getCanvas: () => canvas,
        getZoom: () => zoom,
    }
    const fire = (ev: string, payload: unknown) => { handlers.get(ev)?.forEach((fn) => fn(payload)) }
    const mouse = (ev: string, x: number, y: number, button = 0) => {
        const ll = unproject([x, y])
        fire(ev, { point: { x, y }, lngLat: ll, originalEvent: { button }, preventDefault: () => { calls.prevented += 1 } })
    }
    // A style swap: every custom layer and source gone, MapView's dots back
    // first (its style.load listener registered before the mode's).
    const wipeStyle = () => { layers.splice(0, layers.length, { ...DATA_LAYER }); sources.clear() }
    return { map: map as unknown as EditHost, layers, sources, calls, canvas, handlers, fire, mouse, wipeStyle }
}

function row(pid: string, lat: number, lon: number, loc = 0): RosterRow {
    return {
        permit_id: pid, name: `Place ${pid}`, address: '1 Main St', address2: null, city: 'X', zip: '23220',
        tenant: 'virginia', is_restaurant: true, mobile: false, pt: 0, lat, lon, loc, ffx_oid: null,
    }
}

type Moved = [string, LngLatPair]
type Dropped = [string, LngLatPair, boolean]

function deps(over: Partial<ControllerDeps> = {}) {
    const pins = new Map<string, ProposalPin>()
    const d: ControllerDeps & { pins: Map<string, ProposalPin>; started: string[]; moved: Moved[]; dropped: Dropped[] } = {
        coarse: false,
        dark: () => true,
        started: [], moved: [], dropped: [], pins,
        onStart: vi.fn((pid: string) => {
            d.started.push(pid)
            const existing = pins.get(pid)
            if (existing) return existing
            const pin = newPin(row(pid, 37.5, -77.4), [], 'snap')
            pins.set(pid, pin)
            return pin
        }),
        onMove: vi.fn((pid, after) => { d.moved.push([pid, after]) }),
        onDrop: vi.fn((pid, after, discard) => { d.dropped.push([pid, after, discard]) }),
        ...over,
    }
    return d
}

const DOT: Dot = { pid: 'a', lat: 37.5, lon: -77.4 }
const at = project([DOT.lon, DOT.lat]) // (600, 500)

afterEach(() => { vi.restoreAllMocks() })

describe('the layers', () => {
    test('one source, three layers in order — tethers under pins under badges — idempotent per style', () => {
        const r = recorder()
        installProposalLayers(r.map, true, { type: 'FeatureCollection', features: [] })
        installProposalLayers(r.map, true, { type: 'FeatureCollection', features: [] })
        expect(r.calls.addSource).toBe(1)
        const mine = proposalLayers(r.layers)
        expect(mine.map((l) => l.id)).toEqual([LYR_PROPOSAL_TETHERS, LYR_PROPOSAL_PINS, LYR_PROPOSAL_BADGES])
        expect(mine.map((l) => l.type)).toEqual(['line', 'circle', 'symbol'])
        expect(new Set(mine.map((l) => l.source))).toEqual(new Set([SRC_PROPOSALS]))
        expect(mine[0]!.paint!['line-dasharray']).toEqual([2, 2])
        expect(mine[1]!.paint!['circle-radius']).toBe(PIN_RADIUS)
        expect(mine[1]!.paint!['circle-color']).toBe('#ff922b')
        expect(mine[2]!.layout!['text-field']).toEqual(['get', 'badge'])
        // Above the data layers: the proposals draw on top of the dots.
        expect(r.layers[0]!.id).toBe(LYR_POINTS)
    })

    test('a theme swap (style.load) reinstalls them, and dispose removes them and every listener', () => {
        const r = recorder([DOT])
        const c = createMapEditController(r.map, deps())
        c.install()
        expect(r.canvas.style.cursor).toBe('crosshair')
        r.wipeStyle()
        r.fire('style.load', {})
        // Two sources per install — the mark, then the proposals.
        expect(r.calls.addSource).toBe(4)
        expect(proposalLayers(r.layers).map((l) => l.id)).toEqual([LYR_PROPOSAL_TETHERS, LYR_PROPOSAL_PINS, LYR_PROPOSAL_BADGES])
        expect(gotoLayers(r.layers).map((l) => l.id)).toEqual(GOTO_IDS)
        c.dispose()
        expect(r.calls.removeLayer).toEqual([
            LYR_PROPOSAL_BADGES, LYR_PROPOSAL_PINS, LYR_PROPOSAL_TETHERS,
            LYR_GOTO_DOT, LYR_GOTO_RING, LYR_GOTO_CASE,
        ])
        expect(r.calls.removeSource).toEqual([SRC_PROPOSALS, SRC_GOTO])
        expect([...r.handlers.values()].every((set) => set.size === 0)).toBe(true)
        expect(r.canvas.style.cursor).toBe('')
    })

    test('setPins draws through the source once installed, and is a no-op before', () => {
        const r = recorder()
        const c = createMapEditController(r.map, deps())
        const pin = newPin(row('a', 37.5, -77.4), [], null)
        c.setPins([pin])
        expect(r.calls.setData).toBe(0)
        c.install()
        c.setPins([pin])
        expect(r.calls.setData).toBe(1)
        expect(r.sources.get(SRC_PROPOSALS)!.data.features).toHaveLength(2)
    })

    test('the mark installs UNDER the proposals, so a pin dragged onto it draws inside the ring', () => {
        const r = recorder()
        const c = createMapEditController(r.map, deps())
        c.install()
        const ids = r.layers.map((l) => l.id)
        expect(ids).toEqual([
            LYR_POINTS,
            LYR_GOTO_CASE, LYR_GOTO_RING, LYR_GOTO_DOT,
            LYR_PROPOSAL_TETHERS, LYR_PROPOSAL_PINS, LYR_PROPOSAL_BADGES,
        ])
        const mark = gotoLayers(r.layers)
        expect(mark.map((l) => l.type)).toEqual(['circle', 'circle', 'circle'])
        expect(new Set(mark.map((l) => l.source))).toEqual(new Set([SRC_GOTO]))
        // A ring with a hole (the casing and the ring paint no fill), and a
        // bead on the coordinate itself.
        expect(mark[0]!.paint!['circle-opacity']).toBe(0)
        expect(mark[1]!.paint!['circle-opacity']).toBe(0)
        expect(mark[0]!.paint!['circle-radius']).toBe(GOTO_RADIUS)
        expect(mark[1]!.paint!['circle-radius']).toBe(GOTO_RADIUS)
        expect(mark[1]!.paint!['circle-stroke-color']).toBe(GOTO_COLOR)
        expect(mark[2]!.paint!['circle-color']).toBe(GOTO_COLOR)
        // Never the proposal orange: the mark is not judgment.
        expect(GOTO_COLOR).not.toBe('#ff922b')
    })

    test('setTarget draws one point through the mark, and null takes it off', () => {
        const r = recorder()
        const c = createMapEditController(r.map, deps())
        c.setTarget({ lat: 37.5, lon: -77.4 })
        expect(r.calls.setData).toBe(0) // a no-op before install
        c.install()
        // The install carried the target the caller had already set.
        expect(r.sources.get(SRC_GOTO)!.data.features).toHaveLength(1)
        c.setTarget({ lat: 37.6, lon: -77.5 })
        const marked = r.sources.get(SRC_GOTO)!.data.features
        expect(marked).toHaveLength(1)
        expect(marked[0]!.geometry).toEqual({ type: 'Point', coordinates: [-77.5, 37.6] })
        c.setTarget(null)
        expect(r.sources.get(SRC_GOTO)!.data.features).toHaveLength(0)
        // The mark never enters a hit test: no gesture starts on it.
        expect(r.calls.prevented).toBe(0)
    })
})

describe('the dot drag', () => {
    test('mousedown on a dot starts a pin and prevents the pan; mousemove moves it; mouseup away drops it', () => {
        const r = recorder([DOT])
        const d = deps()
        const c = createMapEditController(r.map, d)
        c.install()
        r.mouse('mousedown', at.x + 3, at.y - 2)
        expect(d.started).toEqual(['a'])
        expect(r.calls.prevented).toBe(1)
        expect(r.canvas.style.cursor).toBe('grabbing')
        r.mouse('mousemove', at.x + 40, at.y + 30)
        expect(d.moved).toHaveLength(1)
        expect(d.moved[0]).toEqual(['a', { lat: unproject([at.x + 40, at.y + 30]).lat, lon: unproject([at.x + 40, at.y + 30]).lng }])
        r.mouse('mouseup', at.x + 80, at.y + 60)
        expect(d.dropped).toHaveLength(1)
        expect(d.dropped[0]![0]).toBe('a')
        expect(d.dropped[0]![2]).toBe(false)
        expect(r.canvas.style.cursor).toBe('crosshair')
    })

    test('a click, or a drop back within the dot\'s reach, is a discard', () => {
        const r = recorder([DOT])
        const d = deps()
        createMapEditController(r.map, d).install()
        r.mouse('mousedown', at.x, at.y)
        r.mouse('mouseup', at.x, at.y)
        expect(d.dropped[0]![2]).toBe(true)
        // Within slop (10) + the dot's radius at z14 + the pin's radius.
        const reach = 10 + pointRadiusAt(14) + PIN_RADIUS
        r.mouse('mousedown', at.x, at.y)
        r.mouse('mousemove', at.x + reach - 1, at.y)
        r.mouse('mouseup', at.x + reach - 1, at.y)
        expect(d.dropped[1]![2]).toBe(true)
        r.mouse('mousedown', at.x, at.y)
        r.mouse('mouseup', at.x + reach + 1, at.y)
        expect(d.dropped[2]![2]).toBe(false)
    })

    test('empty ground, a refused start, or a non-left button start nothing', () => {
        const r = recorder([DOT])
        const d = deps({ onStart: vi.fn(() => null) })
        createMapEditController(r.map, d).install()
        r.mouse('mousedown', at.x + 300, at.y + 300)
        expect(d.onStart).not.toHaveBeenCalled()
        r.mouse('mousedown', at.x, at.y)
        expect(d.onStart).toHaveBeenCalledTimes(1)
        expect(r.calls.prevented).toBe(0)
        r.mouse('mousemove', at.x + 40, at.y)
        expect(d.onMove).not.toHaveBeenCalled()
        r.mouse('mousedown', at.x, at.y, 2)
        expect(d.onStart).toHaveBeenCalledTimes(1)
    })

    test('a drafted pin under the pointer is picked up again without a new start, and discards against its dot', () => {
        const r = recorder([DOT])
        const d = deps()
        const c = createMapEditController(r.map, d)
        c.install()
        const moved = { ...newPin(row('a', DOT.lat, DOT.lon), [], null), after: { lat: DOT.lat - 0.1, lon: DOT.lon + 0.1 } }
        d.pins.set('a', moved)
        c.setPins([moved])
        const pinAt = project([moved.after.lon, moved.after.lat])
        r.mouse('mousedown', pinAt.x + 2, pinAt.y + 2)
        expect(d.onStart).toHaveBeenCalledTimes(1) // the existing pin is handed back, nothing new drafted
        expect(d.pins.size).toBe(1)
        r.mouse('mousemove', at.x + 200, at.y)
        r.mouse('mouseup', at.x + 200, at.y)
        expect(d.dropped[0]).toEqual(['a', { lat: unproject([at.x + 200, at.y]).lat, lon: unproject([at.x + 200, at.y]).lng }, false])
        // Back onto the dot: discarded.
        c.setPins([{ ...moved, after: { lat: unproject([at.x + 200, at.y]).lat, lon: unproject([at.x + 200, at.y]).lng } }])
        r.mouse('mousedown', at.x + 202, at.y)
        r.mouse('mouseup', at.x + 1, at.y)
        expect(d.dropped[1]![2]).toBe(true)
    })

    test('a release outside the canvas drops the pin where it last was', () => {
        const r = recorder([DOT])
        const d = deps()
        createMapEditController(r.map, d).install()
        r.mouse('mousedown', at.x, at.y)
        r.mouse('mousemove', at.x + 90, at.y + 10)
        window.dispatchEvent(new MouseEvent('mouseup'))
        expect(d.dropped).toHaveLength(1)
        expect(d.dropped[0]![1]).toEqual({ lat: unproject([at.x + 90, at.y + 10]).lat, lon: unproject([at.x + 90, at.y + 10]).lng })
        expect(d.dropped[0]![2]).toBe(false)
    })
})

describe('the row drag', () => {
    const pointer = (type: string, clientX: number, clientY: number) =>
        window.dispatchEvent(new PointerEvent(type, { clientX, clientY, bubbles: true }))

    test('below the threshold a press stays a click: no pin, no drop', () => {
        const r = recorder()
        const d = deps()
        const c = createMapEditController(r.map, d)
        c.install()
        c.beginRowDrag('a', 400, 300)
        pointer('pointermove', 400 + ROW_DRAG_THRESHOLD_PX - 1, 300)
        pointer('pointerup', 400 + ROW_DRAG_THRESHOLD_PX - 1, 300)
        expect(d.onStart).not.toHaveBeenCalled()
        expect(d.onDrop).not.toHaveBeenCalled()
    })

    test('past it the pin is born under the pointer, follows it in canvas coordinates, and drops on release', () => {
        const r = recorder()
        const d = deps()
        const c = createMapEditController(r.map, d)
        c.install()
        c.beginRowDrag('a', 700, 550) // canvas (600, 500) = the stack point
        pointer('pointermove', 700 + ROW_DRAG_THRESHOLD_PX + 40, 550 + 30)
        expect(d.started).toEqual(['a'])
        expect(d.moved).toHaveLength(1)
        // Client (748, 580) → canvas (648, 530) → unproject.
        expect(d.moved[0]).toEqual(['a', { lat: unproject([648, 530]).lat, lon: unproject([648, 530]).lng }])
        pointer('pointerup', 900, 700)
        expect(d.dropped).toHaveLength(1)
        expect(d.dropped[0]![0]).toBe('a')
        expect(d.dropped[0]![2]).toBe(false)
        expect(r.canvas.style.cursor).toBe('crosshair')
    })

    test('released back over the stack point, the pin is discarded; a second press waits for the first', () => {
        const r = recorder()
        const d = deps()
        const c = createMapEditController(r.map, d)
        c.install()
        c.beginRowDrag('a', 700, 550)
        pointer('pointermove', 760, 550)
        c.beginRowDrag('b', 700, 550) // ignored: a gesture is in flight
        pointer('pointerup', 701, 551)
        expect(d.started).toEqual(['a'])
        expect(d.dropped[0]![2]).toBe(true)
    })
})
