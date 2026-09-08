// @vitest-environment jsdom
/**
 * Submit's pure half (CPE-M3, app/admin/mapSubmit.ts): the drafts built
 * from a device's pins — one per stack or lone point (OQ-C), per snapshot —
 * their shape against the frozen contract, and the two transports' reading
 * of every answer the route can give.
 */
import { describe, expect, test } from 'vitest'
import { attachDetail, movePin, newPin, setNote } from '../../app/admin/mapDraft'
import type { ProposalPin } from '../../app/admin/mapDraft'
import {
    basemapStyle, buildDrafts, DRAFT_CONTRACT, draftName, listSubmitted, proposalsUrl, SNAPSHOT_UNKNOWN, submitDraft,
} from '../../app/admin/mapSubmit'
import type { DraftContext, MapDraft } from '../../app/admin/mapSubmit'
import type { ProbeFetch, ProbeResponse } from '../../app/admin/session'
import type { RosterRow } from '../../app/data/types'

function row(over: Partial<RosterRow> & { permit_id: string }): RosterRow {
    return {
        name: 'Place', address: '123 Main St', address2: null, city: 'Richmond', zip: '23220',
        tenant: 'virginia', is_restaurant: true, mobile: false, pt: 0, lat: 37.5, lon: -77.4, loc: 0,
        ffx_oid: null, ...over,
    }
}

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
    snapshotId: 'snap-now', tier: 'full', basemap: 'map', dark: false, zoom: 16.234, rows: [], ...over,
})

describe('the drafts', () => {
    test('one draft per stack or lone point, in drafting order, each pin in the contract shape', () => {
        const a = row({ permit_id: 'A', lat: 37.5, lon: -77.4, name: 'Alpha' })
        const b = row({ permit_id: 'B', lat: 37.5, lon: -77.4, name: 'Beta' })
        const c = row({ permit_id: 'C', lat: 37.6, lon: -77.3, name: 'Gamma', loc: 1 })
        const rows = [a, b, c, row({ permit_id: 'D', lat: 37.5, lon: -77.4 })]
        let pins: ProposalPin[] = [newPin(a, rows, 'snap-now'), newPin(c, rows, 'snap-now'), newPin(b, rows, 'snap-now')]
        pins = movePin(pins, 'A', { lat: 37.5001, lon: -77.4 })
        pins = movePin(pins, 'B', { lat: 37.5002, lon: -77.4 })
        pins = movePin(pins, 'C', { lat: 37.6, lon: -77.3003 })
        pins = setNote(pins, 'B', '  by the loading dock  ')
        pins = attachDetail(pins, 'A', { lat: 37.500000123, lon: -77.400000456, site_group_id: 'd38ef823cfd7', site_count: 3 })
        pins = attachDetail(pins, 'B', null)

        const drafts = buildDrafts(pins, ctx({ rows }))
        expect(drafts).toHaveLength(2)
        const [stack, lone] = drafts as [MapDraft, MapDraft]
        expect(stack.contract).toBe(DRAFT_CONTRACT)
        expect(stack.schema_version).toBe(1)
        expect(stack.snapshot_id).toBe('snap-now')
        expect(stack.tier).toBe('full')
        expect(stack.basemap).toEqual({ style: 'positron', zoom: 16.23 })
        expect(stack.batch).toEqual({
            stack_key: '37.500000,-77.400000', group_lat: 37.5, group_lon: -77.4,
            facility_count: 3, site_group_id: 'd38ef823cfd7',
        })
        expect(stack.pins.map((p) => p.permit_id)).toEqual(['A', 'B'])
        expect(stack.pins[0]).toEqual({
            permit_id: 'A', kind: 'refinement', name: 'Alpha', address: '123 Main St', covers: ['A'],
            published: { lat: 37.5, lon: -77.4, loc: 0, location: { lat: 37.500000123, lon: -77.400000456, site_group_id: 'd38ef823cfd7', site_count: 3 } },
            after: { lat: 37.5001, lon: -77.4 }, note: null,
        })
        expect(stack.pins[1]).toMatchObject({ permit_id: 'B', note: 'by the loading dock', published: { location: null } })
        // Nothing of the device's bookkeeping rides along.
        for (const pin of stack.pins) {
            expect(Object.keys(pin).sort()).toEqual(['address', 'after', 'covers', 'kind', 'name', 'note', 'permit_id', 'published'])
        }
        expect(lone.batch).toEqual({ stack_key: '37.600000,-77.300000', group_lat: 37.6, group_lon: -77.3, facility_count: 1, site_group_id: null })
        expect(lone.pins).toHaveLength(1)
        // The server-owned fields are absent by construction.
        for (const draft of drafts) {
            expect(Object.keys(draft).sort()).toEqual(['basemap', 'batch', 'contract', 'pins', 'schema_version', 'snapshot_id', 'tier'])
        }
    })

    test('a pin drafted against an older snapshot goes in a draft of its own that says so', () => {
        const a = row({ permit_id: 'A' })
        const b = row({ permit_id: 'B' })
        let pins = [newPin(a, [a, b], 'snap-old'), newPin(b, [a, b], 'snap-now')]
        pins = movePin(pins, 'A', { lat: 37.51, lon: -77.4 })
        pins = movePin(pins, 'B', { lat: 37.52, lon: -77.4 })
        const drafts = buildDrafts(pins, ctx({ rows: [a, b] }))
        expect(drafts.map((d) => [d.snapshot_id, d.pins.map((p) => p.permit_id)])).toEqual([['snap-old', ['A']], ['snap-now', ['B']]])
        // Without any snapshot at all the draft still carries a word for it.
        const bare = buildDrafts(movePin([newPin(a, [a], null)], 'A', { lat: 37.51, lon: -77.4 }), ctx({ snapshotId: null }))
        expect(bare[0]!.snapshot_id).toBe(SNAPSHOT_UNKNOWN)
    })

    test('a site fix carries every permit at the address, and the count never undercounts the pins', () => {
        const a = row({ permit_id: 'A', loc: 2, address: '9 Pier Rd' })
        const b = row({ permit_id: 'B', loc: 2, address: '9 PIER RD.' })
        const pins = movePin([newPin(a, [a, b], 'snap')], 'A', { lat: 37.51, lon: -77.4 })
        // The rows have moved on (filtered away): the count falls back to the pins.
        const [draft] = buildDrafts(pins, ctx({ rows: [] }))
        expect(draft!.batch.facility_count).toBe(1)
        expect(draft!.pins[0]).toMatchObject({ kind: 'site', covers: ['A', 'B'], published: { loc: 2 } })
    })

    test('the basemap under the drag: the theme\'s style, or the aerial', () => {
        expect(basemapStyle('map', false)).toBe('positron')
        expect(basemapStyle('map', true)).toBe('dark-matter')
        expect(basemapStyle('aerial', true)).toBe('aerial')
        const a = row({ permit_id: 'A' })
        const pins = movePin([newPin(a, [a], 'snap')], 'A', { lat: 37.51, lon: -77.4 })
        expect(buildDrafts(pins, ctx({ basemap: 'aerial', dark: true, zoom: Number.NaN }))[0]!.basemap).toEqual({ style: 'aerial', zoom: 0 })
        expect(buildDrafts(pins, ctx({ zoom: 30 }))[0]!.basemap.zoom).toBe(24)
    })

    test('the route sits under the mount; a key reads as its name', () => {
        expect(proposalsUrl('/')).toBe('/admin/api/proposals')
        expect(proposalsUrl('/cleanplate/')).toBe('/cleanplate/admin/api/proposals')
        expect(draftName('drafts/20260908T191503Z-ab12cd34.json')).toBe('20260908T191503Z-ab12cd34')
    })
})

