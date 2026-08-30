/**
 * The About view (§6.4, CRVb-M1) — the full methodology & provenance
 * document at content parity with the live page, restyled to the ratified
 * mockup: the hero with the three-badge provenance legend + four live
 * cards; §01 score anatomy (weight board, BOTH worked receipts, scope
 * cards, the grade-scale bar in the ramp, adjustment cards, edge-cases
 * disclosure); §02 signals (+ the red-flag weight disclosure); §03
 * pipeline; §04 lineage + tiers + the current-access live card; §05
 * limits (all eight) + Verify-at-the-source in the external grammar;
 * §06 Terms — the verbatim single-source body (Cannon's words, real
 * hrefs; the ack dialog clones THIS element) + the status panel OUTSIDE
 * the cloned body, owning the one tier switch (C2).
 *
 * Copy parity rule: prose is the LIVE page's, verbatim; structure and
 * chrome are the mockup's (the ratified visual direction). Two deliberate
 * mockup-side wins over live copy: §03 step 6's channel chips say "basic
 * map", never "lite" (C8), and the hero's card set is the ratified four
 * (Current access moved to §04).
 */

import { useEffect } from 'react'
import {
    Archive, ArrowRight, Building2, Calculator, ClipboardCheck, ExternalLink,
    Link2, MapPin,
} from 'lucide-react'
import { AGGREGATE_TENANT, PORTAL_BASE } from './constants'
import { fmtDate } from './data/presentation'
import { TermsBody } from './TermsBody'
import type { LoadedRoster } from './data/types'

const PORTAL_URL = `${PORTAL_BASE}/${AGGREGATE_TENANT}`

// ── the tier/status derivations (ported from about.js + ack.js) ─────────

export interface AckView {
    agreed: boolean
    decided: boolean
    persisted: boolean
}

/** Why the basic map is what loaded, in the terms' vocabulary. */
export function basicMapReason(forceLite: boolean, ack: AckView): string {
    if (forceLite) return 'Forced by ?tier=lite; no terms asked'
    if (ack.agreed) return 'Terms acknowledged; inspection data unavailable, basic map shown'
    if (ack.decided) {
        return ack.persisted ? 'Terms declined on this device' : 'Terms declined for this visit'
    }
    return 'Terms not yet acknowledged'
}

/** The §04 current-access card. */
export function accessCard(lite: boolean, forceLite: boolean, ack: AckView): { label: string; detail: string } {
    return lite
        ? { label: 'Basic map', detail: basicMapReason(forceLite, ack) }
        : { label: 'Inspection grades', detail: 'Terms acknowledged on this device' }
}

/** The §06 status panel: which tier this device is on and the single
 *  switch to the other. `?tier=lite` states the override and offers
 *  nothing to press (ack.js `_syncTermsStatus`, verbatim states). */
export function termsStatus(forceLite: boolean, ack: AckView): {
    text: string
    action: { label: string; tone: 'danger' | 'accent' } | null
} {
    if (forceLite) {
        return {
            text: 'The basic map is in effect for this visit because the address includes '
                + '?tier=lite. Inspection grades are not shown, and no acknowledgement is asked.',
            action: null,
        }
    }
    if (ack.agreed) {
        return {
            text: 'These terms are acknowledged on this device, and CleanPlateVA inspection '
                + 'grades are shown. The acknowledgement can be withdrawn at any time.',
            action: { label: 'Switch to the basic map', tone: 'danger' },
        }
    }
    return {
        text: 'These terms are not acknowledged on this device. The basic map is shown, '
            + 'without CleanPlateVA inspection grades.',
        action: { label: 'Review the terms and view grades', tone: 'accent' },
    }
}

// ── small shared chrome ─────────────────────────────────────────────────

function Pbadge({ kind, children }: { kind: 'official' | 'archived' | 'derived'; children: React.ReactNode }) {
    const Icon = kind === 'official' ? Building2 : kind === 'archived' ? Archive : Calculator
    const color = kind === 'official' ? 'var(--cp-accent)' : kind === 'derived' ? 'var(--cp-grade-c)' : 'var(--cp-ink-2)'
    const border = kind === 'archived' ? 'var(--cp-hairline)' : color
    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-cp-pill border px-2 py-1 text-[10.5px] font-semibold whitespace-nowrap"
            style={{ color, borderColor: border }}
        >
            <Icon size={12} aria-hidden="true" />
            {children}
        </span>
    )
}

function SecHead({ no, kicker, title, sub, badge, titleId }: {
    no: string
    kicker: string
    title: string
    sub?: React.ReactNode
    badge?: React.ReactNode
    titleId?: string
}) {
    return (
        <div className="mb-3.5 flex items-start gap-3.5">
            <span className="pt-0.5 text-[20px] font-bold text-cp-ink-3 opacity-60">{no}</span>
            <div className="min-w-0">
                <div className="text-[10.5px] font-semibold tracking-[.07em] text-cp-accent uppercase">{kicker}</div>
                <h2 id={titleId} tabIndex={titleId ? -1 : undefined} className="text-[17px] font-bold outline-none">{title}</h2>
                {sub && <div className="mt-1 text-[12.5px] leading-normal text-cp-ink-3">{sub}</div>}
            </div>
            {badge && <span className="ml-auto flex-none">{badge}</span>}
        </div>
    )
}

