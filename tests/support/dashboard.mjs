/**
 * The dashboard under test, after the CPR-M1a module split.
 *
 * `dashboard` is the real module graph — foodDashboard.js re-exports the pure
 * helpers, so the surface the suites destructure is unchanged from the
 * monolith. `dashboardSource` is every dashboard module's source text
 * concatenated in dependency order: the source-text assertions across the
 * suites keep asking "does the dashboard code contain X", exactly as they did
 * against the single file. `moduleSource(name)` reads one module when a test
 * wants to pin WHERE something lives.
 *
 * Not a test file (node --test only collects *.test.mjs).
 */
import { readFileSync } from 'node:fs';

export * as dashboard from '../../public/static/js/foodDashboard.js';

export const DASHBOARD_MODULES = [
    'constants.js',
    'stacks.js',
    'presentation.js',
    'receipt.js',
    'map.js',
    'markers.js',
    'hover.js',
    'filters.js',
    'list.js',
    'about.js',
    'detail.js',
    'sparkline.js',
    'inspection.js',
    'foodDashboard.js',
];

const jsDir = new URL('../../public/static/js/', import.meta.url);

export function moduleSource(name) {
    return readFileSync(new URL(name, jsDir), 'utf8');
}

export const dashboardSource = DASHBOARD_MODULES.map(moduleSource).join('\n');
