/**
 * "Find me" + follow, and the patient auto-locate (CRP-M3 — lifted out of
 * MapView.tsx with zero behavior change; ported originally from the old
 * client's map.js).
 *
 *   · The control: high accuracy, a 6 s timeout so a MANUAL press stays
 *     snappy, maximumAge 15 s so it can reuse the fix auto-locate acquired,
 *     trackUserLocation, landing at neighborhood radius (maxZoom 13 on
 *     CARTO's 512px tiles). Bottom-right, beside the nav control. Installing
 *     it asks the browser for NOTHING — a permission prompt is the
 *     auto-locate's to raise, and only when the page says so.
 *   · Auto-locate (`autoLocate`, its own call since 2026-09-07 — it fired
 *     from `install` before, i.e. on mount, which for a first-time visitor
 *     is UNDER the terms dialog: two consent asks at once, one unasked-for,
 *     and Chrome's permission embargo counts the dismissals): unsolicited
 *     and best-effort — its OWN request with a patient 20 s timeout (the
 *     permission prompt's decision time counts against it), silent on every
 *     failure; on success the control takes over, `trigger()` retried
 *     briefly until the control is ready. Once per mount: a second call is
 *     a no-op. MapView releases it the first time the page is ready
 *     (`locateReady`: the acknowledgement answered, or never asked).
 *   · The coverage note: a fix outside the padded bounding box of the loaded
 *     facilities says so and offers "Back to Virginia"; a failed fix says
 *     to check location access. Both dismissible.
 *
 * The follow lock matters to two callers: MapView's settle re-fit must not
 * steal a camera a fix has claimed, and "Back to Virginia" must drop the
 * lock first — a zoom-changing move does NOT drop it on its own.
 */

import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import { VA_BOUNDS, VA_FIT } from './constants'
import { coordsOf } from './data/presentation'
import type { RosterRow } from './data/types'

export interface CoverageNote {
    text: string
    /** Offer "Back to Virginia" (a fix outside the mapped area). */
    back: boolean
}

export const OUTSIDE_COVERAGE_NOTE = "This map only covers Virginia, and you're outside it."
export const LOCATION_FAILED_NOTE =
    "We couldn't find your location. Check that location access is on for your browser."

/** ~20 km of slack around the mapped area — near-edge users still see markers. */
export const COVERAGE_PAD = 0.2

export interface CoverageBounds { n: number; s: number; e: number; w: number }

/** Bounding box of the located facilities — "the mapped area". Null when
 *  nothing is located yet. */
export function coverageBounds(rows: readonly RosterRow[]): CoverageBounds | null {
    let n = -90, s = 90, e = -180, w = 180
    for (const f of rows) {
        const c = coordsOf(f)
        if (c.lat == null || c.lon == null) continue
        n = Math.max(n, c.lat); s = Math.min(s, c.lat)
        e = Math.max(e, c.lon); w = Math.min(w, c.lon)
    }
    return n < s ? null : { n, s, e, w }
}

/** Is the fix inside the padded mapped area? Nothing located yet → say
 *  nothing (true). */
export function withinCoverage(rows: readonly RosterRow[], lat: number, lon: number): boolean {
    const b = coverageBounds(rows)
    if (!b) return true
    return lat <= b.n + COVERAGE_PAD && lat >= b.s - COVERAGE_PAD
        && lon <= b.e + COVERAGE_PAD && lon >= b.w - COVERAGE_PAD
}

export interface Geolocate {
    /** The coverage / failure note to show, if any. */
    note: CoverageNote | null
    dismissNote(): void
    /** Create + attach the control. Once, from the mount effect, after the
     *  nav control (both sit bottom-right). Asks the browser for nothing. */
    install(map: maplibregl.Map): void
    /** The unsolicited auto-locate — the one call here that can raise the
     *  browser's location prompt. Once per mount; later calls are no-ops. */
    autoLocate(): void
    /** Drop the follow lock if held — before any camera move the visitor
     *  did not make with the control (Back to Virginia; a selection's
     *  camera, mapCamera.ts), or the next fix pulls the camera straight
     *  back. A no-op when not following. */
    release(): void
    /** "Back to Virginia": drop the follow lock if held, fit the state,
     *  clear the note. */
    backToVirginia(map: maplibregl.Map | null): void
    /** Is the control following the visitor right now? */
    readonly following: RefObject<boolean>
    dispose(): void
}

export function useGeolocate(facilitiesRef: RefObject<readonly RosterRow[]>): Geolocate {
    const [note, setNote] = useState<CoverageNote | null>(null)
    const controlRef = useRef<maplibregl.GeolocateControl | null>(null)
    const followingRef = useRef(false)
    // The imperative half is built once: MapView captures it in a one-shot
    // mount effect, so its identity must not move across renders.
    const api = useRef<Omit<Geolocate, 'note'> | null>(null)
    if (!api.current) {
        let asked = false // the auto-locate runs once per mount
        api.current = {
            following: followingRef,
            dismissNote: () => setNote(null),
            install(map) {
                // "Find me" + follow. The 6s timeout keeps a MANUAL press
                // snappy; maximumAge lets the control reuse the fix
                // auto-locate acquired.
                const geolocate = new maplibregl.GeolocateControl({
                    positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 },
                    trackUserLocation: true,
                    // Land at neighborhood radius on CARTO's 512px tiles.
                    fitBoundsOptions: { maxZoom: 13 },
                })
                controlRef.current = geolocate
                geolocate.on('geolocate', (pos) => {
                    const { latitude, longitude } = pos.coords
                    if (withinCoverage(facilitiesRef.current ?? [], latitude, longitude)) setNote(null)
                    else setNote({ text: OUTSIDE_COVERAGE_NOTE, back: true })
                })
                geolocate.on('error', () => setNote({ text: LOCATION_FAILED_NOTE, back: false }))
                geolocate.on('trackuserlocationstart', () => { followingRef.current = true })
                geolocate.on('userlocationfocus', () => { followingRef.current = true })
                geolocate.on('trackuserlocationend', () => { followingRef.current = false })
                geolocate.on('userlocationlostfocus', () => { followingRef.current = false })
                map.addControl(geolocate, 'bottom-right')
            },
            autoLocate() {
                if (asked) return
                asked = true
                // Unsolicited and best-effort — its own PATIENT request (the
                // permission prompt's decision time counts against the
                // timeout), silent on every failure; on success the control
                // takes over.
                void (async () => {
                    try {
                        const perm = await navigator.permissions.query({ name: 'geolocation' })
                        if (perm.state === 'denied') return
                    } catch { /* no Permissions API — the request below finds out */ }
                    navigator.geolocation?.getCurrentPosition(
                        () => {
                            const kick = (attemptsLeft: number) => {
                                if (controlRef.current?.trigger() || attemptsLeft <= 0) return
                                setTimeout(() => kick(attemptsLeft - 1), 200)
                            }
                            kick(10)
                        },
                        () => { /* silent: nobody asked, and the map shows the state */ },
                        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
                    )
                })()
            },
            release() {
                // A zoom-changing move does NOT drop the control's follow
                // lock — switch it off first.
                if (followingRef.current) controlRef.current?.trigger()
            },
            backToVirginia(map) {
                api.current?.release()
                map?.fitBounds(VA_BOUNDS, VA_FIT)
                setNote(null)
            },
            dispose() {
                controlRef.current = null
            },
        }
    }
    return { note, ...api.current }
}
