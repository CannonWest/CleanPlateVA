/**
 * The contact message — its shape, its validation, and the one request that
 * sends it (a design decision, 2026-09-17; design ref §6.7).
 *
 * A visitor's message is not inspection data: it rides plain `fetch`, never
 * the data client, and the tier and the acknowledgement have nothing to do
 * with it (C2/C3 gate the ARCHIVE — a basic-map visitor may write just as a
 * Full one may). Nothing here reads or touches the roster.
 *
 * The caps and the address shape below are the CLIENT's copy of the Worker's
 * (`src/worker.js`, the contact route). Deliberately duplicated rather than
 * imported: the Worker is plain JS on the Cloudflare runtime and shares no
 * module graph with the app. `tests/vitest/contact.spec.ts` pins the two in
 * step and fails when one side drifts — the same discipline the marker
 * colors use against theme.css. The client's copy exists so a mistake is
 * caught in the form, where it can be corrected; the Worker's is the one
 * that decides, because a browser check is a courtesy and not a guard.
 */

/** RFC 5321's maximum path length — a longer address cannot be delivered. */
export const EMAIL_MAX = 254
export const SUBJECT_MAX = 150
export const MESSAGE_MAX = 5000

/**
 * A deliverable-looking address, not a conforming one: local part, one `@`,
 * a dotted domain, no whitespace and no control characters. Deliberately
 * permissive — RFC 5322 admits addresses no validator here should refuse,
 * and the only authority on whether an address exists is a delivery attempt.
 * Its job is to catch the typo (`name@gmail`, a pasted display name) before
 * a reply-to is built from it.
 */
export const EMAIL_RE = /^[^\s@,;<>"\\]+@[^\s@.,;<>"\\]+(?:\.[^\s@.,;<>"\\]+)+$/

/** Control characters. Refused in the address and the subject because those
 *  become mail HEADERS — a CR or LF there is a header-injection attempt, not
 *  a typo. The message body is a body and keeps its newlines. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/

export interface ContactDraft {
    email: string
    subject: string
    message: string
}

export type ContactField = keyof ContactDraft

/** Per-field complaints, in the visitor's words; absent = that field is
 *  fine. An empty object means the draft may be sent. */
export type ContactErrors = Partial<Record<ContactField, string>>

/**
 * What is wrong with this draft, if anything. All three fields are required:
 * a message with no address cannot be answered, and one with no subject or
 * body is not a message. Whitespace-only counts as empty.
 */
export function validateContact(draft: ContactDraft): ContactErrors {
    const errors: ContactErrors = {}
    const email = draft.email.trim()
    const subject = draft.subject.trim()
    const message = draft.message.trim()

    if (!email) errors.email = 'An email address is required, so a reply can reach you.'
    else if (email.length > EMAIL_MAX) errors.email = `An email address can be at most ${EMAIL_MAX} characters.`
    else if (CONTROL_RE.test(email) || !EMAIL_RE.test(email)) errors.email = 'That does not look like an email address.'

    if (!subject) errors.subject = 'A subject is required.'
    else if (subject.length > SUBJECT_MAX) errors.subject = `A subject can be at most ${SUBJECT_MAX} characters.`
    else if (CONTROL_RE.test(subject)) errors.subject = 'A subject cannot contain line breaks.'

    if (!message) errors.message = 'A message is required.'
    else if (message.length > MESSAGE_MAX) errors.message = `A message can be at most ${MESSAGE_MAX.toLocaleString('en-US')} characters.`

    return errors
}

/** The trimmed draft the Worker is sent — what validation measured. */
export function normalizeContact(draft: ContactDraft): ContactDraft {
    return {
        email: draft.email.trim(),
        subject: draft.subject.trim(),
        message: draft.message.trim(),
    }
}

/**
 * The endpoint, relative to the page's own mount (`document.baseURI` —
 * `router.ts` `mountFromBaseURI` reads the same thing for the same reason,
 * C7). '/' on the public site, so `/api/contact`: the one path besides the
 * full channel and the admin API that invokes the Worker at all.
 *
 * Under the host embed's `/cleanplate/` mount there is no Worker behind the
 * frame, so the request 404s into the SPA fallback and `sendContact` reports
 * a failure the dialog shows plainly. That is the honest outcome and not
 * worth special-casing: the embed is the maintainer's own dashboard, and the
 * alternative — posting cross-origin at the production host — would mean
 * CORS on a write route to save a button nobody there needs.
 */
export function contactEndpoint(baseURI: string = document.baseURI): string {
    let mount: string
    try {
        mount = new URL(baseURI).pathname || '/'
    } catch {
        mount = '/'
    }
    if (!mount.endsWith('/')) mount = mount.slice(0, mount.lastIndexOf('/') + 1)
    return `${mount}api/contact`
}

export interface ContactResult {
    ok: boolean
    /** Why not, in the visitor's words. Absent when `ok`. */
    reason?: string
}

/** What the dialog needs of a sender — narrower than `sendContact` itself,
 *  which also takes the endpoint and the fetcher for its own tests. The
 *  dialog passes the draft and the honeypot and nothing else, so that is
 *  what it asks for. */
export type ContactSender = (
    draft: ContactDraft,
    options: { trap: string },
) => Promise<ContactResult>

/** What the Worker answers, for the shapes the dialog distinguishes. */
interface ContactAnswer {
    ok?: unknown
    reason?: unknown
}

/**
 * Send the draft. Resolves — never rejects — so the dialog has one thing to
 * render either way.
 *
 * `trap` is the honeypot: a field no person can reach (hidden, and never
 * focusable), submitted empty. The Worker answers a filled one with the same
 * `ok` a real send gets and mails nothing, so a bot learns nothing from the
 * reply; this passes it along unread.
 */
export async function sendContact(
    draft: ContactDraft,
    { trap = '', endpoint = contactEndpoint(), fetcher = fetch }: {
        trap?: string
        endpoint?: string
        fetcher?: typeof fetch
    } = {},
): Promise<ContactResult> {
    let response: Response
    try {
        response = await fetcher(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...normalizeContact(draft), trap }),
        })
    } catch {
        // Offline, blocked, or the request never left.
        return { ok: false, reason: 'The message could not be sent. Check your connection and try again.' }
    }
    let answer: ContactAnswer | null = null
    try {
        answer = await response.json() as ContactAnswer
    } catch {
        // Not JSON: the SPA fallback under a mount with no Worker behind it,
        // or an edge error page. Either way the message did not arrive.
        answer = null
    }
    if (response.ok && answer?.ok === true) return { ok: true }
    if (response.status === 429) {
        return { ok: false, reason: 'Too many messages have been sent from here just now. Please try again in a minute.' }
    }
    const reason = typeof answer?.reason === 'string' && answer.reason ? answer.reason : null
    // A 4xx names the field that was refused and is worth quoting; a 5xx is
    // the site's own fault and its internals are not the visitor's problem.
    if (response.status >= 400 && response.status < 500 && reason) {
        return { ok: false, reason }
    }
    return { ok: false, reason: 'The message could not be sent. Please try again in a moment.' }
}
