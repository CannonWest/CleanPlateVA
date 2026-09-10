/**
 * Routes + URL state
 *
 * The three views are real paths — `/` (Map, canonical; `/map` accepted and
 * normalized), `/list`, `/about`. Only NON-DEFAULT state is written; a toggle's "default" is the
 * visitor's PERSISTED value (what an omitted key falls back to), which is
 * what makes the address bar reload-stable. Legacy `?zip=` folds into `q`
 * once and is never written back.
 */

import { LIST_PAGE_SIZE } from './constants'

export const VIEWS = ['map', 'list', 'about'] as const
export type View = (typeof VIEWS)[number]

const VIEW_SEGMENT: Record<View, string> = { map: '', list: 'list', about: 'about' }
const SEGMENT_VIEW: Record<string, View> = { '': 'map', map: 'map', list: 'list', about: 'about' }

// The keys the router OWNS: parsed on the way in, cleared from the query
// before every write. `zip` stays listed precisely BECAUSE it is retired —
// that is what strips a legacy `?zip=` once its value folds into `q`.
export const URL_KEYS = ['q', 'zip', 'grade', 'restaurants', 'closed', 'new', 'mobile',
    'permit', 'sort', 'dir', 'page'] as const
export const SORT_KEYS = ['address', 'name', 'zip', 'score', 'compliance', 'trend', 'date'] as const
export type SortKey = (typeof SORT_KEYS)[number]
const GRADES = ['A', 'B', 'C', 'D', 'F'] as const

export function parseGrade(raw: string | null): string | undefined {
    if (!raw) return undefined
    const tokens = raw.toUpperCase().split(/[,\s+]+/).map((t) => t.trim()).filter(Boolean)
    const validGrades = GRADES as readonly string[]
    const set = new Set<string>()
    for (const token of tokens) {
        if (token.length === 1 && validGrades.includes(token)) {
            set.add(token)
        } else if (token.length > 1 && token.split('').every((ch) => validGrades.includes(ch))) {
            for (const ch of token) set.add(ch)
        }
    }
    if (set.size === 0) return undefined
    return validGrades.filter((g) => set.has(g)).join(',')
}

// The four persisted toggles: URL key → filter field → shipped default.
export const FLAG_FIELDS = {
    restaurants: 'restaurantsOnly',
    closed: 'showClosed',
    new: 'showNew',
    mobile: 'showMobile',
} as const
export type FlagField = (typeof FLAG_FIELDS)[keyof typeof FLAG_FIELDS]

export const FLAG_DEFAULTS: Record<FlagField, boolean> = {
    restaurantsOnly: false, showClosed: false, showNew: true, showMobile: false,
}
const MAX_PAGE = 10000

export interface UrlState {
    q?: string
    grade?: string
    restaurantsOnly?: boolean
    showClosed?: boolean
    showNew?: boolean
    showMobile?: boolean
    permit?: string
    sortKey?: SortKey
    sortDir?: 'asc' | 'desc'
    page?: number
}

export interface SerializableState {
    view?: string
    filters?: Partial<Record<'q' | 'grade', string>> & Partial<Record<FlagField, boolean>>
    permit?: string | null
    sort?: { key: string; dir: string }
    page?: number
}

/** The mount the page is served under, from `document.baseURI` ('/' on the
 *  public site, '/cleanplate/' in the host embed). Always ends with '/'.
 *  Anything unparseable degrades to '/'. */
export function mountFromBaseURI(baseURI: string): string {
    let pathname: string
    try {
        pathname = new URL(baseURI).pathname
    } catch {
        return '/'
    }
    if (!pathname) return '/'
    return pathname.endsWith('/') ? pathname : pathname.slice(0, pathname.lastIndexOf('/') + 1)
}

/** pathname → `{ view, canonical }` (D-URL-1/2): `/` and `/map` are the Map
 *  (only `/` canonical); trailing-slash and unknown paths resolve to the Map
 *  non-canonically so the client can normalize. Case-insensitive segment. */
export function viewFromPath(pathname: string, mount = '/'): { view: View; canonical: boolean } {
    const path = String(pathname || '/')
    let rest = path.startsWith(mount) ? path.slice(mount.length) : path.replace(/^\/+/, '')
    rest = rest.replace(/\/+$/, '')
    const view = SEGMENT_VIEW[rest.toLowerCase()]
    if (!view) return { view: 'map', canonical: false }
    return { view, canonical: path === pathForView(view, mount) }
}

/** The canonical path for a view under a mount. */
export function pathForView(view: View, mount = '/'): string {
    return `${mount}${VIEW_SEGMENT[view] ?? ''}`
}

/** Per-view document title: the page's own title is the Map's. */
export function titleForView(view: View | string, baseTitle: string): string {
    if (view === 'list') return `List · ${baseTitle}`
    if (view === 'about') return `About · ${baseTitle}`
    return baseTitle
}

/** Query string → the state it names. Only keys the URL carries (and that
 *  validate) appear; everything else is the caller's default. */
