/**
 * Shared vocabulary for the CR client (CRF-M1; view-layer rows CRVa-M0) —
 * the subset of the old client's `constants.js` (deleted at CRC) the ported data layer and
 * the map surface actually read. The redesigned map draws dots at every
 * zoom by default (ratified mockup; only same-point stacks bubble); the old
 * client's proximity clustering is a visitor SWITCH since CRP-M6, and its
 * radii/steps are ported below.
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
// records instead. FAIRFAX_RECORDS_URL is the county's public
// inspection-reports page — the fallback when a row carries no `ffx_oid`
// (below); per-report links come baked on each inspection.
export const FAIRFAX_TENANT = 'fairfax'
export const FAIRFAX_RECORDS_URL = 'https://www.fairfaxcounty.gov/health/food/inspection-reports'
// The county's own per-facility page: its ArcGIS Experience map selects a
// permitted establishment by the layer's OBJECTID (`#data_s=id:<source>:<oid>`),
// which the exporter publishes as the finder row's `ffx_oid` (an integer on
// roster-joined county rows; null for a county facility known only from its
// reports and on every VDH row). The source handle is the Experience app's
// own — verified 2026-09-05 against two of the county's links.
export const FAIRFAX_EXPERIENCE_URL = 'https://experience.arcgis.com/experience/0e687ef56da44ef287d20ced8cc85a3f/page/Main-Page'
export const FAIRFAX_EXPERIENCE_SOURCE = 'dataSource_5-17e77d67cec-layer-3'

// Grade palettes — data color, not chrome (chrome themes via the Tailwind
// tokens). `standard` is the RATIFIED ramp (design ref §6.0, CRD-M1
// 2026-08-29): only F moved from the live site (#e03131 → #a61e1e, fixing
// the D↔F normal-vision failure). `colorblind` is the visitor's alternative
// since 2026-09-06 (Cannon's palette, the settings dialog): a blue → gold →
// orange → umber diverging scale in place of green → red. The visitor's
// choice is a class on <html> (palette.ts) that re-points the --cp-grade-*
// tokens for every DOM surface (theme.css mirrors these hex values — keep
// the two in step); the map's paint and the donut canvas cannot read a
// custom property and take the hex from here by palette name. The letter
// rides the color everywhere a grade is NAMED — chip, hover card, panel,
// list row — but no longer on the map dots (Cannon's call 2026-09-06; §6.0
// amended): the dot is color + ring alone, and the letter is one hover away.
export type GradePalette = 'standard' | 'colorblind'
export const GRADE_PALETTES: Record<GradePalette, Readonly<Record<string, string>>> = {
    standard: {
        A: '#2f9e44',
        B: '#94be1b',
        C: '#f59f00',
        D: '#e8590c',
        F: '#a61e1e',
        none: '#868e96',
    },
    colorblind: {
        A: '#045a8d',
        B: '#5aa9d6',
        C: '#f4c245',
        D: '#f08c3c',
        F: '#9c4a0c',
        none: '#868e96',
    },
}
/** The ratified ramp by its old name — the standard palette. */
export const GRADE_COLORS: Record<string, string> = GRADE_PALETTES.standard

// Newly permitted: cleared to open, grade still to come. Blue is NEW's alone
// on the standard ramp, which has no blue of its own; the color-blind ramp's
// A and B ARE blues, so there NEW is near-black (Open Color gray-9) — the one
// hue family the ramp leaves untouched that still reads against every fill
// and against the grays (unscored / closed), by luminance rather than hue.
export const NEW_COLORS: Record<GradePalette, string> = {
    standard: '#1c7ed6',
    colorblind: '#212529',
}
export const NEW_COLOR = NEW_COLORS.standard

export const LITE_MARKER_COLOR = '#8d939c' // basic map: uniform, judgment-free
export const CLOSED_COLOR = '#9aa0a6'      // not a live permit
// The dot's presence: closed permits (visible only under "Show closed") dim.
// Paint expressions over the feature's bucket (mapLayers pointOpacityExpr).
export const POINT_OPACITY = 0.88
export const CLOSED_OPACITY = 0.42

