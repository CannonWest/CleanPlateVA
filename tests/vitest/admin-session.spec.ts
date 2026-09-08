// @vitest-environment jsdom
/**
 * The admin session as the client sees it (CPE-M1, app/admin/session.ts):
 * the device flag's round trip and expiry, and the probe's reading of every
 * answer the route can give — Access's opaque redirect, the Worker's JSON,
 * the shell a Worker-less build serves, a transient.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { ADMIN_SESSION_KEY } from '../../app/constants'
import {
    clearSession, persistSession, probeSession, sessionUrl, storedSession,
} from '../../app/admin/session'
import type { ProbeFetch, ProbeResponse } from '../../app/admin/session'

const NOW = 1_800_000_000

describe('the device flag', () => {
    beforeEach(() => window.localStorage.clear())

    test('round-trips, and is gone once the token has expired', () => {
        persistSession(window.localStorage, { email: 'x@example.test', exp: NOW + 60 })
        expect(storedSession(window.localStorage, NOW)).toEqual({ email: 'x@example.test', exp: NOW + 60 })
        expect(storedSession(window.localStorage, NOW + 61)).toBeNull()
        clearSession(window.localStorage)
        expect(storedSession(window.localStorage, NOW)).toBeNull()
        expect(window.localStorage.getItem(ADMIN_SESSION_KEY)).toBeNull()
    })

    test('garbage, a wrong shape, or an unreadable store read as no session — never a throw', () => {
        window.localStorage.setItem(ADMIN_SESSION_KEY, 'not json')
        expect(storedSession(window.localStorage, NOW)).toBeNull()
        window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ email: '', exp: NOW + 60 }))
        expect(storedSession(window.localStorage, NOW)).toBeNull()
        window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ email: 'x', exp: 'soon' }))
        expect(storedSession(window.localStorage, NOW)).toBeNull()
        expect(storedSession(null, NOW)).toBeNull()
        const thrower = { getItem: () => { throw new Error('private mode') }, setItem: () => { throw new Error('private mode') }, removeItem: () => { throw new Error('private mode') } }
        expect(storedSession(thrower, NOW)).toBeNull()
        expect(() => persistSession(thrower, { email: 'x', exp: NOW })).not.toThrow()
        expect(() => clearSession(thrower)).not.toThrow()
    })

    test('the route sits under the mount', () => {
        expect(sessionUrl('/')).toBe('/admin/api/session')
        expect(sessionUrl('/cleanplate/')).toBe('/cleanplate/admin/api/session')
    })
})

function answer(partial: Partial<ProbeResponse> & { body?: unknown; contentType?: string }): ProbeFetch {
    const headers = new Map<string, string>()
    if (partial.contentType) headers.set('content-type', partial.contentType)
    const response: ProbeResponse = {
        type: partial.type ?? 'basic',
        status: partial.status ?? 200,
        ok: partial.ok ?? ((partial.status ?? 200) >= 200 && (partial.status ?? 200) < 300),
        headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
        json: partial.json ?? (async () => partial.body),
    }
    return async () => response
}

describe('the probe', () => {
    test('asks once, with redirect: manual and same-origin credentials, never cached', async () => {
        const calls: { url: string; init: RequestInit }[] = []
        const fetchImpl: ProbeFetch = async (url, init) => {
            calls.push({ url, init })
            return answer({ contentType: 'application/json; charset=utf-8', body: { ok: true, email: 'x@example.test', exp: NOW } })('', {})
        }
        const result = await probeSession(fetchImpl, '/admin/api/session')
        expect(result).toEqual({ state: 'signed-in', session: { email: 'x@example.test', exp: NOW } })
        expect(calls).toHaveLength(1)
        expect(calls[0]).toMatchObject({
            url: '/admin/api/session',
            init: { method: 'GET', redirect: 'manual', credentials: 'same-origin', cache: 'no-store' },
        })
    })

    test("Access's login redirect reads as signed out — an opaque redirect, status 0", async () => {
        expect(await probeSession(answer({ type: 'opaqueredirect', status: 0, ok: false }), '/x'))
            .toEqual({ state: 'signed-out' })
    })

    test('the Worker refusing the token reads as signed out', async () => {
        expect(await probeSession(answer({ status: 401, contentType: 'application/json', body: { ok: false, reason: 'no session' } }), '/x'))
            .toEqual({ state: 'signed-out' })
    })

    test('the SPA shell (a build without the Worker) reads as unavailable, never as a session', async () => {
        const result = await probeSession(answer({ status: 200, contentType: 'text/html' }), '/x')
        expect(result.state).toBe('unavailable')
    })

    test('a transient — the keys unreachable, a network error — reads as unavailable, never as signed out', async () => {
        expect((await probeSession(answer({ status: 503, contentType: 'application/json', body: { ok: false, reason: 'keys unavailable' } }), '/x')).state)
            .toBe('unavailable')
        const failing: ProbeFetch = async () => { throw new TypeError('Failed to fetch') }
        expect(await probeSession(failing, '/x')).toEqual({ state: 'unavailable', reason: 'Failed to fetch' })
    })

    test('a 200 that is not the identity shape is unavailable', async () => {
        expect((await probeSession(answer({ contentType: 'application/json', body: { ok: true } }), '/x')).state).toBe('unavailable')
        expect((await probeSession(answer({ contentType: 'application/json', json: async () => { throw new SyntaxError('bad') } }), '/x')).state).toBe('unavailable')
    })
})
