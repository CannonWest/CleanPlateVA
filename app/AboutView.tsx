/**
 * The About view (§6.4, CRVb-M1) — the methodology & provenance document
 * in the ratified mockup's structure: the hero (title, the disclaimer
 * paragraph, four live cards); §01 score anatomy (weight board, BOTH
 * worked receipts, scope cards, the grade-scale bar in the ramp,
 * adjustment cards, edge-cases disclosure); §02 pipeline; §03 lineage +
 * tiers; §04 limits (all eight) + Verify-at-the-source in the external
 * grammar; §05 Terms — the verbatim single-source body (Cannon's words,
 * real hrefs; the ack dialog clones THIS element) + the status panel
 * OUTSIDE the cloned body, owning the one tier switch (C2).
 *
 * Copy rule: the prose is Cannon's, verbatim — the 2026-09-07 pass through
 * the /admin editor reframed the page around CleanPlateVA's own
 * grading system, dropped the provenance badges, the section kickers, the
 * signals section (the old §02, so the numbers moved up one) and the
 * current-access card, and rewrote most paragraphs. Structure and chrome
 * are the mockup's. §02 step 6's channel chips say "basic map", never
 * "lite" (C8).
 */

import { useEffect } from 'react'
import {
    Archive, Building2, Calculator, ClipboardCheck, ExternalLink, Link2, MapPin,
} from 'lucide-react'
import { AGGREGATE_TENANT, FAIRFAX_RECORDS_URL, PORTAL_BASE } from './constants'
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

/** The §05 status panel: which tier this device is on and the single
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
            className="inline-flex items-center gap-1.5 rounded-cp-pill border px-2 py-1 text-cp-10.5 font-semibold whitespace-nowrap"
            style={{ color, borderColor: border }}
        >
            <Icon size={12} aria-hidden="true" />
            {children}
        </span>
    )
}

function SecHead({ no, kicker, title, sub, badge, titleId }: {
    no: string
    /** The uppercase line over the title. Most sections dropped theirs in
     *  the 2026-09-07 pass; §01 and §05 keep one. */
    kicker?: string
    title: string
    sub?: React.ReactNode
    badge?: React.ReactNode
    titleId?: string
}) {
    return (
        <div className="mb-3.5 flex items-start gap-3.5">
            <span className="pt-0.5 text-cp-20 font-bold text-cp-ink-3 opacity-60">{no}</span>
            <div className="min-w-0">
                {kicker && <div className="text-cp-10.5 font-semibold tracking-[.07em] text-cp-accent uppercase">{kicker}</div>}
                <h2 id={titleId} tabIndex={titleId ? -1 : undefined} className="text-cp-17 font-bold outline-none">{title}</h2>
                {sub && <div className="mt-1 text-cp-12.5 leading-normal text-cp-ink-3">{sub}</div>}
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
            <p className="mb-2 text-cp-12 font-bold">
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
            <span className="w-[170px] flex-none text-cp-12 text-cp-ink-2">
                {when} {small && <small className="text-cp-ink-3">{small}</small>}
            </span>
            <Blocks solid={solid} hollow={hollow} grp={grp} />
            <span className="ml-auto text-cp-14 font-bold tabular-nums">{amount}</span>
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
        <div className="flex items-baseline gap-2.5 border-b border-dashed border-cp-hairline py-1.5 text-cp-12 text-cp-ink-2">
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
            <div className="mb-1 text-cp-15 font-bold tabular-nums">{big}</div>
            <strong className="block text-cp-12">{title}</strong>
            <small className="mt-0.5 block text-cp-11 leading-snug text-cp-ink-3">{small}</small>
        </article>
    )
}

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
    return (
        <details className="mt-2.5 rounded-[8px] border border-cp-hairline bg-cp-surface-2">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-cp-12 font-semibold text-cp-ink-2 [&::-webkit-details-marker]:hidden">
                {summary}
            </summary>
            <div className="border-t border-cp-hairline px-3 py-2.5">{children}</div>
        </details>
    )
}

