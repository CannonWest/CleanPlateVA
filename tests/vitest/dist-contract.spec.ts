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

if (!built) {
    test('dist-contract needs a build', () => {
        console.warn('[dist-contract] dist/ absent — run `npm run build` first; CI always builds.')
        expect(built).toBe(false)
    })
}
