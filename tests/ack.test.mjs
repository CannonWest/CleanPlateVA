/** The acknowledgement (CPF-M1, design ref §3 / §12 D-ACK-1..3): the
 *  versioned stored answer, the shared state the data client's gate reads,
 *  the first-load blocking dialog that fetches nothing until the visitor
 *  answers, the header control that replaced the sign-in button, and the
 *  About §06 the dialog clones its words from. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboardSource, moduleSource } from './support/dashboard.mjs';

const {
    ACK_KEY, ACK_VERSION, ACK_AGREED, ACK_DECLINED, createAckState, readAck, writeAck,
} = await import('../public/static/js/ack.js');

const clientSource = readFileSync(new URL('../public/static/js/dataClient.js', import.meta.url), 'utf8');
const { createFoodApi } = await import(
    `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`
);
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../public/static/js/app.js', import.meta.url), 'utf8');
const ackSource = moduleSource('ack.js');

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        dump: () => Object.fromEntries(map),
    };
}

// ── the stored answer ────────────────────────────────────────────────────

test('the answer lives under ONE versioned key; an older version is not an answer', () => {
    assert.equal(ACK_KEY, `cleanplateva.ack.v${ACK_VERSION}`);
    assert.equal(ACK_VERSION, 1);
    // Bumping ACK_VERSION re-prompts every device: the key is derived from it,
    // never hand-written elsewhere.
    assert.match(ackSource, /export const ACK_KEY = `cleanplateva\.ack\.v\$\{ACK_VERSION\}`;/);
    assert.equal(readAck(memoryStorage({ 'cleanplateva.ack.v0': ACK_AGREED })), null);
    assert.equal(readAck(memoryStorage({ [ACK_KEY]: ACK_AGREED })), ACK_AGREED);
    assert.equal(readAck(memoryStorage({ [ACK_KEY]: ACK_DECLINED })), ACK_DECLINED);
    assert.equal(readAck(memoryStorage({ [ACK_KEY]: 'maybe' })), null);
    assert.equal(readAck(null), null);
    assert.equal(readAck({ getItem() { throw new Error('private mode'); } }), null);
    assert.doesNotThrow(() => writeAck({ setItem() { throw new Error('private mode'); } }, ACK_AGREED));
});

test('createAckState starts from storage; buttons persist, Escape does not', () => {
    const fresh = createAckState(memoryStorage());
    assert.equal(fresh.value, null);
    assert.equal(fresh.decided, false);
    assert.equal(fresh.agreed, false);

    const storage = memoryStorage();
    const state = createAckState(storage);
    state.set(ACK_DECLINED, { persist: false });      // Escape on the first-load dialog
    assert.equal(state.value, ACK_DECLINED);
    assert.equal(state.decided, true);
    assert.equal(state.persisted, false, 'it governs this load only');
    assert.deepEqual(storage.dump(), {}, 'an unpersisted decline writes nothing — the next load asks again');

    state.set(ACK_AGREED);                             // the button
    assert.equal(state.agreed, true);
    assert.equal(state.persisted, true);
    assert.deepEqual(storage.dump(), { [ACK_KEY]: ACK_AGREED });

    state.set('nonsense');
    assert.equal(state.value, null, 'only the two answers are answers');
    assert.deepEqual(storage.dump(), { [ACK_KEY]: ACK_AGREED }, 'and nonsense is never written');

    const remembered = createAckState(storage);
    assert.equal(remembered.agreed, true, 'a later load starts from the remembered answer');
    assert.equal(remembered.persisted, true);
});

// ── the data client's gate ───────────────────────────────────────────────

const finderShard = (bucket, facilities) => ({
    contract: 'cleanplateva.finder-shard.v4', schema_version: 4, bucket, facilities,
});
const liteManifest = {
    contract: 'cleanplateva.finder-manifest.v4', schema_version: 4, available: true, mode: 'lite',
    snapshot_id: 'lite-1', fetched_at: '2026-08-17T13:00:00Z',
    freshness: { snapshot_id: 'lite-1', newest_report: '2026-08-07' },
    vocab: { permit_type: [], loc: [], scope: [] },
    counts: { total: 1, by_zip: {} },
    resources: { finder: { shards: [{ path: 'finder/00-p.json', bucket: 0, sha256: 'p', bytes: 1, records: 1 }] } },
};
const fullManifest = {
    contract: 'cleanplateva.full-manifest.v4', schema_version: 4, available: true, mode: 'full',
    snapshot_id: 'full-1', fetched_at: '2026-08-17T13:00:00Z',
    freshness: { snapshot_id: 'full-1', newest_report: '2026-08-07' },
    vocab: liteManifest.vocab,
    counts: { total: 1, active: 1, closed: 0, by_grade: {}, by_zip: {} },
    resources: {
        finder: { shards: [{ path: 'finder/00-a.json', bucket: 0, sha256: 'sha-a', bytes: 1, records: 1 }] },
        overlay: { shards: [{ path: 'overlay/00-c.json', bucket: 0, sha256: 'sha-c', bytes: 1, records: 1 }] },
        closed: { shards: [] },
        standards: { path: 'standards.json' },
        details: { path_template: 'facility/{permit_id}.json', records: 1 },
    },
};
const COLUMNS = ['grade_score', 'new', 'trend_delta', 'latest_yyyymmdd', 'base_yyyymmdd',
    'latest_scope_code', 'latest_out', 'latest_items', 'compliance_pct'];
const rowA = { permit_id: 'A', name: 'Alpha', lat: 1, lon: 2, loc: 0, pt: 0, is_restaurant: true, mobile: false };
const payloads = () => ({
    'data/manifest.json': liteManifest,
    'data/finder/00-p.json': finderShard('00', [rowA]),
    'data-full/manifest.json': fullManifest,
    'data-full/finder/00-a.json': finderShard('00', [rowA]),
    'data-full/overlay/00-c.json': {
        contract: 'cleanplateva.overlay-shard.v4', schema_version: 4, bucket: '00',
        finder_sha256: 'sha-a', columns: COLUMNS, rows: [[91, 0, 3, 20260801, 20260801, 1, null, 30, 90]],
    },
    'data-full/standards.json': {},
    'data-full/facility/A.json': { available: true, facility: { permit_id: 'A' }, inspections: [] },
});

function fakeFetch(map) {
    const calls = [];
    const fetchImpl = async (path) => {
        calls.push(path);
        const entry = map[path];
        if (entry === undefined) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => structuredClone(entry) };
    };
    fetchImpl.calls = calls;
    return fetchImpl;
}

test('not acknowledged → the basic map only, and the full channel is never even asked', async () => {
    const fetchImpl = fakeFetch(payloads());
    const api = createFoodApi({ fetchImpl, isAcknowledged: () => false });
    const result = await api.getFoodFacilities();
    assert.equal(result.mode, 'lite');
    assert.equal(fetchImpl.calls.some((p) => p.startsWith('data-full/')), false, 'no full-tier request before the answer');
    // And nothing judgment-bearing is reachable through the client afterwards.
    assert.equal((await api.getFoodFacilityDetail('A')).available, false);
    assert.deepEqual(await api.loadClosed(), []);
});

test('acknowledged → full first; the gate is read at call time, so a later answer flips the next load', async () => {
    let agreed = false;
    const fetchImpl = fakeFetch(payloads());
    const api = createFoodApi({ fetchImpl, isAcknowledged: () => agreed });
    assert.equal((await api.getFoodFacilities()).mode, 'lite');
    agreed = true;                                              // "Agree and View Grades"
    const full = await api.getFoodFacilities();
    assert.equal(full.mode, 'full');
    assert.equal(full.facilities[0].o.grade_score, 91);
    assert.equal(fetchImpl.calls[fetchImpl.calls.length - 3], 'data-full/manifest.json');
    agreed = false;                                             // "Decline and Use Basic Map", later
    const back = await api.getFoodFacilities();
    assert.equal(back.mode, 'lite');
    assert.equal((await api.getFoodFacilityDetail('A')).available, false, 'the basic map forgets the full manifest');
});

test('?tier=lite wins over an acknowledgement (D-ACK-3)', async () => {
    const fetchImpl = fakeFetch(payloads());
    const api = createFoodApi({ fetchImpl, forceLite: true, isAcknowledged: () => true });
    assert.equal((await api.getFoodFacilities()).mode, 'lite');
    assert.equal(fetchImpl.calls.some((p) => p.startsWith('data-full/')), false);
});

test('a bare client (no gate given) keeps trying full first, so tools and older tests are unchanged', async () => {
    const fetchImpl = fakeFetch(payloads());
    assert.equal((await createFoodApi({ fetchImpl }).getFoodFacilities()).mode, 'full');
});

// ── the dashboard: first load blocks and fetches nothing ─────────────────

test('app.js shares one ack state between the client gate and the dashboard', () => {
    assert.match(appSource, /const ack = createAckState\(window\.localStorage\);/);
    assert.match(appSource, /createFoodApi\(\{ forceLite: FORCE_LITE, isAcknowledged: \(\) => ack\.agreed \}\)/);
    assert.match(appSource, /new FoodDashboard\(api, \{ ack, forceLite: FORCE_LITE \}\)/);
});

test('load(): the basemap comes up, then the first-load dialog blocks BEFORE any refresh (D-ACK-1)', () => {
    const load = dashboardSource.match(/\n {4}load\(\) \{([\s\S]*?)\n {4}\}/)?.[1] || '';
    assert.ok(load, 'load() found');
    const map = load.indexOf('this._ensureMap()');
    const gate = load.indexOf('if (this._needsAckDecision())');
    const open = load.indexOf("this._openTerms({ blocking: true })");
    const ret = load.indexOf('return;');
    const refresh = load.indexOf('this.refresh()');
    assert.ok(map !== -1 && gate > map, 'the map exists before the decision is checked');
    assert.ok(open > gate && ret > open, 'the blocking dialog opens and load() returns without fetching');
    assert.ok(refresh > ret, 'refresh() runs only on the remembered-answer path');
    assert.match(load, /this\._bootDeferred = true/);
    // The deferred boot is what _decideAck resumes; a changed answer later
    // re-runs the load on the other tier and closes anything from the old one.
    assert.match(ackSource, /_decideAck\(value, \{ persist = true \} = \{\}\) \{[\s\S]*?if \(this\._bootDeferred\) \{[\s\S]*?this\._bootDeferred = false;[\s\S]*?this\.refresh\(\);[\s\S]*?\} else if \(changed\) \{[\s\S]*?this\._closeDetail\?\.\(\{ write: true \}\);[\s\S]*?this\.refresh\(\);/);
    assert.match(ackSource, /_needsAckDecision\(\) \{\s*return !this\._forceLite && !!this\._ack && !this\._ack\.decided;/);
});

test('the dialog clones About §06 (one source of the words), blocks on first load, and offers exactly the two decisions', () => {
    assert.match(ackSource, /document\.getElementById\('aboutTermsBody'\)/);
    assert.match(ackSource, /source\.cloneNode\(true\)[\s\S]*?clone\.removeAttribute\('id'\)/);
    assert.match(ackSource, /data-ack="\$\{ACK_AGREED\}">Agree and View Grades</);
    assert.match(ackSource, /data-ack="\$\{ACK_DECLINED\}">Decline and Use Basic Map</);
    // Decline left, Agree right (Cannon 2026-08-17) — DOM order is the visual
    // order, and the actions row is centered.
    const actions = ackSource.match(/<div class="food-ack-actions">([\s\S]*?)<\/div>/)?.[1] || '';
    assert.ok(actions, 'actions row found');
    assert.ok(actions.indexOf('ACK_DECLINED') < actions.indexOf('ACK_AGREED'),
        'Decline is written before Agree, so Agree sits on the right');
    assert.match(css, /\.food-ack-actions \{[^}]*justify-content: center;/);
    // The dialog head carries the title alone — no kicker, no lede.
    assert.doesNotMatch(ackSource, /food-ack-kicker|food-ack-lede/);
    assert.doesNotMatch(ackSource, /Before using CleanPlateVA/);
    assert.doesNotMatch(css, /\.food-ack-kicker|\.food-ack-lede/);
    // …and neither does About §06 (same line, same reason).
    assert.doesNotMatch(html, /Before using CleanPlateVA/);
    // Blocking: no close control, backdrop clicks ignored, Escape = an
    // unpersisted decline. Re-opened: Escape / backdrop just close.
    assert.match(ackSource, /\$\{blocking \? '' : `<button type="button" class="btn-close" data-ack-close/);
    assert.match(ackSource, /if \(e\.target === backdrop && !this\._ackBlocking\) this\._closeTerms\(\);/);
    assert.match(ackSource, /if \(this\._ackBlocking\) this\._decideAck\(ACK_DECLINED, \{ persist: false \}\);\s*else this\._closeTerms\(\);/);
    assert.match(ackSource, /role="dialog" aria-modal="true" aria-labelledby="foodAckTitle"/);
    // The words are on the page, once, and shown (the M0 scaffold's d-none is gone).
    assert.match(html, /<section class="about-section about-terms" id="aboutTerms"/);
    assert.match(html, /<div class="about-terms-body" id="aboutTermsBody">/);
    assert.equal((html.match(/Terms of Use and Data Acknowledgment/g) || []).length >= 1, true);
    assert.match(html, /By selecting “Agree and View Grades”/);
    assert.match(html, /you may continue using the basic map without CleanPlateVA inspection grades/);
});

test('the header control replaced the sign-in button, invites only while the grades are hidden, and hands the way back to About', () => {
    assert.match(html, /<button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" id="ackTermsBtn"/);
    assert.match(html, /<span class="cp-ack-label">View Grades<\/span>/);
    // Accepted → the invitation hides; the single switch back is §06's panel.
    assert.match(ackSource, /_syncAckControl\(\) \{[\s\S]*?btn\.classList\.toggle\('d-none', agreed\);/);
    assert.doesNotMatch(ackSource, /agreed \? 'Terms' : 'View Grades'/);
    // The panel lives OUTSIDE the cloned terms body, or the dialog would grow
    // a second copy of the button.
    const bodyStart = html.indexOf('<div class="about-terms-body" id="aboutTermsBody">');
    const body = html.slice(bodyStart, html.indexOf('id="aboutTermsStatus"'));
    assert.ok(bodyStart !== -1 && body, '#aboutTermsBody found');
    assert.doesNotMatch(body, /aboutTermsStatus|aboutTermsAction|<button/);
    assert.match(html, /<div class="about-terms-status d-none" id="aboutTermsStatus">/);
    assert.match(html, /<button type="button" class="btn btn-outline-primary d-none" id="aboutTermsAction">/);
    // Its two states, what the button does in each, and the dialog's colour
    // language carried over: red is the way to the basic map, blue the way to
    // the grades — outlined on both sides, since this is a standing
    // preference rather than the dialog's fork.
    assert.match(ackSource, /action\.textContent = 'Switch to the basic map';\s*action\.className = 'btn btn-outline-danger';/);
    assert.match(ackSource, /action\.textContent = 'Review the terms and view grades';\s*action\.className = 'btn btn-outline-primary';/);
    assert.match(ackSource, /if \(this\._ack\?\.agreed\) this\._decideAck\(ACK_DECLINED\);\s*else this\._openTerms\(\{ trigger: action \}\);/);
    // ?tier=lite overrides any answer: state the override, offer no button.
    assert.match(ackSource, /_syncTermsStatus\(\) \{[\s\S]*?if \(this\._forceLite\) \{[\s\S]*?\?tier=lite/);
    assert.match(ackSource, /action\.classList\.toggle\('d-none', !!this\._forceLite\);/);
    // The panel is outlined in the accent, not the neutral border: it is the
    // one interactive block at the end of a long document.
    assert.match(css, /\.about-terms-status \{[^}]*border: 1px solid var\(--cp-accent\);/);
    assert.doesNotMatch(html, /signInBtn/);
    assert.doesNotMatch(html, /data-full\/signin/);
    assert.doesNotMatch(html, /Sign in to view inspection detail/);
    assert.doesNotMatch(html, /cp-signin-label/);
    assert.doesNotMatch(dashboardSource, /signInBtn/);
    assert.match(css, /body\.tier-forced-lite #ackTermsBtn \{ display: none !important; \}/);
    // The About live card speaks the same vocabulary and states WHY the basic
    // map is what loaded.
    const about = moduleSource('about.js');
    assert.match(about, /lite \? 'Basic map' : 'Inspection grades'/);
    assert.match(about, /_basicMapReason\(\) \{[\s\S]*?Forced by \?tier=lite[\s\S]*?Terms acknowledged; inspection data unavailable[\s\S]*?Terms declined on this device[\s\S]*?Terms declined for this visit[\s\S]*?Terms not yet acknowledged/);
});

test('the dialog and §06 have dark-theme pairs, and the terms sit in an outlined inset box that scrolls', () => {
    assert.match(css, /\.food-ack-backdrop \{[\s\S]*?position: fixed;/);
    assert.match(css, /\.theme-dark \.food-ack-backdrop \{ background: rgba\(0, 0, 0, 0\.68\); \}/);
    assert.match(css, /\.theme-dark \.food-ack \{ box-shadow/);
    assert.match(css, /body\.food-ack-open \{ overflow: hidden; \}/);
    assert.match(css, /\.about-terms-body h3 \{/);
    // The box: narrower than the dialog, centered, outlined, recessed to the
    // page canvas token (which flips with the theme), and the scroll container
    // itself — so the outline stays put while the terms move inside it.
    const box = css.match(/\.food-ack-body \{([^}]*)\}/)?.[1] || '';
    assert.ok(box, '.food-ack-body rule found');
    // `scroll`, not `auto` — the scrollbar is persistent. Chrome's overlay
    // scrollbar reserves no gutter, so the ::-webkit-scrollbar rules draw a
    // classic one; they only apply while the standard properties are unset,
    // which is why those live in a Firefox-only @supports block. Getting this
    // backwards silently restores the fading overlay scrollbar.
    assert.match(box, /overflow-y: scroll;/);
    assert.doesNotMatch(box, /^\s*scrollbar-(width|color)\s*:/m);   // declarations, not the comment above them
    assert.match(css, /\.food-ack-body::-webkit-scrollbar \{ width: 10px; \}/);
    assert.match(css, /\.food-ack-body::-webkit-scrollbar-thumb \{[\s\S]*?background: var\(--cp-muted\);/);
    assert.match(css, /@supports not selector\(::-webkit-scrollbar\) \{\s*\.food-ack-body \{\s*scrollbar-width: thin;\s*scrollbar-color: var\(--cp-muted\) var\(--cp-border\);/);
    assert.match(box, /width: min\(36rem, calc\(100% - 2\.2rem\)\);/);
    assert.match(box, /margin: 0\.9rem auto;/);
    assert.match(box, /border: 1px solid var\(--cp-border\);/);
    assert.match(box, /background: var\(--cp-bg\);/);
    assert.match(box, /border-radius:/);
});
