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
 * reads no header at all. M1 serves `session` (who is signed in); M3
 * (2026-09-08) adds `proposals` — the map edit mode's drafts, written to a
 * bucket of their own (`PROPOSALS`, `cleanplateva-proposals`) and nowhere
 * else: this Worker never writes the data bucket, Couch, or the ledger.
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
const CONTACT_PATH = '/api/contact';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith(DATA_PREFIX)) {
            return serveFullData(request, env, ctx, url);
        }
        if (url.pathname.startsWith(ADMIN_API_PREFIX)) {
            return serveAdminApi(request, env, url);
        }
        if (url.pathname === CONTACT_PATH) {
            return serveContact(request, env);
        }
        // Unreachable under the deployed run_worker_first (only the three
        // paths above invoke the worker); kept so a widened list still
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
 * Every answer is `no-store`. `/admin/api/proposals` (CPE-M3) is the drafts
 * route below; anything else under the prefix is 404.
 */
async function serveAdminApi(request, env, url) {
    const name = url.pathname.slice(ADMIN_API_PREFIX.length).replace(/\/+$/, '');
    if (name === 'session') return serveSession(request, env);
    if (name === 'proposals') return serveProposals(request, env);
    return json({ ok: false, reason: 'not found' }, 404, NO_STORE, request.method);
}

