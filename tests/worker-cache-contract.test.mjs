import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const headersFile = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
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
    assert.doesNotMatch(source, /Cf-Access-Jwt-Assertion/);  // retired-ok: asserts the retired Access header is gone
    assert.doesNotMatch(source, /signin/);
    assert.doesNotMatch(source, /private, max-age/);  // retired-ok: asserts the retired private cache-control is gone
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

test('only the full channel invokes the worker; the public channel is static (CPH-M3)', () => {
    // In array form, run_worker_first is THE set of paths that invoke the
    // worker; anything else is answered by the assets layer, SPA fallback
    // included. The full channel needs the worker because /data-full/* is
    // not a static asset at all — without this entry the SPA fallback
    // answers index.html and the full tier silently degrades to the basic
    // map (production regression 2026-08-16, found via the www host).
    // /data/* is deliberately NOT listed (design ref §9, D-TRANSPORT-4): on
    // Workers Free every worker invocation is a metered request, and the
    // committed public channel is plain static assets whose cache-control
    // rides in public/_headers.
    const list = wrangler.match(/"run_worker_first"\s*:\s*\[([^\]]*)\]/);
    assert.ok(list, 'run_worker_first must be an explicit array');
    const patterns = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(patterns, ['/data-full/*']);
});

test('the public channel cache-control lives in public/_headers, not the worker — one rule per committed shard, by name', () => {
    // The assets layer applies these; the worker never sees /data/*. Same
    // TTL shape the full channel uses: the small mutable manifest revalidates
    // in a minute, content-addressed shards are immutable. The shards are
    // listed BY NAME, not as /data/finder/*: measured on production
    // 2026-08-18, a splat rule also stamps `immutable` on the SPA shell the
    // assets layer returns for a name the tree lacks (a browser or the edge
    // would hold that shell for a year); an unlisted name falls back to
    // `max-age=0, must-revalidate`, and the client treats the shell as a
    // miss. cannon-food's publisher regenerates the file from the Lite
    // manifest with every publish — this pins the two in step.
    const manifest = JSON.parse(readFileSync(new URL('../public/data/manifest.json', import.meta.url), 'utf8'));
    const shards = manifest.resources.finder.shards.slice().sort((a, b) => a.bucket - b.bucket);
    const rules = parseHeadersFile(headersFile);
    assert.deepEqual(rules, [
        ['/data/manifest.json', ['Cache-Control: public, max-age=60, must-revalidate']],
        ...shards.map((s) => [`/data/${s.path}`, ['Cache-Control: public, max-age=31536000, immutable']]),
    ]);
    assert.equal(rules.length, 17);
    assert.ok(!rules.some(([pattern]) => pattern.includes('*')), 'no splat rule');
    assert.match(headersFile, /^# CleanPlateVA/);
    // …and the worker carries none of it any more (design ref §14.1).
    assert.doesNotMatch(source, /publicDataCacheControl|looksLikeAsset|isSpaFallback|HTML_EXTENSIONS/);  // retired-ok: asserts the retired Worker helpers are gone
    assert.doesNotMatch(source, /\/data\/manifest\.json|\/data\/finder\//);
});

/** _headers → [[pattern, [header lines…]], …]; comments and blanks skipped. */
function parseHeadersFile(text) {
    const rules = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim() || line.trim().startsWith('#')) continue;
        if (/^\s/.test(line)) rules[rules.length - 1][1].push(line.trim());
        else rules.push([line.trim(), []]);
    }
    return rules;
}

test('the worker passes anything that is not /data-full/* to the assets layer untouched', async () => {
    // Unreachable in production (run_worker_first), but a widened list must
    // still serve the site rather than 404 it — and must not re-impose the
    // retired cache-control / re-404 logic on the way out.
    const seen = [];
    const passthrough = {
        ...env,
        ASSETS: { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response('asset', { status: 200, headers: { 'Content-Type': 'application/json' } }); } },
    };
    for (const path of ['/data/manifest.json', '/data/finder/0f-123456abcdef.json', '/', '/list', '/static/js/app.js']) {
        const response = await worker.fetch(new Request(`https://cleanplateva.test${path}`), passthrough, ctx());
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get('Cache-Control'), null, `${path}: the worker adds no cache-control to assets`);
        assert.equal(response.headers.get('X-Cache'), null, path);
    }
    assert.deepEqual(seen, ['/data/manifest.json', '/data/finder/0f-123456abcdef.json', '/', '/list', '/static/js/app.js']);
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

test('an edge HIT re-asserts the contract Cache-Control — the zone rewrites what match() hands back', async () => {
    // Measured on the host 2026-08-17: a stored `max-age=60` manifest came out
    // of caches.default.match() as `max-age=14400` (the zone's Browser Cache
    // TTL). The Worker must not pass that through, or a browser holds the
    // small mutable pointer for four hours instead of revalidating in 60 s.
    const { store } = fakeCaches();
    store.set('https://cleanplateva.test/data-full/manifest.json', new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'ETag': '"m1"', 'Cache-Control': 'public, max-age=14400, must-revalidate' },
    }));
    store.set('https://cleanplateva.test/data-full/facility/P-9.json', new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'ETag': '"d1"', 'Cache-Control': 'public, max-age=14400' },
    }));
    const manifest = await worker.fetch(request('manifest.json'), env, ctx());
    assert.equal(manifest.headers.get('X-Cache'), 'HIT');
    assert.equal(manifest.headers.get('Cache-Control'), 'public, max-age=60, must-revalidate');
    assert.equal(manifest.headers.get('ETag'), '"m1"');
    const detail = await worker.fetch(request('facility/P-9.json'), env, ctx());
    assert.equal(detail.headers.get('X-Cache'), 'HIT');
    assert.equal(detail.headers.get('Cache-Control'), 'public, max-age=300');
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
