/**
 * Page bootstrap: theme handling + a thin API client + the dashboard.
 */

import { FoodDashboard } from './foodDashboard.js';

const THEME_KEY = 'cleanplateva.theme';

// ── API client ──────────────────────────────────────────────────────────

const api = {
    /** The full mapped facility roster for the map view. */
    async getFoodFacilities(forceRefresh = false) {
        const qs = forceRefresh ? '?refresh=1' : '';
        try {
            const response = await fetch(`/api/food/facilities${qs}`);
            const data = await response.json();
            return { ...data, _httpStatus: response.status };
        } catch (error) {
            console.error('[api] Failed to get facilities:', error);
            return { available: false, error: error.message };
        }
    },

    /** One facility + its full inspection history. mergeIDs: re-issued
     *  permit ids the roster merge folded into this marker — the server
     *  re-validates them, then unions their inspections in. */
    async getFoodFacilityDetail(permitID, mergeIDs = []) {
        const params = new URLSearchParams({ permitID });
        if (mergeIDs && mergeIDs.length) params.set('merge', mergeIDs.join(','));
        try {
            const response = await fetch(`/api/food/facility?${params.toString()}`);
            const data = await response.json();
            return { ...data, _httpStatus: response.status };
        } catch (error) {
            console.error('[api] Failed to get facility detail:', error);
            return { available: false, error: error.message };
        }
    },
};

// ── theme ───────────────────────────────────────────────────────────────
// Dark is the default. The body class drives the dashboard's basemap swap
// (it watches for class changes); data-bs-theme drives Bootstrap's own
// form-control / button styling.

function applyTheme(dark) {
    document.body.classList.toggle('theme-dark', dark);
    document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    const icon = document.querySelector('#themeToggle i');
    if (icon) icon.className = dark ? 'bi bi-sun' : 'bi bi-moon';
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

// ── boot ────────────────────────────────────────────────────────────────

initTheme();
const dashboard = new FoodDashboard(api);
dashboard.init();
dashboard.load();

// Console handle for debugging.
window.cleanplateva = dashboard;