// ── the transport ───────────────────────────────────────────────────────

function answer(partial: Partial<ProbeResponse> & { body?: unknown; contentType?: string }): ProbeResponse {
    const headers = new Map<string, string>()
    if (partial.contentType) headers.set('content-type', partial.contentType)
    return {
        type: partial.type ?? 'basic',
        status: partial.status ?? 200,
        ok: partial.ok ?? ((partial.status ?? 200) >= 200 && (partial.status ?? 200) < 300),
        headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
        json: partial.json ?? (async () => partial.body),
    }
}

const JSON_ = 'application/json; charset=utf-8'

function someDraft(): MapDraft {
    const a = row({ permit_id: 'A' })
    return buildDrafts(movePin([newPin(a, [a], 'snap')], 'A', { lat: 37.51, lon: -77.4 }), ctx())[0]!
}

describe('submitDraft', () => {
    test('POSTs the draft as JSON with redirect: manual, same-origin credentials, never cached — and reads a 201', async () => {
        const calls: { url: string; init: RequestInit }[] = []
        const fetchImpl: ProbeFetch = async (url, init) => {
            calls.push({ url, init })
            return answer({ status: 201, contentType: JSON_, body: { ok: true, key: 'drafts/20260908T191503Z-ab12cd34.json', sha256: 'ab'.repeat(32), pins: 1, saved_at: '2026-09-08T19:15:03Z', existing: false } })
        }
        const draft = someDraft()
        const outcome = await submitDraft(draft, fetchImpl, '/admin/api/proposals')
        expect(outcome).toEqual({ state: 'stored', key: 'drafts/20260908T191503Z-ab12cd34.json', sha256: 'ab'.repeat(32), pins: 1, saved_at: '2026-09-08T19:15:03Z', existing: false })
        expect(calls).toHaveLength(1)
        expect(calls[0]).toMatchObject({
            url: '/admin/api/proposals',
            init: { method: 'POST', redirect: 'manual', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' } },
        })
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual(draft)
    })

    test('a 200 with existing: true is stored too', async () => {
        const outcome = await submitDraft(someDraft(), async () => answer({ status: 200, contentType: JSON_, body: { ok: true, key: 'drafts/k.json', sha256: 'x', pins: 1, saved_at: 's', existing: true } }), '/x')
        expect(outcome).toMatchObject({ state: 'stored', existing: true })
    })

    test('the Worker\'s refusal names the field — 400 / 413 / 415 read as refused with the reason', async () => {
        expect(await submitDraft(someDraft(), async () => answer({ status: 400, contentType: JSON_, body: { ok: false, reason: '$.pins[0].after: identical to the published point' } }), '/x'))
            .toEqual({ state: 'refused', reason: '$.pins[0].after: identical to the published point' })
        expect(await submitDraft(someDraft(), async () => answer({ status: 413, contentType: JSON_, body: { ok: false } }), '/x'))
            .toEqual({ state: 'refused', reason: 'http 413' })
    })

    test("Access's redirect or the Worker's 401 read as signed out", async () => {
        expect(await submitDraft(someDraft(), async () => answer({ type: 'opaqueredirect', status: 0, ok: false }), '/x')).toEqual({ state: 'signed-out' })
        expect(await submitDraft(someDraft(), async () => answer({ status: 401, contentType: JSON_, body: { ok: false, reason: 'invalid session' } }), '/x')).toEqual({ state: 'signed-out' })
    })

    test('the SPA shell (a build without the Worker), a 5xx, a network error read as unavailable — never as stored', async () => {
        expect(await submitDraft(someDraft(), async () => answer({ status: 200, contentType: 'text/html' }), '/x'))
            .toEqual({ state: 'unavailable', reason: 'no proposals route in this build' })
        expect(await submitDraft(someDraft(), async () => answer({ status: 500, contentType: JSON_, body: { ok: false, reason: 'proposals store not configured' } }), '/x'))
            .toEqual({ state: 'unavailable', reason: 'proposals store not configured' })
        expect(await submitDraft(someDraft(), async () => answer({ status: 503, contentType: JSON_, body: { ok: false, reason: 'keys unavailable' } }), '/x'))
            .toEqual({ state: 'unavailable', reason: 'keys unavailable' })
        expect(await submitDraft(someDraft(), async () => { throw new TypeError('Failed to fetch') }, '/x'))
            .toEqual({ state: 'unavailable', reason: 'Failed to fetch' })
        expect(await submitDraft(someDraft(), async () => answer({ status: 200, contentType: JSON_, json: async () => { throw new SyntaxError('bad') } }), '/x'))
            .toEqual({ state: 'unavailable', reason: 'unreadable answer' })
        expect(await submitDraft(someDraft(), async () => answer({ status: 200, contentType: JSON_, body: { ok: true } }), '/x'))
            .toEqual({ state: 'unavailable', reason: 'unexpected answer' })
    })
})

describe('listSubmitted', () => {
    test('GETs the list and keeps the well-formed rows', async () => {
        const calls: { url: string; init: RequestInit }[] = []
        const drafts = [
            { key: 'drafts/b.json', name: 'b', saved_at: '2026-09-08T19:20:00Z', pins: 2, sha256: 'y', stack_key: 'k', snapshot_id: 's', submitted_by: 'e', size: 10, uploaded: 'u', pulled: false },
            { key: 'drafts/a.json', name: 'a', saved_at: null, pins: null, sha256: null, stack_key: null, snapshot_id: null, submitted_by: null, size: null, uploaded: null, pulled: true },
            { junk: true },
        ]
        const outcome = await listSubmitted(async (url, init) => {
            calls.push({ url, init })
            return answer({ contentType: JSON_, body: { ok: true, drafts, truncated: false } })
        }, '/admin/api/proposals')
        expect(outcome).toEqual({ state: 'listed', drafts: drafts.slice(0, 2), truncated: false })
        expect(calls[0]).toMatchObject({ url: '/admin/api/proposals', init: { method: 'GET', redirect: 'manual', credentials: 'same-origin', cache: 'no-store' } })
    })

    test('signed out and unavailable, as the submit reads them', async () => {
        expect(await listSubmitted(async () => answer({ type: 'opaqueredirect', status: 0, ok: false }), '/x')).toEqual({ state: 'signed-out' })
        expect(await listSubmitted(async () => answer({ status: 200, contentType: 'text/html' }), '/x')).toEqual({ state: 'unavailable', reason: 'no proposals route in this build' })
        expect(await listSubmitted(async () => answer({ status: 500, contentType: JSON_, body: { ok: false, reason: 'proposals store not configured' } }), '/x')).toEqual({ state: 'unavailable', reason: 'proposals store not configured' })
        expect(await listSubmitted(async () => answer({ contentType: JSON_, body: { ok: true } }), '/x')).toEqual({ state: 'unavailable', reason: 'unexpected answer' })
    })
})
