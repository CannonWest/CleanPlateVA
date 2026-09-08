/**
 * The admin session as the CLIENT sees it (CPE-M1, design ref
 * frontend-redesign.md §6.6) — two things, both small:
 *
 *   · the device flag — `{ email, exp }` under ADMIN_SESSION_KEY, written by
 *     the session page (/admin) after the Worker verified the Access token.
 *     The public views read it to decide whether to render their Edit
 *     controls at all. A visitor's device never carries it, so a visitor's
 *     page renders no control and sends no request — the flag is what makes
 *     "never probe on a visitor's behalf" true;
 *   · the probe — one `GET /admin/api/session` with `redirect: 'manual'`,
 *     which is how an Edit click confirms the session before entering edit
 *     mode. Through Cloudflare Access a signed-out browser gets a 302 to the
 *     login page, and `fetch` reports that as an OPAQUE REDIRECT (status 0)
 *     rather than following it cross-origin and throwing — measured
 *     2026-09-07 on both hosts, signed in and not. The Worker's own answers
 *     are JSON: 200 with the identity, 401 when the token fails, 503 when the
 *     team's keys were unreachable (a transient, NOT "signed out").
 *
 * In a build without the Worker (the Vite dev server, `vite preview`, the
 * CannonAI embed) the path is the SPA shell — text/html, 200 — which reads
 * as "unavailable", never as a session.
 */

import { ADMIN_SESSION_KEY } from '../constants'
import { mountFromBaseURI } from '../router'

/** The route, relative to the mount (`/admin/api/session` on the site). */
export const SESSION_PATH = 'admin/api/session'

export interface AdminSession {
    email: string
    /** The token's expiry, unix seconds. */
    exp: number
}

export type ProbeResult =
    | { state: 'signed-in'; session: AdminSession }
    | { state: 'signed-out' }
    | { state: 'unavailable'; reason: string }

interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** The device flag, or null when absent, expired, unreadable or malformed. */
export function storedSession(
    storage: Partial<StorageLike> | null | undefined,
    nowSeconds: number = Math.floor(Date.now() / 1000),
): AdminSession | null {
    try {
        const raw = storage?.getItem?.(ADMIN_SESSION_KEY)
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        if (!isSession(parsed)) return null
        return parsed.exp > nowSeconds ? parsed : null
    } catch {
        return null
    }
}

export function persistSession(storage: Partial<StorageLike> | null | undefined, session: AdminSession): void {
    try {
        storage?.setItem?.(ADMIN_SESSION_KEY, JSON.stringify({ email: session.email, exp: session.exp }))
    } catch {
        /* private mode: the flag lives for this page load only */
    }
}

export function clearSession(storage: Partial<StorageLike> | null | undefined): void {
    try {
        storage?.removeItem?.(ADMIN_SESSION_KEY)
    } catch {
        /* private mode */
    }
}

function isSession(value: unknown): value is AdminSession {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    return typeof record.email === 'string' && record.email.length > 0
        && typeof record.exp === 'number' && Number.isFinite(record.exp)
}

/** The session route under the page's mount. */
export function sessionUrl(mount: string = mountFromBaseURI(document.baseURI)): string {
    return `${mount}${SESSION_PATH}`
}

/** The slice of a Response the probe reads — so a spec can hand it a plain
 *  object shaped like an opaque redirect, which `new Response()` cannot make. */
export interface ProbeResponse {
    type: string
    status: number
    ok: boolean
    headers: { get(name: string): string | null }
    json(): Promise<unknown>
}

export type ProbeFetch = (url: string, init: RequestInit) => Promise<ProbeResponse>

/** One GET, `redirect: 'manual'`, same-origin credentials, never cached. */
export async function probeSession(
    fetchImpl: ProbeFetch = (url, init) => fetch(url, init),
    url: string = sessionUrl(),
): Promise<ProbeResult> {
    let response: ProbeResponse
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            redirect: 'manual',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        })
    } catch (error) {
        return { state: 'unavailable', reason: error instanceof Error ? error.message : 'network' }
    }
    // Access's login redirect, seen from a page: the browser withholds it.
    if (response.type === 'opaqueredirect') return { state: 'signed-out' }
    if (response.status === 401 || response.status === 403) return { state: 'signed-out' }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
        // The SPA shell (no Worker in this build), or something else entirely.
        return { state: 'unavailable', reason: response.ok ? 'no session route in this build' : `http ${response.status}` }
    }
    if (!response.ok) return { state: 'unavailable', reason: `http ${response.status}` }
    let body: unknown
    try {
        body = await response.json()
    } catch {
        return { state: 'unavailable', reason: 'unreadable answer' }
    }
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    if (record.ok === true && isSession(record)) {
        return { state: 'signed-in', session: { email: record.email, exp: record.exp } }
    }
    return { state: 'unavailable', reason: 'unexpected answer' }
}
