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
 *
 * The hook is SILENT about where the fix lands (2026-09-08, Cannon's call).
 * The note UI it used to raise is deleted — the card under the band, the
 * message for a fix outside the mapped area, the way back it offered, the
 * message for a fix the browser never returned, and the padded roster
 * bounding box the first of those was measured against. §14.1 of
 * architecture-v4.md names every piece. A fix in Ohio and a fix that never
 * arrives now read the same: the map holds its camera and says nothing.
 * The hook no longer sees the roster, so it takes no arguments — and with
 * the note went its only state, so nothing it does can re-render.
 *
 * The follow lock still matters to two callers: MapView's settle re-fit
 * must not steal a camera a fix has claimed, and a camera move the visitor
 * did not make with the control must drop the lock first — a zoom-changing
 * move does NOT drop it on its own.
 */

import { useRef } from 'react'
import type { RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'

export interface Geolocate {
    /** Create + attach the control. Once, from the mount effect, after the
     *  nav control (both sit bottom-right). Asks the browser for nothing. */
    install(map: maplibregl.Map): void
    /** The unsolicited auto-locate — the one call here that can raise the
     *  browser's location prompt. Once per mount; later calls are no-ops. */
    autoLocate(): void
    /** Drop the follow lock if held — before any camera move the visitor
     *  did not make with the control (a selection's camera, mapCamera.ts),
     *  or the next fix pulls the camera straight back. A no-op when not
     *  following. */
    release(): void
    /** Is the control following the visitor right now? */
    readonly following: RefObject<boolean>
    dispose(): void
}

export function useGeolocate(): Geolocate {
    const controlRef = useRef<maplibregl.GeolocateControl | null>(null)
    const followingRef = useRef(false)
    // Built once: MapView captures it in a one-shot mount effect, so its
    // identity must not move across renders.
    const api = useRef<Geolocate | null>(null)
    if (!api.current) {
        let asked = false // the auto-locate runs once per mount
        api.current = {
            following: followingRef,
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
                // No 'geolocate' / 'error' listeners by design: the hook is
                // silent both ways. Only the follow lock is tracked.
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
            dispose() {
                controlRef.current = null
            },
        }
    }
    return api.current
}
