// CRF-M0 build-output contract (design ref §3, C5) — the pipeline pin.
//
// The publisher (cannon-food) writes public/data/** and public/_headers and
// never learns the front-end changed: whatever the build does, those files
// must reach dist/ byte-identical, and the entries the build excludes
// (data-full/**, the old client's index.html + static/**) must NOT.
// dist/index.html must be the built app entry, not the old shell.
//
// Runs against dist/ and SKIPS when there is no build — CI builds before
// testing (npm ci && npx vite build, the Workers Builds command), so the
// contract is always enforced there; locally run `npm run build` first.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')
const DIST = resolve(ROOT, 'dist')
const PUBLIC = resolve(ROOT, 'public')

const built = existsSync(DIST)

function sameBytes(relPath: string) {
    const source = readFileSync(resolve(PUBLIC, relPath))
    const copy = readFileSync(resolve(DIST, relPath))
    expect(copy.equals(source), `${relPath} must reach dist/ byte-identical`).toBe(true)
}

describe.skipIf(!built)('dist/ carries the publisher channel verbatim (C5)', () => {
    test('_headers reaches dist/ byte-identical', () => {
        sameBytes('_headers')
    })

    test('data/manifest.json reaches dist/ byte-identical', () => {
        sameBytes('data/manifest.json')
    })

    test('every committed finder shard reaches dist/ byte-identical', () => {
        const shards = readdirSync(resolve(PUBLIC, 'data', 'finder'))
            .filter((name) => name.endsWith('.json'))
        expect(shards.length).toBeGreaterThan(0)
        for (const name of shards) sameBytes(`data/finder/${name}`)
    })
})

describe.skipIf(!built)('dist/ excludes what the build must ignore (§3)', () => {
    test('data-full/** never rides into the build', () => {
        expect(existsSync(resolve(DIST, 'data-full'))).toBe(false)
    })

    test('the old client (static/**) is not copied', () => {
        expect(existsSync(resolve(DIST, 'static'))).toBe(false)
    })

    test('dist/index.html is the built app entry, not the old shell', () => {
        const html = readFileSync(resolve(DIST, 'index.html'), 'utf8')
        expect(html).toContain('<script type="module"')
        // The old no-build shell boots static/js/app.js and loads Bootstrap
        // from jsDelivr; neither may appear in the built entry.
        expect(html).not.toContain('static/js/app.js')
        expect(html).not.toContain('cdn.jsdelivr.net')
    })
})

describe.skipIf(!built)('dist/ ships the app shell complete', () => {
    // maplibre-gl resolves `maplibre-gl-worker.mjs` against its chunk's URL
    // at runtime, and the worker imports `./maplibre-gl-shared.mjs` from
    // beside itself (vite.config.ts maplibreWorkerCopy); either absent, the
    // SPA fallback answers the request with HTML and the map never loads
    // (measured on the preview host, 2026-08-30).
    for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        test(`${name} rides beside the main chunk`, () => {
            expect(existsSync(resolve(DIST, 'assets', name))).toBe(true)
        })
    }

    // The brand mark is IMPORTED by Toolbar.tsx rather than referenced at
    // public/static/img/... — that tree is the retired client and never
    // reaches dist/ (above), so a path reference renders a broken image
    // against the SPA fallback (measured on next.cleanplateva.com: the
    // logo request answered 200 text/html).
    test('the brand mark ships as a built asset', () => {
        const assets = readdirSync(resolve(DIST, 'assets'))
        const logo = assets.filter((name) => /^clean-plate-va-logo-.*\.png$/.test(name))
        expect(logo.length, `expected a hashed logo in dist/assets, saw: ${assets.join(', ')}`)
            .toBe(1)
    })
})

describe('the app never reaches into the retired client (§3)', () => {
    // Source-level companion to the dist checks above: catches a
    // reintroduced /static/... reference at edit time, with no build. An
    // absolute path would also break the CannonAI Food tab, which mounts
    // this build under /cleanplate/ behind a rewritten <base href>.
    // Anchored to a quote so it matches the defect's shape -- a string or
    // JSX attribute beginning "/static/" -- and not prose in a comment that
    // merely names the path (this file and Toolbar.tsx both do).
    const STATIC_REF = /['"`]\/static\//

    test('no app/ source references /static/ in a string', () => {
        const appDir = resolve(ROOT, 'app')
        const sources = readdirSync(appDir, { recursive: true, encoding: 'utf8' })
            .filter((name) => /\.tsx?$/.test(name))
        expect(sources.length).toBeGreaterThan(0)

        const offenders = sources.filter((name) =>
            STATIC_REF.test(readFileSync(resolve(appDir, name), 'utf8')),
        )
        expect(offenders, `import the asset instead: ${offenders.join(', ')}`).toEqual([])
    })
})

if (!built) {
    test('dist-contract needs a build', () => {
        console.warn('[dist-contract] dist/ absent — run `npm run build` first; CI always builds.')
        expect(built).toBe(false)
    })
}
