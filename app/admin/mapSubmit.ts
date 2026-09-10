/**
 * Submit (CPE-M3, design ref frontend-redesign.md §6.6) — the pure half of
 * sending a map draft to the Worker, beside mapDraft.ts (the draft itself)
 * and session.ts (the probe whose transport rules this reuses).
 *
 *   · THE CONTRACT, `cleanplateva.map-draft.v1`: what the browser knows and
 *     the composer cannot recompute — where the operator saw each place,
 *     where it was dragged, the note, the kind as judged, the stack as
 *     judged, the roster snapshot and the basemap under the drag — and
 *     nothing the archive owns. The Worker adds `operator` · `instrument` ·
 *     `saved_at` · `submitted_by` and REFUSES a draft that carries them (the
 *     the embedding host composer's rule); `cf_location.py manual pull` (M4) composes
 *     the contract files on the maintainer's machine with `before` from Couch.
 *   · ONE DRAFT PER STACK OR LONE POINT (OQ-C): `buildDrafts` groups the
 *     device's pins by the published point they came from — and by the
 *     snapshot they were drafted against, so a pin from before a publish
 *     goes in a draft that says so rather than borrowing the current one.
 *   · THE POST AND THE GET, read the way the session probe reads its answer:
 *     an opaque redirect or a 401 is Access saying the session is gone; the
 *     SPA shell (a build without the Worker — dev, `vite preview`, the
 *     the host embed) is "unavailable", never a store; a 5xx is a transient.
 *     `redirect: 'manual'` is load-bearing here as it is there.
 */

import type { Basemap } from '../basemap'
import type { RosterRow } from '../data/types'
import { mountFromBaseURI } from '../router'
import { pointKey } from './mapDraft'
import type { PinKind, ProposalPin } from './mapDraft'
import type { ProbeFetch, ProbeResponse } from './session'

export const DRAFT_CONTRACT = 'cleanplateva.map-draft.v1'
export const DRAFT_SCHEMA_VERSION = 1

/** The route, relative to the mount (`/admin/api/proposals` on the site). */
export const PROPOSALS_PATH = 'admin/api/proposals'

/** What the operator was looking at: the theme's CARTO style, or the aerial
 *  photograph under it (the basemap flag wins — the labels' style is then
 *  detail the composer never needs). */
export type BasemapStyle = 'positron' | 'dark-matter' | 'aerial'
export type DraftTier = 'full' | 'lite'

export interface DraftPin {
    permit_id: string
    kind: PinKind
    name: string
    address: string | null
    /** Every permit the pin moves — the one permit for a refinement, the
     *  permits at the address for a site fix — as the BROWSER counted them;
     *  the composer counts again from Couch and a disagreement is a reason
     *  to stop. */
    covers: string[]
    published: { lat: number; lon: number; loc: number; location: Record<string, unknown> | null }
    after: { lat: number; lon: number }
    note: string | null
}

export interface MapDraft {
    contract: typeof DRAFT_CONTRACT
    schema_version: typeof DRAFT_SCHEMA_VERSION
    snapshot_id: string
    tier: DraftTier
    basemap: { style: BasemapStyle; zoom: number }
    /** The stack as judged — provenance; the composer recomputes the
     *  contract batch from Couch's SITE point. */
    batch: {
        stack_key: string
        group_lat: number
        group_lon: number
        facility_count: number
        site_group_id: string | null
    }
    pins: DraftPin[]
}

export interface DraftContext {
    /** The roster snapshot the map shows now; a pin drafted against an
     *  older one carries its own. */
    snapshotId: string | null
    tier: DraftTier
    basemap: Basemap
    dark: boolean
    /** The map's zoom at Submit. */
    zoom: number
    /** The roster as shown — what the batch's count measures. */
    rows: readonly RosterRow[]
}

/** A snapshot id the draft can always carry: the pin's own, else the map's,
 *  else this — the composer treats anything that is not a timestamp as
 *  "no snapshot to check against". */
export const SNAPSHOT_UNKNOWN = 'unknown'

const GROUP_ID_RE = /^[0-9a-f]{12}$/

export function basemapStyle(basemap: Basemap, dark: boolean): BasemapStyle {
    if (basemap === 'aerial') return 'aerial'
    return dark ? 'dark-matter' : 'positron'
}

/** The drafts for a device's pins: one per (published point × snapshot),
 *  in the order the pins were drafted. */
export function buildDrafts(pins: readonly ProposalPin[], ctx: DraftContext): MapDraft[] {
    const groups = new Map<string, ProposalPin[]>()
    for (const pin of pins) {
        const snapshot = pin.snapshot_id ?? ctx.snapshotId ?? SNAPSHOT_UNKNOWN
        const key = `${pin.stack_key}|${snapshot}`
        groups.set(key, [...(groups.get(key) ?? []), pin])
    }
    const zoom = Math.min(24, Math.max(0, Math.round((Number.isFinite(ctx.zoom) ? ctx.zoom : 0) * 100) / 100))
    const drafts: MapDraft[] = []
    for (const members of groups.values()) {
        const first = members[0]!
        const stackKey = first.stack_key
        const [lat, lon] = stackKey.split(',').map(Number) as [number, number]
        const shown = ctx.rows.filter((r) => pointKey(r.lat, r.lon) === stackKey).length
        drafts.push({
            contract: DRAFT_CONTRACT,
            schema_version: DRAFT_SCHEMA_VERSION,
            snapshot_id: first.snapshot_id ?? ctx.snapshotId ?? SNAPSHOT_UNKNOWN,
            tier: ctx.tier,
            basemap: { style: basemapStyle(ctx.basemap, ctx.dark), zoom },
            batch: {
                stack_key: stackKey,
                group_lat: lat,
                group_lon: lon,
                facility_count: Math.max(shown, members.length),
                site_group_id: siteGroupId(members),
            },
            pins: members.map(draftPin),
        })
    }
    return drafts
}

