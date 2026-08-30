/**
 * Theme state (CRVa-M0). Dark is the document default (C10); light flips
 * via `.theme-light` on <html> (app/theme.css). The stored choice is the
 * visitor's own — same key the old client used, so an existing preference
 * survives the rewrite. index.html applies it pre-paint; this module owns
 * it from then on.
 */

import { THEME_KEY } from './constants'

export function storedDark(storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
    try {
        return (storage.getItem(THEME_KEY) || 'dark') === 'dark'
    } catch {
        return true
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
 *  the class is the light variant's hook. */
export function applyThemeClass(dark: boolean, root: HTMLElement = document.documentElement): void {
    root.classList.toggle('theme-light', !dark)
}
