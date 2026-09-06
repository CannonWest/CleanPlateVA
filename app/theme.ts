/**
 * Theme state (CRVa-M0). LIGHT is the visitor default (Cannon's call
 * 2026-09-06; dark was the default from CRVa-M0 until then — C10 amended).
 * The CSS base did not move: the un-prefixed styles are still the dark
 * design (D-CR-STYLE-1) and `.theme-light` on <html> is the light
 * variant's hook (app/theme.css) — so "light by default" means the class
 * is ON unless the visitor chose dark. The stored choice is the visitor's
 * own, under the key the old client used, so an existing preference
 * survives: a visitor who chose either theme keeps it; one who never
 * touched the switch gets the new default. index.html applies it
 * pre-paint; this module owns it from then on.
 */

import { THEME_KEY } from './constants'

export function storedDark(storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
    try {
        return storage.getItem(THEME_KEY) === 'dark'
    } catch {
        return false
    }
}

export function persistTheme(dark: boolean, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
    try {
        storage.setItem(THEME_KEY, dark ? 'dark' : 'light')
    } catch {
        /* private mode */
    }
}

/** Reflect the choice on <html> — un-prefixed styles ARE the dark design;
 *  the class is the light variant's hook (on for the default). */
export function applyThemeClass(dark: boolean, root: HTMLElement = document.documentElement): void {
    root.classList.toggle('theme-light', !dark)
}
