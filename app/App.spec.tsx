// @vitest-environment jsdom
// CRF-M0 wiring smoke: React renders under Vitest/jsdom. The real referees
// of this program are the ported contract tripwires (design ref §7, CRF-M1);
// this spec only pins that the scaffold's runner + JSX + DOM environment
// stay assembled.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { App } from './App'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

test('the scaffold boots and renders the proof shell', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => {
        createRoot(host).render(<App />)
    })
    expect(host.textContent).toContain('CleanPlateVA')
    expect(host.textContent).toContain('CRF scaffold proof')
    // The grade ramp proof rides its letters (§6.0: the letter always rides
    // the color) — A through F present as text, not color alone.
    for (const letter of ['A', 'B', 'C', 'D', 'F']) {
        expect(host.textContent).toContain(letter)
    }
})
