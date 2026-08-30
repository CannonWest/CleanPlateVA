/**
 * The router HOOK (CRVa-M0) — the address-bar writer half of the old
 * `router.js` (`routerMethods`), rebuilt over the CRF pure functions
 * (`router.ts`). C6 is the spec; D-CR-ROUTE-1 ratified hand-rolled.
 *
 * The discipline ported verbatim:
 *   · On load and on popstate the URL WINS for every key it names; omitted
 *     keys fall back to their defaults — the four toggles to their
 *     PERSISTED localStorage values, read fresh each time.
 *   · Only non-default state is written, measured against those same
 *     persisted values, so the address bar is reload-stable.
 *   · pushState on a view change and on selecting a facility (Back closes
 *     the panel / returns); replaceState for filter / sort / page churn and
 *     for the load-time normalization (`/map` → `/`, legacy `?zip=` folded
 *     into `q`, legacy `#about` → `/about`).
 *   · Framed (the CannonAI embed): everything is replaceState — the parent
 *     owns history; the frame just keeps its URL current.
 *   · The router never WRITES localStorage; only a toggle's own click
 *     persists (setFlag persists first, so the fresh default swallows the
 *     key on the very write that follows).
 *
 * Each action computes its next state through the pure reducer and writes
 * the URL from THAT — the same state the dispatch lands — so the address
 * bar and the store can never disagree about what was just done.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
    mountFromBaseURI, parseUrlState, pathForView, serializeUrlState,
    storedFlagDefaults, titleForView, viewFromPath,
} from './router'
import type { FlagField, View } from './router'
import { appReducer, defaultSortFor, initialAppState, STORAGE_KEYS } from './store'
import type { AppAction, AppState, Sort } from './store'

export interface RouterActions {
    setView(view: View): void
    setSearch(q: string): void
    setGrade(grade: string): void
    /** Persists to localStorage, then updates state + URL (D-URL-4). */
    setFlag(field: FlagField, value: boolean): void
    /** Select a facility (`permit` in the URL, pushState — Back closes). */
    select(permit: string | null): void
    /** Close the panel from its own control: replaceState, never a push —
     *  Back still walks history the way the visitor built it (C6). */
    closePanel(): void
    setSort(sort: Sort): void
    setPage(page: number): void
}

const FLAG_STORAGE: Record<FlagField, string> = {
    restaurantsOnly: STORAGE_KEYS.RESTAURANTS_ONLY_KEY,
    showClosed: STORAGE_KEYS.SHOW_CLOSED_KEY,
    showNew: STORAGE_KEYS.SHOW_NEW_KEY,
    showMobile: STORAGE_KEYS.SHOW_MOBILE_KEY,
}

/** Framed = the CannonAI Food tab. Cross-origin frames throw on
 *  `window.top` access; treat that as framed too. */
function detectEmbedded(): boolean {
    try {
        return window.self !== window.top
    } catch {
        return true
    }
}

