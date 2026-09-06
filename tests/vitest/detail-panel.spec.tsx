// @vitest-environment jsdom
/**
 * The §6.2 detail panel (CRVa-M2): header with the Source button (external
 * grammar) + close; the structural fact line with `≈ approximate` as the
 * ONE badge; the grade hero as a single TAPPABLE box that opens the
 * report-card modal; the shared panel instrument in a labeled trend
 * section; history rows carrying scores only (grade letters are the
 * facility's, never an inspection's — C1/C9); the basic map keeps the
 * identity + official-VDH hand-off. Plus the stack member popover
 * (Cannon's M1-boundary call).
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { DetailPanel } from '../../app/DetailPanel'
import { StackPopover } from '../../app/StackPopover'
import type { FacilityDetail, Inspection, RosterRow } from '../../app/data/types'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

async function render(el: React.ReactElement) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(el)
    })
    return host
}

function row(over: Partial<RosterRow> = {}): RosterRow {
    return {
        permit_id: 'D-1', name: 'Golden Dragon Express', address: '4903 Nine Mile Rd',
        address2: null, city: 'Henrico', zip: '23223', tenant: 'henrico',
        is_restaurant: true, mobile: false, pt: 1,
        lat: 37.53, lon: -77.36, loc: 2,
        o: { grade_score: 78, trend_delta: -7, base_yyyymmdd: 20260519 },
        ...over,
    }
}

const inspections: Inspection[] = [
    {
        inspection_id: 'I2', date: '2026-07-30', scope: 'focused', purpose: 'Follow-Up',
        score: 96, report_url: 'https://inspections.example/2',
        checklist: [
            { item: 21, disposition: 'OUT', category: 'Food Protection', standard_text: 'Food-contact surfaces cleaned & sanitized', compliant: false, violation: true, cos: true, repeat: false, is_sentinel: false },
            { item: 47, disposition: 'OUT', category: 'Facility Maintenance', standard_text: 'Non-food-contact surfaces clean', compliant: false, violation: true, cos: false, repeat: true, is_sentinel: false },
        ] as Inspection['checklist'],
        violations: [
            { item: 21, text: 'Slicer blade guard soiled', corrective: 'Cleaned and sanitized during the inspection.' },
            { item: 47, text: 'Buildup on walk-in shelving', corrective: 'To be addressed before the next routine inspection.' },
        ],
        comments: 'Follow-up limited to the items cited 2026-05-19.',
    },
    {
        inspection_id: 'I1', date: '2026-05-19', scope: 'broad', purpose: 'Routine',
        score: 78, applicable_item_count: 31,
        checklist: [
            { item: 21, disposition: 'OUT', category: 'Food Protection', standard_text: 'Food-contact surfaces cleaned & sanitized', compliant: false, violation: true, cos: false, repeat: false, is_sentinel: false },
        ] as Inspection['checklist'],
        violations: [{ item: 21, text: 'Slicer blade guard soiled' }],
        temps_v2: {
            food_present: true,
            food: [{ description: 'Walk-in ambient', temperature: '38F', temperature_f: 38, state_of_food: 'Cold Holding' }],
        },
    },
]

function detail(over: Partial<FacilityDetail> = {}): FacilityDetail {
    return {
        contract: 'cleanplateva.facility-detail.v4',
        schema_version: 4,
        available: true,
        facility: {
            ...row(),
            permit_type: 'Full Service Restaurant',
            status: 'Permitted',
            grade: {
                score: 78, letter: 'C', adjusted: false, base_score: 78, base_letter: 'C',
                base_date: '2026-05-19', base_inspection_id: 'I1', followups: 0,
                narrative_followups: 0, narrative_items: [], restored_items: [],
                failed_items: [], cos_items: [], new_items: [], unchecked_items: [],
                restored_points: 0, extra_points: 0,
            },
        },
        inspections,
        ...over,
    }
}

test('the full panel: header, fact line, tappable hero → report-card modal, trend section, history', async () => {
    const el = await render(
        <DetailPanel
            row={row()}
            lite={false}
            state={{ status: 'ready', detail: detail() }}
            onClose={() => {}}
            onAbout={() => {}}
        />,
    )
    // Header: identity + the Source button in the external grammar + close.
    expect(el.textContent).toContain('Golden Dragon Express')
    const source = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Source'))
    expect(source?.getAttribute('href')).toMatch(/inspections\.myhealthdepartment\.com/)
    expect(el.querySelector('button[aria-label="Close"]')).toBeTruthy()
    // The fact line: kind + status structurally, ≈ as the one badge (C9 —
    // this row is a zip-centroid, qualified on the full tier too).
    expect(el.textContent).toContain('Full Service Restaurant')
    expect(el.textContent).toContain('Permitted')
    expect(el.textContent).toContain('≈ approximate location')
    // The hero is ONE tappable box that opens the breakdown.
    const hero = el.querySelector('button[aria-haspopup="dialog"]')
    expect(hero?.textContent).toContain('78')
    expect(hero?.textContent).toContain('Declining')
    expect(hero?.textContent).toContain('Tap to see Grade breakdown')
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => {
        ;(hero as HTMLButtonElement).click()
    })
    // The modal's chunk loads on its first open (CRP-M5) — give the lazy
    // import a moment to land; every later open is synchronous.
    for (let i = 0; i < 100 && !el.querySelector('[role="dialog"]'); i += 1) {
        await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    }
    const modal = el.querySelector('[role="dialog"]')
    expect(modal).toBeTruthy()
    expect(modal?.textContent).toContain('How this grade was computed')
    expect(modal?.textContent).toContain('Broad inspection — May 19, 2026')
    // The trend section is the labeled §6.0 instrument (panel variant).
    expect(el.textContent).toContain('Trend · 2 visits')
    expect(el.querySelector('svg.cp-trend--interactive')).toBeTruthy()
    expect(el.textContent).toContain('broad score')
    // History: the full inventory — corrective lines, checklist, comments, temps.
    expect(el.textContent).toContain('Inspection history · 2 visits')
    expect(el.textContent).toContain('↳ ')
    expect(el.textContent).toContain('Cleaned and sanitized during the inspection.')
    expect(el.textContent).toContain('Inspection checklist — 2 distinct applicable code items · 2 published rows · 2 OUT')
    expect(el.textContent).toContain('Inspector comments')
    expect(el.textContent).toContain('Temperatures & sanitizer — 1 readings')
    // Scores only on inspections: the broad row wears 78 as a PILL, and no
    // history row ever carries a grade letter of its own.
    expect(el.textContent).toContain('2/2 OUT')      // the focused row's ratio badge
    expect(el.textContent).not.toContain('Grade C · ')
})

test('the basic map keeps the identity + official hand-off (P6/C8)', async () => {
    const el = await render(
        <DetailPanel
            row={row()}
            lite
            state={{ status: 'loading' }}
            onClose={() => {}}
            onAbout={() => {}}
        />,
    )
    expect(el.textContent).toContain('View inspections on VDH')
    expect(el.textContent).toContain('this map is a finder')
    expect(el.textContent).not.toContain('Tap to see Grade breakdown')
    expect(el.querySelector('svg.cp-trend')).toBeNull()
})

// FFX-M4: a Fairfax Health District facility. The exporter's `tenant`
// sentinel routes every link to the county; the fact line names the
// department; each report is a county PDF; the county's own outcome rides
// with its explanation (OQ-D, never a badge); a visit the county lists with
// no report held is a row on its date (OQ-I); the hero carries the OQ-G line.
const fairfaxInspections: Inspection[] = [
    {
        inspection_id: '4999999', date: '2026-08-30', scope: 'unknown', purpose: '',
        score: null, checklist_present: false, checklist: [], violations: [],
        report_url: 'https://plus.fairfaxcounty.gov/CitizenAccess/urlrouting.ashx?type=1001&SeqNo=9999999',
        source_outcome: 'Partial Pass', report_available: false,
    },
    {
        inspection_id: '4177997', date: '2026-08-13', scope: 'broad', purpose: 'Routine',
        score: 100, applicable_item_count: 52,
        report_url: 'https://plus.fairfaxcounty.gov/CitizenAccess/urlrouting.ashx?type=1001&SeqNo=6821183',
        source_outcome: 'Passed', checklist: [], violations: [],
    },
]

function fairfaxDetail(): FacilityDetail {
    return {
        contract: 'cleanplateva.facility-detail.v4',
        schema_version: 4,
        available: true,
        facility: {
            ...row({ permit_id: 'HFOOD-000011010', name: 'Bull Run Regional Park', tenant: 'fairfax', loc: 0 }),
            jurisdiction_source: 'fairfax',
            permit_type: 'Full Service Restaurant',
            status: 'Active',
            grade: {
                score: 100, letter: 'A', adjusted: false, base_score: 100, base_letter: 'A',
                base_date: '2026-08-13', base_inspection_id: '4177997', followups: 0,
                narrative_followups: 0, narrative_items: [], restored_items: [],
                failed_items: [], cos_items: [], new_items: [], unchecked_items: [],
                restored_points: 0, extra_points: 0,
            },
        },
        inspections: fairfaxInspections,
    }
}

test('a Fairfax Health District facility links to the county and names it (FFX-M4)', async () => {
    const el = await render(
        <DetailPanel
            row={row({ permit_id: 'HFOOD-000011010', name: 'Bull Run Regional Park', tenant: 'fairfax' })}
            lite={false}
            state={{ status: 'ready', detail: fairfaxDetail() }}
            onClose={() => {}}
            onAbout={() => {}}
        />,
    )
    const source = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Source'))
    expect(source?.getAttribute('href')).toBe('https://www.fairfaxcounty.gov/health/food/inspection-reports')
    expect(source?.getAttribute('title')).toContain('Fairfax County Health Department')
    // the fact line: the county's word for status, verbatim, and the department
    expect(el.textContent).toContain('Active')
    expect(el.textContent).toContain('Fairfax County Health Department')
    expect(el.textContent).not.toContain('Virginia Department of Health')
    // OQ-G on the hero
    const hero = el.querySelector('button[aria-haspopup="dialog"]')
    expect(hero?.textContent).toContain('Fairfax County grades are anchored on the most recent full inspection.')
    // the unavailable visit leads the history on its date, at scope unknown
    expect(el.textContent).toContain('Inspection history · 2 visits')
    expect(el.textContent).toContain('No report is held for this visit; the county’s copy may be available.')
    const links = Array.from(el.querySelectorAll('a[href*="plus.fairfaxcounty.gov"]'))
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
        'Download the county’s copy of this report (PDF)',
        'Download the official Fairfax County Health Department report for this inspection (PDF)',
    ])
    // OQ-D: the county's outcome with its explanation, never a badge
    expect(el.textContent).toContain('County outcome: Partial Pass')
    expect(el.textContent).toContain('Outcome recorded by the Fairfax County Health Department for this visit.')
    expect(el.textContent).toContain('about 3 percent of visits recorded as Passed')
    expect(el.textContent).not.toContain('Open the official VDH report')
})

test('the basic map hands a Fairfax facility off to the county (FFX-M4)', async () => {
    const el = await render(
        <DetailPanel
            row={row({ tenant: 'fairfax' })}
            lite
            state={{ status: 'loading' }}
            onClose={() => {}}
            onAbout={() => {}}
        />,
    )
    expect(el.textContent).toContain('View inspections at Fairfax County')
    expect(el.textContent).toContain('official Fairfax County Health Department site — this map is a finder')
    const cta = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('View inspections'))
    expect(cta?.getAttribute('href')).toBe('https://www.fairfaxcounty.gov/health/food/inspection-reports')
})

test('a Fairfax row with ffx_oid deep-links the Source and the basic-map hand-off into the county map', async () => {
    // DOMINION EATS — the county's own link for it carries OBJECTID 335393.
    const deepLink = 'https://experience.arcgis.com/experience/0e687ef56da44ef287d20ced8cc85a3f/page/Main-Page'
        + '#data_s=id%3AdataSource_5-17e77d67cec-layer-3%3A335393'
    const full = await render(
        <DetailPanel
            row={row({ permit_id: 'HFOOD-2026-00063', name: 'Dominion Eats', tenant: 'fairfax', ffx_oid: 335393 })}
            lite={false}
            state={{ status: 'ready', detail: fairfaxDetail() }}
            onClose={() => {}}
            onAbout={() => {}}
        />,
    )
    const source = Array.from(full.querySelectorAll('a')).find((a) => a.textContent?.includes('Source'))
    expect(source?.getAttribute('href')).toBe(deepLink)
    expect(source?.getAttribute('title')).toBe("Open this facility's official Fairfax County Health Department record")
    // the basic map renders from the finder row alone — no detail fetched
    const lite = await render(
        <DetailPanel
            row={row({ tenant: 'fairfax', ffx_oid: 335393 })}
            lite
            state={{ status: 'loading' }}
            onClose={() => {}}
            onAbout={() => {}}
        />,
    )
    const cta = Array.from(lite.querySelectorAll('a')).find((a) => a.textContent?.includes('View inspections'))
    expect(cta?.getAttribute('href')).toBe(deepLink)
})

test('an unavailable detail reads as exactly that', async () => {
    const el = await render(
        <DetailPanel
            row={row()}
            lite={false}
            state={{ status: 'ready', detail: { available: false, reason: 'no data published yet' } }}
            onClose={() => {}}
            onAbout={() => {}}
        />,
    )
    expect(el.textContent).toContain('Failed to load: no data published yet')
})

test('the stack popover lists members name-sorted with ramp chips and picks by permit', async () => {
    const picks: string[] = []
    const members = [
        row({ permit_id: 'S-2', name: 'Zesty Tacos', o: { grade_score: 93 } }),
        row({ permit_id: 'S-1', name: 'Aroma Cafe', address2: 'Suite 210', o: { grade_score: null, new: 1 } }),
        row({ permit_id: 'S-3', name: 'Mid Diner', status: 'Business Closed', o: {} }),
    ]
    const el = await render(
        <StackPopover members={members} lite={false} onPick={(pid) => picks.push(pid)} />,
    )
    expect(el.textContent).toContain('3 places at this point')
    const names = Array.from(el.querySelectorAll('button')).map((b) => b.textContent)
    expect(names[0]).toContain('Aroma Cafe')      // name-sorted
    expect(names[0]).toContain('Suite 210')
    expect(names[0]).toContain('NEW')
    expect(names[1]).toContain('Mid Diner')
    expect(names[1]).toContain('closed')
    expect(names[2]).toContain('Zesty Tacos')
    expect(names[2]).toContain('A')
    await act(async () => {
        ;(el.querySelectorAll('button')[2] as HTMLButtonElement).click()
    })
    expect(picks).toEqual(['S-2'])
})
