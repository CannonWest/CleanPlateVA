/**
 * The MapLibre island (CRVa-M0) — a direct instance in a ref'd container
 * (D-CR-MAP-1); React owns everything AROUND the canvas. Grown from the
 * CRF proof map into the real §6.2 marker grammar:
 *
 *   · grade-colored dots with a ring in every mode (zoom-scaled radius);
 *   · grade letters on the dots past LETTER_ZOOM (§6.0: the letter always
 *     rides the color);
 *   · gray uniform = basic map, gray = unscored, dimmed gray = closed;
 *   · same-point stacks as NEUTRAL count bubbles (no proximity clusters —
 *     the CRD-M1 mockup rule, re-ratified 2026-08-30 after a live trial
 *     on the preview: revived in #174 at Cannon's ask, withdrawn on his
 *     review in the next pass; the CRF proof already drew all ~25k dots).
 *
 * No declining indicator for now: the CRD-M1 dashed own-color ring was
 * scrapped on the same review — the replacement form (if any) is Cannon's
 * open call.
 *
 * Ported from the old `map.js`: the dark-matter road-label contrast fix,
 * fadeDuration 0 (symbol counts must move with their bubbles), geolocate +
 * patient auto-locate, and the out-of-coverage note.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import * as maplibregl from 'maplibre-gl'
import { X } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
    DARK_MAJOR_ROAD_LABEL_COLOR, DARK_MAJOR_ROAD_LABEL_LAYER,
    LETTER_TEXT_SIZE, LETTER_ZOOM, LYR_POINT_LETTERS,
    LYR_POINTS, LYR_STACK_COUNT, LYR_STACKS, MARKER_RING,
    POINT_RADIUS_FULL, POINT_RADIUS_STOPS, SRC, STACK_COUNT_ZOOM,
    STACK_INK, STACK_RADII, STACK_STEPS, STACK_SURFACE, STYLE_DARK,
    STYLE_LIGHT, VA_BOUNDS, VA_FIT,
} from './constants'
import { buildMapData } from './mapData'
import type { MapData } from './mapData'
import { hitSlop, markRadius, pickMark } from './mapHit'
import { HoverCard } from './HoverCard'
import { StackPopover } from './StackPopover'
import { coordsOf } from './data/presentation'
import type { RosterRow } from './data/types'

type ExpressionSpec = maplibregl.ExpressionSpecification

/** The dot layer's zoom→radius curve (linear between stops). */
function pointRadiusExpr(): ExpressionSpec {
    const expr: unknown[] = ['interpolate', ['linear'], ['zoom']]
    for (const [zoom, radius] of POINT_RADIUS_STOPS) expr.push(zoom, radius)
    return expr as ExpressionSpec
}

/** Stack radius: the member-count step at full size, riding the dots' own
 *  zoom curve so a bubble reads as a slightly bigger dot at state view. */
function stackRadiusExpr(): ExpressionSpec {
    const step = ['step', ['get', 'stack'],
        STACK_RADII[0], STACK_STEPS[0], STACK_RADII[1],
        STACK_STEPS[1], STACK_RADII[2]]
    const expr: unknown[] = ['interpolate', ['linear'], ['zoom']]
    for (const [zoom, radius] of POINT_RADIUS_STOPS) {
        const factor = radius / POINT_RADIUS_FULL
        expr.push(zoom, factor === 1 ? step : ['*', step, factor])
    }
    return expr as ExpressionSpec
}

const POINT_FILTER = ['==', ['get', 'kind'], 'point'] as unknown as ExpressionSpec
const STACK_FILTER = ['==', ['get', 'kind'], 'stack'] as unknown as ExpressionSpec

/** Add source + the marker layers to the CURRENT style. Idempotent per
 *  style — style.load hands a bare basemap each time. */
