// The admin API's session route (CPE-M1, design ref frontend-redesign.md
// §6.6): `GET /admin/api/session` verifies the token Cloudflare Access
// forwards — signature against the team's published key, then issuer,
// audience, expiry — and names the operator. Driven with a key pair of the
// test's own: the certs endpoint is a stubbed fetch, the tokens are signed
// here, and every check is exercised by breaking exactly one thing.
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

type KeyPair = { publicKey: KeyObject; privateKey: KeyObject }
import { afterEach, beforeEach, test } from 'vitest'
import worker from '../../src/worker.js'

const TEAM = 'https://team.test.cloudflareaccess.com'
const AUD = 'a'.repeat(64)
const KID = 'kid-current'
const OTHER_KID = 'kid-previous'

type Env = {
    DATA_FULL: { get: (key: string) => Promise<{ body?: string | null; httpEtag: string } | null> }
    ASSETS: { fetch: (request: Request) => Promise<Response> }
    ACCESS_TEAM_DOMAIN?: string
    ACCESS_AUD?: string
}

const env: Env = {
    DATA_FULL: { get: async () => ({ body: '{}', httpEtag: '"etag"' }) },
    ASSETS: { fetch: async () => new Response('asset') },
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
}

// One RSA pair per run; a second pair stands in for a rotated-out key.
const rsaPair = (): KeyPair =>
    generateKeyPairSync('rsa', { modulusLength: 2048 }) as unknown as KeyPair
const current = rsaPair()
const previous = rsaPair()

function jwk(pair: KeyPair, kid: string) {
    const exported = pair.publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }
    return { kid, kty: exported.kty, n: exported.n, e: exported.e, alg: 'RS256', use: 'sig' }
}

const certs = {
    keys: [jwk(current, KID), jwk(previous, OTHER_KID)],
    public_cert: { kid: KID, cert: '-----BEGIN CERTIFICATE-----' },
    public_certs: [{ kid: KID, cert: '' }, { kid: OTHER_KID, cert: '' }],
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url')

/** A token the way Access mints one: RS256, `kid` in the header, the claims
 *  the check reads plus the ones it ignores. */
function token(claims: Record<string, unknown>, {
    kid = KID,
    alg = 'RS256',
    key = current.privateKey,
}: { kid?: string; alg?: string; key?: KeyObject } = {}) {
    const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }))
    const payload = b64url(JSON.stringify(claims))
    const signature = signBytes('sha256', Buffer.from(`${header}.${payload}`), key)
    return `${header}.${payload}.${b64url(signature)}`
}

const now = () => Math.floor(Date.now() / 1000)
const goodClaims = () => ({
    aud: [AUD], iss: TEAM, email: 'operator@example.test', iat: now() - 10, exp: now() + 3600,
    type: 'app', identity_nonce: 'n', sub: 'sub', country: 'US',
})

const session = (init: RequestInit = {}) =>
    worker.fetch(new Request('https://cleanplateva.test/admin/api/session', init), env, {})
