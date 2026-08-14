/** Same-coordinate stacks and the web they fan out into.
 *
 *  VDH hands many permits one point, and until this arc every one of them but
 *  the topmost was unreachable — measured at 3,059 markers across the 2026-08
 *  Lite roster. Facilities sharing a coordinate now collapse into one stack
 *  feature carrying its count, and clicking it rings the members out at pixel
 *  offsets.
 *
 *  Two invariants carry the most weight here:
 *
 *  - Grouping is EXACT. A metre-scale tolerance would turn a stable key into
 *    transitive clustering, which is the order-dependence trap cannon-food's
 *    merge arc already lost once. This suite pins the exactness so a later
 *    "just round it a bit" cannot pass quietly.
 *  - Every feature carries `stack`, including lone places. The cluster count
 *    sums that property, so a missing one would make `['+', ['get','stack']]`
 *    accumulate null and a cluster over a food court would undercount by 56.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('../public/static/js/foodDashboard.js', import.meta.url),
    'utf8',
);
const dashboard = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const proto = dashboard.FoodDashboard.prototype;
const { stackKey, stackRadius, stackRingIcon, spiderOffsets } = dashboard;

/** A dashboard with just enough state for the paint + grouping methods; the
 *  constructor wants a DOM and localStorage, and none of this needs either. */
const dash = (mode = 'full') => Object.assign(Object.create(proto), {
    _mode: mode,
    _stacks: new Map(),
});

const fac = (id, lat, lon, extra = {}) => ({
    permit_id: id,
    name: id,
    status: 'Permitted',
    location: { lat, lon },
    ...extra,
});
const graded = (id, lat, lon, score, extra = {}) =>
    fac(id, lat, lon, { grade: { score, letter: null }, ...extra });

/** Seats per concentric ring, derived back out of the offsets. */
const ringSeats = (offsets) => {
    const byRadius = new Map();
    for (const [x, y] of offsets) {
        const r = Math.round(Math.hypot(x, y));
        byRadius.set(r, (byRadius.get(r) || 0) + 1);
    }
    return [...byRadius.entries()].sort((a, b) => a[0] - b[0]);
};

// ── coordinate identity ────────────────────────────────────────────────

test('the stack key is exact, not a tolerance', () => {
    assert.equal(stackKey(37.5, -77.4), stackKey(37.5, -77.4));
    // ~1.1m apart in latitude. Same building, different provider — and still
    // deliberately NOT the same stack. Fixing that belongs in the location
    // layer, not in a rendering radius.
    assert.notEqual(stackKey(37.500000, -77.4), stackKey(37.500010, -77.4));
});

test('the key survives float noise below the sixth decimal', () => {
    assert.equal(stackKey(37.4425393824, -79.1203130571),
        stackKey(37.4425393811, -79.1203130588));
});

test('longitude leads the key, matching the refinement editor', () => {
    assert.equal(stackKey(37.5, -77.4), '-77.400000|37.500000');
});

// ── ring geometry ──────────────────────────────────────────────────────

test('a lone place needs no ring', () => {
    assert.deepEqual(spiderOffsets(1), [[0, 0]]);
});

test('every member gets a seat, at every size', () => {
    for (const n of [2, 3, 7, 9, 10, 11, 28, 37, 48, 57, 113]) {
        assert.equal(spiderOffsets(n).length, n, `count ${n}`);
    }
});

test('Dulles seats 57 across four balanced rings, no strays', () => {
    const seats = ringSeats(spiderOffsets(57));
    assert.deepEqual(seats, [[26, 6], [48, 11], [70, 17], [92, 23]]);
    // The greedy fill this replaced put 9/16/24 in the first three rings and
    // stranded the last 8 alone out at r=92. Nothing may be that lonely: the
    // outermost ring is the widest, so it should hold the MOST seats.
    const counts = seats.map(([, n]) => n);
    assert.equal(counts[counts.length - 1], Math.max(...counts));
});

