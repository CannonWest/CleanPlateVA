/**
 * The List view (§6.3, CRVb-M0) — the roster as a dense sortable table,
 * drawing ONLY on finder + overlay fields (frozen contract): grade chip +
 * score · name over address/city/zip · compliance % · trend (colored
 * arrow + signed delta, em-dash when null) · last visit (date +
 * scope/outcome). Sticky headers carry the active sort in accent with a
 * direction arrow (C6 `sort`/`dir`); closed rows render muted with a
 * CLOSED word-badge (they exist only while "Show closed" is on); NEW is
 * the blue-dot word-badge; load-more reveals 50 per chunk and writes
 * `page=N` (D-DATA-11). Row click opens the shared detail panel.
 *
 * The basic map keeps identity columns only (P6): name over address —
 * no judgment column exists on that tier.
 *
 * Sort semantics port the old `list.js` — the seven C6 keys with their
 * comparator forms — with ONE Cannon-directed change (CRVb-M1 boundary,
 * 2026-08-30): on the VALUE sorts (score/compliance/trend/date), rows
 * MISSING the sorted value go last in both directions, so "worst first"
 * leads with the worst actual grades instead of the ungraded/NEW block
 * the old −1 sentinel floated to the top.
 */

import { useRef } from 'react'
import { MoveRight, TrendingDown, TrendingUp } from 'lucide-react'
import { LIST_PAGE_SIZE } from './constants'
import { facilityPresentation, focusedOutcomePresentation, gradeColor, isActivePermit, isNewlyPermitted } from './data/presentation'
import { maxPage, revealCount } from './router'
import type { SortKey } from './router'
import type { Sort } from './store'
import type { RosterRow } from './data/types'

/** One row's comparable value + whether the row is MISSING that value
 *  entirely (old `list.js` `val`, plus the missing flag the nulls-last
 *  rule keys on). */
export function sortEntry(f: RosterRow, key: SortKey): { v: string | number; missing: boolean } {
    const fp = facilityPresentation(f)
    const assessment = (fp.assessmentRecord ?? {}) as { compliance_rate?: number | null }
    switch (key) {
        case 'address': return { v: `${f.address || ''} ${f.address2 || ''}`.trim().toLowerCase(), missing: false }
        case 'name': return { v: (f.name || '').toLowerCase(), missing: false }
        case 'zip': return { v: f.zip || '', missing: false }
        case 'score': return { v: fp.grade?.score ?? -1, missing: fp.grade?.score == null }
        case 'compliance': {
            const rate = assessment.compliance_rate
            return { v: rate ?? -1, missing: rate == null }
        }
        case 'trend': return { v: fp.trendDelta ?? 0, missing: fp.trendDelta == null }
        case 'date': return { v: fp.latestDate || '', missing: !fp.latestDate }
        default: return { v: 0, missing: false }
    }
}

/** The comparable value alone (the old `val` shape, for callers/tests). */
export function sortValue(f: RosterRow, key: SortKey): string | number {
    return sortEntry(f, key).v
}

/** Sorted copy — stable within equal keys, direction-aware, rows missing
 *  the sorted value LAST in both directions (Cannon's call: worst-first
 *  means the worst actual grades lead). Decorated first so the
 *  presentation derivation runs once per ROW, not once per comparison
 *  (the old client paid n·log n derivations per sort). */
export function sortRows(rows: RosterRow[], sort: Sort): RosterRow[] {
    return rows
        .map((f) => ({ f, ...sortEntry(f, sort.key) }))
        .sort((a, b) => {
            if (a.missing !== b.missing) return a.missing ? 1 : -1
            if (a.v < b.v) return sort.dir === 'asc' ? -1 : 1
            if (a.v > b.v) return sort.dir === 'asc' ? 1 : -1
            return 0
        })
        .map(({ f }) => f)
}

/** The "last visit" cell's scope/outcome suffix, from the overlay. */
function visitSuffix(f: RosterRow): string {
    const latest = facilityPresentation(f).latest
    if (latest.scope === 'broad') return 'broad'
    if (latest.scope === 'focused') {
        const outcome = focusedOutcomePresentation(latest)
        return outcome.ratioKnown ? `${outcome.out}/${outcome.total} OUT` : 'focused'
    }
    return ''
}

