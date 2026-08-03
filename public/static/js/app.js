/**
 * Page bootstrap: theme handling + a thin API client + the dashboard.
 */

import { FoodDashboard } from './foodDashboard.js';

const THEME_KEY = 'cleanplateva.theme';

// Dev/preview override: ?tier=lite forces the public lite payload even when
// the full channel is reachable (e.g. data-full/ on disk in a local checkout,
// or a signed-in visitor in production). Used by the CannonAI Food tab —
// which embeds this checkout as a dev copy — to preview exactly what
// anonymous visitors see. Harmless to expose: lite is already the anonymous
// floor, so forcing it never reveals anything. The sign-in CTA is hidden
// under the override (styled off this body class) because signing in cannot
// change a forced tier.
const FORCE_LITE = new URLSearchParams(window.location.search).get('tier') === 'lite';

// ── data client ─────────────────────────────────────────────────────────
// The browser client is static and consumes two prepared-data tiers:
//   FULL  — /data-full/* — the complete inspection archive (scores, grades,
//           violations, history). Served from a private, authenticated
//           channel; anonymous visitors can't reach it.
//   LITE  — /data/facilities.json — the 12-field public finder payload
//           committed to this repo: identity, location, district-scoped VDH
//           routing, restaurant/approximation flags, and mobile-unit identity.
// The page tries the full channel first and falls back to lite, so the
// same deploy serves both audiences. Detail files exist only in the full
// tier and are pre-merged at export time.

const FULL_BASE = 'data-full';

async function fetchJSON(path, quiet = false) {
    try {
        const response = await fetch(path);
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
        if (!quiet) console.error(`[data] Failed to fetch ${path}:`, error);
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
        standardsPromise = fetch(`${FULL_BASE}/standards.json`)
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
    /** The facility roster: full channel first, public lite as fallback.
     *  ?tier=lite skips the full channel outright (see FORCE_LITE). */
    async getFoodFacilities() {
        if (!FORCE_LITE) {
            const full = await fetchJSON(`${FULL_BASE}/facilities.json`, true);
            if (full && full.available) return full;
        }
        return fetchJSON('data/facilities.json');
    },

    /** One facility + its full (pre-merged) inspection history.
     *  Full-channel only — the lite tier renders details client-side. */
    async getFoodFacilityDetail(permitID) {
        const [data, standards] = await Promise.all([
            fetchJSON(`${FULL_BASE}/facility/${encodeURIComponent(permitID)}.json`),
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
    // The toggle is a two-icon switch; the sliding thumb is pure CSS keyed
    // off body.theme-dark — only the switch semantics need updating here.
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

// ── boot ────────────────────────────────────────────────────────────────

initTheme();
if (FORCE_LITE) document.body.classList.add('tier-forced-lite');
const dashboard = new FoodDashboard(api);
dashboard.init();
dashboard.load();

// Console handle for debugging.
window.cleanplateva = dashboard;
