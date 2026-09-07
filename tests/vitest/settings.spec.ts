// @vitest-environment jsdom
/**
 * The settings dialog's own state (2026-09-06) — the text size and the
 * "seen" flag, theme.ts's and clusters.ts's third twin: the range (12..20
 * by 1 around the ratified 14); unset, garbage and out-of-range values that
 * read as the default; an integer round trip under its own key; a throwing
 * storage (private mode) that is the default, not an error; the scale on
 * <html> as the ratio to 14, cleared at the default; the seen flag — and
 * index.html's pre-paint script, run here against the same storage, so the
 * two entry points can never disagree about a visitor's first paint.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
    applyTextSize, persistSettingsSeen, persistTextSize, storedSettingsSeen, storedTextSize,
    TEXT_SCALE_PROPERTY, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP, textScale,
    validTextSize,
} from '../../app/settings'
import { SETTINGS_SEEN_KEY, TEXT_SIZE_KEY } from '../../app/constants'

function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value) },
        map,
    }
}

const throwing = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
}

afterEach(() => {
    window.localStorage.clear()
    document.documentElement.style.removeProperty(TEXT_SCALE_PROPERTY)
    document.documentElement.classList.remove('theme-light')
})

test('the range: 12..20 by 1 around the ratified 14, which is scale 1', () => {
    expect(TEXT_SIZE_DEFAULT).toBe(14)
    expect(TEXT_SIZE_MIN).toBe(12)
    expect(TEXT_SIZE_MAX).toBe(20)
    expect(TEXT_SIZE_STEP).toBe(1)
    expect(textScale(14)).toBe(1)
    expect(textScale(21)).toBe(1.5)
    expect(TEXT_SCALE_PROPERTY).toBe('--cp-text-scale')
})

test('unset, garbage and out-of-range read as the default; an integer in range is itself', () => {
    expect(storedTextSize(memoryStorage())).toBe(14)
    for (const raw of ['', 'big', '11', '21', '14.5', 'NaN', 'Infinity', '-16']) {
        expect(validTextSize(raw), raw).toBe(null)
        expect(storedTextSize(memoryStorage({ [TEXT_SIZE_KEY]: raw })), raw).toBe(14)
    }
    expect(validTextSize(null)).toBe(null)
    for (const size of [12, 13, 14, 16, 20]) {
        expect(validTextSize(String(size))).toBe(size)
        expect(storedTextSize(memoryStorage({ [TEXT_SIZE_KEY]: String(size) }))).toBe(size)
    }
})

test('the size round-trips as an integer string under its own key', () => {
    const storage = memoryStorage()
    persistTextSize(16, storage)
    expect(storage.map.get(TEXT_SIZE_KEY)).toBe('16')
    expect(storedTextSize(storage)).toBe(16)
    persistTextSize(14, storage)
    expect(storage.map.get(TEXT_SIZE_KEY)).toBe('14')
    expect(storedTextSize(storage)).toBe(14)
    expect(TEXT_SIZE_KEY).toBe('cleanplateva.textSize')
})

test('a throwing storage is the default, not an error (private mode)', () => {
    expect(storedTextSize(throwing)).toBe(14)
    expect(() => persistTextSize(16, throwing)).not.toThrow()
    expect(storedSettingsSeen(throwing)).toBe(false)
    expect(() => persistSettingsSeen(throwing)).not.toThrow()
})

test('the scale on <html> is the ratio to 14, and the default clears it', () => {
    const root = document.createElement('div')
    applyTextSize(16, root)
    expect(root.style.getPropertyValue(TEXT_SCALE_PROPERTY)).toBe(String(16 / 14))
    applyTextSize(12, root)
    expect(root.style.getPropertyValue(TEXT_SCALE_PROPERTY)).toBe(String(12 / 14))
    applyTextSize(14, root)
    expect(root.style.getPropertyValue(TEXT_SCALE_PROPERTY)).toBe('')
})

test('the seen flag: unset until the dialog has opened on its own, then 1', () => {
    const storage = memoryStorage()
    expect(storedSettingsSeen(storage)).toBe(false)
    expect(storedSettingsSeen(memoryStorage({ [SETTINGS_SEEN_KEY]: 'yes' }))).toBe(false)
    persistSettingsSeen(storage)
    expect(storage.map.get(SETTINGS_SEEN_KEY)).toBe('1')
    expect(storedSettingsSeen(storage)).toBe(true)
    expect(SETTINGS_SEEN_KEY).toBe('cleanplateva.settingsSeen')
})

test('index.html applies the same size before first paint, by the same test', () => {
    const html = readFileSync(resolve(import.meta.dirname, '..', '..', 'index.html'), 'utf8')
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    const run = new Function(script as string)
    const root = document.documentElement
    const probe = document.createElement('div')
    for (const stored of [null, '12', '14', '16', '20', '11', '21', '14.5', 'big', '']) {
        window.localStorage.clear()
        if (stored !== null) window.localStorage.setItem(TEXT_SIZE_KEY, stored)
        root.style.removeProperty(TEXT_SCALE_PROPERTY)
        run()
        // The module's own application of the stored value, for comparison.
        applyTextSize(storedTextSize(window.localStorage), probe)
        expect(root.style.getPropertyValue(TEXT_SCALE_PROPERTY), `stored=${String(stored)}`)
            .toBe(probe.style.getPropertyValue(TEXT_SCALE_PROPERTY))
    }
    // The two non-default sizes the loop covered actually set a ratio.
    window.localStorage.setItem(TEXT_SIZE_KEY, '16')
    root.style.removeProperty(TEXT_SCALE_PROPERTY)
    run()
    expect(root.style.getPropertyValue(TEXT_SCALE_PROPERTY)).toBe(String(16 / 14))
})
