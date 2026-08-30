// @vitest-environment jsdom
// CRF wiring smoke: the proof boot renders under Vitest/jsdom and, with no
// stored acknowledgement, sits in the awaiting-ack state — C2's zero-fetch
// first load — showing the proof controls. The real referees are the ported
// contract suites; this only pins that the scaffold stays assembled.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { App } from './App'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

test('the proof boot renders and awaits the acknowledgement without fetching', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const fetches: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL) => {
        fetches.push(String(input))
        return Promise.reject(new Error('no network in the smoke test'))
    }) as typeof fetch
    try {
        window.localStorage.clear()
        const host = document.createElement('div')
        document.body.appendChild(host)
        await act(async () => {
            createRoot(host).render(<App />)
        })
        expect(host.textContent).toContain('CRF-M1 proof boot')
        expect(host.textContent).toContain('Awaiting the acknowledgement')
        expect(host.textContent).toContain('Agree (proof)')
        expect(host.textContent).toContain('Decline (proof)')
        // C2: an undecided first load fetches NOTHING.
        expect(fetches).toEqual([])
    } finally {
        globalThis.fetch = realFetch
    }
})
