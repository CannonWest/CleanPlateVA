import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const worker = (await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
)).default;

// The full channel is PUBLIC since CPF-M2 (design ref §9): no Access header
// is required, responses carry public cache-control, and repeat reads are
// answered from the edge cache. The tier boundary is the client's
// acknowledgement (ack.js), not this transport.
const env = {
    DATA_FULL: {
        get: async () => ({ body: '{}', httpEtag: '"etag"' }),
    },
    ASSETS: { fetch: async () => new Response('asset') },
};
const request = (path, init = {}) => new Request(`https://cleanplateva.test/data-full/${path}`, init);
const noCache = () => { delete globalThis.caches; };
const ctx = () => {
    const pending = [];
    return { waitUntil: (p) => pending.push(p), pending };
};

test('the mutable manifest revalidates quickly — publicly, with no Access header required', async () => {
    noCache();
    const response = await worker.fetch(request('manifest.json'), env, ctx());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, must-revalidate');
    assert.equal(response.headers.get('ETag'), '"etag"');
    assert.equal(response.headers.get('X-Cache'), 'MISS');
});

test('the retired Access check and sign-in route are gone from the worker (design ref §14.1)', async () => {
    assert.doesNotMatch(source, /Cf-Access-Jwt-Assertion/);
    assert.doesNotMatch(source, /signin/);
    assert.doesNotMatch(source, /private, max-age/);
    // A request without any Access header is served, not 403'd.
    noCache();
    const response = await worker.fetch(request('facility/P-1.json'), env, ctx());
    assert.equal(response.status, 200);
    // And the old sign-in path is just a (harmless) object key like any other.
    const signin = await worker.fetch(request('signin'), {
        ...env, DATA_FULL: { get: async () => null },
    }, ctx());
    assert.equal(signin.status, 404);
});

test('both data channels are listed in run_worker_first', () => {
    // In array form, run_worker_first is THE set of paths that invoke the
    // worker; anything else is answered by the assets layer, SPA fallback
    // included. The public channel needs the worker for cache-control and
    // the re-404 of a masked miss (CPR-M1b); the full channel needs it
    // because /data-full/* is not a static asset at all — without this entry
    // the SPA fallback answers index.html and the full tier silently
    // degrades to the basic map (production regression 2026-08-16, found
    // via the www host). CPF-M2 keeps both entries.
    const list = wrangler.match(/"run_worker_first"\s*:\s*\[([^\]]*)\]/);
    assert.ok(list, 'run_worker_first must be an explicit array');
    const patterns = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(patterns.sort(), ['/data-full/*', '/data/*']);
});

test('the public manifest also revalidates quickly', async () => {
    // The worker must SEE the public data channel — it sets these headers,
    // and (CPR-M1b) re-404s a shard the SPA fallback would have masked.
    const response = await worker.fetch(
        new Request('https://cleanplateva.test/data/manifest.json'), env, ctx());
    assert.equal(response.headers.get('Cache-Control'),
        'public, max-age=60, must-revalidate');
});

test('content-addressed public finder shards are shared-cache immutable', async () => {
    const response = await worker.fetch(
        new Request('https://cleanplateva.test/data/finder/0f-123456abcdef.json'), env, ctx());
    assert.equal(response.headers.get('Cache-Control'),
        'public, max-age=31536000, immutable');
});

test('content-addressed full-tier shards are shared-cache immutable too', async () => {
    noCache();
    for (const path of ['finder/00-abcdef123456.json', 'overlay/01-abcdef123456.json',
        'closed/02-abcdef123456.json', 'signals/0f-123456abcdef.json']) {
        const response = await worker.fetch(request(path), env, ctx());
        assert.equal(response.headers.get('Cache-Control'),
            'public, max-age=31536000, immutable', path);
    }
});

test('mutable detail objects get the short public cache + ETag', async () => {
    noCache();
    const response = await worker.fetch(request('facility/P-1.json'), env, ctx());
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(response.headers.get('ETag'), '"etag"');
});

// ── the edge cache (Cache API) ───────────────────────────────────────────

/** A minimal caches.default: match by URL, put stores a clone. */
function fakeCaches() {
    const store = new Map();
    const calls = { match: [], put: [] };
    globalThis.caches = {
        default: {
            async match(req) {
                calls.match.push(req.url);
                const hit = store.get(req.url);
                return hit ? hit.clone() : undefined;
            },
            async put(req, res) {
                calls.put.push({ url: req.url, cacheControl: res.headers.get('Cache-Control'), status: res.status });
                store.set(req.url, res);
            },
        },
    };
    return { store, calls };
}