// CARTO vector basemaps (attribution rides in the style's sources).
export const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
export const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// ── the aerial basemap (VBMP orthoimagery) ─────────────────────────────
// The visitor's basemap choice (the layers control): 'map' is the CARTO
// style above — the shipped default, and what a first-time visitor sees —
// and 'aerial' lays the Commonwealth's own orthoimagery under the style's
// LABELS (mapLayers installBasemap). Never a second style: one raster
// layer, inserted under the first symbol layer, so the theme keeps owning
// the labels and every marker rule stands unchanged.
//
// VGIN publishes the mosaic of the most recent collection (Spring 2022 /
// 2023 / 2025, whichever a place last had) as a cached ArcGIS tile service:
// EPSG:3857, 256px, `/tile/{z}/{y}/{x}` — ArcGIS's row/col IS the XYZ
// scheme — JPEG, `Cache-Control: max-age=86400`, and CORS reflecting any
// origin (measured 2026-09-07). It is free of charge and public by the
// program's own terms; a tile weighs 12-23 KB from z9 to z19.
export const AERIAL_TILES =
    'https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VBMP_Imagery/MostRecentImagery_WGS/MapServer/tile/{z}/{y}/{x}'
// The service's LODs claim 23, but tiles 404 past 19 (measured): declare
// what exists and let MapLibre overzoom the rest, or the map paints holes
// where the visitor zooms furthest in.
export const AERIAL_MAX_ZOOM = 19
// 256px tiles — the service's own, and half CARTO's 512: MapLibre reads the
// size off the source, so the two schemes coexist without touching a zoom
// constant anywhere else (CLUSTER_MAX_ZOOM and SELECT_ZOOM stay CARTO's).
export const AERIAL_TILE_SIZE = 256
// Collected by MapLibre's own attribution control while the source is on
// the map, and gone with it — the imagery is credited exactly when it is
// drawn. Deliberately SHORT: this rides the one-line attribution strip that
// the footer chip shares, and every character widens it (measured
// 2026-09-07 — a longer form ran under the chip at desktop widths and lost
// its own first word). The full formal credit is the terms document's row
// (TermsBody), which names the program, the agency and the department.
// The program by name — VGIN's condition for public use (Gerard Bernhardt,
// VBMP program manager, 2026-09-08: "with proper credit to the Virginia Base
// Mapping Program"), with the network that holds the copyright after it.
// Longer than the first cut's "© VGIN"; the footer lane's aerial-on stop is
// sized to it (App.tsx) and the e2e lane test measures the two apart.
export const AERIAL_ATTRIBUTION =
    'Imagery © <a href="https://vgin.vdem.virginia.gov/pages/orthoimagery" target="_blank" rel="noopener">Virginia Base Mapping Program</a> (VGIN)'

// dark-matter ships its trunk/motorway road labels at 1.7:1 against its own
// background (CARTO defect, one layer); #d8d8d8 measures 13.5:1. See the old
// constants.js for the full measurement note.
export const DARK_MAJOR_ROAD_LABEL_LAYER = 'roadname_major'
export const DARK_MAJOR_ROAD_LABEL_COLOR = '#d8d8d8'

// Map home: the whole state via fitBounds. [[west, south], [east, north]].
export const VA_BOUNDS: [[number, number], [number, number]] =
    [[-83.7, 36.5], [-75.2, 39.5]]
export const VA_FIT = { padding: 20 }

// The visitor's persisted theme, 'dark' | 'light' | 'system'; unset (and
// anything else) reads as SYSTEM — the device's own appearance, the visitor
// default since the settings dialog (2026-09-06, Cannon's call; light was
// the default earlier that day, dark before it). The CSS base stays the dark
// design (D-CR-STYLE-1) — app/theme.ts resolves the choice to the class.
export const THEME_KEY = 'cleanplateva.theme'
// The visitor's persisted grade palette (the settings dialog, 2026-09-06):
// 'colorblind' for the blue → umber ramp; unset (and anything else) reads as
// 'standard'. The class is the DOM-side hook on <html> that re-points the
// --cp-grade-* tokens (theme.css) — app/palette.ts.
export const PALETTE_KEY = 'cleanplateva.gradePalette'
export const PALETTE_CLASS = 'palette-colorblind'
// The visitor's persisted text size (the settings dialog, 2026-09-06): the
// body size in CSS px as an integer string, '12'..'20'; unset (and anything
// else) reads as 14, the size the design was ratified at — app/settings.ts.
export const TEXT_SIZE_KEY = 'cleanplateva.textSize'
// '1' once the settings dialog has opened on its own — it does so on a
// visitor's first map view, after the acknowledgement; the button under the
// band re-opens it any later time (app/settings.ts).
export const SETTINGS_SEEN_KEY = 'cleanplateva.settingsSeen'
// '1' once the visitor has closed the hint that points at the Settings pill
// (2026-09-07) — or opened Settings themselves, which is the same news. It
// outlives the dialog's one self-opening on purpose: the dialog says what
// the choices ARE, the hint says where they live afterwards. Unset, the
// hint stands on every map view (app/settings.ts).
export const SETTINGS_HINT_KEY = 'cleanplateva.settingsHintDismissed'
// The visitor's persisted clustering choice (CRP-M6): '1' groups nearby
// places into proximity clusters, '0' (and unset — the shipped default,
// Cannon's call 2026-09-05) draws every place. A presentation preference
// like the theme — never URL state (C6: a shared link says what you look
// at, not how it is drawn).
export const CLUSTERS_KEY = 'cleanplateva.clusters'

