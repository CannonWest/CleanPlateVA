/**
 * The clustering preference (CRP-M6) — the twin of theme.ts. "Group nearby
 * places" is a PRESENTATION choice, remembered per visitor like the theme
 * and never carried by the URL: a shared link says what you look at, not
 * how it is drawn (C6), so this lives beside the theme and outside the
 * router's AppState. Off is the shipped default (Cannon's call,
 * 2026-09-05): a first-time visitor sees the twice-ratified no-clusters
 * design, and the switch is the way to production's bubbles. The CannonAI
 * Food-tab embed remembers its own choice per origin, exactly as it does
 * the theme.
 */

import { CLUSTERS_KEY } from './constants'

/** The stored choice — false when unset, or when storage throws (private
 *  mode): the shipped default stands. */
export function storedClusters(storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
    try {
        return storage.getItem(CLUSTERS_KEY) === '1'
    } catch {
        return false
    }
}

export function persistClusters(on: boolean, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
    try {
        storage.setItem(CLUSTERS_KEY, on ? '1' : '0')
    } catch {
        /* private mode */
    }
}
