import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboardSource as dashboard } from './support/dashboard.mjs';

const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');

test('the list yields flex space to the selected-facility panel', () => {
    const rule = css.match(/\.food-list-wrap\s*\{([^}]*)\}/)?.[1] || '';

    assert.match(rule, /flex-basis:\s*0\s*;/);
    assert.match(rule, /min-width:\s*0\s*;/);
    assert.match(rule, /overflow:\s*auto\s*;/);
});

test('VDH table links are icon-only and retain accessible names', () => {
    const link = dashboard.match(
        /<a class="food-list-vdh-link"[\s\S]*?<\/a>/,
    )?.[0] || '';

    assert.match(link, /aria-label="View \$\{esc\(f\.name\)\} on VDH"/);
    assert.match(link, /title="View \$\{esc\(f\.name\)\} on VDH"/);
    assert.match(link, /<i class="bi bi-box-arrow-up-right"/);
    assert.doesNotMatch(link, />View on VDH\s*</);
});
