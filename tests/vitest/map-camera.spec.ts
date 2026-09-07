/**
 * The selection camera (2026-09-07): a selection the map did not make brings
 * the place into view at neighborhood radius, unless it is already in view
 * at that radius or closer. Pure — MapView measures `inView` and `zoom` off
 * the live map and asks here; its own picks never reach this.
 */
import { expect, test } from 'vitest'
import { SELECT_ZOOM, selectionCamera } from '../../app/mapCamera'

const RICHMOND: [number, number] = [-77.436, 37.541]

test('neighborhood radius is the geolocate landing: camera zoom 13', () => {
    expect(SELECT_ZOOM).toBe(13)
})

test('a place in view at neighborhood radius or closer: the camera stays', () => {
    expect(selectionCamera(RICHMOND, true, 13)).toBeNull()
    expect(selectionCamera(RICHMOND, true, 16.5)).toBeNull()
})

test('a place in view but too far out to tell apart (the state view) is brought in to 13', () => {
    expect(selectionCamera(RICHMOND, true, 6.7)).toEqual({ center: RICHMOND, zoom: 13 })
    expect(selectionCamera(RICHMOND, true, 12.99)).toEqual({ center: RICHMOND, zoom: 13 })
})

test('a place off-screen is eased to — at 13 from further out, at the zoom the visitor chose from closer in', () => {
    expect(selectionCamera(RICHMOND, false, 6.7)).toEqual({ center: RICHMOND, zoom: 13 })
    expect(selectionCamera(RICHMOND, false, 13)).toEqual({ center: RICHMOND, zoom: 13 })
    expect(selectionCamera(RICHMOND, false, 15.25)).toEqual({ center: RICHMOND, zoom: 15.25 })
})
