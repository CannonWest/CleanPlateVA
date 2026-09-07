// @vitest-environment jsdom
/**
 * The theme preference — THREE-way since 2026-09-06 (Cannon's call, with
 * the settings dialog): SYSTEM when unset — the device's own appearance is
 * the visitor default (light was, earlier that day; dark from CRVa-M0
 * until then) — the two explicit words round-tripping under the old
 * client's key so an earlier choice survives, a throwing storage (private
 * mode) that reads as the default rather than an error, the one rule that
 * resolves a choice against the device, the class that carries the RESOLVED
 * theme on <html> — and index.html's pre-paint script, run here against the
 * same storage and the same media query, so the two entry points can never
 * disagree about what a visitor first sees.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
    applyThemeClass, DARK_SCHEME_QUERY, persistTheme, resolveDark, storedTheme, systemPrefersDark,
    THEME_CHOICES, THEME_DEFAULT,
} from '../../app/theme'
import type { ThemeChoice } from '../../app/theme'
import { THEME_KEY } from '../../app/constants'

function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value) },
        map,
    }
}

/** jsdom has no matchMedia; install one that answers the dark query. */
function deviceDark(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string) => ({ matches: query === DARK_SCHEME_QUERY && matches }),
    })
}

afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    window.localStorage.clear()
    document.documentElement.classList.remove('theme-light')
})

test('unset reads as SYSTEM — the visitor default; only the two explicit words are themselves', () => {
    expect(THEME_DEFAULT).toBe('system')
    expect(THEME_CHOICES).toEqual(['light', 'dark', 'system'])
    expect(storedTheme(memoryStorage())).toBe('system')
    expect(storedTheme(memoryStorage({ [THEME_KEY]: 'system' }))).toBe('system')
    expect(storedTheme(memoryStorage({ [THEME_KEY]: 'night' }))).toBe('system') // only the words count
    expect(storedTheme(memoryStorage({ [THEME_KEY]: 'dark' }))).toBe('dark')
    expect(storedTheme(memoryStorage({ [THEME_KEY]: 'light' }))).toBe('light')
})

test('the choice round-trips under the old client\'s key, so an earlier dark / light survives', () => {
    const storage = memoryStorage()
    for (const choice of THEME_CHOICES) {
        persistTheme(choice, storage)
        expect(storage.map.get(THEME_KEY)).toBe(choice)
        expect(storedTheme(storage)).toBe(choice)
    }
    expect(THEME_KEY).toBe('cleanplateva.theme')
})

test('a throwing storage is the default, not an error (private mode)', () => {
    const throwing = {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
    }
    expect(storedTheme(throwing)).toBe('system')
    expect(() => persistTheme('dark', throwing)).not.toThrow()
})

test('the one rule: dark when chosen, light when chosen, the device\'s own under system', () => {
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('dark', true)).toBe(true)
    expect(resolveDark('light', false)).toBe(false)
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('system', false)).toBe(false)
    expect(resolveDark('system', true)).toBe(true)
})

test('the device is asked through the dark query; no matchMedia, or a throwing one, reads as light', () => {
    expect(DARK_SCHEME_QUERY).toBe('(prefers-color-scheme: dark)')
    const asked: string[] = []
    const win = {
        matchMedia: (query: string) => {
            asked.push(query)
            return { matches: true } as MediaQueryList
        },
    }
    expect(systemPrefersDark(win)).toBe(true)
    expect(asked).toEqual([DARK_SCHEME_QUERY])
    expect(systemPrefersDark({ matchMedia: undefined as unknown as Window['matchMedia'] })).toBe(false)
    expect(systemPrefersDark({ matchMedia: () => { throw new Error('denied') } })).toBe(false)
    // jsdom's own window: no matchMedia at all.
    expect(systemPrefersDark(window)).toBe(false)
})

test('the class on <html> is the LIGHT hook over the dark CSS base', () => {
    const root = document.createElement('div')
    applyThemeClass(false, root)
    expect(root.classList.contains('theme-light')).toBe(true)
    applyThemeClass(true, root)
    expect(root.classList.contains('theme-light')).toBe(false)
})

test('index.html applies the same rule before first paint: the class ON whenever the resolved theme is light', () => {
    const html = readFileSync(resolve(import.meta.dirname, '..', '..', 'index.html'), 'utf8')
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    const run = new Function(script as string)
    const root = document.documentElement
    // [stored value, the device asks for dark, the page paints light]
    const cases: Array<[string | null, boolean, boolean]> = [
        [null, false, true], [null, true, false],
        ['system', false, true], ['system', true, false],
        ['night', false, true], ['night', true, false],
        ['light', false, true], ['light', true, true],
        ['dark', false, false], ['dark', true, false],
    ]
    for (const [stored, dark, light] of cases) {
        window.localStorage.clear()
        if (stored !== null) window.localStorage.setItem(THEME_KEY, stored)
        deviceDark(dark)
        root.classList.remove('theme-light')
        run()
        const label = `stored=${String(stored)} device=${dark ? 'dark' : 'light'}`
        expect(root.classList.contains('theme-light'), label).toBe(light)
        // The pre-paint rule and the module's rule are ONE rule.
        const choice: ThemeChoice = storedTheme(window.localStorage)
        expect(resolveDark(choice, systemPrefersDark(window)), label).toBe(!light)
    }
    // Without matchMedia at all (an old engine), an unset visitor paints light.
    Reflect.deleteProperty(window, 'matchMedia')
    window.localStorage.clear()
    root.classList.remove('theme-light')
    run()
    expect(root.classList.contains('theme-light')).toBe(true)
    expect(resolveDark(storedTheme(window.localStorage), systemPrefersDark(window))).toBe(false)
})
