import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const worker = (await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
)).default;

const env = {
    DATA_FULL: {
        get: async () => ({ body: '{}', httpEtag: '"etag"' }),
    },
    ASSETS: { fetch: async () => new Response('asset') },
};
const request = (path) => new Request(`https://cleanplateva.test/data-full/${path}`, {
    headers: { 'Cf-Access-Jwt-Assertion': 'test-token' },
});

test('the mutable manifest revalidates quickly', async () => {
    const response = await worker.fetch(request('manifest.json'), env);
    assert.equal(response.headers.get('Cache-Control'),
        'private, max-age=60, must-revalidate');
});

test('the public manifest also revalidates quickly', async () => {
    assert.match(wrangler,
        /"run_worker_first"\s*:\s*\[[^\]]*"\/data\/manifest\.json"[^\]]*"\/data\/finder\/\*"[^\]]*\]/);
    const response = await worker.fetch(
        new Request('https://cleanplateva.test/data/manifest.json'), env);
    assert.equal(response.headers.get('Cache-Control'),
        'public, max-age=60, must-revalidate');
});

test('content-addressed public finder shards are shared-cache immutable', async () => {
    const response = await worker.fetch(
        new Request('https://cleanplateva.test/data/finder/0f-123456abcdef.json'), env);
    assert.equal(response.headers.get('Cache-Control'),
        'public, max-age=31536000, immutable');
});

test('content-addressed finder and signal shards are browser-private immutable', async () => {
    for (const path of ['finder/00-abcdef123456.json', 'signals/0f-123456abcdef.json']) {
        const response = await worker.fetch(request(path), env);
        assert.equal(response.headers.get('Cache-Control'),
            'private, max-age=31536000, immutable');
    }
});

test('mutable detail objects retain the short private cache', async () => {
    const response = await worker.fetch(request('facility/P-1.json'), env);
    assert.equal(response.headers.get('Cache-Control'), 'private, max-age=300');
});

// CPR-M1b: `assets.not_found_handling: "single-page-application"` gives the
// view paths their shell — and would give a mistyped asset or a genuinely
// missing data shard the same 200 of HTML. The worker re-imposes a 404 on
// asset-shaped paths so a miss still reads as a miss.
const spaEnv = {
    ...env,
    ASSETS: {
        fetch: async () => new Response('<!DOCTYPE html><html>…</html>', {
            status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    },
};
const assetEnv = (contentType) => ({
    ...env,
    ASSETS: {
        fetch: async () => new Response('{}', {
            status: 200, headers: { 'Content-Type': contentType },
        }),
    },
});
const get = (path, e = spaEnv) => worker.fetch(new Request(`https://cleanplateva.test${path}`), e);

test('the SPA fallback does not turn a missing asset into a 200 of HTML', async () => {
    for (const path of [
        '/static/js/missing.js',
        '/static/css/nope.css',
        '/data/finder/00-deadbeef1234.json',
        '/data/manifest.json',
        '/favicon.ico',
        '/deep/path/file.json',
    ]) {
        const response = await get(path);
        assert.equal(response.status, 404, path);
    }
});

test('view paths still get their shell, and real assets still pass through', async () => {
    // Extension-less paths are the SPA fallback's whole purpose.
    for (const path of ['/', '/list', '/about', '/nonsense/deep', '/list/']) {
        const response = await get(path);
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get('Content-Type') || '', /text\/html/, path);
    }
    // A path that really is HTML keeps working.
    assert.equal((await get('/index.html')).status, 200);
    // A found asset is untouched — including the cache-control rewrite path.
    const shard = await get('/data/finder/0f-123456abcdef.json', assetEnv('application/json'));
    assert.equal(shard.status, 200);
    assert.equal(shard.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    // A 404 the assets binding produces on its own is passed along as-is.
    const real404 = await worker.fetch(new Request('https://cleanplateva.test/static/js/x.js'), {
        ...env, ASSETS: { fetch: async () => new Response('nope', { status: 404 }) },
    });
    assert.equal(real404.status, 404);
});
