// @vitest-environment jsdom
/**
 * The contact dialog (2026-09-17, design ref §6.7): three required fields,
 * Cancel and Send, and the three states the one dialog moves through.
 *
 * The claims worth a test are the ones a click-through would not reliably
 * catch: that a refused Send asks about every field at once rather than the
 * first, that Send cannot post twice, that a FAILED send keeps the visitor's
 * words (the defect this guards is losing a long message to a bad minute on
 * the network), and that the honeypot is out of reach of everything a person
 * or a screen reader can do.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ContactDialog } from '../../app/ContactDialog'
import type { ContactDraft, ContactResult, ContactSender } from '../../app/contact'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

let host: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    host?.remove()
    host = null
})

/** Radix portals the content to document.body, so queries go there. */
async function open(send: ContactSender) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root!.render(<ContactDialog open onOpenChange={() => {}} send={send} />)
    })
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    return dialog
}

/** The one control whose text is `label`. */
function button(scope: ParentNode, label: string): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll('button'))
        .filter((b) => b.textContent?.trim() === label)
    expect(found.length, `exactly one ${JSON.stringify(label)} button`).toBe(1)
    return found[0] as HTMLButtonElement
}

function field(scope: ParentNode, name: string): HTMLInputElement | HTMLTextAreaElement {
    const el = scope.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement
    expect(el, `a [name="${name}"] control`).toBeTruthy()
    return el
}

/** Type into a React-controlled field the way the browser does. */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
        const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

async function click(el: HTMLElement) {
    await act(async () => {
        el.click()
    })
}

/** Leave a field. React delegates `onBlur` off `focusout` (the bubbling
 *  one), so dispatching a bare `blur` reaches nothing. */
