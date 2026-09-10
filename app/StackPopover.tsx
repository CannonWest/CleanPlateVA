/**
 * The stack member list (CRVa-M2, a design decision at the M1 boundary): a
 * same-point stack CLICK opens a compact popover listing its members —
 * name over suite/address2, a grade chip speaking the ramp (letter always
 * rides the color, §6.0) or NEW / closed / unscored — and picking one
 * opens the detail panel. The surviving half of the old stack panel; the
 * spiderfy web and its DOM-marker machinery stay retired.
 */

import { facilityPresentation, gradeColor, isActivePermit, isNewlyPermitted } from './data/presentation'
import type { RosterRow } from './data/types'

function MemberChip({ f, lite }: { f: RosterRow; lite: boolean }) {
    if (lite) {
        return <span className="h-2 w-2 flex-none rounded-full" style={{ background: 'var(--cp-lite)' }} aria-hidden="true" />
    }
    if (!isActivePermit(f)) {
        return (
            <span className="flex-none rounded-[4px] bg-cp-surface-3 px-1.5 py-0.5 text-cp-9.5 font-bold text-cp-ink-3 uppercase">
                closed
            </span>
        )
    }
    const letter = facilityPresentation(f).grade?.letter
    if (letter) {
        return (
            <span
                className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] text-cp-11 font-bold text-white"
                style={{ background: gradeColor(letter) }}
            >
                {letter}
            </span>
        )
    }
    if (isNewlyPermitted(f)) {
        return (
            <span className="flex-none rounded-[4px] px-1.5 py-0.5 text-cp-9.5 font-bold text-white" style={{ background: 'var(--cp-new)' }}>
                NEW
            </span>
        )
    }
    return (
        <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] text-cp-11 font-bold text-white" style={{ background: 'var(--cp-grade-none)' }}>
            –
        </span>
    )
}

/** The admin's row drag (CPE-M2, §6.6): a press on a member row, handed to
 *  the map edit controller, which turns it into a pin once the pointer has
 *  travelled — a plain click stays a click. Null outside edit mode. */
export type RowDragHandler = (permitId: string, event: React.PointerEvent<HTMLButtonElement>) => void

export function StackPopover({ members, lite, onPick, onRowPointerDown = null }: {
    members: RosterRow[]
    lite: boolean
    onPick: (permitId: string) => void
    onRowPointerDown?: RowDragHandler | null
}) {
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name))
    return (
        <div className="w-64 text-cp-ink">
            <div className="px-1 pb-1.5 text-cp-12 font-semibold tabular-nums">
                {members.length} places at this point
            </div>
            <div className="max-h-64 overflow-y-auto [scrollbar-color:var(--cp-surface-3)_transparent] [scrollbar-width:thin]">
                {sorted.map((f) => (
                    <button
                        key={String(f.permit_id)}
                        type="button"
                        onClick={() => onPick(String(f.permit_id))}
                        onPointerDown={onRowPointerDown
                            ? (event) => onRowPointerDown(String(f.permit_id), event)
                            : undefined}
                        className={`flex w-full items-center gap-2 rounded-cp-control px-1.5 py-1.5 text-left hover:bg-cp-surface-2${
                            onRowPointerDown ? ' cursor-grab touch-none select-none' : ''}`}
                    >
                        <MemberChip f={f} lite={lite} />
                        <span className="min-w-0">
                            <span className="block truncate text-cp-12.5 font-semibold">{f.name}</span>
                            {f.address2 && (
                                <span className="block truncate text-cp-11 text-cp-ink-3">{f.address2}</span>
                            )}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}
