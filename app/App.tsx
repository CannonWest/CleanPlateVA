/**
 * The app shell (CRVa-M0) — providers (ack · data · router · theme), the
 * §6.2 band, the MapView island, the C8 attribution footer, and stubs for
 * the CRV-b views. Replaces the CRF proof shell; the Agree/Decline strip
 * below is the LAST piece of proof scaffolding, standing in for the §6.1
 * ack dialog until CRV-b builds it (briefing: restyle minimally, don't
 * build the dialog here).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ACK_DECLINED, createAckState, forceLiteFromSearch } from './ack'
import { createFoodApi } from './data/client'
import { DataProvider, useRoster } from './data/provider'
import { fmtDate } from './data/presentation'
import { matchesFilters } from './search'
import {
    applyThemeClass, DARK_SCHEME_QUERY, persistTheme, resolveDark, storedTheme, systemPrefersDark,
} from './theme'
import type { ThemeChoice } from './theme'
import { persistClusters, storedClusters } from './clusters'
import { applyPaletteClass, persistPalette, storedPalette } from './palette'
import type { GradePalette } from './constants'
import {
    applyTextSize, persistSettingsHintDismissed, persistSettingsSeen, persistTextSize,
    storedSettingsHintDismissed, storedSettingsSeen, storedTextSize,
} from './settings'
import { useAppRouter } from './useAppRouter'
import { AckDialog } from './AckDialog'
import { EditButton } from './admin/EditButton'
import { clearSession, persistSession, probeSession, storedSession } from './admin/session'
import type { AdminSession } from './admin/session'
import { DetailPanel } from './DetailPanel'
import type { DetailState } from './DetailPanel'
import { MapView } from './MapView'
import { SettingsButton } from './SettingsButton'
import { SettingsDialog } from './SettingsDialog'
import { SettingsHint } from './SettingsHint'
import { Toolbar } from './Toolbar'
import type { AckState } from './ack'
import type { LoadedRoster, RosterRow } from './data/types'

// The List and About documents load on demand (CRP-M5, the bundle diet):
// neither is on the map view's critical path, so their code leaves the
// entry chunk and arrives the first time a visitor switches view (a deep
// link to /list or /about fetches it alongside the data). A chunk is a
// static asset — free on Workers, cached like the rest of the build — so
// the request budget (C3) is untouched: zero Worker requests either way.
const AboutView = lazy(() => import('./AboutView').then((m) => ({ default: m.AboutView })))
const ListView = lazy(() => import('./ListView').then((m) => ({ default: m.ListView })))
// The About edit mode (CPE-M1, §6.6): its own lazy chunk, fetched the first
// time a signed-in device enters it — a visitor's page never loads it.
const AboutEditor = lazy(() => import('./admin/AboutEditor').then((m) => ({ default: m.AboutEditor })))

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

    // Arrived at a PLACE (`?permit=` on the URL at boot): the auto-locate
    // stands down for this page load — the visitor came for the place, and
    // a fix flying the camera to their own location would take it away
    // (mapCamera.ts). A later click is not an arrival.
    const [arrivedAtPlace] = useState(() => !!state.permit)

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
    // About §05's declined-side action any later time.
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

    // The theme (theme.ts): the visitor's three-way choice, resolved against
    // the device's appearance — 'system' (the default) re-resolves when
    // that setting changes under the page. The RESOLVED theme is what the
    // class on <html> and the map's basemap follow.
    const [theme, setTheme] = useState<ThemeChoice>(storedTheme)
    const [systemDark, setSystemDark] = useState(systemPrefersDark)
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return
        const query = window.matchMedia(DARK_SCHEME_QUERY)
        const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
        query.addEventListener('change', onChange)
        return () => query.removeEventListener('change', onChange)
    }, [])
    const dark = resolveDark(theme, systemDark)
    useEffect(() => {
        applyThemeClass(dark)
    }, [dark])
    const onTheme = (next: ThemeChoice) => {
        setTheme(next)
        persistTheme(next)
    }

    // The grade palette (palette.ts): the class on <html> re-points the
    // grade tokens for every DOM surface; the map takes the palette by name
    // for its paint and the donut canvas.
    const [palette, setPalette] = useState<GradePalette>(storedPalette)
    useEffect(() => {
        applyPaletteClass(palette)
    }, [palette])
    const onPalette = (next: GradePalette) => {
        setPalette(next)
        persistPalette(next)
    }

    // "Group nearby places" (CRP-M6): a presentation preference like the
    // theme — persisted per visitor, never in the URL or AppState (C6).
    const [clusters, setClusters] = useState(storedClusters)
    const onClusters = (next: boolean) => {
        persistClusters(next)
        setClusters(next)
    }

    // The text size (settings.ts): the body size in px, reflected on <html>
    // as the scale every text size in the stylesheet multiplies by.
    const [textSize, setTextSize] = useState(storedTextSize)
    useEffect(() => {
        applyTextSize(textSize)
    }, [textSize])
    const onTextSize = (next: number) => {
        setTextSize(next)
        persistTextSize(next)
    }

    // The settings dialog holds the three choices above. It opens on its
    // own ONCE — a visitor's first map view, after the acknowledgement has
    // been answered (never over the blocking dialog) — and from the button
    // under the band any later time. "Seen" is stored when it opens, so a
    // reload mid-dialog does not ask again.
    const [settingsOpen, setSettingsOpen] = useState(false)
    const settingsIntroduced = useRef(storedSettingsSeen())
    useEffect(() => {
        if (blocking || state.view !== 'map' || settingsIntroduced.current) return
        settingsIntroduced.current = true
        persistSettingsSeen()
        setSettingsOpen(true)
    }, [blocking, state.view])

    // The hint under the pill (2026-09-07): where the choices live, for
    // after that one self-opening closes. It outlives the dialog rather
    // than racing it — rendered behind the scrim on a first visit, still
    // there when the scrim goes — and stands on every map view until the
    // visitor closes it OR opens Settings from the pill, which answers the
    // same question. Nothing times it out.
    const [hintDismissed, setHintDismissed] = useState(storedSettingsHintDismissed)
    const dismissHint = () => {
        if (hintDismissed) return
        setHintDismissed(true)
        persistSettingsHintDismissed()
    }

    // The admin's edit modes (CPE-M1, §6.6). The device flag decides whether
    // the Edit control renders at all — a visitor's device carries none, so
    // a visitor's page renders no control and never probes. An Edit click
    // confirms the session with ONE probe (app/admin/session.ts): Access's
    // redirect means signed out (the flag is cleared, the sign-in line
    // shows), the Worker's identity means the mode opens. Edit mode needs
    // the acknowledged tier: the document worth editing is the full one.
    const [adminSession, setAdminSession] = useState<AdminSession | null>(() => storedSession(window.localStorage))
    const [editing, setEditing] = useState(false)
    const [probing, setProbing] = useState(false)
    const [editNote, setEditNote] = useState<string | null>(null)
    const enterEdit = () => {
        if (probing) return
        if (!ack.agreed) {
            setEditNote('Edit mode needs the acknowledged tier. Agree to the terms first.')
            return
        }
        setProbing(true)
        void probeSession().then((result) => {
            setProbing(false)
            if (result.state === 'signed-in') {
                persistSession(window.localStorage, result.session)
                setAdminSession(result.session)
                setEditNote(null)
                setEditing(true)
            } else if (result.state === 'signed-out') {
                clearSession(window.localStorage)
                setAdminSession(null)
                setEditNote('Sign in at /admin to continue.')
            } else {
                setEditNote(`Session verification is unavailable (${result.reason}).`)
            }
        })
    }
    const exitEdit = () => setEditing(false)
    // A mode belongs to its view: leaving About leaves the mode.
    useEffect(() => {
        if (state.view !== 'about' && editing) setEditing(false)
    }, [state.view, editing])

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

    // The About document, rendered once here so the edit mode can wrap the
    // SAME element it would otherwise show — live data, live tier.
    const about = (
        <AboutView
            loaded={loaded}
            unavailable={unavailable}
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
    )

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-cp-bg">
            <MapView
                facilities={filtered}
                lite={lite}
                dark={dark}
                clusters={clusters}
                palette={palette}
                onSelect={(pid) => actions.select(pid)}
                locateReady={!blocking && !arrivedAtPlace}
                selected={selected}
            />

            {blocking ? (
                <GhostShell />
            ) : state.view !== 'map' ? (
                // List and About are scrolling DOCUMENTS (§6.3/§6.4): the
                // band rides in the flow at the top; content scrolls under
                // it. NO settings button here — it is the map view's
                // control (Cannon's call 2026-09-06): a document is a page
                // of records, and the presentation choices belong with the
                // thing they present. The choices themselves still hold
                // (the theme class and the text scale are on <html>, not
                // on the view), and persist across every view.
                <div className="absolute inset-0 z-10 overflow-y-auto bg-cp-bg">
                    <div className="mx-3 mt-3">
                        <Toolbar
                            state={state}
                            actions={actions}
                            lite={lite}
                            shown={filtered.length}
                            total={all.length}
                        />
                    </div>
                    <Suspense fallback={<ViewLoading />}>
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
                        <>
                            {(adminSession || editNote) && (
                                // The admin's Edit control at the document's head
                                // (§6.6): only a device holding the session flag
                                // renders it. The note beside it is the probe's
                                // answer when the mode did not open — and once a
                                // note is up the row stays for this page load even
                                // after a signed-out probe cleared the flag, so the
                                // click that was just made has a visible answer;
                                // the next load renders nothing, as for a visitor.
                                <div className="mx-auto flex max-w-[52rem] flex-wrap items-center gap-3 px-4 pt-3">
                                    <EditButton
                                        editing={editing}
                                        busy={probing}
                                        onClick={editing ? exitEdit : enterEdit}
                                    />
                                    {editNote && (
                                        <span className="text-cp-12.5 text-cp-ink-3" role="status">{editNote}</span>
                                    )}
                                </div>
                            )}
                            {editing ? (
                                <Suspense fallback={null}>
                                    <AboutEditor onExit={exitEdit}>{about}</AboutEditor>
                                </Suspense>
                            ) : about}
                        </>
                    )}
                    </Suspense>
                    <Attribution inline snapshot={snapshot} onTerms={showTerms} />
                </div>
            ) : (
                // The map view's top-left as ONE self-stacking column — the
                // band, with the settings button hanging under its left edge
                // (where the theme switch stood until the settings dialog
                // took the theme, 2026-09-06) — so the button never depends
                // on the band's height, which wraps with the viewport and
                // beside an open panel. The column is as wide as the band,
                // capped at the viewport's gutters and, beside an OPEN panel
                // from `sm` up (the right sheet takes 400px + gutters), at
                // what is left; below `sm` the panel is a full-screen sheet
                // (DetailPanel's max-sm rules) and the column keeps the full
                // width — the caps are the band's own from the mobile fix of
                // 2026-09-06 (an inline min(100vw - 24px, 100vw - 448px)
                // went negative on a phone and collapsed the band). Only the
                // two children take the pointer, so the map still drags
                // beside the button. (Whole class strings, whitespace-
                // delimited: Tailwind's scanner drops one glued to a `${`.)
                <div
                    className={`pointer-events-none fixed top-3 left-3 z-20 flex flex-col gap-2.5 [&>*]:pointer-events-auto ${
                        selected
                            ? 'max-w-[calc(100vw-24px)] sm:max-w-[calc(100vw-448px)]'
                            : 'max-w-[calc(100vw-24px)]'
                    }`}
                >
                    <Toolbar
                        state={state}
                        actions={actions}
                        lite={lite}
                        shown={filtered.length}
                        total={all.length}
                    />
                    <SettingsButton
                        onClick={() => {
                            dismissHint()
                            setSettingsOpen(true)
                        }}
                    />
                    {!hintDismissed && <SettingsHint onDismiss={dismissHint} />}
                </div>
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

            {state.view === 'map' && !blocking && (
                // The bottom-left corner: the attribution chip in a
                // pointer-transparent column box (the cluster switch stood
                // over it until the settings dialog took it, 2026-09-06; the
                // column idiom stays, so a control can return above the chip
                // without re-deriving the rules below). Below `sm` the box
                // stops short of the map's bottom-right control lane, so the
                // chip wraps beside the zoom and locate buttons instead of
                // under them, and sits above the basemap's attribution strip:
                // on a map under 640px MapLibre's attribution is compact and
                // opens EXPANDED until the first drag, its text reaching left
                // under the chip otherwise. From `sm` up the same lane needs
                // its own stop (measured 2026-09-06): the (i) control's
                // hover/click expansion is ~320px wide plus its own 10px
                // margin, and a long attribution sentence at a merely-wide-
                // not-huge desktop width reaches that corner too —
                // `sm:right-[360px]` clears it with room to spare, wrapping
                // the chip to a second line rather than running under the
                // expanded control. Only the chip takes the pointer, so the
                // map beside it still drags.
                <div className="pointer-events-none fixed bottom-2.5 left-3 z-10 flex flex-col items-start gap-1.5 sm:right-[360px] max-sm:right-[54px] max-sm:bottom-[38px] [&>*]:pointer-events-auto">
                    <Attribution snapshot={snapshot} onTerms={showTerms} />
                </div>
            )}

            {(blocking || termsOpen) && (
                <AckDialog
                    blocking={blocking}
                    onDecide={(value) => decide(value)}
                    onEscapeDecline={() => decide(ACK_DECLINED, false)}
                    onClose={() => setTermsOpen(false)}
                />
            )}

            <SettingsDialog
                open={settingsOpen && !blocking}
                onOpenChange={setSettingsOpen}
                theme={theme}
                palette={palette}
                clusters={clusters}
                textSize={textSize}
                onTheme={onTheme}
                onPalette={onPalette}
                onClusters={onClusters}
                onTextSize={onTextSize}
            />
        </div>
    )
}

/** The document area while a lazily-loaded view's chunk is in flight
 *  (CRP-M5): the band above it is already live, so this only holds the
 *  space — no words (C8 has nothing to say here), no spinner; the chunk is
 *  a few KB and cached after the first visit. */
