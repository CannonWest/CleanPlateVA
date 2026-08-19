/** Forgiving marker targeting — the slop, and who wins when marks overlap.
 *
 *  You should not have to land on a 7px dot exactly, so pointer events are
 *  resolved against a box padded by `hitSlop` and `pickMark` settles the
 *  overlaps. Two rules, and the first one is what makes this safe to ship:
 *
 *  1. ON TARGET IS UNCHANGED. If the pointer is genuinely inside a mark, the
 *     answer is whatever the map paints on top — stack over lone dot over
 *     cluster — which is exactly what MapLibre's layer-scoped events gave
 *     before any of this existed. Slop only ever ADDS reach.
 *
 *  2. OFF TARGET, NEAREST EDGE WINS. Not nearest centre — a mark's centre is
 *     not where anyone is pointing, its rim is what they see. Measured from
 *     centres, a cursor 6px off a big cluster's rim answers with a small dot
 *     8px off its own, purely because the dot's middle is nearer. Edge gap
 *     answers with the thing the cursor is nearly touching.
 *
 *  The radii are shared with the layer paint (constants.js) rather than
 *  restated here. A hit test that disagrees with what is drawn is worse than
 *  no hit test at all — the map stops answering where it looks like it should.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboard, moduleSource } from './support/dashboard.mjs';

const {
    clusterRadius, hitSlop, markRadius, pickMark, pointRadius,
    HIT_SLOP_COARSE, HIT_SLOP_FINE, POINT_RADIUS_COARSE, POINT_RADIUS_FINE, CLUSTER_RADII,
} = dashboard;

const POINTS = 'food-points';
const STACKS = 'food-stacks';
const CLUSTERS = 'food-clusters';

/** A candidate `d` pixels away from the pointer, along x. */
const at = (layerId, d, radius, tag) => ({ layerId, dx: d, dy: 0, radius, tag });

test('slop turns a 7px dot into roughly a 17px target', () => {
    assert.equal(pointRadius(false), POINT_RADIUS_FINE);
    assert.equal(pointRadius(true), POINT_RADIUS_COARSE);
    assert.equal(hitSlop(false), HIT_SLOP_FINE);
    assert.equal(hitSlop(true), HIT_SLOP_COARSE);

    const dot = (d) => pickMark([at(POINTS, d, POINT_RADIUS_FINE)], HIT_SLOP_FINE);
    assert.ok(dot(0)?.inside, 'dead centre');
    assert.ok(dot(7)?.inside, 'on the edge is still inside');
    assert.ok(dot(12) && !dot(12).inside, 'past the edge but within slop');
    assert.ok(dot(17), 'gap === slop is a hit, by this function');
    assert.equal(dot(17.5), null, 'beyond slop, nothing');
    // Live, the reach is one pixel tighter than this function allows, and on
    // purpose: `queryRenderedFeatures` only offers candidates whose DRAWN
    // circle intersects the padded box, so a mark exactly `slop` past its own
    // edge is never even a candidate. Measured against a real map (Playwright,
    // an isolated marker 139px from its nearest neighbour): the card opens at
    // 0 / 12 / 15px and not at 17px. The box is the honest gate — it scales
    // with each mark's radius for free — so this function stays inclusive and
    // the query decides the last pixel.
    // A fingertip reaches further, from a bigger dot.
    const tap = (d) => pickMark([at(POINTS, d, POINT_RADIUS_COARSE)], HIT_SLOP_COARSE);
    assert.ok(tap(26), 'coarse: 10px dot + 16px slop');
    assert.equal(tap(26.5), null);
});

test('on target, the painted order decides — exactly as before slop existed', () => {
    // Pointer inside BOTH a stack and a lone dot. The stack is painted above,
    // so the stack is what was clicked, even though the dot's centre is nearer.
    const winner = pickMark([
        at(POINTS, 2, POINT_RADIUS_FINE, 'dot'),
        at(STACKS, 6, 11, 'stack'),
    ], HIT_SLOP_FINE);
    assert.equal(winner.tag, 'stack');
    assert.ok(winner.inside);

    // Inside a dot and inside a cluster → the dot, which paints above.
    assert.equal(pickMark([
        at(CLUSTERS, 3, CLUSTER_RADII[0], 'cluster'),
        at(POINTS, 5, POINT_RADIUS_FINE, 'dot'),
    ], HIT_SLOP_FINE).tag, 'dot');

    // Two lone dots overlapping: same layer, so the centre-most wins.
    assert.equal(pickMark([
        at(POINTS, 6, POINT_RADIUS_FINE, 'far'),
        at(POINTS, 1, POINT_RADIUS_FINE, 'near'),
    ], HIT_SLOP_FINE).tag, 'near');
});

