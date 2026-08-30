/**
 * The MapLibre island (CRVa-M0) — a direct instance in a ref'd container
 * (D-CR-MAP-1); React owns everything AROUND the canvas. Grown from the
 * CRF proof map into the real §6.2 marker grammar:
 *
 *   · grade-colored dots with a ring in every mode (zoom-scaled radius);
 *   · grade letters on the dots past LETTER_ZOOM (§6.0: the letter always
 *     rides the color);
 *   · a DASHED ring in the marker's own grade color = declining;
 *   · gray uniform = basic map, gray = unscored, dimmed gray = closed;
 *   · same-point stacks as NEUTRAL count bubbles (no proximity clusters —
 *     ratified mockup; the CRF proof already drew all ~25k dots).
 *
 * Ported from the old `map.js`: the dark-matter road-label contrast fix,
 * fadeDuration 0 (symbol counts must move with their bubbles), geolocate +
 * patient auto-locate, and the out-of-coverage note. Hover/click arrive
 * with CRVa-M1/M2.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { X } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
    DARK_MAJOR_ROAD_LABEL_COLOR, DARK_MAJOR_ROAD_LABEL_LAYER,
    DECLINING_RING_BASE_RADIUS, DECLINING_RING_GAP, GRADE_COLORS,
    LETTER_TEXT_SIZE, LETTER_ZOOM, LYR_DECLINING, LYR_POINT_LETTERS,
    LYR_POINTS, LYR_STACK_COUNT, LYR_STACKS, MARKER_RING,
    POINT_RADIUS_FULL, POINT_RADIUS_STOPS, SRC, STACK_COUNT_ZOOM,
    STACK_INK, STACK_RADII, STACK_STEPS, STACK_SURFACE, STYLE_DARK,
    STYLE_LIGHT, VA_BOUNDS, VA_FIT,
} from './constants'
import { buildMapData } from './mapData'
import type { MapData } from './mapData'
import { coordsOf } from './data/presentation'
import type { RosterRow } from './data/types'

type ExpressionSpec = maplibregl.ExpressionSpecification

/** One shared zoom→radius curve for the dot layer and the declining-ring
 *  icon scale, so the ring tracks the dot it warns about. */
function pointRadiusExpr(): ExpressionSpec {
    const expr: unknown[] = ['interpolate', ['linear'], ['zoom']]
    for (const [zoom, radius] of POINT_RADIUS_STOPS) expr.push(zoom, radius)
    return expr as ExpressionSpec
}

function ringSizeExpr(): ExpressionSpec {
    const base = DECLINING_RING_BASE_RADIUS + DECLINING_RING_GAP
    const expr: unknown[] = ['interpolate', ['linear'], ['zoom']]
    for (const [zoom, radius] of POINT_RADIUS_STOPS) {
        expr.push(zoom, (radius + DECLINING_RING_GAP) / base)
    }
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

/** Dashed declining halos, one per grade color — MapLibre circles can't
 *  dash, so they're prerendered (the old stack-halo technique). Re-run
 *  after every setStyle: images die with the style. */
function installRingImages(map: maplibregl.Map): void {
    const ratio = 2
    const radius = DECLINING_RING_BASE_RADIUS + DECLINING_RING_GAP
    const box = radius + 2 // room for the stroke
    for (const [letter, color] of Object.entries(GRADE_COLORS)) {
        if (letter === 'none') continue // declining requires a grade
        const id = `declining-ring-${letter}`
        if (map.hasImage(id)) continue
        const size = Math.ceil(box * 2 * ratio)
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.scale(ratio, ratio)
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 2
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.arc(box, box, radius, 0, 2 * Math.PI)
        ctx.stroke()
        map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: ratio })
    }
}

/** Add source + the five marker layers to the CURRENT style. Idempotent
 *  per style — style.load hands a bare basemap each time. */
function installDataLayers(map: maplibregl.Map, data: MapData, dark: boolean): void {
    if (map.getSource(SRC)) return
    installRingImages(map)
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
        id: LYR_DECLINING,
        type: 'symbol',
        source: SRC,
        filter: ['all', POINT_FILTER, ['==', ['get', 'declining'], 1]] as unknown as ExpressionSpec,
        layout: {
            'icon-image': ['concat', 'declining-ring-', ['get', 'letter']],
            'icon-size': ringSizeExpr(),
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
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

export function MapView({ facilities, lite, dark }: {
    facilities: RosterRow[]
    lite: boolean
    dark: boolean
}) {
    const container = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null)
    const followingRef = useRef(false)
    const styleDarkRef = useRef(dark)
    const [note, setNote] = useState<{ text: string; back: boolean } | null>(null)
    const [failed, setFailed] = useState(false)

    const data = useMemo(() => buildMapData(facilities, lite), [facilities, lite])
    const dataRef = useRef<MapData>(data)
    dataRef.current = data
    const darkRef = useRef(dark)
    darkRef.current = dark
    const facilitiesRef = useRef(facilities)
    facilitiesRef.current = facilities

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

        // The container may have been zero-sized at construction (embed,
        // flex not yet resolved) — re-fit once unless a location fix has
        // already claimed the camera.
        const settle = setTimeout(() => {
            map.resize()
            if (!followingRef.current) map.fitBounds(VA_BOUNDS, { ...VA_FIT, duration: 0 })
        }, 50)

        return () => {
            clearTimeout(settle)
            geolocateRef.current = null
            mapRef.current = null
            map.remove()
        }
    }, [])

    // Roster / filter / tier changes → new source data.
    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        const source = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
        source?.setData(data.geojson)
    }, [data])

    // Theme swap: setStyle tears everything down; style.load reinstalls.
    useEffect(() => {
        const map = mapRef.current
        if (!map || styleDarkRef.current === dark) return
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
