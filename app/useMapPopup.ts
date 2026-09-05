/**
 * One MapLibre popup + one persistent React root (CRP-M3 — the plumbing
 * MapView.tsx carried twice, once for the hover card and once for the stack
 * popover, as eight refs and two near-identical closures).
 *
 * The controller is a stable object of imperative methods: MapView wires it
 * into map listeners inside its one-shot mount effect, so nothing here may
 * change identity across renders. `show` commits the content SYNCHRONOUSLY
 * (flushSync) before the popup places itself — the popup measures real
 * content when it picks its anchor, and the dynamic anchor is what keeps a
 * card inside the map container — and creates the Popup + root lazily on
 * first use; `hide` removes the popup and clears the key; `dispose` tears
 * both down, unmounting the root outside the commit React is running.
 *
 * `key` is the caller's per-event guard — the identity of what the popup
 * shows — so the same facility never re-renders per mousemove, and a click
 * on the stack whose popover is already open reads as "dismiss".
 */

import type { ReactNode } from 'react'
import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import * as maplibregl from 'maplibre-gl'

export interface MapPopupOptions {
    /** theme.css class: `cp-tip` = display-only, mouse-transparent (the
     *  hover card); `cp-pop` = interactive (the stack popover). */
    className: string
    /** Pixels between the anchor and the popup. */
    offset: number
    maxWidth: string
}

export interface MapPopup {
    /** Render `content` into the popup anchored at `lngLat` on `map`. */
    show(map: maplibregl.Map, lngLat: [number, number], content: ReactNode): void
    /** Take the popup off the map (the root stays mounted for the next show). */
    hide(): void
    /** What the popup is about — null when hidden. Owned by the caller. */
    readonly key: { current: string | null }
    /** Tear down: popup off the map, refs cleared, root unmounted next tick. */
    dispose(): void
}

/** The controller without the hook: MapView takes it through `useMapPopup`
 *  (one per mount), the spec calls it directly. */
export function createMapPopup(options: MapPopupOptions): MapPopup {
    let popup: maplibregl.Popup | null = null
    let host: HTMLDivElement | null = null
    let root: Root | null = null
    const key: { current: string | null } = { current: null }

    return {
        key,
        show(map, lngLat, content) {
            if (!host) {
                host = document.createElement('div')
                root = createRoot(host)
            }
            // Committed synchronously so the popup measures real content
            // when it places itself.
            flushSync(() => {
                root?.render(content)
            })
            if (!popup) {
                popup = new maplibregl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    offset: options.offset,
                    maxWidth: options.maxWidth,
                    className: options.className,
                })
            }
            popup.setLngLat(lngLat).setDOMContent(host).addTo(map)
        },
        hide() {
            key.current = null
            popup?.remove()
        },
        dispose() {
            key.current = null
            popup?.remove()
            const stale = root
            popup = null
            host = null
            root = null
            // Unmount outside the commit React is running right now.
            setTimeout(() => stale?.unmount(), 0)
        },
    }
}

/** One controller per mounted component — the same object on every render. */
export function useMapPopup(options: MapPopupOptions): MapPopup {
    const controller = useRef<MapPopup | null>(null)
    if (!controller.current) controller.current = createMapPopup(options)
    return controller.current
}
