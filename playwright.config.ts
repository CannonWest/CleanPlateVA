/**
 * The e2e smoke's runner (design ref §7, "the paint proof"): Playwright over
 * the PRODUCTION build — `vite preview` serving `dist/`, so the request the
 * bundler never sees (maplibre's runtime `new URL('maplibre-gl-worker.mjs')`,
 * vite.config.ts) is answered by the file the build copied, exactly as the
 * host answers it. Nothing here runs against the dev server on purpose: dev
 * serves maplibre's native ESM out of node_modules and never hits the
 * failure this layer exists to catch.
 *
 * `dist/` must exist — `npm run test:e2e` builds first; CI runs the build
 * step of tests.yml and then `npx playwright test` bare.
 *
 * Two workers, not more (2026-09-13): `fullyParallel: false` hands whole
 * FILES to workers, so wall time floors at the biggest file regardless of
 * worker count — going to 4 buys nothing over 2 at today's suite shape
 * (map-edit.spec.ts alone runs 72.5s of its 10 tests) and doubles SwiftShader
 * (software GL) contention, which is exactly the false-signal risk the
 * original single-worker choice (2026-09-07, written for a 2-test smoke) was
 * protecting against. Re-measure if the suite's per-file shape changes.
 *
 * No retries: a flake here is information about the map, not noise to
 * average away.
 */
import { defineConfig, devices } from '@playwright/test'

export const PREVIEW_ORIGIN = 'http://127.0.0.1:4173'

export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: false,
    workers: 2,
    retries: 0,
    // A cold map load: the CARTO style, its glyphs, the roster shards, then
    // the worker's first tiles — under a software GL in CI.
    timeout: 90_000,
    expect: { timeout: 60_000 },
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    outputDir: 'test-results',
    use: {
        baseURL: PREVIEW_ORIGIN,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // The runner has no GPU: WebGL through SwiftShader (ANGLE's software
        // backend), which newer Chromium blocks unless asked for by name.
        launchOptions: {
            args: [
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader',
                '--ignore-gpu-blocklist',
            ],
        },
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
        url: `${PREVIEW_ORIGIN}/`,
        reuseExistingServer: false,
        timeout: 30_000,
    },
})
