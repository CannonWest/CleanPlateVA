/**
 * The map edit mode (CPE-M2 + M3, design ref frontend-redesign.md §6.6) —
 * the React side: the banner, the pins drawer, the draft, and Submit, wired
 * to the live map through mapEditController.ts. Entered from the Edit
 * control in the map's top column (App), left with Exit edit. Its own lazy
 * chunk: a visitor's page never loads it.
 *
 * The draft is this device's (mapDraft.ts, `cleanplateva.admin.map.v1`) and
 * survives a reload (OQ-B). The detail's 9-dp `location` block is fetched
 * for each new pin through the click-path client and attached when it
 * arrives — provenance for the composer, which resolves the contract's
 * `before` from the archive either way (D-CPE-3); a pin whose detail could
 * not be fetched says so and stands.
 *
 * Submit (M3) posts ONE draft per stack or lone point (OQ-C; mapSubmit.ts)
 * to `/admin/api/proposals`, which stores it in the proposals bucket and
 * nowhere else — nothing here publishes. A stored draft's pins leave the
 * device; a refused draft's stay, with the Worker's reason under the
 * button; Access's redirect on the way hands the session loss up to App.
 * The Submitted panel lists the bucket's drafts, `pulled` when
 * `cf_location.py manual pull` has composed one. In a build without the
 * Worker (dev, `vite preview`, the CannonAI embed) both say so and nothing
 * is lost.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import { X } from 'lucide-react'
import type { Basemap } from '../basemap'
import type { FacilityDetail, RosterRow } from '../data/types'
import type { RowDragHandler } from '../StackPopover'
import { createMapEditController } from './mapEditController'
import type { MapEditController } from './mapEditController'
import {
    attachDetail, badgeText, distanceM, loadPins, movePin, newPin, pinFor, removePin, savePins,
    setNote, upsertPin,
} from './mapDraft'
import type { LngLatPair, ProposalPin } from './mapDraft'
import { buildDrafts, draftName, listSubmitted, submitDraft } from './mapSubmit'
import type { SubmitOutcome, SubmittedDraft } from './mapSubmit'
import type { ProbeFetch } from './session'

export const EDIT_BANNER = 'Edit mode. Drag a place to where it is. Nothing is published.'

/** What one draft's Submit came to, for the line under the button. */
export interface BatchResult {
    stack_key: string
    names: string[]
    pins: number
    outcome: SubmitOutcome
}

type ListState =
    | { kind: 'loading' }
    | { kind: 'listed'; drafts: SubmittedDraft[]; truncated: boolean }
    | { kind: 'unavailable'; reason: string }

const realFetch: ProbeFetch = (url, init) => fetch(url, init)

