/**
 * The map edit mode's hands (CPE-M2, design ref frontend-redesign.md §6.6)
 * — everything that touches the live MapLibre map: the proposal layers, and
 * the drags that write pins into them. No React here; the map is typed
 * structurally (`EditHost`), so a spec drives the whole thing against a
 * recording fake, and the draft itself lives with the React side
 * (MapEditor.tsx) through three callbacks.
 *
 * Two drags:
 *
 *   · From a DOT. `mousedown` on a published point (the hit test's slop, the
 *     dot's own radius — mapHit.ts) starts a pin on that point and calls
 *     `preventDefault()` on the map event, which is how MapLibre is told not
 *     to pan for this gesture. `mousemove` moves the pin; `mouseup` drops it
 *     — or DISCARDS it when it lands back within the dot's reach (a click,
 *     or a change of mind). The dot never moves: it is the record, and the
 *     pin is the proposal, tethered to it. A pin already drafted can be
 *     picked up again from its own layer.
 *   · From a ROW of the stack popover. The popover's button is not on the
 *     canvas, so this one rides window pointer events: nothing happens until
 *     the pointer has travelled past a small threshold (a click on the row
 *     stays a click); then the pin is born under the pointer, tethered to
 *     the stack point, and follows it via `unproject` of the canvas-relative
 *     position until release. No spiderfy (Cannon, 2026-09-07).
 *
 * The layers are reinstalled on every `style.load` — a theme swap drops
 * every custom source — AFTER MapView's own data layers, which registered
 * their listener first, so the proposals draw on top. The "Go to a
 * coordinate" mark (mapGoto.ts) rides the same reinstall, added first so
 * the proposals draw over it; it is drawn and nothing else — no hit test
 * knows it is there, and no gesture starts on it.
 */

import type * as maplibregl from 'maplibre-gl'
import { HIT_SLOP_COARSE, HIT_SLOP_FINE, LYR_POINTS, MARKER_RING } from '../constants'
import { pointRadiusAt } from '../mapHit'
import {
    buildProposalGeoJSON, LYR_PROPOSAL_BADGES, LYR_PROPOSAL_PINS, LYR_PROPOSAL_TETHERS,
    PIN_RADIUS, PROPOSAL_COLOR, SRC_PROPOSALS, withinDiscard,
} from './mapDraft'
import type { LngLatPair, ProposalCollection, ProposalPin } from './mapDraft'
import {
    buildGotoGeoJSON, installGotoLayers, LYR_GOTO_CASE, LYR_GOTO_DOT, LYR_GOTO_RING, SRC_GOTO,
} from './mapGoto'

/** What the controller needs of a map — the real `maplibregl.Map`
 *  satisfies it; a spec passes a recorder. */
export type EditHost = Pick<maplibregl.Map,
    'on' | 'off' | 'getSource' | 'addSource' | 'addLayer' | 'getLayer' | 'removeLayer'
    | 'removeSource' | 'project' | 'unproject' | 'queryRenderedFeatures' | 'getCanvas' | 'getZoom'>

export interface ControllerDeps {
    coarse: boolean
    dark: () => boolean
    /** A drag is starting on a published place: hand back the pin to draft
     *  (a fresh one, or the one already drafted for the permit), or null to
     *  refuse — the controller then does nothing for this gesture. */
    onStart: (permitId: string) => ProposalPin | null
    onMove: (permitId: string, after: LngLatPair) => void
    /** The gesture ended. `discard` means the pin landed back within the
     *  published point's reach — remove it. */
    onDrop: (permitId: string, after: LngLatPair, discard: boolean) => void
}

export interface MapEditController {
    install(): void
    setPins(pins: readonly ProposalPin[]): void
    /** The "Go to a coordinate" mark, or null for none (mapGoto.ts). It is
     *  drawn, never dragged: the hit tests do not know it exists. */
    setTarget(point: LngLatPair | null): void
    /** A stack-popover row is being pressed at these client coordinates. */
    beginRowDrag(permitId: string, clientX: number, clientY: number): void
    dispose(): void
}

/** Past this many px the pressed row is a drag, not a click. */
export const ROW_DRAG_THRESHOLD_PX = 8

type Point = { x: number; y: number }

interface Drag {
    permitId: string
    /** The published point the tether runs back to — the discard reference. */
    origin: LngLatPair
    last: LngLatPair
}

/** Add the proposal source + layers to the CURRENT style. Idempotent per
 *  style. Exported for the spec (the layer order and paint are contracts). */