async function serveSession(request, env) {
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

// ── the proposals route (CPE-M3) ─────────────────────────────────────────

/**
 * `/admin/api/proposals` — the map edit mode's drafts (design ref §6.6,
 * `cleanplateva.map-draft.v1`). The browser proposes; the pipeline spine
 * disposes: a draft is what the operator saw and where each place was
 * dragged, stored here as content-addressed bytes for `cf_location.py
 * manual pull` (M4) to fetch and compose into the manual-pin contracts with
 * `before` from Couch. Nothing here reads or writes anything but the
 * proposals bucket.
 *
 *   POST   the draft as JSON → verify the Access token (401 before the body
 *          is read) → shape-check (≤ 64 KB, ≤ 200 pins, every coordinate
 *          inside the Virginia box the contract owner uses, the permit-id
 *          shapes the roster carries, `after` ≠ `published`, every pin on
 *          the batch point) → inject the server-owned fields — `operator`
 *          (PROPOSAL_OPERATOR), `instrument`, whole-second `saved_at`, and
 *          `submitted_by` from the verified email claim — refusing a draft
 *          that carries any of them → canonical bytes (sorted keys, compact,
 *          trailing newline: the contract owner's own canon, so the puller
 *          verifies the sha over the bytes it fetched) → put at
 *          `drafts/<compact-saved_at>-<sha8>.json`, NEVER overwriting: the
 *          same bytes in the same second answer 200 with `existing: true`
 *          and write nothing.
 *            201 { ok, key, sha256, pins, saved_at, existing: false }
 *            400 { ok: false, reason: "<path>: <what>" }   the draft's shape
 *            413 / 415                                       too big / not JSON
 *   GET    { ok, drafts: [...], truncated } — the `drafts/` prefix, newest
 *          first, each with the metadata the put recorded and `pulled`,
 *          true when a `pulled/<name>` marker stands beside it (the pull
 *          leaves one after composing). HEAD answers the headers alone.
 *
 * Every answer is `no-store`; 401 / 503 / 500 as the session route.
 */
const DRAFT_CONTRACT = 'cleanplateva.map-draft.v1';
const DRAFT_SCHEMA_VERSION = 1;
const DRAFT_INSTRUMENT = 'cleanplateva:map-editor@1';
/** Fields this Worker owns. A draft carrying one is refused loudly rather
 *  than silently overwritten — the host composer's rule. */
const SERVER_FIELDS = ['operator', 'instrument', 'saved_at', 'submitted_by'];
const DRAFT_KEYS = ['contract', 'schema_version', 'snapshot_id', 'tier', 'basemap', 'batch', 'pins'];
const BASEMAP_KEYS = ['style', 'zoom'];
const BATCH_KEYS = ['stack_key', 'group_lat', 'group_lon', 'facility_count', 'site_group_id'];
const PIN_KEYS = ['permit_id', 'kind', 'name', 'address', 'covers', 'published', 'after', 'note'];
const PUBLISHED_KEYS = ['lat', 'lon', 'loc', 'location'];
const AFTER_KEYS = ['lat', 'lon'];
const BASEMAP_STYLES = ['positron', 'dark-matter', 'aerial'];
const TIERS = ['full', 'lite'];
const PIN_KINDS = ['refinement', 'site'];
/** The location-class code of a ZIP centroid — the one class whose drag is
 *  a SITE fix (codes are positional identity, design ref §5). */
const LOC_ZIP_CENTROID = 2;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PINS = 200;
const MAX_TEXT = 200;
const MAX_NOTE = 2000;
const MAX_SNAPSHOT = 64;
/** The Virginia box — `manual_proposals.VA_LAT` / `VA_LON`, mirrored: a pin
 *  outside it is a fat-finger, not a judgment. */
const VA_LAT = [36.3, 39.7];
const VA_LON = [-83.9, -75.0];
/** A permit id as the roster carries it: VDH's canonical UPPERCASE UUID, or
 *  Fairfax County's `HFOOD-…` number (`HFOOD-000009485`, `HFOOD-2020-00039`
 *  — both shapes on the 2026-09-08 roster). */
const PERMIT_RE = /^(?:[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}|HFOOD-[0-9]{1,12}(?:-[0-9]{1,12})?)$/;
const GROUP_ID_RE = /^[0-9a-f]{12}$/;
const DRAFTS_PREFIX = 'drafts/';
const PULLED_PREFIX = 'pulled/';
/** How many drafts a list answers at most — one operator's judgments, in
 *  batches of a handful; a thousand means something else is writing here. */
const LIST_CAP = 1000;

async function serveProposals(request, env) {
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
        return json({ ok: false, reason: 'method not allowed' }, 405, NO_STORE);
    }
    const identity = await accessIdentity(request, env);
    if (!identity.ok) {
        return json({ ok: false, reason: identity.reason }, identity.status, NO_STORE, method);
    }
    const store = env.PROPOSALS;
    if (!store || typeof store.put !== 'function' || typeof store.list !== 'function' || typeof store.head !== 'function') {
        return json({ ok: false, reason: 'proposals store not configured' }, 500, NO_STORE, method);
    }
    if (method === 'POST') return storeDraft(request, env, store, identity);
    return listDrafts(store, method);
}

async function storeDraft(request, env, store, identity) {
    const operator = env.PROPOSAL_OPERATOR;
    if (typeof operator !== 'string' || !/^human:[a-z0-9_.-]+$/.test(operator)) {
        return json({ ok: false, reason: 'proposals operator not configured' }, 500, NO_STORE);
    }
    const contentType = (request.headers.get('Content-Type') || '').trim().toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
        return json({ ok: false, reason: 'the draft must be sent as application/json' }, 415, NO_STORE);
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return json({ ok: false, reason: `the draft exceeds ${MAX_BODY_BYTES} bytes` }, 413, NO_STORE);
    }
    let draft;
    try {
        draft = JSON.parse(text);
    } catch (_) {
        return json({ ok: false, reason: '$: not JSON' }, 400, NO_STORE);
    }
    const refusal = checkDraft(draft);
    if (refusal) return json({ ok: false, reason: refusal }, 400, NO_STORE);

    const savedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = {
        ...draft,
        operator,
        instrument: DRAFT_INSTRUMENT,
        saved_at: savedAt,
        submitted_by: identity.email,
    };
    const bytes = canonicalBytes(body);
    const sha256 = await sha256Hex(bytes);
    const key = `${DRAFTS_PREFIX}${savedAt.replace(/[-:]/g, '')}-${sha256.slice(0, 8)}.json`;
    const pins = draft.pins.length;
    const answer = { ok: true, key, sha256, pins, saved_at: savedAt };
    if (await store.head(key)) {
        return json({ ...answer, existing: true }, 200, NO_STORE);
    }
    await store.put(key, bytes, {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        customMetadata: {
            saved_at: savedAt,
            pins: String(pins),
            sha256,
            stack_key: draft.batch.stack_key,
            snapshot_id: draft.snapshot_id,
            submitted_by: identity.email,
        },
    });
    return json({ ...answer, existing: false }, 201, NO_STORE);
}

