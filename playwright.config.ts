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
 * One worker, no retries: a flake here is information about the map, not
 * noise to average away.
 */
import { defineConfig, devices } from '@playwright/test'

export const PREVIEW_ORIGIN = 'http://127.0.0.1:4173'

export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: false,
    workers: 1,
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
