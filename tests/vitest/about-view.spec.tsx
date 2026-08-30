// @vitest-environment jsdom
/**
 * The §6.4 About (CRVb-M1): full content parity with the live page in the
 * ratified structure — the hero legend + four live cards, §01's boards
 * and BOTH worked receipts, §02's signals + red-flag weights, §03's
 * pipeline (C8: the channel chips say "basic map", never "lite"), §04's
 * lineage + tiers + the current-access card, §05's eight limits + the
 * verify card, and §06's VERBATIM single-source terms with the real
 * attribution hrefs + the status panel OUTSIDE the cloned body owning
 * the one tier switch (C2). Plus the ported tier/status derivations.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { AboutView, accessCard, basicMapReason, termsStatus } from '../../app/AboutView'
import type { LoadedRoster } from '../../app/data/types'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ANSWERED = { agreed: true, decided: true, persisted: true }
const DECLINED = { agreed: false, decided: true, persisted: true }
const UNDECIDED = { agreed: false, decided: false, persisted: false }

test('basicMapReason speaks the terms vocabulary for every state', () => {
    expect(basicMapReason(true, UNDECIDED)).toBe('Forced by ?tier=lite; no terms asked')
    expect(basicMapReason(false, ANSWERED))
        .toBe('Terms acknowledged; inspection data unavailable, basic map shown')
    expect(basicMapReason(false, DECLINED)).toBe('Terms declined on this device')
    expect(basicMapReason(false, { ...DECLINED, persisted: false }))
        .toBe('Terms declined for this visit')
    expect(basicMapReason(false, UNDECIDED)).toBe('Terms not yet acknowledged')
})

test('the current-access card states the tier actually loaded AND why', () => {
    expect(accessCard(false, false, ANSWERED))
        .toEqual({ label: 'Inspection grades', detail: 'Terms acknowledged on this device' })
    expect(accessCard(true, false, DECLINED).label).toBe('Basic map')
})

test('the §06 status panel: agreed → red switch out · declined → blue way in · ?tier=lite → no button', () => {
    const agreed = termsStatus(false, ANSWERED)
    expect(agreed.text).toContain('acknowledged on this device')
    expect(agreed.action).toEqual({ label: 'Switch to the basic map', tone: 'danger' })
    const declined = termsStatus(false, DECLINED)
    expect(declined.text).toContain('not acknowledged on this device')
    expect(declined.action).toEqual({ label: 'Review the terms and view grades', tone: 'accent' })
    const forced = termsStatus(true, ANSWERED)
    expect(forced.text).toContain('?tier=lite')
    expect(forced.action).toBeNull()
})

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    host?.remove()
    host = null
})

function loadedFixture(): LoadedRoster {
    return {
        contract: 'cleanplateva.full-manifest.v4',
        schema_version: 4,
        available: true,
        mode: 'full',
        snapshot_id: 'snap-1',
        fetched_at: '2026-08-24T12:00:00Z',
        freshness: { snapshot_id: 'snap-1', newest_report: '2026-08-21' },
        vocab: { permit_type: [], loc: [], scope: [] },
        facilities: [],
        // The full manifest's `total` includes the closed supplement; the
        // Places card must show `active` (the public manifest has only
        // `total`, which IS the actives there).
        counts: { total: 28087, active: 25164, by_zip: { '23220': 100, '23223': 60, '?': 4 } },
    } as unknown as LoadedRoster
}

async function render(over: Partial<React.ComponentProps<typeof AboutView>> = {}) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <AboutView
                loaded={over.loaded !== undefined ? over.loaded : loadedFixture()}
                unavailable={over.unavailable ?? false}
                lite={over.lite ?? false}
                forceLite={over.forceLite ?? false}
                ack={over.ack ?? ANSWERED}
                onSwitchToBasic={over.onSwitchToBasic ?? (() => {})}
                onReviewTerms={over.onReviewTerms ?? (() => {})}
                scrollToTerms={over.scrollToTerms ?? false}
                onTermsShown={over.onTermsShown ?? (() => {})}
            />,
        )
    })
    return host
}

test('content parity: hero, both receipts, weights, pipeline, lineage, all eight limits', async () => {
    const el = await render()
    // Hero: the live H1, the legend, the four ratified live cards.
    expect(el.textContent).toContain('Every marker has a source ID. Every score has math.')
    for (const badge of ['Official source', 'Archived snapshot', 'CleanPlateVA-derived']) {
        expect(el.textContent).toContain(badge)
    }
    expect(el.textContent).toContain('Aug 24, 2026')     // fetched_at → snapshot card
    expect(el.textContent).toContain('Aug 21, 2026')     // newest report held
    expect(el.textContent).toContain('25,164')           // places = ACTIVE, not total
    expect(el.textContent).not.toContain('28,087')       // the closed-inclusive total never shows
    expect(el.textContent).toContain('2')                // ZIP count excludes '?'
    // §01: both worked receipts with their exact numbers.
    expect(el.textContent).toContain('2 good-retail-practice violations, corrected on site')
    expect(el.textContent).toContain('as a facility grade → B')
    expect(el.textContent).toContain('Broad inspection score')
    expect(el.textContent).toContain('83 · B')
    expect(el.textContent).toContain('not laundered')
    expect(el.textContent).toContain('Hedged or ambiguous comments')   // the full edge-cases text
    // §02: signals + the weight disclosure.
    expect(el.textContent).toContain('+8 sewage/wastewater · rodents/pests · vomit/diarrhea/ill employee')
    expect(el.textContent).toContain('capped at 180 characters')
    // §03: six steps; the channel chips speak C8 — never "lite".
    expect(el.textContent).toContain('idempotent CouchDB projections')
    expect(el.textContent).toContain('static basic map')
    expect(el.textContent).not.toContain('static lite')
    // §04: lineage lists + tier route + current access.
    expect(el.textContent).toContain('Checklist IN/OUT/N/A/N/O, COS, and Repeat markings')
    expect(el.textContent).toContain('Terms acknowledged on this device')
    // §05: all eight limit headings + the verify card's real portal href.
    for (const h of ['Selected coverage', 'Snapshot, not live', 'Permit status can age',
        'Source retention', 'Geocoded locations', 'Presentation heuristics',
        'Focused is not facility-wide', 'VDH wins conflicts']) {
        expect(el.textContent).toContain(h)
    }
    const portal = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Open VDH portal'))
    expect(portal?.getAttribute('href')).toBe('https://inspections.myhealthdepartment.com/virginia')
})

test('§06 carries the verbatim single-source terms with the real attribution hrefs', async () => {
    const el = await render()
    const body = el.querySelector('#aboutTermsBody')
    expect(body).toBeTruthy()
    // Verbatim sentences (typographic quotes preserved — Cannon's words).
    expect(body?.textContent).toContain('CleanPlateVA is an independent service and is not affiliated with, operated by, or endorsed by the Virginia Department of Health or MyHealthDepartment.')
    expect(body?.textContent).toContain('By selecting “Agree and View Grades”, you acknowledge that you have read and understood these terms')
    expect(body?.textContent).toContain('Your selection will be remembered on this device and can be changed later from the About page.')
    // The attribution inventory's real destinations (D-ACK-2 rides here).
    const hrefs = Array.from(body?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href'))
    for (const url of [
        'https://vgin.vdem.virginia.gov/',
        'https://geocoding.geo.census.gov/',
        'https://www.openstreetmap.org/copyright',
        'https://opendatacommons.org/licenses/odbl/',
        'https://overturemaps.org',
        'https://cdla.dev/permissive-2-0/',
        'https://opensource.foursquare.com/os-places/',
        'https://www.apache.org/licenses/LICENSE-2.0',
        'https://carto.com/attributions',
    ]) {
        expect(hrefs).toContain(url)
    }
    // The status panel sits OUTSIDE the cloned body (C2).
    expect(body?.textContent).not.toContain('Switch to the basic map')
    expect(el.textContent).toContain('Switch to the basic map')
})

test('the status panel buttons drive the tier switch', async () => {
    let switched = 0
    let reviewed = 0
    const el = await render({
        onSwitchToBasic: () => { switched += 1 },
        onReviewTerms: () => { reviewed += 1 },
    })
    const out = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Switch to the basic map')
    await act(async () => {
        out?.click()
    })
    expect(switched).toBe(1)

    const el2 = await (async () => {
        await act(async () => {
            root?.unmount()
        })
        host?.remove()
        return render({ lite: true, ack: DECLINED, onReviewTerms: () => { reviewed += 1 } })
    })()
    const back = Array.from(el2.querySelectorAll('button')).find((b) => b.textContent === 'Review the terms and view grades')
    await act(async () => {
        back?.click()
    })
    expect(reviewed).toBe(1)
})

test('?tier=lite states the override and offers nothing to press', async () => {
    const el = await render({ lite: true, forceLite: true, ack: UNDECIDED })
    expect(el.textContent).toContain('?tier=lite')
    expect(Array.from(el.querySelectorAll('button')).map((b) => b.textContent))
        .not.toContain('Review the terms and view grades')
})

test('a cold-loaded terms intent scrolls §06 into view and focuses the title, once', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    let shown = 0
    await render({ scrollToTerms: true, onTermsShown: () => { shown += 1 } })
    await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(scrolled).toHaveBeenCalled()
    expect(shown).toBe(1)
    expect(document.activeElement?.id).toBe('aboutTermsTitle')
})

test('an unavailable roster keeps the methodology and says the cards are unavailable', async () => {
    const el = await render({ loaded: null, unavailable: true })
    expect(el.textContent).toContain('Unavailable')
    expect(el.textContent).toContain('Every marker has a source ID')
    expect(el.querySelector('#aboutTermsBody')).toBeTruthy()
})
