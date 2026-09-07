/**
 * The layers control (2026-09-07, Cannon's ask) — a map control, not a
 * preference: a collapsed button in the map's own bottom-right lane that
 * expands into the basemap choices and collapses again on a pick.
 *
 * It is the one presentation choice that did NOT go into the settings
 * dialog (2026-09-06 consolidated the theme and cluster switches there),
 * and deliberately: a basemap is what the map is DRAWN ON, the visitor
 * flips it while looking at a place to compare drawn ground against
 * photographed ground, and burying that behind a dialog turns a glance into
 * an errand. Every map application in the world puts it in a corner of the
 * map; this one does too. The choice persists like the others (basemap.ts,
 * never the URL — C6).
 *
 * Placed by MapView as a MapLibre IControl in `bottom-right`, added BEFORE
 * the navigation and geolocate controls so it stacks above them — no magic
 * offsets, and it rides the lane's own margins. React renders into the
 * control's element through a portal, so the state stays in React and there
 * is no second root to unmount (the popups' pattern is for content MapLibre
 * places; this is content MapLibre only makes room for).
 *
 * Chrome: the band's pill vocabulary at the floating-control text size, the
 * chosen entry wearing the accent border that means "this one" everywhere
 * else on the site (an active filter pill, a chosen option in the dialog,
 * the settings hint's outline). Escape and an outside click collapse it;
 * the trigger is a real `aria-expanded` button over a `radiogroup`, so the
 * keyboard reaches every entry without a roving-focus contraption.
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
        <div ref={box} className="flex flex-col items-end gap-1.5">
            {open && (
                <div
                    role="radiogroup"
                    aria-label="Basemap"
                    className="flex w-56 flex-col gap-1 rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-1.5 shadow-cp"
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
            <button
                type="button"
                aria-label="Basemap"
                aria-expanded={open}
                title="Basemap"
                onClick={() => onOpenChange(!open)}
                className={`flex h-[29px] w-[29px] items-center justify-center rounded-[4px] border bg-cp-surface-1 text-cp-ink-2 shadow-cp hover:text-cp-ink ${
                    open ? 'border-cp-accent' : 'border-cp-hairline'
                }`}
            >
                <Layers size={16} aria-hidden="true" />
            </button>
        </div>
    )
}
