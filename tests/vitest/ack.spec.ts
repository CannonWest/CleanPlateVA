/** The acknowledgement STATE + the data client's gate on the CR stack —
 *  ports the behavioral tests of `tests/ack.test.mjs` against `app/ack.ts` +
 *  `app/data/client.ts` (C2). The old suite's dialog/chrome pins (the
 *  About §06 clone, the header control, the CSS) guard the served client and
 *  stay with the .mjs original; CRV rebuilds that chrome to §6.1 and re-pins
 *  it there.
 */
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
    ACK_AGREED, ACK_DECLINED, ACK_KEY, ACK_VERSION, createAckState, readAck, writeAck,
} from '../../app/ack'
import { createFoodApi, type FetchLike, type ResponseLike } from '../../app/data/client'
import type { LoadedRoster, RosterResult } from '../../app/data/types'

function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => { map.set(k, String(v)) },
        dump: () => Object.fromEntries(map),
    }
}

// ── the stored answer ────────────────────────────────────────────────────

test('the answer lives under ONE versioned key; an older version is not an answer', () => {
    assert.equal(ACK_KEY, `cleanplateva.ack.v${ACK_VERSION}`)
    assert.equal(ACK_VERSION, 1)
    assert.equal(readAck(memoryStorage({ 'cleanplateva.ack.v0': ACK_AGREED })), null)
    assert.equal(readAck(memoryStorage({ [ACK_KEY]: ACK_AGREED })), ACK_AGREED)
    assert.equal(readAck(memoryStorage({ [ACK_KEY]: ACK_DECLINED })), ACK_DECLINED)
    assert.equal(readAck(memoryStorage({ [ACK_KEY]: 'maybe' })), null)
    assert.equal(readAck(null), null)
    assert.equal(readAck({ getItem(): string | null { throw new Error('private mode') } }), null)
    assert.doesNotThrow(() => writeAck({ setItem(): void { throw new Error('private mode') } }, ACK_AGREED))
})

test('createAckState starts from storage; buttons persist, Escape does not', () => {
    const fresh = createAckState(memoryStorage())
    assert.equal(fresh.value, null)
    assert.equal(fresh.decided, false)
    assert.equal(fresh.agreed, false)

    const storage = memoryStorage()
    const state = createAckState(storage)
    state.set(ACK_DECLINED, { persist: false }) // Escape on the first-load dialog
    assert.equal(state.value, ACK_DECLINED)
    assert.equal(state.decided, true)
    assert.equal(state.persisted, false, 'it governs this load only')
    assert.deepEqual(storage.dump(), {}, 'an unpersisted decline writes nothing — the next load asks again')

    state.set(ACK_AGREED) // the button
    assert.equal(state.agreed, true)
    assert.equal(state.persisted, true)
    assert.deepEqual(storage.dump(), { [ACK_KEY]: ACK_AGREED })

    state.set('nonsense')
    assert.equal(state.value, null, 'only the two answers are answers')
    assert.deepEqual(storage.dump(), { [ACK_KEY]: ACK_AGREED }, 'and nonsense is never written')

    const remembered = createAckState(storage)
    assert.equal(remembered.agreed, true, 'a later load starts from the remembered answer')
    assert.equal(remembered.persisted, true)
})

// ── the data client's gate ───────────────────────────────────────────────

const finderShard = (bucket: string, facilities: unknown[]) => ({
    contract: 'cleanplateva.finder-shard.v4', schema_version: 4, bucket, facilities,
})
const liteManifest = {
    contract: 'cleanplateva.finder-manifest.v4', schema_version: 4, available: true, mode: 'lite',
    snapshot_id: 'lite-1', fetched_at: '2026-08-17T13:00:00Z',
    freshness: { snapshot_id: 'lite-1', newest_report: '2026-08-07' },
    vocab: { permit_type: [], loc: [], scope: [] },
    counts: { total: 1, by_zip: {} },
    resources: { finder: { shards: [{ path: 'finder/00-p.json', bucket: 0, sha256: 'p', bytes: 1, records: 1 }] } },
}
const fullManifest = {
    contract: 'cleanplateva.full-manifest.v4', schema_version: 4, available: true, mode: 'full',
    snapshot_id: 'full-1', fetched_at: '2026-08-17T13:00:00Z',
    freshness: { snapshot_id: 'full-1', newest_report: '2026-08-07' },
    vocab: liteManifest.vocab,
    counts: { total: 1, active: 1, closed: 0, by_grade: {}, by_zip: {} },
    resources: {
        finder: { shards: [{ path: 'finder/00-a.json', bucket: 0, sha256: 'sha-a', bytes: 1, records: 1 }] },
        overlay: { shards: [{ path: 'overlay/00-c.json', bucket: 0, sha256: 'sha-c', bytes: 1, records: 1 }] },
        closed: { shards: [] },
        standards: { path: 'standards.json' },
        details: { path_template: 'facility/{permit_id}.json', records: 1 },
    },
}
const COLUMNS = ['grade_score', 'new', 'trend_delta', 'latest_yyyymmdd', 'base_yyyymmdd',
    'latest_scope_code', 'latest_out', 'latest_items', 'compliance_pct']