function ScoreCell({ f }: { f: RosterRow }) {
    const grade = facilityPresentation(f).grade
    if (grade) {
        return (
            <span className="flex items-center gap-2">
                <span
                    className="flex h-[26px] min-w-[26px] items-center justify-center rounded-[6px] text-cp-11.5 font-bold text-white"
                    style={{ background: gradeColor(grade.letter) }}
                >
                    {grade.letter}
                </span>
                <span className="font-bold tabular-nums">{grade.score}</span>
            </span>
        )
    }
    if (isNewlyPermitted(f)) {
        return (
            <span
                className="inline-flex rounded-[6px] px-1.5 py-1 text-cp-10.5 font-bold text-white"
                style={{ background: 'var(--cp-new)' }}
                title="Newly permitted; grade pending a broad inspection"
            >
                NEW
            </span>
        )
    }
    return <span className="text-cp-ink-3" title="No broad inspection captured">—</span>
}

function TrendCell({ delta }: { delta: number | null }) {
    if (delta == null) return <span className="text-cp-ink-3">—</span>
    const [Icon, color] = delta < 0
        ? [TrendingDown, 'var(--cp-grade-d)']
        : delta > 0
            ? [TrendingUp, 'var(--cp-grade-a)']
            : [MoveRight, 'var(--cp-ink-3)']
    return (
        <span className="inline-flex items-center gap-1 font-semibold tabular-nums" style={{ color }}>
            <Icon size={13} aria-hidden="true" />
            {delta > 0 ? `+${delta}` : String(delta)}
        </span>
    )
}

const HEADERS: Array<{ key: SortKey; label: string; narrow?: boolean }> = [
    { key: 'score', label: 'Score' },
    { key: 'name', label: 'Name' },
    { key: 'compliance', label: 'Compliance', narrow: true },
    { key: 'trend', label: 'Trend', narrow: true },
    { key: 'date', label: 'Last visit' },
]

