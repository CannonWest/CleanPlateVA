// CR build config (CRF-M0) — the D-CR-BUILD-1 layout, ratified CRD-M0
// (design ref docs/frontend-redesign.md §3, §10); the served site since
// CRC's one-PR flip (2026-09-06, wrangler.jsonc assets.directory ./dist):
//
//   · Vite at the repo root, the app under app/, output dist/.
//   · public/ is the publisher's channel (C5): in dev it is served as a
//     passthrough (including a local data-full/ for full-tier work); at
//     build it rides into dist/ verbatim — EXCEPT the entry below.
//   · src/worker.js and wrangler's `main` pointer never move (C4).
//
// Vite has no publicDir exclude list, so the build copy is done by the
// closeBundle plugin below instead of copyPublicDir:
//
//   · data-full/**  — the 400+ MB local-only full archive (gitignored;
//     absent in the Workers Builds checkout). Never a build input.
//
// The old no-build client (public/index.html + public/static/**) was the
// second exclusion until CRC deleted it; tests/vitest/dist-contract.spec.ts
// keeps its "static/** is not copied" pin as the tripwire against a
// resurrected public/static.
//
// What DOES ride into dist/: public/data/** (manifest + finder shards) and
// public/_headers — the pipeline's write targets, byte-identical (C5), pinned
// by tests/vitest/dist-contract.spec.ts.
//
// The build then APPENDS its own rules to the dist/ copy of _headers — one
// immutable rule per content-hashed asset, by name (buildAssetHeaders below,
// D-CRX-1) — so C5 reads "publisher block verbatim + build block appended";
// public/_headers itself is never touched.
/// <reference types="vitest/config" />
import { cp, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const PUBLIC_COPY_EXCLUDED = ['data-full']

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

// Long-lived cache-control for the build's content-hashed assets (CRX,
// D-CRX-1, a design decision, 2026-09-06). The host serves everything under dist/
// at the platform default `public, max-age=0, must-revalidate`, so a
// returning browser re-validates every chunk — a 304 with no body, ~75 ms per
// wave measured on production. Vite names each emitted file
// `assets/[name]-[hash][ext]`, so those names are immutable by construction
// and can be cached for a year — BY NAME, never as a `/assets/*` splat: a
// splat rule also stamps `immutable` on the SPA shell a MISSING name returns
// (CPH-M3, measured 2026-09-05), and the maplibre worker pair above is copied
// by name, not hashed, so it must keep re-validating. The rules go on the
// dist/ copy of the publisher's _headers, after cpPublicCopy has landed it
// (closeBundle is a parallel hook; `sequential` + `order: 'post'` makes this
// one wait for the others), leaving the publisher's block byte-identical —
// C5 now reads "publisher block verbatim + build block appended". A bundle
// file under assets/ WITHOUT a hash fails the build rather than getting a
// rule that would cache it forever. Pinned by tests/vitest/dist-contract.spec.ts.
const HASHED_ASSET = /^assets\/.+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/
const BUILD_HEADERS_MARK = '# Build assets (D-CRX-1)'

function buildAssetHeaders() {
    let emitted: string[] = []
    return {
        name: 'build-asset-headers',
        apply: 'build' as const,
        writeBundle(_options: unknown, bundle: Record<string, { fileName: string }>) {
            const files = Object.values(bundle)
                .map((output) => output.fileName)
                .filter((fileName) => fileName.startsWith('assets/'))
            const unhashed = files.filter((fileName) => !HASHED_ASSET.test(fileName))
            if (unhashed.length) {
                throw new Error(
                    'build-asset-headers: emitted under assets/ without a content hash — an '
                    + `immutable rule would cache it forever: ${unhashed.join(', ')}`,
                )
            }
            emitted = [...files].sort()
        },
        closeBundle: {
            order: 'post' as const,
            sequential: true,
            async handler() {
                const publisher = await readFile(resolve(import.meta.dirname, 'public/_headers'), 'utf8')
                const eol = publisher.includes('\r\n') ? '\r\n' : '\n'
                const block = [
                    '',
                    `${BUILD_HEADERS_MARK} — appended by vite.config.ts buildAssetHeaders: one rule per`,
                    '# content-hashed file this build emitted, by name, never a splat (a /assets/*',
                    '# rule would stamp immutable on the SPA shell a missing name returns, CPH-M3).',
                    '# The maplibre worker pair is copied by name, not hashed, and carries no rule.',
                    '# The publisher\'s block above is byte-identical to public/_headers (C5).',
                    ...emitted.flatMap((fileName) => [
                        '', `/${fileName}`, '\tCache-Control: public, max-age=31536000, immutable',
                    ]),
                ].join(eol) + eol
                await writeFile(resolve(import.meta.dirname, 'dist/_headers'), publisher + block)
            },
        },
    }
}

export default defineConfig({
    plugins: [react(), tailwindcss(), cpPublicCopy(), maplibreWorkerCopy(), buildAssetHeaders()],
    // Base-relative asset URLs (D-CR-EMBED-1, C7): the host's Food tab
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
            // >10 s first load and buys nothing (it changes via the ingest pipeline
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
        // names mean a vendor chunk's URL survives an app-only deploy, so a
        // returning browser's conditional GET for it is a 304 with no body
        // (measured on the preview host; the host answers hashed assets
        // `max-age=0, must-revalidate`, as production does the old client's
        // /static/** — a long-lived rule for /assets/* is a follow-on, by
        // name and never a splat, per CPH-M3). maplibre's runtime worker URL
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