export function useAppRouter(mode: string): [AppState, RouterActions] {
    const [state, dispatch] = useReducer(appReducer, undefined, initialAppState)

    // Learned once: the mount from <base href> (C7 — '/' on the public
    // site, '/cleanplate/' in the embed), framing, the page's own title.
    const env = useMemo(() => ({
        mount: mountFromBaseURI(document.baseURI),
        embedded: detectEmbedded(),
        baseTitle: document.title,
    }), [])

    // Refs so popstate/boot closures never read stale values.
    const stateRef = useRef(state)
    stateRef.current = state
    const modeRef = useRef(mode)
    modeRef.current = mode

    /** Write `next` to the address bar. A no-op when nothing changed;
     *  push only when asked AND not framed. */
    const syncUrl = useCallback((next: AppState, { push = false } = {}) => {
        const path = pathForView(next.view, env.mount)
        const search = serializeUrlState({
            view: next.view,
            filters: next.filters,
            permit: next.permit,
            sort: next.sort,
            page: next.page,
        }, {
            current: window.location.search,
            defaultSort: defaultSortFor(modeRef.current),
            flagDefaults: storedFlagDefaults(window.localStorage, STORAGE_KEYS),
        })
        const target = `${path}${search}`
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
        document.title = titleForView(next.view, env.baseTitle)
        if (target === current) return
        const method = push && !env.embedded ? 'pushState' : 'replaceState'
        try {
            window.history[method](null, '', target)
        } catch {
            /* opaque origin / sandbox */
        }
    }, [env])

    /** Read window.location into state (boot + popstate): every URL key
     *  wins; absent keys fall back — toggles to fresh persisted values.
     *  Returns the state the dispatch lands, for the boot normalization. */
    const applyLocation = useCallback((): AppState => {
        // Legacy `#about` (the pre-routes hash) migrates to the /about view;
        // the normalizing write that follows on boot drops the hash.
        // (`#aboutTerms` still lands on About; the section scroll is the
        // About view's own job — CRV-b.)
        const legacyAbout = window.location.hash.toLowerCase() === '#about'
        const { view } = viewFromPath(window.location.pathname, env.mount)
        const action: AppAction = {
            type: 'location-applied',
            view: legacyAbout ? 'about' : view,
            url: parseUrlState(window.location.search),
            stored: storedFlagDefaults(window.localStorage, STORAGE_KEYS),
            defaultSort: defaultSortFor(modeRef.current),
        }
        const next = appReducer(stateRef.current, action)
        stateRef.current = next
        dispatch(action)
        // The title tracks the view in BOTH directions — Back must retitle
        // the tab just as a forward navigation does.
        document.title = titleForView(next.view, env.baseTitle)
        return next
    }, [env])

    /** Dispatch + mirror into the URL, from the same next state. The ref is
     *  advanced synchronously (the reducer is pure; React will land the
     *  same result), so two actions in one tick chain instead of both
     *  reading the pre-render state — the old client's mutate-then-write
     *  ordering, kept. */
    const act = useCallback((action: AppAction, { push = false } = {}) => {
        const next = appReducer(stateRef.current, action)
        stateRef.current = next
        dispatch(action)
        syncUrl(next, { push })
    }, [syncUrl])

    // Boot: apply the URL, then normalize the address bar (replaceState —
    // same-document, nothing reloads). Then follow Back / Forward; popstate
    // applies WITHOUT writing (the URL is already what the visitor chose).
    useEffect(() => {
        const booted = applyLocation()
        syncUrl(booted, { push: false })
        const onPop = () => {
            applyLocation()
        }
        window.addEventListener('popstate', onPop)
        return () => window.removeEventListener('popstate', onPop)
    }, [applyLocation, syncUrl])

    // The basic map ships no scores: entering lite with the Full default
    // sort still selected falls back to name order (the old
    // `_applyPayload` adjustment).
    useEffect(() => {
        if (mode === 'lite' && stateRef.current.sort.key === 'score') {
            act({ type: 'sort-set', sort: defaultSortFor('lite') }, { push: false })
        }
    }, [mode, act])

    const actions = useMemo<RouterActions>(() => ({
        setView(view) {
            act({ type: 'view-set', view }, { push: true })
        },
        setSearch(q) {
            act({ type: 'search-set', q })
        },
        setGrade(grade) {
            act({ type: 'grade-set', grade })
        },
        setFlag(field, value) {
            // Persist FIRST: the write below measures against the fresh
            // persisted default, so the key drops out of the URL (D-URL-4).
            try {
                window.localStorage.setItem(FLAG_STORAGE[field], value ? '1' : '0')
            } catch {
                /* private mode */
            }
            act({ type: 'flag-set', field, value })
        },
        select(permit) {
            act({ type: 'permit-set', permit }, { push: true })
        },
        closePanel() {
            act({ type: 'permit-set', permit: null })
        },
        setSort(sort) {
            act({ type: 'sort-set', sort })
        },
        setPage(page) {
            act({ type: 'page-set', page })
        },
    }), [act])

    return [state, actions]
}
