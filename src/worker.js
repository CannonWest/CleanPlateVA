/**
 * Worker entry: static site + the full-data channel.
 *
 * Requests under /data-full/* are served from the R2 bucket (the complete
 * inspection archive — never part of the repo or the static assets). Since
 * CPF-M2 (design ref docs/architecture-v4.md §9) the channel is PUBLIC: the
 * tier boundary is the visitor's acknowledgement in the client (ack.js), not
 * a transport secret. Responses carry public cache-control and are cached at
 * the edge through the Cache API, so a shard or detail is read from R2 once
 * per colo per generation rather than once per visitor.
 *
 * Everything else falls through to the static assets in public/ — with one
 * correction on the way out, see `looksLikeAsset` below.
 */

const DATA_PREFIX = '/data-full/';

// The site's view paths (/list, /about, …) are served by
// `assets.not_found_handling: "single-page-application"`, which hands back
// index.html for ANYTHING it cannot find — including a mistyped script or a
// data shard that is genuinely missing. That turns a clean 404 into a 200
// of HTML: `dataClient` would try to JSON.parse markup, and a bad <script>
// src would fail on MIME type instead of saying "not found". So the worker
// re-imposes the honest answer for paths that are obviously assets — a last
// segment carrying a file extension other than .html — while leaving
// extension-less view paths to the SPA fallback they exist for.
const HTML_EXTENSIONS = new Set(['html', 'htm']);

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith(DATA_PREFIX)) {
            return serveFullData(request, env, ctx, url);
        }
        const response = await env.ASSETS.fetch(request);
        if (isSpaFallback(response) && looksLikeAsset(url.pathname)) {
            return new Response('Not found', {
                status: 404,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }
        const publicCache = publicDataCacheControl(url.pathname);
        if (publicCache) {
            const headers = new Headers(response.headers);
            headers.set('Cache-Control', publicCache);
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
        }
        return response;
    },
};

/** A path whose last segment carries a non-HTML file extension. */
function looksLikeAsset(pathname) {
    const last = pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0 || dot === last.length - 1) return false;
    return !HTML_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

/** The SPA fallback answers 200 with the HTML shell. A real asset is never
 *  both — so HTML on an asset path means "the fallback caught a miss". */
function isSpaFallback(response) {
    return response.status === 200
        && (response.headers.get('Content-Type') || '').includes('text/html');
}

function publicDataCacheControl(pathname) {
    if (pathname === '/data/manifest.json') {
        return 'public, max-age=60, must-revalidate';
    }
    if (/^\/data\/finder\/[0-9a-f]+-[0-9a-f]{12}\.json$/.test(pathname)) {
        return 'public, max-age=31536000, immutable';
    }
    return null;
}

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

    const cache = edgeCache();
    // The cache is keyed on GET; a HEAD is answered from the same entry.
    const cacheKey = request.method === 'GET'
        ? request
        : new Request(request.url, { method: 'GET', headers: request.headers });
    if (cache) {
        const hit = await cache.match(cacheKey);
        if (hit) return withDiagnostic(hit, 'HIT', request.method);
    }

    const object = await env.DATA_FULL.get(key, { onlyIf: request.headers });
    if (object === null) {
        return json({ available: false, reason: 'not found' }, 404);
    }
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'ETag': object.httpEtag,
        'Cache-Control': fullDataCacheControl(key),
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
    return withDiagnostic(response, 'MISS', request.method);
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

/** Return `response` with the X-Cache diagnostic, as a fresh Response so a
 *  cached body is never consumed in place; a HEAD gets the headers only. */
function withDiagnostic(response, status, method) {
    const headers = new Headers(response.headers);
    headers.set('X-Cache', status);
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
