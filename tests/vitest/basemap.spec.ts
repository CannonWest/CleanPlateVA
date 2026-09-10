/**
 * The basemap preference (2026-09-07) — the twin of clusters.spec.ts: the
 * shipped default stands wherever storage cannot answer, and an unknown
 * value degrades to it rather than to a blank map.
 */
import { expect, test } from 'vitest'
import { BASEMAPS, BASEMAP_LABELS, isBasemap, persistBasemap, storedBasemap } from '../../app/basemap'
import { BASEMAP_KEY } from '../../app/constants'

function storage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        read: () => Object.fromEntries(store),
    }
}

test('unset reads as the drawn map — the shipped default (design decision, 2026-09-07)', () => {
    expect(storedBasemap(storage())).toBe('map')
})

test('a stored choice is honored', () => {
    expect(storedBasemap(storage({ [BASEMAP_KEY]: 'aerial' }))).toBe('aerial')
    expect(storedBasemap(storage({ [BASEMAP_KEY]: 'map' }))).toBe('map')
})

test('a value this version does not know degrades to the default, never to a blank canvas', () => {
    // A key written by a later version (a third basemap, a historic year).
    expect(storedBasemap(storage({ [BASEMAP_KEY]: 'vbmp2013' }))).toBe('map')
    expect(storedBasemap(storage({ [BASEMAP_KEY]: '' }))).toBe('map')
})

test('storage that throws (private mode) reads and writes without escaping', () => {
    const hostile = {
        getItem() { throw new Error('denied') },
        setItem() { throw new Error('denied') },
    }
    expect(storedBasemap(hostile)).toBe('map')
    expect(() => persistBasemap('aerial', hostile)).not.toThrow()
})

test('persist round-trips through the shared key', () => {
    const s = storage()
    persistBasemap('aerial', s)
    expect(s.read()[BASEMAP_KEY]).toBe('aerial')
    expect(storedBasemap(s)).toBe('aerial')
    persistBasemap('map', s)
    expect(storedBasemap(s)).toBe('map')
})

test('the guard admits exactly the two choices the control offers', () => {
    for (const value of BASEMAPS) expect(isBasemap(value)).toBe(true)
    for (const value of ['satellite', 'aerial ', null, undefined, 0]) {
        expect(isBasemap(value)).toBe(false)
    }
    // Every choice carries a public word (C8 — "Aerial", never "Satellite":
    // the VBMP flies aircraft).
    for (const value of BASEMAPS) expect(BASEMAP_LABELS[value]).toBeTruthy()
    expect(Object.values(BASEMAP_LABELS)).not.toContain('Satellite')
})
