/**
 * Map hit-testing (CRVa-M1) — ports the old `markers.js` pointer rules to
 * the redesigned layer set (dots + same-point stacks; no clusters):
 *
 *   · Pointer events resolve against a slop-padded box, so a small dot
 *     answers to a comfortably larger target.
 *   · If the pointer is genuinely INSIDE a mark, the painted z-order wins
 *     (stacks over lone dots) — slop only ever ADDS reach.
 *   · Outside every mark, nearest wins by the gap to the mark's EDGE, not
 *     its centre — the rim is what people point at.
 *
 * The radii mirror the LAYER EXPRESSIONS exactly (a hit target that
 *  disagrees with the paint is worse than no slop at all): dots ride the
 * zoom-interpolated curve, stacks ride the same curve scaled over their
 * member-count step.
 */

import {
    HIT_SLOP_COARSE, HIT_SLOP_FINE, LYR_POINTS, LYR_STACKS,
    POINT_RADIUS_FULL, POINT_RADIUS_STOPS, STACK_RADII, STACK_STEPS,
} from './constants'

export function hitSlop(coarse: boolean): number {
    return coarse ? HIT_SLOP_COARSE : HIT_SLOP_FINE
}

/** The dot radius the circle layer paints at this zoom — the JS twin of
 *  the `interpolate` expression (linear between stops, clamped outside). */
export function pointRadiusAt(zoom: number): number {
    const stops = POINT_RADIUS_STOPS
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (!first || !last) return POINT_RADIUS_FULL
    if (zoom <= first[0]) return first[1]
    if (zoom >= last[0]) return last[1]
    for (let i = 1; i < stops.length; i += 1) {
        const lo = stops[i - 1]
        const hi = stops[i]
        if (!lo || !hi) continue
        if (zoom <= hi[0]) {
            const t = (zoom - lo[0]) / (hi[0] - lo[0])
            return lo[1] + t * (hi[1] - lo[1])
        }
    }
    return last[1]
}

/** A stack bubble's painted radius: the member-count step scaled by the
 *  dots' own zoom factor (see MapView's stackRadiusExpr). */
export function stackRadiusAt(zoom: number, count: number): number {
    const full = count >= (STACK_STEPS[1] ?? 50) ? STACK_RADII[2]
        : count >= (STACK_STEPS[0] ?? 10) ? STACK_RADII[1] : STACK_RADII[0]
    return full * (pointRadiusAt(zoom) / POINT_RADIUS_FULL)
}

/** What a rendered feature's radius is, by the layer it came from. */
export function markRadius(layerId: string, properties: { stack?: unknown } = {}, zoom = 14): number {
    if (layerId === LYR_STACKS) return stackRadiusAt(zoom, Number(properties.stack) || 1)
    return pointRadiusAt(zoom)
}

// Stacks paint above lone dots; the rank mirrors that order.
export const MARK_RANK: Record<string, number> = { [LYR_STACKS]: 2, [LYR_POINTS]: 1 }

export interface MarkCandidate {
    layerId: string
    dx: number
    dy: number
    radius: number
}

export interface PickedMark<T extends MarkCandidate = MarkCandidate> {
    gap: number
    inside: boolean
    rank: number
    layerId: string
    dx: number
    dy: number
    radius: number
    candidate: T
}

/** Choose the mark a pointer meant, from candidates already measured
 *  against it (screen px). Returns the winner annotated with `gap` and
 *  `inside`, or null when nothing is within `slop`. */
export function pickMark<T extends MarkCandidate>(candidates: T[], slop: number): PickedMark<T> | null {
    let best: PickedMark<T> | null = null
    for (const candidate of candidates) {
        const gap = Math.hypot(candidate.dx, candidate.dy) - candidate.radius
        if (gap > slop) continue // out of reach entirely
        const inside = gap <= 0
        const rank = MARK_RANK[candidate.layerId] ?? 0
        const next: PickedMark<T> = { ...candidate, gap, inside, rank, candidate }
        if (!best) {
            best = next
            continue
        }
        // Being ON a mark always beats being merely near one.
        if (inside !== best.inside) {
            if (inside) best = next
            continue
        }
        if (inside) {
            // Both under the pointer: what is painted on top wins; centre-
            // most breaks a tie within one layer.
            if (rank > best.rank || (rank === best.rank && gap < best.gap)) best = next
        } else if (gap < best.gap || (gap === best.gap && rank > best.rank)) {
            // Neither is under the pointer: nearest edge wins.
            best = next
        }
    }
    return best
}
