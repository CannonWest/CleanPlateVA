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

export default defineConfig({
    plugins: [react(), tailwindcss(), cpPublicCopy()],
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
    },
    test: {
        include: ['app/**/*.spec.{ts,tsx}', 'tests/vitest/**/*.spec.{ts,tsx}'],
    },
})
