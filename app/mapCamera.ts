/**
 * Where the camera goes for a selection the map did not make itself — a
 * shared link, a List row, Back/Forward (2026-09-07). C6 says a link "says
 * what you look at", and until now a `?permit=` link opened the panel over
 * whatever the camera happened to hold: on a cold load the whole state,
 * 27k dots and no way to tell which one. The rule, pure and pinned:
 *
 *   · a selection the MAP made — a dot clicked, a stack member picked —
 *     never moves the camera: the visitor is looking at the place already,
 *     and a lurch under the click is the one thing this must not do
 *     (MapView remembers its own picks and never asks here for them);
 *   · otherwise the place is brought into view at neighborhood radius —
 *     SELECT_ZOOM, the geolocate landing's camera zoom 13 on CARTO's 512px
 *     tiles — unless it is ALREADY in view at that radius or closer, in
 *     which case the camera stays. A place in view but too far out to tell
 *     apart (the state view) is brought in; a place off-screen at a closer
 *     zoom is eased to at the zoom the visitor chose.
 *
 * A deep link also stands the auto-locate down (App: `arrivedAtPlace`):
 * the visitor came for a PLACE, and a fix flying the camera to their own
 * location would take it away again.
 */

/** Neighborhood radius — where geolocate lands too (useGeolocate). */
export const SELECT_ZOOM = 13

export interface CameraMove {
    center: [number, number]
    zoom: number
}

/** The camera move for a selection at `point` (lon, lat), given whether the
 *  point is inside the current viewport and the current zoom; null = stay. */
export function selectionCamera(point: [number, number], inView: boolean, zoom: number): CameraMove | null {
    if (inView && zoom >= SELECT_ZOOM) return null
    return { center: point, zoom: Math.max(zoom, SELECT_ZOOM) }
}
