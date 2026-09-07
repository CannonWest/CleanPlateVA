/**
 * The cluster donut (CRP-M6, Cannon's form) — the pure half of the bubble
 * the map draws when "Group nearby places" is on. A cluster is a RING whose
 * arcs are the grade breakdown of the places it hides, in the very fills
 * the dots use (A–F on the ramp, NEW, unscored gray, closed dimmed),
 * around a hole in the stacks' own surface that carries the count — so a
 * bubble reads as a neutral count bubble wearing the ring of the dots
 * beneath it, one vocabulary with the neutral stacks (neutral disc + white
 * ring) and the dots (fill + ring). The basic map's buckets are all zero
 * (P6), so its donut is one neutral arc in the basic map's own marker gray.
 *
 * MapLibre draws the ring as a symbol-layer IMAGE whose id ENCODES what to
 * draw — theme · grade palette · size step · the eight bucket sums — and
 * the map's missing-image resolver parses the id and paints it on a canvas
 * the first time the style asks for it (MapView). The theme rides in the id
 * so a stale image can never survive a style swap (setStyle drops every
 * image; the resolver simply regenerates on the new style); since
 * 2026-09-06 every color a donut paints is theme-invariant, so the theme
 * segment is pure cache identity (a swap still evicts and repaints, at the
 * measured 0.23 ms a ring). The PALETTE segment is real identity: the
 * visitor's color-blind ramp (constants.ts GRADE_PALETTES) changes every
 * arc's fill, and the canvas cannot read the CSS tokens the DOM follows, so
 * the palette is named in the id and the painter takes the hex from the
 * table by that name; a palette switch re-points the layer's icon-image
 * expression and evicts the other palette's images (mapLayers
 * applyPalette). The id codec and the arc geometry live here, pure and
 * pinned; the canvas painter is verified live (jsdom has no canvas).
 */

import {
    CLOSED_COLOR, CLUSTER_RADII, CLUSTER_STEPS, DONUT_CLOSED_ALPHA,
    DONUT_PIXEL_RATIO, DONUT_RING_WIDTHS, DONUT_SEPARATOR, LITE_MARKER_COLOR,
    NEW_COLORS, STACK_SURFACE,
} from './constants'
import type { GradePalette } from './constants'
import { gradeHex } from './data/presentation'
import { BUCKET_KEYS, emptyBuckets } from './mapData'
import type { BucketKey, Buckets } from './mapData'

export type Theme = 'dark' | 'light'

export const DONUT_ID_PREFIX = 'donut'

const PALETTES: readonly GradePalette[] = ['standard', 'colorblind']

export interface DonutSpec {
    theme: Theme
    palette: GradePalette
    /** Outer radius in CSS px — one of CLUSTER_RADII. */
    size: number
    buckets: Buckets
}

/** The fill each bucket's arc wears — the dots' own, in the given palette. */
export function bucketFills(palette: GradePalette): Record<BucketKey, string> {
    return {
        nA: gradeHex('A', palette),
        nB: gradeHex('B', palette),
        nC: gradeHex('C', palette),
        nD: gradeHex('D', palette),
        nF: gradeHex('F', palette),
        nNew: NEW_COLORS[palette],
        nNone: gradeHex(null, palette),
        nClosed: CLOSED_COLOR,
    }
}

/** `donut:<theme>:<palette>:<outer radius>:<nA-nB-nC-nD-nF-nNew-nNone-nClosed>` */
export function donutId(theme: Theme, size: number, buckets: Buckets, palette: GradePalette = 'standard'): string {
    return `${DONUT_ID_PREFIX}:${theme}:${palette}:${size}:${BUCKET_KEYS.map((key) => buckets[key]).join('-')}`
}

const COUNT = /^\d+$/

/** The inverse of donutId; null for any id that is not a donut's — the
 *  resolver is asked about EVERY missing image, including the basemap's. */
