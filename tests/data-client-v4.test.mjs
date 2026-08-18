/** The Contract V4 data client: finder + overlay at boot (position-merged,
 *  sha-bound per bucket), the lazy closed family, the shared detail LRU that
 *  hover prefetch and click both read, and the Full → Lite fallback. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('../public/static/js/dataClient.js', import.meta.url),
    'utf8',
);
const { createFoodApi, decodeOverlay, DETAIL_CACHE_SIZE } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const SPA_SHELL = Symbol('spa-shell');

function fakeFetch(payloads) {
    const calls = [];
    const fetchImpl = async (path) => {
        calls.push(path);
        const entry = payloads[path];
        if (entry instanceof Error) throw entry;
        if (entry === undefined) {
            return { ok: false, status: 404, json: async () => ({}) };
        }
        if (entry === SPA_SHELL) {
            // The static-assets layer answering a path it cannot find with the
            // site's own index.html, status 200 (`not_found_handling`).
            return {
                ok: true, status: 200,
                headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
                json: async () => { throw new SyntaxError('Unexpected token <'); },
            };
        }
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => structuredClone(entry) };
    };
    fetchImpl.calls = calls;
    return fetchImpl;
}

const COLUMNS = ['grade_score', 'new', 'trend_delta', 'latest_yyyymmdd', 'base_yyyymmdd',
    'latest_scope_code', 'latest_out', 'latest_items', 'compliance_pct'];

const finderShard = (bucket, facilities) => ({
    contract: 'cleanplateva.finder-shard.v4', schema_version: 4, bucket, facilities,
});
const overlayShard = (bucket, finderSha, rows) => ({
    contract: 'cleanplateva.overlay-shard.v4', schema_version: 4, bucket,
    finder_sha256: finderSha, columns: COLUMNS, rows,
});
const closedShard = (bucket, facilities) => ({
    contract: 'cleanplateva.closed-shard.v4', schema_version: 4, bucket, facilities,
});

const fullManifest = {
    contract: 'cleanplateva.full-manifest.v4',
    schema_version: 4,
    available: true,
    mode: 'full',
    snapshot_id: 'snapshot-1',
    fetched_at: '2026-08-16T12:00:00Z',
    freshness: { snapshot_id: 'snapshot-1', newest_report: '2026-08-07' },
    vocab: { permit_type: ['Fast Food', 'Full Service Restaurant'], loc: ['rooftop', 'street', 'zip_centroid'], scope: ['unknown', 'broad', 'focused'] },
    counts: { total: 3, active: 2, closed: 1, by_grade: {}, by_zip: {} },
    resources: {
        finder: { shards: [
            { path: 'finder/00-a.json', bucket: 0, sha256: 'sha-a', bytes: 1, records: 1 },
            { path: 'finder/01-b.json', bucket: 1, sha256: 'sha-b', bytes: 1, records: 1 },
        ] },
        overlay: { shards: [
            { path: 'overlay/00-c.json', bucket: 0, sha256: 'sha-c', bytes: 1, records: 1 },
            { path: 'overlay/01-d.json', bucket: 1, sha256: 'sha-d', bytes: 1, records: 1 },
        ] },
        closed: { shards: [
            { path: 'closed/00-e.json', bucket: 0, sha256: 'sha-e', bytes: 1, records: 1 },
        ] },
        standards: { path: 'standards.json' },
        details: { path_template: 'facility/{permit_id}.json', records: 3 },
    },
};

const rowA = { permit_id: 'A', name: 'Alpha', lat: 1, lon: 2, loc: 0, pt: 1, is_restaurant: true, mobile: false };
const rowB = { permit_id: 'B', name: 'Beta', lat: 3, lon: 4, loc: 2, pt: 0, is_restaurant: true, mobile: false };

const goodFull = () => ({
    'data-full/manifest.json': fullManifest,
    'data-full/finder/00-a.json': finderShard('00', [rowA]),
    'data-full/finder/01-b.json': finderShard('01', [rowB]),
    'data-full/overlay/00-c.json': overlayShard('00', 'sha-a', [[91, 0, 3, 20260801, 20260801, 1, null, 30, 90]]),
    'data-full/overlay/01-d.json': overlayShard('01', 'sha-b', [[null, 1, null, 20260805, null, 2, 1, 4, null]]),
    'data-full/closed/00-e.json': closedShard('00', [
        { permit_id: 'C', name: 'Closed Cafe', lat: 5, lon: 6, loc: 0, status: 'Business Closed',
            o: [55, 0, -10, 20250101, 20250101, 1, null, 25, 80] },
    ]),
    'data-full/standards.json': { 1: { category: 'Food', text: 'Protected from contamination' } },
    'data-full/facility/A.json': {
        available: true,
        facility: { permit_id: 'A', name: 'Alpha (detail)', location: { lat: 1, lon: 2, source: 'vgin_addresspoint' } },
        inspections: [{ checklist: [[1, 'OUT', 10]] }],
    },
});

const liteManifest = {
    contract: 'cleanplateva.finder-manifest.v4',
    schema_version: 4,
    available: true,
    mode: 'lite',
    snapshot_id: 'lite-1',
    fetched_at: '2026-08-16T13:00:00Z',
    freshness: { snapshot_id: 'lite-1', newest_report: '2026-08-07' },
    vocab: fullManifest.vocab,
    counts: { total: 1, by_zip: {} },
    resources: { finder: { shards: [{ path: 'finder/00-public.json', bucket: 0, sha256: 'p', bytes: 1, records: 1 }] } },
};
const liteShard = finderShard('00', [{ permit_id: 'public', name: 'Public', lat: 1, lon: 2, loc: 0 }]);

test('decodeOverlay names the slots by the shard columns', () => {
    assert.deepEqual(decodeOverlay([91, 0, 3, 20260801, 20260801, 1, null, 30, 90], COLUMNS), {
        grade_score: 91, new: 0, trend_delta: 3, latest_yyyymmdd: 20260801, base_yyyymmdd: 20260801,
        latest_scope_code: 1, latest_out: null, latest_items: 30, compliance_pct: 90,
    });
    assert.deepEqual(decodeOverlay(null, COLUMNS), {});
});

test('the V4 full manifest loads finder + overlay in parallel and merges by position', async () => {
    const fetchImpl = fakeFetch(goodFull());
    const api = createFoodApi({ fetchImpl });
    const result = await api.getFoodFacilities();

    assert.equal(result.contract, 'cleanplateva.full-manifest.v4');
    assert.equal(result.mode, 'full');
    assert.equal(result.freshness.newest_report, '2026-08-07');
    assert.equal(result.facilities.length, 2);
    assert.deepEqual(result.facilities[0], {
        ...rowA,
        o: { grade_score: 91, new: 0, trend_delta: 3, latest_yyyymmdd: 20260801, base_yyyymmdd: 20260801,
            latest_scope_code: 1, latest_out: null, latest_items: 30, compliance_pct: 90 },
    });
    assert.equal(result.facilities[1].o.new, 1);
    // Boot never touches closed, standards, or details. The finder is asked
    // of the static public channel FIRST (CPH-M3, D-TRANSPORT-4 — no Worker
    // request there); this fixture has no static copy, so each shard falls
    // back to R2 by the same content-addressed name.
    assert.deepEqual(fetchImpl.calls, [
        'data-full/manifest.json',
        'data/finder/00-a.json',
        'data/finder/01-b.json',
        'data-full/overlay/00-c.json',
        'data-full/overlay/01-d.json',
        'data-full/finder/00-a.json',
        'data-full/finder/01-b.json',
    ]);
});

test('the finder is read from the static public channel by name; R2 is the fallback for a missing name or the SPA shell', async () => {
    // Same bytes under both roots (design ref §6.3, D-DATA-2) — the static
    // copy is free on Workers Free, so it wins whenever the name is there.
    const payloads = goodFull();
    payloads['data/finder/00-a.json'] = structuredClone(payloads['data-full/finder/00-a.json']);
    payloads['data/finder/01-b.json'] = SPA_SHELL;    // the assets layer's 200 of HTML for a name it lacks
    const fetchImpl = fakeFetch(payloads);
    const api = createFoodApi({ fetchImpl });
    const result = await api.getFoodFacilities();
    assert.equal(result.mode, 'full');
    assert.equal(result.facilities.length, 2);
    assert.equal(result.facilities[0].o.grade_score, 91);        // bucket 00 came from static…
    assert.ok(fetchImpl.calls.includes('data/finder/00-a.json'));
    assert.ok(!fetchImpl.calls.includes('data-full/finder/00-a.json'), 'no R2 read for a shard the static tree has');
    assert.ok(fetchImpl.calls.includes('data/finder/01-b.json'));  // …bucket 01 hit the shell…
    assert.ok(fetchImpl.calls.includes('data-full/finder/01-b.json'), '…and fell back to R2 by the same name');
    // The overlay never leaves R2 (it is not a static asset).
    assert.ok(!fetchImpl.calls.some((p) => p.startsWith('data/overlay/')));
});

test('the SPA shell on a data path is a miss, never markup to parse — full degrades to the basic map, the basic map reports unavailable', async () => {
    // The full manifest answered by the shell (a fail-open bypass, or a
    // missing object under the assets fallback) → the public finder.
    const shellFull = { ...goodFull(), 'data-full/manifest.json': SPA_SHELL,
        'data/manifest.json': liteManifest, 'data/finder/00-public.json': liteShard };
    const api = createFoodApi({ fetchImpl: fakeFetch(shellFull) });
    const back = await api.getFoodFacilities();
    assert.equal(back.mode, 'lite');
    assert.equal(back.facilities.length, 1);
    // The public manifest itself answered by the shell → the honest "no data".
    const shellLite = createFoodApi({ fetchImpl: fakeFetch({ 'data/manifest.json': SPA_SHELL }), forceLite: true });
    const none = await shellLite.getFoodFacilities();
    assert.equal(none.available, false);
    assert.equal(none.reason, 'no data published yet');
    // A public shard answered by the shell → the same, not a JSON parse error.
    const shellShard = createFoodApi({ fetchImpl: fakeFetch({ 'data/manifest.json': liteManifest, 'data/finder/00-public.json': SPA_SHELL }), forceLite: true });
    const broken = await shellShard.getFoodFacilities();
    assert.equal(broken.available, false);
    assert.equal(broken.reason, 'no data published yet');
});

test('an overlay bound to a different finder shard is rejected — the client degrades to the finder', async () => {
    const payloads = goodFull();
    payloads['data-full/overlay/01-d.json'] = overlayShard('01', 'sha-STALE', [[null, 1, null, null, null, 0, null, null, null]]);
    payloads['data/manifest.json'] = liteManifest;
    payloads['data/finder/00-public.json'] = liteShard;
    const result = await createFoodApi({ fetchImpl: fakeFetch(payloads) }).getFoodFacilities();
    assert.equal(result.mode, 'lite');
    assert.deepEqual(result.facilities.map((f) => f.permit_id), ['public']);
});

test('a misaligned overlay (row count) or a bad active count degrades to the finder', async () => {
    const misaligned = goodFull();
    misaligned['data-full/overlay/00-c.json'] = overlayShard('00', 'sha-a', []);
    misaligned['data/manifest.json'] = liteManifest;
    misaligned['data/finder/00-public.json'] = liteShard;
    assert.equal((await createFoodApi({ fetchImpl: fakeFetch(misaligned) }).getFoodFacilities()).mode, 'lite');

    const wrongCount = goodFull();
    wrongCount['data-full/manifest.json'] = { ...fullManifest, counts: { ...fullManifest.counts, active: 5 } };
    wrongCount['data/manifest.json'] = liteManifest;
    wrongCount['data/finder/00-public.json'] = liteShard;
    assert.equal((await createFoodApi({ fetchImpl: fakeFetch(wrongCount) }).getFoodFacilities()).mode, 'lite');
});

test('a V3 full manifest is not understood — no dual-contract path', async () => {
    const payloads = {
        'data-full/manifest.json': { ...fullManifest, contract: 'cleanplateva.full-manifest.v3', schema_version: 3 },
        'data/manifest.json': liteManifest,
        'data/finder/00-public.json': liteShard,
    };
    const fetchImpl = fakeFetch(payloads);
    const result = await createFoodApi({ fetchImpl }).getFoodFacilities();
    assert.equal(result.mode, 'lite');
    assert.equal(fetchImpl.calls.some((path) => path.startsWith('data-full/finder/')), false);
});

test('the closed family loads once, on demand, and joins the roster', async () => {
    const fetchImpl = fakeFetch(goodFull());
    const api = createFoodApi({ fetchImpl });
    await api.getFoodFacilities();
    const first = await api.loadClosed();
    const second = await api.loadClosed();
    assert.equal(first.length, 1);
    assert.equal(first[0].status, 'Business Closed');
    assert.equal(first[0].o.grade_score, 55);            // decoded by the overlay columns
    assert.equal(fetchImpl.calls.filter((p) => p.startsWith('data-full/closed/')).length, 1);
    assert.equal(first, second);
    // The detail merge sees closed rows too (roster grew).
    const detail = await api.getFoodFacilityDetail('C');
    assert.equal(detail.available, false);   // no fixture file — but the roster row was consulted
});

test('clicks read through one detail cache; the detail merges the roster row and decodes checklists', async () => {
    const fetchImpl = fakeFetch(goodFull());
    const api = createFoodApi({ fetchImpl });
    await api.getFoodFacilities();

    // CPH-M2: nothing is fetched on hover — the client has no prefetch at
    // all (dead = deleted); the click path is the only detail reader.
    assert.equal(typeof api.prefetchDetail, 'undefined');
    const clicked = await api.getFoodFacilityDetail('A');
    const again = await api.getFoodFacilityDetail('A');
    assert.equal(clicked, again, 'one promise, one object');
    assert.equal(fetchImpl.calls.filter((p) => p === 'data-full/facility/A.json').length, 1);
    assert.equal(fetchImpl.calls.filter((p) => p === 'data-full/standards.json').length, 1);
    assert.equal(clicked.facility.name, 'Alpha (detail)');
    assert.equal(clicked.facility.lat, 1);              // roster row merged under the detail
    assert.equal(clicked.facility.o.grade_score, 91);
    assert.deepEqual(clicked.inspections[0].checklist[0], {
        item: 1, disposition: 'OUT', category: 'Food', standard_text: 'Protected from contamination',
        compliant: false, violation: true, cos: false, repeat: true, is_sentinel: false,
    });
});

test('a failed detail is not cached; the LRU is bounded', async () => {
    const payloads = goodFull();
    const fetchImpl = fakeFetch(payloads);
    const api = createFoodApi({ fetchImpl });
    await api.getFoodFacilities();
    const miss = await api.getFoodFacilityDetail('MISSING');
    assert.equal(miss.available, false);
    const missAgain = await api.getFoodFacilityDetail('MISSING');
    assert.equal(missAgain.available, false);
    // Two attempts, two fetches: the miss was not cached.
    assert.equal(fetchImpl.calls.filter((p) => p === 'data-full/facility/MISSING.json').length, 2);
    // Fill past the cap: the oldest entry is evicted and re-fetched.
    for (let i = 0; i < DETAIL_CACHE_SIZE + 5; i++) {
        payloads[`data-full/facility/X${i}.json`] = { available: true, facility: { permit_id: `X${i}` }, inspections: [] };
        await api.getFoodFacilityDetail(`X${i}`);
    }
    await api.getFoodFacilityDetail('X0');
    assert.equal(fetchImpl.calls.filter((p) => p === 'data-full/facility/X0.json').length, 2, 'X0 was evicted and re-read');
});

test('detail before any full manifest reports the tier honestly', async () => {
    const api = createFoodApi({ fetchImpl: fakeFetch({}), forceLite: true });
    const detail = await api.getFoodFacilityDetail('A');
    assert.equal(detail.available, false);
    assert.match(detail.reason, /Contract V4 manifest unavailable/);
    assert.deepEqual(await api.loadClosed(), []);
});

test('forced lite loads the V4 public finder and carries manifest freshness', async () => {
    const fetchImpl = fakeFetch({
        'data/manifest.json': liteManifest,
        'data/finder/00-public.json': liteShard,
    });
    const result = await createFoodApi({ fetchImpl, forceLite: true }).getFoodFacilities();
    assert.equal(result.snapshot_id, 'lite-1');
    assert.equal(result.freshness.newest_report, '2026-08-07');
    assert.deepEqual(result.facilities.map((f) => f.permit_id), ['public']);
    assert.deepEqual(fetchImpl.calls, ['data/manifest.json', 'data/finder/00-public.json']);
});

test('a public finder shard is not loaded without its V4 manifest, and V3 public data is refused', async () => {
    const noManifest = fakeFetch({ 'data/finder/00-public.json': liteShard });
    const missing = await createFoodApi({ fetchImpl: noManifest, forceLite: true }).getFoodFacilities();
    assert.equal(missing.available, false);
    assert.deepEqual(noManifest.calls, ['data/manifest.json']);

    const v3 = fakeFetch({
        'data/manifest.json': { ...liteManifest, contract: 'cleanplateva.finder-manifest.v3', schema_version: 3 },
        'data/finder/00-public.json': liteShard,
    });
    const refused = await createFoodApi({ fetchImpl: v3, forceLite: true }).getFoodFacilities();
    assert.equal(refused.available, false);
    assert.deepEqual(v3.calls, ['data/manifest.json']);
});
