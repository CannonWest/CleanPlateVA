/**
 * Page bootstrap: theme handling + a thin API client + the dashboard.
 */

import { FoodDashboard } from './foodDashboard.js';

const THEME_KEY = 'cleanplateva.theme';

// ── data client ─────────────────────────────────────────────────────────
// The site is fully static: the data pipeline publishes JSON snapshots
// under /data/, and the page just fetches them. Facility detail files are
// pre-merged at export time (re-issued permits already folded in), so no
// query parameters are needed.

async function fetchJSON(path, forceRefresh) {
    try {
        const response = await fetch(path, forceRefresh ? { cache: 'reload' } : undefined);
        if (!response.ok) {
            return {
                available: false,
                reason: response.status === 404 ? 'no data published yet' : `HTTP ${response.status}`,
                _httpStatus: response.status,
            };
        }
        const data = await response.json();
        return { ...data, _httpStatus: response.status };
    } catch (error) {
        console.error(`[data] Failed to fetch ${path}:`, error);
        return { available: false, error: error.message };
    }
}

// ── checklist decoding (data-contract v1) ───────────────────────────────
// Detail files carry the food-code checklist compacted: each row is
// [item, disposition, flags(, override)] with flags a bitmask
// (1 compliant | 2 violation | 4 cos | 8 repeat | 16 sentinel), and the
// per-item category/standard text factored out into data/standards.json.
// Decoding expands rows back to the object shape the renderers expect.
// An override ({c, t}) carries the rare row whose text differs from the
// shared vocabulary.

let standardsPromise = null;
function getStandards() {
    if (!standardsPromise) {
        standardsPromise = fetch('data/standards.json')
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}));
    }
    return standardsPromise;
}

function decodeChecklist(rows, standards) {
    if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) return rows;
    return rows.map(([item, disposition, flags, override]) => {
        const std = (item != null && standards[String(item)]) || {};
        return {
            item,
            disposition,
            category: override?.c ?? std.category ?? '',
            standard_text: override?.t ?? std.text ?? '',
            compliant: !!(flags & 1),
            violation: !!(flags & 2),
            cos: !!(flags & 4),
            repeat: !!(flags & 8),
            is_sentinel: !!(flags & 16),
        };
    });
}

const api = {
    /** The full mapped facility roster for the map view. */
    getFoodFacilities(forceRefresh = false) {
        return fetchJSON('data/facilities.json', forceRefresh);
    },

    /** One facility + its full (pre-merged) inspection history. */
    async getFoodFacilityDetail(permitID) {
        const [data, standards] = await Promise.all([
            fetchJSON(`data/facility/${encodeURIComponent(permitID)}.json`),
            getStandards(),
        ]);
        if (data && data.available && Array.isArray(data.inspections)) {
            for (const insp of data.inspections) {
                insp.checklist = decodeChecklist(insp.checklist, standards);
            }
        }
        return data;
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