test('the commissary case stays balanced too', () => {
    const seats = ringSeats(spiderOffsets(113));
    assert.equal(seats.reduce((sum, [, n]) => sum + n, 0), 113);
    const counts = seats.map(([, n]) => n);
    // Monotonic outward — a ring is never fuller than one outside it.
    assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
});

test('rings step outward by 22px from 26px', () => {
    const radii = ringSeats(spiderOffsets(57)).map(([r]) => r);
    assert.deepEqual(radii, [26, 48, 70, 92]);
});

test('coarse-pointer spacing seats fewer per ring', () => {
    // 10px-radius markers are 20px across, so the mouse spacing would overlap.
    const mouse = ringSeats(spiderOffsets(30, { spacing: 18 })).length;
    const touch = ringSeats(spiderOffsets(30, { spacing: 24 })).length;
    assert.ok(touch >= mouse, 'wider spacing needs at least as many rings');
    assert.equal(spiderOffsets(30, { spacing: 24 }).length, 30);
});

test('a two-place stack opens straight across', () => {
    const [a, b] = spiderOffsets(2);
    assert.ok(Math.abs(a[0] + b[0]) < 1e-9 && Math.abs(a[1] + b[1]) < 1e-9,
        'opposed through the anchor');
});

// ── ring icon ids ──────────────────────────────────────────────────────

test('the halo icon id pairs the summary colour with the core size', () => {
    assert.equal(stackRadius(2), 11);
    assert.equal(stackRadius(10), 13);
    assert.equal(stackRadius(57), 15);
    assert.equal(stackRingIcon('A', 2), 'stack-ring-A-11');
    assert.equal(stackRingIcon('lite', 57), 'stack-ring-lite-15');
});

// ── grouping ───────────────────────────────────────────────────────────

test('facilities on one point become one feature carrying the count', () => {
    const d = dash();
    const { features } = d._toGeoJSON([
        graded('a', 37.5, -77.4, 95),
        graded('b', 37.5, -77.4, 85),
        graded('c', 37.6, -77.4, 75),
    ]);
    assert.equal(features.length, 2);
    const stack = features.find((f) => f.properties.stack > 1);
    const lone = features.find((f) => f.properties.stack === 1);
    assert.equal(stack.properties.stack, 2);
    assert.equal(stack.properties.skey, stackKey(37.5, -77.4));
    assert.equal(stack.geometry.coordinates[0], -77.4);
    assert.ok(stack.properties.ring.startsWith('stack-ring-'));
    // A lone place draws no halo.
    assert.equal(lone.properties.ring, '');
});

test('the members stay reachable for the spiderfy', () => {
    const d = dash();
    d._toGeoJSON([graded('a', 37.5, -77.4, 95), graded('b', 37.5, -77.4, 85)]);
    const group = d._stacks.get(stackKey(37.5, -77.4));
    assert.deepEqual(group.members.map((m) => m.permit_id), ['a', 'b']);
    assert.equal(group.lat, 37.5);
});

test('every feature carries stack, so the cluster sum cannot accumulate null', () => {
    const d = dash();
    const { features } = d._toGeoJSON([
        graded('a', 37.5, -77.4, 95),
        graded('b', 37.5, -77.4, 85),
        graded('c', 37.6, -77.4, 75),
    ]);
    for (const f of features) {
        assert.equal(typeof f.properties.stack, 'number');
        assert.ok(f.properties.stack >= 1);
    }
    const sum = features.reduce((n, f) => n + f.properties.stack, 0);
    assert.equal(sum, 3, 'the places, not the points drawn');
});

test('an unlocated facility is dropped rather than stacked at null island', () => {
    const d = dash();
    const { features } = d._toGeoJSON([
        graded('a', 37.5, -77.4, 95),
        { permit_id: 'b', status: 'Permitted', location: {} },
        { permit_id: 'c', status: 'Permitted' },
    ]);
    assert.equal(features.length, 1);
});

