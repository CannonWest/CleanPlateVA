/**
 * Worker entry: the full-data channel, and — since CPE-M1 (2026-09-08) —
 * the admin API under /admin/api/*.
 *
 * Requests under /data-full/* are served from the R2 bucket (the complete
 * inspection archive — never part of the repo or the static assets). Since
 * CPF-M2 (design ref docs/architecture-v4.md §9) the channel is PUBLIC: the
 * tier boundary is the visitor's acknowledgement in the client (ack.ts), not
 * a transport secret. Responses carry public cache-control and are cached at
 * the edge through the Cache API, so a shard or detail is read from R2 once
 * per colo per generation rather than once per visitor.
 *
 * Requests under /admin/api/* are the edit modes' server side (design ref
 * docs/frontend-redesign.md §6.6). The path is inside the Cloudflare Access
 * application `CleanPlateVA admin` (both hosts, the /admin prefix), so Access
 * answers an unauthenticated request with its login redirect before this
 * Worker sees it — measured 2026-09-07 on both hosts. What this Worker adds
 * is the second lock: it verifies the SIGNATURE of the application token
 * Access forwards, against the team's published keys, and takes the
 * operator's identity from the verified claims. That is an identity check on
 * one operator's route — never a tier boundary; the full channel below still
 * reads no header at all. M1 serves `session` (who is signed in); M3 adds
 * `proposals`.
 *
 * The site and the committed public data channel (/data/*) are static
 * assets served WITHOUT this worker (wrangler.jsonc lists exactly the two
 * prefixes above in run_worker_first; public/_headers carries /data/*'s
 * cache-control). That is the request diet (design ref §9, D-TRANSPORT-4,
 * CPH-M3): on Workers Free the metered unit is the request, and static-asset
 * requests served without the worker are free. The re-404 of a missing
 * /data/ shard that used to live here moved into the client, which treats
 * the SPA fallback's HTML on a shard path as a miss.
 */

const DATA_PREFIX = '/data-full/';
const ADMIN_API_PREFIX = '/admin/api/';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith(DATA_PREFIX)) {
            return serveFullData(request, env, ctx, url);
        }
        if (url.pathname.startsWith(ADMIN_API_PREFIX)) {
            return serveAdminApi(request, env, url);
        }
        // Unreachable under the deployed run_worker_first (only the two
        // prefixes above invoke the worker); kept so a widened list still
        // serves the site rather than 404ing it.
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

function json(payload, status, extraHeaders = {}, method = 'GET') {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    return new Response(method === 'HEAD' ? null : JSON.stringify(payload), { status, headers });
}

// ── the admin API (CPE-M1) ───────────────────────────────────────────────

/** The request header Cloudflare Access adds to a request it has passed
 *  (Cloudflare One: "Validate JWTs" — validate the header, not the cookie,
 *  which a non-browser client may not carry). Read here and nowhere else:
 *  the full channel above is public and consults no header. */
const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

/** Nothing under the admin API is cacheable anywhere. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * `/admin/api/session` — who is signed in, from the verified token. GET/HEAD.
 *
 *   200 { ok: true, email, exp }   the token verified; `exp` is its expiry
 *                                  (unix seconds), which the client stores as
 *                                  the device flag's own expiry;
 *   401 { ok: false, reason }      no token, or one that failed a check;
 *   503 { ok: false, reason }      the team's keys could not be fetched — a
 *                                  transient the client must not read as
 *                                  "signed out".
 *
 * Every answer is `no-store`. Anything else under the prefix is 404 (M3 adds
 * `proposals`).
 */
async function serveAdminApi(request, env, url) {
    const name = url.pathname.slice(ADMIN_API_PREFIX.length).replace(/\/+$/, '');
    if (name !== 'session') {
        return json({ ok: false, reason: 'not found' }, 404, NO_STORE, request.method);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, reason: 'method not allowed' }, 405, NO_STORE);
    }
    const identity = await accessIdentity(request, env);
    if (!identity.ok) {
        return json({ ok: false, reason: identity.reason }, identity.status, NO_STORE, request.method);
    }
    return json({ ok: true, email: identity.email, exp: identity.exp }, 200, NO_STORE, request.method);
}

/**
 * The operator behind a request, from the Access token — or why not.
 *
 * The token is verified, not trusted: its RS256 signature against the key
 * the team domain publishes under the token's `kid`, then `iss` (the team
 * domain), `aud` (this application's audience tag), and `exp`. The
 * application's identifiers ride in wrangler.jsonc `vars`
 * (ACCESS_TEAM_DOMAIN, ACCESS_AUD): configuration, not code, and a test can
 * point them at a key pair of its own.
 */
async function accessIdentity(request, env) {
    const token = request.headers.get(ACCESS_HEADER);
    if (!token) return { ok: false, status: 401, reason: 'no session' };
    const team = env.ACCESS_TEAM_DOMAIN;
    const aud = env.ACCESS_AUD;
    if (!team || !aud) return { ok: false, status: 500, reason: 'access not configured' };
    let certs;
    try {
        certs = await accessCerts(team);
    } catch (_) {
        return { ok: false, status: 503, reason: 'keys unavailable' };
    }
    const claims = await verifyAccessJwt(token, certs, {
        team, aud, now: Math.floor(Date.now() / 1000),
    });
    if (!claims) return { ok: false, status: 401, reason: 'invalid session' };
    return { ok: true, email: claims.email, exp: claims.exp };
}

/** The team's current + previous keys (JWK), edge-cached for an hour —
 *  Access rotates every 6 weeks and keeps the previous key valid for 7 days,
 *  so an hour's staleness never outlives a key. */
async function accessCerts(team) {
    const response = await fetch(`${team}/cdn-cgi/access/certs`, {
        cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`certs ${response.status}`);
    return response.json();
}

/**
 * Verify one Access application token. Returns `{ email, exp }` for a token
 * that passes EVERY check, null for anything else — a malformed token, an
 * unknown or non-RSA key, a bad signature, the wrong issuer or audience, an
 * expired or not-yet-valid token, or one without an email claim. Nothing
 * here throws on bad input: a bad token is a 401, never a 500.
 */
async function verifyAccessJwt(token, certs, { team, aud, now }) {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    let header;
    let payload;
    try {
        header = JSON.parse(base64UrlText(parts[0]));
        payload = JSON.parse(base64UrlText(parts[1]));
    } catch (_) {
        return null;
    }
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const jwk = (certs?.keys || []).find((k) => k && k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) return null;
    let key;
    try {
        key = await crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
        );
    } catch (_) {
        return null;
    }
    let valid = false;
    try {
        valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            base64UrlBytes(parts[2]),
            new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        );
    } catch (_) {
        return null;
    }
    if (!valid || !payload || typeof payload !== 'object') return null;
    if (payload.iss !== team) return null;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
    if (typeof payload.email !== 'string' || !payload.email) return null;
    return { email: payload.email, exp: payload.exp };
}

function base64UrlBytes(text) {
    const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
}

function base64UrlText(text) {
    return new TextDecoder().decode(base64UrlBytes(text));
}
