/** The drag handle between the map and the facility panel.
 *
 *  `.food-body` is a flex row: the map grows, the panel holds a width. The bar
 *  only sets that width, so nothing else in the layout has to know about it.
 *
 *  What this pins, in order of how badly it breaks when wrong:
 *
 *  1. THE MAP IS RESIZED ON EVERY DRAG FRAME. MapLibre sizes its canvas to the
 *     container it was handed, and a flex reflow is not a window resize —
 *     without `resize()` the canvas keeps its old width and the basemap
 *     stretches. Per frame, not per drag-end, so the map tracks the bar.
 *
 *  2. THE CLAMP AND THE CSS CAP AGREE. A handle that travels somewhere the
 *     panel refuses to follow reads as broken faster than one that stops.
 *
 *  3. IT IS A REAL SEPARATOR. Focusable, arrow-key operable: a divider that
 *     only answers to a mouse is a divider half the visitors cannot move.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboard, moduleSource } from './support/dashboard.mjs';

const {
    clampDetailWidth, detailWidthCeiling, readStoredDetailWidth,
    DETAIL_WIDTH_DEFAULT, DETAIL_WIDTH_KEY, DETAIL_WIDTH_MAX_FRACTION, DETAIL_WIDTH_MIN,
} = dashboard;
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');

const storage = (value) => ({ getItem: () => value, setItem() {} });

test('the panel is clamped between a readable floor and a share of the row', () => {
    // 1400px row → ceiling 980.
    assert.equal(clampDetailWidth(500, 1400), 500);
    // Rounded, because the width lands in a style property: 1400 * 0.7 is
    // 979.9999999999999 in floating point, and a fractional width leaves a
    // seam against the map's border.
    assert.equal(clampDetailWidth(5000, 1400), Math.round(1400 * DETAIL_WIDTH_MAX_FRACTION));
    assert.equal(clampDetailWidth(10, 1400), DETAIL_WIDTH_MIN);
    // A row so narrow that the fraction falls under the floor: the floor wins,
    // because a panel too small to read is worse than one that crowds the map.
    assert.equal(clampDetailWidth(400, 300), DETAIL_WIDTH_MIN);
    // Before first layout there is no row to measure against; only the floor
    // applies, so an opening panel never starts life pinned to 300.
    assert.equal(clampDetailWidth(900, 0), 900);
    // Junk in, shipped default out — never NaN into a style property.
    assert.equal(clampDetailWidth(undefined, 1400), DETAIL_WIDTH_DEFAULT);
    assert.equal(clampDetailWidth(NaN, 1400), DETAIL_WIDTH_DEFAULT);
    assert.equal(clampDetailWidth('nonsense', 1400), DETAIL_WIDTH_DEFAULT);
    // Whole pixels: a fractional width leaves a seam against the map's border.
    assert.equal(clampDetailWidth(432.6, 1400), 433);
});

test('the bar reports the ceiling it actually has', () => {
    // Asked directly, NOT by running an infinite request through the clamp:
    // that function answers a non-finite request with the DEFAULT, so the
    // separator advertised aria-valuemax=400 at every window size. Caught in
    // the browser, not here — the first version of this suite never asserted
    // the value, only that the attribute existed.
    assert.equal(detailWidthCeiling(1400), 980);
    assert.equal(detailWidthCeiling(300), DETAIL_WIDTH_MIN);   // floor beats fraction
    assert.equal(detailWidthCeiling(0), Number.POSITIVE_INFINITY);
    assert.notEqual(detailWidthCeiling(1400), DETAIL_WIDTH_DEFAULT);
    // An infinite ceiling is not an attribute value; it is simply not written.
    const splitter = moduleSource('splitter.js');
    assert.match(splitter, /if \(Number\.isFinite\(ceiling\)\) bar\.setAttribute\('aria-valuemax'/);
});

test('a stored width is a preference, not state to trust', () => {
    assert.equal(readStoredDetailWidth(storage('520')), 520);
    assert.equal(readStoredDetailWidth(storage(null)), DETAIL_WIDTH_DEFAULT);
    assert.equal(readStoredDetailWidth(storage('')), DETAIL_WIDTH_DEFAULT);
    assert.equal(readStoredDetailWidth(storage('wide')), DETAIL_WIDTH_DEFAULT);
    assert.equal(readStoredDetailWidth(storage('-40')), DETAIL_WIDTH_DEFAULT);
    // Private mode throws on read rather than returning null.
    assert.equal(readStoredDetailWidth({ getItem() { throw new Error('denied'); } }),
        DETAIL_WIDTH_DEFAULT);
    assert.equal(readStoredDetailWidth(undefined), DETAIL_WIDTH_DEFAULT);
    assert.equal(DETAIL_WIDTH_KEY, 'cleanplateva.detailWidth');
});

test('the map is resized as the bar moves, not once it stops', () => {
    const splitter = moduleSource('splitter.js');
    // A flex reflow is not a window resize; MapLibre needs telling.
    assert.match(splitter, /frame = requestAnimationFrame\(\(\) => \{ frame = 0; this\._map\?\.resize\(\); \}\)/);
    // rAF-throttled, so a fast drag does not queue a resize per pointer event.
    assert.match(splitter, /if \(!frame\) \{/);
    // And once more at the end, since the last frame may be mid-flight.
    assert.match(splitter, /const end = \(e\) => \{[\s\S]{0,320}?this\._map\?\.resize\(\);/);
});

test('the clamp and the CSS cap cannot disagree about where the bar stops', () => {
    // 0.7 in the JS, 70% in the CSS. If these drift, the handle travels past
    // where the panel will follow.
    assert.equal(DETAIL_WIDTH_MAX_FRACTION, 0.7);
    assert.match(css, /\.food-detail \{[\s\S]{0,700}?max-width: 70%;/);
    // `flex: 0 0 auto` is what makes the panel hold its width and the map
    // absorb the remainder — without it the panel just shrinks back.
    assert.match(css, /\.food-detail \{[\s\S]{0,700}?flex: 0 0 auto;/);
});

test('it is a real separator, and it is reachable', () => {
    assert.match(html, /id="foodSplitter" role="separator"/);
    assert.match(html, /aria-orientation="vertical" tabindex="0"/);
    assert.match(html, /aria-label="Resize the facility panel"/);
    const splitter = moduleSource('splitter.js');
    // Left grows the panel, because the panel is to the RIGHT of the bar —
    // the inverse would feel backwards to anyone watching the divider move.
    assert.match(splitter, /e\.key === 'ArrowLeft'\) next = width \+ step/);
    assert.match(splitter, /e\.key === 'ArrowRight'\) next = width - step/);
    assert.match(splitter, /aria-valuenow/);
    // Double-click restores the shipped width — the escape hatch for a
    // divider dragged somewhere regrettable.
    assert.match(splitter, /addEventListener\('dblclick'[\s\S]{0,120}?DETAIL_WIDTH_DEFAULT/);
});

test('the bar exists only where there is something to divide', () => {
    // Closed panel: nothing to drag against. `:has` keeps this in CSS so no
    // show/hide path has to remember to toggle a second element.
    assert.match(css, /\.food-body:has\(\.food-detail\.d-none\) \.food-splitter \{ display: none; \}/);
    // Stacked under 900px, where a VERTICAL bar divides nothing and the
    // stacked max-height governs instead.
    assert.match(css, /@media \(max-width: 900px\)[\s\S]{0,400}?\.food-splitter \{ display: none; \}/);
    // ...and the stacked panel has to beat the inline width the splitter set.
    assert.match(css, /width: 100% !important;/);
});

test('the grip is measured, not derived, so the bar tracks the cursor', () => {
    // The bar carries negative margins so it sits IN the row's gap rather than
    // widening it, which makes the distance from its centre to the panel's edge
    // a function of gap, margin and border. Computing that by hand left the bar
    // drifting 7px behind the cursor (measured); taking it at grab time makes
    // the grip land wherever the visitor actually took hold.
    const splitter = moduleSource('splitter.js');
    assert.match(splitter, /grip = panel\s*\?\s*panel\.getBoundingClientRect\(\)\.left - \(barBox\.left \+ barBox\.width \/ 2\)/);
    assert.match(splitter, /this\._applyDetailWidth\(rect\.right - padRight - e\.clientX - grip\)/);
    // The negative margin is the reason the grip cannot be a constant.
    const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.food-splitter \{[\s\S]{0,400}?margin: 0 -0\.425rem;/);
});

test('the grip is a short handle, and it emphasises by tone not by hue', () => {
    // A rule running the full height of the row reads as a border belonging to
    // one of its neighbours, and at the accent colour it read as a selection —
    // Cannon, 2026-08-20, against the desktop-app idiom. The 10px box stays the
    // TARGET; only the pill inside it is drawn.
    assert.match(css, /\.food-splitter-grip \{[\s\S]{0,200}?height: 56px;/);
    assert.match(css, /\.food-splitter-grip \{[\s\S]{0,200}?border-radius: 999px;/);
    assert.doesNotMatch(css, /\.food-splitter[^}]*background-size/);

    // Hover, focus and drag lift the SAME grip one step toward the foreground.
    // No accent fill and no size change, so nothing jumps under the cursor.
    assert.match(css, /body\.is-splitting \.food-splitter-grip \{\s*background: var\(--cp-muted\);/);
    assert.match(css, /\.food-splitter-grip \{[\s\S]{0,200}?background: var\(--cp-border\);/);
    assert.match(css, /\.food-splitter-grip \{[\s\S]{0,220}?transition: background-color/);
    // Both tones are themed variables, so the grip gets its dark pair free.
    assert.doesNotMatch(css, /\.food-splitter-grip[^}]*--cp-accent/);

    // A real element rather than a ::before. The grip's appearance IS the
    // feature here, and a pseudo-element's computed style reads back stale —
    // it reported the same colour in both themes and in every state, which
    // made the one thing worth checking the one thing unverifiable.
    assert.match(html, /<span class="food-splitter-grip" aria-hidden="true"><\/span>/);
    assert.doesNotMatch(css, /\.food-splitter::before/);
});

test('the drag surface is the window, not the 10px bar', () => {
    // Without this the cursor flickers between elements mid-drag and the
    // pointer selects text on its way across the map.
    assert.match(css, /body\.is-splitting \{ cursor: col-resize; user-select: none; \}/);
    const splitter = moduleSource('splitter.js');
    // Capture keeps the drag alive when the pointer outruns a 10px bar, but
    // a refused capture must not refuse the drag.
    assert.match(splitter, /try \{ bar\.setPointerCapture\(e\.pointerId\); \} catch/);
    assert.match(splitter, /addEventListener\('pointercancel', end\)/);
    // A window that narrows can put a stored width past the ceiling, leaving
    // the map a sliver; re-clamp against the new row.
    assert.match(splitter, /window\.addEventListener\('resize'[\s\S]{0,140}?_applyDetailWidth/);
});
