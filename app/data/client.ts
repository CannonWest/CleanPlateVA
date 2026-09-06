/** CleanPlateVA prepared-data client for manifest-led Contract V4 —
 * `createFoodApi` ported whole from the old client's `dataClient.js` (design ref
 * §5, C1), same observable behavior, pinned by the ported contract suite.
 *
 * Both tiers boot on the same finder family; the full tier reads finder
 * shards from the static public channel first, by content-addressed name,
 * R2 fallback on a miss (CPH-M3, D-TRANSPORT-4). Full adds the
 * position-aligned overlay at boot — sha-bound per bucket (D-DATA-5),
 * carrying the hover card's whole content including `visits` — and reads the
 * lazy closed family on "Show closed". Detail is fetched per permit on CLICK
 * only (LRU; nothing on hover) and standards once. An HTML-200 answer on any
 * data path is a miss, never JSON. A manifest or shard this client does not
 * understand degrades to the public finder — no dual-contract path (P4).
 * The ack gate is a call-time predicate (C2): `isAcknowledged` is read on
 * every load, so a decision made after boot governs the next one.
 */

import type {
    ClosedShard, ClosedWireRow, DecodedChecklistRow, FacilityDetail, FinderShard,
    FullManifest, Inspection, LiteManifest, OverlayRow, OverlayShard, RosterResult,
    RosterRow, ShardDescriptor,
} from './types'

const DEFAULT_FULL_BASE = 'data-full'
const DEFAULT_LITE_BASE = 'data'

export const FULL_MANIFEST_CONTRACT = 'cleanplateva.full-manifest.v4'
export const PUBLIC_MANIFEST_CONTRACT = 'cleanplateva.finder-manifest.v4'
export const FINDER_SHARD_CONTRACT = 'cleanplateva.finder-shard.v4'
export const OVERLAY_SHARD_CONTRACT = 'cleanplateva.overlay-shard.v4'
export const CLOSED_SHARD_CONTRACT = 'cleanplateva.closed-shard.v4'
// The per-facility detail, validated on the click path: a detail whose
// contract this client does not understand is reported unavailable (and not
// cached), never rendered by guesswork.
export const DETAIL_CONTRACT = 'cleanplateva.facility-detail.v4'
export const SCHEMA_VERSION = 4
export const DETAIL_CACHE_SIZE = 200 // LRU of decoded details (click path)

/** What the client needs of fetch — the real one and the test fakes both. */
export interface ResponseLike {
    ok: boolean
    status: number
    headers?: { get?(name: string): string | null }
    json(): Promise<unknown>
}
export type FetchLike = (path: string) => Promise<ResponseLike>

interface DataError extends Error {
    status?: number
    spaFallback?: boolean
}

type Standards = Record<string, { category?: string; text?: string }>

export function decodeChecklist(
    rows: Inspection['checklist'],
    standards: Standards,
): DecodedChecklistRow[] | Inspection['checklist'] {
    if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) return rows
    return (rows as readonly (readonly unknown[])[]).map((cell) => {
        const [item, disposition, flags, override] = cell as [
            number | null, string, number, { c?: string; t?: string }?,
        ]
        const std = (item != null && standards[String(item)]) || {}
        return {
            item,
            disposition,
            category: override?.c ?? std.category ?? '',
            standard_text: override?.t ?? std.text ?? '',
            compliant: !!(flags & 1),
            violation: !!(flags & 2),
            cos: !!(flags & 4),
            repeat: !!(flags & 8),
            is_sentinel: !!(flags & 16),
        }
    })
}

/** One positional overlay row → a named object, by the shard's own `columns`
 *  (the contract carries its column names; the client never hardcodes slots). */
export function decodeOverlay(row: unknown, columns: unknown): OverlayRow {
    const out: OverlayRow = {}
    if (!Array.isArray(row) || !Array.isArray(columns)) return out
    ;(columns as string[]).forEach((name, index) => { out[name] = row[index] ?? null })
    return out
}

function join(base: string, path: string): string {
    return `${base.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`
}

function shardDescriptors(resource: unknown): ShardDescriptor[] {
    // Canonical shape only: `{shards: [...]}`. Anything else is not the
    // contract and is rejected rather than normalized.
    const shards = (resource as { shards?: unknown } | null | undefined)?.shards
    return Array.isArray(shards) ? (shards as ShardDescriptor[]) : []
}

