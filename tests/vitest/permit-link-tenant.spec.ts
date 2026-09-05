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
import { isActivePermit, isFairfax, permitUrl, sourceDepartment } from '../../app/data/presentation'

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

test('a Fairfax Health District facility links to the county, never a portal path (FFX-M4)', () => {
    // The county runs its own program: no MyHealthDepartment page exists for
    // it, and without an `ffx_oid` (a row published before the key, or a
    // merged-in predecessor) the facility link is the county's
    // inspection-reports search (each report links itself).
    assert.equal(permitUrl({ permit_id: 'HFOOD-000010912', tenant: 'fairfax' }),
        'https://www.fairfaxcounty.gov/health/food/inspection-reports')
    assert.doesNotMatch(permitUrl({ permit_id: 'HFOOD-000010912', tenant: 'fairfax' }),
        /myhealthdepartment/)
    // the explicit-tenant form (merged_from) routes the same way
    assert.match(permitUrl({ permit_id: 'HFOOD-000000001' }, 'fairfax'), /fairfaxcounty\.gov/)
    assert.equal(isFairfax({ permit_id: 'X', tenant: 'fairfax' }), true)
    assert.equal(isFairfax({ permit_id: 'X', tenant: 'va-henrico' }), false)
    assert.equal(sourceDepartment({ tenant: 'fairfax' }).name, 'Fairfax County Health Department')
    assert.equal(sourceDepartment({ tenant: 'va-henrico' }).name, 'Virginia Department of Health')
})

test('a Fairfax row with ffx_oid deep-links into the county map; without one, the search page', () => {
    // The county's Experience map selects a facility by its layer OBJECTID
    // (`#data_s=id:<source>:<oid>`) — verified against the county's own links
    // for ANDYS PIZZA (42459) and DOMINION EATS (335393) on 2026-09-05.
    assert.equal(permitUrl({ permit_id: 'HFOOD-000039484', tenant: 'fairfax', ffx_oid: 42459 }),
        'https://experience.arcgis.com/experience/0e687ef56da44ef287d20ced8cc85a3f/page/Main-Page'
        + '#data_s=id%3AdataSource_5-17e77d67cec-layer-3%3A42459')
    // null (every VDH row carries null; a county row published before the key
    // lacks it) and a merged_from entry (no oid of its own) fall back.
    assert.equal(permitUrl({ permit_id: 'HFOOD-000039484', tenant: 'fairfax', ffx_oid: null }),
        'https://www.fairfaxcounty.gov/health/food/inspection-reports')
    assert.equal(permitUrl({ permit_id: 'HFOOD-000000001' }, 'fairfax'),
        'https://www.fairfaxcounty.gov/health/food/inspection-reports')
    // a VDH row ignores the field entirely
    assert.match(permitUrl({ permit_id: 'P-1', tenant: 'va-henrico', ffx_oid: null }),
        /\/va-henrico\/permit\/\?permitID=P-1$/)
})

test('Active is a live permit; Inactive is not (FFX-M4)', () => {
    for (const status of ['Permitted', 'Active', ' active ']) {
        assert.equal(isActivePermit({ permit_id: 'X', status }), true, status)
    }
    for (const status of ['Expired', 'Inactive', 'Business Closed', 'Pending']) {
        assert.equal(isActivePermit({ permit_id: 'X', status }), false, status)
    }
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
