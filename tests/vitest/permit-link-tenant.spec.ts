/** The facility PERMIT link is tenant-scoped (P8) — ports
 *  `tests/permit-link-tenant.test.mjs` against `app/data/presentation.ts`.
 *  A facility a district CLAIMED is absent from the `virginia` aggregate
 *  (Golden Unicorn read "Pending" there while va-henrico said "Permitted"),
 *  so every permit link routes through permitUrl. The source grep adapts to
 *  the NEW tree: a hardcoded tenant path anywhere under app/ is the
 *  regression this file exists for.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'vitest'
import { permitUrl } from '../../app/data/presentation'

test('routes to the district that claimed the permit', () => {
    assert.equal(
        permitUrl({ permit_id: 'P-1', tenant: 'va-henrico' }),
        'https://inspections.myhealthdepartment.com/va-henrico/permit/?permitID=P-1',
    )
})

test('an aggregate-tenant facility still goes to virginia', () => {
    assert.match(permitUrl({ permit_id: 'P-2', tenant: 'virginia' }),
        /\/virginia\/permit\/\?permitID=P-2$/)
})

test('a pre-tenant payload degrades to the aggregate, never a broken link', () => {
    assert.match(permitUrl({ permit_id: 'P-3' }), /\/virginia\/permit\//)
    assert.doesNotMatch(permitUrl({ permit_id: 'P-3' }), /undefined|null/)
})

test('an explicit tenant overrides the record — merged_from has none of its own', () => {
    assert.match(permitUrl({ permit_id: 'OLD-1' }, 'va-chesterfield'),
        /\/va-chesterfield\/permit\/\?permitID=OLD-1$/)
})

test('both components are URL-encoded', () => {
    const url = permitUrl({ permit_id: 'a b&c=d' }, 'va-x/y')
    assert.match(url, /\/va-x%2Fy\/permit\/\?permitID=a%20b%26c%3Dd$/)
})

test('a missing permit_id yields an empty id, not the string "undefined"', () => {
    assert.match(permitUrl({ tenant: 'va-henrico' }), /permitID=$/)
})

test('no permit link in the CR source hardcodes a tenant path', () => {
    // Every facility-level VDH link must go through permitUrl. A literal
    // ".../virginia/permit/" in a component is the bug this file guards.
    const appDir = resolve(import.meta.dirname, '..', '..', 'app')
    const sources: string[] = []
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name)
            if (statSync(path).isDirectory()) walk(path)
            else if (/\.(ts|tsx|css)$/.test(name)) sources.push(readFileSync(path, 'utf8'))
        }
    }
    walk(appDir)
    const offenders = sources.flatMap((source) =>
        [...source.matchAll(/myhealthdepartment\.com\/[a-z-]+\//g)].map((m) => m[0]))
        // PORTAL_BASE + permitUrl's own template are the one sanctioned
        // place a path is assembled (they end at `.com/`).
        .filter((hit) => !hit.endsWith('.com/'))
    assert.deepEqual(offenders, [],
        `hardcoded tenant path(s) found: ${offenders.join(', ')} — use permitUrl()`)
})