export function MapEditor({
    map, rows, snapshotId, dark, coarse, basemap, lite, getDetail, bindRowDrag, onExit, onSessionLost,
    transport = realFetch,
}: {
    /** The live map, once MapView has it. */
    map: maplibregl.Map | null
    /** The roster as filtered — what the map shows is what can be dragged. */
    rows: readonly RosterRow[]
    snapshotId: string | null
    dark: boolean
    coarse: boolean
    /** What the map is drawn on — recorded in a draft as what the operator saw. */
    basemap: Basemap
    /** The basic map: no detail to fetch, and the draft says which tier it was judged on. */
    lite: boolean
    getDetail: (permitId: string) => Promise<FacilityDetail>
    /** Hand App the stack-row press handler (MapView routes the popover's
     *  rows to it); null on unmount. */
    bindRowDrag: (handler: RowDragHandler | null) => void
    onExit: () => void
    /** A Submit met Access's redirect: the session is gone. */
    onSessionLost: () => void
    /** The fetch the route rides — a spec hands in its own. */
    transport?: ProbeFetch
}) {
    const [pins, setPins] = useState<ProposalPin[]>(() => loadPins(window.localStorage))
    const [refusal, setRefusal] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [results, setResults] = useState<BatchResult[]>([])
    const [submitted, setSubmitted] = useState<ListState>({ kind: 'loading' })
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

    // The Submitted panel: the bucket's drafts, listed once on entry and
    // again after a store. A build without the Worker says so.
    const refreshList = useCallback(async () => {
        const outcome = await listSubmitted(transport)
        if (outcome.state === 'listed') setSubmitted({ kind: 'listed', drafts: outcome.drafts, truncated: outcome.truncated })
        else if (outcome.state === 'signed-out') onSessionLost()
        else setSubmitted({ kind: 'unavailable', reason: outcome.reason })
    }, [transport, onSessionLost])
    useEffect(() => {
        void refreshList()
    }, [refreshList])

    const undo = (permitId: string) => commit(removePin(pinsRef.current, permitId))
    const resetAll = () => commit([])

    const pending = pins.some((p) => p.detail === 'pending')
    const draftCount = useMemo(() => new Set(pins.map((p) => `${p.stack_key}|${p.snapshot_id ?? snapshotId ?? ''}`)).size, [pins, snapshotId])

    // Submit: one draft per stack or lone point, posted in turn. A stored
    // draft's pins leave the device; a refused one's stay with the reason;
    // the session going or the route missing stops the run where it is.
    const submit = async () => {
        if (submitting || !pinsRef.current.length || pending) return
        setSubmitting(true)
        setResults([])
        const drafts = buildDrafts(pinsRef.current, {
            snapshotId: snapshotRef.current,
            tier: lite ? 'lite' : 'full',
            basemap,
            dark: darkRef.current,
            zoom: map?.getZoom() ?? 0,
            rows: rowsRef.current,
        })
        const outcomes: BatchResult[] = []
        let lost = false
        for (const draft of drafts) {
            const outcome = await submitDraft(draft, transport)
            outcomes.push({ stack_key: draft.batch.stack_key, names: draft.pins.map((p) => p.name), pins: draft.pins.length, outcome })
            if (outcome.state === 'stored') {
                const gone = new Set(draft.pins.map((p) => p.permit_id))
                commit(pinsRef.current.filter((p) => !gone.has(p.permit_id)))
            } else if (outcome.state === 'signed-out') {
                lost = true
                break
            } else if (outcome.state === 'unavailable') {
                break
            }
        }
        setResults(outcomes)
        setSubmitting(false)
        if (lost) {
            onSessionLost()
            return
        }
        if (outcomes.some((r) => r.outcome.state === 'stored')) void refreshList()
    }

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
                className={`fixed top-3 right-3 ${DRAWER_BOTTOM} z-30 flex w-[340px] max-w-[calc(100vw-24px)] flex-col rounded-cp-card border border-cp-hairline bg-cp-surface-1 shadow-cp max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-3 max-sm:h-[45vh] max-sm:w-auto`}
            >
                <header className="flex flex-none items-center gap-2 border-b border-cp-hairline px-3.5 py-2.5">
                    <span className="text-cp-13 font-bold">Proposed pins</span>
                    <span className="rounded-cp-pill border border-cp-hairline px-2 py-0.5 text-cp-10.5 tabular-nums text-cp-ink-3" data-cp-pin-count="">
                        {pins.length}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        <button type="button" className={BTN} onClick={resetAll} disabled={!pins.length || submitting}>
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

                <SubmittedPanel state={submitted} />

                <footer className="flex-none border-t border-cp-hairline px-3.5 py-2 text-cp-11 text-cp-ink-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            className={`${BTN} border-[#ff922b] text-cp-ink`}
                            onClick={() => { void submit() }}
                            disabled={!pins.length || submitting || pending}
                            data-cp-submit=""
                        >
                            {submitting ? 'Submitting…' : `Submit ${pins.length} pin${pins.length === 1 ? '' : 's'}`}
                        </button>
                        {pins.length > 0 && (
                            <span data-cp-draft-count="">
                                {draftCount} draft{draftCount === 1 ? '' : 's'} — one per place or stack
                            </span>
                        )}
                    </div>
                    {pending && (
                        <p className="mt-1" role="status">Waiting for site detail before submitting.</p>
                    )}
                    {results.length > 0 && (
                        <ul className="mt-1.5 flex flex-col gap-1" aria-label="Submit results">
                            {results.map((result) => (
                                <li key={result.stack_key} data-cp-result={result.outcome.state} className="leading-snug">
                                    <ResultLine result={result} />
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="mt-1.5">Pins stay on this device until they are submitted or reset.</p>
                </footer>
            </aside>
        </>
    )
}

/** Above `sm` the drawer stops short of the map's bottom-right control lane
 *  (the layers button, Find me, the zoom pair, the attribution — OQ-F,
 *  2026-09-08), so every control stays under the pointer in edit mode; the
 *  lane's own popover, which opens upward, draws OVER the drawer while it is
 *  open (theme.css, `.cp-map-editing`). Below `sm` the bottom sheet's 45vh
 *  already leaves the lane alone. The offset is the lane's measured height
 *  — 190 px, the same at 1024, 1280 and 1440 wide on the production build —
 *  plus the drawer's own 12 px gutter. */
export const DRAWER_BOTTOM = 'sm:bottom-[202px]'

function ResultLine({ result }: { result: BatchResult }) {
    const who = result.names.length === 1 ? result.names[0] : `${result.names[0]} + ${result.names.length - 1}`
    const { outcome } = result
    if (outcome.state === 'stored') {
        return (
            <>
                <span className="font-semibold text-cp-ink">Stored</span>
                {' '}
                <span className="font-mono text-cp-10.5">{draftName(outcome.key)}</span>
                {` · ${outcome.pins} pin${outcome.pins === 1 ? '' : 's'} (${who})`}
                {outcome.existing ? ' · already in the bucket' : ''}
            </>
        )
    }
    if (outcome.state === 'refused') {
        return <><span className="font-semibold text-cp-ink">Refused</span>{` (${who}) — ${outcome.reason}`}</>
    }
    if (outcome.state === 'signed-out') {
        return <>{`Not stored (${who}) — the session has ended. Sign in at /admin to continue.`}</>
    }
    return <>{`Not stored (${who}) — this build cannot store drafts (${outcome.reason}).`}</>
}

function SubmittedPanel({ state }: { state: ListState }) {
    const count = state.kind === 'listed' ? state.drafts.length : null
    return (
        <details className="flex-none border-t border-cp-hairline px-3.5 py-2" data-cp-submitted-panel="">
            <summary className="cursor-pointer text-cp-12 font-semibold">
                Submitted drafts
                {count !== null && (
                    <span className="ml-2 rounded-cp-pill border border-cp-hairline px-2 py-0.5 text-cp-10.5 font-normal tabular-nums text-cp-ink-3" data-cp-submitted-count="">
                        {count}
                    </span>
                )}
            </summary>
            <div className="max-h-[30vh] overflow-y-auto pt-1.5 text-cp-11 text-cp-ink-3">
                {state.kind === 'loading' && <p>Listing…</p>}
                {state.kind === 'unavailable' && (
                    <p>Submitted drafts are not listed in this build ({state.reason}).</p>
                )}
                {state.kind === 'listed' && !state.drafts.length && <p>No drafts submitted yet.</p>}
                {state.kind === 'listed' && state.drafts.length > 0 && (
                    <ul className="flex flex-col gap-1">
                        {state.drafts.map((draft) => (
                            <li key={draft.key} data-cp-submitted={draft.name} className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-mono text-cp-10.5 text-cp-ink">{draft.name}</span>
                                <span>{fmtSavedAt(draft.saved_at)}</span>
                                {draft.pins !== null && <span>{`${draft.pins} pin${draft.pins === 1 ? '' : 's'}`}</span>}
                                <span className={draft.pulled ? 'text-cp-ink-2' : ''}>{draft.pulled ? 'Pulled' : 'Awaiting pull'}</span>
                            </li>
                        ))}
                        {state.truncated && <li>The list stops at the first thousand.</li>}
                    </ul>
                )}
            </div>
        </details>
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

/** A draft's whole-second UTC `saved_at`, in the device's own clock. */
export function fmtSavedAt(savedAt: string | null): string {
    if (!savedAt) return '—'
    const date = new Date(savedAt)
    if (Number.isNaN(date.getTime())) return savedAt
    try {
        return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    } catch {
        return savedAt
    }
}
