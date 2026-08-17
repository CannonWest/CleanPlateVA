/** Page bootstrap: theme handling + prepared-data client + dashboard. */

import { FoodDashboard } from './foodDashboard.js';
import { createFoodApi } from './dataClient.js';
import { createAckState } from './ack.js';

const THEME_KEY = 'cleanplateva.theme';

// Dev/preview override: ?tier=lite forces the basic map even when the full
// channel is reachable and the terms are acknowledged. It can only reduce
// access, and it asks no acknowledgement (D-ACK-3).
const FORCE_LITE = new URLSearchParams(window.location.search).get('tier') === 'lite';

// The visitor's answer to the Terms of Use and Data Acknowledgment — one
// versioned localStorage key (ack.js). Shared by the data client's gate and
// the dashboard's dialog, so a decision made after boot governs the next load.
const ack = createAckState(window.localStorage);

// Both tiers require their manifest-led Contract V4 shapes. The full tier is
// fetched only after the acknowledgement; a failed or gated full read degrades
// only to the public V4 finder, never to an older contract.
const api = createFoodApi({ forceLite: FORCE_LITE, isAcknowledged: () => ack.agreed });

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
const dashboard = new FoodDashboard(api, { ack, forceLite: FORCE_LITE });
dashboard.init();
// First visit: the basemap renders and the terms dialog blocks until the
// visitor answers — no data is fetched before then (D-ACK-1). Any later
// visit, or ?tier=lite, loads straight away on the remembered answer.
dashboard.load();

// Console handle for debugging.
window.cleanplateva = dashboard;
