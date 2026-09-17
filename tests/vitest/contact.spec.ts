/**
 * The contact message's shape (2026-09-17, design ref §6.7) — the client's
 * validation, the endpoint it posts to, and what `sendContact` makes of each
 * answer the Worker can give.
 *
 * The last test is the load-bearing one: the caps and the address shape exist
 * TWICE, in `app/contact.ts` and in `src/worker.js`, because the Worker is
 * plain JS on the Cloudflare runtime and shares no module graph with the app.
 * Duplication is only safe while something fails when the two drift, so this
 * reads both files and compares them. Same discipline as the marker colors
 * against theme.css — and the same reason: nothing warns otherwise.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import {
    EMAIL_MAX, EMAIL_RE, MESSAGE_MAX, SUBJECT_MAX,
    contactEndpoint, normalizeContact, sendContact, validateContact,
} from '../../app/contact'
import type { ContactDraft } from '../../app/contact'

const ROOT = resolve(import.meta.dirname, '..', '..')

const GOOD: ContactDraft = {
    email: 'visitor@example.test',
    subject: 'A closed place is still listed',
    message: 'The deli on Broad Street shut last month.',
}

test('a complete draft has nothing wrong with it', () => {
    assert.deepEqual(validateContact(GOOD), {})
})

test('all three fields are required, and whitespace is not an answer', () => {
    const empty = validateContact({ email: '', subject: '  ', message: '\n\t' })
    assert.deepEqual(Object.keys(empty).sort(), ['email', 'message', 'subject'])
    // Each complaint says what to do, in the visitor's words — never a code.
    assert.match(empty.email!, /required/)
    assert.match(empty.subject!, /required/)
    assert.match(empty.message!, /required/)
})

test('a typo in the address is caught before a reply-to is built from it', () => {
    for (const email of ['visitor', 'visitor@gmail', 'a@b', 'two@@at.test', 'sp ace@x.test']) {
        const errors = validateContact({ ...GOOD, email })
        assert.ok(errors.email, email)
        assert.match(errors.email!, /does not look like an email address/)
    }
})

test('the address check stays permissive: plus-tags, apostrophes, subdomains, non-ASCII', () => {
    for (const email of [
        'a.b+tag@sub.example.co.uk',
        "o'hara@example.test",
        'ünï@exämple.test',
        'x@y.zz',
    ]) {
        assert.equal(EMAIL_RE.test(email), true, email)
        assert.deepEqual(validateContact({ ...GOOD, email }), {}, email)
    }
})

test('a line break INSIDE the address or the subject is refused — both become headers', () => {
    assert.match(validateContact({ ...GOOD, subject: 'hi\r\nBcc: x@y.test' }).subject!, /line breaks/)
    assert.ok(validateContact({ ...GOOD, email: 'a@b.test\r\nBcc: x@y.test' }).email)
    // A TRAILING one is a paste artifact and is trimmed away, not refused —
    // an address copied out of a mail client often carries one.
    assert.deepEqual(validateContact({ ...GOOD, email: 'a@b.test\r\n' }), {})
    assert.deepEqual(validateContact({ ...GOOD, subject: 'hello\n' }), {})
    // The body is a body: newlines are the visitor's paragraphs.
    assert.deepEqual(validateContact({ ...GOOD, message: 'one\n\ntwo' }), {})
})

test('the caps are measured on the trimmed value', () => {
    assert.deepEqual(validateContact({ ...GOOD, subject: `  ${'x'.repeat(SUBJECT_MAX)}  ` }), {})
    assert.match(validateContact({ ...GOOD, subject: 'x'.repeat(SUBJECT_MAX + 1) }).subject!, /at most/)
    assert.match(validateContact({ ...GOOD, message: 'x'.repeat(MESSAGE_MAX + 1) }).message!, /at most/)
    assert.match(
        validateContact({ ...GOOD, email: `${'a'.repeat(EMAIL_MAX)}@example.test` }).email!,
        /at most/,
    )
})

test('normalize trims exactly the three fields validation measured', () => {
    assert.deepEqual(
        normalizeContact({ email: ' a@b.test ', subject: ' s ', message: ' m ' }),
        { email: 'a@b.test', subject: 's', message: 'm' },
    )
})

test('the endpoint rides the page mount (C7), so the host embed does not post to the site root', () => {
    assert.equal(contactEndpoint('https://cleanplateva.com/'), '/api/contact')
    assert.equal(contactEndpoint('https://cleanplateva.com/about'), '/api/contact')
    assert.equal(contactEndpoint('https://host.test/cleanplate/'), '/cleanplate/api/contact')
    assert.equal(contactEndpoint('not a url'), '/api/contact')
})

/** A fetcher that answers once with `status` and `body`, recording the call. */
function answering(status: number, body: string | null) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher = (async (url: unknown, init: unknown) => {
        calls.push({ url: String(url), init: init as RequestInit })
        return new Response(body, {
            status,
            headers: body === null ? {} : { 'Content-Type': 'application/json' },
        })
    }) as unknown as typeof fetch
    return { calls, fetcher }
}