export function parseDonutId(id: string): DonutSpec | null {
    const parts = id.split(':')
    if (parts.length !== 5 || parts[0] !== DONUT_ID_PREFIX) return null
    const [, theme, palette, sizeText, tuple] = parts
    if (theme !== 'dark' && theme !== 'light') return null
    if (palette !== 'standard' && palette !== 'colorblind') return null
    const size = Number(sizeText)
    if (!(CLUSTER_RADII as readonly number[]).includes(size)) return null
    const counts = (tuple ?? '').split('-')
    if (counts.length !== BUCKET_KEYS.length) return null
    const buckets = emptyBuckets()
    for (const [i, key] of BUCKET_KEYS.entries()) {
        const text = counts[i] ?? ''
        if (!COUNT.test(text)) return null
        buckets[key] = Number(text)
    }
    return { theme, palette, size, buckets }
}

/** The donut ids painted for any OTHER theme or palette. A theme swap DIFFS
 *  the style in place (6.6.0 `setState` keeps the image manager and fires
 *  `style.load` after), so the outgoing theme's donuts would otherwise
 *  linger in the atlas for the session; a palette switch changes no style
 *  at all. Either way the (re)install evicts what does not match and the
 *  resolver repaints the current pair on demand. */
export function staleDonutIds(ids: readonly string[], theme: Theme, palette: GradePalette = 'standard'): string[] {
    const keep = `${DONUT_ID_PREFIX}:${theme}:${palette}:`
    return ids.filter((id) => id.startsWith(`${DONUT_ID_PREFIX}:`) && !id.startsWith(keep))
}

export { PALETTES as DONUT_PALETTES }

export interface Arc {
    /** Turns clockwise from 12 o'clock, 0..1. */
    start: number
    end: number
    fill: string
    alpha: number
    bucket: BucketKey | 'lite'
}

/** The ring's arcs: bucket order, zero buckets skipped, shares summing to a
 *  full turn — every place in the count gets an arc, so the ring always
 *  totals the number in the hole. All-zero buckets (the basic map) → ONE
 *  neutral arc. */
export function donutArcs(buckets: Buckets, palette: GradePalette = 'standard'): Arc[] {
    const total = BUCKET_KEYS.reduce((n, key) => n + buckets[key], 0)
    if (total <= 0) return [{ start: 0, end: 1, fill: LITE_MARKER_COLOR, alpha: 1, bucket: 'lite' }]
    const fills = bucketFills(palette)
    const arcs: Arc[] = []
    let at = 0
    for (const key of BUCKET_KEYS) {
        const n = buckets[key]
        if (n <= 0) continue
        const end = at + n / total
        arcs.push({
            start: at,
            end,
            fill: fills[key],
            alpha: key === 'nClosed' ? DONUT_CLOSED_ALPHA : 1,
            bucket: key,
        })
        at = end
    }
    const last = arcs[arcs.length - 1]
    if (last) last.end = 1 // float drift: the last arc closes the turn exactly
    return arcs
}

/** Ring width for a size step (paired constants). */
export function donutRingWidth(size: number): number {
    const i = (CLUSTER_RADII as readonly number[]).indexOf(size)
    return DONUT_RING_WIDTHS[i] ?? DONUT_RING_WIDTHS[2]
}

/** The symbol layer's `icon-image` expression: the id above, assembled
 *  from a cluster feature's summed properties. The size step is the same
 *  `step` the hit test mirrors (mapHit clusterRadiusOf). Returned untyped —
 *  the caller casts to MapLibre's ExpressionSpecification. */
export function donutIconExpr(theme: Theme, palette: GradePalette = 'standard'): unknown[] {
    const size = ['step', ['get', 'sum'],
        CLUSTER_RADII[0], CLUSTER_STEPS[0], CLUSTER_RADII[1],
        CLUSTER_STEPS[1], CLUSTER_RADII[2]]
    const expr: unknown[] = ['concat', `${DONUT_ID_PREFIX}:${theme}:${palette}:`, ['to-string', size], ':']
    BUCKET_KEYS.forEach((key, i) => {
        if (i) expr.push('-')
        expr.push(['to-string', ['get', key]])
    })
    return expr
}

