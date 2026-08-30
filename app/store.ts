/**
 * App-level UI state (design ref §4, D-CR-STATE-1: context + reducers
 * first). One store shape carries what the URL names (C6): the view, the
 * six filters, the selection, and the List's sort/page. The router hook
 * (`useAppRouter`) is the only writer of `location-applied`; everything
 * else is a control's own dispatch. Roster data lives in the DataProvider,
 * not here — this is the state a shared link carries plus nothing.
 */

import {
    RESTAURANTS_ONLY_KEY, SHOW_CLOSED_KEY, SHOW_MOBILE_KEY, SHOW_NEW_KEY,
} from './constants'
import type { FilterState } from './search'
import type { FlagField, SortKey, StorageKeyNames, UrlState, View } from './router'
import { FLAG_DEFAULTS } from './router'

export interface AppFilters extends FilterState {
    q: string
    grade: string
    restaurantsOnly: boolean
    showClosed: boolean
    showNew: boolean
    showMobile: boolean
}

export interface Sort {
    key: SortKey
    dir: 'asc' | 'desc'
}

export interface AppState {
    view: View
    filters: AppFilters
    /** The selected facility (detail panel, M2) — `permit` in the URL. */
    permit: string | null
    sort: Sort
    page: number
}

export const STORAGE_KEYS: StorageKeyNames = {
    RESTAURANTS_ONLY_KEY: RESTAURANTS_ONLY_KEY,
    SHOW_CLOSED_KEY: SHOW_CLOSED_KEY,
    SHOW_NEW_KEY: SHOW_NEW_KEY,
    SHOW_MOBILE_KEY: SHOW_MOBILE_KEY,
}

/** The List's default sort — worst-first by score, or by name on the basic
 *  map, which ships no scores (C6). */
export function defaultSortFor(mode: string): Sort {
    return mode === 'lite'
        ? { key: 'name', dir: 'asc' }
        : { key: 'score', dir: 'asc' }
}

export function initialAppState(): AppState {
    return {
        view: 'map',
        filters: { q: '', grade: '', ...FLAG_DEFAULTS },
        permit: null,
        sort: defaultSortFor('full'),
        page: 1,
    }
}

export type AppAction =
    /** The URL won (boot / popstate): replace everything it names. */
    | { type: 'location-applied'; view: View; url: UrlState; stored: Record<FlagField, boolean>; defaultSort: Sort }
    | { type: 'view-set'; view: View }
    | { type: 'search-set'; q: string }
    | { type: 'grade-set'; grade: string }
    | { type: 'flag-set'; field: FlagField; value: boolean }
    | { type: 'permit-set'; permit: string | null }
    | { type: 'sort-set'; sort: Sort }
    | { type: 'page-set'; page: number }

/** Filter churn returns the List to its first page (C6) — the old
 *  `filtersChanged()` discipline. */
function withFilters(state: AppState, filters: AppFilters): AppState {
    return { ...state, filters, page: 1 }
}

export function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case 'location-applied': {
            const { url, stored, defaultSort } = action
            return {
                view: action.view,
                filters: {
                    q: url.q ?? '',
                    grade: url.grade ?? '',
                    restaurantsOnly: url.restaurantsOnly ?? stored.restaurantsOnly,
                    showClosed: url.showClosed ?? stored.showClosed,
                    showNew: url.showNew ?? stored.showNew,
                    showMobile: url.showMobile ?? stored.showMobile,
                },
                permit: url.permit ?? null,
                sort: {
                    key: url.sortKey ?? defaultSort.key,
                    dir: url.sortDir ?? (url.sortKey ? 'asc' : defaultSort.dir),
                },
                page: url.page ?? 1,
            }
        }
        case 'view-set':
            return state.view === action.view ? state : { ...state, view: action.view }
        case 'search-set':
            return withFilters(state, { ...state.filters, q: action.q })
        case 'grade-set':
            return withFilters(state, { ...state.filters, grade: action.grade })
        case 'flag-set':
            return withFilters(state, { ...state.filters, [action.field]: action.value })
        case 'permit-set':
            return state.permit === action.permit ? state : { ...state, permit: action.permit }
        case 'sort-set':
            return { ...state, sort: action.sort, page: 1 }
        case 'page-set':
            return { ...state, page: action.page }
        default:
            return state
    }
}
