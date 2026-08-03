import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('../public/static/js/dataClient.js', import.meta.url),
    'utf8',
);
const { createFoodApi } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function fakeFetch(payloads) {
    const calls = [];
    const fetchImpl = async (path) => {
        calls.push(path);
        const entry = payloads[path];
        if (entry instanceof Error) throw entry;
        if (entry === undefined) {
            return { ok: false, status: 404, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => structuredClone(entry) };
    };
    fetchImpl.calls = calls;
    return fetchImpl;
}

const fullManifest = {
    contract: 'cleanplateva.full-manifest.v2',
    schema_version: 2,
    available: true,
    mode: 'full',
    snapshot_id: 'snapshot-1',
    fetched_at: '2026-08-02T12:00:00Z',
    counts: { total: 2, inspections: 4 },
    resources: {
        finder: { shards: [
            { path: 'finder/00-a.json' },
            { path: 'finder/01-b.json' },
        ] },
        signals: { shards: [
            { path: 'signals/00-c.json' },
            { path: 'signals/01-d.json' },
        ] },
        standards: { path: 'standards.json' },
        details: { path_template: 'facility/{permit_id}.json' },
    },
};

const liteManifest = {
    contract: 'cleanplateva.finder-manifest.v2',
    schema_version: 2,
    available: true,
    mode: 'lite',
    snapshot_id: 'lite-1',
    fetched_at: '2026-08-02T13:00:00Z',
    counts: { total: 1 },
    resources: { finder: { shards: [{ path: 'finder/00-public.json' }] } },
};

const liteShard = {
    contract: 'cleanplateva.finder-shard.v2',
    schema_version: 2,
    bucket: '00',
    facilities: [{ permit_id: 'public' }],
};

test('V2 full manifest loads and merges independent finder and signal shards', async () => {
    const fetchImpl = fakeFetch({
        'data-full/manifest.json': fullManifest,
        'data-full/finder/00-a.json': {
            contract: 'cleanplateva.full-finder-shard.v2', schema_version: 2,
            facilities: [{ permit_id: 'A', name: 'Alpha', lat: 1, lon: 2 }],
        },
        'data-full/finder/01-b.json': {
            contract: 'cleanplateva.full-finder-shard.v2', schema_version: 2,
            facilities: [{ permit_id: 'B', name: 'Beta', lat: 3, lon: 4 }],
        },
        'data-full/signals/00-c.json': {
            contract: 'cleanplateva.full-signal-shard.v2', schema_version: 2,
            facilities: [{ permit_id: 'A', inspection_count: 3, trend: [['b', 20260101, 88, 30]] }],
        },
        'data-full/signals/01-d.json': {
            contract: 'cleanplateva.full-signal-shard.v2', schema_version: 2,
            facilities: [{ permit_id: 'B', inspection_count: 1, latest: { score: 92 } }],
        },
    });
    const api = createFoodApi({ fetchImpl });

    const result = await api.getFoodFacilities();

    assert.equal(result.contract, fullManifest.contract);
    assert.equal(result.snapshot_id, 'snapshot-1');
    assert.equal(result.facilities.length, 2);
    assert.deepEqual(result.facilities[0], {
        permit_id: 'A', name: 'Alpha', lat: 1, lon: 2,
        inspection_count: 3, trend: [['b', 20260101, 88, 30]],
    });
    assert.equal('score_trend' in result.facilities[0], false);
    assert.deepEqual(fetchImpl.calls, [
        'data-full/manifest.json',
        'data-full/finder/00-a.json',
        'data-full/finder/01-b.json',
        'data-full/signals/00-c.json',
        'data-full/signals/01-d.json',
    ]);
});

test('detail merges the cached roster row and decodes compact checklist rows', async () => {
    const fetchImpl = fakeFetch({
        'data-full/manifest.json': {
            ...fullManifest,
            counts: { total: 1, inspections: 1 },
            resources: {
                finder: { shards: [{ path: 'finder/00-a.json' }] },
                signals: { shards: [{ path: 'signals/00-c.json' }] },
                standards: { path: 'vocab/standards-a.json' },
                details: { path_template: 'facility/{permit_id}.json' },
            },
        },
        'data-full/finder/00-a.json': {
            contract: 'cleanplateva.full-finder-shard.v2', schema_version: 2,
            facilities: [{ permit_id: 'A', name: 'Roster name', city: 'Richmond' }],
        },
        'data-full/signals/00-c.json': {
            contract: 'cleanplateva.full-signal-shard.v2', schema_version: 2,
            facilities: [{ permit_id: 'A', grade: { score: 88, letter: 'B' } }],
        },
        'data-full/facility/A.json': {
            available: true,
            facility: { permit_id: 'A', name: 'Detail name', phone: '555' },
            inspections: [{ checklist: [[1, 'OUT', 10]] }],
        },
        'data-full/vocab/standards-a.json': {
            1: { category: 'Food', text: 'Protected from contamination' },
        },
    });
    const api = createFoodApi({ fetchImpl });
    await api.getFoodFacilities();

    const detail = await api.getFoodFacilityDetail('A');

    assert.deepEqual(detail.facility, {
        permit_id: 'A', name: 'Detail name', city: 'Richmond',
        grade: { score: 88, letter: 'B' }, phone: '555',
    });
    assert.deepEqual(detail.inspections[0].checklist[0], {
        item: 1,
        disposition: 'OUT',
        category: 'Food',
        standard_text: 'Protected from contamination',
        compliant: false,
        violation: true,
        cos: false,
        repeat: true,
        is_sentinel: false,
    });
});

test('incomplete full V2 drops directly to the public V2 tier', async () => {
    const fetchImpl = fakeFetch({
        'data-full/manifest.json': fullManifest,
        'data-full/finder/00-a.json': new Error('shard unavailable'),
        'data-full/finder/01-b.json': { facilities: [] },
        'data-full/signals/00-c.json': { facilities: [] },
        'data-full/signals/01-d.json': { facilities: [] },
        'data/manifest.json': liteManifest,
        'data/finder/00-public.json': liteShard,
    });
    const result = await createFoodApi({ fetchImpl }).getFoodFacilities();
    assert.deepEqual(result.facilities, [{ permit_id: 'public' }]);
    assert.equal(fetchImpl.calls.includes('data-full/facilities.json'), false);
});

test('noncanonical full resource arrays are rejected rather than normalized', async () => {
    const fetchImpl = fakeFetch({
        'data-full/manifest.json': {
            ...fullManifest,
            resources: {
                ...fullManifest.resources,
                finder: [{ path: 'finder/00-a.json' }],
                signals: [{ path: 'signals/00-c.json' }],
            },
        },
        'data/manifest.json': liteManifest,
        'data/finder/00-public.json': liteShard,
    });
    const result = await createFoodApi({ fetchImpl }).getFoodFacilities();
    assert.deepEqual(result.facilities, [{ permit_id: 'public' }]);
    assert.equal(fetchImpl.calls.some((path) => path.startsWith('data-full/finder/')), false);
});

test('forced lite skips the full tier and attaches public manifest freshness', async () => {
    const fetchImpl = fakeFetch({
        'data/manifest.json': liteManifest,
        'data/finder/00-public.json': liteShard,
    });
    const result = await createFoodApi({ fetchImpl, forceLite: true }).getFoodFacilities();

    assert.equal(result.snapshot_id, 'lite-1');
    assert.equal(result.fetched_at, '2026-08-02T13:00:00Z');
    assert.deepEqual(fetchImpl.calls,
        ['data/manifest.json', 'data/finder/00-public.json']);
});

test('a public finder shard is not loaded without its V2 manifest', async () => {
    const fetchImpl = fakeFetch({
        'data/finder/00-public.json': liteShard,
    });
    const result = await createFoodApi({ fetchImpl, forceLite: true }).getFoodFacilities();
    assert.equal(result.available, false);
    assert.deepEqual(fetchImpl.calls, ['data/manifest.json']);
});

test('the retired public monolith resource is rejected', async () => {
    const fetchImpl = fakeFetch({
        'data/manifest.json': {
            ...liteManifest,
            resources: { finder: { path: 'facilities.json' } },
        },
        'data/facilities.json': {
            contract: 'cleanplateva.finder.v2', schema_version: 2,
            facilities: [{ permit_id: 'public' }],
        },
    });
    const result = await createFoodApi({ fetchImpl, forceLite: true }).getFoodFacilities();
    assert.equal(result.available, false);
    assert.deepEqual(fetchImpl.calls, ['data/manifest.json']);
});
