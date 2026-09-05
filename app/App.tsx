/**
 * The app shell (CRVa-M0) — providers (ack · data · router · theme), the
 * §6.2 band, the MapView island, the C8 attribution footer, and stubs for
 * the CRV-b views. Replaces the CRF proof shell; the Agree/Decline strip
 * below is the LAST piece of proof scaffolding, standing in for the §6.1
 * ack dialog until CRV-b builds it (briefing: restyle minimally, don't
 * build the dialog here).
 */
import { useEffect, useMemo, useState } from 'react'
import { ACK_DECLINED, createAckState, forceLiteFromSearch } from './ack'
import { createFoodApi } from './data/client'
import { DataProvider, useRoster } from './data/provider'
import { fmtDate } from './data/presentation'
import { matchesFilters } from './search'
import { applyThemeClass, persistTheme, storedDark } from './theme'
import { useAppRouter } from './useAppRouter'
import { AboutView } from './AboutView'
import { AckDialog } from './AckDialog'
import { DetailPanel } from './DetailPanel'
import type { DetailState } from './DetailPanel'
import { ListView } from './ListView'
import { MapView } from './MapView'
import { ThemeSwitch } from './ThemeSwitch'
import { Toolbar } from './Toolbar'
import type { AckState } from './ack'
import type { LoadedRoster, RosterRow } from './data/types'

export function App() {
    const forceLite = useMemo(() => forceLiteFromSearch(window.location.search), [])
    const ack = useMemo(() => createAckState(window.localStorage), [])
    const api = useMemo(
        () => createFoodApi({ forceLite, isAcknowledged: () => ack.agreed }),
        [forceLite, ack],
    )
    return (
        <DataProvider api={api} ack={ack} forceLite={forceLite}>
            <Shell forceLite={forceLite} ack={ack} />
        </DataProvider>
    )
}

function Shell({ forceLite, ack }: {
    forceLite: boolean
    ack: AckState
}) {
    const { roster, closed, ensureClosed, getDetail, reload } = useRoster()

    const loaded = roster.status === 'ready' && 'facilities' in roster.result
        ? (roster.result as LoadedRoster)
        : null
    const unavailable = roster.status === 'ready' && !loaded
    const mode = loaded?.mode === 'lite' ? 'lite' : 'full'
    const lite = mode === 'lite'
    // The attribution line's ambient date (CRP-M0) — the archive's
    // publication day, both tiers ship it in their manifest.
    const snapshot = typeof loaded?.fetched_at === 'string'
        ? loaded.fetched_at.slice(0, 10) : null

    const [state, actions] = useAppRouter(mode)

    // A cold-loaded /about#aboutTerms (the footer link's target): captured
    // before the router's boot effect normalizes the hash away.
    const [termsIntent, setTermsIntent] = useState(
        () => window.location.hash.toLowerCase() === '#aboutterms',
    )
    const showTerms = () => {
        actions.setView('about')
        setTermsIntent(true)
    }

    // The acknowledgement (§6.1): BLOCKING on an undecided first load (the
    // provider is already withholding every fetch, C2); re-openable from
    // About §06's declined-side action any later time.
    const blocking = !forceLite && roster.status === 'awaiting-ack'
    const [termsOpen, setTermsOpen] = useState(false)
    const decide = (value: string, persist = true) => {
        const changed = ack.value !== value
        ack.set(value, { persist })
        setTermsOpen(false)
        // The tier is about to flip; a selection from the old tier must
        // not outlive it (the old _decideAck discipline).
        if (changed && state.permit) actions.closePanel()
        reload()
    }

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

            {blocking ? (
                <GhostShell />
            ) : state.view !== 'map' ? (
                // List and About are scrolling DOCUMENTS (§6.3/§6.4): the
                // band rides in the flow at the top; content scrolls under it.
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
                    {state.view === 'list' ? (
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
                    ) : (
                        <AboutView
                            loaded={loaded}
                            unavailable={unavailable}
                            lite={lite}
                            forceLite={forceLite}
                            ack={{ agreed: ack.agreed, decided: ack.decided, persisted: ack.persisted }}
                            onSwitchToBasic={() => {
                                // A downgrade needs no acknowledgement (ack.js).
                                ack.set(ACK_DECLINED)
                                reload()
                            }}
                            onReviewTerms={() => setTermsOpen(true)}
                            scrollToTerms={termsIntent}
                            onTermsShown={() => setTermsIntent(false)}
                        />
                    )}
                    <Attribution inline snapshot={snapshot} onTerms={showTerms} />
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

            {!blocking && (
                <ThemeSwitch
                    dark={dark}
                    onTheme={(next) => {
                        setDark(next)
                        persistTheme(next)
                    }}
                />
            )}

            {state.view === 'map' && !blocking && (
                <Attribution snapshot={snapshot} onTerms={showTerms} />
            )}

            {(blocking || termsOpen) && (
                <AckDialog
                    blocking={blocking}
                    onDecide={(value) => decide(value)}
                    onEscapeDecline={() => decide(ACK_DECLINED, false)}
                    onClose={() => setTermsOpen(false)}
                />
            )}
        </div>
    )
}

/** The first-load shell behind the blocking dialog (§6.1): brand + search
 *  render but nothing is live and nothing has fetched (C2) — the empty
 *  basemap shows through beneath the scrim. */
function GhostShell() {
    return (
        <div className="pointer-events-none fixed top-3 right-3 left-3 z-10 flex items-center gap-2.5" aria-hidden="true">
            <div className="flex items-center gap-2 rounded-cp-card border border-cp-hairline bg-cp-surface-1 px-3.5 py-2 text-[14.5px] font-bold shadow-cp">
                <span className="h-[18px] w-[18px] rounded-full border-[2.5px] border-cp-accent" />
                CleanPlateVA
            </div>
            <div className="max-w-[420px] flex-1 rounded-cp-pill border border-cp-hairline bg-cp-surface-1 px-3.5 py-2 text-[13px] text-cp-ink-3 shadow-cp">
                Search name, address, city, or ZIP
            </div>
        </div>
    )
}

/** The C8 attribution line: a scrim chip floating over the map, or an
 *  in-flow line at the end of a scrolling document view. The scrim is
 *  dark in BOTH themes, so the floating variant's ink is fixed light —
 *  theme tokens would flip it muddy. The snapshot date rides the line
 *  (CRP-M0): staleness stays ambient on every view — About's live cards
 *  carry the fuller snapshot / newest-report pair. */
function Attribution({ inline = false, snapshot = null, onTerms }: {
    inline?: boolean
    snapshot?: string | null
    onTerms: () => void
}) {
    return (
        <footer
            className={inline
                ? 'mx-4 mb-4 text-[10.5px] text-cp-ink-3'
                : 'fixed bottom-2.5 left-3 z-10 rounded-[6px] bg-cp-scrim px-2.5 py-1.5 text-[10.5px] text-[#cfd4d9] backdrop-blur-[4px]'}
        >
            Inspection records: VDH and Fairfax County Health Department · archived snapshot
            {snapshot ? ` · ${fmtDate(snapshot)}` : ''} ·
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