const TAU = Math.PI * 2
const MARGIN = 1 // room for the arcs' outer anti-aliasing, CSS px
const MAX_SIDE = (CLUSTER_RADII[2] + MARGIN) * 2 * DONUT_PIXEL_RATIO

/** ONE scratch canvas for every donut, CPU-backed (`willReadFrequently`):
 *  a fresh GPU-backed canvas per image cost ~3 ms each in a burst of ~100
 *  per zoom step (measured 2026-09-05 — the allocation plus the readback
 *  `getImageData` forces), which is the main thread frozen for a third of a
 *  second every time the clusters re-form. Sized once for the largest step;
 *  smaller donuts paint in its corner and read back their own square. */
let scratch: { doc: Document; ctx: CanvasRenderingContext2D } | null = null

function scratchContext(doc: Document): CanvasRenderingContext2D | null {
    if (scratch && scratch.doc === doc) return scratch.ctx
    const canvas = doc.createElement('canvas')
    canvas.width = MAX_SIDE
    canvas.height = MAX_SIDE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    scratch = { doc, ctx }
    return ctx
}

/** Paint the donut at DONUT_PIXEL_RATIO (register with the same ratio so it
 *  draws at CSS size, crisp on dense screens). Arcs clockwise from 12
 *  o'clock in bucket order with hairline separators in the hole's surface;
 *  the hole in the stacks' surface; no outer ring — the arcs meet the
 *  basemap directly (Cannon's live-review call, 2026-09-05). Null where
 *  there is no 2D canvas (headless runners). */
export function paintDonut(spec: DonutSpec, doc: Document = document): ImageData | null {
    // `theme` rides in the spec for the image id alone — no color here
    // reads it any more (the hole is theme-invariant with the stacks); the
    // palette picks every arc's fill.
    const { size, buckets, palette } = spec
    const ratio = DONUT_PIXEL_RATIO
    const margin = MARGIN
    const side = (size + margin) * 2 * ratio
    const ctx = scratchContext(doc)
    if (!ctx) return null
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, side, side)
    ctx.globalAlpha = 1
    ctx.scale(ratio, ratio)
    const c = size + margin
    const inner = size - donutRingWidth(size)
    const rad = (turn: number) => turn * TAU - Math.PI / 2 // 12 o'clock, clockwise
    const arcs = donutArcs(buckets, palette)

    for (const arc of arcs) {
        ctx.beginPath()
        ctx.arc(c, c, size, rad(arc.start), rad(arc.end))
        ctx.arc(c, c, inner, rad(arc.end), rad(arc.start), true)
        ctx.closePath()
        ctx.globalAlpha = arc.alpha
        ctx.fillStyle = arc.fill
        ctx.fill()
    }
    ctx.globalAlpha = 1

    if (arcs.length > 1) {
        ctx.strokeStyle = STACK_SURFACE
        ctx.lineWidth = DONUT_SEPARATOR
        for (const arc of arcs) {
            const a = rad(arc.start)
            ctx.beginPath()
            ctx.moveTo(c + Math.cos(a) * (inner - 0.5), c + Math.sin(a) * (inner - 0.5))
            ctx.lineTo(c + Math.cos(a) * (size + 0.5), c + Math.sin(a) * (size + 0.5))
            ctx.stroke()
        }
    }

    ctx.beginPath()
    ctx.arc(c, c, inner, 0, TAU)
    ctx.fillStyle = STACK_SURFACE
    ctx.fill()

    return ctx.getImageData(0, 0, side, side)
}

// Dev-only hook so the paint cost can be timed from the console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    ;(window as unknown as { __cpPaintDonut?: typeof paintDonut }).__cpPaintDonut = paintDonut
}
