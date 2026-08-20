/** The drag handle between the map and the facility panel — on both axes.
 *
 *  `.food-body` is a flex container: the map grows, the panel holds a size. The
 *  bar only sets that size, so nothing else in the layout has to know about it.
 *  Wide windows lay the two out side by side and it trades WIDTH; under 900px
 *  the body stacks and the same bar lies down and trades HEIGHT.
 *
 *  What this pins, in order of how badly it breaks when wrong:
 *
 *  1. THE AXIS IS ASKED OF THE LAYOUT, not of a copy of the breakpoint. The
 *     CSS owns 900px; a second copy in the JS is one more thing to drift.
 *
 *  2. THE MAP IS RESIZED ON EVERY DRAG FRAME. MapLibre sizes its canvas to the
 *     container it was handed, and a flex reflow is not a window resize.
 *
 *  3. THE CLAMP AND THE CSS CAP AGREE, on both axes. A handle that travels
 *     somewhere the panel refuses to follow reads as broken faster than one
 *     that stops.
 *
 *  4. THE TWO SIZES DO NOT MIX. A width remembered on a desktop must not come
 *     back as a height on a phone.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboard, moduleSource } from './support/dashboard.mjs';

const {
    clampDetailSize, clampDetailWidth, detailSizeCeiling, detailWidthCeiling,
    readStoredDetailSize, readStoredDetailWidth, SPLIT_AXES,
    DETAIL_HEIGHT_DEFAULT_FRACTION, DETAIL_HEIGHT_KEY, DETAIL_HEIGHT_MAX_FRACTION,
    DETAIL_HEIGHT_MIN, DETAIL_WIDTH_DEFAULT, DETAIL_WIDTH_KEY, DETAIL_WIDTH_MAX_FRACTION,
    DETAIL_WIDTH_MIN,
} = dashboard;
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');

const wide = SPLIT_AXES.horizontal;
const tall = SPLIT_AXES.stacked;
const storage = (value) => ({ getItem: () => value, setItem() {} });

test('each axis carries its own everything, and the two never mix', () => {
    // One description per axis, so the drag, clamp, keys and storage all read
    // from the same place instead of each branching on the layout separately.
    assert.equal(wide.prop, 'width');
    assert.equal(wide.other, 'height');
    assert.equal(tall.prop, 'height');
    assert.equal(tall.other, 'width');

    // Separate keys: these measure different things, and a width remembered on
    // a desktop must not come back as a height on a phone.
    assert.equal(wide.key, DETAIL_WIDTH_KEY);
    assert.equal(tall.key, DETAIL_HEIGHT_KEY);
    assert.notEqual(wide.key, tall.key);

    // A separator BETWEEN columns is itself vertical, and vice versa.
    assert.equal(wide.ariaOrientation, 'vertical');
    assert.equal(tall.ariaOrientation, 'horizontal');

    // The growing key points AWAY from the panel on each axis, so the divider
    // always travels the way the key does.
    assert.equal(wide.grow, 'ArrowLeft');
    assert.equal(wide.shrink, 'ArrowRight');
    assert.equal(tall.grow, 'ArrowUp');
    assert.equal(tall.shrink, 'ArrowDown');
});

test('the axis is asked of the layout, never of a second copy of 900px', () => {
    const splitter = moduleSource('splitter.js');
    assert.match(splitter, /getComputedStyle\(body\)\.flexDirection === 'column'/);
    // The breakpoint lives in the stylesheet and nowhere in the module's CODE.
    // Comments may say 900 — explaining the arrangement is not duplicating it —
    // so the prose is stripped before asking.
    assert.match(css, /@media \(max-width: 900px\)/);
    const code = splitter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /900/);
    assert.doesNotMatch(code, /matchMedia/);
});

test('each axis is clamped between its own floor and its own share', () => {
    // Width: 1400px row → ceiling 980.
    assert.equal(clampDetailWidth(500, 1400), 500);
    // Rounded, because the size lands in a style property: 1400 * 0.7 is
    // 979.9999999999999 in floating point.
    assert.equal(clampDetailWidth(5000, 1400), Math.round(1400 * DETAIL_WIDTH_MAX_FRACTION));
    assert.equal(clampDetailWidth(10, 1400), DETAIL_WIDTH_MIN);
    assert.equal(clampDetailWidth(400, 300), DETAIL_WIDTH_MIN);   // floor beats fraction
    assert.equal(clampDetailWidth(900, 0), 900);                  // no row to measure yet
    assert.equal(clampDetailWidth(432.6, 1400), 433);

    // Height: a taller share and a lower floor, because stacked the panel is
    // the point and the map is context.
    assert.equal(clampDetailSize(400, 800, tall), 400);
    assert.equal(clampDetailSize(5000, 800, tall), Math.round(800 * DETAIL_HEIGHT_MAX_FRACTION));
    assert.equal(clampDetailSize(10, 800, tall), DETAIL_HEIGHT_MIN);
    assert.ok(tall.maxFraction > wide.maxFraction, 'stacked gives the panel more');
    assert.ok(tall.min < wide.min, 'and needs less to stay readable');

    // Junk in, the AXIS default out — never NaN into a style property.
    assert.equal(clampDetailWidth(undefined, 1400), DETAIL_WIDTH_DEFAULT);
    assert.equal(clampDetailSize(NaN, 800, tall), Math.round(800 * DETAIL_HEIGHT_DEFAULT_FRACTION));
});

test('the bar reports the ceiling it actually has', () => {
    // Asked directly, NOT by running an infinite request through the clamp:
    // that answers a non-finite request with the DEFAULT, so the separator
    // advertised aria-valuemax=400 at every window size. Caught in the
    // browser, not here — the first version of this suite asserted only that
    // the attribute existed, never its value.
    assert.equal(detailWidthCeiling(1400), 980);
    assert.equal(detailWidthCeiling(300), DETAIL_WIDTH_MIN);   // floor beats fraction
    assert.equal(detailWidthCeiling(0), Number.POSITIVE_INFINITY);
    assert.equal(detailSizeCeiling(800, tall), 640);
    assert.notEqual(detailWidthCeiling(1400), DETAIL_WIDTH_DEFAULT);
    const splitter = moduleSource('splitter.js');
    assert.match(splitter, /if \(Number\.isFinite\(ceiling\)\) bar\.setAttribute\('aria-valuemax'/);
});

test('a stored size is a preference, not state to trust', () => {
    assert.equal(readStoredDetailWidth(storage('520')), 520);
    for (const bad of [null, '', 'wide', '-40']) {
        assert.equal(readStoredDetailWidth(storage(bad)), DETAIL_WIDTH_DEFAULT, `"${bad}"`);
    }
    // Private mode throws on read rather than returning null.
    assert.equal(readStoredDetailWidth({ getItem() { throw new Error('denied'); } }),
        DETAIL_WIDTH_DEFAULT);
    assert.equal(readStoredDetailWidth(undefined), DETAIL_WIDTH_DEFAULT);

    // Stacked falls back to a SHARE of the row, not a pixel count: 60% is what
    // the stacked layout always gave the panel, and a fraction travels between
    // screens where a pixel count does not.
    assert.equal(readStoredDetailSize(storage(null), tall, 800),
        Math.round(800 * DETAIL_HEIGHT_DEFAULT_FRACTION));
    assert.equal(readStoredDetailSize(storage('330'), tall, 800), 330);
    assert.equal(DETAIL_WIDTH_KEY, 'cleanplateva.detailWidth');
    assert.equal(DETAIL_HEIGHT_KEY, 'cleanplateva.detailHeight');
});

test('crossing the breakpoint re-reads that axis, and clears the other property', () => {
    const splitter = moduleSource('splitter.js');
    // A stale inline width would fight the stacked layout, and vice versa.
    assert.match(splitter, /panel\.style\[axis\.other\] = '';/);
    assert.match(splitter, /panel\.style\[axis\.prop\] = `\$\{size\}px`;/);
    // Two triggers, because they catch different things and re-applying is
    // idempotent: the observer sees the ROW change for any reason and runs
    // after layout, the window event covers a viewport change without it.
    // NEITHER is verifiable in the preview pane — it never paints, so
    // ResizeObserver callbacks are never delivered, and its resize tool moves
    // the viewport without dispatching `resize` (both measured at zero). What
    // IS verified is the handler itself: called by hand while stacked it
    // switches the orientation, clears the width and restores the stored
    // height. So this pair is reasoned; the work it does is tested.
    assert.match(splitter, /new ResizeObserver\(\(\) => this\._restoreDetailSize\(\)\)\.observe\(body\)/);
    assert.match(splitter, /window\.addEventListener\('resize', \(\) => this\._restoreDetailSize\(\)\)/);
    assert.match(splitter, /_restoreDetailSize\(\) \{[\s\S]{0,260}?readStoredDetailSize\(/);
});

test('the map is resized as the bar moves, not once it stops', () => {
    const splitter = moduleSource('splitter.js');
    assert.match(splitter, /frame = requestAnimationFrame\(\(\) => \{ frame = 0; this\._map\?\.resize\(\); \}\)/);
    // rAF-throttled, so a fast drag does not queue a resize per pointer event.
    assert.match(splitter, /if \(!frame\) \{/);
    // And once more at the end, since the last frame may be mid-flight.
    assert.match(splitter, /const end = \(e\) => \{[\s\S]{0,320}?this\._map\?\.resize\(\);/);
});

test('the clamp and the CSS cap cannot disagree, on either axis', () => {
    assert.equal(DETAIL_WIDTH_MAX_FRACTION, 0.7);
    assert.match(css, /\.food-detail \{[\s\S]{0,700}?max-width: 70%;/);
    assert.match(css, /\.food-detail \{[\s\S]{0,700}?flex: 0 0 auto;/);
    // Stacked, the cap is on the other axis and mirrors the other constant.
    assert.equal(DETAIL_HEIGHT_MAX_FRACTION, 0.8);
    assert.match(css, /@media \(max-width: 900px\)[\s\S]{0,900}?max-height: 80%;/);
    // Both are measured against the row's CONTENT box, not clientWidth —
    // padding put them 22px apart once.
    const splitter = moduleSource('splitter.js');
    assert.match(splitter, /export function rowContentSize\(el, prop = 'width'\)/);
    assert.match(splitter, /\['paddingTop', 'paddingBottom'\] : \['paddingLeft', 'paddingRight'\]/);
});

test('the bar lies down when the body stacks, rather than standing down', () => {
    // It used to be display:none below 900px. Same 10px target, same grip,
    // rotated — and the cursor turns with it.
    const stacked = css.match(/@media \(max-width: 900px\)\s*\{[\s\S]*?\n\}/)[0];
    assert.match(stacked, /\.food-splitter \{[\s\S]{0,200}?height: 10px;/);
    assert.match(stacked, /cursor: row-resize;/);
    assert.match(stacked, /\.food-splitter-grip \{ width: 56px; height: 4px; \}/);
    assert.doesNotMatch(stacked, /\.food-splitter \{ display: none; \}/);
    // The panel no longer needs `!important` to beat a stale inline width,
    // because the module clears whichever property the axis does not own.
    assert.doesNotMatch(stacked, /width: 100% !important/);
    // Closed panel still means no divider, on both axes.
    assert.match(css, /\.food-body:has\(\.food-detail\.d-none\) \.food-splitter \{ display: none; \}/);
});

test('the grip is a short handle, and it emphasises by tone not by hue', () => {
    // A rule running the full height of the row reads as a border belonging to
    // one of its neighbours, and at the accent colour it read as a selection.
    // The 10px box stays the TARGET; only the pill inside it is drawn.
    assert.match(css, /\.food-splitter-grip \{[\s\S]{0,200}?height: 56px;/);
    assert.match(css, /\.food-splitter-grip \{[\s\S]{0,200}?border-radius: 999px;/);
    assert.doesNotMatch(css, /\.food-splitter[^}]*background-size/);

    // Hover, focus and drag lift the SAME grip one step toward the foreground.
    // Measured on production with transitions disabled — dark #2a3140 →
    // #97a1b3, light #dee2e6 → #5f6b7a, size and radius unchanged.
    assert.match(css, /body\.is-splitting \.food-splitter-grip \{\s*background: var\(--cp-muted\);/);
    assert.match(css, /\.food-splitter-grip \{[\s\S]{0,200}?background: var\(--cp-border\);/);
    assert.doesNotMatch(css, /\.food-splitter-grip[^}]*--cp-accent/);

    // A real element rather than a ::before. The grip's appearance IS the
    // feature, and a pseudo-element's computed style cannot be read back.
    assert.match(html, /<span class="food-splitter-grip" aria-hidden="true"><\/span>/);
    assert.doesNotMatch(css, /\.food-splitter::before/);
});

test('it is a real separator, and it is reachable', () => {
    assert.match(html, /id="foodSplitter" role="separator"/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /aria-label="Resize the facility panel"/);
    const splitter = moduleSource('splitter.js');
    // Keyed off the axis, so the same handler serves both layouts.
    assert.match(splitter, /if \(e\.key === axis\.grow\) next = size \+ step/);
    assert.match(splitter, /else if \(e\.key === axis\.shrink\) next = size - step/);
    // The orientation is corrected whenever the size is applied, so it is
    // right after a breakpoint crossing and not only at first paint.
    assert.match(splitter, /bar\.setAttribute\('aria-orientation', axis\.ariaOrientation\)/);
    // Double-click restores that axis's default — the escape hatch for a
    // divider dragged somewhere regrettable.
    assert.match(splitter, /addEventListener\('dblclick'[\s\S]{0,200}?axis\.defaultSize/);
});

test('the grip is measured, not derived, so the bar tracks the cursor', () => {
    // The bar carries negative margins so it sits IN the gap rather than
    // widening it, which makes the distance from its centre to the panel's
    // edge a function of gap, margin and border. Computing it by hand left the
    // bar drifting 7px behind the cursor (measured); taking it at grab time
    // makes the grip land wherever the visitor took hold — on either axis.
    const splitter = moduleSource('splitter.js');
    assert.match(splitter, /panelBox\.top - \(barBox\.top \+ barBox\.height \/ 2\)/);
    assert.match(splitter, /panelBox\.left - \(barBox\.left \+ barBox\.width \/ 2\)/);
    assert.match(splitter, /- e\.clientY - grip/);
    assert.match(splitter, /- e\.clientX - grip/);
    assert.match(css, /\.food-splitter \{[\s\S]{0,400}?margin: 0 -0\.425rem;/);
});

test('the drag surface is the window, not the 10px bar', () => {
    // Without this the cursor flickers between elements mid-drag and the
    // pointer selects text on its way across the map.
    assert.match(css, /body\.is-splitting \{ cursor: col-resize; user-select: none; \}/);
    const splitter = moduleSource('splitter.js');
    // Capture keeps the drag alive when the pointer outruns a 10px bar, but a
    // refused capture must not refuse the drag.
    assert.match(splitter, /try \{ bar\.setPointerCapture\(e\.pointerId\); \} catch/);
    assert.match(splitter, /addEventListener\('pointercancel', end\)/);
});
