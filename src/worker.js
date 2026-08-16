/**
 * Worker entry: static site + the authenticated full-data channel.
 *
 * Requests under /data-full/* are served from the R2 bucket (the complete
 * inspection archive — never part of the repo or the static assets).
 * Cloudflare Access enforces authentication at the edge before this worker
 * runs; the JWT-header check below is defense-in-depth so the data stays
 * closed even if the Access application were removed or misconfigured.
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
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname.startsWith(DATA_PREFIX)) {
            return serveFullData(request, env, url);
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

async function serveFullData(request, env, url) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ available: false, reason: 'method not allowed' }, 405);
    }
    // Present only when the request passed Cloudflare Access.
    if (!request.headers.get('Cf-Access-Jwt-Assertion')) {
        return json({ available: false, reason: 'authentication required' }, 403);
    }
    const key = decodeURIComponent(url.pathname.slice(DATA_PREFIX.length));
    // Sign-in helper: a gated no-op that sends the (now-authenticated)
    // browser back to the app, where the data fetch picks up the session.
    if (key === 'signin') {
        return Response.redirect(new URL('/', url).toString(), 302);
    }
    if (!key || key.includes('..')) {
        return json({ available: false, reason: 'bad path' }, 400);
    }
    const object = await env.DATA_FULL.get(key);
    if (object === null) {
        return json({ available: false, reason: 'not found' }, 404);
    }
    return new Response(object.body, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'ETag': object.httpEtag,
            // Browser-private caching only — gated data must not land in
            // shared caches.
            'Cache-Control': fullDataCacheControl(key),
        },
    });
}

function fullDataCacheControl(key) {
    if (key === 'manifest.json') return 'private, max-age=60, must-revalidate';
    if (/^(finder|signals)\/[0-9a-f]+-[0-9a-f]{12}\.json$/.test(key)) {
        return 'private, max-age=31536000, immutable';
    }
    return 'private, max-age=300';
}

function json(payload, status) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}
