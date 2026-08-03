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