function isShard(shard: unknown, contract: string): boolean {
    const s = shard as { contract?: unknown; schema_version?: unknown } | null | undefined
    return s?.contract === contract && s?.schema_version === SCHEMA_VERSION
}

export interface FoodApi {
    getFoodFacilities(): Promise<RosterResult>
    loadClosed(): Promise<RosterRow[]>
    getFoodFacilityDetail(permitID: string): Promise<FacilityDetail>
}

export function createFoodApi({
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    fullBase = DEFAULT_FULL_BASE,
    liteBase = DEFAULT_LITE_BASE,
    forceLite = false,
    // The acknowledgement gate (C2): the full tier is fetched only when the
    // visitor has acknowledged the terms. Read at call time. The default
    // keeps bare clients (tests, tools) on the old behavior.
    isAcknowledged = () => true,
}: {
    fetchImpl?: FetchLike
    fullBase?: string
    liteBase?: string
    forceLite?: boolean
    isAcknowledged?: () => boolean
} = {}): FoodApi {
    let fullManifest: FullManifest | null = null
    let overlayColumns: string[] | null = null
    let standardsPromise: Promise<Standards> | null = null
    let closedPromise: Promise<RosterRow[]> | null = null
    const roster = new Map<string, RosterRow>()
    const details = new Map<string, Promise<FacilityDetail>>() // permit_id → promise, LRU by insertion order

    async function read(path: string, quiet = false): Promise<unknown> {
        try {
            const response = await fetchImpl(path)
            if (!response.ok) {
                const error: DataError = new Error(response.status === 404
                    ? 'no data published yet' : `HTTP ${response.status}`)
                error.status = response.status
                throw error
            }
            // The static-assets layer answers a path it cannot find with the
            // site's own HTML shell, status 200 (`not_found_handling:
            // single-page-application`). On a data path that is a miss, not
            // markup to parse: the full tier falls back to R2 for that shard,
            // the basic map reports "unavailable".
            if (isHtml(response)) {
                const error: DataError = new Error('no data published yet')
                error.status = 404
                error.spaFallback = true
                throw error
            }
            return await response.json()
        } catch (error) {
            if (!quiet) console.error(`[data] Failed to fetch ${path}:`, error)
            throw error
        }
    }

    function isHtml(response: ResponseLike): boolean {
        const type = response.headers?.get?.('content-type') || ''
        return type.toLowerCase().includes('text/html')
    }

    /** The finder is the same bytes in git and R2, content-addressed (§6.3,
     *  D-DATA-2). Read it from the static public channel first — no Worker
     *  request on Workers Free — and fall back to R2 only when that exact
     *  name is absent there or answered with the SPA shell. Same name, same
     *  bytes. Both reads are quiet — a static miss is an expected state. */
    async function readFinderShard(path: string): Promise<unknown> {
        try {
            return await read(join(liteBase, path), true)
        } catch {
            return read(join(fullBase, path), true)
        }
    }

    function remember(facilities: RosterRow[], { reset = true } = {}): void {
        if (reset) roster.clear()
        for (const facility of facilities || []) {
            if (facility?.permit_id != null) roster.set(String(facility.permit_id), facility)
        }
    }

    function assertNoDuplicates(facilities: RosterRow[], label: string): void {
        const keys = new Set<string>()
        for (const facility of facilities) {
            const key = String(facility.permit_id)
            if (keys.has(key)) throw new Error(`${label} has duplicate permit IDs`)
            keys.add(key)
        }
    }

    async function loadFullV4(): Promise<RosterResult> {
        const manifest = await read(join(fullBase, 'manifest.json'), true) as FullManifest
        if (manifest?.contract !== FULL_MANIFEST_CONTRACT
            || manifest?.schema_version !== SCHEMA_VERSION) {
            throw new Error('unsupported full manifest')
        }
        const finderDescriptors = shardDescriptors(manifest.resources?.finder)
        const overlayDescriptors = shardDescriptors(manifest.resources?.overlay)
        if (!finderDescriptors.length
            || overlayDescriptors.length !== finderDescriptors.length
            || !manifest.resources?.standards?.path
            || !manifest.resources?.details?.path_template
            || !Array.isArray(shardDescriptors(manifest.resources?.closed))) {
            throw new Error('full manifest has incomplete resources')
        }
        const [finderShards, overlayShards] = await Promise.all([
            Promise.all(finderDescriptors.map((item) => readFinderShard(item.path))),
            Promise.all(overlayDescriptors.map((item) => read(join(fullBase, item.path), true))),
        ]) as [FinderShard[], OverlayShard[]]
        if (finderShards.some((shard) => !isShard(shard, FINDER_SHARD_CONTRACT))
            || overlayShards.some((shard) => !isShard(shard, OVERLAY_SHARD_CONTRACT))) {
            throw new Error('unsupported full roster shard')
        }
        const facilities: RosterRow[] = []
        let columns: string[] | null = null
        for (let i = 0; i < finderShards.length; i++) {
            const finder = finderShards[i]
            const overlay = overlayShards[i]
            const finderRows = Array.isArray(finder?.facilities) ? finder.facilities : null
            const overlayRows = Array.isArray(overlay?.rows) ? overlay.rows : null
            if (!finder || !overlay || !finderRows || !overlayRows) {
                throw new Error('malformed full roster shard')
            }
            // Position alignment is a property of the exporter's shared bucket
            // order; the sha binding is what lets the client PROVE it holds for
            // the two shards it actually received (D-DATA-5).
            const expectedSha = finderDescriptors[i]?.sha256
            if (expectedSha && overlay.finder_sha256 !== expectedSha) {
                throw new Error(`overlay bucket ${overlay.bucket ?? i} is not bound to its finder shard`)
            }
            if (overlayRows.length !== finderRows.length) {
                throw new Error(`overlay bucket ${overlay.bucket ?? i} is misaligned with its finder shard`)
            }
            if (!Array.isArray(overlay.columns) || !overlay.columns.length) {
                throw new Error('overlay shard carries no column names')
            }
            columns = columns || overlay.columns
            for (let j = 0; j < finderRows.length; j++) {
                facilities.push({ ...finderRows[j]!, o: decodeOverlay(overlayRows[j], overlay.columns) })
            }
        }
        assertNoDuplicates(facilities, 'full finder')
        const expected = manifest.counts?.active
        if (Number.isFinite(expected) && facilities.length !== expected) {
            throw new Error(`full roster count mismatch: ${facilities.length}/${expected}`)
        }
        fullManifest = manifest
        overlayColumns = columns
        closedPromise = null
        remember(facilities)
        return { ...manifest, facilities }
    }

    async function loadLite(): Promise<RosterResult> {
        // The basic map carries no judgment surfaces: forget any full-tier
        // state a previous load left behind, so a detail or closed read
        // cannot be answered from it after the visitor declined the terms.
        fullManifest = null
        overlayColumns = null
        closedPromise = null
        try {
            const manifest = await read(join(liteBase, 'manifest.json'), true) as LiteManifest
            if (manifest?.contract !== PUBLIC_MANIFEST_CONTRACT
                || manifest?.schema_version !== SCHEMA_VERSION) {
                throw new Error('unsupported public manifest')
            }
            const finderDescriptors = shardDescriptors(manifest.resources?.finder)
            if (!finderDescriptors.length) {
                throw new Error('public manifest has no finder shards')
            }
            const finderShards = await Promise.all(finderDescriptors.map(
                (item) => read(join(liteBase, item.path), true))) as FinderShard[]
            if (finderShards.some((shard) => !isShard(shard, FINDER_SHARD_CONTRACT))) {
                throw new Error('unsupported public finder shard')
            }
            const facilities: RosterRow[] = finderShards.flatMap((shard) => shard.facilities || [])
            assertNoDuplicates(facilities, 'public finder')
            const expected = manifest.counts?.total
            if (Number.isFinite(expected) && facilities.length !== expected) {
                throw new Error(`public roster count mismatch: ${facilities.length}/${expected}`)
            }
            remember(facilities)
            return { ...manifest, facilities }
        } catch (error) {
            const e = error as DataError
            return {
                available: false,
                reason: e.status === 404 ? 'no data published yet' : e.message,
                _httpStatus: e.status,
            }
        }
    }

    async function getStandards(): Promise<Standards> {
        if (!standardsPromise) {
            const path = fullManifest!.resources.standards.path
            standardsPromise = read(join(fullBase, path), true)
                .then((value) => {
                    const v = value as { standards?: Standards } | Standards
                    return ((v as { standards?: Standards }).standards || v) as Standards
                })
                .catch(() => ({}))
        }
        return standardsPromise
    }

    /** The lazy closed supplement: fetched once per Full manifest, on the
     *  first "Show closed", merged into the roster and returned. */
    async function loadClosed(): Promise<RosterRow[]> {
        if (!fullManifest) return []
        if (!closedPromise) {
            const descriptors = shardDescriptors(fullManifest.resources?.closed)
            closedPromise = Promise.all(descriptors.map(
                (item) => read(join(fullBase, item.path), true)))
                .then((shards) => {
                    if ((shards as ClosedShard[]).some((shard) => !isShard(shard, CLOSED_SHARD_CONTRACT))) {
                        throw new Error('unsupported closed shard')
                    }
                    const facilities = (shards as ClosedShard[])
                        .flatMap((shard) => shard.facilities || [])
                        .map((row: ClosedWireRow): RosterRow =>
                            ({ ...row, o: decodeOverlay(row.o, overlayColumns) }))
                    assertNoDuplicates(facilities, 'closed')
                    const expected = fullManifest?.counts?.closed
                    if (Number.isFinite(expected) && facilities.length !== expected) {
                        throw new Error(`closed count mismatch: ${facilities.length}/${expected}`)
                    }
                    remember(facilities, { reset: false })
                    return facilities
                })
                .catch((error) => {
                    closedPromise = null // a failed toggle can be retried
                    throw error
                })
        }
        return closedPromise
    }

    function detailPromise(permitID: string): Promise<FacilityDetail> {
        const key = String(permitID)
        const cached = details.get(key)
        if (cached) {
            // Refresh recency: delete + reinsert moves it to the end.
            details.delete(key)
            details.set(key, cached)
            return cached
        }
        const template = fullManifest!.resources.details.path_template
        const relative = template.replace('{permit_id}', encodeURIComponent(permitID))
        const promise = Promise.all([read(join(fullBase, relative)), getStandards()])
            .then(([raw, standards]) => {
                const data = raw as FacilityDetail
                if (data?.available && (data.contract !== DETAIL_CONTRACT
                    || data.schema_version !== SCHEMA_VERSION)) {
                    // Thrown, not returned: the catch below evicts it, so a
                    // detail mid-republish is retried on the next click.
                    throw new Error('unsupported facility detail')
                }
                if (data?.available && Array.isArray(data.inspections)) {
                    for (const inspection of data.inspections) {
                        inspection.checklist = decodeChecklist(inspection.checklist, standards) as Inspection['checklist']
                    }
                }
                const row = roster.get(key)
                if (row && data?.facility) {
                    data.facility = { ...row, ...data.facility }
                }
                return data
            })
            .catch((error) => {
                details.delete(key) // never cache a failure
                throw error
            })
        details.set(key, promise)
        while (details.size > DETAIL_CACHE_SIZE) {
            details.delete(details.keys().next().value as string)
        }
        return promise
    }

    return {
        async getFoodFacilities() {
            // ?tier=lite always wins (D-ACK-3); otherwise the full tier is
            // tried only after the acknowledgement, and degrades to the
            // basic map on any failure (P4).
            if (!forceLite && isAcknowledged()) {
                try {
                    return await loadFullV4()
                } catch {
                    /* public-tier fallback */
                }
            }
            return loadLite()
        },

        /** Full only. Resolves to the closed rows (already merged into the
         *  roster) or [] on Lite; rejects if the family cannot be read. */
        loadClosed,

        /** The nested per-facility history, on click (P5). One request per
         *  distinct facility per session (LRU); standards once. */
        async getFoodFacilityDetail(permitID: string) {
            if (!fullManifest) {
                return {
                    available: false as const,
                    reason: 'full Contract V4 manifest unavailable',
                }
            }
            try {
                return await detailPromise(permitID)
            } catch (error) {
                const e = error as DataError
                return {
                    available: false as const,
                    reason: e.status === 404 ? 'no data published yet' : e.message,
                    _httpStatus: e.status,
                }
            }
        },
    }
}