// The visitor's basemap, 'map' | 'aerial'; unset (and anything else) reads
// as 'map' — the CARTO style, the shipped default. A presentation choice
// like the theme and the palette: per visitor, never in the URL (C6).
export const BASEMAP_KEY = 'cleanplateva.basemap'

/** The admin's device flag (CPE-M1, design ref §6.6): written by the
 *  session page at /admin once the Worker has verified the Access token;
 *  read by the public views to render their Edit controls. Its presence is
 *  what lets a signed-in device see the controls without ever probing on a
 *  visitor's behalf — a device without it renders nothing and asks nothing.
 *  The JSON `{ email, exp }`, `exp` the token's own expiry in unix seconds. */
export const ADMIN_SESSION_KEY = 'cleanplateva.admin.session'

/** The map edit mode's draft (CPE-M2, design ref §6.6): the proposal pins
 *  this device has dragged and not yet submitted, per device, surviving a
 *  reload (OQ-B). Versioned like the About draft — bump to abandon a shape. */
export const MAP_DRAFT_KEY = 'cleanplateva.admin.map.v1'

// MapLibre source + layer ids (data layers re-added on every style swap).
export const SRC = 'food-facilities'
export const LYR_CLUSTERS = 'food-clusters'
export const LYR_POINTS = 'food-points'
export const LYR_STACKS = 'food-stacks'
export const LYR_STACK_COUNT = 'food-stack-count'
// The aerial raster rides its own source + layer, added and removed as the
// choice changes — under the style's labels, never under the markers.
export const SRC_AERIAL = 'vbmp-imagery'
export const LYR_AERIAL = 'vbmp-imagery'

// ── marker geometry (§6.2 grammar) ─────────────────────────────────────
// Dots grow with zoom to the ratified mockup's 21px marker (≈ radius
// 10.5). [zoom, radius] pairs feed the circle layer's one linear
// interpolate expression (the stack bubbles ride the same curve, scaled).
// The dots carried their grade letter past a z13.5 gate until 2026-09-06
// (Cannon's call) — the curve is unchanged, the glyphs are gone.
export const POINT_RADIUS_FULL = 10.5 // the z14 dot
export const POINT_RADIUS_STOPS: ReadonlyArray<readonly [number, number]> =
    [[5, 3.5], [9, 4.5], [12, 6], [14, POINT_RADIUS_FULL]]

// Pointer forgiveness (ported): events resolve against a slop-padded box —
// nobody should have to land on a small dot exactly.
export const HIT_SLOP_FINE = 10
export const HIT_SLOP_COARSE = 16

// Same-point stacks (count bubbles): core radius by member count, ported
// from the old `stacks.js` steps (<10 / <50 / 50+) — at full size. The old
// client only DREW stacks past clusterMaxZoom 12 (proximity clusters
// absorbed them below). With clustering OFF (the shipped default) the
// equivalent restraint is zoom-scaling: bubbles ride the dots' growth curve
// and their counts appear once the bubble can carry text. With it ON, most
// stacks are absorbed into clusters below CLUSTER_MAX_ZOOM anyway (an
// isolated one still draws, zoom-scaled, as it did in production).
export const STACK_RADII = [11, 13, 15] as const
export const STACK_STEPS = [10, 50] as const
export const STACK_COUNT_ZOOM = 12

