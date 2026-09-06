// The site icons (2026-09-06) — the shell's links, the emitted files, and
// the frames inside the .ico.
//
// Before these existed the assets layer answered /favicon.ico with the SPA
// shell (200 text/html, measured on production 2026-09-06) and every tab
// showed the generic globe. The failure is silent — an icon that 404s or
// arrives as HTML looks exactly like an icon nobody set — so the pins below
// check the bytes, not just the presence of a link tag.
//
// tools/make_favicon.py renders both files from app/clean-plate-va-logo.png.
// Nothing in the build regenerates them; re-run it after a mark change.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')
const DIST = resolve(ROOT, 'dist')
const PUBLIC = resolve(ROOT, 'public')
const built = existsSync(DIST)

const shell = () => readFileSync(resolve(ROOT, 'index.html'), 'utf8')

describe('the shell links its icons (source)', () => {
    test('a favicon and an apple-touch icon are linked', () => {
        expect(shell()).toMatch(/<link\s+rel="icon"\s+href="\.\/favicon\.ico"/)
        expect(shell()).toMatch(/<link\s+rel="apple-touch-icon"\s+href="\.\/apple-touch-icon\.png"/)
    })

    // Same rule the /static/ pin enforces for app sources: the CannonAI Food
    // tab mounts this build under /cleanplate/ behind a rewritten <base
    // href>, so an absolute href would point at the host's root instead of
    // the mount. Anchored to the attribute so the prose above (which names
    // "/favicon.ico" as the path the fallback used to swallow) does not match.
    test('the hrefs are relative, so they follow the <base> the mount rewrites', () => {
        expect(shell()).not.toMatch(/href="\/(favicon\.ico|apple-touch-icon\.png)"/)
    })

    test('the links resolve through <base>, so they follow it in the document', () => {
        const html = shell()
        expect(html.indexOf('<base href=')).toBeLessThan(html.indexOf('rel="icon"'))
    })
})

describe('the icons are real images', () => {
    test('favicon.ico carries 16, 32 and 48 px frames', () => {
        const ico = readFileSync(resolve(PUBLIC, 'favicon.ico'))
        // ICONDIR: reserved u16 = 0, type u16 = 1 (icon), count u16. Then one
        // 16-byte ICONDIRENTRY per frame, whose width/height are single bytes
        // (0 meaning 256). A shell served in its place fails at the type.
        expect(ico.readUInt16LE(0), 'not an ICO (reserved word)').toBe(0)
        expect(ico.readUInt16LE(2), 'not an ICO (type word)').toBe(1)
        const count = ico.readUInt16LE(4)
        const frames = Array.from({ length: count }, (_, i) => {
            const at = 6 + i * 16
            return `${ico[at] || 256}x${ico[at + 1] || 256}`
        }).sort()
        expect(frames).toEqual(['16x16', '32x32', '48x48'])
    })

    test('apple-touch-icon.png is a 180 px PNG with no transparent corner', () => {
        const png = readFileSync(resolve(PUBLIC, 'apple-touch-icon.png'))
        expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
            'not a PNG').toBe(true)
        // IHDR is the first chunk: length u32, "IHDR", width u32, height u32.
        expect(png.toString('ascii', 12, 16)).toBe('IHDR')
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180])
        // iOS masks its own squircle and composites transparency onto black,
        // so this one must be full-bleed opaque or it gains black corners.
        expect(png.length).toBeGreaterThan(1000)
    })
})

describe.skipIf(!built)('the icons reach dist/ at their stable names', () => {
    // They ship from public/ precisely so the names stay predictable: a
    // browser probes /favicon.ico bare and iOS probes /apple-touch-icon.png
    // bare, and neither would find a content-hashed dist/assets/ name.
    for (const name of ['favicon.ico', 'apple-touch-icon.png']) {
        test(`${name} is copied byte-identical`, () => {
            const source = readFileSync(resolve(PUBLIC, name))
            const copy = readFileSync(resolve(DIST, name))
            expect(copy.equals(source), `${name} must reach dist/ byte-identical`).toBe(true)
        })
    }

    test('the built shell still links them', () => {
        const html = readFileSync(resolve(DIST, 'index.html'), 'utf8')
        expect(html).toContain('favicon.ico')
        expect(html).toContain('apple-touch-icon.png')
    })
})
