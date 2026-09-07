/**
 * The MapLibre island (CRVa-M0) — a direct instance in a ref'd container
 * (D-CR-MAP-1); React owns everything AROUND the canvas. Grown from the
 * CRF proof map into the real §6.2 marker grammar:
 *
 *   · grade-colored dots with a ring in every mode (zoom-scaled radius);
 *     the dots carried their grade letter past z13.5 until 2026-09-06,
 *     when Cannon retired the glyphs from the map (§6.0 amended: the
 *     letter still rides every place a grade is NAMED — hover card,
 *     panel, list, chips — but the dot is color + ring alone);
 *   · gray uniform = basic map, gray = unscored, dimmed gray = closed;
 *   · same-point stacks as NEUTRAL count bubbles; no proximity clusters BY
 *     DEFAULT — the CRD-M1 mockup rule, re-ratified 2026-08-30 after a live
 *     trial on the preview (revived in #174 at Cannon's ask, withdrawn on
 *     his review in the next pass; the CRF proof already drew all ~25k
 *     dots).
 *
 * Declining (CRP-M2, Cannon's pick 2026-09-05, replacing the CRP-M1 ↓
 * suffix): the dot's ring turns red (constants.ts DECLINE_RING) at every
 * zoom the dot is drawn — a paint expression on the one circle layer, no
 * extra layer, no images. Production's form, with the color moved off the
 * ramp so a declining F still reads.
 *
 * Proximity clusters as a VISITOR SWITCH (CRP-M6, 2026-09-05; the cutover
 * deletes the old client, so production's look survives as a choice):
 * production's source clustering is ALWAYS configured (#174's port) and
 * flipped in place by `setClusterOptions` — no teardown, no GeoJSON rebuild
 * (the cluster inputs ride every feature, mapData.ts). The bubble is
 * Cannon's DONUT: a symbol layer whose icon id encodes the per-grade sums a
 * cluster accumulated, painted on demand by the missing-image resolver
 * (donut.ts). Production's grammar otherwise: places-sized, under dots and
 * stacks, hover = cursor only, click = expansion zoom, dissolving at camera
 * zoom 13; an absorbed stack's popover closes on the way out.
 *
 * Decomposed at CRP-M3 (2026-09-05), zero behavior change: the layer set
 * lives in `mapLayers.ts` (pure — install + expressions, spec'd against a
 * recording host and cross-checked with mapHit's radii), the two popups
 * ride one `useMapPopup` controller each (the display-only hover card and
 * the interactive stack popover), and geolocate + the patient auto-locate
 * + the coverage note are `useGeolocate`. What stays here is the island
 * itself: the map's lifecycle, the pointer rules, and the four effects
 * that answer data / switch / theme changes.
 *
 * Ported from the old `map.js`: the dark-matter road-label contrast fix,
 * fadeDuration 0 (symbol counts must move with their bubbles), geolocate +
 * patient auto-locate, and the out-of-coverage note.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { X } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
    DONUT_PIXEL_RATIO, LYR_CLUSTERS, LYR_POINTS, LYR_STACKS, SRC,
    STYLE_DARK, STYLE_LIGHT, VA_BOUNDS, VA_FIT,
} from './constants'
import { paintDonut, parseDonutId } from './donut'
import { buildMapData } from './mapData'
import type { MapData } from './mapData'
import { hitSlop, markRadius, pickMark, popoverSurvivesZoom } from './mapHit'
import { HIT_LAYERS, fixDarkRoadLabels, installDataLayers } from './mapLayers'
import { useGeolocate } from './useGeolocate'
import { useMapPopup } from './useMapPopup'
import { HoverCard } from './HoverCard'
import { StackPopover } from './StackPopover'
import type { RosterRow } from './data/types'

export function MapView({ facilities, lite, dark, clusters, onSelect }: {
    facilities: RosterRow[]
    lite: boolean
    dark: boolean
    /** "Group nearby places" — production's proximity clusters (CRP-M6). */
    clusters: boolean
    /** A facility was clicked (a lone dot, or a stack member picked). */
    onSelect: (permitId: string) => void
}) {
    const container = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const styleDarkRef = useRef(dark)
    const clustersRef = useRef(clusters)
    const [failed, setFailed] = useState(false)

    const data = useMemo(() => buildMapData(facilities, lite), [facilities, lite])
    const dataRef = useRef<MapData>(data)
    dataRef.current = data
    const darkRef = useRef(dark)
    darkRef.current = dark
    const facilitiesRef = useRef<readonly RosterRow[]>(facilities)
    facilitiesRef.current = facilities
    const byPid = useMemo(
        () => new Map(facilities.map((f) => [String(f.permit_id), f])),
        [facilities],
    )
    const byPidRef = useRef(byPid)
    byPidRef.current = byPid
    const liteRef = useRef(lite)
    liteRef.current = lite
    const onSelectRef = useRef(onSelect)
    onSelectRef.current = onSelect

    // The marker-bound hover card (M1): display-only and mouse-transparent
    // (theme.css .cp-tip); its key guard keeps the same facility from
    // re-rendering per mousemove. The full-tier card carries the panel's
    // trend instrument (the old client's 380 hero width); the content divs
    // stay narrower where they want to.
    const hover = useMapPopup({ className: 'cp-tip', offset: 14, maxWidth: '380px' })
    // The stack member popover (M2): its own INTERACTIVE popup.
    const stack = useMapPopup({ className: 'cp-pop', offset: 16, maxWidth: '288px' })
    // "Find me" + follow + the patient auto-locate + the coverage note.
    const geolocate = useGeolocate(facilitiesRef)

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

        // The donut images (CRP-M6): painted the first time the style asks
        // for an id, on the CURRENT style — setStyle drops every image and
        // the resolver simply regenerates them (the theme is in the id).
        // MapLibre awaits the resolver before painting, so the icon lands
        // in the frame that asked for it. The `styleimagemissing` EVENT can
        // no longer satisfy the request that fired it (6.6.0); this is the
        // path. Asked about EVERY missing image, the basemap's included —
        // parseDonutId answers null for those.
        map.setMissingStyleImageResolver((id) => {
            const spec = parseDonutId(id)
            if (!spec || map.hasImage(id)) return
            const image = paintDonut(spec)
            if (image) map.addImage(id, image, { pixelRatio: DONUT_PIXEL_RATIO })
        })

        // Bottom-right: the floating band owns the top-left corner, and the
        // right sheet (M2) opens above these on the z axis, not over them.
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
        geolocate.install(map)

        // Fires on the initial style AND after every setStyle (theme swap) —
        // custom sources/layers/images don't survive a swap.
        map.on('style.load', () => {
            installDataLayers(map, dataRef.current, styleDarkRef.current, clustersRef.current)
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
                features = map.queryRenderedFeatures(box, { layers: [...HIT_LAYERS] })
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

        // ── the stack member popover (M2) ──────────────────────────────
        const openStack = (skey: string, lngLat: [number, number]) => {
            const members = dataRef.current.stacks.get(skey)
            if (!members || members.length < 2) return
            stack.key.current = skey
            hover.hide()
            stack.show(map, lngLat, (
                <StackPopover
                    members={members}
                    lite={liteRef.current}
                    onPick={(pid) => {
                        stack.hide()
                        onSelectRef.current(pid)
                    }}
                />
            ))
        }

        /** Cluster click → zoom to the level where it breaks apart
         *  (getClusterExpansionZoom is Promise-based in MapLibre). */
        const zoomToCluster = async (feature: maplibregl.MapGeoJSONFeature) => {
            const source = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
            if (!source) return
            try {
                const clusterId = Number(
                    (feature.properties as { cluster_id?: unknown }).cluster_id)
                const zoom = await source.getClusterExpansionZoom(clusterId)
                const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates
                map.easeTo({ center: [lon as number, lat as number], zoom: zoom + 0.5 })
            } catch { /* cluster dissolved mid-click */ }
        }

        /** Click: open a stack's member list, select a place, or break a
         *  cluster apart. Anything that is not the open stack closes its
         *  popover — empty ground included (the old web's dismissal rule). */
        map.on('click', (e) => {
            const hit = pickMarkAt(e.point)
            if (!hit) {
                stack.hide()
                return
            }
            const coords = (hit.candidate.feature.geometry as GeoJSON.Point)
                .coordinates as [number, number]
            const props = hit.candidate.feature.properties as { pid?: string; skey?: string }
            if (hit.layerId === LYR_CLUSTERS) {
                // A cluster is a camera control, not a place.
                stack.hide()
                hover.hide()
                void zoomToCluster(hit.candidate.feature)
                return
            }
            if (hit.layerId === LYR_STACKS) {
                const skey = String(props.skey)
                if (stack.key.current === skey) {
                    stack.hide() // clicking the open stack again dismisses it
                    return
                }
                openStack(skey, [...coords])
                return
            }
            stack.hide()
            if (props.pid && byPidRef.current.has(String(props.pid))) {
                hover.hide() // the panel takes over
                onSelectRef.current(String(props.pid))
            }
        })

        const onStackKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && stack.key.current) stack.hide()
        }
        document.addEventListener('keydown', onStackKey)

        // An open popover's stack may be swallowed by a proximity cluster
        // on the way OUT (clusters on, camera falling into the clustered
        // band) — dismiss it then, and only then: a bare "in the band" test
        // fires on the way IN too, the opening ease included (mapHit.ts
        // popoverSurvivesZoom; production's #157/#158). The hover card
        // needs nothing here — mousemove re-resolves every frame and a
        // cluster hit hides it.
        let lastZoom = map.getZoom()
        map.on('zoom', () => {
            const zoom = map.getZoom()
            if (clustersRef.current && stack.key.current
                && !popoverSurvivesZoom(lastZoom, zoom)) stack.hide()
            lastZoom = zoom
        })

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
                    hover.hide()
                    return
                }
                map.getCanvas().style.cursor = 'pointer'
                if (hit.layerId === LYR_CLUSTERS) {
                    // A cluster is a camera control, not a place: cursor only.
                    hover.hide()
                    return
                }
                const coords = (hit.candidate.feature.geometry as GeoJSON.Point)
                    .coordinates as [number, number]
                const props = hit.candidate.feature.properties as { pid?: string; skey?: string; stack?: number }
                if (hit.layerId === LYR_STACKS) {
                    // A stack is a container, not a place: a line saying
                    // what it holds — never the facility card, which would
                    // have to pick one of the permits to be about.
                    const key = `stack:${props.skey}`
                    if (hover.key.current === key) return
                    hover.key.current = key
                    hover.show(map, [...coords], (
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
                if (hover.key.current === String(props.pid)) return
                hover.key.current = String(props.pid)
                // Anchored to the MARKER, never the pointer: the card
                // points at the thing it is about.
                hover.show(map, [...coords], <HoverCard f={f} lite={liteRef.current} />)
            })
            // Leaving the canvas is not a mousemove, so the card would hang.
            map.on('mouseout', () => {
                map.getCanvas().style.cursor = ''
                hover.hide()
            })
        }

        // The container may have been zero-sized at construction (embed,
        // flex not yet resolved) — re-fit once unless a location fix has
        // already claimed the camera.
        const settle = setTimeout(() => {
            try {
                map.resize()
                if (!geolocate.following.current) map.fitBounds(VA_BOUNDS, { ...VA_FIT, duration: 0 })
            } catch {
                // A map that survived construction but never finished
                // starting (jsdom under Vitest: no WebGL, so no painter)
                // throws from resize(). Nothing to settle on it.
            }
        }, 50)

        return () => {
            clearTimeout(settle)
            document.removeEventListener('keydown', onStackKey)
            hover.dispose()
            stack.dispose()
            geolocate.dispose()
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
        hover.hide()
        stack.hide()
        const source = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
        source?.setData(data.geojson)
    }, [data])

    // The switch (CRP-M6): flip clustering on the live source in place —
    // one worker re-index over the data it already holds, no source/layer
    // teardown, no GeoJSON rebuild (pending updates serialize behind the
    // source's own in-flight guard, so a flip right after a filter's
    // setData cannot race it). Before the source exists (first mount) only
    // the ref moves; style.load installs with it. An open popover's stack
    // may be about to be absorbed — close it, and the hover with it.
    useEffect(() => {
        clustersRef.current = clusters
        const map = mapRef.current
        const source = map?.getSource(SRC) as maplibregl.GeoJSONSource | undefined
        if (!source || source.getClusterOptions().cluster === clusters) return
        hover.hide()
        stack.hide()
        void source.setClusterOptions({ cluster: clusters })
    }, [clusters])

    // Theme swap: setStyle tears everything down; style.load reinstalls.
    useEffect(() => {
        const map = mapRef.current
        if (!map || styleDarkRef.current === dark) return
        hover.hide()
        stack.hide()
        styleDarkRef.current = dark
        map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT)
    }, [dark])

    const note = geolocate.note
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
                            onClick={() => geolocate.backToVirginia(mapRef.current)}
                        >
                            Back to Virginia
                        </button>
                    )}
                    <button
                        type="button"
                        className="shrink-0 text-cp-ink-3"
                        aria-label="Dismiss"
                        onClick={() => geolocate.dismissNote()}
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    )
}
