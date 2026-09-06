// @vitest-environment jsdom
/**
 * The theme preference — clusters.ts's twin: LIGHT when unset (the visitor
 * default since 2026-09-06, Cannon's call; dark was the default from
 * CRVa-M0 until then), a 'dark' / 'light' round trip under the old
 * client's key (an existing choice survives the flip), a throwing storage
 * (private mode) that reads as the default rather than an error, the
 * class that carries the choice on <html> — and index.html's pre-paint
 * script, run here against the same storage, so the two entry points can
 * never disagree about the default.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { applyThemeClass, persistTheme, storedDark } from '../../app/theme'
import { THEME_KEY } from '../../app/constants'

function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value) },
        map,
    }
}

test('unset reads as LIGHT — the visitor default; only a stored dark is dark', () => {
    expect(storedDark(memoryStorage())).toBe(false)
    expect(storedDark(memoryStorage({ [THEME_KEY]: 'light' }))).toBe(false)
    expect(storedDark(memoryStorage({ [THEME_KEY]: 'night' }))).toBe(false) // only 'dark' is dark
    expect(storedDark(memoryStorage({ [THEME_KEY]: 'dark' }))).toBe(true)
})

test('the choice round-trips as dark / light under the old client\'s key', () => {
    const storage = memoryStorage()
    persistTheme(true, storage)
    expect(storage.map.get(THEME_KEY)).toBe('dark')
    expect(storedDark(storage)).toBe(true)
    persistTheme(false, storage)
    expect(storage.map.get(THEME_KEY)).toBe('light')
    expect(storedDark(storage)).toBe(false)
    expect(THEME_KEY).toBe('cleanplateva.theme')
})

test('a throwing storage is the default, not an error (private mode)', () => {
    const throwing = {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
    }
    expect(storedDark(throwing)).toBe(false)
    expect(() => persistTheme(true, throwing)).not.toThrow()
})

test('the class on <html> is the LIGHT hook over the dark CSS base', () => {
    const root = document.createElement('div')
    applyThemeClass(false, root)
    expect(root.classList.contains('theme-light')).toBe(true)
    applyThemeClass(true, root)
    expect(root.classList.contains('theme-light')).toBe(false)
})

test('index.html applies the same rule before first paint: the class ON unless the visitor chose dark', () => {
    const html = readFileSync(resolve(import.meta.dirname, '..', '..', 'index.html'), 'utf8')
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    const run = new Function(script as string)
    const root = document.documentElement
    const cases: Array<[string | null, boolean]> = [[null, true], ['light', true], ['dark', false], ['night', true]]
    for (const [stored, light] of cases) {
        window.localStorage.clear()
        if (stored !== null) window.localStorage.setItem(THEME_KEY, stored)
        root.classList.remove('theme-light')
        run()
        expect(root.classList.contains('theme-light'), `stored=${String(stored)}`).toBe(light)
        // The pre-paint rule and the module's rule are ONE rule.
        expect(storedDark(window.localStorage)).toBe(!light)
    }
    window.localStorage.clear()
    root.classList.remove('theme-light')
})
