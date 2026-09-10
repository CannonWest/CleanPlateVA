/**
 * The map edit mode's draft — the pure half (CPE-M2, design ref
 * frontend-redesign.md §6.6). A proposal PIN is one dragged place: the
 * point the map published for it (what the operator saw), the point it was
 * dragged to, and enough of the roster row to name it and to know what
 * kind of fix it is:
 *
 *   · a place at a real location (`loc` 0 rooftop · 1 street · 3 venue) is
 *     a REFINEMENT — "this permit's storefront is here";
 *   · a place on a ZIP centroid (`loc` 2) is a SITE fix — "this ADDRESS is
 *     here", which moves every permit filed at that address (OQ ratified
 *     2026-09-07; the drag matrix the embedding host editor enforces).
 *
 * Pins live in this device's localStorage (MAP_DRAFT_KEY) and survive a
 * reload (OQ-B); nothing here publishes. The draft leaves the browser only
 * through Submit (M3), and the composer on the maintainer's machine (M4) resolves
 * the contract's `before` from the archive — the pin carries the PUBLISHED
 * point (the finder row, 6 dp) and, when the detail arrived, its 9-dp
 * `location` block, as provenance rather than as the authority.
 *
 * Also here: the GeoJSON the map draws from — one pin and one dashed tether
 * back to the published point per proposal, and a badge on a site fix —
 * because the drawing must follow the draft exactly and a spec can hold
 * both to it.
 */

import { MAP_DRAFT_KEY } from '../constants'
import { LOCATION_CLASS } from '../data/presentation'
import type { DetailFacility, RosterRow } from '../data/types'

export type PinKind = 'refinement' | 'site'

export interface LngLatPair {
    lat: number
    lon: number
}

export interface PublishedPoint extends LngLatPair {
    /** The finder row's location class (append-only code, §5). */
    loc: number
    /** The Full-tier detail's `location` block (9-dp site + effective
     *  points, sources, `site_group_id`) once it arrived; null until then
     *  or when this build has no detail to give. */
    location: DetailFacility['location'] | null
}

export interface ProposalPin {
    permit_id: string
    name: string
    kind: PinKind
    /** The 6-dp published point's key (mapData.ts stackKey) — the stack or
     *  lone point the pin came from; provenance for the composer. */
    stack_key: string
    published: PublishedPoint
    after: LngLatPair
    note: string | null
    /** The row's address line — the badge names it on a site fix. */
    address: string | null
    /** Every permit the pin moves: the permits at the address for a site
     *  fix, the one permit for a refinement. */
    covers: string[]
    /** The roster snapshot the pin was dragged against. */
    snapshot_id: string | null
    /** Whether the detail's `location` block was attached, is still on its
     *  way, or could not be fetched in this build. */
    detail: 'pending' | 'attached' | 'unavailable'
    created_at: number
}

export const STORAGE_KEY = MAP_DRAFT_KEY

/** The drawing: one source, three layers — tethers under pins under badges. */
export const SRC_PROPOSALS = 'cp-proposals'
export const LYR_PROPOSAL_TETHERS = 'cp-proposal-tethers'
export const LYR_PROPOSAL_PINS = 'cp-proposal-pins'
export const LYR_PROPOSAL_BADGES = 'cp-proposal-badges'

/** The one orange, both themes — "unsaved judgment", neither a grade nor an
 *  action color (§6.6; the embedding host editor's dirty color). */
export const PROPOSAL_COLOR = '#ff922b'
export const PIN_RADIUS = 8

/** Storage precision for a dragged point — sub-centimetre, never a float's
 *  whole tail. */
const AFTER_DECIMALS = 7

export function pinKind(row: Pick<RosterRow, 'loc'>): PinKind {
    return row.loc === LOCATION_CLASS.zip_centroid ? 'site' : 'refinement'
}

/** The address a site fix moves: the row's address line and ZIP, folded
 *  the way two rows of one building would agree. Null without an address. */
