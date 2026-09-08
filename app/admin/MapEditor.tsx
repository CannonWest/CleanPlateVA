/**
 * The map edit mode (CPE-M2, design ref frontend-redesign.md §6.6) — the
 * React side: the banner, the pins drawer, and the draft, wired to the
 * live map through mapEditController.ts. Entered from the Edit control in
 * the map's top column (App), left with Exit edit. Its own lazy chunk: a
 * visitor's page never loads it.
 *
 * The draft is this device's (mapDraft.ts, `cleanplateva.admin.map.v1`) and
 * survives a reload (OQ-B). Nothing here publishes: Submit lands at M3, and
 * until then the drawer says so. The detail's 9-dp `location` block is
 * fetched for each new pin through the click-path client and attached when
 * it arrives — provenance for the composer, which resolves the contract's
 * `before` from the archive either way (D-CPE-3); a pin whose detail could
 * not be fetched says so and stands.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import { X } from 'lucide-react'
import type { FacilityDetail, RosterRow } from '../data/types'
import type { RowDragHandler } from '../StackPopover'
import { createMapEditController } from './mapEditController'
import type { MapEditController } from './mapEditController'
import {
    attachDetail, badgeText, distanceM, loadPins, movePin, newPin, pinFor, removePin, savePins,
    setNote, upsertPin,
} from './mapDraft'
import type { LngLatPair, ProposalPin } from './mapDraft'

export const EDIT_BANNER = 'Edit mode. Drag a place to where it is. Nothing is published.'
export const NO_SUBMIT_NOTE = 'Submit is not available in this build.'

export function MapEditor({ map, rows, snapshotId, dark, coarse, getDetail, bindRowDrag, onExit }: {
    /** The live map, once MapView has it. */
    map: maplibregl.Map | null
    /** The roster as filtered — what the map shows is what can be dragged. */
    rows: readonly RosterRow[]
    snapshotId: string | null
    dark: boolean
    coarse: boolean
    getDetail: (permitId: string) => Promise<FacilityDetail>
    /** Hand App the stack-row press handler (MapView routes the popover's
     *  rows to it); null on unmount. */
    bindRowDrag: (handler: RowDragHandler | null) => void
    onExit: () => void
}) {
    const [pins, setPins] = useState<ProposalPin[]>(() => loadPins(window.localStorage))
    const [refusal, setRefusal] = useState<string | null>(null)
    const pinsRef = useRef(pins)
    pinsRef.current = pins
    const rowsRef = useRef(rows)
    rowsRef.current = rows
    const snapshotRef = useRef(snapshotId)
    snapshotRef.current = snapshotId
    const darkRef = useRef(dark)
    darkRef.current = dark
    const controller = useRef<MapEditController | null>(null)

    const byPid = useMemo(() => new Map(rows.map((r) => [String(r.permit_id), r])), [rows])
    const byPidRef = useRef(byPid)
    byPidRef.current = byPid

    const commit = useCallback((next: ProposalPin[]) => {
        pinsRef.current = next
        setPins(next)
        savePins(window.localStorage, next)
    }, [])

    // The detail, fetched once per new pin and attached when it arrives.
    const fetchDetail = useCallback((permitId: string) => {
        void getDetail(permitId).then((detail) => {
            const location = detail.available ? detail.facility?.location ?? null : null
            if (!pinFor(pinsRef.current, permitId)) return // discarded meanwhile
            commit(attachDetail(pinsRef.current, permitId, location))
        }).catch(() => {
            if (pinFor(pinsRef.current, permitId)) commit(attachDetail(pinsRef.current, permitId, null))
        })
    }, [getDetail, commit])

    // The three callbacks the controller drives the draft through.
    const onStart = useCallback((permitId: string): ProposalPin | null => {
        const existing = pinFor(pinsRef.current, permitId)
        if (existing) return existing
        const row = byPidRef.current.get(permitId)
        if (!row) {
            setRefusal('That place is not on the map as filtered.')
            return null
        }
        setRefusal(null)
        const pin = newPin(row, rowsRef.current, snapshotRef.current)
        commit(upsertPin(pinsRef.current, pin))
        fetchDetail(permitId)
        return pin
    }, [commit, fetchDetail])

    const onMove = useCallback((permitId: string, after: LngLatPair) => {
        commit(movePin(pinsRef.current, permitId, after))
    }, [commit])

    const onDrop = useCallback((permitId: string, after: LngLatPair, discard: boolean) => {
        commit(discard ? removePin(pinsRef.current, permitId) : movePin(pinsRef.current, permitId, after))
    }, [commit])

    // The controller lives as long as the map does.
    useEffect(() => {
        if (!map) return
        const created = createMapEditController(map, {
            coarse,
            dark: () => darkRef.current,
            onStart, onMove, onDrop,
        })
        controller.current = created
        created.install()
        created.setPins(pinsRef.current)
        bindRowDrag((permitId, event) => created.beginRowDrag(permitId, event.clientX, event.clientY))
        return () => {
            bindRowDrag(null)
            created.dispose()
            controller.current = null
        }
    }, [map, coarse, onStart, onMove, onDrop, bindRowDrag])

    useEffect(() => {
        controller.current?.setPins(pins)
    }, [pins])

    const undo = (permitId: string) => commit(removePin(pinsRef.current, permitId))
    const resetAll = () => commit([])

    return (
        <>
            <div
                role="note"
                className="pointer-events-none fixed top-16 left-1/2 z-20 -translate-x-1/2 rounded-cp-card border-2 border-[#ff922b] bg-cp-surface-1/95 px-3.5 py-2 text-cp-13 font-semibold text-cp-ink shadow-cp backdrop-blur-[4px]"
            >
                {EDIT_BANNER}
            </div>

            <aside
                aria-label="Proposed pins"
                className="fixed top-3 right-3 bottom-3 z-30 flex w-[340px] max-w-[calc(100vw-24px)] flex-col rounded-cp-card border border-cp-hairline bg-cp-surface-1 shadow-cp max-sm:inset-x-3 max-sm:top-auto max-sm:h-[45vh] max-sm:w-auto"
            >
                <header className="flex flex-none items-center gap-2 border-b border-cp-hairline px-3.5 py-2.5">
                    <span className="text-cp-13 font-bold">Proposed pins</span>
                    <span className="rounded-cp-pill border border-cp-hairline px-2 py-0.5 text-cp-10.5 tabular-nums text-cp-ink-3" data-cp-pin-count="">
                        {pins.length}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        <button type="button" className={BTN} onClick={resetAll} disabled={!pins.length}>
                            Reset all
                        </button>
                        <button type="button" className={BTN} onClick={onExit}>
                            Exit edit
                        </button>
                    </div>
                </header>

                {refusal && (
                    <p role="status" className="border-b border-cp-hairline px-3.5 py-2 text-cp-11.5 text-cp-ink-3">
                        {refusal}
                    </p>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2">
                    {!pins.length ? (
                        <p className="py-2 text-cp-12.5 leading-normal text-cp-ink-3">
                            No pins yet. Drag a place to where it is, or drag a row out of a
                            stack's list. A pin dropped back on its place is discarded.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2.5">
                            {pins.map((pin) => (
                                <PinRow
                                    key={pin.permit_id}
                                    pin={pin}
                                    stale={!!snapshotId && !!pin.snapshot_id && pin.snapshot_id !== snapshotId}
                                    onNote={(note) => commit(setNote(pinsRef.current, pin.permit_id, note))}
                                    onUndo={() => undo(pin.permit_id)}
                                />
                            ))}
                        </ul>
                    )}
                </div>

                <footer className="flex-none border-t border-cp-hairline px-3.5 py-2 text-cp-11 text-cp-ink-3">
                    {NO_SUBMIT_NOTE} Pins stay on this device until they are submitted or reset.
                </footer>
            </aside>
        </>
    )
}

function PinRow({ pin, stale, onNote, onUndo }: {
    pin: ProposalPin
    stale: boolean
    onNote: (note: string) => void
    onUndo: () => void
}) {
    const metres = distanceM(pin)
    const badge = badgeText(pin)
    return (
        <li className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-2.5 py-2" data-cp-pin={pin.permit_id}>
            <div className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-[#ff922b]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-cp-12.5 font-semibold">{pin.name}</div>
                    <div className="text-cp-11 text-cp-ink-3">
                        <span className="font-semibold">{pin.kind === 'site' ? 'Site fix' : 'Refinement'}</span>
                        {' · moved '}
                        <span className="tabular-nums" data-cp-pin-moved="">{fmtMetres(metres)}</span>
                    </div>
                    {badge && <div className="mt-0.5 text-cp-11 text-cp-ink-2">{badge}</div>}
                    {pin.detail === 'unavailable' && (
                        <div className="mt-0.5 text-cp-10.5 text-cp-ink-3">
                            Site detail was not available in this build; the archive supplies it on review.
                        </div>
                    )}
                    {stale && (
                        <div className="mt-0.5 text-cp-10.5 text-cp-ink-3">
                            Drafted against an older snapshot.
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    className="flex-none rounded-cp-pill border border-cp-hairline px-2 py-0.5 text-cp-10.5 font-semibold text-cp-ink-3 hover:text-cp-ink"
                    onClick={onUndo}
                    aria-label={`Undo the pin for ${pin.name}`}
                >
                    <X size={12} aria-hidden="true" className="mr-1 inline" />
                    Undo
                </button>
            </div>
            <textarea
                className="mt-2 w-full resize-y rounded-[6px] border border-cp-hairline bg-cp-surface-1 px-2 py-1 text-cp-11.5"
                rows={1}
                placeholder="Note (optional)"
                aria-label={`Note for ${pin.name}`}
                value={pin.note ?? ''}
                onChange={(e) => onNote(e.target.value)}
            />
        </li>
    )
}

const BTN = 'rounded-cp-pill border border-cp-hairline px-2.5 py-1 text-cp-11.5 font-semibold disabled:opacity-40'

export function fmtMetres(metres: number): string {
    if (!Number.isFinite(metres)) return '—'
    if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km`
    return `${Math.round(metres)} m`
}