async function listDrafts(store, method) {
    const objects = await listAll(store, DRAFTS_PREFIX);
    const pulled = new Set((await listAll(store, PULLED_PREFIX)).map((o) => o.key.slice(PULLED_PREFIX.length)));
    const drafts = objects.map((object) => {
        const name = object.key.slice(DRAFTS_PREFIX.length);
        const meta = object.customMetadata || {};
        const pins = Number.parseInt(meta.pins, 10);
        return {
            key: object.key,
            name,
            saved_at: typeof meta.saved_at === 'string' ? meta.saved_at : null,
            pins: Number.isFinite(pins) ? pins : null,
            sha256: typeof meta.sha256 === 'string' ? meta.sha256 : null,
            stack_key: typeof meta.stack_key === 'string' ? meta.stack_key : null,
            snapshot_id: typeof meta.snapshot_id === 'string' ? meta.snapshot_id : null,
            submitted_by: typeof meta.submitted_by === 'string' ? meta.submitted_by : null,
            size: typeof object.size === 'number' ? object.size : null,
            uploaded: object.uploaded instanceof Date ? object.uploaded.toISOString()
                : (typeof object.uploaded === 'string' ? object.uploaded : null),
            pulled: pulled.has(name),
        };
    });
    // The key begins with the compact saved_at, so the key order is time order.
    drafts.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    return json({ ok: true, drafts, truncated: objects.length >= LIST_CAP }, 200, NO_STORE, method);
}

/** Every object under `prefix`, page by page, up to LIST_CAP. */
async function listAll(store, prefix) {
    const out = [];
    let cursor;
    do {
        const page = await store.list({ prefix, cursor, limit: 500, include: ['customMetadata'] });
        out.push(...(page.objects || []));
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && out.length < LIST_CAP);
    return out.slice(0, LIST_CAP);
}

// ── the contact route (2026-09-17) ───────────────────────────────────────

/**
 * `POST /api/contact` — a visitor's message to the maintainer (design ref
 * §6.7). The ONE public write route on this Worker, and the only one that
 * reads no identity at all: a message is not inspection data, so the tier
 * and the acknowledgement have nothing to say about it (the client posts
 * with plain `fetch`, never the data client — C2/C3 gate the ARCHIVE).
 *
 * Delivery is Cloudflare Email Service through the `CONTACT_EMAIL` send
 * binding, which is pinned in wrangler.jsonc to ONE `destination_address`.
 * That pin is the point: this code names no recipient, so no bug here and no
 * value in a request can make the Worker mail anyone but the maintainer's own
 * address. The visitor's address rides as `replyTo`, never as `from` — the
 * sender must be the onboarded sending domain or the send is refused
 * (E_SENDER_NOT_VERIFIED), and forging a visitor into `from` would be a
 * spoof besides.
 *
 *   200 { ok: true }              accepted and sent — and the same answer a
 *                                 honeypot submission gets, mailing nothing,
 *                                 so a bot learns nothing from the reply;
 *   400 { ok: false, reason }     "<field>: <what>" — the shape it refused;
 *   405 / 413 / 415               method · over MAX_CONTACT_BYTES · not JSON;
 *   429 { ok: false, reason }     over the per-address rate limit;
 *   500 { ok: false, reason }     a binding this route needs is missing —
 *                                 loud, as the proposals store is;
 *   502 { ok: false, reason }     Email Service refused or was unreachable.
 *
 * Every answer is `no-store`, and every answer is JSON: the client reads a
 * non-JSON body as "it did not arrive" (the SPA fallback under a mount with
 * no Worker behind it).
 */