function ViewLoading() {
    return <div className="min-h-[50vh]" aria-busy="true" />
}

/** The first-load shell behind the blocking dialog (§6.1): brand + search
 *  render but nothing is live and nothing has fetched (C2) — the empty
 *  basemap shows through beneath the scrim. */
function GhostShell() {
    return (
        <div className="pointer-events-none fixed top-3 right-3 left-3 z-10 flex items-center gap-2.5" aria-hidden="true">
            <div className="flex items-center gap-2 rounded-cp-card border border-cp-hairline bg-cp-surface-1 px-3.5 py-2 text-cp-14.5 font-bold shadow-cp">
                <span className="h-[18px] w-[18px] rounded-full border-[2.5px] border-cp-accent" />
                CleanPlateVA
            </div>
            <div className="max-w-[420px] flex-1 rounded-cp-pill border border-cp-hairline bg-cp-surface-1 px-3.5 py-2 text-cp-13 text-cp-ink-3 shadow-cp">
                Search name, address, city, or ZIP
            </div>
        </div>
    )
}

/** The C8 attribution line: a scrim chip over the map (placed by the
 *  corner column above), or an in-flow line at the end of a scrolling
 *  document view. The scrim is
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
                ? 'mx-4 mb-4 text-cp-10.5 text-cp-ink-3'
                : 'rounded-[6px] bg-cp-scrim-2 px-2.5 py-1.5 text-cp-10.5 font-semibold text-[#cfd4d9] backdrop-blur-[4px]'}
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