test('a lone feature is painted exactly as its own marker', () => {
    const d = dash();
    const f = graded('a', 37.5, -77.4, 95);
    const { features } = d._toGeoJSON([f]);
    const paint = d._markerPaint(f);
    // The spider legs read _markerPaint directly, so this equality is what
    // keeps a fanned-out dot the same colour as the dot it came from.
    assert.equal(features[0].properties.fill, paint.fill);
    assert.equal(features[0].properties.fillOpacity, paint.fillOpacity);
    assert.equal(features[0].properties.strokeW, paint.strokeW);
});

// ── stack summary colour ───────────────────────────────────────────────

test('a stack wears the mean grade of the places inside it', () => {
    const d = dash();
    // 95 and 65 average to 80 — a B, which neither member is.
    const look = d._stackAppearance([
        graded('a', 37.5, -77.4, 95),
        graded('b', 37.5, -77.4, 65),
    ]);
    assert.equal(look.ringKey, 'B');
    assert.equal(look.fillOpacity, 0.88);
});

test('closed permits are left out of the mean', () => {
    const d = dash();
    const live = graded('a', 37.5, -77.4, 95);
    const shut = graded('b', 37.5, -77.4, 35, { status: 'Business Closed' });
    // A shuttered restaurant's last grade is not a fact about the address.
    assert.equal(d._stackAppearance([live, shut]).ringKey, 'A');
    assert.equal(d._stackAppearance([live]).ringKey, 'A');
});

test('an all-closed stack reads closed, dimmed like a closed marker', () => {
    const d = dash();
    const look = d._stackAppearance([
        graded('a', 37.5, -77.4, 95, { status: 'Business Closed' }),
        graded('b', 37.5, -77.4, 85, { status: 'Expired' }),
    ]);
    assert.equal(look.ringKey, 'closed');
    assert.equal(look.fillOpacity, 0.42);
});

test('an ungraded stack reads unscored, or new when every place is', () => {
    const d = dash();
    assert.equal(d._stackAppearance([
        fac('a', 37.5, -77.4, { newly_permitted: true }),
        fac('b', 37.5, -77.4, { newly_permitted: true }),
    ]).ringKey, 'new');
    // One un-graded non-new permit is enough to make "new" a lie.
    assert.equal(d._stackAppearance([
        fac('a', 37.5, -77.4, { newly_permitted: true }),
        fac('b', 37.5, -77.4),
    ]).ringKey, 'none');
});

// ── the web's lifetime ─────────────────────────────────────────────────

test('an open web is torn down whenever its ground shifts', () => {
    // The legs are DOM markers; setData knows nothing about them, so every
    // path that can dissolve or re-count a stack has to say so explicitly.
    assert.match(source, /_rebuildMarkers\(\) \{[\s\S]{0,700}?_dismissSpider\(\);/);
    // A style swap tears down the layers _setStackFilter needs to restore.
    assert.match(source, /_dismissSpider\(\);[\s\S]{0,200}?this\._styleIsDark = dark;/);
    assert.match(source, /_expandStack\(key\) \{[\s\S]{0,300}?this\._dismissSpider\(\);/);
});

test('a click on empty map closes the web without racing the layer handler', () => {
    assert.match(source, /queryRenderedFeatures\(e\.point, \{ layers: \[LYR_STACKS\] \}\)/);
    assert.match(source, /e\.key === 'Escape' && this\._spider && !this\._receiptHost/);
});

test('a leg click does not also read as a click on empty map', () => {
    // Markers are DOM siblings of the canvas: without this the selection and
    // the dismissal would land on the same click.
    assert.match(source, /ev\.stopPropagation\(\);/);
});

test('lite stacks stay judgment-free', () => {
    const d = dash('lite');
    const look = d._stackAppearance([
        graded('a', 37.5, -77.4, 95),
        graded('b', 37.5, -77.4, 35),
    ]);
    assert.equal(look.ringKey, 'lite');
    // Same neutral every lite marker wears — the public map locates places,
    // it does not grade them, and a stack must not become the exception.
    assert.equal(look.fill, d._markerPaint(graded('c', 37.5, -77.4, 95)).fill);
});
