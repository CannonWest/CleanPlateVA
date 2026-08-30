/**
 * The app shell (CRVa-M0) — providers (ack · data · router · theme), the
 * §6.2 band, the MapView island, the C8 attribution footer, and stubs for
 * the CRV-b views. Replaces the CRF proof shell; the Agree/Decline strip
 * below is the LAST piece of proof scaffolding, standing in for the §6.1
 * ack dialog until CRV-b builds it (briefing: restyle minimally, don't
 * build the dialog here).
 */
import { useEffect, useMemo, useState } from 'react'
import { ACK_AGREED, ACK_DECLINED, createAckState, forceLiteFromSearch } from './ack'
import { createFoodApi } from './data/client'
import { DataProvider, useRoster } from './data/provider'
import { matchesFilters } from './search'
import { applyThemeClass, persistTheme, storedDark } from './theme'
import { useAppRouter } from './useAppRouter'
import { DetailPanel } from './DetailPanel'
import type { DetailState } from './DetailPanel'
import { ListView } from './ListView'
import { MapView } from './MapView'
import { ThemeSwitch } from './ThemeSwitch'
import { Toolbar } from './Toolbar'
import type { RosterRow } from './data/types'

export function App() {
    const forceLite = useMemo(() => forceLiteFromSearch(window.location.search), [])
    const ack = useMemo(() => createAckState(window.localStorage), [])
    const api = useMemo(
        () => createFoodApi({ forceLite, isAcknowledged: () => ack.agreed }),
        [forceLite, ack],
    )
    return (
        <DataProvider api={api} ack={ack} forceLite={forceLite}>
            <Shell
                forceLite={forceLite}
                agreed={() => ack.agreed}
                decide={(value) => ack.set(value)}
            />
        </DataProvider>
    )
}

function Shell({ forceLite, agreed, decide }: {
    forceLite: boolean
    agreed: () => boolean
    decide: (value: string) => void
}) {
    const { roster, closed, ensureClosed, getDetail, reload } = useRoster()

    const loaded = roster.status === 'ready' && 'facilities' in roster.result
        ? roster.result
        : null
    const mode = loaded?.mode === 'lite' ? 'lite' : 'full'
    const lite = mode === 'lite'

    const [state, actions] = useAppRouter(mode)

    const [dark, setDark] = useState(storedDark)
    useEffect(() => {
        applyThemeClass(dark)
    }, [dark])

    // The full roster the counts measure against: loaded actives + the
    // lazily-merged closed rows (they stay once loaded; the predicate
    // hides them again when the toggle goes off).
    const all = useMemo<RosterRow[]>(() => {
        const facilities = loaded?.facilities ?? []
        return closed.length ? [...facilities, ...closed] : facilities
    }, [loaded, closed])

    const filtered = useMemo(
        () => all.filter((f) => matchesFilters(f, state.filters, mode)),
        [all, state.filters, mode],
    )

    // "Show closed" on the Full tier pulls the lazy closed family the first
    // time it is on (D-DATA-7); the boot never pays for it.
    useEffect(() => {
        if (!lite && loaded && state.filters.showClosed) ensureClosed()
    }, [lite, loaded, state.filters.showClosed, ensureClosed])

    // The selection (`permit` in the URL, C6): the panel opens for a roster
    // row we actually hold — a stale deep link stays harmlessly inert until
    // the roster carries it (the old pending-permit semantics, declaratively).
    const selected = useMemo(
        () => (state.permit ? all.find((f) => String(f.permit_id) === state.permit) ?? null : null),
        [all, state.permit],
    )

    // Detail on CLICK only (+standards once, inside the client) — P5/C3.
    const [detailState, setDetailState] = useState<DetailState>({ status: 'loading' })
    useEffect(() => {
        if (!selected || lite) return
        let alive = true
        setDetailState({ status: 'loading' })
        void getDetail(String(selected.permit_id)).then((detail) => {
            if (alive) setDetailState({ status: 'ready', detail })
        })
        return () => { alive = false }
    }, [selected, lite, getDetail])

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-cp-bg">
            <MapView
                facilities={filtered}
                lite={lite}
                dark={dark}
                onSelect={(pid) => actions.select(pid)}
            />

            {state.view === 'list' ? (
                // The List is a scrolling DOCUMENT (§6.3): the band rides in
                // the flow at the top; the table's own headers stick.
                <div className="absolute inset-0 z-10 overflow-y-auto bg-cp-bg">
                    <Toolbar
                        state={state}
                        actions={actions}
                        lite={lite}
                        shown={filtered.length}
                        total={all.length}
                        panelOpen={!!selected}
                        docked
                    />
                    <ListView
                        rows={filtered}
                        lite={lite}
                        sort={state.sort}
                        page={state.page}
                        selectedPermit={state.permit}
                        onSort={(key) => actions.setSort(
                            state.sort.key === key
                                ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
                                : { key, dir: 'asc' },
                        )}
                        onMore={() => actions.setPage(state.page + 1)}
                        onPick={(pid) => actions.select(pid)}
                    />
                    <Attribution inline onTerms={() => actions.setView('about')} />
                </div>
            ) : (
                <Toolbar
                    state={state}
                    actions={actions}
                    lite={lite}
                    shown={filtered.length}
                    total={all.length}
                    panelOpen={!!selected}
                />
            )}

            {state.view === 'about' && <ViewStub view={state.view} />}

            {selected && (
                <DetailPanel
                    key={String(selected.permit_id)}
                    row={selected}
                    lite={lite}
                    state={detailState}
                    onClose={() => actions.closePanel()}
                    onAbout={() => actions.setView('about')}
                />
            )}

            <ThemeSwitch
                dark={dark}
                onTheme={(next) => {
                    setDark(next)
                    persistTheme(next)
                }}
            />

            {state.view !== 'list' && <Attribution onTerms={() => actions.setView('about')} />}

            {!forceLite && roster.status !== 'loading' && (
                <AckStrip
                    undecided={roster.status === 'awaiting-ack'}
                    agreed={agreed()}
                    onAnswer={(value) => {
                        decide(value)
                        reload()
                    }}
                />
            )}
        </div>
    )
}

