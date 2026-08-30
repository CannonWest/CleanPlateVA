// @vitest-environment jsdom
// Shell wiring smoke (CRVa-M0): the real chrome renders under Vitest/jsdom
// and, with no stored acknowledgement, sits in the awaiting-ack state —
// C2's zero-fetch first load — behind the proof strip. The real referees
// are the ported contract suites and the M0 suites (router hook, map data,
// toolbar); this only pins that the shell stays assembled.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { App } from './App'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

test('the shell renders and awaits the acknowledgement without fetching', async () => {
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
        // The band: brand, the view switcher, search, counts.
        expect(host.textContent).toContain('CleanPlateVA')
        expect(host.textContent).toContain('Map')
        expect(host.textContent).toContain('List')
        expect(host.textContent).toContain('About')
        expect(host.querySelector('input[type="search"]')).toBeTruthy()
        // The C8 attribution footer.
        expect(host.textContent).toContain('archived snapshot, not live')
        // The theme SWITCH (bottom-left, Cannon's M0 review call) — dark
        // is the default document (C10).
        const themeSwitch = host.querySelector('button[role="switch"]')
        expect(themeSwitch).toBeTruthy()
        expect(themeSwitch?.getAttribute('aria-checked')).toBe('true')
        // The proof strip awaits the answer; nothing was fetched (C2).
        expect(host.textContent).toContain('Nothing is fetched until you answer')
        expect(fetches).toEqual([])
    } finally {
        globalThis.fetch = realFetch
    }
})
