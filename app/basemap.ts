/**
 * The basemap preference (2026-09-07) — the third twin of theme.ts, beside
 * clusters.ts and palette.ts. "Aerial" is a PRESENTATION choice, remembered
 * per visitor and never carried by the URL: a shared link says what you
 * look at, not how it is drawn (C6), so this lives outside the router's
 * AppState with the theme and the grade palette.
 *
 * `map` — the CARTO style the theme picks — is the shipped default and what
 * a first-time visitor sees; `aerial` lays the Commonwealth's own VBMP
 * orthoimagery under that style's labels (mapLayers installBasemap). The
 * the embedding host Food-tab embed remembers its own choice per origin, exactly as
 * it does the theme.
 *
 * Unknown stored values read as `map`, so a key written by a later version
 * (a third basemap) degrades to the default rather than to a blank canvas.
 */

import { BASEMAP_KEY } from './constants'

export type Basemap = 'map' | 'aerial'

export const BASEMAPS: readonly Basemap[] = ['map', 'aerial']

/** The public words for each choice — the control's labels, and the one
 *  place they are written (C8: "aerial photography", not "satellite" — the
 *  VBMP flies aircraft, and the word should be true). */
export const BASEMAP_LABELS: Record<Basemap, string> = {
    map: 'Map',
    aerial: 'Aerial',
}

export function isBasemap(value: unknown): value is Basemap {
    return value === 'map' || value === 'aerial'
}

/** The stored choice — `map` when unset, unrecognized, or when storage
 *  throws (private mode): the shipped default stands. */
export function storedBasemap(storage: Pick<Storage, 'getItem'> = window.localStorage): Basemap {
    try {
        const value = storage.getItem(BASEMAP_KEY)
        return isBasemap(value) ? value : 'map'
    } catch {
        return 'map'
    }
}

export function persistBasemap(
    basemap: Basemap, storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
    try {
        storage.setItem(BASEMAP_KEY, basemap)
    } catch {
        /* private mode */
    }
}