/** The C8 attribution line: a scrim chip floating over the map, or an
 *  in-flow line at the end of a scrolling document view. The scrim is
 *  dark in BOTH themes, so the floating variant's ink is fixed light —
 *  theme tokens would flip it muddy. */
function Attribution({ inline = false, onTerms }: {
    inline?: boolean
    onTerms: () => void
}) {
    return (
        <footer
            className={inline
                ? 'mx-4 mb-4 text-[10.5px] text-cp-ink-3'
                : 'fixed bottom-2.5 left-3 z-10 rounded-[6px] bg-cp-scrim px-2.5 py-1.5 text-[10.5px] text-[#cfd4d9] backdrop-blur-[4px]'}
        >
            Inspection records: VDH via MyHealthDepartment · archived snapshot, not live ·
            scores and grades calculated by CleanPlateVA ·{' '}
            <button
                type="button"
                className={inline ? 'text-cp-accent hover:underline' : 'text-[#4dabf7] hover:underline'}
                onClick={onTerms}
            >
                Terms &amp; attribution
            </button>
        </footer>
    )
}

/** About lands at CRVb-M1; the switcher and router already speak it (C6),
 *  so the stub keeps the URL semantics honest meanwhile. */
function ViewStub({ view }: { view: 'about' }) {
    return (
        <section className="absolute inset-0 z-10 flex items-center justify-center bg-cp-bg/85 backdrop-blur-[2px]">
            <div className="max-w-sm rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-5 text-center shadow-cp">
                <h2 className="text-[15px] font-bold">{view === 'about' ? 'About' : ''}</h2>
                <p className="mt-1.5 text-[12.5px] text-cp-ink-2">
                    This view arrives later in this arc (CRVb-M1). The address already
                    works; nothing else is here yet.
                </p>
            </div>
        </section>
    )
}

/** PROOF SCAFFOLDING (CRF-M1, restyled): stands in for the §6.1 ack dialog
 *  until CRV-b. Speaks the ratified action colors — blue is the way to the
 *  grades, red is the way to the basic map (§6.0). */
function AckStrip({ undecided, agreed, onAnswer }: {
    undecided: boolean
    agreed: boolean
    onAnswer: (value: string) => void
}) {
    return (
        <section className="fixed bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-cp-card border border-cp-hairline bg-cp-surface-1/95 px-3 py-2 text-center shadow-cp">
            <p className="text-[11px] text-cp-ink-3">
                Proof scaffolding — the acknowledgment dialog arrives with CRV-b.
                {' '}{undecided ? 'Nothing is fetched until you answer.' : agreed ? 'Grades are on.' : 'Basic map.'}
            </p>
            <div className="mt-1.5 flex items-center justify-center gap-2">
                <button
                    type="button"
                    onClick={() => onAnswer(ACK_DECLINED)}
                    className="rounded-cp-control bg-cp-danger-solid px-2.5 py-1 text-[12px] font-semibold text-white"
                >
                    Decline (proof)
                </button>
                <button
                    type="button"
                    onClick={() => onAnswer(ACK_AGREED)}
                    className="rounded-cp-control bg-cp-accent-solid px-2.5 py-1 text-[12px] font-semibold text-cp-accent-ink"
                >
                    Agree (proof)
                </button>
            </div>
        </section>
    )
}
