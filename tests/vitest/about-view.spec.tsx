// @vitest-environment jsdom
/**
 * The §6.4 About (CRVb-M1), pinned to Cannon's 2026-09-07 copy pass:
 * the hero's title + two bold disclaimers + four live cards (no badges, no
 * kicker), §01's boards and BOTH worked receipts, §02's pipeline (C8: the
 * channel chips say "basic map", never "lite"), §03's lineage + tiers,
 * §04's eight limits + the verify card, and §05's VERBATIM single-source
 * terms with the real attribution hrefs + the status panel OUTSIDE the
 * cloned body owning the one tier switch (C2). The old §02 signals
 * section and the current-access card are asserted ABSENT.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { AboutView, termsStatus } from '../../app/AboutView'
import type { LoadedRoster } from '../../app/data/types'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ANSWERED = { agreed: true, decided: true, persisted: true }
const DECLINED = { agreed: false, decided: true, persisted: true }
const UNDECIDED = { agreed: false, decided: false, persisted: false }

test('the §05 status panel: agreed → red switch out · declined → blue way in · ?tier=lite → no button', () => {
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
    // Hero (2026-09-07): the title, the two bold disclaimers as REAL
    // emphasis (the editor hands over `<b>`/`<br>` as text; the JSX must
    // carry them as elements), the four live cards under their new labels
    // — and neither the provenance legend nor the kicker.
    // Hero brand logo, CENTERED and alone (2026-09-10): the GitHub and
    // PeerPush badges are gone from the page entirely, so the hero's only
    // images are the theme logo's two faces and its row just centers them.
    const heroImgs = el.querySelectorAll('main section:first-of-type img')
    expect(heroImgs.length).toBe(2)
    expect(heroImgs[0]?.className).toContain('light:hidden')
    expect(heroImgs[1]?.className).toContain('light:block')
    const logoRow = heroImgs[0]?.closest('section')?.firstElementChild
    expect(logoRow?.className).toContain('justify-center')
    expect(logoRow?.className).not.toContain('justify-between')
    expect(logoRow?.children.length).toBe(1)
    expect(el.querySelector('a[href*="github.com"]')).toBeNull()
    expect(el.querySelector('a[href*="peerpush.com"]')).toBeNull()
    expect(el.querySelector('img[src*="peerpush.com"]')).toBeNull()

    expect(el.textContent).toContain("CleanPlateVA: an unofficial archive and grading of Virginia's health-inspected food-serving facilities")
    const hero = el.querySelector('h1 + p') as HTMLElement
    expect(hero.querySelectorAll('strong')).toHaveLength(2)
    expect(hero.querySelectorAll('br')).toHaveLength(3)   // the derived-grade disclaimer sits on its own block, a break either side
    expect(hero.textContent).toContain("derived from CleanPlateVA's proprietary grading system")
    expect(hero.textContent).toContain('This site is for reference use only')
    expect(hero.textContent).not.toContain('<b>')
    expect(el.querySelector('[aria-label="Provenance legend"]')).toBeNull()
    expect(el.textContent).not.toContain('Methodology & provenance')
    expect(el.textContent).not.toContain('Every marker has a source ID')
    expect(el.textContent).toContain('Last snapshot')
    expect(el.textContent).toContain('Aug 24, 2026')     // fetched_at → snapshot card
    expect(el.textContent).not.toContain('export time, not a live query')
    expect(el.textContent).toContain('Aug 21, 2026')     // newest report held
    expect(el.textContent).toContain('Facilities')
    expect(el.textContent).toContain('25,164')           // facilities = ACTIVE, not total
    expect(el.textContent).not.toContain('28,087')       // the closed-inclusive total never shows
    expect(el.textContent).toContain('2')                // ZIP count excludes '?'
    // The sections run 01–05: the signals section is gone whole and every
    // number after it moved up one (Cannon's call, incl. Terms → 05).
    const numbers = Array.from(el.querySelectorAll('span.opacity-60')).map((s) => s.textContent)
    expect(numbers).toEqual(['01', '02', '03', '04', '05'])
    expect(el.textContent).not.toContain('What the other signals mean')
    expect(el.textContent).not.toContain('+8 sewage/wastewater')
    // §01: the reframed head, both worked receipts with their exact numbers,
    // the `<i>broad</i>` handed over as an <em>.
    expect(el.textContent).toContain('All facilities start at 100, with violations subtracting')
    expect(el.textContent).toContain('do not provides grades or scores')
    expect(el.textContent).not.toContain('Computed here')
    expect(el.textContent).toContain('2 good-retail-practice violations, corrected on site')
    expect(Array.from(el.querySelectorAll('em')).some((e) => e.textContent === 'broad')).toBe(true)
    expect(el.textContent).toContain('as a facility grade → B')
    expect(el.textContent).toContain('Follow-ups that adjust the grade')
    expect(el.textContent).toContain('Grades are anchored on the most recent broad score')
    expect(el.textContent).toContain('Broad inspection score')
    expect(el.textContent).toContain('83 · B')
    expect(el.textContent).toContain('9/10 violations corrected')
    expect(el.textContent).not.toContain('not laundered')
    expect(el.textContent).toContain('Hedged or ambiguous comments')   // the full edge-cases text
    // §02 pipeline: six steps; the channel chips speak C8 — never "lite".
    expect(el.textContent).toContain('Users see a prepared snapshot of archived permits and inspections.')
    expect(el.textContent).toContain('Archival process')
    expect(el.textContent).toContain('Published contracts')
    expect(el.textContent).not.toContain('idempotent CouchDB projections')
    expect(el.textContent).not.toContain('Snapshot pipeline')
    expect(el.textContent).toContain('static basic map')
    expect(el.textContent).not.toContain('static lite')
    // §03 lineage: the lists minus the retired compliance row; the tier
    // arrow row and the current-access card are gone; the cross-reference
    // into the terms follows the renumbering.
    expect(el.textContent).toContain("What's official, and what's CleanPlateVA")
    expect(el.textContent).toContain('Checklist IN/OUT/N/A/N/O, COS, and Repeat markings')
    expect(el.textContent).toContain('Inspection score: raw 0–100 formula on each broad report')
    expect(el.textContent).not.toContain('Checklist compliance percentage')
    expect(el.textContent).toContain("Reports plus CleanPlateVA's proprietary derived signals")
    expect(el.textContent).toContain('Data Acknowledgment (§05)')
    expect(el.textContent).not.toContain('(§06)')
    expect(el.textContent).not.toContain('Current access')
    expect(el.textContent).not.toContain('inspection grades load; otherwise the basic map remains')
    // §04: all eight limit headings + the verify card's real portal href.
    expect(el.textContent).toContain('Limitations')
    for (const h of ['Selected coverage', 'Snapshot, not live', 'Permit status can age',
        'Source retention', 'Geocoded locations', 'Presentation decisions',
        'Inspection breadth is a determinative CleanPlateVA heuristic',
        'The source record remains the source of truth']) {
        expect(el.textContent).toContain(h)
    }
    expect(el.textContent).toContain('pins are “stacked” together')
    const portal = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Open VDH portal'))
    expect(portal?.getAttribute('href')).toBe('https://inspections.myhealthdepartment.com/virginia')
    // FFX-M4: the verify card offers both departments' public search pages.
    const county = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Open Fairfax County reports'))
    expect(county?.getAttribute('href')).toBe('https://www.fairfaxcounty.gov/health/food/inspection-reports')
})

test('§05 carries the verbatim single-source terms with the real attribution hrefs', async () => {
    const el = await render()
    const body = el.querySelector('#aboutTermsBody')
    expect(body).toBeTruthy()
    // Verbatim sentences (typographic quotes preserved — Cannon's words).
    expect(body?.textContent).toContain('CleanPlateVA is an independent service and is not affiliated with, operated by, or endorsed by the Virginia Department of Health, MyHealthDepartment, or the Fairfax County Health Department.')
    // FFX-M4 (OQ-B, Cannon 2026-09-05): both agencies named once, the county's
    // outcome paragraph kept, the acknowledgment generalized.
    expect(body?.textContent).toContain('published by two agencies')
    expect(body?.textContent).toContain('The Fairfax County Health Department records an inspection outcome')
    expect(body?.textContent).toContain('rather than official ratings issued by any health department')
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
        return render({ ack: DECLINED, onReviewTerms: () => { reviewed += 1 } })
    })()
    const back = Array.from(el2.querySelectorAll('button')).find((b) => b.textContent === 'Review the terms and view grades')
    await act(async () => {
        back?.click()
    })
    expect(reviewed).toBe(1)
})

test('?tier=lite states the override and offers nothing to press', async () => {
    const el = await render({ forceLite: true, ack: UNDECIDED })
    expect(el.textContent).toContain('?tier=lite')
    expect(Array.from(el.querySelectorAll('button')).map((b) => b.textContent))
        .not.toContain('Review the terms and view grades')
})

test('a cold-loaded terms intent scrolls §05 into view and focuses the title, once', async () => {
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
    // The unavailable branch carries the same card labels as the live one.
    expect(el.textContent).toContain('Last snapshot')
    expect(el.textContent).toContain('Facilities')
    expect(el.textContent).toContain('CleanPlateVA: an unofficial archive and grading')
    expect(el.querySelector('#aboutTermsBody')).toBeTruthy()
})
