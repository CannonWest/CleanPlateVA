// @vitest-environment jsdom
/**
 * The router HOOK's writer discipline (CRVa-M0) — C6 re-pinned over the
 * live address bar, the way the old `router.js` `routerMethods` behaved:
 *
 *   · boot: the URL wins for every key it names; omitted toggles fall back
 *     to persisted localStorage values; the address normalizes by
 *     replaceState (`/map` → `/`, `?zip=` folds into `q`, `#about` → the
 *     About view) with foreign params (`?tier=lite`) kept;
 *   · pushState on a view change and on selecting a facility; replaceState
 *     for filter churn — measured by history.length;
 *   · non-default-only writes: a toggle equal to its persisted value never
 *     reaches the query string, and persisting happens BEFORE the write;
 *   · framed (the host embed): everything is replaceState;
 *   · popstate: the URL is applied without growing history;
 *   · the basic map falls back to name order when the Full default sort
 *     is still selected.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
    RESTAURANTS_ONLY_KEY, SHOW_CLOSED_KEY, SHOW_NEW_KEY,
} from '../../app/constants'
import { useAppRouter } from '../../app/useAppRouter'
import type { RouterActions } from '../../app/useAppRouter'
import type { AppState } from '../../app/store'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null
const probe: { state?: AppState; actions?: RouterActions } = {}

function Harness({ mode }: { mode: string }) {
    const [state, actions] = useAppRouter(mode)
    probe.state = state
    probe.actions = actions
    return null
}

async function mount(mode = 'full') {
    root = createRoot(host)
    await act(async () => {
        root?.render(<StrictMode><Harness mode={mode} /></StrictMode>)
    })
}

function url(): string {
    return `${window.location.pathname}${window.location.search}`
}

beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
    document.title = 'CleanPlateVA test'
    host = document.createElement('div')
    document.body.appendChild(host)
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    host.remove()
})

test('boot: URL wins, omitted toggles fall back to persisted values, the address normalizes', async () => {
    window.localStorage.setItem(SHOW_NEW_KEY, '0')          // persisted: hide new
    window.localStorage.setItem(RESTAURANTS_ONLY_KEY, '1')  // persisted: restaurants only
    window.history.replaceState(null, '', '/map?zip=23220&closed=1&tier=lite')
    await mount()
    // The URL's keys won; the omitted toggles fell back to storage.
    expect(probe.state?.filters.q).toBe('23220')            // legacy zip folded
    expect(probe.state?.filters.showClosed).toBe(true)      // URL key
    expect(probe.state?.filters.showNew).toBe(false)        // persisted
    expect(probe.state?.filters.restaurantsOnly).toBe(true) // persisted
    // Normalized: /map → /, zip cleared into q, closed kept (differs from
    // persisted default), the foreign ?tier=lite untouched.
    expect(window.location.pathname).toBe('/')
    const params = new URLSearchParams(window.location.search)
    expect(params.get('q')).toBe('23220')
    expect(params.get('zip')).toBeNull()
    expect(params.get('closed')).toBe('1')
    expect(params.get('tier')).toBe('lite')
})

test('boot: the legacy #about hash lands on the About view and the hash drops', async () => {
    window.history.replaceState(null, '', '/#about')
    await mount()
    expect(probe.state?.view).toBe('about')
    expect(window.location.pathname).toBe('/about')
    expect(window.location.hash).toBe('')
    expect(document.title).toBe('About · CleanPlateVA test')
})

test('view change and selection push; filter churn replaces', async () => {
    await mount()
    const before = window.history.length
    await act(async () => {
        probe.actions?.setGrade('A')
    })
    await act(async () => {
        probe.actions?.setSearch('taco richmond')
    })
    expect(url()).toBe('/?q=taco+richmond&grade=A')
    expect(window.history.length).toBe(before)              // replaceState only
    await act(async () => {
        probe.actions?.setView('list')
    })
    expect(window.location.pathname).toBe('/list')
    expect(window.history.length).toBe(before + 1)          // pushState
    expect(document.title).toBe('List · CleanPlateVA test')
    await act(async () => {
        probe.actions?.select('ABC-123')
    })
    expect(new URLSearchParams(window.location.search).get('permit')).toBe('ABC-123')
    expect(window.history.length).toBe(before + 2)          // pushState
})

test('a persisted toggle never reaches the query string (D-URL-4)', async () => {
    await mount()
    await act(async () => {
        probe.actions?.setFlag('showNew', false)
    })
    // Persisted FIRST, so the write right after omits the key.
    expect(window.localStorage.getItem(SHOW_NEW_KEY)).toBe('0')
    expect(probe.state?.filters.showNew).toBe(false)
    expect(url()).toBe('/')
    await act(async () => {
        probe.actions?.setFlag('showClosed', true)
    })
    expect(window.localStorage.getItem(SHOW_CLOSED_KEY)).toBe('1')
    expect(url()).toBe('/')
})

test('popstate applies the URL without growing history', async () => {
    await mount()
    await act(async () => {
        probe.actions?.setGrade('B')
    })
    await act(async () => {
        probe.actions?.setView('list')
    })
    const length = window.history.length
    // Back, as the browser delivers it: the old URL is current again and
    // popstate fires. (jsdom's own traversal is unreliable; replaceState
    // keeps length honest, which is exactly what Back does.)
    await act(async () => {
        window.history.replaceState(null, '', '/?grade=B')
        window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(probe.state?.view).toBe('map')
    expect(probe.state?.filters.grade).toBe('B')
    expect(window.history.length).toBe(length)
    expect(document.title).toBe('CleanPlateVA test')
})

test('framed: everything is replaceState (the parent owns history)', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'top')
    Object.defineProperty(window, 'top', { configurable: true, value: null })
    try {
        await mount()
        const before = window.history.length
        await act(async () => {
            probe.actions?.setView('about')
        })
        expect(window.location.pathname).toBe('/about')
        expect(window.history.length).toBe(before)          // no push in a frame
    } finally {
        if (original) Object.defineProperty(window, 'top', original)
    }
})

test('the basic map falls back to name order from the Full default sort', async () => {
    await mount('lite')
    expect(probe.state?.sort).toEqual({ key: 'name', dir: 'asc' })
})
