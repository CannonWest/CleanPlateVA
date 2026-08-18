/**
 * Worker entry: the full-data channel, and nothing else.
 *
 * Requests under /data-full/* are served from the R2 bucket (the complete
 * inspection archive — never part of the repo or the static assets). Since
 * CPF-M2 (design ref docs/architecture-v4.md §9) the channel is PUBLIC: the
 * tier boundary is the visitor's acknowledgement in the client (ack.js), not
 * a transport secret. Responses carry public cache-control and are cached at
 * the edge through the Cache API, so a shard or detail is read from R2 once
 * per colo per generation rather than once per visitor.
 *
 * The site and the committed public data channel (/data/*) are static
 * assets served WITHOUT this worker (wrangler.jsonc lists only /data-full/*
 * in run_worker_first; public/_headers carries /data/*'s cache-control).
 * That is the request diet (design ref §9, D-TRANSPORT-4, CPH-M3): on
 * Workers Free the metered unit is the request, and static-asset requests
 * served without the worker are free. The re-404 of a missing /data/ shard
 * that used to live here moved into the client, which treats the SPA
 * fallback's HTML on a shard path as a miss.
 */

const DATA_PREFIX = '/data-full/';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith(DATA_PREFIX)) {
            return serveFullData(request, env, ctx, url);
        }
        // Unreachable under the deployed run_worker_first (only /data-full/*
        // invokes the worker); kept so a widened list still serves the site
        // rather than 404ing it.
        return env.ASSETS.fetch(request);
    },
};

/**
 * The full channel. GET/HEAD only; the object key is the path under the
 * prefix. Reads go edge cache → R2:
 *
 *   · Cache API (`caches.default`, keyed by the request URL) answers repeat
 *     reads in the same colo without touching R2 and marks them
 *     `X-Cache: HIT`; a miss reads R2, answers `X-Cache: MISS`, and stores
 *     a copy for the next reader (its `Cache-Control` decides how long —
 *     manifest 60 s, content-addressed shards a year, details 300 s);
 *   · a conditional request (`If-None-Match` from a browser revalidating a
 *     detail or the manifest) is honored by the cache and, on a miss, by
 *     R2's `onlyIf`, so an unchanged object costs a 304 and no body.
 *
 * Every hit still invokes this Worker (Workers Free counts it — design ref
 * §9); what the cache saves is R2 reads and origin latency, not requests.
 */
async function serveFullData(request, env, ctx, url) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ available: false, reason: 'method not allowed' }, 405);
    }
    const key = decodeURIComponent(url.pathname.slice(DATA_PREFIX.length));
    if (!key || key.includes('..')) {
        return json({ available: false, reason: 'bad path' }, 400);
    }

    const cacheControl = fullDataCacheControl(key);
    const cache = edgeCache();
    // The cache is keyed on GET; a HEAD is answered from the same entry.
    const cacheKey = request.method === 'GET'
        ? request
        : new Request(request.url, { method: 'GET', headers: request.headers });
    if (cache) {
        const hit = await cache.match(cacheKey);
        // The zone's Browser Cache TTL rewrites the Cache-Control that
        // `match()` hands back (measured 2026-08-17: a stored max-age=60 came
        // out as max-age=14400), so the contract's value is re-asserted on
        // the way out — the browser must revalidate the manifest in 60 s and
        // a detail in 300 s no matter which edge answered.
        if (hit) return withDiagnostic(hit, 'HIT', request.method, cacheControl);
    }

    const object = await env.DATA_FULL.get(key, { onlyIf: request.headers });
    if (object === null) {
        return json({ available: false, reason: 'not found' }, 404);
    }
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'ETag': object.httpEtag,
        'Cache-Control': cacheControl,
    });
    // R2 answered the condition: the object is unchanged, no body follows.
    if (object.body === undefined || object.body === null) {
        return new Response(null, { status: 304, headers });
    }
    const response = new Response(object.body, { status: 200, headers });
    if (cache && request.method === 'GET') {
        const store = cache.put(cacheKey, response.clone());
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(store);
        else await store;
    }
    return withDiagnostic(response, 'MISS', request.method, cacheControl);
}

/** Public cache-control for the full channel (design ref §9): the manifest
 *  revalidates quickly, content-addressed shards are immutable, everything
 *  else (details, standards) is short-lived and revalidates by ETag. */
function fullDataCacheControl(key) {
    if (key === 'manifest.json') return 'public, max-age=60, must-revalidate';
    // Content-addressed roster shards: Contract V4's finder / overlay / closed
    // (the retired V3 signals family keeps the rule for its one retained
    // generation after cutover).
    if (/^(finder|overlay|closed|signals)\/[0-9a-f]+-[0-9a-f]{12}\.json$/.test(key)) {
        return 'public, max-age=31536000, immutable';
    }
    return 'public, max-age=300';
}

/** `caches.default` where the runtime provides it (the Workers runtime does;
 *  the node:test harness may or may not — the channel works either way). */
function edgeCache() {
    try {
        return globalThis.caches?.default || null;
    } catch (_) {
        return null;
    }
}

/** Return `response` with the X-Cache diagnostic and the contract's
 *  Cache-Control re-asserted, as a fresh Response so a cached body is never
 *  consumed in place; a HEAD gets the headers only. */
function withDiagnostic(response, status, method, cacheControl) {
    const headers = new Headers(response.headers);
    headers.set('X-Cache', status);
    if (cacheControl) headers.set('Cache-Control', cacheControl);
    return new Response(method === 'HEAD' ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function json(payload, status) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}
