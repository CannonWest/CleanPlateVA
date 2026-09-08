// The Access application token, minted by the tests themselves (CPE-M1, and
// CPE-M3's proposals route): an RSA pair per run, a second pair standing in
// for a rotated-out key, the team's certs document as the Worker fetches it,
// and a signer that writes a token the way Access does — RS256, `kid` in the
// header, the claims the check reads plus the ones it ignores. Shared by
// worker-admin-session.spec.ts and worker-admin-proposals.spec.ts.
import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

export type KeyPair = { publicKey: KeyObject; privateKey: KeyObject }

export const TEAM = 'https://team.test.cloudflareaccess.com'
export const AUD = 'a'.repeat(64)
export const KID = 'kid-current'
export const OTHER_KID = 'kid-previous'
export const EMAIL = 'operator@example.test'

export const rsaPair = (): KeyPair =>
    generateKeyPairSync('rsa', { modulusLength: 2048 }) as unknown as KeyPair
export const current = rsaPair()
export const previous = rsaPair()

export function jwk(pair: KeyPair, kid: string) {
    const exported = pair.publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }
    return { kid, kty: exported.kty, n: exported.n, e: exported.e, alg: 'RS256', use: 'sig' }
}

export const certs = {
    keys: [jwk(current, KID), jwk(previous, OTHER_KID)],
    public_cert: { kid: KID, cert: '-----BEGIN CERTIFICATE-----' },
    public_certs: [{ kid: KID, cert: '' }, { kid: OTHER_KID, cert: '' }],
}

export const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url')

/** A token the way Access mints one. */
export function token(claims: Record<string, unknown>, {
    kid = KID,
    alg = 'RS256',
    key = current.privateKey,
}: { kid?: string; alg?: string; key?: KeyObject } = {}) {
    const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }))
    const payload = b64url(JSON.stringify(claims))
    const signature = signBytes('sha256', Buffer.from(`${header}.${payload}`), key)
    return `${header}.${payload}.${b64url(signature)}`
}

export const now = () => Math.floor(Date.now() / 1000)

export const goodClaims = () => ({
    aud: [AUD], iss: TEAM, email: EMAIL, iat: now() - 10, exp: now() + 3600,
    type: 'app', identity_nonce: 'n', sub: 'sub', country: 'US',
})

/** Stand in for the team's certs endpoint: every fetch answers the certs
 *  document and is recorded. Returns the log and a restore function. */
export function stubCerts(): { fetches: string[]; restore: () => void } {
    const original = globalThis.fetch
    const fetches: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input)
        fetches.push(url)
        return new Response(JSON.stringify(certs), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    return { fetches, restore: () => { globalThis.fetch = original } }
}
