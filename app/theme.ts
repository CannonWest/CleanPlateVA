/**
 * Theme state — a THREE-way preference since 2026-09-06 (Cannon's call,
 * with the settings dialog): 'light', 'dark', or 'system', where 'system'
 * follows the device's `prefers-color-scheme` and is the visitor DEFAULT.
 * Light was the default from earlier that day (C10 amended) and dark from
 * CRVa-M0 until then; a visitor who chose either keeps it — the stored
 * values are the same two words under the same key the old client used —
 * and one who never chose gets the device's own appearance.
 *
 * The CSS base did not move: the un-prefixed styles are still the dark
 * design (D-CR-STYLE-1) and `.theme-light` on <html> is the light variant's
 * hook (app/theme.css) — so the class goes on whenever the RESOLVED theme
 * is light. index.html applies the same rule pre-paint; this module owns it
 * from then on, and App re-resolves 'system' when the device's setting
 * changes (a `change` on the media query).
 */

import { THEME_KEY } from './constants'

export type ThemeChoice = 'light' | 'dark' | 'system'

export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system']

/** The visitor default: the device's appearance. */
export const THEME_DEFAULT: ThemeChoice = 'system'

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

/** The stored choice — 'system' when unset, when the value is not one of the
 *  two explicit words, or when storage throws (private mode). */
export function storedTheme(storage: Pick<Storage, 'getItem'> = window.localStorage): ThemeChoice {
    try {
        const raw = storage.getItem(THEME_KEY)
        return raw === 'dark' || raw === 'light' ? raw : THEME_DEFAULT
    } catch {
        return THEME_DEFAULT
    }
}

export function persistTheme(choice: ThemeChoice, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
    try {
        storage.setItem(THEME_KEY, choice)
    } catch {
        /* private mode */
    }
}

/** Whether the device asks for dark. False wherever `matchMedia` is missing
 *  (jsdom, an old engine) — the site then resolves 'system' as light. */
export function systemPrefersDark(win: Pick<Window, 'matchMedia'> = window): boolean {
    try {
        return typeof win.matchMedia === 'function' && win.matchMedia(DARK_SCHEME_QUERY).matches
    } catch {
        return false
    }
}

/** The one rule: dark when chosen, or when 'system' and the device is dark. */
export function resolveDark(choice: ThemeChoice, systemDark: boolean): boolean {
    return choice === 'dark' || (choice === 'system' && systemDark)
}

/** Reflect the RESOLVED theme on <html> — un-prefixed styles ARE the dark
 *  design; the class is the light variant's hook. */
export function applyThemeClass(dark: boolean, root: HTMLElement = document.documentElement): void {
    root.classList.toggle('theme-light', !dark)
}
