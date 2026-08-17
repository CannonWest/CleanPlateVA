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
const clientSource = readFileSync(
    new URL('../public/static/js/dataClient.js', import.meta.url),
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

test('the full channel is gated behind !FORCE_LITE and degrades only to the V4 public finder', () => {
    assert.match(appSource, /createFoodApi\(\{ forceLite: FORCE_LITE \}\)/);
    const fn = clientSource.match(/async getFoodFacilities\([^)]*\) \{([\s\S]*?)\n {8}\},/);
    assert.ok(fn, 'getFoodFacilities found');
    const body = fn[1];
    const gate = body.indexOf('if (!forceLite)');
    const full = body.indexOf('loadFullV4');
    const lite = body.indexOf('loadLite');
    assert.ok(gate !== -1, 'the !forceLite gate exists');
    assert.ok(full !== -1 && gate < full, 'the full-channel fetch sits inside the gate');
    assert.equal(body.indexOf('loadLegacyFull'), -1, 'no V1 full-roster loader exists');
    assert.ok(lite > full, 'the public finder fallback stays after the full gate');
    assert.equal(clientSource.indexOf('loadFullV3'), -1, 'no V3 loader survives — no dual-contract path');
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