export function parseUrlState(search: string): UrlState {
    const p = new URLSearchParams(search || '')
    const s: UrlState = {}
    const qRaw = p.get('q')
    if (qRaw !== null) {
        // Same canonical form the search box produces: trimmed, lower-cased,
        // internal whitespace runs collapsed.
        const q = qRaw.trim().toLowerCase().replace(/\s+/g, ' ')
        if (q) s.q = q
    }
    // Legacy `?zip=` from the retired ZIP select folds into `q` (the search
    // matches ZIP by prefix). A URL carrying BOTH keeps its `q`.
    const zipRaw = p.get('zip')
    if (s.q === undefined && zipRaw !== null && /^\d{5}$/.test(zipRaw.trim())) {
        s.q = zipRaw.trim()
    }
    const gradeRaw = p.get('grade')
    const parsedGrade = parseGrade(gradeRaw)
    if (parsedGrade) {
        s.grade = parsedGrade
    }
    for (const [key, field] of Object.entries(FLAG_FIELDS) as [string, FlagField][]) {
        const raw = p.get(key)
        if (raw === null) continue
        const v = raw.trim().toLowerCase()
        if (v === '1' || v === 'true' || v === 'on') s[field] = true
        else if (v === '0' || v === 'false' || v === 'off') s[field] = false
    }
    const permitRaw = p.get('permit')
    if (permitRaw !== null && /^[0-9A-Za-z-]{4,64}$/.test(permitRaw.trim())) {
        s.permit = permitRaw.trim()
    }
    const sortRaw = p.get('sort')
    if (sortRaw !== null && (SORT_KEYS as readonly string[]).includes(sortRaw.trim().toLowerCase())) {
        s.sortKey = sortRaw.trim().toLowerCase() as SortKey
    }
    const dirRaw = p.get('dir')
    if (dirRaw !== null) {
        const d = dirRaw.trim().toLowerCase()
        if (d === 'asc' || d === 'desc') s.sortDir = d
    }
    const pageRaw = p.get('page')
    if (pageRaw !== null) {
        const n = Number(pageRaw)
        if (Number.isInteger(n) && n >= 1) s.page = Math.min(n, MAX_PAGE)
    }
    return s
}

/** App state → the query string to show (D-URL-4). Writes only non-default
 *  keys (a toggle counts as non-default when it differs from `flagDefaults`
 *  — the visitor's persisted values); List-only keys only on the List; keeps
 *  every foreign param already in `current` (`?tier=lite`). '' or '?…'. */
export function serializeUrlState(state: SerializableState, {
    current = '',
    defaultSort = { key: 'score', dir: 'asc' },
    flagDefaults = FLAG_DEFAULTS,
}: {
    current?: string
    defaultSort?: { key: string; dir: string }
    flagDefaults?: Record<FlagField, boolean>
} = {}): string {
    const p = new URLSearchParams(current || '')
    for (const k of URL_KEYS) p.delete(k)
    const filters = state.filters || {}
    if (filters.q) p.set('q', filters.q)
    if (filters.grade) p.set('grade', filters.grade)
    for (const [key, field] of Object.entries(FLAG_FIELDS) as [string, FlagField][]) {
        const fallback = flagDefaults[field] ?? FLAG_DEFAULTS[field]
        const value = filters[field] ?? fallback
        if (value !== fallback) p.set(key, value ? '1' : '0')
    }
    if (state.permit) p.set('permit', state.permit)
    if (state.view === 'list') {
        const sort = state.sort || defaultSort
        if (sort.key !== defaultSort.key || sort.dir !== defaultSort.dir) {
            p.set('sort', sort.key)
            p.set('dir', sort.dir)
        }
        if (Number(state.page) > 1) p.set('page', String(state.page))
    }
    const qs = p.toString()
    return qs ? `?${qs}` : ''
}

/** Load-more (D-DATA-11): how many of `total` rows page `page` reveals. */
export function revealCount(total: number, page: number | undefined): number {
    const chunks = Math.max(1, Number.isInteger(page) ? (page as number) : 1)
    return Math.min(Math.max(0, total), chunks * LIST_PAGE_SIZE)
}

/** The largest page that still reveals something new for `total` rows. */
export function maxPage(total: number): number {
    return Math.max(1, Math.ceil(Math.max(0, total) / LIST_PAGE_SIZE))
}

export interface StorageKeyNames {
    RESTAURANTS_ONLY_KEY: string
    SHOW_CLOSED_KEY: string
    SHOW_NEW_KEY: string
    SHOW_MOBILE_KEY: string
}

/** The four toggles' persisted defaults, read fresh from localStorage — what
 *  a URL that omits a toggle falls back to (D-URL-4). The router never
 *  WRITES storage; only the visitor's own clicks persist. */
export function storedFlagDefaults(
    storage: { getItem(key: string): string | null },
    keys: StorageKeyNames,
): Record<FlagField, boolean> {
    const read = (k: string): string | null => {
        try {
            return storage.getItem(k)
        } catch {
            return null
        }
    }
    return {
        restaurantsOnly: read(keys.RESTAURANTS_ONLY_KEY) === '1',
        showClosed: read(keys.SHOW_CLOSED_KEY) === '1',
        showNew: read(keys.SHOW_NEW_KEY) !== '0',
        showMobile: read(keys.SHOW_MOBILE_KEY) === '1',
    }
}
