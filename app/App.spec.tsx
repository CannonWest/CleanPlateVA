// @vitest-environment jsdom
// Shell wiring smoke (CRVb-M2): an undecided first load renders the §6.1
// BLOCKING acknowledgement dialog over the ghosted shell — zero data
// fetches (C2), the title alone, the two shipped decision labels
// Decline-left / Agree-right, and no dismiss affordance that reads as a
// third choice. The real referees are the contract + view suites; this
// pins that the shell stays assembled.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { App } from './App'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

test('an undecided first load blocks on the dialog and fetches nothing', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const fetches: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL) => {
        fetches.push(String(input))
        return Promise.reject(new Error('no network in the smoke test'))
    }) as typeof fetch
    try {
        window.localStorage.clear()
        window.history.replaceState(null, '', '/')
        const host = document.createElement('div')
        document.body.appendChild(host)
        await act(async () => {
            createRoot(host).render(<App />)
        })
        // The blocking dialog: title alone, the verbatim terms, both labels.
        const dialog = host.querySelector('[role="dialog"]')
        expect(dialog).toBeTruthy()
        expect(dialog?.textContent).toContain('Terms of Use and Data Acknowledgment')
        expect(dialog?.textContent).toContain('CleanPlateVA is an independent service')
        const buttons = Array.from(dialog?.querySelectorAll('button') ?? []).map((b) => b.textContent)
        // Decline left / Agree right — the shipped labels, in that order.
        expect(buttons).toEqual(['Decline and Use Basic Map', 'Agree and View Grades'])
        // Blocking: no close affordance that reads as a third choice.
        expect(dialog?.querySelector('button[aria-label="Close"]')).toBeNull()
        // The ghosted shell behind it — brand + search, inert; the full
        // band's controls are NOT rendered.
        expect(host.textContent).toContain('CleanPlateVA')
        expect(host.textContent).toContain('Search name, address, city, or ZIP')
        expect(host.querySelector('input[type="search"]')).toBeNull()
        expect(host.querySelector('button[role="switch"]')).toBeNull()
        // C2: an undecided first load fetches NOTHING.
        expect(fetches).toEqual([])
    } finally {
        globalThis.fetch = realFetch
    }
})
