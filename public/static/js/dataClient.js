/** CleanPlateVA prepared-data client for manifest-led Contract V3. */

const DEFAULT_FULL_BASE = 'data-full';
const DEFAULT_LITE_BASE = 'data';

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

function join(base, path) {
    return `${base.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
}

function shardDescriptors(resource) {
    return resource?.shards || [];
}

export function createFoodApi({
    fetchImpl = globalThis.fetch,
    fullBase = DEFAULT_FULL_BASE,
    liteBase = DEFAULT_LITE_BASE,
    forceLite = false,
} = {}) {
    let fullManifest = null;
    let standardsPromise = null;
    const roster = new Map();

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

    function remember(facilities) {
        roster.clear();
        for (const facility of facilities || []) {
            if (facility?.permit_id != null) roster.set(String(facility.permit_id), facility);
        }
    }

    async function loadFullV3() {
        const manifest = await read(join(fullBase, 'manifest.json'), true);
        if (manifest?.contract !== 'cleanplateva.full-manifest.v3'
            || manifest?.schema_version !== 3) {
            throw new Error('unsupported full manifest');
        }
        const finderDescriptors = shardDescriptors(manifest.resources?.finder);
        const signalDescriptors = shardDescriptors(manifest.resources?.signals);
        if (!finderDescriptors.length || !signalDescriptors.length
            || !manifest.resources?.standards?.path
            || !manifest.resources?.details?.path_template) {
            throw new Error('full manifest has incomplete resources');
        }
        const [finderShards, signalShards] = await Promise.all([
            Promise.all(finderDescriptors.map((item) => read(join(fullBase, item.path), true))),
            Promise.all(signalDescriptors.map((item) => read(join(fullBase, item.path), true))),
        ]);
        if (finderShards.some((shard) =>
            shard?.contract !== 'cleanplateva.full-finder-shard.v3'
            || shard?.schema_version !== 3)
            || signalShards.some((shard) =>
                shard?.contract !== 'cleanplateva.full-signal-shard.v3'
                || shard?.schema_version !== 3)) {
            throw new Error('unsupported full roster shard');
        }
        const byPermit = new Map();
        for (const shard of finderShards) {
            for (const facility of shard.facilities || []) {
                byPermit.set(String(facility.permit_id), facility);
            }
        }
        const signalPermits = new Set();
        for (const shard of signalShards) {
            for (const signal of shard.facilities || []) {
                const key = String(signal.permit_id);
                signalPermits.add(key);
                byPermit.set(key, { ...(byPermit.get(key) || {}), ...signal });
            }
        }
        const facilities = [...byPermit.values()];
        const expected = manifest.counts?.total;
        if (Number.isFinite(expected) && facilities.length !== expected) {
            throw new Error(`full roster count mismatch: ${facilities.length}/${expected}`);
        }
        if (signalPermits.size !== byPermit.size
            || [...byPermit.keys()].some((key) => !signalPermits.has(key))) {
            throw new Error('full finder/signal shard membership mismatch');
        }
        fullManifest = manifest;
        remember(facilities);
        return { ...manifest, facilities };
    }

    async function loadLite() {
        try {
            const manifest = await read(join(liteBase, 'manifest.json'), true);
            if (manifest?.contract !== 'cleanplateva.finder-manifest.v3'
                || manifest?.schema_version !== 3) {
                throw new Error('unsupported public manifest');
            }
            const finderDescriptors = shardDescriptors(manifest.resources?.finder);
            if (!finderDescriptors.length) {
                throw new Error('public manifest has no finder shards');
            }
            const finderShards = await Promise.all(finderDescriptors.map(
                (item) => read(join(liteBase, item.path), true)));
            if (finderShards.some((shard) =>
                shard?.contract !== 'cleanplateva.finder-shard.v3'
                || shard?.schema_version !== 3)) {
                throw new Error('unsupported public finder shard');
            }
            const facilities = finderShards.flatMap((shard) => shard.facilities || []);
            const keys = new Set(facilities.map((facility) => String(facility.permit_id)));
            const expected = manifest.counts?.total;
            if (keys.size !== facilities.length) {
                throw new Error('public finder has duplicate permit IDs');
            }
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

    return {
        async getFoodFacilities() {
            if (!forceLite) {
                try { return await loadFullV3(); } catch (_) { /* public-tier fallback */ }
            }
            return loadLite();
        },

        async getFoodFacilityDetail(permitID) {
            if (!fullManifest) {
                return {
                    available: false,
                    reason: 'full Contract V3 manifest unavailable',
                };
            }
            const template = fullManifest.resources.details.path_template;
            const encoded = encodeURIComponent(permitID);
            const relative = template.replace('{permit_id}', encoded);
            try {
                const [data, standards] = await Promise.all([
                    read(join(fullBase, relative)),
                    getStandards(),
                ]);
                if (data?.available && Array.isArray(data.inspections)) {
                    for (const inspection of data.inspections) {
                        inspection.checklist = decodeChecklist(inspection.checklist, standards);
                    }
                }
                const cached = roster.get(String(permitID));
                if (cached && data?.facility) {
                    data.facility = { ...cached, ...data.facility };
                }
                return data;
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