export function installProposalLayers(
    map: Pick<maplibregl.Map, 'getSource' | 'addSource' | 'addLayer'>,
    dark: boolean,
    data: ProposalCollection,
): void {
    if (map.getSource(SRC_PROPOSALS)) return
    map.addSource(SRC_PROPOSALS, { type: 'geojson', data })
    map.addLayer({
        id: LYR_PROPOSAL_TETHERS,
        type: 'line',
        source: SRC_PROPOSALS,
        filter: ['==', ['get', 'role'], 'tether'],
        layout: { 'line-cap': 'round' },
        paint: {
            'line-color': PROPOSAL_COLOR,
            'line-width': 2,
            'line-dasharray': [2, 2],
            'line-opacity': 0.9,
        },
    })
    map.addLayer({
        id: LYR_PROPOSAL_PINS,
        type: 'circle',
        source: SRC_PROPOSALS,
        filter: ['==', ['get', 'role'], 'pin'],
        paint: {
            'circle-radius': PIN_RADIUS,
            'circle-color': PROPOSAL_COLOR,
            'circle-stroke-color': MARKER_RING[dark ? 'dark' : 'light'],
            'circle-stroke-width': 2,
        },
    })
    map.addLayer({
        id: LYR_PROPOSAL_BADGES,
        type: 'symbol',
        source: SRC_PROPOSALS,
        filter: ['all', ['==', ['get', 'role'], 'pin'], ['!=', ['get', 'badge'], '']],
        layout: {
            'text-field': ['get', 'badge'],
            'text-font': ['Montserrat Regular'],
            'text-size': 11,
            'text-anchor': 'bottom',
            'text-offset': [0, -1.2],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: {
            'text-color': PROPOSAL_COLOR,
            'text-halo-color': dark ? '#16191c' : '#ffffff',
            'text-halo-width': 1.5,
        },
    })
}

export function createMapEditController(map: EditHost, deps: ControllerDeps): MapEditController {
    let pins: readonly ProposalPin[] = []
    let target: LngLatPair | null = null
    let drag: Drag | null = null
    let installed = false
    const slop = deps.coarse ? HIT_SLOP_COARSE : HIT_SLOP_FINE

    const canvas = () => map.getCanvas()
    const setCursor = (value: string) => {
        canvas().style.cursor = value
    }

    // The mark goes on first, so the proposal pins draw over it.
    const reinstall = () => {
        installGotoLayers(map, deps.dark(), buildGotoGeoJSON(target))
        installProposalLayers(map, deps.dark(), buildProposalGeoJSON(pins))
    }

    const setData = () => {
        const source = map.getSource(SRC_PROPOSALS) as maplibregl.GeoJSONSource | undefined
        source?.setData(buildProposalGeoJSON(pins) as never)
    }

    const setGotoData = () => {
        const source = map.getSource(SRC_GOTO) as maplibregl.GeoJSONSource | undefined
        source?.setData(buildGotoGeoJSON(target) as never)
    }

    /** The nearest feature of `layer` within the slop of `point`, by centre
     *  distance; null when the layer is missing (mid style swap). */
    const nearest = (point: Point, layer: string, radius: number) => {
        if (!map.getLayer(layer)) return null
        let features: maplibregl.MapGeoJSONFeature[]
        try {
            features = map.queryRenderedFeatures(
                [[point.x - slop - radius, point.y - slop - radius], [point.x + slop + radius, point.y + slop + radius]],
                { layers: [layer] },
            )
        } catch {
            return null
        }
        let best: { pid: string; lngLat: LngLatPair; gap: number } | null = null
        for (const feature of features) {
            const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
            const at = map.project([lon, lat])
            const gap = Math.hypot(at.x - point.x, at.y - point.y) - radius
            if (gap > slop) continue
            const pid = String((feature.properties as { pid?: unknown }).pid ?? '')
            if (!pid) continue
            if (!best || gap < best.gap) best = { pid, lngLat: { lat, lon }, gap }
        }
        return best
    }

    const start = (permitId: string, origin: LngLatPair): boolean => {
        const pin = deps.onStart(permitId)
        if (!pin) return false
        drag = { permitId, origin, last: pin.after }
        setCursor('grabbing')
        return true
    }

    const finish = (point: Point, lngLat: LngLatPair) => {
        if (!drag) return
        const origin = map.project([drag.origin.lon, drag.origin.lat])
        const distance = Math.hypot(point.x - origin.x, point.y - origin.y)
        const discard = withinDiscard(distance, slop, pointRadiusAt(map.getZoom()))
        const { permitId } = drag
        drag = null
        setCursor('crosshair')
        deps.onDrop(permitId, lngLat, discard)
    }

    // ── the dot drag (map mouse events) ────────────────────────────────

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
        if (drag || e.originalEvent.button !== 0) return
        // A drafted pin under the pointer picks up again; else a dot starts one.
        const pin = nearest(e.point, LYR_PROPOSAL_PINS, PIN_RADIUS)
        if (pin) {
            const drafted = pins.find((p) => p.permit_id === pin.pid)
            if (!drafted) return
            if (!start(pin.pid, drafted.published)) return
            e.preventDefault()
            return
        }
        const dot = nearest(e.point, LYR_POINTS, pointRadiusAt(map.getZoom()))
        if (!dot) return
        if (!start(dot.pid, dot.lngLat)) return
        e.preventDefault()
    }

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
        if (drag) {
            drag.last = { lat: e.lngLat.lat, lon: e.lngLat.lng }
            deps.onMove(drag.permitId, drag.last)
            return
        }
        // MapView's own mousemove sets pointer/none first; this runs after it.
        const overPin = nearest(e.point, LYR_PROPOSAL_PINS, PIN_RADIUS)
        setCursor(overPin ? 'grab' : 'crosshair')
    }

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
        if (!drag) return
        finish(e.point, { lat: e.lngLat.lat, lon: e.lngLat.lng })
    }

    /** Released outside the canvas: drop where the pin last was. */
    const onWindowMouseUp = () => {
        if (!drag) return
        const at = map.project([drag.last.lon, drag.last.lat])
        finish({ x: at.x, y: at.y }, drag.last)
    }

    // ── the row drag (window pointer events) ───────────────────────────

    let row: { permitId: string; startX: number; startY: number; live: boolean } | null = null

    const canvasPoint = (clientX: number, clientY: number): Point => {
        const rect = canvas().getBoundingClientRect()
        return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const onPointerMove = (e: PointerEvent) => {
        if (!row) return
        if (!row.live) {
            if (Math.hypot(e.clientX - row.startX, e.clientY - row.startY) < ROW_DRAG_THRESHOLD_PX) return
            const pin = deps.onStart(row.permitId)
            if (!pin) {
                endRow()
                return
            }
            row.live = true
            drag = { permitId: row.permitId, origin: pin.published, last: pin.after }
            setCursor('grabbing')
        }
        const point = canvasPoint(e.clientX, e.clientY)
        const lngLat = map.unproject([point.x, point.y])
        if (drag) {
            drag.last = { lat: lngLat.lat, lon: lngLat.lng }
            deps.onMove(drag.permitId, drag.last)
        }
    }

    const onPointerUp = (e: PointerEvent) => {
        if (!row) return
        const live = row.live
        endRow()
        if (!live || !drag) return
        const point = canvasPoint(e.clientX, e.clientY)
        const lngLat = map.unproject([point.x, point.y])
        finish(point, { lat: lngLat.lat, lon: lngLat.lng })
    }

    const endRow = () => {
        row = null
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
    }

    return {
        install() {
            if (installed) return
            installed = true
            reinstall()
            map.on('style.load', reinstall)
            map.on('mousedown', onMouseDown)
            map.on('mousemove', onMouseMove)
            map.on('mouseup', onMouseUp)
            window.addEventListener('mouseup', onWindowMouseUp)
            setCursor('crosshair')
        },
        setPins(next) {
            pins = next
            if (installed) setData()
        },
        setTarget(next) {
            target = next
            if (installed) setGotoData()
        },
        beginRowDrag(permitId, clientX, clientY) {
            if (!installed || drag || row) return
            row = { permitId, startX: clientX, startY: clientY, live: false }
            window.addEventListener('pointermove', onPointerMove)
            window.addEventListener('pointerup', onPointerUp)
            window.addEventListener('pointercancel', onPointerUp)
        },
        dispose() {
            if (!installed) return
            installed = false
            endRow()
            drag = null
            map.off('style.load', reinstall)
            map.off('mousedown', onMouseDown)
            map.off('mousemove', onMouseMove)
            map.off('mouseup', onMouseUp)
            window.removeEventListener('mouseup', onWindowMouseUp)
            try {
                for (const id of [
                    LYR_PROPOSAL_BADGES, LYR_PROPOSAL_PINS, LYR_PROPOSAL_TETHERS,
                    LYR_GOTO_DOT, LYR_GOTO_RING, LYR_GOTO_CASE,
                ]) {
                    if (map.getLayer(id)) map.removeLayer(id)
                }
                if (map.getSource(SRC_PROPOSALS)) map.removeSource(SRC_PROPOSALS)
                if (map.getSource(SRC_GOTO)) map.removeSource(SRC_GOTO)
            } catch {
                // A style mid-swap: the outgoing style takes them with it.
            }
            setCursor('')
        },
    }
}
