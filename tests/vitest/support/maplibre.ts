/**
 * A fake `maplibre-gl`, for the specs that mount the whole App.
 *
 * MapLibre needs WebGL, so `new maplibregl.Map()` throws in jsdom and its
 * `remove()` then dies on the half-built instance it left behind. The map's
 * own behavior is NOT what those specs are about — the Playwright e2e is the
 * only proof the map paints, and that is deliberate (design ref §7). What
 * they need is a MapView that mounts and unmounts without exploding, so the
 * chrome around it can be driven.
 *
 * So this is a stub, not a simulator: every method the app calls (enumerated
 * from MapView + mapLayers + mapCamera + basemap) exists and does nothing
 * useful, `on('load')` fires its handler so the load path runs once, and
 * `remove()` succeeds. A spec that wants to assert something ABOUT the map
 * belongs in the e2e suite instead.
 *
 * Use it from a spec's top level, before the imports that reach it:
 *
 *     vi.mock('maplibre-gl', () => maplibreStub())
 *     vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
 */

/** A no-op control: `addControl` only ever stores what it is handed. */
class FakeControl {
    onAdd(): HTMLElement {
        return document.createElement('div')
    }

    onRemove(): void {}
}

class FakeGeolocateControl extends FakeControl {
    trigger(): boolean {
        return true
    }

    on(): this {
        return this
    }

    off(): this {
        return this
    }
}

class FakePopup extends FakeControl {
    setLngLat(): this {
        return this
    }

    setDOMContent(): this {
        return this
    }

    addTo(): this {
        return this
    }

    remove(): this {
        return this
    }

    isOpen(): boolean {
        return false
    }

    getElement(): HTMLElement {
        return document.createElement('div')
    }
}

class FakeMap {
    private handlers = new Map<string, Array<(e: unknown) => void>>()

    constructor(options: { container?: HTMLElement | string } = {}) {
        // The container is the one thing MapView reads back (the canvas).
        void options
    }

    /** `load` and `style.load` fire immediately, so the install path runs. */
    on(event: string, a?: unknown, b?: unknown): this {
        const handler = (typeof a === 'function' ? a : b) as ((e: unknown) => void) | undefined
        if (!handler) return this
        const list = this.handlers.get(event) ?? []
        list.push(handler)
        this.handlers.set(event, list)
        if (event === 'load' || event === 'style.load' || event === 'idle') {
            handler({ target: this })
        }
        return this
    }

    off(): this {
        return this
    }

    once(event: string, handler?: (e: unknown) => void): this {
        return this.on(event, handler)
    }

    /** Drive a registered handler from a spec, if one ever needs to. */
    fire(event: string, payload: unknown = {}): void {
        for (const handler of this.handlers.get(event) ?? []) handler(payload)
    }

    addControl(): this {
        return this
    }

    removeControl(): this {
        return this
    }

    addSource(): this {
        return this
    }

    addLayer(): this {
        return this
    }

    addImage(): this {
        return this
    }

    removeSource(): this {
        return this
    }

    removeLayer(): this {
        return this
    }

    removeImage(): this {
        return this
    }

    hasImage(): boolean {
        return false
    }

    listImages(): string[] {
        return []
    }

    getSource(): undefined {
        return undefined
    }

    getLayer(): undefined {
        return undefined
    }

    getStyle(): { layers: unknown[]; sources: Record<string, unknown> } {
        return { layers: [], sources: {} }
    }

    setStyle(): this {
        return this
    }

    setPaintProperty(): this {
        return this
    }

    setLayoutProperty(): this {
        return this
    }

    setMissingStyleImageResolver(): this {
        return this
    }

    isStyleLoaded(): boolean {
        return true
    }

    getCanvas(): HTMLCanvasElement {
        return document.createElement('canvas')
    }

    getZoom(): number {
        return 7
    }

    getBounds(): { toArray: () => number[][] } {
        return { toArray: () => [[-83.7, 36.5], [-75.2, 39.5]] }
    }

    project(): { x: number; y: number } {
        return { x: 0, y: 0 }
    }

    queryRenderedFeatures(): unknown[] {
        return []
    }

    easeTo(): this {
        return this
    }

    fitBounds(): this {
        return this
    }

    resize(): this {
        return this
    }

    remove(): void {}
}

/** The module shape `vi.mock('maplibre-gl', …)` should return. */
export function maplibreStub() {
    return {
        Map: FakeMap,
        NavigationControl: FakeControl,
        AttributionControl: FakeControl,
        ScaleControl: FakeControl,
        FullscreenControl: FakeControl,
        GeolocateControl: FakeGeolocateControl,
        Popup: FakePopup,
        Marker: FakeControl,
        LngLatBounds: class {
            extend(): this {
                return this
            }
        },
        default: { Map: FakeMap },
    }
}