function LiveCard({ k, v, small }: { k: string; v: string; small?: string }) {
    return (
        <div className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3 py-2.5">
            <div className="mb-0.5 text-cp-9.5 tracking-[.06em] text-cp-ink-3 uppercase">{k}</div>
            <div className="text-cp-14 font-bold tabular-nums">
                {v}
                {small && <small className="ml-1 text-cp-11 font-normal text-cp-ink-3">{small}</small>}
            </div>
        </div>
    )
}

// ── the view ────────────────────────────────────────────────────────────

export function AboutView({ loaded, unavailable, forceLite, ack, onSwitchToBasic, onReviewTerms, scrollToTerms, onTermsShown }: {
    loaded: LoadedRoster | null
    unavailable: boolean
    forceLite: boolean
    ack: AckView
    onSwitchToBasic: () => void
    onReviewTerms: () => void
    /** A cold-loaded /about#aboutTerms or the footer's terms link: bring
     *  §05 into view with its heading focused, once. */
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
    const status = termsStatus(forceLite, ack)

    return (
        <main className="mx-auto max-w-[52rem] px-4 pt-2 pb-7">
            {/* hero */}
            <Card>
                <h1 className="mt-1 mb-1.5 text-cp-22 leading-tight font-bold">
                    CleanPlateVA: an unofficial archive and grading of Virginia's health-inspected
                    food-serving facilities
                </h1>
                <p className="max-w-[44rem] text-cp-13.5 leading-normal text-cp-ink-2">
                    CleanPlateVA is an independent presentation of archived food establishment
                    inspection records published by the Virginia Department of Health through
                    MyHealthDepartment and by the Fairfax County Health Department.
                    <br />
                    <strong>The Virginia Department of Health and Fairfax County Health Department do not issue grades on inspection reports, therefore any grade presented here is derived from CleanPlateVA's proprietary grading system based on risk factor, corrections, and repeats</strong>.
                    CleanPlateVA is not affiliated with or endorsed by VDH, MyHealthDepartment, or
                    the Fairfax County Health Department. All permits and inspections are linked
                    in a given facility's details when clicked.
                    <br />
                    <strong>CleanPlateVA does not inspect facilities or issue official grades. This site is for reference use only, please defer to respective health inspection authorities for questions on specific facilities or inspections.</strong>
                </p>
                <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Current dataset status">
                    {unavailable ? (
                        <>
                            <LiveCard k="Last snapshot" v="Unavailable" />
                            <LiveCard k="Newest report held" v="Unavailable" />
                            <LiveCard k="Facilities" v="Unavailable" />
                            <LiveCard k="Coverage" v="Unavailable" />
                        </>
                    ) : (
                        <>
                            <LiveCard k="Last snapshot" v={fetchedAt ? fmtDate(fetchedAt) : 'Loading…'} />
                            <LiveCard k="Newest report held" v={loaded?.freshness?.newest_report ? fmtDate(loaded.freshness.newest_report) : 'Loading…'} />
                            <LiveCard k="Facilities" v={places != null ? places.toLocaleString() : 'Loading…'} small="active permits" />
                            <LiveCard k="Coverage" v={loaded ? String(zips) : 'Loading…'} small={zips === 1 ? 'covered ZIP' : 'covered ZIPs'} />
                        </>
                    )}
                </div>
            </Card>

            {/* 01 — score anatomy */}
            <Card>
                <SecHead
                    no="01"
                    kicker="Score anatomy"
                    title="All facilities start at 100, with violations subtracting"
                    sub={<><strong className="text-cp-ink-2">Virginia health inspection authorities do not provides grades or scores for facilities on their respective online portals</strong>. CleanPlateVA's 0–100 formula runs on every report to provide a simple at-a-glance reference for those interested. A–F grades are assigned to a facility, based primarily on their most recent broad-scoped inspection and any subsequent follow-ups</>}
                />

                <Board title="Deduction per violation" small="each block is one point off the score">
                    <div className="text-cp-11 font-semibold text-cp-ink-2">Risk-factor violation</div>
                    <div className="mb-1 text-cp-11 text-cp-ink-3">
                        Form items 1–29, the practices most tied to foodborne illness: temperatures,
                        cooking, hygiene, approved sources, contamination.
                    </div>
                    <WeightRow when="First time flagged" solid={6} amount="−6" />
                    <WeightRow when="Detected repeat" small="6 × 1.5" solid={6} hollow={3} amount="−9" />
                    <div className="mt-2 text-cp-11 font-semibold text-cp-ink-2">Good-retail-practice violation</div>
                    <div className="mb-1 text-cp-11 text-cp-ink-3">
                        Form items 30+, operational upkeep: cleaning, labeling, equipment, maintenance.
                    </div>
                    <WeightRow when="First time flagged" solid={2} amount="−2" grp />
                    <WeightRow when="Detected repeat" small="2 × 1.5" solid={2} hollow={1} amount="−3" grp />
                    <p className="mt-2 text-cp-11.5 leading-normal text-cp-ink-3">
                        A risk-factor violation costs three times a good-retail-practice one; a
                        detected repeat costs half again (hollow blocks); a violation corrected on
                        site while the inspector watched earns 25% of its deduction back. Scores
                        round up and floor at 0.
                    </p>
                </Board>

                <div className="my-3 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
                    <div className="rounded-[8px] border border-cp-hairline bg-cp-bg px-3.5 py-3">
                        <p className="mb-2 text-cp-11.5 font-bold">Worked example</p>
                        <RLine label="Every report starts at" value="100" />
                        <RLine label="1 risk-factor violation" value="−6" tone="neg" blocks={<Blocks solid={6} />} />
                        <RLine label="1 risk-factor violation, repeat" small="6 × 1.5" value="−9" tone="neg" blocks={<Blocks solid={6} hollow={3} />} />
                        <RLine label="2 good-retail-practice violations, corrected on site" small="2 × 2 × 0.75" value="−3" tone="neg" blocks={<Blocks solid={3} grp />} />
                        <div className="flex pt-2 text-cp-13 font-bold">
                            <span>Inspection score</span>
                            <b className="ml-auto tabular-nums">82</b>
                        </div>
                        <p className="mt-2 text-cp-11 leading-normal text-cp-ink-3">
                            This inspection assessed 24 distinct code items (categorized as
                            a <em>broad</em> inspection) so its 82 score will anchor the facility
                            grade below.
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
                                <strong className="text-cp-22 tabular-nums">82</strong>
                                <span className="text-cp-10 text-cp-ink-3">/ 100</span>
                            </div>
                        </div>
                        <div
                            className="rounded-cp-pill border border-cp-hairline px-2.5 py-1 text-cp-11 font-semibold text-cp-ink-2"
                            title="An inspection has no letter; a facility whose latest broad grade is 82 bands to B"
                        >
                            as a facility grade → B
                        </div>
                        <div className="flex gap-1.5 text-cp-13 font-semibold text-cp-ink-2 tabular-nums" aria-label="100 minus 15 risk-factor points minus 3 good-retail-practice points equals an inspection score of 82">
                            <span>100</span><b>−</b><span>15</span><b>−</b><span>3</span><b>=</b><strong className="text-cp-ink">82</strong>
                        </div>
                        <small className="text-center text-cp-10.5 text-cp-ink-3">
                            Start − risk-factor deductions − good-retail-practice deductions.
                        </small>
                    </div>
                </div>

                <Board title="Which inspections anchor the grade?" small="Inspection breadth. This refers to the distinct numbered items assigned IN/OUT on the report.">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <ScopeCard big="20+" title="Broad" small="Anchors the facility grade + connected trend" edge="var(--cp-grade-a)" />
                        <ScopeCard big="1–19" title="Focused" small="Follow-ups that adjust the grade" edge="var(--cp-grade-c)" />
                        <ScopeCard big="0 / no checklist" title="Unknown" small="No grade or score effect" edge="var(--cp-ink-3)" />
                    </div>
                </Board>

                <Board title="From inspections to the facility grade">
                    <p className="mb-2 text-cp-11.5 leading-normal text-cp-ink-3">
                        Grades are anchored on the most recent broad score, then adjusted based on
                        subsequent follow-ups. If follow-ups reflect corrections, the grade could
                        improve. If it shows new or repeated violations, the grade could suffer
                        further penalties.
                    </p>
                    <div className="mt-3 mb-1" aria-label="Grade thresholds: F below 60, D 60 to 69, C 70 to 79, B 80 to 89, A 90 to 100">
                        <div className="mb-1 text-cp-11 font-bold tabular-nums" style={{ marginLeft: 'calc(83% - 24px)' }}>
                            83 · B
                            <span className="mt-0.5 ml-[18px] block h-2 w-0.5 bg-cp-ink" aria-hidden="true" />
                        </div>
                        <div className="flex h-[30px] overflow-hidden rounded-[5px] text-white">
                            <span className="flex flex-[60] flex-col items-center justify-center text-cp-11 leading-tight font-bold" style={{ background: 'var(--cp-grade-f)' }}>F<small className="text-cp-8.5 font-semibold opacity-90">0–59</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-cp-11 leading-tight font-bold" style={{ background: 'var(--cp-grade-d)' }}>D<small className="text-cp-8.5 font-semibold opacity-90">60–69</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-cp-11 leading-tight font-bold" style={{ background: 'var(--cp-grade-c)' }}>C<small className="text-cp-8.5 font-semibold opacity-90">70–79</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-cp-11 leading-tight font-bold" style={{ background: 'var(--cp-grade-b)' }}>B<small className="text-cp-8.5 font-semibold opacity-90">80–89</small></span>
                            <span className="flex flex-[10] flex-col items-center justify-center text-cp-11 leading-tight font-bold" style={{ background: 'var(--cp-grade-a)' }}>A<small className="text-cp-8.5 font-semibold opacity-90">90–100</small></span>
                        </div>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Grade adjustment rules">
                        <ScopeCard big="+65%" title="Re-checked IN" small="Returns 65% of that item's deduction" edge="var(--cp-grade-a)" />
                        <ScopeCard big="×1.5" title="Still OUT" small="A verified repeat — the full deduction grows half again" edge="var(--cp-grade-f)" />
                        <ScopeCard big="×1" title="OUT, fixed on site" small="Any on-site-correction credit is revoked — the full deduction stands, without the ×1.5" edge="var(--cp-grade-c)" />
                        <ScopeCard big="−6/−2" title="New finding" small="Docks at normal category weight" edge="var(--cp-grade-d)" />
                    </div>
                    <div className="mt-3 rounded-[8px] border border-cp-hairline bg-cp-bg px-3.5 py-3">
                        <p className="mb-2 text-cp-11.5 font-bold">Worked example; a broad inspection scoring 70, then one follow-up</p>
                        <RLine label="Broad inspection score" value="70" />
                        <RLine label="2 risk-factor violations verified fixed" small="65% of their 12 points returned" value="+7.8" tone="pos" />
                        <RLine label="6 good-retail-practice violations verified fixed" small="65% of their 12 points returned" value="+7.8" tone="pos" />
                        <RLine label="1 risk-factor item still out" small="deduction grows 6 → 9" value="−3" tone="neg" />
                        <div className="flex pt-2 text-cp-13 font-bold">
                            <span>Facility grade</span>
                            <b className="ml-auto tabular-nums">83 · B</b>
                        </div>
                        <p className="mt-2 text-cp-11 leading-normal text-cp-ink-3">
                            A 70 broad inspection + a mostly-good follow-up (9/10 violations
                            corrected) → a B 83 facility grade
                        </p>
                    </div>
                </Board>

                <Disclosure summary="Exact scoring edge cases">
                    <div className="space-y-2 text-cp-12 text-cp-ink-2">
                        <p><strong className="block text-cp-11.5 text-cp-ink">Repeat source</strong>A structured <em>Repeat</em> flag from the inspecting department or the word “repeat” in the observation makes that violation 1.5×.</p>
                        <p><strong className="block text-cp-11.5 text-cp-ink">Missing item number</strong>Defaults to the lower good-retail-practice deduction of 2 points.</p>
                        <p><strong className="block text-cp-11.5 text-cp-ink">Corrected on site</strong>Deducts 75% of its weight — the structured checklist’s COS marking (every OUT row for the item) earns 25% back. The credit is provisional: a later re-check that finds the item OUT again revokes it to the full deduction. It never erases the recorded violation or softens red-flag ranking.</p>
                        <p><strong className="block text-cp-11.5 text-cp-ink">Follow-up reports</strong>Checklist breadth—not the word “follow-up”—decides their role. A broad report publishes a score; focused and scope-unknown reports publish null. Their per-item IN/OUT verdicts can still adjust the facility grade above, joined on the form item number.</p>
                        <p><strong className="block text-cp-11.5 text-cp-ink">Grade without follow-ups</strong>Identical to the latest broad score, banded to a letter. Items never re-checked keep their full deduction; undated or same-day reports never adjust.</p>
                        <p><strong className="block text-cp-11.5 text-cp-ink">Written-verdict follow-ups</strong>Some follow-ups publish no checklist at all — the inspector’s verdict lives only in the written comments (“all violations corrected”). Those comments are adjudicated into a machine verdict by a separate, audited step — never parsed loosely at scoring time — and then adjust the grade exactly like a re-check of the items the broad inspection docked: “all corrected” restores like a full re-checked-IN clear, “not corrected” charges the verified-repeat ×1.5. Hedged or ambiguous comments (“corrected or are continuing to be implemented”) grant nothing until reviewed. A written verdict can restore or re-charge existing deductions, never add new ones, and a later structured re-check always outranks an earlier comment.</p>
                    </div>
                </Disclosure>
            </Card>

            {/* 02 — pipeline (the signals section that stood here was dropped
                in the 2026-09-07 pass; every section number below moved up one) */}
            <Card>
                <SecHead
                    no="02"
                    title="How an inspection report becomes this website"
                    sub="Users see a prepared snapshot of archived permits and inspections."
                />
                <ol className="grid gap-2">
                    {[
                        { t: 'Official sources', p: 'MyHealthDepartment provides VDH’s search roster, permit-history pages, and individual inspection reports. Fairfax County Health Department provides the county’s roster with locations, permits, and inspection reports as PDFs through the county’s PLUS system.', codes: ['permitID', 'inspectionID', '12VAC5-421', 'RECORDID', 'INSPECTIONID', 'FDA Food Code'] },
                        { t: 'Archival process', p: 'A collector stores roster JSON and compressed permit/report pages.', codes: ['raw HTML', 'roster JSON', 'collected time'] },
                        { t: 'Parse & preserve IDs', p: 'We extract identity, history, observations, citations, corrective actions, checklist rows, temperatures, and comments.', codes: ['fac:<permitID>', 'insp:<inspectionID>'] },
                        { t: 'Derive & store', p: 'Geo-locations are determined through public and opensource data. Determinative rules compute scores and grades', codes: ['geocode', 'computed fields', 'content hash'] },
                        { t: 'Merge & whitelist', p: 'At export, likely re-permits are presentation-merged. Per-facility history records clean up the user experience while the back-end retains lineage.', codes: ['lineage', 'finder + overlay + closed shards', 'facility history'] },
                        { t: 'Published contracts', p: 'Basic data such as links and coordinates live in GitHub while the full archive JSON lives in R2 and is only served once the terms have been acknowledged.', codes: ['static basic map', 'acknowledged full', 'full → basic fallback'] },
                    ].map((step, i) => (
                        <li key={step.t} className="grid grid-cols-[30px_1fr] gap-x-3 gap-y-1 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3 py-2.5">
                            <span className="row-span-3 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-cp-accent-solid text-cp-12 font-bold text-cp-accent-ink">{i + 1}</span>
                            <h3 className="text-cp-12.5 font-bold">{step.t}</h3>
                            <p className="col-start-2 text-cp-12 leading-normal text-cp-ink-2">{step.p}</p>
                            <div className="col-start-2 flex flex-wrap gap-1.5">
                                {step.codes.map((c) => (
                                    <code key={c} className="rounded-[4px] border border-cp-hairline bg-cp-bg px-1.5 py-1 font-mono text-cp-10.5 font-semibold text-cp-ink-2">{c}</code>
                                ))}
                            </div>
                        </li>
                    ))}
                </ol>
                <div className="mt-2 flex items-center gap-2 text-cp-11.5 text-cp-ink-3">
                    <Link2 size={13} aria-hidden="true" />
                    Source identifiers stay attached through the path. Views link back to the
                    publishing department’s record where one is available.
                </div>
            </Card>

            {/* 03 — lineage + tiers */}
            <Card>
                <SecHead
                    no="03"
                    title="What's official, and what's CleanPlateVA"
                />
                <div className="grid gap-2.5 sm:grid-cols-2">
                    <article className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3" style={{ borderTop: '3px solid var(--cp-accent)' }}>
                        <Pbadge kind="official">Official health department record</Pbadge>
                        <h3 className="mt-2 mb-1.5 text-cp-13 font-bold">Archived and reorganized</h3>
                        <ul className="list-disc pl-4 text-cp-12 leading-normal text-cp-ink-2">
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
                        <h3 className="mt-2 mb-1.5 text-cp-13 font-bold">Computed or enriched</h3>
                        <ul className="list-disc pl-4 text-cp-12 leading-normal text-cp-ink-2">
                            <li>Inspection score: raw 0–100 formula on each broad report</li>
                            <li>Facility grades: score + A–F letter, latest broad ± follow-up re-checks</li>
                            <li>Breadth-derived score trend, red flags, and open-repeat count</li>
                            <li>Public/open-source derived map coordinates and approximate-locations</li>
                            <li>“Restaurants only” classification</li>
                            <li>Presentation merge of likely predecessor permits</li>
                        </ul>
                    </article>
                </div>
                <div className="mt-3 grid gap-2">
                    <article className="flex gap-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[8px] border border-cp-hairline bg-cp-bg text-cp-ink-2"><MapPin size={16} aria-hidden="true" /></span>
                        <div>
                            <div className="text-cp-10.5 font-semibold tracking-[.07em] text-cp-accent uppercase">Basic map</div>
                            <h3 className="mt-0.5 mb-1 text-cp-13 font-bold">Identity, location, source handoff</h3>
                            <p className="text-cp-12 leading-normal text-cp-ink-2">Snapshot markers are recorded as active at time of archive. Names, addresses, geocoded coordinates, restaurant classification, approximation and mobile-unit flags, permit IDs, and the source route are extracted to the best of our ability in the archival process. Status can age; when in doubt, refer to the public records posted by the respective authorities.</p>
                        </div>
                    </article>
                    <article className="flex gap-3 rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3.5 py-3">
                        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[8px] border border-cp-accent bg-cp-bg text-cp-accent"><ClipboardCheck size={16} aria-hidden="true" /></span>
                        <div>
                            <div className="text-cp-10.5 font-semibold tracking-[.07em] text-cp-accent uppercase">Inspection grades</div>
                            <h3 className="mt-0.5 mb-1 text-cp-13 font-bold">Reports plus CleanPlateVA's proprietary derived signals</h3>
                            <p className="text-cp-12 leading-normal text-cp-ink-2">Inspection histories, citations, observations, checklists, temperatures, comments, status, lineage, and CleanPlateVA-calculated metrics, loaded after the visitor acknowledges the Terms of Use and Data Acknowledgment (§05). If that data cannot be loaded, the basic map remains.</p>
                        </div>
                    </article>
                </div>
            </Card>

            {/* 04 — limits */}
            <Card>
                <SecHead
                    no="04"
                    title="Limitations"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                    {[
                        ['Selected coverage', 'Coverage is the ZIP count shown above. Absence from this map does not mean absence from the source records; a place may sit outside the covered ZIPs.'],
                        ['Snapshot, not live', 'Collection and publication can lag. “Newest report” is one maximum date.'],
                        ['Permit status can age', 'An incremental scan can retain the last known “active” state after a facility stops receiving inspections. A full resweep reconciles closures; a marker is not operating-status proof.'],
                        ['Source retention', 'Both source systems typically expose about two years of history. Missing report pages remain missing or unscored; this is an archive of what was collected to the best of our ability and does not reflect entire inspection histories.'],
                        ['Geocoded locations', 'Pins come from address lookups through VGIN, Fairfax County Health Department, the U.S. Census Bureau, OpenStreetMap/Nominatim, Overture Maps and Foursquare OS Places. Some pins are manually placed after review. Pins are separated to the best of our ability, but where geo-location data overlaps, as often occurs at airports, malls, or on a campus, pins are “stacked” together to be browsed as a group.'],
                        ['Presentation decisions', '“Restaurants only” uses permit-type/name patterns. History merging uses shared location/address plus name similarity. Either can misclassify, combine, or miss a match; retained permit IDs are the audit trail.'],
                        ['Inspection breadth is a determinative CleanPlateVA heuristic', 'A “focused” follow-up (as determined by the number of items listed as inspected at the source) adjusts the facility grade item by item, but never replaces the broad inspection that anchors it for grading purposes. These are determinative rules for CleanPlateVA’s proprietary grading system and do not reflect the judgement or values of the Virginia Department of Health or Fairfax County Health Department.'],
                        ['The source record remains the source of truth', 'Scores and summaries are comparison tools, not safety or illness predictions. If our presentation and the source disagree, the official record of the publishing health department is authoritative.'],
                    ].map(([h, p]) => (
                        <article key={h} className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-3 py-2.5">
                            <h3 className="mb-1 text-cp-12 font-bold">{h}</h3>
                            <p className="text-cp-11.5 leading-normal text-cp-ink-2">{p}</p>
                        </article>
                    ))}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-[8px] border border-cp-accent bg-cp-surface-2 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                        <h3 className="text-cp-12.5 font-bold">Verify at the source</h3>
                        <p className="text-cp-11.5 leading-normal text-cp-ink-2">Facility rows and report cards expose links to the publishing health department’s record where available. Compare the observation, citation, corrective action, and checklist markings yourself.</p>
                    </div>
                    <a
                        href={PORTAL_URL}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex flex-none items-center gap-1.5 rounded-cp-control border border-cp-accent px-2.5 py-1.5 text-cp-12 font-semibold text-cp-accent hover:bg-cp-surface-3"
                    >
                        Open VDH portal
                        <ExternalLink size={13} aria-hidden="true" />
                    </a>
                    <a
                        href={FAIRFAX_RECORDS_URL}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex flex-none items-center gap-1.5 rounded-cp-control border border-cp-accent px-2.5 py-1.5 text-cp-12 font-semibold text-cp-accent hover:bg-cp-surface-3"
                    >
                        Open Fairfax County reports
                        <ExternalLink size={13} aria-hidden="true" />
                    </a>
                </div>
            </Card>

            {/* 05 — terms (the ONE source; the ack dialog clones #aboutTermsBody) */}
            <Card id="aboutTerms">
                <SecHead
                    no="05"
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
                    <p className="m-0 min-w-[260px] flex-1 text-cp-12.5 leading-normal text-cp-ink-2">{status.text}</p>
                    {status.action && (
                        <button
                            type="button"
                            onClick={status.action.tone === 'danger' ? onSwitchToBasic : onReviewTerms}
                            className="flex-none rounded-cp-control border px-2.5 py-1.5 text-cp-12 font-semibold hover:bg-cp-surface-3"
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
