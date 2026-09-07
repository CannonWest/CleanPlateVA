// @vitest-environment jsdom
/**
 * The grade-palette preference (2026-09-06) — theme.ts's twin for the
 * color-blind friendly ramp: STANDARD when unset (the ratified ramp), the
 * one other word round-tripping under its own key, a throwing storage
 * (private mode) that reads as the default rather than an error, the class
 * on <html> that is the color-blind ramp's hook — and index.html's pre-paint
 * script, run here against the same storage, so the two entry points can
 * never disagree about a visitor's first paint. Plus the two tables the DOM
 * and the canvas must agree on: the CSS block's hex mirrors GRADE_PALETTES.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
    applyPaletteClass, PALETTE_DEFAULT, PALETTES, persistPalette, storedPalette,
} from '../../app/palette'
import {
    DECLINE_RINGS, GRADE_COLORS, GRADE_PALETTES, NEW_COLOR, NEW_COLORS, PALETTE_CLASS, PALETTE_KEY,
} from '../../app/constants'
import { gradeColor, gradeHex } from '../../app/data/presentation'

function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value) },
        map,
    }
}

afterEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove(PALETTE_CLASS, 'theme-light')
})

test('unset reads as STANDARD — the ratified ramp; only the one other word is itself', () => {
    expect(PALETTE_DEFAULT).toBe('standard')
    expect(PALETTES).toEqual(['standard', 'colorblind'])
    expect(storedPalette(memoryStorage())).toBe('standard')
    expect(storedPalette(memoryStorage({ [PALETTE_KEY]: 'standard' }))).toBe('standard')
    expect(storedPalette(memoryStorage({ [PALETTE_KEY]: 'sepia' }))).toBe('standard')
    expect(storedPalette(memoryStorage({ [PALETTE_KEY]: 'colorblind' }))).toBe('colorblind')
})

test('the choice round-trips under its own key', () => {
    const storage = memoryStorage()
    persistPalette('colorblind', storage)
    expect(storage.map.get(PALETTE_KEY)).toBe('colorblind')
    expect(storedPalette(storage)).toBe('colorblind')
    persistPalette('standard', storage)
    expect(storedPalette(storage)).toBe('standard')
    expect(PALETTE_KEY).toBe('cleanplateva.gradePalette')
})

test('a throwing storage is the default, not an error (private mode)', () => {
    const throwing = {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
    }
    expect(storedPalette(throwing)).toBe('standard')
    expect(() => persistPalette('colorblind', throwing)).not.toThrow()
})

test('the class on <html> is the color-blind ramp\'s hook; the bare tokens are the standard ramp', () => {
    const root = document.createElement('div')
    applyPaletteClass('colorblind', root)
    expect(root.classList.contains(PALETTE_CLASS)).toBe(true)
    applyPaletteClass('standard', root)
    expect(root.classList.contains(PALETTE_CLASS)).toBe(false)
    expect(PALETTE_CLASS).toBe('palette-colorblind')
})

test('the two tables: Cannon\'s ramp by hex, NEW and the declining ring off blue and red under it', () => {
    expect(GRADE_PALETTES.colorblind).toEqual({
        A: '#045a8d', B: '#5aa9d6', C: '#f4c245', D: '#f08c3c', F: '#9c4a0c', none: '#868e96',
    })
    expect(GRADE_PALETTES.standard).toBe(GRADE_COLORS) // the ratified ramp by its old name
    expect(NEW_COLORS.standard).toBe(NEW_COLOR)
    expect(NEW_COLORS.colorblind).not.toBe(NEW_COLOR)
    // Red on the umber F would be ~1.4:1: the ring leaves red with the ramp.
    expect(DECLINE_RINGS.colorblind).not.toBe(DECLINE_RINGS.standard)
    // The DOM asks for the token; the canvas and the map ask for the hex.
    expect(gradeColor('A')).toBe('var(--cp-grade-a)')
    expect(gradeColor(null)).toBe('var(--cp-grade-none)')
    expect(gradeColor('Z')).toBe('var(--cp-grade-none)')
    expect(gradeHex('A', 'standard')).toBe('#2f9e44')
    expect(gradeHex('A', 'colorblind')).toBe('#045a8d')
    expect(gradeHex(null, 'colorblind')).toBe('#868e96')
})

test('theme.css\'s color-blind block carries the same hex as the table, token for token', () => {
    const css = readFileSync(resolve(import.meta.dirname, '..', '..', 'app', 'theme.css'), 'utf8')
    const block = css.match(/\.palette-colorblind\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(block).not.toBe('')
    const declared = Object.fromEntries(
        Array.from(block.matchAll(/--cp-([a-z-]+):\s*(#[0-9a-f]{6});/g)).map((m) => [m[1], m[2]]),
    )
    const ramp = GRADE_PALETTES.colorblind
    expect(declared).toEqual({
        'grade-a': ramp.A, 'grade-b': ramp.B, 'grade-c': ramp.C, 'grade-d': ramp.D, 'grade-f': ramp.F,
        new: NEW_COLORS.colorblind,
    })
    // And the standard values are the :root's, untouched.
    expect(css).toMatch(/--cp-grade-a:\s*#2f9e44;/)
    expect(css).toMatch(/--cp-new:\s*#1c7ed6;/)
})

test('index.html applies the same rule before first paint: the class ON for the one stored word', () => {
    const html = readFileSync(resolve(import.meta.dirname, '..', '..', 'index.html'), 'utf8')
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    const run = new Function(script as string)
    const root = document.documentElement
    for (const [stored, on] of [[null, false], ['standard', false], ['sepia', false], ['colorblind', true]] as const) {
        window.localStorage.clear()
        if (stored !== null) window.localStorage.setItem(PALETTE_KEY, stored)
        root.classList.remove(PALETTE_CLASS)
        run()
        expect(root.classList.contains(PALETTE_CLASS), `stored=${String(stored)}`).toBe(on)
        // The pre-paint rule and the module's rule are ONE rule.
        expect(storedPalette(window.localStorage) === 'colorblind').toBe(on)
    }
})
