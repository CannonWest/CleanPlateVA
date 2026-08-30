// CRF-M1 proof map — a MapLibre island (direct instance in a ref'd
// container, D-CR-MAP-1) drawing DOTS ONLY: no chrome, no hover, no panel,
// no stacks. Exists to prove the npm `maplibre-gl` dep, the dark basemap +
// road-label fix, and the roster → circle-layer path on both tiers. CRV-a
// replaces this with the real MapView built to §6.2; nothing here is a view.
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
    CLOSED_COLOR, DARK_MAJOR_ROAD_LABEL_COLOR, DARK_MAJOR_ROAD_LABEL_LAYER,
    LITE_MARKER_COLOR, LYR_POINTS, NEW_COLOR, SRC, STYLE_DARK, VA_BOUNDS, VA_FIT,
} from './constants'
import { gradeColor, gradeForScore, isActivePermit } from './data/presentation'
import type { RosterRow } from './data/types'

function markerColor(f: RosterRow, lite: boolean): string {
    if (lite) return LITE_MARKER_COLOR
    if (!isActivePermit(f)) return CLOSED_COLOR
    const score = f.o?.grade_score
    if (score != null && Number.isFinite(Number(score))) {
        return gradeColor(gradeForScore(Number(score)))
    }
    return f.o?.new === 1 ? NEW_COLOR : gradeColor(null)
}

function featureCollection(facilities: RosterRow[], lite: boolean): FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: facilities
            .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
            .map((f) => ({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: [f.lon, f.lat] },
                properties: { color: markerColor(f, lite) },
            })),
    }
}

export function ProofMap({ facilities, lite }: { facilities: RosterRow[]; lite: boolean }) {
    const container = useRef<HTMLDivElement>(null)
    const mapRef = useRef<maplibregl.Map | null>(null)
    const dataRef = useRef<FeatureCollection>(featureCollection([], lite))

    dataRef.current = featureCollection(facilities, lite)

    useEffect(() => {
        if (!container.current || mapRef.current) return
        const map = new maplibregl.Map({
            container: container.current,
            style: STYLE_DARK,
            bounds: VA_BOUNDS,
            fitBoundsOptions: VA_FIT,
        })
        mapRef.current = map
        // Dev-only handle so the proof can be interrogated from the console
        // (map state, layers, source counts). Absent from production builds.
        if (import.meta.env.DEV) {
            ;(window as unknown as { __cpProofMap?: maplibregl.Map }).__cpProofMap = map
        }
        map.on('load', () => {
            // dark-matter's trunk/motorway labels ship illegible on its own
            // background; the fix is deliberate and brighter than every tier.
            if (map.getLayer(DARK_MAJOR_ROAD_LABEL_LAYER)) {
                map.setPaintProperty(DARK_MAJOR_ROAD_LABEL_LAYER, 'text-color', DARK_MAJOR_ROAD_LABEL_COLOR)
            }
            map.addSource(SRC, { type: 'geojson', data: dataRef.current })
            map.addLayer({
                id: LYR_POINTS,
                type: 'circle',
                source: SRC,
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': 4,
                    'circle-stroke-color': 'rgba(255, 255, 255, .85)',
                    'circle-stroke-width': 1,
                },
            })
        })
        return () => {
            mapRef.current = null
            map.remove()
        }
    }, [])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        const source = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
        source?.setData(dataRef.current)
    }, [facilities, lite])

    return <div ref={container} className="h-full w-full" aria-label="proof map" />
}