test('a send posts the normalized draft plus the honeypot, as JSON', async () => {
    const { calls, fetcher } = answering(200, '{"ok":true}')
    const result = await sendContact(
        { email: ' visitor@example.test ', subject: ' s ', message: ' m ' },
        { trap: '', endpoint: '/api/contact', fetcher },
    )
    assert.deepEqual(result, { ok: true })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, '/api/contact')
    assert.equal(calls[0]!.init.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
        email: 'visitor@example.test', subject: 's', message: 'm', trap: '',
    })
})

test('a honeypot value is passed along unread — the Worker decides what it means', async () => {
    const { calls, fetcher } = answering(200, '{"ok":true}')
    await sendContact(GOOD, { trap: 'http://spam.example', endpoint: '/api/contact', fetcher })
    assert.equal(JSON.parse(String(calls[0]!.init.body)).trap, 'http://spam.example')
})

test('a 429 says so in the visitor\'s words, not the Worker\'s', async () => {
    const { fetcher } = answering(429, '{"ok":false,"reason":"too many messages from this address just now"}')
    const result = await sendContact(GOOD, { endpoint: '/api/contact', fetcher })
    assert.equal(result.ok, false)
    assert.match(result.reason!, /try again in a minute/)
})

test('a 4xx quotes the Worker (it names the field); a 5xx never does', async () => {
    const refused = answering(400, '{"ok":false,"reason":"subject: is required"}')
    assert.deepEqual(await sendContact(GOOD, { endpoint: '/api/contact', fetcher: refused.fetcher }), {
        ok: false, reason: 'subject: is required',
    })

    const broken = answering(502, '{"ok":false,"reason":"the message could not be sent"}')
    const result = await sendContact(GOOD, { endpoint: '/api/contact', fetcher: broken.fetcher })
    assert.equal(result.ok, false)
    assert.match(result.reason!, /Please try again in a moment/)
})

test('a non-JSON 200 is a failure, not a success — the SPA fallback under a Worker-less mount', async () => {
    const { fetcher } = answering(200, null)
    const result = await sendContact(GOOD, { endpoint: '/cleanplate/api/contact', fetcher })
    assert.equal(result.ok, false, 'HTML on the contact path means the message did not arrive')
})

test('a 200 that does not say ok is not a success either', async () => {
    const { fetcher } = answering(200, '{"ok":"yes"}')
    assert.equal((await sendContact(GOOD, { endpoint: '/api/contact', fetcher })).ok, false)
})

