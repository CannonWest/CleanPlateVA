/**
 * Shared vocabulary for the dashboard modules: localStorage keys, the VDH
 * portal base, the grade palette and marker fills, basemap style URLs, the
 * dark-matter road-label fix, the Virginia home framing, MapLibre source /
 * layer ids, and the risk-factor item ceiling the presentation and receipt
 * math share. Data colours live here (chrome themes via CSS).
 */

export const RESTAURANTS_ONLY_KEY = 'cleanplateva.food.restaurantsOnly';
export const SHOW_CLOSED_KEY = 'cleanplateva.food.showClosed';
export const SHOW_NEW_KEY = 'cleanplateva.food.showNew';
export const SHOW_MOBILE_KEY = 'cleanplateva.food.showMobile';

// List load-more (D-DATA-11): rows revealed per chunk; `?page=N` = N chunks.
export const LIST_PAGE_SIZE = 50;

export const PORTAL_BASE = 'https://inspections.myhealthdepartment.com';
// The `virginia` aggregate: correct only for facilities no district claimed.
export const AGGREGATE_TENANT = 'virginia';

// Grade palette — fixed hues that read on light + dark (data color, not
// chrome; chrome themes via CSS).
export const GRADE_COLORS = {
    A: '#2f9e44',   // green
    B: '#94be1b',   // lime
    C: '#f59f00',   // amber
    D: '#e8590c',   // orange
    F: '#e03131',   // red
    none: '#868e96', // unscored — gray
};

// Newly permitted (an active permit with no scored broad assessment yet, so no
// grade): a blue that reads "cleared to open, grade still to come" — distinct
// from every A–F hue and on-brand with --cp-accent. Data color (map marker +
// panel badge), so it lives alongside GRADE_COLORS.
export const NEW_COLOR = '#1c7ed6';

// The two non-grade marker fills, named because the stack summary and the
// spiderfied legs have to reach the same values the plain markers use.
export const LITE_MARKER_COLOR = '#8d939c';   // lite tier: uniform, judgment-free
export const CLOSED_COLOR = '#9aa0a6';        // not a live permit

// CARTO vector basemaps. Attribution rides in the style's sources;
// MapLibre's AttributionControl surfaces it.
export const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
export const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// dark-matter's own road-name label colours (checked against its #0e0e0e
// background, WCAG relative-luminance formula): minor #b5b4b4 9.3:1,
// secondary/tertiary #929292 6.2:1, primary #bdbdbd 10.3:1 — all comfortably
// legible. Trunk/motorway (roadname_major — US routes and turnpikes, exactly
// the road class a "Turnpike" is) ships #383838: 1.7:1, effectively
// invisible on the background it sits on. Positron carries none of this —
// every tier there is a flat #838383 on near-white. So this is CARTO's own
// defect, isolated to one layer of their vendored dark style, not a choice
// either this file or the vendor made on purpose for hierarchy.
//
// #d8d8d8 measures 13.5:1: clear of AA, and brighter than every other tier —
// deliberately, since trunk/motorway is the biggest road class dark-matter
// labels at all, and the fix should read as "most important," not merely
// "no longer broken."
export const DARK_MAJOR_ROAD_LABEL_LAYER = 'roadname_major';
export const DARK_MAJOR_ROAD_LABEL_COLOR = '#d8d8d8';

// Map home: the whole state, framed by fitBounds so the initial view
// scales to the viewport instead of a fixed zoom. Virginia is far wider
// than it is tall, so on desktop the east–west span is the constraint and
// the full north–south border always clears; on a portrait phone the state
// lands as a horizontal band (near-VA visitors get auto-located past it).
// [[west, south], [east, north]] — padded a touch beyond the true extent.
export const VA_BOUNDS = [[-83.7, 36.5], [-75.2, 39.5]];
export const VA_FIT = { padding: 20 };

// MapLibre source + layer ids (data layers re-added on every style swap).
export const SRC = 'food-facilities';
export const LYR_CLUSTERS = 'food-clusters';
export const LYR_CLUSTER_COUNT = 'food-cluster-count';
export const LYR_POINTS = 'food-points';
export const LYR_STACK_RING = 'food-stack-ring';
export const LYR_STACKS = 'food-stacks';
export const LYR_STACK_COUNT = 'food-stack-count';

// Highest form item that counts as a foodborne-illness risk factor
// (cf_lib.RISK_FACTOR_MAX_ITEM). Shared by the inspection-count chips
// and the grade-receipt math.
export const RF_MAX_ITEM = 29;                         // cf_lib.RISK_FACTOR_MAX_ITEM
