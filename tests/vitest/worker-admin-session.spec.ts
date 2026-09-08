// The admin API's session route (CPE-M1, design ref frontend-redesign.md
// §6.6): `GET /admin/api/session` verifies the token Cloudflare Access
// forwards — signature against the team's published key, then issuer,
// audience, expiry — and names the operator. Driven with a key pair of the
// test's own (tests/vitest/support/access.ts, shared with the proposals
// route's spec since CPE-M3): the certs endpoint is a stubbed fetch, the
// tokens are signed here, and every check is exercised by breaking exactly
// one thing.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'vitest'
import worker from '../../src/worker.js'
import {
    AUD, b64url, goodClaims, KID, now, OTHER_KID, previous, rsaPair, stubCerts, TEAM, token,
} from './support/access'

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

const session = (init: RequestInit = {}) =>
    worker.fetch(new Request('https://cleanplateva.test/admin/api/session', init), env, {})
const withToken = (jwt: string, init: RequestInit = {}) =>
    session({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Cf-Access-Jwt-Assertion': jwt } })

let certsFetches: string[]
let restoreFetch: () => void
beforeEach(() => {
    const stub = stubCerts()
    certsFetches = stub.fetches
    restoreFetch = stub.restore
})
afterEach(() => {
    restoreFetch()
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
    // M3's route is its own (worker-admin-proposals.spec.ts); without a token
    // it answers 401 like this one, never 404.
    assert.equal((await worker.fetch(new Request('https://cleanplateva.test/admin/api/proposals', { method: 'POST' }), env, {})).status, 401)
})