test('being ON a mark always beats being merely NEAR a closer-ranked one', () => {
    // The pointer sits inside a cluster and 3px outside a dot. Before slop the
    // cluster is simply what was clicked; slop must not quietly change that.
    const winner = pickMark([
        at(CLUSTERS, 4, CLUSTER_RADII[0], 'cluster'),
        at(POINTS, 10, POINT_RADIUS_FINE, 'dot'),
    ], HIT_SLOP_FINE);
    assert.equal(winner.tag, 'cluster');
    assert.ok(winner.inside);

    // ...and discovery order must not matter. This is the pair that actually
    // needs the rule: an OUTSIDE mark that outranks an INSIDE one, met first.
    // Without "inside beats near" the higher-ranked outside dot holds the win
    // and slop silently steals a click that was dead on the cluster.
    const reversed = pickMark([
        at(POINTS, 10, POINT_RADIUS_FINE, 'dot'),          // outside, rank 2
        at(CLUSTERS, 4, CLUSTER_RADII[0], 'cluster'),      // inside,  rank 1
    ], HIT_SLOP_FINE);
    assert.equal(reversed.tag, 'cluster');
    assert.ok(reversed.inside);

    // The same trap one rank down: an outside stack met before an inside dot.
    const alsoReversed = pickMark([
        at(STACKS, 18, 11, 'stack'),                       // outside, rank 3
        at(POINTS, 5, POINT_RADIUS_FINE, 'dot'),           // inside,  rank 2
    ], HIT_SLOP_FINE);
    assert.equal(alsoReversed.tag, 'dot');
    assert.ok(alsoReversed.inside);
});

test('off target, nearest EDGE wins — not nearest centre', () => {
    // The case that separates the two rules. By CENTRE the dot is nearer
    // (15 vs 28) and would win; by EDGE the cursor is 6px off the cluster's
    // rim and 8px off the dot's, so the cluster — the thing it is nearly
    // touching — is the honest answer. Both are inside slop, so both compete.
    const winner = pickMark([
        at(POINTS, 15, POINT_RADIUS_FINE, 'dot'),        // centre 15, edge gap 8
        at(CLUSTERS, 28, CLUSTER_RADII[2], 'cluster'),   // centre 28, edge gap 6
    ], HIT_SLOP_FINE);
    assert.equal(winner.tag, 'cluster', 'nearer rim, further centre');
    assert.ok(!winner.inside);
    assert.equal(Math.round(winner.gap), 6);

    // The rule is not "the big mark always wins": when the dot's rim is the
    // nearer one, the dot takes it.
    const fair = pickMark([
        at(CLUSTERS, 30, CLUSTER_RADII[2], 'cluster'),   // edge gap 8
        at(POINTS, 10, POINT_RADIUS_FINE, 'dot'),        // edge gap 3
    ], HIT_SLOP_FINE);
    assert.equal(fair.tag, 'dot');

    // Two dots side by side — the ordinary dense-map case, decided by distance.
    const dense = pickMark([
        at(POINTS, 16, POINT_RADIUS_FINE, 'far'),        // edge gap 9
        at(POINTS, 13, POINT_RADIUS_FINE, 'near'),       // edge gap 6
    ], HIT_SLOP_FINE);
    assert.equal(dense.tag, 'near');
});

test('ties fall back to the painted order, and misses return null', () => {
    // Identical edge gaps → the higher layer, so the answer is never arbitrary.
    assert.equal(pickMark([
        at(POINTS, 12, POINT_RADIUS_FINE, 'dot'),        // gap 5
        at(STACKS, 16, 11, 'stack'),                     // gap 5
    ], HIT_SLOP_FINE).tag, 'stack');
    assert.equal(pickMark([], HIT_SLOP_FINE), null);
    assert.equal(pickMark([at(POINTS, 100, POINT_RADIUS_FINE)], HIT_SLOP_FINE), null);
});