export function addressKey(row: Pick<RosterRow, 'address' | 'zip'>): string | null {
    const address = String(row.address ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!address) return null
    return `${address}|${String(row.zip ?? '').trim()}`
}

/** The permits a pin moves. A refinement moves its own permit; a site fix
 *  moves every permit at the address (the row itself included) — the
 *  contract's `permit_ids`. Without an address key a site fix covers the row
 *  alone. */
export function coveredPermits(row: RosterRow, rows: readonly RosterRow[]): string[] {
    if (pinKind(row) !== 'site') return [String(row.permit_id)]
    const key = addressKey(row)
    if (!key) return [String(row.permit_id)]
    const ids = rows
        .filter((r) => addressKey(r) === key)
        .map((r) => String(r.permit_id))
    return ids.includes(String(row.permit_id)) ? ids : [String(row.permit_id), ...ids]
}

/** The 6-dp key of a published point (mapData.ts stackKey's shape). */
export function pointKey(lat: number, lon: number): string {
    return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

export function roundAfter(point: LngLatPair): LngLatPair {
    const f = 10 ** AFTER_DECIMALS
    return { lat: Math.round(point.lat * f) / f, lon: Math.round(point.lon * f) / f }
}

/** A fresh pin for a row, standing on its published point. */
export function newPin(
    row: RosterRow, rows: readonly RosterRow[], snapshotId: string | null, now: number = Date.now(),
): ProposalPin {
    return {
        permit_id: String(row.permit_id),
        name: row.name,
        kind: pinKind(row),
        stack_key: pointKey(row.lat, row.lon),
        published: { lat: row.lat, lon: row.lon, loc: row.loc, location: null },
        after: { lat: row.lat, lon: row.lon },
        note: null,
        address: row.address ?? null,
        covers: coveredPermits(row, rows),
        snapshot_id: snapshotId,
        detail: 'pending',
        created_at: now,
    }
}

/** The map badge: a site fix says what it moves; a refinement wears none —
 *  the drawer names it. */
export function badgeText(pin: Pick<ProposalPin, 'kind' | 'covers' | 'address'>): string | null {
    if (pin.kind !== 'site') return null
    const n = pin.covers.length
    const where = pin.address ? pin.address : 'this address'
    return `Moves ${n} permit${n === 1 ? '' : 's'} at ${where}`
}

const EARTH_M = 6_371_008.8

/** Great-circle metres between two points. */
export function haversineM(a: LngLatPair, b: LngLatPair): number {
    const rad = Math.PI / 180
    const dLat = (b.lat - a.lat) * rad
    const dLon = (b.lon - a.lon) * rad
    const s = Math.sin(dLat / 2) ** 2
        + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
    return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function distanceM(pin: Pick<ProposalPin, 'published' | 'after'>): number {
    return haversineM(pin.published, pin.after)
}

/** "Dropped back on its dot": within the hit slop of the dot's edge — the
 *  same reach a click has (mapHit.ts) — plus the pin's own radius, in
 *  screen px. */
export function withinDiscard(pixelDistance: number, slop: number, dotRadius: number): boolean {
    return pixelDistance <= slop + dotRadius + PIN_RADIUS
}

// ── the draft list ──────────────────────────────────────────────────────

export function upsertPin(pins: readonly ProposalPin[], pin: ProposalPin): ProposalPin[] {
    return [...pins.filter((p) => p.permit_id !== pin.permit_id), pin]
}

export function removePin(pins: readonly ProposalPin[], permitId: string): ProposalPin[] {
    return pins.filter((p) => p.permit_id !== permitId)
}

export function movePin(pins: readonly ProposalPin[], permitId: string, after: LngLatPair): ProposalPin[] {
    const rounded = roundAfter(after)
    return pins.map((p) => (p.permit_id === permitId ? { ...p, after: rounded } : p))
}

export function setNote(pins: readonly ProposalPin[], permitId: string, note: string): ProposalPin[] {
    const value = note.trim() ? note : null
    return pins.map((p) => (p.permit_id === permitId ? { ...p, note: value } : p))
}

export function attachDetail(
    pins: readonly ProposalPin[], permitId: string, location: DetailFacility['location'] | null,
): ProposalPin[] {
    return pins.map((p) => (p.permit_id === permitId
        ? {
            ...p,
            published: { ...p.published, location: location ?? null },
            detail: location ? 'attached' : 'unavailable',
        }
        : p))
}

export function pinFor(pins: readonly ProposalPin[], permitId: string): ProposalPin | null {
    return pins.find((p) => p.permit_id === permitId) ?? null
}

// ── persistence ─────────────────────────────────────────────────────────

interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** The stored draft, or [] for anything unreadable — a private window, a
 *  cleared store, a shape from an older build. A pin still marked `pending`
 *  when it was stored comes back `unavailable`: the fetch it was waiting on
 *  died with its page. */
export function loadPins(storage: Partial<StorageLike> | null | undefined): ProposalPin[] {
    try {
        const raw = storage?.getItem?.(STORAGE_KEY)
        if (!raw) return []
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return []
        const pins = (parsed as { pins?: unknown }).pins
        if (!Array.isArray(pins)) return []
        return pins.filter(isPin).map((p) => (p.detail === 'pending' ? { ...p, detail: 'unavailable' } : p))
    } catch {
        return []
    }
}

export function savePins(storage: Partial<StorageLike> | null | undefined, pins: readonly ProposalPin[]): void {
    try {
        if (pins.length) storage?.setItem?.(STORAGE_KEY, JSON.stringify({ pins }))
        else storage?.removeItem?.(STORAGE_KEY)
    } catch {
        // A device that cannot persist still edits for this visit.
    }
}

function isPair(value: unknown): value is LngLatPair {
    if (!value || typeof value !== 'object') return false
    const p = value as Record<string, unknown>
    return typeof p.lat === 'number' && Number.isFinite(p.lat)
        && typeof p.lon === 'number' && Number.isFinite(p.lon)
}

function isPin(value: unknown): value is ProposalPin {
    if (!value || typeof value !== 'object') return false
    const p = value as Record<string, unknown>
    return typeof p.permit_id === 'string' && p.permit_id.length > 0
        && typeof p.name === 'string'
        && (p.kind === 'refinement' || p.kind === 'site')
        && typeof p.stack_key === 'string'
        && isPair(p.published) && typeof (p.published as unknown as { loc?: unknown }).loc === 'number'
        && isPair(p.after)
        && (p.note === null || typeof p.note === 'string')
        && (p.address === null || typeof p.address === 'string')
        && Array.isArray(p.covers) && p.covers.every((c) => typeof c === 'string')
        && (p.snapshot_id === null || typeof p.snapshot_id === 'string')
        && (p.detail === 'pending' || p.detail === 'attached' || p.detail === 'unavailable')
        && typeof p.created_at === 'number'
}

// ── the drawing ─────────────────────────────────────────────────────────

export interface ProposalFeature {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][] }
    properties: { role: 'pin' | 'tether'; pid: string; kind: PinKind; badge: string }
}

export interface ProposalCollection {
    type: 'FeatureCollection'
    features: ProposalFeature[]
}

/** One tether and one pin per proposal — the tether first, so it draws
 *  under the pin on the same source. The badge rides the pin feature and is
 *  empty for a refinement, which the badge layer's filter drops. */
export function buildProposalGeoJSON(pins: readonly ProposalPin[]): ProposalCollection {
    const features: ProposalFeature[] = []
    for (const pin of pins) {
        const badge = badgeText(pin) ?? ''
        features.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[pin.published.lon, pin.published.lat], [pin.after.lon, pin.after.lat]],
            },
            properties: { role: 'tether', pid: pin.permit_id, kind: pin.kind, badge },
        })
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [pin.after.lon, pin.after.lat] },
            properties: { role: 'pin', pid: pin.permit_id, kind: pin.kind, badge },
        })
    }
    return { type: 'FeatureCollection', features }
}
