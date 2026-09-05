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
// The Fairfax Health District (FFX-M4, 2026-09-05). Fairfax County runs its
// own inspection program, so its facilities have no MyHealthDepartment path
// at all; the exporter publishes this sentinel as their `tenant`
// (cf_export_site.FAIRFAX_TENANT) and every link routes to the county's own
// records instead. The URL is the county's public inspection-reports page —
// its analog of the portal; per-report links come baked on each inspection.
export const FAIRFAX_TENANT = 'fairfax'
export const FAIRFAX_RECORDS_URL = 'https://www.fairfaxcounty.gov/health/food/inspection-reports'

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
export const LYR_POINTS = 'food-points'
export const LYR_POINT_LETTERS = 'food-point-letters'
export const LYR_POINT_DECLINE = 'food-point-decline'
export const LYR_STACKS = 'food-stacks'
export const LYR_STACK_COUNT = 'food-stack-count'

// The declining suffix (CRP-M1, Cannon's pick): a small ↓ beside the grade
// letter past LETTER_ZOOM. An IMAGE, not text, because CARTO's glyph
// endpoint serves no arrow codepoint in any fontstack it hosts (probed
// 2026-08-31: U+2193 and the geometric-shape triangles are absent from
// Montserrat/Open Sans/Noto ranges — the text form renders tofu). White
// like the letter (both sit on the grade fill); offset right so the letter
// keeps its center. Offset is tuned to stay inside the dot down to
// LETTER_ZOOM (radius 9.4px there): the arrow's right edge must not poke
// past the fill onto the basemap, where white vanishes on positron.
export const DECLINE_ICON = 'cp-decline-arrow'
export const DECLINE_ICON_SIZE: readonly [number, number] = [5, 7]
export const DECLINE_ICON_OFFSET: readonly [number, number] = [7, 0]

// ── marker geometry (§6.2 grammar) ─────────────────────────────────────
// Dots grow with zoom; past LETTER_ZOOM they are large enough to carry
// their grade letter (the ratified mockup's 21px marker ≈ radius 10.5).
// [zoom, radius] pairs feed the circle layer's one linear interpolate
// expression (the stack bubbles ride the same curve, scaled).
export const POINT_RADIUS_FULL = 10.5 // the z14, letter-carrying dot
export const POINT_RADIUS_STOPS: ReadonlyArray<readonly [number, number]> =
    [[5, 3.5], [9, 4.5], [12, 6], [14, POINT_RADIUS_FULL]]
export const LETTER_ZOOM = 13.5
export const LETTER_TEXT_SIZE = 11

// Pointer forgiveness (ported): events resolve against a slop-padded box —
// nobody should have to land on a small dot exactly.
export const HIT_SLOP_FINE = 10
export const HIT_SLOP_COARSE = 16

// Same-point stacks (count bubbles): core radius by member count, ported
// from the old `stacks.js` steps (<10 / <50 / 50+) — at full size. The old
// client only DREW stacks past clusterMaxZoom 12 (proximity clusters
// absorbed them below); with clustering retired — tried live 2026-08-30
// and withdrawn on Cannon's review, see #174/#175 — the equivalent
// restraint is zoom-scaling: bubbles ride the dots' growth curve and
// their counts appear once the bubble can carry text.
export const STACK_RADII = [11, 13, 15] as const
export const STACK_STEPS = [10, 50] as const
export const STACK_COUNT_ZOOM = 12

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