function Card({ children, id }: { children: React.ReactNode; id?: string }) {
    return (
        <section id={id} className="my-3.5 rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-4 shadow-cp sm:p-4.5">
            {children}
        </section>
    )
}

function Board({ title, small, children }: { title: string; small?: string; children: React.ReactNode }) {
    return (
        <div className="my-2.5 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
            <p className="mb-2 text-[12px] font-bold">
                {title} {small && <small className="font-normal text-cp-ink-3">· {small}</small>}
            </p>
            {children}
        </div>
    )
}

function Blocks({ solid, hollow, grp }: { solid: number; hollow?: number; grp?: boolean }) {
    const color = grp ? 'var(--cp-grade-c)' : 'var(--cp-grade-d)'
    return (
        <span className="inline-flex gap-[3px]" aria-hidden="true">
            {Array.from({ length: solid }, (_, i) => (
                <i key={i} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />
            ))}
            {Array.from({ length: hollow ?? 0 }, (_, i) => (
                <i key={`h${i}`} className="h-2.5 w-2.5 rounded-[2px] border-[1.5px] border-dashed" style={{ borderColor: color }} />
            ))}
        </span>
    )
}

function WeightRow({ when, small, solid, hollow, amount, grp }: {
    when: string
    small?: string
    solid: number
    hollow?: number
    amount: string
    grp?: boolean
}) {
    return (
        <div className="flex flex-wrap items-center gap-2.5 py-1">
            <span className="w-[170px] flex-none text-[12px] text-cp-ink-2">
                {when} {small && <small className="text-cp-ink-3">{small}</small>}
            </span>
            <Blocks solid={solid} hollow={hollow} grp={grp} />
            <span className="ml-auto text-[14px] font-bold tabular-nums">{amount}</span>
        </div>
    )
}

function RLine({ label, small, value, tone, blocks }: {
    label: string
    small?: string
    value: string
    tone?: 'pos' | 'neg'
    blocks?: React.ReactNode
}) {
    return (
        <div className="flex items-baseline gap-2.5 border-b border-dashed border-cp-hairline py-1.5 text-[12px] text-cp-ink-2">
            <span>{label} {small && <small className="text-cp-ink-3">{small}</small>}</span>
            {blocks}
            <b
                className="ml-auto tabular-nums"
                style={{ color: tone === 'pos' ? 'var(--cp-grade-a)' : tone === 'neg' ? 'var(--cp-grade-d)' : undefined }}
            >
                {value}
            </b>
        </div>
    )
}

function ScopeCard({ big, title, small, edge }: { big: string; title: string; small: string; edge: string }) {
    return (
        <article className="rounded-[6px] border border-cp-hairline bg-cp-surface-2 px-3 py-2.5" style={{ borderLeft: `3px solid ${edge}` }}>
            <div className="mb-1 text-[15px] font-bold tabular-nums">{big}</div>
            <strong className="block text-[12px]">{title}</strong>
            <small className="mt-0.5 block text-[11px] leading-snug text-cp-ink-3">{small}</small>
        </article>
    )
}

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
    return (
        <details className="mt-2.5 rounded-[8px] border border-cp-hairline bg-cp-surface-2">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-semibold text-cp-ink-2 [&::-webkit-details-marker]:hidden">
                {summary}
            </summary>
            <div className="border-t border-cp-hairline px-3 py-2.5">{children}</div>
        </details>
    )
}

function LiveCard({ k, v, small, wide }: { k: string; v: string; small?: string; wide?: boolean }) {
    return (
        <div className={`rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3 py-2.5 ${wide ? 'col-span-full' : ''}`}>
            <div className="mb-0.5 text-[9.5px] tracking-[.06em] text-cp-ink-3 uppercase">{k}</div>
            <div className="text-[14px] font-bold tabular-nums">
                {v}
                {small && <small className="ml-1 text-[11px] font-normal text-cp-ink-3">{small}</small>}
            </div>
        </div>
    )
}

// ── the view ────────────────────────────────────────────────────────────