test('a fetch that never left resolves as a failure — sendContact never rejects', async () => {
    const fetcher = (async () => {
        throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const result = await sendContact(GOOD, { endpoint: '/api/contact', fetcher })
    assert.equal(result.ok, false)
    assert.match(result.reason!, /Check your connection/)
})

test('the client and the Worker agree on every cap and on the address shape', () => {
    // Read as TEXT on purpose: importing the Worker would only prove that
    // src/worker.js parses, and these values are deliberately duplicated
    // there (no shared module graph). A drift on either side fails here.
    const worker = readFileSync(join(ROOT, 'src', 'worker.js'), 'utf8')

    const number = (name: string): number => {
        const match = worker.match(new RegExp(`const ${name} = ([0-9]+);`))
        assert.ok(match, `${name} must be a literal in src/worker.js`)
        return Number(match[1])
    }
    expect(number('CONTACT_EMAIL_MAX')).toBe(EMAIL_MAX)
    expect(number('CONTACT_SUBJECT_MAX')).toBe(SUBJECT_MAX)
    expect(number('CONTACT_MESSAGE_MAX')).toBe(MESSAGE_MAX)

    const pattern = worker.match(/const CONTACT_EMAIL_RE = (\/.*\/);/)
    assert.ok(pattern, 'CONTACT_EMAIL_RE must be a literal in src/worker.js')
    expect(pattern[1]).toBe(String(EMAIL_RE))

    // The Worker's body cap must leave room for the three fields at their
    // maxima plus the JSON around them, or a legal message is refused 413
    // before its own validation can say anything useful about it.
    const bodyCap = worker.match(/const MAX_CONTACT_BYTES = ([0-9]+) \* 1024;/)
    assert.ok(bodyCap, 'MAX_CONTACT_BYTES must be a literal in src/worker.js')
    expect(Number(bodyCap[1]) * 1024).toBeGreaterThan(EMAIL_MAX + SUBJECT_MAX + MESSAGE_MAX + 200)
})

test('wrangler.jsonc pins the one recipient, and the Worker names none', () => {
    const wrangler = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
    const worker = readFileSync(join(ROOT, 'src', 'worker.js'), 'utf8')

    // The destination pin is the boundary: Email Service refuses anything but
    // the pinned address, so the worst a wrong CONTACT_TO can do is fail.
    // That only holds while the two AGREE — hence this.
    assert.match(wrangler, /"name":\s*"CONTACT_EMAIL"/)
    const pinned = wrangler.match(/"destination_address":\s*"([^"]+)"/)
    assert.ok(pinned, 'the send binding must pin one destination_address')
    const configured = wrangler.match(/"CONTACT_TO":\s*"([^"]+)"/)
    assert.ok(configured, 'CONTACT_TO must be a var')
    expect(configured[1]).toBe(pinned[1])

    // The recipient reaches `send` as the bound `to` — never a literal, and
    // never anything read off the request.
    const send = worker.match(/mailer\.send\(\{[\s\S]*?\}\);/)
    assert.ok(send, 'the contact route must call mailer.send')
    assert.match(send[0], /^\s*to,$/m, 'the recipient is the CONTACT_TO binding, not a literal')
    assert.doesNotMatch(send[0], /to:\s*['"]/, 'no hard-coded address in the send call')
    assert.doesNotMatch(send[0], /body\.|draft\./, 'nothing in the send call is read off the request')

    // The sender must be configuration, not a literal: it has to track
    // whatever domain is onboarded to Email Service.
    assert.match(wrangler, /"CONTACT_FROM":\s*"[^"@]+@[^"]+"/)
    assert.match(send[0], /from,/)

    // The rate limiter's period may only be 10 or 60 (the binding's rule).
    const period = wrangler.match(/"simple":\s*\{\s*"limit":\s*([0-9]+),\s*"period":\s*([0-9]+)\s*\}/)
    assert.ok(period, 'the contact rate limit must declare limit + period')
    assert.ok([10, 60].includes(Number(period[2])), `period ${period[2]} must be 10 or 60`)
    assert.ok(Number(period[1]) > 0)
})