test('the hit test measures against the radii the layers actually paint', () => {
    // Cluster radius is stepped by PLACES (`sum`), the same value the label
    // counts and the same expression the layer is built from.
    assert.equal(clusterRadius(1), CLUSTER_RADII[0]);
    assert.equal(clusterRadius(9), CLUSTER_RADII[0]);
    assert.equal(clusterRadius(10), CLUSTER_RADII[1]);
    assert.equal(clusterRadius(49), CLUSTER_RADII[1]);
    assert.equal(clusterRadius(50), CLUSTER_RADII[2]);
    assert.equal(clusterRadius(undefined), CLUSTER_RADII[0]);

    assert.equal(markRadius(CLUSTERS, { sum: 57 }, false), CLUSTER_RADII[2]);
    assert.equal(markRadius(STACKS, { stack: 57 }, false), 15);
    assert.equal(markRadius(STACKS, { stack: 2 }, false), 11);
    assert.equal(markRadius(POINTS, {}, false), POINT_RADIUS_FINE);
    assert.equal(markRadius(POINTS, {}, true), POINT_RADIUS_COARSE);

    // The layer paint is BUILT from those constants rather than repeating the
    // numbers, which is what stops the target drifting off the drawing.
    const map = moduleSource('map.js');
    assert.match(map, /CLUSTER_RADII\[0\], CLUSTER_STEPS\[0\], CLUSTER_RADII\[1\],/);
    assert.match(map, /'circle-radius': pointRadius\(this\._coarsePointer\(\)\)/);
    assert.doesNotMatch(map, /'circle-radius': window\.matchMedia/);
});

