// @vitest-environment jsdom
/**
 * The §6.1 acknowledgement dialog (CRVb-M2): the title alone; the terms
 * as ONE verbatim document — the SAME TermsBody component About §06
 * mounts, so the page and the dialog cannot drift (C2); Decline left
 * (filled red) / Agree right (filled blue) with the shipped labels;
 * blocking = no ✕, backdrop ignored, Escape declines unpersisted;
 * re-opened = ✕/backdrop/Escape just close.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { AckDialog } from '../../app/AckDialog'
import { TermsBody } from '../../app/TermsBody'
import { ACK_AGREED, ACK_DECLINED } from '../../app/ack'

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

interface Calls {
    decided: string[]
    escaped: number
    closed: number
}

async function render(blocking: boolean): Promise<[HTMLDivElement, Calls]> {
    const calls: Calls = { decided: [], escaped: 0, closed: 0 }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <AckDialog
                blocking={blocking}
                onDecide={(v) => calls.decided.push(v)}
                onEscapeDecline={() => { calls.escaped += 1 }}
                onClose={() => { calls.closed += 1 }}
            />,
        )
    })
    return [host, calls]
}

test('the dialog is the title alone over the single-source terms, Decline left / Agree right', async () => {
    const [el] = await render(true)
    const dialog = el.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    // Branded header logo above the title — scoped to the header, because
    // the scroll box now ends with the PeerPush badge (2026-09-09).
    const header = dialog?.querySelector('h1')?.previousElementSibling
    const logoImgs = header?.querySelectorAll('img')
    expect(logoImgs?.length).toBe(2)
    expect(logoImgs?.[0]?.className).toContain('light:hidden')
    expect(logoImgs?.[1]?.className).toContain('light:block')

    // Title alone — no kicker, no lede.
    expect(dialog?.querySelector('h1')?.textContent).toBe('Terms of Use and Data Acknowledgment')
    expect(dialog?.textContent).not.toContain('Methodology & provenance')
    // The terms are the SAME component About mounts — pin by identical text.
    const reference = document.createElement('div')
    document.body.appendChild(reference)
    const refRoot = createRoot(reference)
    await act(async () => {
        refRoot.render(<TermsBody />)
    })
    const termsInDialog = dialog?.textContent ?? ''
    expect(reference.textContent && termsInDialog.includes(reference.textContent)).toBe(true)
    await act(async () => {
        refRoot.unmount()
    })
    reference.remove()
    // The fork: Decline left (danger fill), Agree right (accent fill).
    const actionButtons = Array.from(dialog?.querySelectorAll('button') ?? [])
    expect(actionButtons.map((b) => b.textContent))
        .toEqual(['Decline and Use Basic Map', 'Agree and View Grades'])
    expect(actionButtons[0]?.className).toContain('bg-cp-danger-solid')
    expect(actionButtons[1]?.className).toContain('bg-cp-accent-solid')
})

test('the project badges close the scroll box, after the terms', async () => {
    const [el] = await render(true)
    const dialog = el.querySelector('[role="dialog"]')
    // The scroll box is the element that actually scrolls; the badges must
    // be INSIDE it (Cannon's ask) — not in the dialog's chrome, where they
    // would stand above the buttons and never scroll away.
    const scroller = dialog?.querySelector('[class*="overflow-y:scroll"]') as HTMLElement
    expect(scroller).toBeTruthy()
    const gh = scroller.querySelector('a[href="https://github.com/CannonWest/CleanPlateVA"]')
    const pp = scroller.querySelector('a[href="https://peerpush.com/p/cleanplateva"]')
    expect(gh).toBeTruthy()
    expect(pp).toBeTruthy()
    expect(pp?.querySelector('img')?.getAttribute('src'))
        .toBe('https://peerpush.com/p/cleanplateva/badge.png')
    // At the very END — after the Acknowledgment section, the terms' last words.
    const badgeRow = gh?.parentElement as HTMLElement
    expect(badgeRow).toBe(scroller.lastElementChild)
    const terms = scroller.firstElementChild as HTMLElement
    expect(terms.textContent).toContain('can be changed later from the About page')
    expect(badgeRow.compareDocumentPosition(terms) & Node.DOCUMENT_POSITION_PRECEDING)
        .toBeTruthy()
    // New windows, and never a referrer-bearing opener back into the dialog.
    expect(gh?.getAttribute('target')).toBe('_blank')
    expect(pp?.getAttribute('target')).toBe('_blank')
    expect(gh?.getAttribute('rel')).toContain('noopener')
    expect(pp?.getAttribute('rel')).toContain('noopener')
})

test('blocking: no close affordance, backdrop ignored, Escape = unpersisted decline', async () => {
    const [el, calls] = await render(true)
    expect(el.querySelector('button[aria-label="Close"]')).toBeNull()
    await act(async () => {
        ;(el.querySelector('[role="dialog"]')?.parentElement as HTMLElement).click()
    })
    expect(calls.closed).toBe(0)
    await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(calls.escaped).toBe(1)
    expect(calls.decided).toEqual([])
})

test('re-opened: ✕, backdrop, and Escape just close — deciding still works', async () => {
    const [el, calls] = await render(false)
    const close = el.querySelector('button[aria-label="Close"]') as HTMLButtonElement
    expect(close).toBeTruthy()
    await act(async () => {
        close.click()
    })
    await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(calls.closed).toBe(2)
    expect(calls.escaped).toBe(0)
    const agree = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Agree and View Grades')
    await act(async () => {
        agree?.click()
    })
    expect(calls.decided).toEqual([ACK_AGREED])
    const decline = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Decline and Use Basic Map')
    await act(async () => {
        decline?.click()
    })
    expect(calls.decided).toEqual([ACK_AGREED, ACK_DECLINED])
})
