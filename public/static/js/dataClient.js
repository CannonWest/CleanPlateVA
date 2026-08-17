/** CleanPlateVA prepared-data client for manifest-led Contract V4.
 *
 * Both tiers boot on the same finder family (active permits, judgment-free
 * identity/location rows). Full adds the position-aligned overlay at boot —
 * one row per finder row, bound to the finder shard it aligns to by the
 * finder shard's sha256 in the overlay envelope — and reads the lazy closed
 * family only on "Show closed". Facility detail is fetched per permit (hover
 * prefetch and click share one LRU cache) and standards once. A manifest or
 * shard this client does not understand degrades to the public finder; there
 * is no dual-contract path (design ref P4).
 */

const DEFAULT_FULL_BASE = 'data-full';
const DEFAULT_LITE_BASE = 'data';

export const FULL_MANIFEST_CONTRACT = 'cleanplateva.full-manifest.v4';
export const PUBLIC_MANIFEST_CONTRACT = 'cleanplateva.finder-manifest.v4';
export const FINDER_SHARD_CONTRACT = 'cleanplateva.finder-shard.v4';
export const OVERLAY_SHARD_CONTRACT = 'cleanplateva.overlay-shard.v4';
export const CLOSED_SHARD_CONTRACT = 'cleanplateva.closed-shard.v4';
export const SCHEMA_VERSION = 4;
export const DETAIL_CACHE_SIZE = 200;   // D-DATA-10: LRU of decoded details

export function decodeChecklist(rows, standards) {
    if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) return rows;
    return rows.map(([item, disposition, flags, override]) => {
        const std = (item != null && standards[String(item)]) || {};
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
        };
    });
}

/** One positional overlay row → a named object, by the shard's own `columns`
 *  (the contract carries its column names; the client never hardcodes slots). */
export function decodeOverlay(row, columns) {
    const out = {};
    if (!Array.isArray(row) || !Array.isArray(columns)) return out;
    columns.forEach((name, index) => { out[name] = row[index] ?? null; });
    return out;
}