async function leave(el: HTMLElement) {
    await act(async () => {
        el.focus()
        el.blur()
        el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
}

const GOOD: ContactDraft = {
    email: 'visitor@example.test',
    subject: 'A closed place is still listed',
    message: 'The deli on Broad Street shut last month.',
}

async function fill(dialog: HTMLElement, draft: ContactDraft = GOOD) {
    await type(field(dialog, 'email'), draft.email)
    await type(field(dialog, 'subject'), draft.subject)
    await type(field(dialog, 'message'), draft.message)
}

/** A sender that always succeeds, typed so its recorded calls read back. */
const accepts = () => vi.fn<ContactSender>(async () => ({ ok: true }))

test('the form offers exactly the three fields, Cancel and Send', async () => {
    const dialog = await open(accepts())
    expect(dialog.textContent).toContain('Send a message')
    for (const name of ['email', 'subject', 'message']) field(dialog, name)
    expect(field(dialog, 'email').getAttribute('type')).toBe('email')
    expect(field(dialog, 'message').tagName).toBe('TEXTAREA')
    // Required in the DOM too, for anything reading semantics rather than
    // pressing Send — though contact.ts is what decides (noValidate).
    for (const name of ['email', 'subject', 'message']) {
        expect(field(dialog, name).required, name).toBe(true)
    }
    button(dialog, 'Cancel')
    button(dialog, 'Send')
    expect(dialog.querySelector('form')?.noValidate).toBe(true)
})

test('nothing complains before the visitor has had a chance to type', async () => {
    const dialog = await open(accepts())
    expect(dialog.querySelectorAll('[aria-invalid="true"]').length).toBe(0)
    // The lede says every field IS required; no field says it yet. (Matched
    // on the complaint's own sentence, not the substring the lede shares.)
    expect(dialog.textContent).toContain('Every field is required')
    expect(dialog.textContent).not.toContain('A subject is required.')
    expect(dialog.textContent).not.toContain('A message is required.')
})

test('a refused Send asks about EVERY field at once, and posts nothing', async () => {
    const send = accepts()
    const dialog = await open(send)
    await click(button(dialog, 'Send'))

    expect(send).not.toHaveBeenCalled()
    expect(dialog.querySelectorAll('[aria-invalid="true"]').length).toBe(3)
    for (const name of ['email', 'subject', 'message']) {
        const el = field(dialog, name)
        const describedBy = el.getAttribute('aria-describedby')
        expect(describedBy, name).toMatch(/-error$/)
        // The complaint is REACHABLE from the field, not merely nearby.
        expect(document.getElementById(describedBy!)?.textContent, name).toBeTruthy()
    }
})

test('a bad address complains on blur, on that field alone', async () => {
    const dialog = await open(accepts())
    const email = field(dialog, 'email')
    await type(email, 'visitor@gmail')
    await leave(email)
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(dialog.textContent).toContain('does not look like an email address')
    expect(field(dialog, 'subject').getAttribute('aria-invalid')).toBeNull()
})

test('a complete draft posts once and the dialog says it went', async () => {
    const send = accepts()
    const dialog = await open(send)
    await fill(dialog)
    await click(button(dialog, 'Send'))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toEqual(GOOD)
    expect(send.mock.calls[0]![1]).toEqual({ trap: '' })
    // The sent state replaces the form, so there is nothing left to press
    // twice — and one Close.
    expect(dialog.textContent).toContain('Message sent')
    expect(dialog.querySelector('form')).toBeNull()
    expect(dialog.querySelector('[name="email"]')).toBeNull()
    button(dialog, 'Close')
})

test('Send cannot post twice: both actions go inert while it is in flight', async () => {
    let release: (result: ContactResult) => void = () => {}
    const send = vi.fn<ContactSender>(() => new Promise<ContactResult>((resolve) => { release = resolve }))
    const dialog = await open(send)
    await fill(dialog)

    await click(button(dialog, 'Send'))
    expect(send).toHaveBeenCalledTimes(1)
    const sending = button(dialog, 'Sending…')
    expect(sending.disabled).toBe(true)
    expect(button(dialog, 'Cancel').disabled).toBe(true)
    // Every field is inert too, so the draft cannot change mid-flight.
    for (const name of ['email', 'subject', 'message']) {
        expect(field(dialog, name).disabled, name).toBe(true)
    }

    await click(sending)
    expect(send).toHaveBeenCalledTimes(1)

    await act(async () => {
        release({ ok: true })
    })
    expect(dialog.textContent).toContain('Message sent')
})

test("a failed send KEEPS the visitor's words and says why, in an alert", async () => {
    const send = vi.fn<ContactSender>(async () => ({
        ok: false,
        reason: 'The message could not be sent. Check your connection and try again.',
    }))
    const dialog = await open(send)
    await fill(dialog)
    await click(button(dialog, 'Send'))

    const alert = dialog.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Check your connection')
    // The form is back, with everything still in it — the whole point.
    expect(field(dialog, 'email').value).toBe(GOOD.email)
    expect(field(dialog, 'subject').value).toBe(GOOD.subject)
    expect(field(dialog, 'message').value).toBe(GOOD.message)
    // And Send works again, rather than staying stuck at "Sending…".
    expect(button(dialog, 'Send').disabled).toBe(false)
})

test('editing after a failure clears the alert — it described the last attempt', async () => {
    const send = vi.fn<ContactSender>(async () => ({ ok: false, reason: 'nope' }))
    const dialog = await open(send)
    await fill(dialog)
    await click(button(dialog, 'Send'))
    expect(dialog.querySelector('[role="alert"]')).toBeTruthy()

    await type(field(dialog, 'message'), `${GOOD.message} Also the sign is gone.`)
    expect(dialog.querySelector('[role="alert"]')).toBeNull()
})

test('the honeypot is out of reach of a person, a keyboard and a screen reader', async () => {
    const dialog = await open(accepts())
    const trap = dialog.querySelector('[name="website"]') as HTMLInputElement
    expect(trap, 'the honeypot exists for something that fills every input').toBeTruthy()
    expect(trap.tabIndex).toBe(-1)
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy()
    // And it is not one of the three fields a person is asked for.
    expect(trap.name).not.toBe('email')
})

test('a filled honeypot still rides along — the Worker decides, not the form', async () => {
    const send = accepts()
    const dialog = await open(send)
    await fill(dialog)
    await type(dialog.querySelector('[name="website"]') as HTMLInputElement, 'http://spam.example')
    await click(button(dialog, 'Send'))
    expect(send.mock.calls[0]![1]).toEqual({ trap: 'http://spam.example' })
})

test('the message counter tracks the trimmed length against the cap', async () => {
    const dialog = await open(accepts())
    expect(dialog.textContent).toContain('0 of 5,000 characters')
    await type(field(dialog, 'message'), '  four  ')
    expect(dialog.textContent).toContain('4 of 5,000 characters')
})
