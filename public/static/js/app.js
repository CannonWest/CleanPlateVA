/** Page bootstrap: theme handling + prepared-data client + dashboard. */

import { FoodDashboard } from './foodDashboard.js';
import { createFoodApi } from './dataClient.js';

const THEME_KEY = 'cleanplateva.theme';

// Dev/preview override: ?tier=lite forces the public finder even when the
// authenticated full channel is reachable. It can only reduce access.
const FORCE_LITE = new URLSearchParams(window.location.search).get('tier') === 'lite';

// Contract V2 is manifest-led and sharded; dataClient keeps V1 full/public
// fallbacks so a deploy stays usable throughout the publication transition.
const api = createFoodApi({ forceLite: FORCE_LITE });

function applyTheme(dark) {
    document.body.classList.toggle('theme-dark', dark);
    document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    document.getElementById('themeToggle')?.setAttribute('aria-checked', String(dark));
}

function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    applyTheme(stored ? stored === 'dark' : true);
    document.getElementById('themeToggle')?.addEventListener('click', () => {
        const dark = !document.body.classList.contains('theme-dark');
        try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (_) { /* private mode */ }
        applyTheme(dark);
    });
}

initTheme();
if (FORCE_LITE) document.body.classList.add('tier-forced-lite');
const dashboard = new FoodDashboard(api);
dashboard.init();
dashboard.load();

// Console handle for debugging.
window.cleanplateva = dashboard;