const rowA = { permit_id: 'A', name: 'Alpha', lat: 1, lon: 2, loc: 0, pt: 0, is_restaurant: true, mobile: false }
const payloads = (): Record<string, unknown> => ({
    'data/manifest.json': liteManifest,
    'data/finder/00-p.json': finderShard('00', [rowA]),
    'data-full/manifest.json': fullManifest,
    'data-full/finder/00-a.json': finderShard('00', [rowA]),
    'data-full/overlay/00-c.json': {
        contract: 'cleanplateva.overlay-shard.v4', schema_version: 4, bucket: '00',
        finder_sha256: 'sha-a', columns: COLUMNS, rows: [[91, 0, 3, 20260801, 20260801, 1, null, 30, 90]],
    },
    'data-full/standards.json': {},
    'data-full/facility/A.json': { available: true, facility: { permit_id: 'A' }, inspections: [] },
})

type FakeFetch = FetchLike & { calls: string[] }
function fakeFetch(map: Record<string, unknown>): FakeFetch {
    const calls: string[] = []
    const fetchImpl = (async (path: string): Promise<ResponseLike> => {
        calls.push(path)
        const entry = map[path]
        if (entry === undefined) return { ok: false, status: 404, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => structuredClone(entry) }
    }) as FakeFetch
    fetchImpl.calls = calls
    return fetchImpl
}

function loaded(result: RosterResult): LoadedRoster {
    assert.ok('facilities' in result)
    return result
}

test('not acknowledged → the basic map only, and the full channel is never even asked', async () => {
    const fetchImpl = fakeFetch(payloads())
    const api = createFoodApi({ fetchImpl, isAcknowledged: () => false })
    const result = loaded(await api.getFoodFacilities())
    assert.equal(result.mode, 'lite')
    assert.equal(fetchImpl.calls.some((p) => p.startsWith('data-full/')), false, 'no full-tier request before the answer')
    // And nothing judgment-bearing is reachable through the client afterwards.
    assert.equal((await api.getFoodFacilityDetail('A')).available, false)
    assert.deepEqual(await api.loadClosed(), [])
})

test('acknowledged → full first; the gate is read at call time, so a later answer flips the next load', async () => {
    let agreed = false
    const fetchImpl = fakeFetch(payloads())
    const api = createFoodApi({ fetchImpl, isAcknowledged: () => agreed })
    assert.equal(loaded(await api.getFoodFacilities()).mode, 'lite')
    agreed = true // "Agree and View Grades"
    const full = loaded(await api.getFoodFacilities())
    assert.equal(full.mode, 'full')
    assert.equal(full.facilities[0]?.o?.grade_score, 91)
    // The agreed load opened with the full manifest.
    const fullManifestAt = fetchImpl.calls.indexOf('data-full/manifest.json')
    assert.ok(fullManifestAt > 0 && fetchImpl.calls[fullManifestAt - 1]?.startsWith('data/finder/'),
        'the full manifest is asked right after the lite boot, before any full shard')
    agreed = false // "Decline and Use Basic Map", later
    const back = loaded(await api.getFoodFacilities())
    assert.equal(back.mode, 'lite')
    assert.equal((await api.getFoodFacilityDetail('A')).available, false, 'the basic map forgets the full manifest')
})

test('?tier=lite wins over an acknowledgement (D-ACK-3)', async () => {
    const fetchImpl = fakeFetch(payloads())
    const api = createFoodApi({ fetchImpl, forceLite: true, isAcknowledged: () => true })
    assert.equal(loaded(await api.getFoodFacilities()).mode, 'lite')
    assert.equal(fetchImpl.calls.some((p) => p.startsWith('data-full/')), false)
})

test('a bare client (no gate given) keeps trying full first, so tools and tests are unchanged', async () => {
    const fetchImpl = fakeFetch(payloads())
    assert.equal(loaded(await createFoodApi({ fetchImpl }).getFoodFacilities()).mode, 'full')
})
