/**
 * Shared vocabulary for the CR client (CRF-M1) — the subset of the old
 * `static/js/constants.js` the ported data layer and the proof boot actually
 * read. View-layer constants (splitter geometry, hit slop, cluster radii)
 * arrive with the surfaces that use them (CRV).
 */

export const RESTAURANTS_ONLY_KEY = 'cleanplateva.food.restaurantsOnly'
export const SHOW_CLOSED_KEY = 'cleanplateva.food.showClosed'
export const SHOW_NEW_KEY = 'cleanplateva.food.showNew'
export const SHOW_MOBILE_KEY = 'cleanplateva.food.showMobile'

// List load-more (D-DATA-11): rows revealed per chunk; `?page=N` = N chunks.
export const LIST_PAGE_SIZE = 50

export const PORTAL_BASE = 'https://inspections.myhealthdepartment.com'
// The `virginia` aggregate: correct only for facilities no district claimed.
export const AGGREGATE_TENANT = 'virginia'

// Grade palette — data color, not chrome (chrome themes via the Tailwind
// tokens). The RATIFIED ramp (design ref §6.0, CRD-M1 2026-08-29): only F
// moved from the live site (#e03131 → #a61e1e, fixing the D↔F normal-vision
// failure); the letter always rides the color.
export const GRADE_COLORS: Record<string, string> = {
    A: '#2f9e44',
    B: '#94be1b',
    C: '#f59f00',
    D: '#e8590c',
    F: '#a61e1e',
    none: '#868e96',
}

// Newly permitted: cleared to open, grade still to come. Blue is NEW's alone.
export const NEW_COLOR = '#1c7ed6'

export const LITE_MARKER_COLOR = '#8d939c' // basic map: uniform, judgment-free
export const CLOSED_COLOR = '#9aa0a6'      // not a live permit

// CARTO vector basemaps (attribution rides in the style's sources).
export const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
export const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// dark-matter ships its trunk/motorway road labels at 1.7:1 against its own
// background (CARTO defect, one layer); #d8d8d8 measures 13.5:1. See the old
// constants.js for the full measurement note.
export const DARK_MAJOR_ROAD_LABEL_LAYER = 'roadname_major'
export const DARK_MAJOR_ROAD_LABEL_COLOR = '#d8d8d8'

// Map home: the whole state via fitBounds. [[west, south], [east, north]].
export const VA_BOUNDS: [[number, number], [number, number]] =
    [[-83.7, 36.5], [-75.2, 39.5]]
export const VA_FIT = { padding: 20 }

// MapLibre source + layer ids (data layers re-added on every style swap).
export const SRC = 'food-facilities'
export const LYR_POINTS = 'food-points'

// Highest form item that counts as a foodborne-illness risk factor
// (cf_lib.RISK_FACTOR_MAX_ITEM). Shared by count chips and receipt math.
export const RF_MAX_ITEM = 29