function installDataLayers(map: maplibregl.Map, data: MapData, dark: boolean): void {
    if (map.getSource(SRC)) return
    const theme = dark ? 'dark' : 'light'
    map.addSource(SRC, { type: 'geojson', data: data.geojson })
    map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC,
        filter: POINT_FILTER,
        paint: {
            'circle-radius': pointRadiusExpr(),
            'circle-color': ['get', 'fill'],
            'circle-opacity': ['get', 'opacity'],
            'circle-stroke-color': MARKER_RING[theme],
            'circle-stroke-width': 1.5,
        },
    })
    map.addLayer({
        id: LYR_POINT_LETTERS,
        type: 'symbol',
        source: SRC,
        minzoom: LETTER_ZOOM,
        filter: ['all', POINT_FILTER, ['!=', ['get', 'letter'], '']] as unknown as ExpressionSpec,
        layout: {
            'text-field': ['get', 'letter'],
            'text-font': ['Montserrat Regular'],
            'text-size': LETTER_TEXT_SIZE,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
    })
    // Stacks sit above the lone dots: a point standing for N places
    // outranks its neighbours. Bubbles ride the dots' zoom curve (the old
    // client hid them under proximity clusters below z12; scaled down they
    // read as slightly-bigger dots instead of swamping the state view),
    // and the count appears once the bubble can carry it.
    map.addLayer({
        id: LYR_STACKS,
        type: 'circle',
        source: SRC,
        filter: STACK_FILTER,
        paint: {
            'circle-radius': stackRadiusExpr(),
            'circle-color': STACK_SURFACE[theme],
            'circle-stroke-color': MARKER_RING[theme],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 2],
        },
    })
    map.addLayer({
        id: LYR_STACK_COUNT,
        type: 'symbol',
        source: SRC,
        minzoom: STACK_COUNT_ZOOM,
        filter: STACK_FILTER,
        layout: {
            'text-field': ['to-string', ['get', 'stack']],
            'text-font': ['Montserrat Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], STACK_COUNT_ZOOM, 9, 14, 11],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        // Neutral bubble, ink label — the count sits INSIDE (the old
        // outside-offset dodge existed for grade-tinted fills).
        paint: { 'text-color': STACK_INK[theme] },
    })
}

/** dark-matter ships trunk/motorway labels at 1.7:1 against its own
 *  background (vendor defect, one layer); guard on the layer existing. */
function fixDarkRoadLabels(map: maplibregl.Map, dark: boolean): void {
    if (!dark) return
    if (map.getLayer(DARK_MAJOR_ROAD_LABEL_LAYER)) {
        map.setPaintProperty(DARK_MAJOR_ROAD_LABEL_LAYER, 'text-color', DARK_MAJOR_ROAD_LABEL_COLOR)
    }
}

export function MapView({ facilities, lite, dark, onSelect }: {
    facilities: RosterRow[]
    lite: boolean
    dark: boolean
    /** A facility was clicked (a lone dot, or a stack member picked). */
    onSelect: (permitId: string) => void
}) {
    const container = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null)
    const followingRef = useRef(false)
    const styleDarkRef = useRef(dark)
    const [note, setNote] = useState<{ text: string; back: boolean } | null>(null)
    const [failed, setFailed] = useState(false)
    const hideHoverRef = useRef<() => void>(() => {})

    const data = useMemo(() => buildMapData(facilities, lite), [facilities, lite])
    const dataRef = useRef<MapData>(data)
    dataRef.current = data
    const darkRef = useRef(dark)
    darkRef.current = dark
    const facilitiesRef = useRef(facilities)
    facilitiesRef.current = facilities
    const byPid = useMemo(
        () => new Map(facilities.map((f) => [String(f.permit_id), f])),
        [facilities],
    )
    const byPidRef = useRef(byPid)
    byPidRef.current = byPid
    const liteRef = useRef(lite)
    liteRef.current = lite

    // The marker-bound hover card (M1): one popup + one persistent React
    // root, display-only and mouse-transparent (theme.css .cp-tip). The
    // key guard keeps the same facility from re-rendering per mousemove.
    const popupRef = useRef<maplibregl.Popup | null>(null)
    const popupHostRef = useRef<HTMLDivElement | null>(null)
    const popupRootRef = useRef<Root | null>(null)
    const hoverKeyRef = useRef<string | null>(null)

    // The stack member popover (M2): its own INTERACTIVE popup + root.
    const stackPopupRef = useRef<maplibregl.Popup | null>(null)
    const stackHostRef = useRef<HTMLDivElement | null>(null)
    const stackRootRef = useRef<Root | null>(null)
    const stackKeyRef = useRef<string | null>(null)
    const closeStackRef = useRef<() => void>(() => {})
    const onSelectRef = useRef(onSelect)
    onSelectRef.current = onSelect

    // Padded bounding box of the loaded facilities — "the mapped area".
    function coverageContains(lat: number, lon: number): boolean {
        let n = -90, s = 90, e = -180, w = 180
        for (const f of facilitiesRef.current) {
            const c = coordsOf(f)
            if (c.lat == null || c.lon == null) continue
            n = Math.max(n, c.lat); s = Math.min(s, c.lat)
            e = Math.max(e, c.lon); w = Math.min(w, c.lon)
        }
        if (n < s) return true // nothing located yet — say nothing
        const PAD = 0.2 // ~20 km — near-edge users still see markers
        return lat <= n + PAD && lat >= s - PAD && lon <= e + PAD && lon >= w - PAD
    }

    useEffect(() => {
        if (!container.current || mapRef.current) return
        let map: maplibregl.Map
        try {
            map = new maplibregl.Map({
                container: container.current,
                style: darkRef.current ? STYLE_DARK : STYLE_LIGHT,
                bounds: VA_BOUNDS,
                fitBoundsOptions: VA_FIT,
                maxZoom: 19,
                // Circle layers redraw instantly; symbol layers cross-fade.
                // The stack counts and their bubbles are the same object —
                // square the two by turning the fade off (survives setStyle).
                fadeDuration: 0,
            })
        } catch {
            // No WebGL (or a headless test runner): the canvas can't start.
            // Same posture as the old client's CDN-failure note — say so
            // instead of a silent void.
            setFailed(true)
            return
        }
        mapRef.current = map
        styleDarkRef.current = darkRef.current
        if (import.meta.env.DEV) {
            ;(window as unknown as { __cpMap?: maplibregl.Map }).__cpMap = map
        }

        // Bottom-right: the floating band owns the top-left corner, and the
        // right sheet (M2) opens above these on the z axis, not over them.
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

        // "Find me" + follow. The 6s timeout keeps a MANUAL press snappy;
        // maximumAge lets the control reuse the fix auto-locate acquired.
        const geolocate = new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 },
            trackUserLocation: true,
            // Land at neighborhood radius on CARTO's 512px tiles.
            fitBoundsOptions: { maxZoom: 13 },
        })
        geolocateRef.current = geolocate
        geolocate.on('geolocate', (pos) => {
            const { latitude, longitude } = pos.coords
            if (coverageContains(latitude, longitude)) setNote(null)
            else setNote({ text: "This map only covers Virginia, and you're outside it.", back: true })
        })
        geolocate.on('error', () => setNote({
            text: "We couldn't find your location. Check that location access is on for your browser.",
            back: false,
        }))
        geolocate.on('trackuserlocationstart', () => { followingRef.current = true })
        geolocate.on('userlocationfocus', () => { followingRef.current = true })
        geolocate.on('trackuserlocationend', () => { followingRef.current = false })
        geolocate.on('userlocationlostfocus', () => { followingRef.current = false })
        map.addControl(geolocate, 'bottom-right')

        // Auto-locate: unsolicited and best-effort — its own PATIENT request
        // (the permission prompt's decision time counts against the timeout),
        // silent on every failure; on success the control takes over.
        void (async () => {
            try {
                const perm = await navigator.permissions.query({ name: 'geolocation' })
                if (perm.state === 'denied') return
            } catch { /* no Permissions API — the request below finds out */ }
            navigator.geolocation?.getCurrentPosition(
                () => {
                    const kick = (attemptsLeft: number) => {
                        if (geolocateRef.current?.trigger() || attemptsLeft <= 0) return
                        setTimeout(() => kick(attemptsLeft - 1), 200)
                    }
                    kick(10)
                },
                () => { /* silent: nobody asked, and the map shows the state */ },
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
            )
        })()

        // Fires on the initial style AND after every setStyle (theme swap) —
        // custom sources/layers/images don't survive a swap.
        map.on('style.load', () => {
            installDataLayers(map, dataRef.current, styleDarkRef.current)
            fixDarkRoadLabels(map, styleDarkRef.current)
        })

        // ── the marker-bound hover (M1) ────────────────────────────────
        // Fine pointers only — touch = click, and the tap's job is the
        // detail panel (M2). Events hang off the MAP, not layer ids: a
        // padded hit test must see every mark type at once, and map-level
        // listeners survive style swaps on their own. (matchMedia is
        // absent in headless runners; no matcher = treat as fine.)
        const coarse = typeof window.matchMedia === 'function'
            && window.matchMedia('(pointer: coarse)').matches

        const hideHover = () => {
            hoverKeyRef.current = null
            popupRef.current?.remove()
        }
        hideHoverRef.current = hideHover

        /** Which mark did the pointer mean? (markers.js rules, mapHit.ts) */
        const pickMarkAt = (point: { x: number; y: number }) => {
            if (!map.getLayer(LYR_POINTS)) return null // style swap mid-move
            const slop = hitSlop(coarse)
            const box: [maplibregl.PointLike, maplibregl.PointLike] = [
                [point.x - slop, point.y - slop],
                [point.x + slop, point.y + slop],
            ]
            let features: maplibregl.MapGeoJSONFeature[]
            try {
                features = map.queryRenderedFeatures(box, { layers: [LYR_STACKS, LYR_POINTS] })
            } catch {
                return null
            }
            if (!features.length) return null
            const zoom = map.getZoom()
            const candidates = features.map((feature) => {
                const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates
                const at = map.project([lon as number, lat as number])
                return {
                    feature,
                    layerId: feature.layer.id,
                    dx: at.x - point.x,
                    dy: at.y - point.y,
                    radius: markRadius(feature.layer.id, feature.properties, zoom),
                }
            })
            return pickMark(candidates, slop)
        }

        const showCard = (lngLat: [number, number], content: React.ReactNode) => {
            if (!popupHostRef.current) {
                popupHostRef.current = document.createElement('div')
                popupRootRef.current = createRoot(popupHostRef.current)
            }
            // Committed synchronously so the popup measures real content
            // when it places itself (the dynamic anchor keeps the card
            // inside the map container).
            flushSync(() => {
                popupRootRef.current?.render(content)
            })
            if (!popupRef.current) {
                popupRef.current = new maplibregl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    offset: 14,
                    // The full-tier card carries the panel's trend
                    // instrument (the old client's 380 hero width); the
                    // content divs stay narrower where they want to.
                    maxWidth: '380px',
                    className: 'cp-tip',
                })
            }
            popupRef.current
                .setLngLat(lngLat)
                .setDOMContent(popupHostRef.current)
                .addTo(map)
        }

        // ── the stack member popover (M2) ──────────────────────────────
        const closeStack = () => {
            stackKeyRef.current = null
            stackPopupRef.current?.remove()
        }
        closeStackRef.current = closeStack

        const openStack = (skey: string, lngLat: [number, number]) => {
            const members = dataRef.current.stacks.get(skey)
            if (!members || members.length < 2) return
            if (!stackHostRef.current) {
                stackHostRef.current = document.createElement('div')
                stackRootRef.current = createRoot(stackHostRef.current)
            }
            stackKeyRef.current = skey
            hideHover()
            flushSync(() => {
                stackRootRef.current?.render(
                    <StackPopover
                        members={members}
                        lite={liteRef.current}
                        onPick={(pid) => {
                            closeStack()
                            onSelectRef.current(pid)
                        }}
                    />,
                )
            })
            if (!stackPopupRef.current) {
                stackPopupRef.current = new maplibregl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    offset: 16,
                    maxWidth: '288px',
                    className: 'cp-pop',
                })
            }
            stackPopupRef.current
                .setLngLat(lngLat)
                .setDOMContent(stackHostRef.current)
                .addTo(map)
        }

        /** Click: open a stack's member list, or select a place. Anything
         *  that is not the open stack closes its popover — empty ground
         *  included (the old web's dismissal rule). */
        map.on('click', (e) => {
            const hit = pickMarkAt(e.point)
            if (!hit) {
                closeStack()
                return
            }
            const coords = (hit.candidate.feature.geometry as GeoJSON.Point)
                .coordinates as [number, number]
            const props = hit.candidate.feature.properties as { pid?: string; skey?: string }
            if (hit.layerId === LYR_STACKS) {
                const skey = String(props.skey)
                if (stackKeyRef.current === skey) {
                    closeStack() // clicking the open stack again dismisses it
                    return
                }
                openStack(skey, [...coords])
                return
            }
            closeStack()
            if (props.pid && byPidRef.current.has(String(props.pid))) {
                hideHover() // the panel takes over
                onSelectRef.current(String(props.pid))
            }
        })

        const onStackKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && stackKeyRef.current) closeStack()
        }
        document.addEventListener('keydown', onStackKey)

        if (!coarse) {
            map.on('mousemove', (e) => {
                // A pointer over the interactive popover still bubbles a
                // map-level mousemove; that moment belongs to the popover,
                // not to "empty ground" (the old spider-leg guard).
                const target = e.originalEvent?.target as Element | null
                if (target?.closest?.('.maplibregl-popup:not(.cp-tip)')) return
                const hit = pickMarkAt(e.point)
                if (!hit) {
                    map.getCanvas().style.cursor = ''
                    hideHover()
                    return
                }
                map.getCanvas().style.cursor = 'pointer'
                const coords = (hit.candidate.feature.geometry as GeoJSON.Point)
                    .coordinates as [number, number]
                const props = hit.candidate.feature.properties as { pid?: string; skey?: string; stack?: number }
                if (hit.layerId === LYR_STACKS) {
                    // A stack is a container, not a place: a line saying
                    // what it holds — never the facility card, which would
                    // have to pick one of the permits to be about.
                    const key = `stack:${props.skey}`
                    if (hoverKeyRef.current === key) return
                    hoverKeyRef.current = key
                    showCard([...coords], (
                        <div className="text-cp-ink">
                            <div className="text-[13px] font-semibold tabular-nums">
                                {props.stack} places at this point
                            </div>
                        </div>
                    ))
                    return
                }
                const f = byPidRef.current.get(String(props.pid))
                if (!f) return
                if (hoverKeyRef.current === String(props.pid)) return
                hoverKeyRef.current = String(props.pid)
                // Anchored to the MARKER, never the pointer: the card
                // points at the thing it is about.
                showCard([...coords], <HoverCard f={f} lite={liteRef.current} />)
            })
            // Leaving the canvas is not a mousemove, so the card would hang.
            map.on('mouseout', () => {
                map.getCanvas().style.cursor = ''
                hideHover()
            })
        }

        // The container may have been zero-sized at construction (embed,
        // flex not yet resolved) — re-fit once unless a location fix has
        // already claimed the camera.
        const settle = setTimeout(() => {
            map.resize()
            if (!followingRef.current) map.fitBounds(VA_BOUNDS, { ...VA_FIT, duration: 0 })
        }, 50)

        return () => {
            clearTimeout(settle)
            document.removeEventListener('keydown', onStackKey)
            hideHover()
            closeStack()
            const roots = [popupRootRef.current, stackRootRef.current]
            popupRootRef.current = null
            popupHostRef.current = null
            popupRef.current = null
            stackRootRef.current = null
            stackHostRef.current = null
            stackPopupRef.current = null
            // Unmount outside the commit React is running right now.
            setTimeout(() => roots.forEach((root) => root?.unmount()), 0)
            geolocateRef.current = null
            mapRef.current = null
            map.remove()
        }
    }, [])

    // Roster / filter / tier changes → new source data. A filter flip can
    // remove the very marker an open card or popover anchors to — don't
    // leave either floating over nothing (membership may have changed).
    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        hideHoverRef.current()
        closeStackRef.current()
        const source = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
        source?.setData(data.geojson)
    }, [data])

    // Theme swap: setStyle tears everything down; style.load reinstalls.
    useEffect(() => {
        const map = mapRef.current
        if (!map || styleDarkRef.current === dark) return
        hideHoverRef.current()
        closeStackRef.current()
        styleDarkRef.current = dark
        map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT)
    }, [dark])

    return (
        <div className="absolute inset-0">
            <div ref={container} className="h-full w-full" aria-label="map" />
            {failed && (
                <p className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[12.5px] text-cp-ink-3">
                    The map could not start (WebGL unavailable).
                </p>
            )}
            {note && (
                <div className="absolute top-16 left-1/2 z-10 flex max-w-sm -translate-x-1/2 items-center gap-3 rounded-cp-card border border-cp-hairline bg-cp-surface-1/95 px-3 py-2 text-[12.5px] shadow-cp">
                    <span>{note.text}</span>
                    {note.back && (
                        <button
                            type="button"
                            className="shrink-0 font-semibold text-cp-accent"
                            onClick={() => {
                                // A zoom-changing move does NOT drop the
                                // control's follow lock — switch it off first.
                                if (followingRef.current) geolocateRef.current?.trigger()
                                mapRef.current?.fitBounds(VA_BOUNDS, VA_FIT)
                                setNote(null)
                            }}
                        >
                            Back to Virginia
                        </button>
                    )}
                    <button
                        type="button"
                        className="shrink-0 text-cp-ink-3"
                        aria-label="Dismiss"
                        onClick={() => setNote(null)}
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    )
}