// Proximity clusters (CRP-M6, 2026-09-05) — production's bubble clustering
// as a VISITOR SWITCH, off by default: #174 ported it verbatim on
// 2026-08-30 and #175 withdrew it on Cannon's review the same day; the
// switch keeps the production look as a choice through the cutover, which
// deletes the old client. Grouped at metro view, dissolved from
// neighborhood zoom up — CLUSTER_MAX_ZOOM is a TILE zoom on CARTO's 512px
// tiles, so bubbles dissolve at camera zoom 13. Bubbles are SIZED by the
// places they stand for (sum of member stacks, the same steps the hit test
// measures against); their FILL is the donut below. Values ported verbatim
// from the old `constants.js` / `stacks.js`; tuning is Cannon's live-review
// call, not the build's.
export const CLUSTER_RADII = [12, 16, 22] as const // <10 · <50 · 50+ places
export const CLUSTER_STEPS = [10, 50] as const
export const CLUSTER_MAX_ZOOM = 12
export const CLUSTER_PIXEL_RADIUS = 40 // grouping reach, source config
export const CLUSTER_COUNT_TEXT_SIZE = 12 // production's count label

// The donut (Cannon's form, 2026-09-05): a cluster is a RING whose arcs are
// the grade breakdown of the places inside, in the dots' own fills, around
// a hole in the theme's stack surface that carries the count — "a neutral
// count bubble wearing the ring of the dots it hides." Painted on demand
// as images (app/donut.ts) at 2× so each size step draws crisp rather than
// scaled. Ring widths pair with CLUSTER_RADII; the closed arc dims like the
// closed dots (their 0.42 fill would vanish on the basemap in a thin arc).
export const DONUT_RING_WIDTHS = [3, 4, 5] as const
export const DONUT_SEPARATOR = 1 // hairline between arcs, CSS px
export const DONUT_PIXEL_RATIO = 2
export const DONUT_CLOSED_ALPHA = 0.5

// The neutral count bubble — THEME-INVARIANT since 2026-09-06 (Cannon's
// call): a stack wears the dark theme's surface and ink on the light
// basemap too, so a stack looks like a stack wherever you meet it. The
// donut's hole is the same surface (donut.ts) and its count the same ink,
// which is what keeps an isolated stack and a cluster bubble reading as one
// vocabulary on a light map. Values are the dark theme's tokens.css
// --cp-surface-3 / --cp-ink; MapLibre paint can't read CSS vars, so these
// are literals and the layers are re-added on a theme swap regardless.
export const STACK_SURFACE = '#242a31'
export const STACK_INK = '#e9ecef'
export const MARKER_RING = {
    dark: 'rgba(255, 255, 255, .85)',
    light: 'rgba(255, 255, 255, .95)',
} as const
export const MARKER_RING_WIDTH = 1.5

// The declining ring (CRP-M2, Cannon's pick 2026-09-05; retires the CRP-M1
// ↓ suffix and its image machinery): a dot whose bake says declining wears
// this ring in place of the theme's white one, at every zoom the dot is
// drawn — it never had the letters' zoom gate, and outlives them. Production's form (markers.js has worn a heavier
// red ring on declining dots since the old client) with the color moved
// off the ramp: production rings in GRADE_COLORS.F, which is invisible on
// an F fill (1.00:1 — the one pair that matters most). #e03131 is
// tokens.css --cp-danger-solid, the pre-CRD-M1 F freed when F darkened,
// and the only red in the vocabulary that collides with no grade fill
// (worst case 1.26:1 on D; grade-f and grade-d both bottom out at 1.00).
// Width is production's 2.5: color alone at 1.5 reads as anti-aliasing on
// the warm fills, and 3 outgrows a z5 dot (radius 3.5). The hit test never
// measured stroke (mapHit.ts sizes the fill), so the extra pixel rides
// inside the slop.
export const DECLINE_RINGS: Record<GradePalette, string> = {
    standard: '#e03131',
    // Red on the color-blind ramp's umber F is 1.4:1 and on its orange D a
    // hue-only difference the mode exists to avoid, so there the declining
    // dot trades the white ring for a near-black one: the cue is "no bright
    // halo" — luminance, which every kind of color vision keeps.
    colorblind: '#212529',
}
export const DECLINE_RING = DECLINE_RINGS.standard
export const DECLINE_RING_WIDTH = 2.5

// Highest form item that counts as a foodborne-illness risk factor
// (cf_lib.RISK_FACTOR_MAX_ITEM). Shared by count chips and receipt math.
export const RF_MAX_ITEM = 29
