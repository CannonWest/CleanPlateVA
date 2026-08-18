#!/usr/bin/env node
/**
 * CPH cross-check — does the exporter's `visits` column say what the
 * sparkline would have drawn from the detail?
 *
 * The overlay's `visits` (design ref D-DATA-13) puts the hover sparkline's
 * per-inspection series back at boot so a hover costs zero requests. Its
 * contract is "exactly the marks the renderer derives from the detail" —
 * kind, x-slot, and value per inspection, oldest-first. This tool proves it
 * on the whole corpus rather than asserting it: for every published detail
 * it runs the REAL client pipeline (`buildScopeSeries` → `inspectionPresentation`
 * → `focusedOutcomePresentation` / `narrativeVerdictPresentation`, exactly
 * what `sparkline.js#_sparkSvg` reads) and compares the marks with the ones
 * decoded from the `visits` column.
 *
 *   node tools/visits-crosscheck.mjs --dump SCRATCH/v4/visits-b.json
 *       (CPH-M0: the prototype's permit_id → visits map)
 *   node tools/visits-crosscheck.mjs --view public/data-full
 *       (CPH-M1+: read `visits` straight from the materialized overlay +
 *        closed shards, decoded by each shard's `columns`)
 *
 * Details are read from --details (default public/data-full/facility) with
 * public/data-full/standards.json decoding the checklist rows, as
 * dataClient.detailPromise does. Exit 0 iff every facility matches.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) =>
    a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));

const root = process.cwd();
const jsDir = pathToFileURL(join(root, 'public', 'static', 'js') + '/').href;
const {
    buildScopeSeries, focusedOutcomePresentation, narrativeVerdictPresentation, isoFromYmd,
} = await import(new URL('presentation.js', jsDir));
const { decodeChecklist, decodeOverlay } = await import(new URL('dataClient.js', jsDir));

const detailsDir = args.details || join(root, 'public', 'data-full', 'facility');
const standardsPath = args.standards || join(root, 'public', 'data-full', 'standards.json');
const standardsRaw = JSON.parse(readFileSync(standardsPath, 'utf8'));
const standards = standardsRaw.standards || standardsRaw;
const limit = args.limit ? Number(args.limit) : Infinity;
const showN = args.show ? Number(args.show) : 12;

// ── the visits map: permit_id → visits (variant b) ──────────────────────
function loadVisits() {
    if (args.dump) return JSON.parse(readFileSync(args.dump, 'utf8'));
    if (!args.view) throw new Error('pass --dump <visits-b.json> or --view <data-full root>');
    const view = args.view;
    const manifest = JSON.parse(readFileSync(join(view, 'manifest.json'), 'utf8'));
    const out = {};
    const finder = manifest.resources.finder.shards;
    const overlay = manifest.resources.overlay.shards;
    let columns = null;
    for (let i = 0; i < finder.length; i++) {
        const f = JSON.parse(readFileSync(join(view, finder[i].path), 'utf8'));
        const o = JSON.parse(readFileSync(join(view, overlay[i].path), 'utf8'));
        if (!o.columns.includes('visits')) throw new Error(`overlay ${overlay[i].path} has no visits column`);
        columns = columns || o.columns;
        f.facilities.forEach((row, j) => { out[row.permit_id] = decodeOverlay(o.rows[j], o.columns).visits; });
    }
    for (const shard of manifest.resources.closed.shards) {
        const c = JSON.parse(readFileSync(join(view, shard.path), 'utf8'));
        // closed rows carry `o` positionally in the overlay's column order
        for (const row of c.facilities) out[row.permit_id] = decodeOverlay(row.o, columns).visits;
    }
    return out;
}

// ── canonical marks ─────────────────────────────────────────────────────
// One tuple per x-slot, oldest-first: what _sparkSvg would put on the canvas.
//   ['broad', ymd, score] · ['slot', ymd] (broad, no score — an x-slot, no
//   mark) · ['focused', ymd, out, total] · ['tick', ymd] · ['narr', ymd,
//   height, glyph, tone, count]
function ymdOf(iso) {
    const digits = String(iso || '').slice(0, 10).replace(/-/g, '');
    return /^\d{8}$/.test(digits) ? Number(digits) : 0;
}

function marksFromDetail(detail) {
    const inspections = (detail?.available && Array.isArray(detail.inspections)) ? detail.inspections : [];
    for (const insp of inspections) insp.checklist = decodeChecklist(insp.checklist, standards);
    const series = buildScopeSeries(inspections);
    return series.events.map((event) => {
        const p = event.presentation;
        const ymd = ymdOf(event.inspection.date);
        if (p.gradeEligible) return ['broad', ymd, p.score];
        if (p.scope === 'focused') {
            const o = focusedOutcomePresentation(p);
            return o.ratioKnown ? ['focused', ymd, o.out, o.total] : ['tick', ymd];
        }
        if (p.scope === 'unknown') {
            const adj = narrativeVerdictPresentation(event.inspection);
            return adj ? ['narr', ymd, adj.height, adj.glyph, adj.tone, adj.count ?? null] : ['tick', ymd];
        }
        return ['slot', ymd];   // broad, no published score
    });
}

// The M2 decoder in embryo: visits (variant b) → the same canonical marks.
const VERDICT = { 1: [100, '✓', 'clear'], 2: [85, '✓', 'good'], 3: [0, '✗', 'severe'] };
function marksFromVisits(visits) {
    return (visits || []).map((v) => {
        const [kind, ymd, ...rest] = v;
        if (kind === 1) return rest.length && rest[0] != null ? ['broad', ymd, rest[0]] : ['slot', ymd];
        if (kind === 2) return rest.length === 2 ? ['focused', ymd, rest[0], rest[1]] : ['tick', ymd];
        if (kind === 3) {
            const [code, ins, outs] = rest;
            if (code === 4) {
                if (!ins && !outs) return ['tick', ymd];
                const height = Math.round(100 * ins / (ins + outs));
                const glyph = ins ? '✓' : '✗';
                const tone = outs ? (ins ? 'watch' : 'severe') : 'good';
                return ['narr', ymd, height, glyph, tone, ins || outs];
            }
            const [height, glyph, tone] = VERDICT[code] || [];
            return height == null ? ['tick', ymd] : ['narr', ymd, height, glyph, tone, null];
        }
        return ['tick', ymd];
    });
}

// ── run ─────────────────────────────────────────────────────────────────
const t0 = Date.now();
const visitsMap = loadVisits();
const pids = Object.keys(visitsMap);
console.log(`visits map: ${pids.length.toLocaleString()} permits (${args.dump ? 'dump' : 'view'}); details from ${detailsDir}`);

const stats = { checked: 0, match: 0, mismatch: 0, missingDetail: 0, slotCountDiff: 0 };
const kindMix = {};
const mismatchKinds = {};
const examples = [];
let n = 0;
for (const pid of pids) {
    if (n++ >= limit) break;
    const path = join(detailsDir, `${pid}.json`);
    if (!existsSync(path)) { stats.missingDetail++; continue; }
    const detail = JSON.parse(readFileSync(path, 'utf8'));
    const want = marksFromDetail(detail);
    const got = marksFromVisits(visitsMap[pid]);
    stats.checked++;
    for (const m of want) kindMix[m[0]] = (kindMix[m[0]] || 0) + 1;
    const same = want.length === got.length && want.every((m, i) => JSON.stringify(m) === JSON.stringify(got[i]));
    if (same) { stats.match++; continue; }
    stats.mismatch++;
    if (want.length !== got.length) stats.slotCountDiff++;
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
        if (JSON.stringify(want[i]) !== JSON.stringify(got[i])) {
            const key = `${want[i]?.[0] ?? '∅'} → ${got[i]?.[0] ?? '∅'}`;
            mismatchKinds[key] = (mismatchKinds[key] || 0) + 1;
        }
    }
    if (examples.length < showN) examples.push({ pid, want, got });
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`checked ${stats.checked.toLocaleString()} facilities in ${secs}s · match ${stats.match.toLocaleString()} · mismatch ${stats.mismatch.toLocaleString()}`
    + ` (slot-count differs ${stats.slotCountDiff}) · missing detail ${stats.missingDetail}`);
console.log('renderer mark mix (x-slots):', Object.entries(kindMix).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · '));
if (stats.mismatch) {
    console.log('mismatch kinds (renderer → visits):', mismatchKinds);
    for (const ex of examples) {
        console.log(`\n  ${ex.pid}`);
        console.log(`    detail: ${JSON.stringify(ex.want)}`);
        console.log(`    visits: ${JSON.stringify(ex.got)}`);
    }
}
process.exit(stats.mismatch || stats.missingDetail ? 1 : 0);
