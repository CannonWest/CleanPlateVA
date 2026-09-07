/**
 * The settings dialog's own state (2026-09-06, Cannon's call) — the two
 * preferences that are not the theme's or the cluster switch's: the TEXT
 * SIZE, and whether the dialog has introduced itself. Presentation choices
 * like the theme (theme.ts) and clustering (clusters.ts): remembered per
 * visitor, never carried by the URL (C6 — a shared link says what you look
 * at, not how it is drawn).
 *
 * Text size is the body size in CSS px. 14 is the size the design was
 * ratified at (theme.css `body`), so 14 is scale 1 and every other size is
 * a ratio of it: the app's text utilities (`text-cp-<px>`, theme.css) and
 * the body multiply their ratified px by `--cp-text-scale` on <html>. The
 * map's canvas labels and the trend instrument's SVG are drawings with
 * their own geometry and do not follow it. index.html applies the stored
 * size pre-paint by the same rule; this module owns it from then on.
 */

import { SETTINGS_SEEN_KEY, TEXT_SIZE_KEY } from './constants'

/** The ratified body size — scale 1. */
export const TEXT_SIZE_DEFAULT = 14
export const TEXT_SIZE_MIN = 12
export const TEXT_SIZE_MAX = 20
export const TEXT_SIZE_STEP = 1

export const TEXT_SCALE_PROPERTY = '--cp-text-scale'

/** A stored value is honored when it is an integer within the slider's
 *  range; anything else (unset, garbage, out of range) is the default. The
 *  pre-paint script in index.html applies the same test. */
export function validTextSize(raw: string | null): number | null {
    if (raw === null) return null
    const size = Number(raw)
    return Number.isInteger(size) && size >= TEXT_SIZE_MIN && size <= TEXT_SIZE_MAX ? size : null
}

export function storedTextSize(storage: Pick<Storage, 'getItem'> = window.localStorage): number {
    try {
        return validTextSize(storage.getItem(TEXT_SIZE_KEY)) ?? TEXT_SIZE_DEFAULT
    } catch {
        return TEXT_SIZE_DEFAULT
    }
}

export function persistTextSize(size: number, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
    try {
        storage.setItem(TEXT_SIZE_KEY, String(size))
    } catch {
        /* private mode */
    }
}

export function textScale(size: number): number {
    return size / TEXT_SIZE_DEFAULT
}

/** Reflect the size on <html> as the scale the stylesheet multiplies by.
 *  The default clears the property, leaving the stylesheet's own 1. */
export function applyTextSize(size: number, root: HTMLElement = document.documentElement): void {
    if (size === TEXT_SIZE_DEFAULT) root.style.removeProperty(TEXT_SCALE_PROPERTY)
    else root.style.setProperty(TEXT_SCALE_PROPERTY, String(textScale(size)))
}

/** Whether the dialog has opened on its own once (it does so on a
 *  visitor's first map view, after the acknowledgement). */
export function storedSettingsSeen(storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
    try {
        return storage.getItem(SETTINGS_SEEN_KEY) === '1'
    } catch {
        return false
    }
}

export function persistSettingsSeen(storage: Pick<Storage, 'setItem'> = window.localStorage): void {
    try {
        storage.setItem(SETTINGS_SEEN_KEY, '1')
    } catch {
        /* private mode */
    }
}
