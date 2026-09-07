/**
 * Pointer resolution (CRVa-M1) — the old `markers.js` rules on the new
 * layer set: slop only ADDS reach; inside a mark the painted z-order wins
 * (stacks over dots over cluster bubbles); outside every mark the nearest
 * EDGE wins; and the hit radii mirror the layer expressions (zoom-scaled
 * dots, count-stepped zoom-scaled stacks, places-stepped fixed clusters) so
 * the target never disagrees with the paint. Also the popover's directional
 * zoom-out dismissal (CRP-M6, production's webSurvivesZoom).
 */
import { expect, test } from 'vitest'
import {
    HIT_SLOP_COARSE, HIT_SLOP_FINE, LYR_CLUSTERS, LYR_POINTS, LYR_STACKS,
} from '../../app/constants'
import {
    clusterRadiusOf, hitSlop, markRadius, pickMark, pointRadiusAt,
    popoverSurvivesZoom, stackRadiusAt,
} from '../../app/mapHit'

test('the hit radii mirror the layer expressions', () => {
    expect(pointRadiusAt(5)).toBe(3.5)
    expect(pointRadiusAt(9)).toBe(4.5)
    expect(pointRadiusAt(14)).toBe(10.5)
    expect(pointRadiusAt(3)).toBe(3.5)        // clamped below the first stop
    expect(pointRadiusAt(18)).toBe(10.5)      // clamped above the last
    expect(pointRadiusAt(10.5)).toBeCloseTo(5.25, 5) // linear between stops

    expect(stackRadiusAt(14, 5)).toBe(11)     // full size at the top of the curve
    expect(stackRadiusAt(14, 12)).toBe(13)
    expect(stackRadiusAt(14, 60)).toBe(15)
    expect(stackRadiusAt(5, 5)).toBeCloseTo(11 * (3.5 / 10.5), 5) // rides the dots' curve

    expect(markRadius(LYR_POINTS, {}, 9)).toBe(4.5)
    expect(markRadius(LYR_STACKS, { stack: 60 }, 14)).toBe(15)
    expect(hitSlop(false)).toBe(HIT_SLOP_FINE)
    expect(hitSlop(true)).toBe(HIT_SLOP_COARSE)
})

test('being ON a mark beats being merely near one', () => {
    const winner = pickMark([
        { layerId: LYR_STACKS, dx: 12, dy: 0, radius: 11 },  // near, 1px outside
        { layerId: LYR_POINTS, dx: 2, dy: 0, radius: 6 },    // inside
    ], 10)
    expect(winner?.layerId).toBe(LYR_POINTS)
    expect(winner?.inside).toBe(true)
})

test('both under the pointer: what is painted on top wins (stacks over dots)', () => {
    const winner = pickMark([
        { layerId: LYR_POINTS, dx: 0, dy: 0, radius: 6 },
        { layerId: LYR_STACKS, dx: 3, dy: 0, radius: 11 },
    ], 10)
    expect(winner?.layerId).toBe(LYR_STACKS)
})

test('outside every mark: nearest edge wins, not nearest centre', () => {
    // The big stack's rim is 2px away; the dot's centre is nearer as a
    // centre but its rim is 4px away — the stack answers.
    const winner = pickMark([
        { layerId: LYR_POINTS, dx: 10, dy: 0, radius: 6 },   // gap 4
        { layerId: LYR_STACKS, dx: 13, dy: 0, radius: 11 },  // gap 2
    ], 10)
    expect(winner?.layerId).toBe(LYR_STACKS)
    expect(winner?.inside).toBe(false)
})

test('nothing within slop answers null', () => {
    expect(pickMark([
        { layerId: LYR_POINTS, dx: 30, dy: 0, radius: 6 },
    ], 10)).toBeNull()
})

test('cluster bubbles step by the places they stand for — fixed, never zoom-scaled (CRP-M6)', () => {
    expect(clusterRadiusOf(9)).toBe(12)
    expect(clusterRadiusOf(10)).toBe(16)
    expect(clusterRadiusOf(49)).toBe(16)
    expect(clusterRadiusOf(50)).toBe(22)
    expect(clusterRadiusOf(undefined)).toBe(12)   // a missing sum is a small bubble, not NaN
    expect(markRadius(LYR_CLUSTERS, { sum: 57 }, 5)).toBe(22)
    expect(markRadius(LYR_CLUSTERS, { sum: 57 }, 14)).toBe(22) // zoom changes nothing
})

test('three tiers under the pointer: stack over dot over cluster; a cluster still answers outside them', () => {
    const inside = (layerId: string, dx: number, radius: number) => ({ layerId, dx, dy: 0, radius })
    expect(pickMark([inside(LYR_CLUSTERS, 0, 22), inside(LYR_POINTS, 2, 6)], 10)?.layerId)
        .toBe(LYR_POINTS)
    expect(pickMark([
        inside(LYR_CLUSTERS, 0, 22), inside(LYR_STACKS, 3, 11), inside(LYR_POINTS, 2, 6),
    ], 10)?.layerId).toBe(LYR_STACKS)
    // Outside every mark the nearest RIM wins: the bubble's is 2px away,
    // the dot's 4px — rank only breaks a tie there.
    const outside = pickMark([
        { layerId: LYR_CLUSTERS, dx: 24, dy: 0, radius: 22 },
        { layerId: LYR_POINTS, dx: 10, dy: 0, radius: 6 },
    ], 10)
    expect(outside?.layerId).toBe(LYR_CLUSTERS)
    expect(outside?.inside).toBe(false)
})

test('an open popover survives holding and flying IN, and dismisses only on the way OUT into the band', () => {
    expect(popoverSurvivesZoom(13.2, 13.2)).toBe(true)   // a zoom event that changed nothing
    expect(popoverSurvivesZoom(10.5, 11.15)).toBe(true)  // the opening ease flies IN (#157/#158)
    expect(popoverSurvivesZoom(10.5, 17)).toBe(true)
    expect(popoverSurvivesZoom(14.6, 13.4)).toBe(true)   // pulled back, still above the band
    expect(popoverSurvivesZoom(13.2, 12.9)).toBe(false)  // fell into tile zoom 12: absorbed
    expect(popoverSurvivesZoom(12.5, 12.4)).toBe(false)  // any fall inside the band dismisses
})
