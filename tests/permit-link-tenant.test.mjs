/** The facility PERMIT link is tenant-scoped — just like each inspection's.
 *
 *  VDH renders every health district under its own path, and a facility a
 *  district CLAIMED is absent from the `virginia` aggregate. Linking a claimed
 *  facility to /virginia/permit/ lands on a stale husk: Golden Unicorn
 *  (23294, va-henrico) showed its inspections routing correctly to
 *  /va-henrico/ while the panel's "Source" button went to the aggregate, whose
 *  copy of the permit still read "Pending" against a district roster that said
 *  "Permitted" — which is also what fired the drift warning under the address.
 *
 *  The exporter publishes `tenant` on marker, lite, and detail records
 *  (cf_export_site._link_tenant); every permit link routes through permitUrl.
 *  A hardcoded tenant anywhere in the source is the regression this guards.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboard, dashboardSource as source } from './support/dashboard.mjs';

const { permitUrl } = dashboard;

test('routes to the district that claimed the permit', () => {
    assert.equal(
        permitUrl({ permit_id: 'P-1', tenant: 'va-henrico' }),
        'https://inspections.myhealthdepartment.com/va-henrico/permit/?permitID=P-1',
    );
});

test('an aggregate-tenant facility still goes to virginia', () => {
    assert.match(permitUrl({ permit_id: 'P-2', tenant: 'virginia' }),
        /\/virginia\/permit\/\?permitID=P-2$/);
});

test('a pre-tenant payload degrades to the aggregate, never a broken link', () => {
    // Old data-full files cached in a browser predate the field; the link must
    // keep working (the old behaviour) rather than emit /undefined/.
    assert.match(permitUrl({ permit_id: 'P-3' }), /\/virginia\/permit\//);
    assert.doesNotMatch(permitUrl({ permit_id: 'P-3' }), /undefined|null/);
});

test('an explicit tenant overrides the record — merged_from has none of its own', () => {
    // A re-permit group shares one address, so the SURVIVING facility's
    // district fixes the path for every earlier permit listed under it.
    assert.match(permitUrl({ permit_id: 'OLD-1' }, 'va-chesterfield'),
        /\/va-chesterfield\/permit\/\?permitID=OLD-1$/);
});

test('both components are URL-encoded', () => {
    const url = permitUrl({ permit_id: 'a b&c=d' }, 'va-x/y');
    assert.match(url, /\/va-x%2Fy\/permit\/\?permitID=a%20b%26c%3Dd$/);
});

test('a missing permit_id yields an empty id, not the string "undefined"', () => {
    assert.match(permitUrl({ tenant: 'va-henrico' }), /permitID=$/);
});

test('no permit link in the source hardcodes a tenant path', () => {
    // Every facility-level VDH link must go through permitUrl. A literal
    // ".../virginia/permit/" in a template is the bug this file exists for.
    const offenders = [...source.matchAll(/myhealthdepartment\.com\/[a-z-]+\//g)]
        .map((m) => m[0])
        // The PORTAL_BASE constant + permitUrl's own template are the one
        // sanctioned place a path is assembled.
        .filter((hit) => !hit.endsWith('.com/'));
    assert.deepEqual(offenders, [],
        `hardcoded tenant path(s) found: ${offenders.join(', ')} — use permitUrl()`);
});
