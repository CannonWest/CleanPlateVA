/**
 * Shared vocabulary for the CR client (CRF-M1; view-layer rows CRVa-M0) —
 * the subset of the old `static/js/constants.js` the ported data layer and
 * the map surface actually read. The redesigned map draws NO proximity
 * clusters (ratified mockup: dots at every zoom; only same-point stacks
 * bubble), so the old cluster radii/steps stay retired with `map.js`.
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

// The visitor's persisted theme (dark is the document default, C10).
export const THEME_KEY = 'cleanplateva.theme'

// MapLibre source + layer ids (data layers re-added on every style swap).
export const SRC = 'food-facilities'
export const LYR_CLUSTERS = 'food-clusters'
export const LYR_CLUSTER_COUNT = 'food-cluster-count'
export const LYR_POINTS = 'food-points'
export const LYR_POINT_LETTERS = 'food-point-letters'
export const LYR_DECLINING = 'food-declining-rings'
export const LYR_STACKS = 'food-stacks'
export const LYR_STACK_COUNT = 'food-stack-count'

// ── marker geometry (§6.2 grammar) ─────────────────────────────────────
// Dots grow with zoom; past LETTER_ZOOM they are large enough to carry
// their grade letter (the ratified mockup's 21px marker ≈ radius 10.5).
// [zoom, radius] pairs feed one linear interpolate expression shared by
// the circle layer and the declining-ring icon-size, so the dashed ring
// tracks the dot it warns about at every zoom.
export const POINT_RADIUS_FULL = 10.5 // the z14, letter-carrying dot
export const POINT_RADIUS_STOPS: ReadonlyArray<readonly [number, number]> =
    [[5, 3.5], [9, 4.5], [12, 6], [14, POINT_RADIUS_FULL]]
export const LETTER_ZOOM = 13.5
export const LETTER_TEXT_SIZE = 11

// Declining ring: dashed, in the marker's own grade color (mockup), drawn
// as a prerendered image GAP px outside the dot's reference radius.
export const DECLINING_RING_GAP = 3
export const DECLINING_RING_BASE_RADIUS = POINT_RADIUS_FULL // drawn at z14 size

// Pointer forgiveness (ported): events resolve against a slop-padded box —
// nobody should have to land on a small dot exactly.
export const HIT_SLOP_FINE = 10
export const HIT_SLOP_COARSE = 16

// Same-point stacks (count bubbles): core radius by member count, ported
// from the old `stacks.js` steps (<10 / <50 / 50+) — at full size. Stacks
// ride the dots' growth curve and their counts appear once the bubble can
// carry text; below CLUSTER_MAX_ZOOM most are absorbed into proximity
// clusters anyway (isolated ones still draw, zoom-scaled).
export const STACK_RADII = [11, 13, 15] as const
export const STACK_STEPS = [10, 50] as const
export const STACK_COUNT_ZOOM = 12

// Proximity clusters — the old client's bubble clustering, revived at
// Cannon's preview-review call (2026-08-30; supersedes the CRD-M1 "no
// proximity clusters" mockup rule). Grouped at metro view, dissolved from
// neighborhood zoom up; bubbles are SIZED by the places they stand for
// (sum of member stacks, same steps the hit test measures against) and
// TINTED by the mean grade of the live, scored places inside — size says
// how many, color says how good (the basic map keeps a neutral density
// ramp: it publishes no grades). Values ported verbatim from the old
// `constants.js` / `stacks.js`.
export const CLUSTER_RADII = [12, 16, 22] as const // <10 · <50 · 50+
export const CLUSTER_STEPS = [10, 50] as const
export const CLUSTER_MAX_ZOOM = 12
export const CLUSTER_PIXEL_RADIUS = 40 // grouping reach, source config
export const LITE_CLUSTER_RAMP = ['#9aa1a9', '#8b929b', '#7d848d'] as const

// Neutral stack surfaces per basemap (MapLibre paint can't read CSS vars;
// layers are re-added on theme swap with the right literals). Values are
// tokens.css --cp-surface-3 / --cp-ink / --cp-marker-ring.
export const STACK_SURFACE = { dark: '#242a31', light: '#eef1f4' } as const
export const STACK_INK = { dark: '#e9ecef', light: '#1d2129' } as const
export const MARKER_RING = {
    dark: 'rgba(255, 255, 255, .85)',
    light: 'rgba(255, 255, 255, .95)',
} as const

// Highest form item that counts as a foodborne-illness risk factor
// (cf_lib.RISK_FACTOR_MAX_ITEM). Shared by count chips and receipt math.
export const RF_MAX_ITEM = 29
