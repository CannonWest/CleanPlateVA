// CR build config (CRF-M0) — the D-CR-BUILD-1 layout, ratified CRD-M0
// (design ref docs/frontend-redesign.md §3, §10):
//
//   · Vite at the repo root, the app under app/, output dist/.
//   · public/ is the publisher's channel (C5): in dev it is served as a
//     passthrough (including a local data-full/ for full-tier work); at
//     build it rides into dist/ verbatim — EXCEPT the three entries below.
//   · src/worker.js and wrangler's `main` pointer never move, and
//     wrangler.jsonc's assets.directory stays ./public until CRC's one-PR
//     flip (C4) — building dist/ changes nothing about what is served.
//
// Vite has no publicDir exclude list, so the build copy is done by the
// closeBundle plugin below instead of copyPublicDir:
//
//   · data-full/**  — the 400+ MB local-only full archive (gitignored;
//     absent in the Workers Builds checkout). Never a build input.
//   · index.html + static/** — the OLD no-build client, which remains the
//     *served* site until CRC and is ignored by the build (§3). The built
//     dist/index.html is the new app's entry; copying the old shell over it
//     (or its 19 ES modules beside it) would re-ship the client this
//     program retires.
//
// What DOES ride into dist/: public/data/** (manifest + finder shards) and
// public/_headers — cannon-food's write targets, byte-identical (C5), pinned
// by tests/vitest/dist-contract.spec.ts.
/// <reference types="vitest/config" />
import { cp } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const PUBLIC_COPY_EXCLUDED = ['data-full', 'index.html', 'static']

function cpPublicCopy() {
    return {
        name: 'cp-public-copy',
        apply: 'build' as const,
        async closeBundle() {
            const publicDir = resolve(import.meta.dirname, 'public')
            const outDir = resolve(import.meta.dirname, 'dist')
            await cp(publicDir, outDir, {
                recursive: true,
                filter(source: string) {
                    const rel = relative(publicDir, source).replaceAll('\\', '/')
                    return !PUBLIC_COPY_EXCLUDED.some(
                        (entry) => rel === entry || rel.startsWith(`${entry}/`),
                    )
                },
            })
        },
    }
}

// maplibre-gl v6 spawns its tile/style worker at runtime from
// `new URL('maplibre-gl-worker.mjs', import.meta.url)` — a URL the bundler
// never sees, so no worker chunk is emitted and the SPA fallback answers the
// request with index.html (measured on the preview host 2026-08-30: module-
// MIME console error, map 'load' never fires, canvas stays empty; dev never
// hits this — optimizeDeps.exclude serves maplibre's native ESM, which finds
// the files in node_modules). Ship the package's own worker entry and the
// one sibling it imports (`./maplibre-gl-shared.mjs`, itself import-free)
// beside the main chunk, where those runtime URLs resolve — at any mount
// depth, since both resolve against the requesting module's URL, not the
// page's. Pinned by tests/vitest/dist-contract.spec.ts.
const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

function maplibreWorkerCopy() {
    return {
        name: 'maplibre-worker-copy',
        apply: 'build' as const,
        async closeBundle() {
            for (const name of MAPLIBRE_WORKER_FILES) {
                await cp(
                    resolve(import.meta.dirname, 'node_modules/maplibre-gl/dist', name),
                    resolve(import.meta.dirname, 'dist/assets', name),
                )
            }
        },
    }
}

export default defineConfig({
    plugins: [react(), tailwindcss(), cpPublicCopy(), maplibreWorkerCopy()],
    // Base-relative asset URLs (D-CR-EMBED-1, C7): the CannonAI Food tab
    // serves this build under /cleanplate/ behind a rewritten <base href>,
    // so the built entry must reference ./assets/* and let index.html's
    // <base> tag resolve them at the mount. Dev is unaffected (the dev
    // server treats a relative base as '/').
    base: './',
    // Dev passthrough only; the build copy is the filtered plugin above.
    publicDir: 'public',
    optimizeDeps: {
        // maplibre-gl spawns its tile/style worker from its own bundled
        // code; the dev-time dep optimizer's re-bundle breaks that worker
        // SILENTLY (map 'load' never fires, zero console errors — measured
        // CRF-M1, Vite 8.2/Rolldown). Serve its native ESM untransformed.
        // Production builds are unaffected (different pipeline).
        exclude: ['maplibre-gl'],
    },
    server: {
        watch: {
            // The local full archive is ~28k JSON files; watching it costs a
            // >10 s first load and buys nothing (it changes via cannon-food
            // publishes, not editor saves). It still SERVES from the
            // passthrough — this only unwatches it.
            ignored: ['**/public/data-full/**'],
        },
    },
    build: {
        outDir: 'dist',
        copyPublicDir: false,
        // The bundle diet (CRP-M5). One 1.33 MB chunk carried the app AND
        // its vendors, so every deploy invalidated maplibre's ~800 KB for
        // every returning browser and every edge colo. Split what changes
        // from what does not: maplibre in its own chunk (the floor no stack
        // choice moves, §8), React in its own, the rest of node_modules in
        // one more, the app's own code in the entry. Content-addressed
        // names mean a vendor chunk's URL survives an app-only deploy, and
        // the immutable cache rule keeps it. maplibre's runtime worker URL
        // resolves against ITS chunk's URL — same assets/ dir, so the
        // worker pair beside it (maplibreWorkerCopy) still resolves.
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        { name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 3 },
                        { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
                        { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
                    ],
                },
            },
        },
        // maplibre alone minifies to ~980 KB; the default 500 kB warning
        // would fire on every build forever about the one chunk that is the
        // floor. The entry and the lazy chunks stay an order of magnitude
        // below this.
        chunkSizeWarningLimit: 1024,
    },
    test: {
        include: ['app/**/*.spec.{ts,tsx}', 'tests/vitest/**/*.spec.{ts,tsx}'],
    },
})