const withToken = (jwt: string, init: RequestInit = {}) =>
    session({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Cf-Access-Jwt-Assertion': jwt } })

const originalFetch = globalThis.fetch
let certsFetches: string[]
beforeEach(() => {
    certsFetches = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input)
        certsFetches.push(url)
        return new Response(JSON.stringify(certs), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
})
afterEach(() => {
    globalThis.fetch = originalFetch
})

test('a token signed by the current key, for this application, names the operator — no-store', async () => {
    const response = await withToken(token(goodClaims()))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
    const body = await response.json() as { ok: boolean; email: string; exp: number }
    assert.equal(body.ok, true)
    assert.equal(body.email, 'operator@example.test')
    assert.ok(body.exp > now(), 'the token expiry is handed back for the device flag')
    assert.deepEqual(certsFetches, [`${TEAM}/cdn-cgi/access/certs`], 'the keys come from the team domain')
})

test('the previous key still verifies (Access keeps it valid 7 days after a rotation)', async () => {
    const response = await withToken(token(goodClaims(), { kid: OTHER_KID, key: previous.privateKey }))
    assert.equal(response.status, 200)
})

test('no token → 401 no-store, and no keys are fetched', async () => {
    const response = await session()
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await response.json(), { ok: false, reason: 'no session' })
    assert.deepEqual(certsFetches, [])
})

test('a token signed by a key the team does not publish → 401 (the signature check is the lock)', async () => {
    const stranger = rsaPair()
    // Right kid, wrong key: the signature does not verify against the published n/e.
    assert.equal((await withToken(token(goodClaims(), { key: stranger.privateKey }))).status, 401)
    // Unknown kid: no key to check against.
    assert.equal((await withToken(token(goodClaims(), { kid: 'kid-nobody', key: stranger.privateKey }))).status, 401)
})

test('a token with the right signature but the wrong claims → 401: audience, issuer, expiry, no email', async () => {
    assert.equal((await withToken(token({ ...goodClaims(), aud: ['b'.repeat(64)] }))).status, 401, 'another application')
    assert.equal((await withToken(token({ ...goodClaims(), iss: 'https://someone-else.cloudflareaccess.com' }))).status, 401, 'another team')
    assert.equal((await withToken(token({ ...goodClaims(), exp: now() - 1 }))).status, 401, 'expired')
    assert.equal((await withToken(token({ ...goodClaims(), nbf: now() + 3600 }))).status, 401, 'not yet valid')
    const { email: _email, ...noEmail } = goodClaims()
    assert.equal((await withToken(token(noEmail))).status, 401, 'no email claim')
    // `aud` as a bare string is accepted (the claim's shape varies).
    assert.equal((await withToken(token({ ...goodClaims(), aud: AUD }))).status, 200)
})

test('a malformed or mis-typed token is a 401, never a throw', async () => {
    for (const bad of ['nonsense', 'a.b', 'a.b.c', `${b64url('{"alg":"HS256","kid":"x"}')}.${b64url('{}')}.sig`, '..']) {
        const response = await withToken(bad)
        assert.equal(response.status, 401, JSON.stringify(bad))
        assert.deepEqual(await response.json(), { ok: false, reason: 'invalid session' })
    }
    // alg:none with a matching kid must not pass either.
    const header = b64url(JSON.stringify({ alg: 'none', kid: KID }))
    assert.equal((await withToken(`${header}.${b64url(JSON.stringify(goodClaims()))}.`)).status, 401)
})

test('the keys unreachable → 503, not "signed out": the client must not clear a session over a transient', async () => {
    globalThis.fetch = (async () => new Response('gone', { status: 502 })) as typeof fetch
    const response = await withToken(token(goodClaims()))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { ok: false, reason: 'keys unavailable' })
})

test('unconfigured vars → 500 with a reason, so a mis-deploy is loud', async () => {
    const bare = { ...env, ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined }
    const response = await worker.fetch(new Request('https://cleanplateva.test/admin/api/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token(goodClaims()) },
    }), bare, {})
    assert.equal(response.status, 500)
})

test('HEAD answers the headers alone; other methods are 405; other names under the prefix are 404', async () => {
    const head = await withToken(token(goodClaims()), { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('Cache-Control'), 'no-store')
    assert.equal(await head.text(), '')
    assert.equal((await withToken(token(goodClaims()), { method: 'POST' })).status, 405)
    const missing = await worker.fetch(new Request('https://cleanplateva.test/admin/api/nope'), env, {})
    assert.equal(missing.status, 404)
    assert.equal(missing.headers.get('Cache-Control'), 'no-store')
    // M3's route is not here yet — until it lands, it is 404 like any other name.
    assert.equal((await worker.fetch(new Request('https://cleanplateva.test/admin/api/proposals', { method: 'POST' }), env, {})).status, 404)
})
