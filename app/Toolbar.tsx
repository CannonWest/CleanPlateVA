/**
 * The ONE floating band (§6.2 chrome, CRVa-M0) — brand · Map/List/About
 * switcher · search pill · A–F grade chips · Filters pill · Show closed ·
 * counts, in a single card that reflows into the space left of an open
 * panel (the panel never obscures chrome — the RIGHT sheet, from `sm`
 * up; on a phone the panel is a bottom sheet and the band keeps its
 * full width). Wired to the ported filter
 * predicate through the router actions; every control speaks C6.
 *
 * Tier rules (ported): the basic map hides the judgment controls — grade
 * chips, Show closed, Show newly permitted — and keeps search, Restaurants
 * only, Mobile food units, and the counts (P6).
 *
 * The theme control moved OFF the band at the M0 review (Cannon's call):
 * it's a real switch — `ThemeSwitch` — under the band's left edge on the
 * MAP VIEW since 2026-09-06 (bottom-left before that; the documents carry
 * no switch). The band does not position itself: App places it — the
 * map's fixed column, which carries the panel-aware width, or a plain
 * in-flow wrapper at the head of the List / About documents.
 */

import { useEffect, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import type { RouterActions } from './useAppRouter'
import type { AppState } from './store'
import { VIEWS } from './router'
// Imported, not referenced by path: public/static/** is the retired no-build
// client and vite.config.ts excludes it from the build copy (pinned by
// dist-contract.spec.ts, "the old client (static/**) is not copied"), so a
// /static/img/... src never reaches dist/ and the SPA fallback answers it
// with index.html. An import rides into dist/assets/ content-addressed, and
// Vite resolves it against `base: './'` — which the absolute path also broke,
// since the CannonAI Food tab mounts this build under /cleanplate/.
import logoUrl from './clean-plate-va-logo.png'
import type { View } from './router'
import { FLAG_DEFAULTS } from './router'

const GRADES = ['A', 'B', 'C', 'D', 'F'] as const
const VIEW_LABEL: Record<View, string> = { map: 'Map', list: 'List', about: 'About' }

const PILL = 'inline-flex items-center gap-1.5 rounded-cp-pill border border-cp-hairline '
    + 'bg-cp-surface-2 px-3 py-2 text-cp-12 font-semibold text-cp-ink-2'

/** The canonical form the URL carries (C6): trimmed, lower-cased, internal
 *  whitespace runs collapsed. The box itself keeps whatever was typed. */
function canonicalQuery(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function Toolbar({ state, actions, lite, shown, total }: {
    state: AppState
    actions: RouterActions
    lite: boolean
    shown: number
    total: number
}) {
    const { filters } = state

    // The search box: local value (the visitor's own characters), debounced
    // 150 ms into canonical filter state; clearing is deliberate and skips
    // the debounce. External writes (boot, popstate) win when they differ.
    const [draft, setDraft] = useState(filters.q)
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
        setDraft((current) => (canonicalQuery(current) === filters.q ? current : filters.q))
    }, [filters.q])
    useEffect(() => () => {
        if (debounce.current) clearTimeout(debounce.current)
    }, [])
    const searchInput = useRef<HTMLInputElement>(null)

    // The Filters popover (the three narrowing toggles that are not
    // top-level): closes on outside pointerdown and on Escape.
    const [filtersOpen, setFiltersOpen] = useState(false)
    const popover = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!filtersOpen) return
        const onDown = (e: PointerEvent) => {
            if (!popover.current?.contains(e.target as Node)) setFiltersOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setFiltersOpen(false)
        }
        document.addEventListener('pointerdown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('pointerdown', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [filtersOpen])

    // "Filters · N" counts the popover's own toggles deviating from their
    // shipped defaults — what is actively reshaping the map right now.
    const popoverFlags = (lite
        ? (['restaurantsOnly', 'showMobile'] as const)
        : (['restaurantsOnly', 'showNew', 'showMobile'] as const))
    const deviations = popoverFlags.filter((f) => filters[f] !== FLAG_DEFAULTS[f]).length

    const filtered = shown !== total
    const countTitle = filtered
        ? `${shown.toLocaleString()} of ${total.toLocaleString()} facilities match the active filters`
        : `${total.toLocaleString()} facilities in this snapshot`

    // The card is the first item of App's top column: it takes the
    // column's width (the column carries the viewport / open-panel caps —
    // App.tsx) and wraps its controls inside it.
    return (
        <header
            className="relative z-20 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-cp-card border border-cp-hairline bg-cp-surface-1 px-3 py-2 shadow-cp"
        >
            <div className="flex flex-none items-center gap-2 text-cp-14.5 font-bold">
                <img
                    src={logoUrl}
                    alt=""
                    aria-hidden="true"
                    className="h-[22px] w-[22px] shrink-0 object-contain"
                />
                CleanPlateVA
            </div>

            <nav
                aria-label="View"
                className="flex gap-0.5 rounded-cp-control border border-cp-hairline bg-cp-surface-2 p-[3px]"
            >
                {VIEWS.map((view) => (
                    <button
                        key={view}
                        type="button"
                        aria-current={state.view === view ? 'page' : undefined}
                        onClick={() => actions.setView(view)}
                        className={`rounded-[5px] px-3.5 py-[7px] text-cp-12.5 font-semibold ${
                            state.view === view
                                ? 'bg-cp-accent-solid text-cp-accent-ink'
                                : 'text-cp-ink-2 hover:text-cp-ink'
                        }`}
                    >
                        {VIEW_LABEL[view]}
                    </button>
                ))}
            </nav>

            <div className="flex min-w-[180px] flex-[1_1_200px] items-center gap-2 rounded-cp-pill border border-cp-hairline bg-cp-surface-2 px-3 py-2 text-cp-13 sm:max-w-[360px]">
                <Search size={15} aria-hidden="true" className="shrink-0 text-cp-ink-3" />
                <input
                    ref={searchInput}
                    type="search"
                    value={draft}
                    placeholder="Search name, address, city, or ZIP"
                    aria-label="Search name, address, city, or ZIP"
                    className="w-full min-w-0 bg-transparent outline-none placeholder:text-cp-ink-3 [&::-webkit-search-cancel-button]:hidden"
                    onChange={(e) => {
                        const raw = e.target.value
                        setDraft(raw)
                        if (debounce.current) clearTimeout(debounce.current)
                        debounce.current = setTimeout(() => actions.setSearch(canonicalQuery(raw)), 150)
                    }}
                />
                {draft && (
                    <button
                        type="button"
                        aria-label="Clear search"
                        className="shrink-0 text-cp-ink-3 hover:text-cp-ink"
                        onClick={() => {
                            if (debounce.current) clearTimeout(debounce.current)
                            setDraft('')
                            actions.setSearch('')
                            searchInput.current?.focus()
                        }}
                    >
                        <X size={14} aria-hidden="true" />
                    </button>
                )}
            </div>

            {!lite && (
                <div className="flex items-center gap-1" role="group" aria-label="Grade filter">
                    {GRADES.map((letter) => {
                        const dimmed = filters.grade !== '' && filters.grade !== letter
                        return (
                            <button
                                key={letter}
                                type="button"
                                aria-pressed={filters.grade === letter}
                                title={filters.grade === letter
                                    ? `Showing only grade ${letter} — select again to clear`
                                    : `Show only grade ${letter}`}
                                onClick={() => actions.setGrade(filters.grade === letter ? '' : letter)}
                                className={`h-[26px] min-w-[26px] rounded-[6px] text-cp-11.5 font-bold text-white ${
                                    dimmed ? 'opacity-30' : 'opacity-95'
                                } ${filters.grade === letter ? 'ring-2 ring-cp-focus ring-offset-1 ring-offset-cp-surface-1' : ''}`}
                                style={{ background: `var(--cp-grade-${letter.toLowerCase()})` }}
                            >
                                {letter}
                            </button>
                        )
                    })}
                </div>
            )}

            <div className="relative" ref={popover}>
                <button
                    type="button"
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen((open) => !open)}
                    className={`${PILL} ${deviations ? 'border-cp-accent text-cp-ink' : ''}`}
                >
                    <SlidersHorizontal size={13} aria-hidden="true" />
                    Filters{deviations > 0 && <span className="tabular-nums"> · {deviations}</span>}
                </button>
                {filtersOpen && (
                    <div className="absolute top-full left-0 z-30 mt-1.5 w-60 rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-2 shadow-cp">
                        <FlagRow
                            label="Restaurants only"
                            checked={filters.restaurantsOnly}
                            onChange={(v) => actions.setFlag('restaurantsOnly', v)}
                        />
                        {!lite && (
                            <FlagRow
                                label="Show newly permitted"
                                checked={filters.showNew}
                                onChange={(v) => actions.setFlag('showNew', v)}
                            />
                        )}
                        <FlagRow
                            label="Show mobile food units"
                            checked={filters.showMobile}
                            onChange={(v) => actions.setFlag('showMobile', v)}
                        />
                    </div>
                )}
            </div>

            {!lite && (
                <button
                    type="button"
                    aria-pressed={filters.showClosed}
                    onClick={() => actions.setFlag('showClosed', !filters.showClosed)}
                    className={`${PILL} ${filters.showClosed ? 'border-cp-accent text-cp-ink' : ''}`}
                >
                    Show closed
                </button>
            )}

            <span className="flex-none text-cp-11.5 font-semibold text-cp-ink-3 tabular-nums" title={countTitle}>
                {filtered ? (
                    <>
                        <b className="font-bold text-cp-ink">{shown.toLocaleString()}</b>
                        {' of '}
                        {total.toLocaleString()}
                    </>
                ) : (
                    <b className="font-bold text-cp-ink">{total.toLocaleString()}</b>
                )}
            </span>
        </header>
    )
}

function FlagRow({ label, checked, onChange }: {
    label: string
    checked: boolean
    onChange: (value: boolean) => void
}) {
    return (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-cp-control px-2 py-1.5 text-cp-12.5 text-cp-ink-2 hover:bg-cp-surface-2">
            {label}
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-(--cp-accent-solid)"
            />
        </label>
    )
}