function siteGroupId(pins: readonly ProposalPin[]): string | null {
    for (const pin of pins) {
        const id = pin.published.location?.site_group_id
        if (typeof id === 'string' && GROUP_ID_RE.test(id)) return id
    }
    return null
}

function draftPin(pin: ProposalPin): DraftPin {
    const note = pin.note?.trim() ? pin.note.trim() : null
    return {
        permit_id: pin.permit_id,
        kind: pin.kind,
        name: pin.name,
        address: pin.address,
        covers: [...pin.covers],
        published: {
            lat: pin.published.lat,
            lon: pin.published.lon,
            loc: pin.published.loc,
            location: pin.published.location ? { ...pin.published.location } as Record<string, unknown> : null,
        },
        after: { lat: pin.after.lat, lon: pin.after.lon },
        note,
    }
}

// ── the transport ───────────────────────────────────────────────────────

export type SubmitOutcome =
    | { state: 'stored'; key: string; sha256: string; pins: number; saved_at: string; existing: boolean }
    | { state: 'refused'; reason: string }
    | { state: 'signed-out' }
    | { state: 'unavailable'; reason: string }

export interface SubmittedDraft {
    key: string
    name: string
    saved_at: string | null
    pins: number | null
    sha256: string | null
    stack_key: string | null
    snapshot_id: string | null
    submitted_by: string | null
    size: number | null
    uploaded: string | null
    /** `pull` (M4) leaves a `pulled/<name>` marker beside a draft it composed. */
    pulled: boolean
}

export type ListOutcome =
    | { state: 'listed'; drafts: SubmittedDraft[]; truncated: boolean }
    | { state: 'signed-out' }
    | { state: 'unavailable'; reason: string }

/** The proposals route under the page's mount. */
export function proposalsUrl(mount: string = mountFromBaseURI(document.baseURI)): string {
    return `${mount}${PROPOSALS_PATH}`
}

type Answer =
    | { state: 'json'; status: number; body: Record<string, unknown> }
    | { state: 'signed-out' }
    | { state: 'unavailable'; reason: string }

/** One reading for both routes — the session probe's rules, plus a JSON
 *  body when the Worker answered. */
async function readAnswer(response: ProbeResponse): Promise<Answer> {
    if (response.type === 'opaqueredirect') return { state: 'signed-out' }
    if (response.status === 401 || response.status === 403) return { state: 'signed-out' }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
        return { state: 'unavailable', reason: response.ok ? 'no proposals route in this build' : `http ${response.status}` }
    }
    let body: unknown
    try {
        body = await response.json()
    } catch {
        return { state: 'unavailable', reason: 'unreadable answer' }
    }
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    if (response.status >= 500) {
        return { state: 'unavailable', reason: typeof record.reason === 'string' ? record.reason : `http ${response.status}` }
    }
    return { state: 'json', status: response.status, body: record }
}

/** POST one draft. */
export async function submitDraft(
    draft: MapDraft,
    fetchImpl: ProbeFetch = (url, init) => fetch(url, init),
    url: string = proposalsUrl(),
): Promise<SubmitOutcome> {
    let response: ProbeResponse
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            redirect: 'manual',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
        })
    } catch (error) {
        return { state: 'unavailable', reason: error instanceof Error ? error.message : 'network' }
    }
    const answer = await readAnswer(response)
    if (answer.state !== 'json') return answer
    const { body, status } = answer
    if (body.ok === true && typeof body.key === 'string' && typeof body.sha256 === 'string') {
        return {
            state: 'stored',
            key: body.key,
            sha256: body.sha256,
            pins: typeof body.pins === 'number' ? body.pins : draft.pins.length,
            saved_at: typeof body.saved_at === 'string' ? body.saved_at : '',
            existing: body.existing === true,
        }
    }
    if (status >= 400) {
        return { state: 'refused', reason: typeof body.reason === 'string' ? body.reason : `http ${status}` }
    }
    return { state: 'unavailable', reason: 'unexpected answer' }
}

/** GET the bucket's drafts for the Submitted panel. */
export async function listSubmitted(
    fetchImpl: ProbeFetch = (url, init) => fetch(url, init),
    url: string = proposalsUrl(),
): Promise<ListOutcome> {
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
    const answer = await readAnswer(response)
    if (answer.state !== 'json') return answer
    const { body } = answer
    if (body.ok === true && Array.isArray(body.drafts)) {
        return {
            state: 'listed',
            drafts: body.drafts.filter(isSubmittedDraft),
            truncated: body.truncated === true,
        }
    }
    return { state: 'unavailable', reason: typeof body.reason === 'string' ? body.reason : 'unexpected answer' }
}

function isSubmittedDraft(value: unknown): value is SubmittedDraft {
    if (!value || typeof value !== 'object') return false
    const d = value as Record<string, unknown>
    return typeof d.key === 'string' && typeof d.name === 'string' && typeof d.pulled === 'boolean'
}

/** A draft's name in the drawer: the compact time and the sha8 the key
 *  already carries — `drafts/20260908T191500Z-ab12cd34.json` reads as
 *  `20260908T191500Z-ab12cd34`. */
export function draftName(key: string): string {
    return key.replace(/^drafts\//, '').replace(/\.json$/, '')
}