export function ListView({ rows, lite, sort, page, selectedPermit, onSort, onMore, onPick }: {
    /** The FILTERED roster (the predicate already ran). */
    rows: RosterRow[]
    lite: boolean
    sort: Sort
    page: number
    selectedPermit: string | null
    onSort: (key: SortKey) => void
    onMore: () => void
    onPick: (permitId: string) => void
}) {
    const body = useRef<HTMLTableSectionElement>(null)

    const sorted = sortRows(rows, sort)
    // A stale URL page never claims more chunks than the list has.
    const shown = revealCount(sorted.length, Math.min(page, maxPage(sorted.length)))
    const visible = sorted.slice(0, shown)
    const remaining = sorted.length - shown

    const headers = lite ? HEADERS.filter((h) => h.key === 'name') : HEADERS

    return (
        <div className="mx-3 mt-3.5 mb-3 overflow-hidden rounded-cp-card border border-cp-hairline bg-cp-surface-1 shadow-cp">
            <table className="w-full border-collapse text-cp-13">
                <thead>
                    <tr>
                        {headers.map(({ key, label, narrow }) => {
                            const active = sort.key === key
                            return (
                                <th
                                    key={key}
                                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    onClick={() => onSort(key)}
                                    className={`sticky top-0 z-10 cursor-pointer border-b border-cp-hairline bg-cp-surface-2 px-3 py-2.5 text-left text-cp-10.5 font-semibold tracking-[.06em] whitespace-nowrap uppercase select-none ${
                                        active ? 'text-cp-accent' : 'text-cp-ink-3'
                                    } ${narrow ? 'max-md:hidden' : ''}`}
                                >
                                    {label}
                                    {active && (
                                        <span aria-hidden="true" className="ml-1 text-cp-9">
                                            {sort.dir === 'asc' ? '▲' : '▼'}
                                        </span>
                                    )}
                                </th>
                            )
                        })}
                    </tr>
                </thead>
                <tbody ref={body}>
                    {visible.map((f) => {
                        const closed = !lite && !isActivePermit(f)
                        const isNew = !lite && isNewlyPermitted(f)
                        const selected = selectedPermit === String(f.permit_id)
                        const fp = facilityPresentation(f)
                        return (
                            <tr
                                key={String(f.permit_id)}
                                data-permit={String(f.permit_id)}
                                tabIndex={-1}
                                onClick={() => onPick(String(f.permit_id))}
                                className={`cursor-pointer border-b border-cp-hairline last:border-b-0 hover:bg-cp-surface-2 ${
                                    closed ? 'opacity-55' : ''
                                } ${selected ? 'bg-cp-surface-2' : ''}`}
                            >
                                {!lite && (
                                    <td className="px-3 py-2 align-middle">
                                        <ScoreCell f={f} />
                                    </td>
                                )}
                                <td className="px-3 py-2 align-middle">
                                    <div className="font-semibold">
                                        {f.name}
                                        {isNew && (
                                            <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-cp-10 font-semibold tracking-[.05em] text-cp-accent uppercase">
                                                <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--cp-new)' }} aria-hidden="true" />
                                                new
                                            </span>
                                        )}
                                        {closed && (
                                            <span className="ml-2 align-middle text-cp-10 font-semibold tracking-[.05em] text-cp-ink-3 uppercase">
                                                closed
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-px text-cp-11.5 text-cp-ink-3">
                                        {[f.address, f.address2, f.city, f.zip].filter(Boolean).join(' · ')}
                                    </div>
                                </td>
                                {!lite && (
                                    <>
                                        <td className="px-3 py-2 align-middle tabular-nums max-md:hidden">
                                            {(() => {
                                                const rate = (fp.assessmentRecord as { compliance_rate?: number | null } | null)?.compliance_rate
                                                return rate != null ? `${Math.round(rate * 100)}%` : <span className="text-cp-ink-3">—</span>
                                            })()}
                                        </td>
                                        <td className="px-3 py-2 align-middle max-md:hidden">
                                            <TrendCell delta={fp.trendDelta} />
                                        </td>
                                        <td className="px-3 py-2 align-middle text-cp-ink-2 tabular-nums">
                                            {fp.latestDate ?? <span className="text-cp-ink-3">—</span>}
                                            {fp.latestDate && visitSuffix(f) && (
                                                <span className="text-cp-11 text-cp-ink-3"> · {visitSuffix(f)}</span>
                                            )}
                                        </td>
                                    </>
                                )}
                            </tr>
                        )
                    })}
                </tbody>
            </table>
            {remaining > 0 ? (
                <div className="flex items-center justify-center gap-3 border-t border-cp-hairline bg-cp-surface-2 p-3">
                    <button
                        type="button"
                        onClick={() => {
                            const firstNew = shown
                            onMore()
                            // Keep the reader's place: focus the first newly
                            // revealed row once it renders.
                            requestAnimationFrame(() => {
                                const next = body.current?.querySelectorAll('tr[data-permit]')[firstNew] as HTMLElement | undefined
                                next?.focus({ preventScroll: true })
                                next?.scrollIntoView({ block: 'nearest' })
                            })
                        }}
                        className="rounded-cp-control border border-cp-hairline bg-cp-surface-1 px-3 py-1.5 text-cp-12 font-semibold text-cp-ink-2 hover:text-cp-ink"
                    >
                        Show {Math.min(LIST_PAGE_SIZE, remaining).toLocaleString()} more ·{' '}
                        <span className="tabular-nums">{sorted.length.toLocaleString()}</span> match
                    </button>
                    <span className="text-cp-11.5 text-cp-ink-3 tabular-nums">
                        {shown.toLocaleString()} shown
                    </span>
                </div>
            ) : sorted.length > LIST_PAGE_SIZE ? (
                <div className="border-t border-cp-hairline bg-cp-surface-2 p-3 text-center text-cp-11.5 text-cp-ink-3 tabular-nums">
                    All {sorted.length.toLocaleString()} shown
                </div>
            ) : null}
        </div>
    )
}
