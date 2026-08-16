/** A defect in the vendored CARTO dark-matter style, not this file's own
 *  choice: every road-name label tier reads fine against the style's
 *  #0e0e0e background EXCEPT trunk/motorway (layer `roadname_major`), which
 *  ships #383838 text — 1.7:1, effectively invisible. Positron carries none
 *  of this (every tier there is a flat, legible #838383), so it is isolated
 *  to one layer of one vendored theme.
 *
 *  Measured 2026-08-14 against the style.json served from
 *  basemaps.cartocdn.com (WCAG relative-luminance contrast, not re-checked
 *  live here — a network-dependent assertion would make this suite flaky
 *  over a fact that belongs to the vendor's file, not this repo's):
 *
 *    roadname_minor  (minor/service)        #b5b4b4   9.3:1
 *    roadname_sec    (secondary/tertiary)   #929292   6.2:1
 *    roadname_pri    (primary)              #bdbdbd  10.3:1
 *    roadname_major  (trunk/motorway)       #383838   1.7:1   <- the defect
 *
 *  DARK_MAJOR_ROAD_LABEL_COLOR (#d8d8d8) measures 13.5:1 — clear of AA, and
 *  deliberately brighter than every other tier, since trunk/motorway is the
 *  biggest road class dark-matter labels at all.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboard, dashboardSource as source } from './support/dashboard.mjs';

const proto = dashboard.FoodDashboard.prototype;

const fakeMap = (layers) => ({
    calls: [],
    getLayer(id) { return layers.includes(id) ? {} : undefined; },
    setPaintProperty(...args) { this.calls.push(args); },
});

const ctx = (map, styleIsDark) =>
    Object.assign(Object.create(proto), { _map: map, _styleIsDark: styleIsDark });

test('the major-road label gets patched on the dark style', () => {
    const map = fakeMap(['roadname_major', 'roadname_pri']);
    ctx(map, true)._fixDarkRoadLabelContrast();
    assert.deepEqual(map.calls, [['roadname_major', 'text-color', '#d8d8d8']]);
});

test('the fix is dark-only — the light style is never touched', () => {
    const map = fakeMap(['roadname_major']);
    ctx(map, false)._fixDarkRoadLabelContrast();
    assert.deepEqual(map.calls, []);
});

test('a vendor rename no-ops instead of throwing', () => {
    // style.load also installs the facility data layers in the same
    // handler; a setPaintProperty on a missing layer would throw and could
    // take that installation down with it.
    const map = fakeMap([]);   // CARTO renamed or dropped the layer
    assert.doesNotThrow(() => ctx(map, true)._fixDarkRoadLabelContrast());
    assert.deepEqual(map.calls, []);
});

test('wired into style.load alongside the data layers, not standalone', () => {
    assert.match(source,
        /style\.load'[\s\S]{0,40}?_installDataLayers\(\);[\s\S]{0,40}?_fixDarkRoadLabelContrast\(\);/);
});

test('the replacement colour actually clears AA against the style background', () => {
    // The vendor's own numbers, re-derived here so a future colour edit
    // fails loudly rather than silently regressing below 4.5:1.
    const relLum = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
    };
    const contrast = (a, b) => {
        const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    const BACKGROUND = '#0e0e0e';   // dark-matter's background-color
    assert.match(source, /const DARK_MAJOR_ROAD_LABEL_COLOR = '(#[0-9a-f]{6})';/);
    const [, color] = source.match(/const DARK_MAJOR_ROAD_LABEL_COLOR = '(#[0-9a-f]{6})';/);
    assert.ok(contrast(color, BACKGROUND) >= 4.5,
        `${color} must clear WCAG AA (4.5:1) against ${BACKGROUND}`);
    // Brighter than the vendor's own best tier (primary, #bdbdbd) — the
    // fix should read as "most important," not merely "no longer broken".
    assert.ok(contrast(color, BACKGROUND) > contrast('#bdbdbd', BACKGROUND));
});