export function AboutView({ loaded, unavailable, lite, forceLite, ack, onSwitchToBasic, onReviewTerms, scrollToTerms, onTermsShown }: {
    loaded: LoadedRoster | null
    unavailable: boolean
    lite: boolean
    forceLite: boolean
    ack: AckView
    onSwitchToBasic: () => void
    onReviewTerms: () => void
    /** A cold-loaded /about#aboutTerms or the footer's terms link: bring
     *  §06 into view with its heading focused, once. */
    scrollToTerms: boolean
    onTermsShown: () => void
}) {
    useEffect(() => {
        if (!scrollToTerms) return
        requestAnimationFrame(() => {
            document.getElementById('aboutTerms')?.scrollIntoView({ block: 'start' })
            document.getElementById('aboutTermsTitle')?.focus({ preventScroll: true })
            onTermsShown()
        })
    }, [scrollToTerms, onTermsShown])

    const counts = (loaded?.counts ?? null) as {
        total?: number
        active?: number
        by_zip?: Record<string, number>
    } | null
    // "Places" counts ACTIVE permits: the full manifest's `total` includes
    // the closed supplement; the public manifest's `total` IS the actives.
    const places = counts?.active ?? counts?.total
    const zips = Object.keys(counts?.by_zip || {}).filter((z) => z !== '?').length
    const fetchedAt = typeof loaded?.fetched_at === 'string' ? loaded.fetched_at.slice(0, 10) : null
    const access = accessCard(lite, forceLite, ack)
    const status = termsStatus(forceLite, ack)

    return (
        <main className="mx-auto max-w-[52rem] px-4 pt-2 pb-7">
            {/* hero */}
            <Card>
                <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Provenance legend">
                    <Pbadge kind="official">Official source</Pbadge>
                    <Pbadge kind="archived">Archived snapshot</Pbadge>
                    <Pbadge kind="derived">CleanPlateVA-derived</Pbadge>
                </div>
                <div className="text-[10.5px] font-semibold tracking-[.07em] text-cp-accent uppercase">
                    Methodology &amp; provenance
                </div>
                <h1 className="mt-1 mb-1.5 text-[22px] leading-tight font-bold">
                    Every marker has a source ID. Every score has math.
                </h1>
                <p className="max-w-[44rem] text-[13.5px] leading-normal text-cp-ink-2">
                    CleanPlateVA is an independent presentation of archived Virginia Department of
                    Health records from MyHealthDepartment. It is not affiliated with or endorsed by
                    VDH or MyHealthDepartment. VDH remains the authority. We do not inspect
                    facilities or issue official grades.
                </p>
                <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Current dataset status">
                    {unavailable ? (
                        <>
                            <LiveCard k="Archive snapshot" v="Unavailable" />
                            <LiveCard k="Newest report held" v="Unavailable" />
                            <LiveCard k="Places" v="Unavailable" />
                            <LiveCard k="Coverage" v="Unavailable" />
                        </>
                    ) : (
                        <>
                            <LiveCard k="Archive snapshot" v={fetchedAt ? fmtDate(fetchedAt) : 'Loading…'} small="export time, not a live VDH query" />
                            <LiveCard k="Newest report held" v={loaded?.freshness?.newest_report ? fmtDate(loaded.freshness.newest_report) : 'Loading…'} small="not equal freshness everywhere" />
                            <LiveCard k="Places" v={places != null ? places.toLocaleString() : 'Loading…'} small="active permits" />
                            <LiveCard k="Coverage" v={loaded ? String(zips) : 'Loading…'} small={zips === 1 ? 'covered ZIP, not all Virginia' : 'covered ZIPs, not all Virginia'} />
                        </>
                    )}
                </div>
            </Card>

            {/* 01 — score anatomy */}
            <Card>
                <SecHead
                    no="01"
                    kicker="Score anatomy"
                    title="Start at 100. Every violation subtracts."
                    sub={<>The portal publishes no usable numeric score. Our 0–100 formula runs on every report to give each <strong className="text-cp-ink-2">inspection a score</strong> — no letter. The A–F <strong className="text-cp-ink-2">letter belongs to the facility</strong>, not any single visit: a score bands to a grade only once it anchors a facility (see <em>the facility grade</em>, below).</>}
                    badge={<Pbadge kind="derived">Computed here</Pbadge>}
                />

                <Board title="Deduction per violation" small="each block is one point off the score">
                    <div className="text-[11px] font-semibold text-cp-ink-2">Risk-factor violation</div>
                    <div className="mb-1 text-[11px] text-cp-ink-3">
                        Form items 1–29 — the practices most tied to foodborne illness: temperatures,
                        cooking, hygiene, approved sources, contamination.
                    </div>
                    <WeightRow when="First time flagged" solid={6} amount="−6" />
                    <WeightRow when="Detected repeat" small="6 × 1.5" solid={6} hollow={3} amount="−9" />
                    <div className="mt-2 text-[11px] font-semibold text-cp-ink-2">Good-retail-practice violation</div>
                    <div className="mb-1 text-[11px] text-cp-ink-3">
                        Form items 30+ — operational upkeep: cleaning, labeling, equipment, maintenance.
                    </div>
                    <WeightRow when="First time flagged" solid={2} amount="−2" grp />
                    <WeightRow when="Detected repeat" small="2 × 1.5" solid={2} hollow={1} amount="−3" grp />
                    <p className="mt-2 text-[11.5px] leading-normal text-cp-ink-3">
                        A risk-factor violation costs three times a good-retail-practice one; a
                        detected repeat costs half again (hollow blocks); a violation corrected on
                        site while the inspector watched earns 25% of its deduction back. The math
                        runs exact and rounds once at the end — halves round up, toward the better
                        score — then floors at 0.
                    </p>
                </Board>

                <div className="my-3 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
                    <div className="rounded-[8px] border border-cp-hairline bg-cp-bg px-3.5 py-3">
                        <p className="mb-2 text-[11.5px] font-bold">Worked example — one routine inspection</p>
                        <RLine label="Every report starts at" value="100" />
                        <RLine label="1 risk-factor violation" value="−6" tone="neg" blocks={<Blocks solid={6} />} />
                        <RLine label="1 risk-factor violation, repeat" small="6 × 1.5" value="−9" tone="neg" blocks={<Blocks solid={6} hollow={3} />} />
                        <RLine label="2 good-retail-practice violations, corrected on site" small="2 × 2 × 0.75" value="−3" tone="neg" blocks={<Blocks solid={3} grp />} />
                        <div className="flex pt-2 text-[13px] font-bold">
                            <span>Inspection score</span>
                            <b className="ml-auto tabular-nums">82</b>
                        </div>
                        <p className="mt-2 text-[11px] leading-normal text-cp-ink-3">
                            This inspection assessed 24 distinct code items — broad — so its 82 can
                            anchor the facility grade below.
                        </p>
                    </div>
                    <div className="flex flex-col items-center justify-center gap-2 rounded-[8px] border border-cp-hairline bg-cp-surface-2 p-4">
                        <div
                            className="flex h-[84px] w-[84px] items-center justify-center rounded-full"
                            style={{ background: 'conic-gradient(var(--cp-grade-b) 295.2deg, var(--cp-surface-3) 0)' }}
                            role="img"
                            aria-label="Score ring at 82 of 100"
                        >
                            <div className="flex h-[66px] w-[66px] flex-col items-center justify-center rounded-full bg-cp-surface-2">
                                <strong className="text-[22px] tabular-nums">82</strong>
                                <span className="text-[10px] text-cp-ink-3">/ 100</span>
                            </div>
                        </div>
                        <div
                            className="rounded-cp-pill border border-cp-hairline px-2.5 py-1 text-[11px] font-semibold text-cp-ink-2"
                            title="An inspection has no letter; a facility whose latest broad grade is 82 bands to B"
                        >
                            as a facility grade → B
                        </div>
                        <div className="flex gap-1.5 text-[13px] font-semibold text-cp-ink-2 tabular-nums" aria-label="100 minus 15 risk-factor points minus 3 good-retail-practice points equals an inspection score of 82">
                            <span>100</span><b>−</b><span>15</span><b>−</b><span>3</span><b>=</b><strong className="text-cp-ink">82</strong>
                        </div>
                        <small className="text-center text-[10.5px] text-cp-ink-3">
                            Start − risk-factor deductions − good-retail-practice deductions.
                        </small>
                    </div>
                </div>

                <Board title="Which inspections anchor the grade?" small="breadth decides — distinct numbered items on the report; duplicate rows count once. IN/OUT separately drives compliance">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <ScopeCard big="20+" title="Broad" small="Anchors the facility grade + connected trend" edge="var(--cp-grade-a)" />
                        <ScopeCard big="1–19" title="Focused" small="Re-checks that adjust the grade; OUT/addressed ratio is compliance-colored" edge="var(--cp-grade-c)" />
                        <ScopeCard big="0 / no checklist" title="Unknown" small="No grade or trend claim" edge="var(--cp-ink-3)" />
                    </div>
                </Board>

                <Board title="From inspections to the facility grade" small="latest broad score, adjusted by what re-checks verified, then banded">
                    <p className="mb-2 text-[11.5px] leading-normal text-cp-ink-3">
                        Marker color, the A–F filters, and the hover headline show the <em>grade</em> —
                        a <strong className="text-cp-ink-2">score and a letter</strong>. It is the latest broad
                        inspection's score, adjusted by what focused re-checks verified afterward
                        item by item, then banded. No follow-up since the broad inspection → the
                        grade is that score, exactly. The next broad inspection resets it.
                        (Inspections themselves stay letterless.)
                    </p>
                    <div className="mt-3 mb-1" aria-label="Grade thresholds: F below 60, D 60 to 69, C 70 to 79, B 80 to 89, A 90 to 100">
                        <div className="mb-1 text-[11px] font-bold tabular-nums" style={{ marginLeft: 'calc(83% - 24px)' }}>
                            83 · B
                            <span className="mt-0.5 ml-[18px] block h-2 w-0.5 bg-cp-ink" aria-hidden="true" />
                        </div>
                        <div className="flex h-[30px] overflow-hidden rounded-[5px] text-white">
                            <span className="flex flex-[60] flex-col items-center justify-center text-[11px] leading-tight font-bold" style={{ background: 'var(--cp-grade-f)' }}>F<small className="text-[8.5px] font-semibold opacity-90">0–59</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-[11px] leading-tight font-bold" style={{ background: 'var(--cp-grade-d)' }}>D<small className="text-[8.5px] font-semibold opacity-90">60–69</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-[11px] leading-tight font-bold" style={{ background: 'var(--cp-grade-c)' }}>C<small className="text-[8.5px] font-semibold opacity-90">70–79</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-[11px] leading-tight font-bold" style={{ background: 'var(--cp-grade-b)' }}>B<small className="text-[8.5px] font-semibold opacity-90">80–89</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-[11px] leading-tight font-bold" style={{ background: 'var(--cp-grade-a)' }}>A<small className="text-[8.5px] font-semibold opacity-90">90–100</small></span>
                        </div>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Grade adjustment rules">
                        <ScopeCard big="+65%" title="Re-checked IN" small="Returns 65% of that item's deduction" edge="var(--cp-grade-a)" />
                        <ScopeCard big="×1.5" title="Still OUT" small="A verified repeat — the full deduction grows half again" edge="var(--cp-grade-f)" />
                        <ScopeCard big="×1" title="OUT, fixed on site" small="Any on-site-correction credit is revoked — the full deduction stands, without the ×1.5" edge="var(--cp-grade-c)" />
                        <ScopeCard big="−6/−2" title="New finding" small="Docks at normal category weight" edge="var(--cp-grade-d)" />
                    </div>
                    <div className="mt-3 rounded-[8px] border border-cp-hairline bg-cp-bg px-3.5 py-3">
                        <p className="mb-2 text-[11.5px] font-bold">Worked example — a broad inspection scoring 70, then one follow-up</p>
                        <RLine label="Broad inspection score" value="70" />
                        <RLine label="2 risk-factor violations verified fixed" small="65% of their 12 points returned" value="+7.8" tone="pos" />
                        <RLine label="6 good-retail-practice violations verified fixed" small="65% of their 12 points returned" value="+7.8" tone="pos" />
                        <RLine label="1 risk-factor item still out" small="deduction grows 6 → 9" value="−3" tone="neg" />
                        <div className="flex pt-2 text-[13px] font-bold">
                            <span>Facility grade</span>
                            <b className="ml-auto tabular-nums">83 · B</b>
                        </div>
                        <p className="mt-2 text-[11px] leading-normal text-cp-ink-3">
                            A 70 broad inspection → a B 83 facility grade — visibly better, but not
                            laundered: the calibration keeps a fully-cleared F 0 inside D at best, and
                            no follow-up alone reaches A from D or F. Re-earning the letter takes the
                            next broad inspection.
                        </p>
                    </div>
                </Board>

                <Disclosure summary="Exact scoring edge cases">
                    <div className="space-y-2 text-[12px] text-cp-ink-2">
                        <p><strong className="block text-[11.5px] text-cp-ink">Repeat source</strong>A structured VDH <em>Repeat</em> flag or the word “repeat” in the observation makes that violation 1.5×.</p>
                        <p><strong className="block text-[11.5px] text-cp-ink">Missing item number</strong>Defaults to the lower good-retail-practice deduction of 2 points.</p>
                        <p><strong className="block text-[11.5px] text-cp-ink">Corrected on site</strong>Deducts 75% of its weight — the structured checklist’s COS marking (every OUT row for the item) earns 25% back. The credit is provisional: a later re-check that finds the item OUT again revokes it to the full deduction. It never erases the recorded violation or softens red-flag ranking.</p>
                        <p><strong className="block text-[11.5px] text-cp-ink">Follow-up reports</strong>Checklist breadth—not the word “follow-up”—decides their role. A broad report publishes a score; focused and scope-unknown reports publish null. Their per-item IN/OUT verdicts can still adjust the facility grade above, joined on the form item number.</p>
                        <p><strong className="block text-[11.5px] text-cp-ink">Grade without follow-ups</strong>Identical to the latest broad score, banded to a letter. Items never re-checked keep their full deduction; undated or same-day reports never adjust.</p>
                        <p><strong className="block text-[11.5px] text-cp-ink">Written-verdict follow-ups</strong>Some follow-ups publish no checklist at all — the inspector’s verdict lives only in the written comments (“all violations corrected”). Those comments are adjudicated into a machine verdict by a separate, audited step — never parsed loosely at scoring time — and then adjust the grade exactly like a re-check of the items the broad inspection docked: “all corrected” restores like a full re-checked-IN clear, “not corrected” charges the verified-repeat ×1.5. Hedged or ambiguous comments (“corrected or are continuing to be implemented”) grant nothing until reviewed. A written verdict can restore or re-charge existing deductions, never add new ones, and a later structured re-check always outranks an earlier comment.</p>
                    </div>
                </Disclosure>
            </Card>

            {/* 02 — signals */}
            <Card>
                <SecHead
                    no="02"
                    kicker="Not the same measurement"
                    title="What the other signals mean"
                    sub="Each answers a different question. None is an official VDH rating."
                />
                <div className="grid gap-2.5 sm:grid-cols-2">
                    <article className="relative rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="absolute top-2.5 right-2.5"><Pbadge kind="derived">Derived</Pbadge></span>
                        <h3 className="mt-1 mb-1.5 text-[13px] font-bold">Checklist compliance</h3>
                        <div className="mb-2 flex items-center gap-2 rounded-[6px] border border-cp-hairline bg-cp-bg px-2.5 py-2 text-[12px] font-semibold tabular-nums"><b>IN</b> ÷ <b>(IN + OUT)</b></div>
                        <p className="text-[12px] leading-normal text-cp-ink-2">Only applicable checklist rows count. N/A, not observed, and the non-scoring item-99 sentinel are excluded.</p>
                    </article>
                    <article className="relative rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="absolute top-2.5 right-2.5"><Pbadge kind="derived">Derived</Pbadge></span>
                        <h3 className="mt-1 mb-1.5 text-[13px] font-bold">Trend</h3>
                        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[6px] border border-cp-hairline bg-cp-bg px-2.5 py-2 text-[12px] font-semibold tabular-nums" aria-label="Broad score 86 connected to broad score 72; a focused re-check that left 3 of 3 items out plots as an unconnected diamond at its compliance">
                            <span>86</span>→<span className="inline-flex items-center gap-1"><i className="inline-block h-[9px] w-[9px] rotate-45" style={{ background: 'var(--cp-grade-d)' }} aria-hidden="true" />3/3</span>→<span>72</span><b style={{ color: 'var(--cp-grade-d)' }}>▼</b>
                        </div>
                        <p className="text-[12px] leading-normal text-cp-ink-2">Only broad assessments join the connected line. A focused re-check plots as an unconnected diamond at the share of its re-examined items in compliance, labeled with that OUT ratio. Its report score is null: a number subtracting only the handful of items the visit examined could look deceptively high even when every one failed. Direction is not a forecast.</p>
                    </article>
                    <article className="relative rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="absolute top-2.5 right-2.5"><Pbadge kind="derived">Heuristic</Pbadge></span>
                        <h3 className="mt-1 mb-1.5 text-[13px] font-bold">Biggest red flags</h3>
                        <div className="mb-2 flex flex-wrap gap-1.5 rounded-[6px] border border-cp-hairline bg-cp-bg px-2.5 py-2 text-[12px] font-semibold"><span>Risk factor</span>·<span>Repeat</span>·<span>Keyword weight</span></div>
                        <p className="text-[12px] leading-normal text-cp-ink-2">Up to five observations ranked by category, repeat status, and the documented keyword groups below. Empty means none crossed the heuristic, not “safe.”</p>
                    </article>
                    <article className="relative rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="absolute top-2.5 right-2.5"><Pbadge kind="derived">Derived</Pbadge></span>
                        <h3 className="mt-1 mb-1.5 text-[13px] font-bold">Open repeats</h3>
                        <div className="mb-2 flex items-center gap-2 rounded-[6px] border border-cp-hairline bg-cp-bg px-2.5 py-2 text-[12px] font-semibold"><b>OUT</b> + <b>Repeat</b> − <b>COS</b></div>
                        <p className="text-[12px] leading-normal text-cp-ink-2">Latest checklist rows simultaneously marked out and repeat, excluding rows marked corrected on site.</p>
                    </article>
                </div>
                <Disclosure summary="Exact red-flag ranking weights">
                    <div className="flex flex-wrap gap-1.5" aria-label="Base ranking weights">
                        {['+10 risk-factor item', '+3 detected repeat', 'Top 5 ranks above 1'].map((t) => (
                            <span key={t} className="rounded-[5px] border border-cp-hairline bg-cp-bg px-2 py-1.5 text-[11px] font-semibold text-cp-ink-2">{t}</span>
                        ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Keyword ranking groups">
                        {[
                            '+8 sewage/wastewater · rodents/pests · vomit/diarrhea/ill employee',
                            '+6 no handwashing/bare hand · raw food over cooked food · no hot water',
                            '+5 cross-contamination · mold/slime',
                            '+4 holding temperature · cooling/cook temperature',
                            '+3 hand sink · date marking · sanitizer · expired food',
                            '+1 dirty/buildup/grease/debris/soiled',
                        ].map((t) => (
                            <span key={t} className="rounded-[5px] border border-cp-hairline bg-cp-bg px-2 py-1.5 text-[11px] font-semibold text-cp-ink-2">{t}</span>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] text-cp-ink-3">Matching groups accumulate. Ties retain source order; displayed observation text is capped at 180 characters. This rank selects what to show—it does not change the 0–100 score.</p>
                </Disclosure>
            </Card>

            {/* 03 — pipeline */}
            <Card>
                <SecHead
                    no="03"
                    kicker="Source to screen"
                    title="How a VDH report becomes this website"
                    sub="The browser reads a prepared snapshot. It never scrapes VDH while you wait."
                    badge={<Pbadge kind="archived">Snapshot pipeline</Pbadge>}
                />
                <ol className="grid gap-2">
                    {[
                        { t: 'Official VDH surfaces', p: 'MyHealthDepartment provides a search roster, permit-history pages, and individual inspection reports.', codes: ['permitID', 'inspectionID', '12VAC5-421'] },
                        { t: 'Archive a snapshot', p: 'A polite, resumable collector stores roster JSON and compressed permit/report pages by covered ZIP.', codes: ['raw HTML', 'roster JSON', 'collected time'] },
                        { t: 'Parse & preserve IDs', p: 'We extract identity, history, observations, citations, corrective actions, checklist rows, temperatures, and comments.', codes: ['fac:<permitID>', 'insp:<inspectionID>'] },
                        { t: 'Derive & store', p: 'Addresses are geocoded; rules compute metrics; idempotent CouchDB projections retain each permit and inspection separately.', codes: ['geocode', 'computed fields', 'content hash'] },
                        { t: 'Merge & whitelist', p: 'At export, likely re-permits are presentation-merged. Explicit field lists shape the shared finder, the grade overlay, the closed supplement, and per-facility history records while retaining lineage.', codes: ['lineage', 'finder + overlay + closed shards', 'facility history'] },
                        { t: 'Publish two contracts', p: 'Small manifests name each prepared snapshot. Data objects publish first and the manifest flips last; the full archive JSON lives in R2 and is served once the terms have been acknowledged.', codes: ['static basic map', 'acknowledged full', 'full → basic fallback'] },
                    ].map((step, i) => (
                        <li key={step.t} className="grid grid-cols-[30px_1fr] gap-x-3 gap-y-1 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3 py-2.5">
                            <span className="row-span-3 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-cp-accent-solid text-[12px] font-bold text-cp-accent-ink">{i + 1}</span>
                            <h3 className="text-[12.5px] font-bold">{step.t}</h3>
                            <p className="col-start-2 text-[12px] leading-normal text-cp-ink-2">{step.p}</p>
                            <div className="col-start-2 flex flex-wrap gap-1.5">
                                {step.codes.map((c) => (
                                    <code key={c} className="rounded-[4px] border border-cp-hairline bg-cp-bg px-1.5 py-1 font-mono text-[10.5px] font-semibold text-cp-ink-2">{c}</code>
                                ))}
                            </div>
                        </li>
                    ))}
                </ol>
                <div className="mt-2 flex items-center gap-2 text-[11.5px] text-cp-ink-3">
                    <Link2 size={13} aria-hidden="true" />
                    VDH GUIDs stay attached through the path. Views link back where the
                    corresponding MyHealthDepartment tenant route is available.
                </div>
            </Card>

            {/* 04 — lineage + tiers */}
            <Card>
                <SecHead
                    no="04"
                    kicker="Field-level boundary"
                    title="What is official, and what is ours"
                    sub="Color is not the contract. Every group is labeled in words."
                />
                <div className="grid gap-2.5 sm:grid-cols-2">
                    <article className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3" style={{ borderTop: '3px solid var(--cp-accent)' }}>
                        <Pbadge kind="official">Official VDH record</Pbadge>
                        <h3 className="mt-2 mb-1.5 text-[13px] font-bold">Archived and reorganized</h3>
                        <ul className="list-disc pl-4 text-[12px] leading-normal text-cp-ink-2">
                            <li>Facility name, address, permit type, and status</li>
                            <li>Permit and inspection GUIDs</li>
                            <li>Inspection date, type, and purpose</li>
                            <li>Violation item, citation, observation, and corrective action</li>
                            <li>Checklist IN/OUT/N/A/N/O, COS, and Repeat markings</li>
                            <li>Temperatures and inspector comments when present</li>
                        </ul>
                    </article>
                    <article className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3" style={{ borderTop: '3px solid var(--cp-grade-c)' }}>
                        <Pbadge kind="derived">CleanPlateVA-derived</Pbadge>
                        <h3 className="mt-2 mb-1.5 text-[13px] font-bold">Computed or enriched</h3>
                        <ul className="list-disc pl-4 text-[12px] leading-normal text-cp-ink-2">
                            <li>Inspection score: raw 0–100 formula on each report (no letter)</li>
                            <li>Facility grade: score + A–F letter, latest broad ± follow-up re-checks</li>
                            <li>Checklist compliance percentage</li>
                            <li>Broad-only score trend, red flags, and open-repeat count</li>
                            <li>Map coordinates and approximate-location flag</li>
                            <li>“Restaurants only” classification</li>
                            <li>Presentation merge of likely predecessor permits</li>
                        </ul>
                    </article>
                </div>
                <div className="mt-3 grid gap-2">
                    <article className="flex gap-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[8px] border border-cp-hairline bg-cp-bg text-cp-ink-2"><MapPin size={16} aria-hidden="true" /></span>
                        <div>
                            <div className="text-[10.5px] font-semibold tracking-[.07em] text-cp-accent uppercase">Basic map</div>
                            <h3 className="mt-0.5 mb-1 text-[13px] font-bold">Identity, location, source handoff</h3>
                            <p className="text-[12px] leading-normal text-cp-ink-2">Snapshot markers recorded as active at export time, names, addresses, geocoded coordinates, restaurant classification, approximation and mobile-unit flags, permit IDs, and the VDH district route needed for the source handoff. Status can age; presence is not proof a facility is currently open or permitted. No report dates, scores, grades, or inspection content.</p>
                        </div>
                    </article>
                    <div className="flex items-center justify-center gap-2 text-[11px] font-semibold text-cp-ink-3">
                        <span>Terms acknowledged</span>
                        <ArrowRight size={13} aria-hidden="true" />
                        <span>inspection grades load; otherwise the basic map remains</span>
                    </div>
                    <article className="flex gap-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[8px] border border-cp-accent bg-cp-bg text-cp-accent"><ClipboardCheck size={16} aria-hidden="true" /></span>
                        <div>
                            <div className="text-[10.5px] font-semibold tracking-[.07em] text-cp-accent uppercase">Inspection grades</div>
                            <h3 className="mt-0.5 mb-1 text-[13px] font-bold">Reports plus derived signals</h3>
                            <p className="text-[12px] leading-normal text-cp-ink-2">Inspection histories, citations, observations, checklists, temperatures, comments, status, lineage, and CleanPlateVA-calculated metrics, loaded after the visitor acknowledges the Terms of Use and Data Acknowledgment (§06). If that data cannot be loaded, the basic map remains.</p>
                        </div>
                    </article>
                </div>
                <div className="mt-2.5 grid">
                    <LiveCard k="Current access" v={access.label} small={`· ${access.detail}`} wide />
                </div>
            </Card>

            {/* 05 — limits */}
            <Card>
                <SecHead
                    no="05"
                    kicker="Limits & verification"
                    title="What this view cannot promise"
                    sub="Transparency includes the edges, not just the happy path."
                />
                <div className="grid gap-2 sm:grid-cols-2">
                    {[
                        ['Selected coverage', 'Coverage is the ZIP count shown above, not every Virginia jurisdiction. Absence from this map does not mean absence from VDH; some places are outside the selected ZIPs or use other systems.'],
                        ['Snapshot, not live', 'Collection and publication can lag. “Newest report” is one maximum date, not proof that every covered area is equally current.'],
                        ['Permit status can age', 'An incremental scan can retain the last known “active” state after a facility stops receiving inspections. A full resweep reconciles closures; a marker is not operating-status proof.'],
                        ['Source retention', 'The portal typically exposes about two years of history. Missing report pages remain missing or unscored; this is an archive of what was collected, not a complete lifetime record.'],
                        ['Geocoded locations', 'Pins come from address lookups through VGIN, the U.S. Census Bureau, and OpenStreetMap/Nominatim, refined against Overture Maps and Foursquare OS Places, with a ZIP-centroid fallback—not VDH coordinates. Some pins are manually placed after review. Where an address is a room or space number rather than a street address, as at an airport or on a campus, the pin is placed at the venue the establishment belongs to, derived from other permits at that venue whose addresses resolved. Some unbadged pins are street-level or interpolated, not rooftop; venue-level and centroid pins are labeled approximate.'],
                        ['Presentation heuristics', '“Restaurants only” uses permit-type/name patterns. History merging uses shared location/address plus name similarity. Either can misclassify, combine, or miss a match; retained permit IDs are the audit trail.'],
                        ['Focused is not facility-wide', 'A focused follow-up stays visible as the latest event and adjusts the facility grade item by item, but it never replaces the broad inspection that anchors it. Its own score is null; the OUT/addressed result describes that targeted visit. When comments enumerate corrected items omitted from the structured rows, both channels count once and the structured row governs any conflict.'],
                        ['VDH wins conflicts', 'Scores and summaries are comparison tools, not safety or illness predictions. If our presentation and the source disagree, the official VDH record is authoritative.'],
                    ].map(([h, p]) => (
                        <article key={h} className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3 py-2.5">
                            <h3 className="mb-1 text-[12px] font-bold">{h}</h3>
                            <p className="text-[11.5px] leading-normal text-cp-ink-2">{p}</p>
                        </article>
                    ))}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-[8px] border border-cp-accent bg-cp-surface-2 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[12.5px] font-bold">Verify at the source</h3>
                        <p className="text-[11.5px] leading-normal text-cp-ink-2">Facility rows and report cards expose MyHealthDepartment links where available. Compare the observation, citation, corrective action, and checklist markings yourself.</p>
                    </div>
                    <a
                        href={PORTAL_URL}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex flex-none items-center gap-1.5 rounded-cp-control border border-cp-accent px-2.5 py-1.5 text-[12px] font-semibold text-cp-accent hover:bg-cp-surface-3"
                    >
                        Open VDH portal
                        <ExternalLink size={13} aria-hidden="true" />
                    </a>
                </div>
            </Card>

            {/* 06 — terms (the ONE source; the ack dialog clones #aboutTermsBody) */}
            <Card id="aboutTerms">
                <SecHead
                    no="06"
                    kicker="Terms & attribution"
                    title="Terms of Use and Data Acknowledgment"
                    titleId="aboutTermsTitle"
                />
                <div className="rounded-cp-control border border-cp-hairline bg-cp-bg">
                    <div id="aboutTermsBody" className="px-4 py-3">
                        <TermsBody />
                    </div>
                </div>
                {/* Deliberately OUTSIDE #aboutTermsBody: the ack dialog clones
                    that element and brings its own buttons (C2). */}
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                    <p className="m-0 min-w-[260px] flex-1 text-[12.5px] leading-normal text-cp-ink-2">{status.text}</p>
                    {status.action && (
                        <button
                            type="button"
                            onClick={status.action.tone === 'danger' ? onSwitchToBasic : onReviewTerms}
                            className="flex-none rounded-cp-control border px-2.5 py-1.5 text-[12px] font-semibold hover:bg-cp-surface-3"
                            style={{
                                color: status.action.tone === 'danger' ? 'var(--cp-danger)' : 'var(--cp-accent)',
                                borderColor: status.action.tone === 'danger' ? 'var(--cp-danger)' : 'var(--cp-accent)',
                            }}
                        >
                            {status.action.label}
                        </button>
                    )}
                </div>
            </Card>
        </main>
    )
}