const MAX_CONTACT_BYTES = 16 * 1024;
/** RFC 5321's maximum path length. Mirrors app/contact.ts EMAIL_MAX — the
 *  client's copy is a courtesy to the typist; THIS is the one that decides.
 *  `contact.spec.ts` pins the two in step. */
const CONTACT_EMAIL_MAX = 254;
const CONTACT_SUBJECT_MAX = 150;
const CONTACT_MESSAGE_MAX = 5000;
/** Deliberately permissive — see app/contact.ts EMAIL_RE, which this
 *  mirrors. The only authority on whether an address exists is a delivery
 *  attempt; this catches the typo a reply-to would die on. */
const CONTACT_EMAIL_RE = /^[^\s@,;<>"\\]+@[^\s@.,;<>"\\]+(?:\.[^\s@.,;<>"\\]+)+$/;
/** CR, LF and friends. Refused in the address and the subject because those
 *  become mail HEADERS; the message body keeps its newlines. */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
/** The subject a message arrives under, so the inbox can file it. */
const CONTACT_SUBJECT_TAG = '[CleanPlateVA]';

async function serveContact(request, env) {
    if (request.method !== 'POST') {
        return json({ ok: false, reason: 'method not allowed' }, 405, NO_STORE, request.method);
    }
    // Every binding checked BEFORE the body is read, so a misconfigured
    // deploy fails the same way on every request instead of only on the ones
    // whose shape happens to be valid.
    const mailer = env.CONTACT_EMAIL;
    if (!mailer || typeof mailer.send !== 'function') {
        return json({ ok: false, reason: 'contact mailer not configured' }, 500, NO_STORE);
    }
    const from = env.CONTACT_FROM;
    if (typeof from !== 'string' || !CONTACT_EMAIL_RE.test(from)) {
        return json({ ok: false, reason: 'contact sender not configured' }, 500, NO_STORE);
    }
    const limiter = env.CONTACT_LIMIT;
    if (!limiter || typeof limiter.limit !== 'function') {
        return json({ ok: false, reason: 'contact rate limit not configured' }, 500, NO_STORE);
    }

    const contentType = (request.headers.get('Content-Type') || '').trim().toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
        return json({ ok: false, reason: 'the message must be sent as application/json' }, 415, NO_STORE);
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_CONTACT_BYTES) {
        return json({ ok: false, reason: `the message exceeds ${MAX_CONTACT_BYTES} bytes` }, 413, NO_STORE);
    }
    let body;
    try {
        body = JSON.parse(text);
    } catch (_) {
        return json({ ok: false, reason: '$: not JSON' }, 400, NO_STORE);
    }
    if (!isObject(body)) {
        return json({ ok: false, reason: '$: must be an object' }, 400, NO_STORE);
    }

    // The rate limit is measured on the CONNECTING ADDRESS, before the send
    // and after the cheap checks — a refused shape should not spend a
    // visitor's allowance, and a flood should not reach Email Service. One
    // fixed key when the header is absent (local `wrangler dev`, a test):
    // that is a shared bucket, which is the safe direction to fail.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let allowed;
    try {
        allowed = await limiter.limit({ key: `contact:${ip}` });
    } catch (error) {
        // A limiter that cannot answer must not become an open door — and
        // must not be mistaken for a mail failure in the log either, since
        // both answer 502.
        console.error('contact: rate limiter failed', {
            name: error?.name ?? null,
            message: error?.message ?? String(error),
        });
        return json({ ok: false, reason: 'the message could not be sent' }, 502, NO_STORE);
    }
    if (!allowed?.success) {
        return json({
            ok: false,
            reason: 'too many messages from this address just now — try again in a minute',
        }, 429, NO_STORE);
    }

    const email = contactText(body.email, 'email', CONTACT_EMAIL_MAX);
    if (email.error) return json({ ok: false, reason: email.error }, 400, NO_STORE);
    if (CONTROL_CHARS_RE.test(email.value) || !CONTACT_EMAIL_RE.test(email.value)) {
        return json({ ok: false, reason: 'email: does not look like an email address' }, 400, NO_STORE);
    }
    const subject = contactText(body.subject, 'subject', CONTACT_SUBJECT_MAX);
    if (subject.error) return json({ ok: false, reason: subject.error }, 400, NO_STORE);
    if (CONTROL_CHARS_RE.test(subject.value)) {
        return json({ ok: false, reason: 'subject: cannot contain control characters' }, 400, NO_STORE);
    }
    const message = contactText(body.message, 'message', CONTACT_MESSAGE_MAX);
    if (message.error) return json({ ok: false, reason: message.error }, 400, NO_STORE);

    // The honeypot: a field no person can reach (app/ContactDialog.tsx hides
    // it from sight, from the accessible tree and from the tab order), so
    // anything in it filled every input it found. Answered with the SAME
    // success a real send gets — a bot that can tell refusal from acceptance
    // learns what to change.
    if (typeof body.trap === 'string' && body.trap.trim()) {
        return json({ ok: true }, 200, NO_STORE);
    }

    try {
        await mailer.send({
            from,
            // No `to`: the binding's `destination_address` is the recipient,
            // and leaving it out of the code is what makes that a guarantee.
            replyTo: email.value,
            subject: `${CONTACT_SUBJECT_TAG} ${subject.value}`,
            text: contactBody({
                email: email.value,
                message: message.value,
                ip,
                country: request.headers.get('CF-IPCountry') || 'unknown',
                receivedAt: new Date().toISOString(),
            }),
        });
    } catch (error) {
        // The reason is Email Service's (an unverified sender, a quota, an
        // outage) and is the site's problem, not the visitor's — so it is
        // LOGGED and never handed to the browser. The log is the whole point:
        // without it a 502 says only "something", and the first real failure
        // (2026-09-17, the deploy check) could not be told apart from a
        // missing binding without one. Codes are Email Service's own
        // (E_SENDER_NOT_VERIFIED, E_RECIPIENT_NOT_ALLOWED, E_RATE_LIMIT_
        // EXCEEDED, …); read them with `npx wrangler tail cleanplateva`.
        // Nothing the visitor typed is logged — only why the send failed.
        console.error('contact: send failed', {
            code: error?.code ?? null,
            name: error?.name ?? null,
            message: error?.message ?? String(error),
            from,
        });
        return json({ ok: false, reason: 'the message could not be sent' }, 502, NO_STORE);
    }
    return json({ ok: true }, 200, NO_STORE);
}

/** A required string field, trimmed, within `max`. `{ value }` or `{ error }`
 *  in the `"<field>: <what>"` grammar the proposals route refuses in. */
function contactText(value, field, max) {
    if (typeof value !== 'string') return { error: `${field}: must be a string`, value: '' };
    const trimmed = value.trim();
    if (!trimmed) return { error: `${field}: is required`, value: '' };
    if (trimmed.length > max) return { error: `${field}: at most ${max} characters`, value: '' };
    return { value: trimmed };
}

/** The message as it arrives in the inbox: the visitor's words first, then a
 *  fixed footer saying where it came from. The address is repeated below the
 *  rule because `replyTo` is a header a client may not show. */
function contactBody({ email, message, ip, country, receivedAt }) {
    return [
        message,
        '',
        '--',
        'Sent from the CleanPlateVA About page.',
        `From: ${email}`,
        `Received: ${receivedAt}`,
        `Origin: ${country} / ${ip}`,
    ].join('\n');
}

// ── the draft's shape ────────────────────────────────────────────────────

class DraftError extends Error {}

function refuse(path, what) {
    throw new DraftError(`${path}: ${what}`);
}

/** The reason a draft is refused, or null for one that passes every check.
 *  Every rule names the field it failed on (`$.pins[3].after: …`) — the
 *  contract owner's habit, so the drawer can say exactly what to fix. */
function checkDraft(draft) {
    try {
        validateDraft(draft);
        return null;
    } catch (error) {
        if (error instanceof DraftError) return error.message;
        throw error;
    }
}

function validateDraft(draft) {
    if (!isObject(draft)) refuse('$', 'must be an object');
    for (const field of SERVER_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(draft, field)) {
            refuse(`$.${field}`, 'is server-owned; remove it from the draft');
        }
    }
    exactKeys(draft, DRAFT_KEYS, '$');
    if (draft.contract !== DRAFT_CONTRACT) refuse('$.contract', `expected ${DRAFT_CONTRACT}`);
    if (draft.schema_version !== DRAFT_SCHEMA_VERSION) refuse('$.schema_version', `expected ${DRAFT_SCHEMA_VERSION}`);
    text(draft.snapshot_id, '$.snapshot_id', MAX_SNAPSHOT);
    if (!TIERS.includes(draft.tier)) refuse('$.tier', `expected one of ${TIERS.join(', ')}`);

    exactKeys(draft.basemap, BASEMAP_KEYS, '$.basemap');
    if (!BASEMAP_STYLES.includes(draft.basemap.style)) {
        refuse('$.basemap.style', `expected one of ${BASEMAP_STYLES.join(', ')}`);
    }
    const zoom = number(draft.basemap.zoom, '$.basemap.zoom');
    if (zoom < 0 || zoom > 24) refuse('$.basemap.zoom', `${zoom} outside MapLibre 0..24`);

    const batch = draft.batch;
    exactKeys(batch, BATCH_KEYS, '$.batch');
    const group = coordinate({ lat: batch.group_lat, lon: batch.group_lon }, '$.batch.group');
    if (batch.stack_key !== pointKey(group.lat, group.lon)) {
        refuse('$.batch.stack_key', 'must be the 6-dp key of group_lat,group_lon');
    }
    if (!Number.isInteger(batch.facility_count) || batch.facility_count < 1) {
        refuse('$.batch.facility_count', 'must be an integer >= 1');
    }
    if (batch.site_group_id !== null
        && !(typeof batch.site_group_id === 'string' && GROUP_ID_RE.test(batch.site_group_id))) {
        refuse('$.batch.site_group_id', 'expected 12 lowercase hex, or null');
    }

    const pins = draft.pins;
    if (!Array.isArray(pins) || !pins.length) refuse('$.pins', 'must be a non-empty list');
    if (pins.length > MAX_PINS) refuse('$.pins', `at most ${MAX_PINS} pins per draft`);
    const seen = new Set();
    const covered = new Set();
    pins.forEach((pin, index) => {
        const path = `$.pins[${index}]`;
        exactKeys(pin, PIN_KEYS, path);
        const permit = permitId(pin.permit_id, `${path}.permit_id`);
        if (seen.has(permit)) refuse(`${path}.permit_id`, `duplicate pin for ${permit}`);
        seen.add(permit);
        if (!PIN_KINDS.includes(pin.kind)) refuse(`${path}.kind`, `expected one of ${PIN_KINDS.join(', ')}`);
        text(pin.name, `${path}.name`, MAX_TEXT);
        if (pin.address !== null) text(pin.address, `${path}.address`, MAX_TEXT);

        exactKeys(pin.published, PUBLISHED_KEYS, `${path}.published`);
        const published = coordinate(pin.published, `${path}.published`);
        if (!Number.isInteger(pin.published.loc) || pin.published.loc < 0) {
            refuse(`${path}.published.loc`, 'must be a location-class code (a non-negative integer)');
        }
        if ((pin.kind === 'site') !== (pin.published.loc === LOC_ZIP_CENTROID)) {
            refuse(`${path}.kind`, 'a site fix is a ZIP-centroid place (loc 2), and only that');
        }
        if (pin.published.location !== null && !isObject(pin.published.location)) {
            refuse(`${path}.published.location`, "must be the detail's location block, or null");
        }
        if (pointKey(published.lat, published.lon) !== batch.stack_key) {
            refuse(`${path}.published`, 'must stand on the batch point (stack_key)');
        }

        exactKeys(pin.after, AFTER_KEYS, `${path}.after`);
        const after = coordinate(pin.after, `${path}.after`);
        if (after.lat.toFixed(7) === published.lat.toFixed(7) && after.lon.toFixed(7) === published.lon.toFixed(7)) {
            refuse(`${path}.after`, 'identical to the published point — the pin proposes nothing');
        }

        if (pin.note !== null) {
            text(pin.note, `${path}.note`, MAX_NOTE);
        }

        if (!Array.isArray(pin.covers) || !pin.covers.length) {
            refuse(`${path}.covers`, 'must be a non-empty list of permit ids');
        }
        if (pin.covers.length > MAX_PINS) refuse(`${path}.covers`, `at most ${MAX_PINS} permits`);
        pin.covers.forEach((value, j) => {
            const id = permitId(value, `${path}.covers[${j}]`);
            if (covered.has(id)) refuse(`${path}.covers[${j}]`, `${id} already covered — one permit has one address`);
            covered.add(id);
        });
        if (!pin.covers.includes(permit)) refuse(`${path}.covers`, "must include the pin's own permit");
        if (pin.kind === 'refinement' && pin.covers.length !== 1) {
            refuse(`${path}.covers`, 'a refinement moves its own permit alone');
        }
    });
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, path) {
    if (!isObject(value)) refuse(path, 'must be an object');
    const present = Object.keys(value);
    const missing = keys.filter((k) => !present.includes(k)).sort();
    const extra = present.filter((k) => !keys.includes(k)).sort();
    if (missing.length || extra.length) {
        refuse(path, `exact fields required; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
    }
}

function number(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) refuse(path, 'must be a finite number');
    return value;
}

function text(value, path, max) {
    if (typeof value !== 'string' || !value.trim()) refuse(path, 'must be a non-empty string');
    if (value.length > max) refuse(path, `at most ${max} characters`);
    return value;
}

function coordinate(container, path) {
    if (!isObject(container)) refuse(path, 'must be an object');
    const lat = number(container.lat, `${path}.lat`);
    const lon = number(container.lon, `${path}.lon`);
    if (!(lat >= VA_LAT[0] && lat <= VA_LAT[1] && lon >= VA_LON[0] && lon <= VA_LON[1])) {
        refuse(path, `(${lat}, ${lon}) is outside the Virginia bounds guard`);
    }
    return { lat, lon };
}

function permitId(value, path) {
    if (typeof value !== 'string' || !PERMIT_RE.test(value)) {
        refuse(path, 'expected a permit id as the roster carries it (an uppercase UUID, or HFOOD-…)');
    }
    return value;
}

/** The 6-dp point key the map stacks on (app/mapData.ts stackKey). */
function pointKey(lat, lon) {
    return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

// ── the canon ────────────────────────────────────────────────────────────

/** Sorted keys at every depth, compact separators, a trailing newline,
 *  UTF-8 — byte-identical to `manual_proposals._canonical_bytes` for the
 *  values a draft carries (ASCII keys; numbers JSON already printed
 *  shortest-round-trip). */
function canonicalBytes(value) {
    return new TextEncoder().encode(`${JSON.stringify(sortKeys(value))}\n`);
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!isObject(value)) return value;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
}

async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
