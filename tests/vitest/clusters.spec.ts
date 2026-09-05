/**
 * The clustering preference (CRP-M6) — theme.ts's twin: off when unset (the
 * shipped default, Cannon's call), a '1'/'0' round trip, and a throwing
 * storage (private mode) reads as the default rather than an error.
 */
import { expect, test } from 'vitest'
import { persistClusters, storedClusters } from '../../app/clusters'
import { CLUSTERS_KEY } from '../../app/constants'

function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value) },
        map,
    }
}

test('unset reads as OFF — the shipped default', () => {
    expect(storedClusters(memoryStorage())).toBe(false)
    expect(storedClusters(memoryStorage({ [CLUSTERS_KEY]: '0' }))).toBe(false)
    expect(storedClusters(memoryStorage({ [CLUSTERS_KEY]: 'yes' }))).toBe(false) // only '1' is on
})

test('the choice round-trips as 1 / 0 under its own key', () => {
    const storage = memoryStorage()
    persistClusters(true, storage)
    expect(storage.map.get(CLUSTERS_KEY)).toBe('1')
    expect(storedClusters(storage)).toBe(true)
    persistClusters(false, storage)
    expect(storage.map.get(CLUSTERS_KEY)).toBe('0')
    expect(storedClusters(storage)).toBe(false)
    expect(CLUSTERS_KEY).toBe('cleanplateva.clusters')
})

test('a throwing storage is the default, not an error (private mode)', () => {
    const throwing = {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
    }
    expect(storedClusters(throwing)).toBe(false)
    expect(() => persistClusters(true, throwing)).not.toThrow()
})
