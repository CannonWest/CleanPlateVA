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
    const { roster, closed, ensureClosed, reload } = useRoster()

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

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-cp-bg">
            <MapView facilities={filtered} lite={lite} dark={dark} />

            <Toolbar
                state={state}
                actions={actions}
                lite={lite}
                shown={filtered.length}
                total={all.length}
                panelOpen={false /* the detail panel lands at CRVa-M2 */}
            />

            {state.view !== 'map' && <ViewStub view={state.view} />}

            <ThemeSwitch
                dark={dark}
                onTheme={(next) => {
                    setDark(next)
                    persistTheme(next)
                }}
            />

            {/* The scrim is dark in BOTH themes (it sits over the map), so
                its ink is fixed light — theme tokens would flip it muddy. */}
            <footer className="fixed bottom-2.5 left-3 z-10 rounded-[6px] bg-cp-scrim px-2.5 py-1.5 text-[10.5px] text-[#cfd4d9] backdrop-blur-[4px]">
                Inspection records: VDH via MyHealthDepartment · archived snapshot, not live ·
                scores and grades calculated by CleanPlateVA ·{' '}
                <button
                    type="button"
                    className="text-[#4dabf7] hover:underline"
                    onClick={() => actions.setView('about')}
                >
                    Terms &amp; attribution
                </button>
            </footer>

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

/** List and About land with CRV-b; the switcher and router already speak
 *  them (C6), so the stub keeps the URL semantics honest meanwhile. */
function ViewStub({ view }: { view: 'list' | 'about' }) {
    return (
        <section className="absolute inset-0 z-10 flex items-center justify-center bg-cp-bg/85 backdrop-blur-[2px]">
            <div className="max-w-sm rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-5 text-center shadow-cp">
                <h2 className="text-[15px] font-bold">
                    {view === 'list' ? 'List' : 'About'}
                </h2>
                <p className="mt-1.5 text-[12.5px] text-cp-ink-2">
                    This view arrives with the next arc (CRV-b). The map — and this
                    address — already work; nothing else is here yet.
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
