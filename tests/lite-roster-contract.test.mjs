/** The COMMITTED public finder shard set's shape -- a data tripwire.
 *
 * `cf_export_site.py --mode lite` writes content-addressed shards plus a small
 * mutable manifest. A stale publishing checkout can otherwise overwrite the
 * live data contract while CouchDB remains perfectly healthy. Assertions are
 * structural, never snapshot counts: ordinary data refreshes stay green.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dataUrl = new URL('../public/data/', import.meta.url);
const finderUrl = new URL('finder/', dataUrl);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dataUrl), 'utf8'));
const descriptors = manifest.resources?.finder?.shards || [];
const shardFiles = readdirSync(finderUrl).filter((name) => name.endsWith('.json')).sort();
const shards = descriptors.map((descriptor) => {
    const bytes = readFileSync(new URL(descriptor.path, dataUrl));
    return { descriptor, bytes, payload: JSON.parse(bytes) };
});
const facilities = shards.flatMap(({ payload }) => payload.facilities);

// The lite identity contract (cf_export_site._shape_lite). Judgment fields
// are absent BY DESIGN -- lite is a finder, not a grader.
const FIELDS = [
    'address', 'address2', 'approx', 'city', 'is_restaurant', 'lat', 'lon',
    'mobile', 'name', 'permit_id', 'tenant', 'zip',
];

test('the committed public read model is manifest-led and shard-only', () => {
    assert.equal(manifest.contract, 'cleanplateva.finder-manifest.v2');
    assert.equal(manifest.schema_version, 2);
    assert.equal(manifest.available, true);
    assert.equal(manifest.mode, 'lite');
    assert.deepEqual(Object.keys(manifest.resources.finder), ['shards']);
    assert.equal(descriptors.length, 16);
    assert.equal(existsSync(new URL('facilities.json', dataUrl)), false,
        'the retired public monolith must not be committed');
    assert.deepEqual(
        descriptors.map(({ path }) => path.replace(/^finder\//, '')).sort(),
        shardFiles,
        'manifest and committed finder directory must describe the same generation',
    );
});

test('every shard has the exact V2 contract and matches its descriptor', () => {
    for (const { descriptor, bytes, payload } of shards) {
        assert.match(descriptor.path, /^finder\/[0-9a-f]{2}-[0-9a-f]{12}\.json$/);
        assert.equal(payload.contract, 'cleanplateva.finder-shard.v2');
        assert.equal(payload.schema_version, 2);
        assert.equal(payload.bucket, descriptor.bucket.toString(16).padStart(2, '0'));
        assert.equal('fetched_at' in payload, false,
            'content-addressed shards must stay byte-stable when data is unchanged');
        assert.equal(descriptor.records, payload.facilities.length);
        assert.equal(descriptor.bytes, bytes.byteLength);
        assert.equal(descriptor.sha256,
            createHash('sha256').update(bytes).digest('hex'));
    }
    assert.ok(facilities.length > 1000,
        `only ${facilities.length} facilities -- a truncated export?`);
    assert.equal(manifest.counts.total, facilities.length);
});

test('every record carries exactly the 12-field lite contract', () => {
    const permits = new Set();
    for (const facility of facilities) {
        assert.deepEqual(Object.keys(facility).sort(), FIELDS, facility.permit_id);
        assert.equal(permits.has(facility.permit_id), false,
            `duplicate permit ${facility.permit_id} across public shards`);
        permits.add(facility.permit_id);
    }
});

test('mobile is a real boolean and actually flags trucks', () => {
    let trucks = 0;
    for (const facility of facilities) {
        assert.equal(typeof facility.mobile, 'boolean', facility.permit_id);
        if (facility.mobile) trucks++;
    }
    assert.ok(trucks > 100,
        `only ${trucks} mobile units flagged -- the mobile predicate looks broken`);
    assert.ok(trucks < facilities.length * 0.25,
        `${trucks} of ${facilities.length} flagged mobile -- over-matching?`);
});

test('tenant routes the VDH permit link to the right district', () => {
    let districted = 0;
    for (const facility of facilities) {
        assert.equal(typeof facility.tenant, 'string', facility.permit_id);
        assert.match(facility.tenant, /^(virginia|va-[a-z-]+)$/, facility.permit_id);
        if (facility.tenant !== 'virginia') districted++;
    }
    assert.ok(districted > facilities.length * 0.5,
        `only ${districted} of ${facilities.length} district-claimed`);
});

test('no judgment field leaked into the public tier', () => {
    const banned = ['grade', 'score_trend', 'trend', 'latest',
        'latest_assessment', 'status', 'permit_type', 'declining',
        'inspection_count', 'newly_permitted'];
    for (const facility of facilities) {
        for (const key of banned) {
            assert.ok(!(key in facility),
                `${key} leaked onto lite record ${facility.permit_id}`);
        }
    }
});
