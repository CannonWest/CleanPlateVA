import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Static wiring assertions for the ?tier=lite dev/preview override.
// app.js boots against a live document, so (unlike foodDashboard.js) it
// can't be data-URL-imported here — these pin the source text instead.
// The stakes: push-to-main auto-deploys production, and inverting the
// FORCE_LITE gate would silently force every visitor to the lite floor.

const appSource = readFileSync(
    new URL('../public/static/js/app.js', import.meta.url),
    'utf8',
);
const css = readFileSync(
    new URL('../public/static/css/style.css', import.meta.url),
    'utf8',
);

test('FORCE_LITE keys off ?tier=lite exactly, read once at boot', () => {
    assert.match(
        appSource,
        /const FORCE_LITE = new URLSearchParams\(window\.location\.search\)\.get\('tier'\) === 'lite';/,
    );
});

test('the full channel is gated behind !FORCE_LITE; the lite fallback is not', () => {
    const fn = appSource.match(/async getFoodFacilities\([^)]*\) \{([\s\S]*?)\n {4}\},/);
    assert.ok(fn, 'getFoodFacilities found');
    const body = fn[1];
    const gate = body.indexOf('if (!FORCE_LITE)');
    const full = body.indexOf('FULL_BASE');
    const lite = body.indexOf("'data/facilities.json'");
    assert.ok(gate !== -1, 'the !FORCE_LITE gate exists');
    assert.ok(full !== -1 && gate < full, 'the full-channel fetch sits inside the gate');
    assert.ok(lite !== -1 && lite > full, 'the lite fallback stays unconditional, after the gate');
});

test('forced lite marks the body and keeps the sign-in CTA hidden', () => {
    assert.match(
        appSource,
        /if \(FORCE_LITE\) document\.body\.classList\.add\('tier-forced-lite'\);/,
    );
    assert.match(
        css,
        /body\.tier-forced-lite #signInBtn \{ display: none !important; \}/,
    );
});