test('a miss reads R2 and stores the copy; the next read is an edge HIT that never touches R2', async () => {
    const { calls } = fakeCaches();
    let r2Reads = 0;
    const counting = { ...env, DATA_FULL: { get: async () => { r2Reads++; return { body: '{"a":1}', httpEtag: '"e1"' }; } } };
    const c = ctx();

    const miss = await worker.fetch(request('finder/00-abcdef123456.json'), counting, c);
    assert.equal(miss.status, 200);
    assert.equal(miss.headers.get('X-Cache'), 'MISS');
    assert.equal(await miss.text(), '{"a":1}', 'the visitor gets the body even though a clone went to the cache');
    await Promise.all(c.pending);
    assert.equal(calls.put.length, 1);
    assert.equal(calls.put[0].cacheControl, 'public, max-age=31536000, immutable', 'the stored copy carries the public cache-control the edge honors');
    assert.equal(r2Reads, 1);

    const hit = await worker.fetch(request('finder/00-abcdef123456.json'), counting, ctx());
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get('X-Cache'), 'HIT');
    assert.equal(hit.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(hit.headers.get('ETag'), '"e1"');
    assert.equal(await hit.text(), '{"a":1}');
    assert.equal(r2Reads, 1, 'the hit was answered from the edge');
    noCache();
});

test('a HEAD is answered from the same cache entry, headers only, and never stores', async () => {
    const { calls } = fakeCaches();
    const c = ctx();
    const head = await worker.fetch(request('facility/P-1.json', { method: 'HEAD' }), env, c);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('X-Cache'), 'MISS');
    assert.equal(head.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(await head.text(), '');
    await Promise.all(c.pending);
    assert.equal(calls.put.length, 0, 'a HEAD does not populate the cache');
    // The GET that follows populates it, and a later HEAD hits it.
    await worker.fetch(request('facility/P-1.json'), env, c);
    await Promise.all(c.pending);
    assert.equal(calls.put.length, 1);
    const head2 = await worker.fetch(request('facility/P-1.json', { method: 'HEAD' }), env, ctx());
    assert.equal(head2.headers.get('X-Cache'), 'HIT');
    assert.equal(await head2.text(), '');
    noCache();
});

test('a conditional request an unchanged object satisfies is a 304 with no body (R2 onlyIf on a miss)', async () => {
    noCache();
    let seenOnlyIf = null;
    const conditional = {
        ...env,
        DATA_FULL: {
            get: async (key, options) => {
                seenOnlyIf = options?.onlyIf;
                // R2 answers a satisfied condition with the object's metadata
                // and NO body — the shape this worker keys off.
                if (options?.onlyIf?.get?.('If-None-Match') === '"e1"') return { httpEtag: '"e1"' };
                return { body: '{"a":1}', httpEtag: '"e1"' };
            },
        },
    };
    const fresh = await worker.fetch(request('facility/P-1.json', { headers: { 'If-None-Match': '"e1"' } }), conditional, ctx());
    assert.equal(fresh.status, 304);
    assert.equal(fresh.headers.get('ETag'), '"e1"');
    assert.equal(fresh.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(await fresh.text(), '');
    assert.ok(seenOnlyIf, 'the request headers reached R2 as the condition');
    const stale = await worker.fetch(request('facility/P-1.json', { headers: { 'If-None-Match': '"old"' } }), conditional, ctx());
    assert.equal(stale.status, 200);
    assert.equal(await stale.text(), '{"a":1}');
});

test('the channel still refuses non-GET/HEAD, bad paths, and missing objects', async () => {
    noCache();
    assert.equal((await worker.fetch(request('manifest.json', { method: 'POST' }), env, ctx())).status, 405);
    // A literal `..` up-path is normalized away by the URL parser before the
    // worker sees it (WHATWG treats `..` / `%2e%2e` as dot segments), so the
    // guard's reachable case is a key carrying `..` mid-name.
    assert.equal((await worker.fetch(request('facility/weird..name.json'), env, ctx())).status, 400);
    assert.equal((await worker.fetch(request(''), env, ctx())).status, 400);
    const missing = { ...env, DATA_FULL: { get: async () => null } };
    assert.equal((await worker.fetch(request('facility/NOPE.json'), missing, ctx())).status, 404);
});

test('the worker works without a Cache API (the node harness): plain MISSes, nothing thrown', async () => {
    noCache();
    const response = await worker.fetch(request('manifest.json'), env, ctx());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Cache'), 'MISS');
    assert.equal(await response.text(), '{}');
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
const get = (path, e = spaEnv) => worker.fetch(new Request(`https://cleanplateva.test${path}`), e, ctx());

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
    }, ctx());
    assert.equal(real404.status, 404);
});
