/** The COMMITTED public finder shard set's shape -- a data tripwire.
 *
 * `cf_export_site.py --mode lite --contract v4` writes content-addressed
 * shards plus a small mutable manifest. A stale publishing checkout can
 * otherwise overwrite the live data contract while CouchDB remains perfectly
 * healthy. Assertions are structural, never snapshot counts: ordinary data
 * refreshes stay green.
 *
 * Contract V4 (design ref §6.2): the finder is ONE family shared by both
 * tiers — active permits, judgment-free identity/location rows as objects at
 * 6 dp with `pt` (a code into the manifest's `vocab.permit_type`),
 * `is_restaurant`, `mobile`, and `loc` (0 rooftop · 1 street-level · 2 ZIP
 * centroid, 3 venue). The manifest carries top-level `freshness` and `vocab`.
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

// The V4 finder contract (cf_export_site._shape_finder_v4). Judgment fields
// are absent BY DESIGN -- the finder is shared by the public tier (P6).
const FIELDS = [
    'address', 'address2', 'city', 'is_restaurant', 'lat', 'loc', 'lon',
    'mobile', 'name', 'permit_id', 'pt', 'tenant', 'zip',
];

test('the committed public read model is manifest-led, shard-only, and Contract V4', () => {
    assert.equal(manifest.contract, 'cleanplateva.finder-manifest.v4');
    assert.equal(manifest.schema_version, 4);
    assert.equal(manifest.available, true);
    assert.equal(manifest.mode, 'lite');
    assert.deepEqual(Object.keys(manifest.resources), ['finder']);
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

test('the manifest states freshness and the code vocabularies', () => {
    assert.deepEqual(Object.keys(manifest.freshness).sort(), ['newest_report', 'snapshot_id']);
    assert.equal(manifest.freshness.snapshot_id, manifest.snapshot_id);
    assert.match(manifest.freshness.newest_report, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(Object.keys(manifest.vocab).sort(), ['loc', 'permit_type', 'scope']);
    // `loc` is APPEND-ONLY: a code is positional identity, so the first three
    // are frozen forever and a new class may only join the end. `venue` (3)
    // appears here once the venue-anchor arc's first publish lands; asserting
    // the frozen prefix plus a known-name check keeps this true on both sides
    // of that publish without ever permitting a renumbering.
    assert.deepEqual(manifest.vocab.loc.slice(0, 3),
        ['rooftop', 'street', 'zip_centroid']);
    assert.deepEqual(manifest.vocab.loc.slice(3).filter((n) => n !== 'venue'), [],
        'unknown loc class — the client must learn it before it is published');
    assert.deepEqual(manifest.vocab.scope, ['unknown', 'broad', 'focused']);
    assert.ok(manifest.vocab.permit_type.length >= 10, 'permit_type vocabulary looks truncated');
    assert.deepEqual([...manifest.vocab.permit_type].sort(), manifest.vocab.permit_type,
        'permit_type vocabulary is sorted (deterministic codes)');
});

test('every shard has the exact V4 contract and matches its descriptor', () => {
    for (const { descriptor, bytes, payload } of shards) {
        assert.match(descriptor.path, /^finder\/[0-9a-f]{2}-[0-9a-f]{12}\.json$/);
        assert.equal(payload.contract, 'cleanplateva.finder-shard.v4');
        assert.equal(payload.schema_version, 4);
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

test('every record carries the exact flat V4 finder row', () => {
    const permits = new Set();
    const vocabSize = manifest.vocab.permit_type.length;
    const locVocabSize = manifest.vocab.loc.length;
    for (const facility of facilities) {
        assert.deepEqual(Object.keys(facility).sort(), FIELDS, facility.permit_id);
        for (const retired of ['location', 'approx', 'geocode_source', 'precision', 'source',
            'site_lat', 'site_lon', 'site_group_id', 'site_count']) {
            assert.equal(retired in facility, false,
                `${retired} survived on V4 record ${facility.permit_id}`);
        }
        assert.equal(typeof facility.lat, 'number', facility.permit_id);
        assert.equal(typeof facility.lon, 'number', facility.permit_id);
        assert.ok(Number.isInteger(facility.loc) && facility.loc >= 0 && facility.loc < locVocabSize,
            `loc outside the manifest vocabulary on ${facility.permit_id}`);
        assert.ok(Number.isInteger(facility.pt) && facility.pt >= 0 && facility.pt < vocabSize,
            `pt outside the manifest vocabulary on ${facility.permit_id}`);
        assert.equal(permits.has(facility.permit_id), false,
            `duplicate permit ${facility.permit_id} across public shards`);
        permits.add(facility.permit_id);
    }
});

test('coordinates are published at 6 dp (D-DATA-4)', () => {
    const decimals = (n) => (String(n).split('.')[1] || '').length;
    let over = 0;
    for (const facility of facilities) {
        if (decimals(facility.lat) > 6 || decimals(facility.lon) > 6) over++;
    }
    assert.equal(over, 0, `${over} rows carry more than 6 decimal places`);
});

test('mobile is a real boolean and actually flags trucks; pt agrees with it', () => {
    let trucks = 0;
    const mobileCode = manifest.vocab.permit_type.indexOf('Mobile Food Unit');
    assert.ok(mobileCode >= 0, 'Mobile Food Unit is in the vocabulary');
    for (const facility of facilities) {
        assert.equal(typeof facility.mobile, 'boolean', facility.permit_id);
        assert.equal(facility.mobile, facility.pt === mobileCode,
            `mobile and pt disagree on ${facility.permit_id}`);
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
    const banned = ['grade', 'grade_score', 'score_trend', 'trend', 'trend_delta', 'latest',
        'latest_assessment', 'status', 'permit_type', 'declining', 'o',
        'inspection_count', 'newly_permitted', 'new', 'compliance_pct'];
    for (const facility of facilities) {
        for (const key of banned) {
            assert.ok(!(key in facility),
                `${key} leaked onto lite record ${facility.permit_id}`);
        }
    }
});