function join(base, path) {
    return `${base.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
}

function shardDescriptors(resource) {
    // Canonical shape only: `{shards: [...]}`. Anything else is not the
    // contract and is rejected rather than normalized.
    return Array.isArray(resource?.shards) ? resource.shards : [];
}

function isShard(shard, contract) {
    return shard?.contract === contract && shard?.schema_version === SCHEMA_VERSION;
}

export function createFoodApi({
    fetchImpl = globalThis.fetch,
    fullBase = DEFAULT_FULL_BASE,
    liteBase = DEFAULT_LITE_BASE,
    forceLite = false,
    // The acknowledgement gate (CPF, design ref §3 / D-ACK-1): the full tier
    // is fetched only when the visitor has acknowledged the terms. Read at
    // call time, so a decision made after boot governs the next load. The
    // default keeps bare clients (tests, tools) on the old behavior.
    isAcknowledged = () => true,
} = {}) {
    let fullManifest = null;
    let overlayColumns = null;
    let standardsPromise = null;
    let closedPromise = null;
    const roster = new Map();
    const details = new Map();   // permit_id → Promise<detail>, LRU by insertion order

    async function read(path, quiet = false) {
        try {
            const response = await fetchImpl(path);
            if (!response.ok) {
                const error = new Error(response.status === 404
                    ? 'no data published yet' : `HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return await response.json();
        } catch (error) {
            if (!quiet) console.error(`[data] Failed to fetch ${path}:`, error);
            throw error;
        }
    }

    function remember(facilities, { reset = true } = {}) {
        if (reset) roster.clear();
        for (const facility of facilities || []) {
            if (facility?.permit_id != null) roster.set(String(facility.permit_id), facility);
        }
    }

    function assertNoDuplicates(facilities, label) {
        const keys = new Set();
        for (const facility of facilities) {
            const key = String(facility.permit_id);
            if (keys.has(key)) throw new Error(`${label} has duplicate permit IDs`);
            keys.add(key);
        }
        return keys;
    }

    async function loadFullV4() {
        const manifest = await read(join(fullBase, 'manifest.json'), true);
        if (manifest?.contract !== FULL_MANIFEST_CONTRACT
            || manifest?.schema_version !== SCHEMA_VERSION) {
            throw new Error('unsupported full manifest');
        }
        const finderDescriptors = shardDescriptors(manifest.resources?.finder);
        const overlayDescriptors = shardDescriptors(manifest.resources?.overlay);
        if (!finderDescriptors.length
            || overlayDescriptors.length !== finderDescriptors.length
            || !manifest.resources?.standards?.path
            || !manifest.resources?.details?.path_template
            || !Array.isArray(shardDescriptors(manifest.resources?.closed))) {
            throw new Error('full manifest has incomplete resources');
        }
        const [finderShards, overlayShards] = await Promise.all([
            Promise.all(finderDescriptors.map((item) => read(join(fullBase, item.path), true))),
            Promise.all(overlayDescriptors.map((item) => read(join(fullBase, item.path), true))),
        ]);
        if (finderShards.some((shard) => !isShard(shard, FINDER_SHARD_CONTRACT))
            || overlayShards.some((shard) => !isShard(shard, OVERLAY_SHARD_CONTRACT))) {
            throw new Error('unsupported full roster shard');
        }
        const facilities = [];
        let columns = null;
        for (let i = 0; i < finderShards.length; i++) {
            const finder = finderShards[i];
            const overlay = overlayShards[i];
            const finderRows = Array.isArray(finder.facilities) ? finder.facilities : null;
            const overlayRows = Array.isArray(overlay.rows) ? overlay.rows : null;
            if (!finderRows || !overlayRows) throw new Error('malformed full roster shard');
            // Position alignment is a property of the exporter's shared bucket
            // order; the sha binding is what lets the client PROVE it holds for
            // the two shards it actually received (D-DATA-5).
            const expectedSha = finderDescriptors[i]?.sha256;
            if (expectedSha && overlay.finder_sha256 !== expectedSha) {
                throw new Error(`overlay bucket ${overlay.bucket ?? i} is not bound to its finder shard`);
            }
            if (overlayRows.length !== finderRows.length) {
                throw new Error(`overlay bucket ${overlay.bucket ?? i} is misaligned with its finder shard`);
            }
            if (!Array.isArray(overlay.columns) || !overlay.columns.length) {
                throw new Error('overlay shard carries no column names');
            }
            columns = columns || overlay.columns;
            for (let j = 0; j < finderRows.length; j++) {
                facilities.push({ ...finderRows[j], o: decodeOverlay(overlayRows[j], overlay.columns) });
            }
        }
        assertNoDuplicates(facilities, 'full finder');
        const expected = manifest.counts?.active;
        if (Number.isFinite(expected) && facilities.length !== expected) {
            throw new Error(`full roster count mismatch: ${facilities.length}/${expected}`);
        }
        fullManifest = manifest;
        overlayColumns = columns;
        closedPromise = null;
        remember(facilities);
        return { ...manifest, facilities };
    }

    async function loadLite() {
        // The basic map carries no judgment surfaces: forget any full-tier
        // state a previous load left behind, so a detail or closed read
        // cannot be answered from it after the visitor declined the terms.
        fullManifest = null;
        overlayColumns = null;
        closedPromise = null;
        try {
            const manifest = await read(join(liteBase, 'manifest.json'), true);
            if (manifest?.contract !== PUBLIC_MANIFEST_CONTRACT
                || manifest?.schema_version !== SCHEMA_VERSION) {
                throw new Error('unsupported public manifest');
            }
            const finderDescriptors = shardDescriptors(manifest.resources?.finder);
            if (!finderDescriptors.length) {
                throw new Error('public manifest has no finder shards');
            }
            const finderShards = await Promise.all(finderDescriptors.map(
                (item) => read(join(liteBase, item.path), true)));
            if (finderShards.some((shard) => !isShard(shard, FINDER_SHARD_CONTRACT))) {
                throw new Error('unsupported public finder shard');
            }
            const facilities = finderShards.flatMap((shard) => shard.facilities || []);
            assertNoDuplicates(facilities, 'public finder');
            const expected = manifest.counts?.total;
            if (Number.isFinite(expected) && facilities.length !== expected) {
                throw new Error(`public roster count mismatch: ${facilities.length}/${expected}`);
            }
            remember(facilities);
            return { ...manifest, facilities };
        } catch (error) {
            return {
                available: false,
                reason: error.status === 404 ? 'no data published yet' : error.message,
                _httpStatus: error.status,
            };
        }
    }

    async function getStandards() {
        if (!standardsPromise) {
            const path = fullManifest.resources.standards.path;
            standardsPromise = read(join(fullBase, path), true)
                .then((value) => value.standards || value)
                .catch(() => ({}));
        }
        return standardsPromise;
    }

    /** The lazy closed supplement: fetched once per Full manifest, on the
     *  first "Show closed", merged into the roster and returned. Rows carry
     *  the finder fields + `status` + `o` (their overlay row, decoded here). */
    async function loadClosed() {
        if (!fullManifest) return [];
        if (!closedPromise) {
            const descriptors = shardDescriptors(fullManifest.resources?.closed);
            closedPromise = Promise.all(descriptors.map(
                (item) => read(join(fullBase, item.path), true)))
                .then((shards) => {
                    if (shards.some((shard) => !isShard(shard, CLOSED_SHARD_CONTRACT))) {
                        throw new Error('unsupported closed shard');
                    }
                    const facilities = shards.flatMap((shard) => shard.facilities || [])
                        .map((row) => ({ ...row, o: decodeOverlay(row.o, overlayColumns) }));
                    assertNoDuplicates(facilities, 'closed');
                    const expected = fullManifest.counts?.closed;
                    if (Number.isFinite(expected) && facilities.length !== expected) {
                        throw new Error(`closed count mismatch: ${facilities.length}/${expected}`);
                    }
                    remember(facilities, { reset: false });
                    return facilities;
                })
                .catch((error) => {
                    closedPromise = null;   // a failed toggle can be retried
                    throw error;
                });
        }
        return closedPromise;
    }

    function detailPromise(permitID) {
        const key = String(permitID);
        const cached = details.get(key);
        if (cached) {
            // Refresh recency: delete + reinsert moves it to the end.
            details.delete(key);
            details.set(key, cached);
            return cached;
        }
        const template = fullManifest.resources.details.path_template;
        const relative = template.replace('{permit_id}', encodeURIComponent(permitID));
        const promise = Promise.all([read(join(fullBase, relative)), getStandards()])
            .then(([data, standards]) => {
                if (data?.available && Array.isArray(data.inspections)) {
                    for (const inspection of data.inspections) {
                        inspection.checklist = decodeChecklist(inspection.checklist, standards);
                    }
                }
                const row = roster.get(key);
                if (row && data?.facility) {
                    data.facility = { ...row, ...data.facility };
                }
                return data;
            })
            .catch((error) => {
                details.delete(key);   // never cache a failure
                throw error;
            });
        details.set(key, promise);
        while (details.size > DETAIL_CACHE_SIZE) {
            details.delete(details.keys().next().value);
        }
        return promise;
    }

    return {
        async getFoodFacilities() {
            // ?tier=lite always wins (D-ACK-3); otherwise the full tier is
            // tried only after the acknowledgement, and degrades to the
            // basic map on any failure (P4).
            if (!forceLite && isAcknowledged()) {
                try { return await loadFullV4(); } catch (_) { /* public-tier fallback */ }
            }
            return loadLite();
        },

        /** Full only. Resolves to the closed rows (already merged into the
         *  roster) or [] on Lite; rejects if the family cannot be read. */
        loadClosed,

        /** Warm the detail cache for a permit (hover). Never throws; the click
         *  path re-reads through the same cache and reports its own error. */
        prefetchDetail(permitID) {
            if (!fullManifest) return Promise.resolve(null);
            return detailPromise(permitID).catch(() => null);
        },

        async getFoodFacilityDetail(permitID) {
            if (!fullManifest) {
                return {
                    available: false,
                    reason: 'full Contract V4 manifest unavailable',
                };
            }
            try {
                return await detailPromise(permitID);
            } catch (error) {
                return {
                    available: false,
                    reason: error.status === 404 ? 'no data published yet' : error.message,
                    _httpStatus: error.status,
                };
            }
        },
    };
}
