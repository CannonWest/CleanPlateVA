/**
 * The clustering control (CRP-M6, Cannon's call): a SWITCH in the
 * bottom-left corner, directly above the attribution chip — the theme
 * switch's pill and thumb idiom at the corner's size. (The theme switch
 * itself stood right above this one until 2026-09-06, when it moved
 * under the band at the top-left, 1.5× and in color; this is the
 * corner's one switch now. Both are map-view controls: neither renders
 * on the List / About documents.) App's corner column places it (it has no fixed
 * position of its own).
 * Off (every place drawn) is the shipped default; the thumb slides to the
 * grouped mark for production's proximity clusters. Public words in the
 * formal register: "Group nearby places" / "Show every place."
 *
 * Not a Filters-popover row: those are roster filters, URL-carried and
 * counted by "Filters · N". This changes how the map is drawn, not what it
 * shows.
 */

import { Grip, Group } from 'lucide-react'

export function ClusterSwitch({ on, onToggle }: {
    on: boolean
    onToggle: (on: boolean) => void
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Group nearby places"
            title={on ? 'Show every place' : 'Group nearby places'}
            onClick={() => onToggle(!on)}
            className="flex items-center gap-0 rounded-cp-pill border border-cp-hairline bg-cp-surface-1 p-[3px] shadow-cp"
        >
            <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    on ? 'text-cp-ink-3' : 'bg-cp-surface-3 text-cp-ink'
                }`}
            >
                <Grip size={13} aria-hidden="true" />
            </span>
            <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    on ? 'bg-cp-accent-solid text-cp-accent-ink' : 'text-cp-ink-3'
                }`}
            >
                <Group size={13} aria-hidden="true" />
            </span>
        </button>
    )
}
