/**
 * The layers control (2026-09-07, Cannon's ask) — the basemap choice: the
 * drawn CARTO ground, or the Commonwealth's own VBMP aerial photography.
 *
 * It is the one presentation choice that did NOT go into the settings
 * dialog (2026-09-06 consolidated the theme and cluster switches there),
 * and deliberately: a basemap is what the map is DRAWN ON, the visitor
 * flips it while looking at a place to compare drawn ground against
 * photographed ground, and burying that behind a dialog turns a glance into
 * an errand. The choice persists like the others (basemap.ts, never the
 * URL — C6).
 *
 * **It moved OFF the map's bottom-right lane on 2026-09-09** (Cannon's
 * call). It shipped as a 29px icon button stacked above the zoom and "Find
 * me" buttons — the corner every map application puts a basemap switch in —
 * and the corner turned out to be the wrong home for it here: that lane is
 * MapLibre's, its buttons are the map's own instruments, and a control that
 * changes what the visitor is looking AT was reading as one more zoom
 * affordance. So it now MIRRORS the Settings pill under the band (App's top
 * column): Layers at the column's left edge, Settings at its right, the
 * same pill in the same chrome — the two presentation controls as a matched
 * pair, both in the band's vocabulary, both labelled with the word as well
 * as the glyph.
 *
 * The move also answers the thing Cannon asked for by name — that it not go
 * transparent under a click — and answers it at the cause. In the lane the
 * trigger was a `button` inside `.maplibregl-ctrl`, and maplibre-gl.css
 * (imported globally by MapView) carries
 * `.maplibregl-ctrl button:not(:disabled):active { background-color:
 * rgba(0,0,0,.05) }`. That selector scores (0,3,1) against a Tailwind
 * utility's (0,1,0), so for as long as the mouse was held down it REPLACED
 * our opaque surface with a 5%-black wash and the map showed straight
 * through the button. Out here nothing but this file paints the trigger:
 * `--cp-surface-2` in both states, and only the border changes when the
 * list is open (`layers-control.spec.tsx` pins that).
 *
 * The list opens DOWNWARD now (there is a screen below it, where the corner
 * had only map above), absolutely positioned in the column's own stacking
 * context — no portal and no positioning library, the band's rule since the
 * Filters panel (2026-09-09): floating-ui's `autoUpdate` observers run
 * against a repainting MapLibre canvas and are measurably laggy on this
 * view. Absolute, so opening the list never pushes the settings hint below
 * it down the screen.
 *
 * Chrome: the chosen entry wears the accent border that means "this one"
 * everywhere else on the site (an active filter pill, a chosen option in
 * the dialog, the settings hint's outline). Escape and an outside click
 * collapse it; the trigger is a real `aria-expanded` button over a
 * `radiogroup`, so the keyboard reaches every entry without a roving-focus
 * contraption.
 */

import { useEffect, useRef } from 'react'
import { Layers } from 'lucide-react'
import { BASEMAPS, BASEMAP_LABELS } from './basemap'
import type { Basemap } from './basemap'

/** What each entry says under its name — why a visitor would pick it. */
const BASEMAP_HINTS: Record<Basemap, string> = {
    map: 'Streets and place names',
    aerial: 'Virginia aerial photography',
}

export function LayersControl({ basemap, open, onOpenChange, onBasemap }: {
    basemap: Basemap
    open: boolean
    onOpenChange: (open: boolean) => void
    onBasemap: (basemap: Basemap) => void
}) {
    const box = useRef<HTMLDivElement>(null)

    // Collapse on Escape or a click outside — the map's own dismissal rule
    // (the stack popover's), so the control never sits open over a place the
    // visitor has moved on to. Bound only while open.
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onOpenChange(false)
        }
        const onDown = (e: MouseEvent) => {
            if (!box.current?.contains(e.target as Node)) onOpenChange(false)
        }
        document.addEventListener('keydown', onKey)
        // Capture: the map swallows pointer events on the canvas.
        document.addEventListener('mousedown', onDown, true)
        return () => {
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('mousedown', onDown, true)
        }
    }, [open, onOpenChange])

    return (
        <div ref={box} className="pointer-events-auto relative flex-none">
            {/* The Settings pill's own clothes, to the class (SettingsButton)
                — the pair only reads as a pair if nothing but the glyph and
                the word differ. The surface never changes: an OPEN list is
                said with the accent border and the brighter ink, the same
                "this one" signal the entries below use, so the button under
                a click is exactly as solid as the button before it. */}
            <button
                type="button"
                aria-expanded={open}
                onClick={() => onOpenChange(!open)}
                className={`flex flex-none items-center gap-1.5 rounded-cp-pill border bg-cp-surface-2 px-4 py-2.5 text-cp-13 font-semibold shadow-cp ${
                    open
                        ? 'border-cp-accent text-cp-ink'
                        : 'border-cp-hairline text-cp-ink-2 hover:text-cp-ink'
                }`}
            >
                <Layers size={16} aria-hidden="true" />
                Layers
            </button>
            {open && (
                <div
                    role="radiogroup"
                    aria-label="Basemap"
                    className="absolute top-[calc(100%+6px)] left-0 z-30 flex w-56 flex-col gap-1 rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-1.5 shadow-cp"
                >
                    {BASEMAPS.map((option) => {
                        const chosen = option === basemap
                        return (
                            <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={chosen}
                                onClick={() => {
                                    onBasemap(option)
                                    onOpenChange(false)
                                }}
                                className={`rounded-cp-card border-2 px-3 py-2 text-left ${
                                    chosen
                                        ? 'border-cp-accent bg-cp-surface-2'
                                        : 'border-transparent hover:bg-cp-surface-2'
                                }`}
                            >
                                <span className="block text-cp-13 font-semibold text-cp-ink">
                                    {BASEMAP_LABELS[option]}
                                </span>
                                <span className="block text-cp-11.5 text-cp-ink-3">
                                    {BASEMAP_HINTS[option]}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
