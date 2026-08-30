/**
 * Pointer resolution (CRVa-M1) — the old `markers.js` rules on the new
 * layer set: slop only ADDS reach; inside a mark the painted z-order wins
 * (stacks over dots); outside every mark the nearest EDGE wins; and the
 * hit radii mirror the layer expressions (zoom-scaled dots, count-stepped
 * zoom-scaled stacks) so the target never disagrees with the paint.
 */
import { expect, test } from 'vitest'
import {
    HIT_SLOP_COARSE, HIT_SLOP_FINE, LYR_POINTS, LYR_STACKS,
} from '../../app/constants'
import { hitSlop, markRadius, pickMark, pointRadiusAt, stackRadiusAt } from '../../app/mapHit'

test('the hit radii mirror the layer expressions', () => {
    expect(pointRadiusAt(5)).toBe(3.5)
    expect(pointRadiusAt(9)).toBe(4.5)
    expect(pointRadiusAt(14)).toBe(10.5)
    expect(pointRadiusAt(3)).toBe(3.5)        // clamped below the first stop
    expect(pointRadiusAt(18)).toBe(10.5)      // clamped above the last
    expect(pointRadiusAt(10.5)).toBeCloseTo(5.25, 5) // linear between stops

    expect(stackRadiusAt(14, 5)).toBe(11)     // full size at the letter zoom
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
