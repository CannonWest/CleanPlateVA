/**
 * The grade-palette preference (2026-09-06, a design request) — theme.ts's twin
 * for the color-blind friendly ramp. `standard` is the ratified green → red
 * ramp; `colorblind` the blue → gold → orange → umber one (constants.ts
 * GRADE_PALETTES). The DOM follows a class on <html> that re-points the
 * --cp-grade-* tokens (theme.css .palette-colorblind), so every chip, badge
 * and hero circle flips with no plumbing; the map's paint and the donut
 * canvas take the same hex from the table by name (MapView, donut.ts).
 * Persisted per visitor, never in the URL (C6). index.html applies the
 * class pre-paint by the same rule; this module owns it from then on.
 */

import { PALETTE_CLASS, PALETTE_KEY } from './constants'
import type { GradePalette } from './constants'

export const PALETTES: readonly GradePalette[] = ['standard', 'colorblind']

export const PALETTE_DEFAULT: GradePalette = 'standard'

/** The stored choice — 'standard' when unset, when the value is not the one
 *  other word, or when storage throws (private mode). */
export function storedPalette(storage: Pick<Storage, 'getItem'> = window.localStorage): GradePalette {
    try {
        return storage.getItem(PALETTE_KEY) === 'colorblind' ? 'colorblind' : PALETTE_DEFAULT
    } catch {
        return PALETTE_DEFAULT
    }
}

export function persistPalette(palette: GradePalette, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
    try {
        storage.setItem(PALETTE_KEY, palette)
    } catch {
        /* private mode */
    }
}

/** Reflect the choice on <html>: the class is the color-blind ramp's hook;
 *  the un-prefixed tokens are the standard ramp. */
export function applyPaletteClass(palette: GradePalette, root: HTMLElement = document.documentElement): void {
    root.classList.toggle(PALETTE_CLASS, palette === 'colorblind')
}