test('one padded query feeds both hover and click', () => {
    const map = moduleSource('map.js');
    // A padded box, not a bare point — that is the slop.
    assert.match(map, /const slop = hitSlop\(coarse\);/);
    assert.match(map, /point\.x - slop, point\.y - slop/);
    // Every mark type in ONE query: they have to be compared to each other,
    // which layer-scoped handlers could never do.
    assert.match(map, /\[LYR_STACKS, LYR_POINTS, LYR_CLUSTERS\]\.filter/);
    assert.match(map, /_onMapHover\(e\)[\s\S]{0,200}?_pickMarkAt\(e\.point\)/);
    assert.match(map, /_onMapClick\(e\)[\s\S]{0,200}?_pickMarkAt\(e\.point\)/);
    // The card still anchors to the MARKER, never to the pointer.
    assert.match(map, /_showHoverCard\(hit\.feature\.geometry\.coordinates\.slice\(\), f\)/);
    // No layer-scoped mouse handlers survive to disagree with the picker.
    assert.doesNotMatch(map, /map\.on\('(?:mousemove|mouseenter|mouseleave|click)', LYR_/);
});

// ── the glue between MapLibre and the picker ────────────────────────────
//
// `pickMark` is pure and covered above; what it cannot cover is the part that
// talks to the map — padding the query box, projecting each feature back to
// screen space, and dispatching the winner. A headless pane never composites,
// so `queryRenderedFeatures` returns nothing there and the real map cannot
// answer these. A fake one can, and it pins the contract either way.

const proto = dashboard.FoodDashboard.prototype;

/** `project` is the identity here, so fixture "coordinates" ARE screen pixels. */
const fakeMap = (features) => {
    const seen = { queries: [], cursor: [] };
    return {
        seen,
        getLayer: (id) => ({ id }),
        queryRenderedFeatures(geometry, opts) {
            seen.queries.push({ geometry, layers: opts.layers });
            return features;
        },
        project: ([x, y]) => ({ x, y }),
        getCanvas: () => ({ style: { set cursor(v) { seen.cursor.push(v); }, get cursor() { return ''; } } }),
    };
};
const feat = (layerId, x, y, properties = {}) => ({
    layer: { id: layerId }, geometry: { coordinates: [x, y] }, properties,
});
const ctx = (map, over = {}) => ({
    _map: map, _mapReady: true, _coarsePointer: () => false,
    _pickMarkAt: proto._pickMarkAt, _onMapHover: proto._onMapHover, _onMapClick: proto._onMapClick,
    ...over,
});

test('_pickMarkAt pads the query box and measures from projected centres', () => {
    const map = fakeMap([feat(POINTS, 112, 100, { pid: 'p1' })]);
    const hit = proto._pickMarkAt.call(ctx(map), { x: 100, y: 100 });

    // The query is a BOX, not a point — that is the slop, before any maths.
    const { geometry, layers } = map.seen.queries[0];
    assert.deepEqual(geometry, [[90, 90], [110, 110]], 'padded by HIT_SLOP_FINE');
    assert.deepEqual(layers, [STACKS, POINTS, CLUSTERS], 'every mark type, one query');

    // 12px away from a 7px dot → 5px outside it, still a hit.
    assert.equal(hit.feature.properties.pid, 'p1');
    assert.equal(Math.round(hit.gap), 5);
    assert.equal(hit.inside, false);

    // Nothing rendered nearby → no hit, and no throw.
    assert.equal(proto._pickMarkAt.call(ctx(fakeMap([])), { x: 0, y: 0 }), null);
});

test('_pickMarkAt survives a style swap mid-move', () => {
    // style.load drops the layers; a hover landing in that window must not
    // throw and must not leave a card behind.
    const exploding = { ...fakeMap([]), queryRenderedFeatures() { throw new Error('no such layer'); } };
    assert.equal(proto._pickMarkAt.call(ctx(exploding), { x: 5, y: 5 }), null);
    // No layers installed at all is the same answer.
    const bare = { ...fakeMap([]), getLayer: () => null };
    assert.equal(proto._pickMarkAt.call(ctx(bare), { x: 5, y: 5 }), null);
    // And before the first style.load there is no source to query.
    assert.equal(proto._pickMarkAt.call(ctx(fakeMap([]), { _mapReady: false }), { x: 5, y: 5 }), null);
});

test('hover dispatches by mark type, and anchors the card to the MARKER', () => {
    const f = { permit_id: 'p1', name: 'Kyoto' };
    const shown = [];
    const base = (map) => ctx(map, {
        _byPermit: new Map([['p1', f]]),
        _hideHoverCard() { shown.push(['hide']); this._hoverPid = null; },
        _showHoverCard(at, facility) { shown.push(['card', at, facility.permit_id]); },
        _hoverPopup: null, _hoverPid: null,
    });

    // A dot 12px off: within slop, so the card opens — anchored at the
    // MARKER's coordinates, never at the pointer.
    const d = base(fakeMap([feat(POINTS, 112, 100, { pid: 'p1' })]));
    proto._onMapHover.call(d, { point: { x: 100, y: 100 } });
    assert.deepEqual(shown.at(-1), ['card', [112, 100], 'p1']);

    // A cluster is a camera control, not a place: cursor only, no card.
    const c = base(fakeMap([feat(CLUSTERS, 105, 100, { sum: 40, cluster_id: 7 })]));
    proto._onMapHover.call(c, { point: { x: 100, y: 100 } });
    assert.deepEqual(shown.at(-1), ['hide']);

    // Empty map hides whatever was open.
    const e = base(fakeMap([]));
    proto._onMapHover.call(e, { point: { x: 0, y: 0 } });
    assert.deepEqual(shown.at(-1), ['hide']);
});

test('click dispatches by mark type, and anything but a stack closes the web', () => {
    const f = { permit_id: 'p1' };
    const acts = [];
    const base = (map, spider) => ctx(map, {
        _spider: spider, _byPermit: new Map([['p1', f]]),
        _hideHoverCard() {}, _dismissSpider() { acts.push('dismiss'); },
        _expandStack(key) { acts.push(`expand:${key}`); },
        _zoomToCluster(feature) { acts.push(`zoom:${feature.properties.cluster_id}`); },
        _select(facility) { acts.push(`select:${facility.permit_id}`); },
    });

    // A stack within slop opens, and does NOT dismiss its own web first.
    proto._onMapClick.call(base(fakeMap([feat(STACKS, 118, 100, { skey: 'k', stack: 4 })]), { key: 'k' }),
        { point: { x: 100, y: 100 } });
    assert.deepEqual(acts, ['expand:k']);

    // A place within slop selects — and closes an open web on the way.
    acts.length = 0;
    proto._onMapClick.call(base(fakeMap([feat(POINTS, 112, 100, { pid: 'p1' })]), { key: 'k' }),
        { point: { x: 100, y: 100 } });
    assert.deepEqual(acts, ['dismiss', 'select:p1']);

    // A cluster zooms, and also closes the web.
    acts.length = 0;
    proto._onMapClick.call(base(fakeMap([feat(CLUSTERS, 108, 100, { sum: 60, cluster_id: 9 })]), { key: 'k' }),
        { point: { x: 100, y: 100 } });
    assert.deepEqual(acts, ['dismiss', 'zoom:9']);

    // Empty map just closes it. (The open stack's own anchor is filtered out
    // of the stack layer, so it arrives here as empty map too.)
    acts.length = 0;
    proto._onMapClick.call(base(fakeMap([]), { key: 'k' }), { point: { x: 0, y: 0 } });
    assert.deepEqual(acts, ['dismiss']);

    // With no web open, empty map does nothing at all.
    acts.length = 0;
    proto._onMapClick.call(base(fakeMap([]), null), { point: { x: 0, y: 0 } });
    assert.deepEqual(acts, []);
});
