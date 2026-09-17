// The contact route (2026-09-17, design ref frontend-redesign.md §6.7):
// `POST /api/contact` validates a visitor's message, throttles it per
// address, and hands it to the Cloudflare Email Service send binding.
//
// Driven with a fake mailer and a fake limiter, so every branch is
// exercised against the real `worker.fetch` — including the two that matter
// most and that no manual click would ever produce: that the Worker names no
// recipient (the binding's `destination_address` is the only one there is),
// and that a honeypot submission is answered like a success while mailing
// nothing.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'vitest'
import worker from '../../src/worker.js'

interface Sent {
    from?: string
    to?: unknown
    replyTo?: string
    subject?: string
    text?: string
}

let sent: Sent[]
let sendError: Error | null
let limitCalls: Array<{ key: string }>
let limitSuccess: boolean
let limitError: Error | null

type Env = Record<string, unknown>

function env(overrides: Env = {}): Env {
    return {
        ASSETS: { fetch: async () => new Response('asset') },
        CONTACT_FROM: 'contact@cleanplateva.test',
        CONTACT_EMAIL: {
            send: async (message: Sent) => {
                if (sendError) throw sendError
                sent.push(message)
                return { messageId: 'mid-1' }
            },
        },
        CONTACT_LIMIT: {
            limit: async (args: { key: string }) => {
                limitCalls.push(args)
                if (limitError) throw limitError
                return { success: limitSuccess }
            },
        },
        ...overrides,
    }
}

const DRAFT = {
    email: 'visitor@example.test',
    subject: 'A closed place is still listed',
    message: 'The deli on Broad Street shut last month.',
    trap: '',
}

function post(body: unknown, {
    headers = { 'Content-Type': 'application/json' },
    method = 'POST',
    overrides = {} as Env,
    raw = null as string | null,
} = {}) {
    return worker.fetch(
        new Request('https://cleanplateva.test/api/contact', {
            method,
            headers,
            body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
        }),
        env(overrides),
        {},
    )
}

beforeEach(() => {
    sent = []
    sendError = null
    limitCalls = []
    limitSuccess = true
    limitError = null
})

test('a valid message is sent: the visitor rides as replyTo, and the Worker names NO recipient', async () => {
    const response = await post(DRAFT)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
    assert.deepEqual(await response.json(), { ok: true })

    assert.equal(sent.length, 1)
    const message = sent[0]!
    // The binding's destination_address is the recipient. If this Worker
    // ever names one, the pin in wrangler.jsonc stops being a guarantee.
    assert.equal('to' in message, false, 'the Worker must not name a recipient')
    assert.equal(message.from, 'contact@cleanplateva.test', 'the sender is the onboarded domain, never the visitor')
    assert.equal(message.replyTo, DRAFT.email, 'Reply goes to the visitor')
    assert.equal(message.subject, '[CleanPlateVA] A closed place is still listed')
    assert.ok(message.text?.startsWith(DRAFT.message), "the visitor's words come first")
    assert.match(message.text!, /^From: visitor@example\.test$/m, 'the address is repeated below the rule')
    assert.match(message.text!, /^Origin: /m)
})

test('the fields are trimmed, and what validation measured is what is sent', async () => {
    await post({
        email: '  visitor@example.test \n',
        subject: '  spacing  ',
        message: '   hello   ',
    })
    const message = sent[0]!
    assert.equal(message.replyTo, 'visitor@example.test')
    assert.equal(message.subject, '[CleanPlateVA] spacing')
    assert.ok(message.text?.startsWith('hello\n'))
})

test('the honeypot is answered like a success and mails nothing', async () => {
    const response = await post({ ...DRAFT, trap: 'http://spam.example' })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true },
        'a bot that can tell refusal from acceptance learns what to change')
    assert.deepEqual(sent, [], 'nothing left the Worker')
})

test('an empty honeypot is what a person submits, and passes', async () => {
    await post({ ...DRAFT, trap: '   ' })
    assert.equal(sent.length, 1)
})

test('every field is required, and each refusal names itself', async () => {
    for (const [field, body] of [
        ['email', { ...DRAFT, email: '   ' }],
        ['subject', { ...DRAFT, subject: '' }],
        ['message', { ...DRAFT, message: '\n\n' }],
    ] as const) {
        const response = await post(body)
        assert.equal(response.status, 400, field)
        const answer = await response.json() as { ok: boolean; reason: string }
        assert.equal(answer.ok, false)
        assert.equal(answer.reason, `${field}: is required`)
    }
    assert.deepEqual(sent, [])
})

test('a non-string field is refused, not coerced', async () => {
    const response = await post({ ...DRAFT, subject: 42 })
    assert.equal(response.status, 400)
    assert.equal((await response.json() as { reason: string }).reason, 'subject: must be a string')
})

test('an address that could not be replied to is refused', async () => {
    for (const email of ['visitor', 'visitor@localhost', 'a@b', 'two@@at.test', 'sp ace@x.test', '<v@x.test>']) {
        const response = await post({ ...DRAFT, email })
        assert.equal(response.status, 400, email)
        assert.equal(
            (await response.json() as { reason: string }).reason,
            'email: does not look like an email address',
            email,
        )
    }
    assert.deepEqual(sent, [])
})

test('addresses a permissive check should still admit', async () => {
    // The apostrophe is an ORDINARY character in a local part (and a common
    // one in real surnames) — the first cut of the char class excluded it and
    // would have turned away o'hara@example.test. What stays excluded is
    // whitespace, a second @, the address-list punctuation and the
    // quoted-string machinery.
    for (const email of ['a.b+tag@sub.example.co.uk', "o'hara@example.test", 'ünï@exämple.test']) {
        sent = []
        const response = await post({ ...DRAFT, email })
        assert.equal(response.status, 200, email)
        assert.equal(sent[0]!.replyTo, email)
    }
})

test('a CR or LF in the subject is header injection, not a typo — refused', async () => {
    const response = await post({ ...DRAFT, subject: 'hi\r\nBcc: victim@example.test' })
    assert.equal(response.status, 400)
    assert.equal(
        (await response.json() as { reason: string }).reason,
        'subject: cannot contain control characters',
    )
    assert.deepEqual(sent, [])
})

test('the message body KEEPS its newlines — it is a body, not a header', async () => {
    await post({ ...DRAFT, message: 'line one\nline two\n\nline four' })
    assert.ok(sent[0]!.text?.startsWith('line one\nline two\n\nline four'))
})

test('the caps are enforced on the trimmed value, by name', async () => {
    for (const [field, max] of [['email', 254], ['subject', 150], ['message', 5000]] as const) {
        const filler = field === 'email' ? `${'a'.repeat(max - 12)}@example.test` : 'x'.repeat(max + 1)
        const response = await post({ ...DRAFT, [field]: filler })
        assert.equal(response.status, 400, field)
        assert.equal(
            (await response.json() as { reason: string }).reason,
            `${field}: at most ${max} characters`,
            field,
        )
    }
})

test('a body over 16 KB is refused before it is parsed', async () => {
    const response = await post(null, { raw: JSON.stringify({ ...DRAFT, message: 'x'.repeat(17_000) }) })
    assert.equal(response.status, 413)
    assert.match((await response.json() as { reason: string }).reason, /exceeds 16384 bytes/)
    assert.deepEqual(sent, [])
})

test('the method, the content type and the JSON itself are each refused on their own', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
        const response = await post(null, { method })
        assert.equal(response.status, 405, method)
        assert.equal(response.headers.get('Cache-Control'), 'no-store')
        // A HEAD carries no body, and an answer to one must not either.
        if (method === 'HEAD') assert.equal(await response.text(), '')
    }
    const wrongType = await post(DRAFT, { headers: { 'Content-Type': 'text/plain' } })
    assert.equal(wrongType.status, 415)

    const notJson = await post(null, { raw: 'not json at all' })
    assert.equal(notJson.status, 400)
    assert.equal((await notJson.json() as { reason: string }).reason, '$: not JSON')

    const notObject = await post('"a string"', { raw: '"a string"' })
    assert.equal(notObject.status, 400)
    assert.equal((await notObject.json() as { reason: string }).reason, '$: must be an object')
})

test('the rate limit is keyed on the connecting address and refuses with 429', async () => {
    const response = await worker.fetch(
        new Request('https://cleanplateva.test/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
            body: JSON.stringify(DRAFT),
        }),
        env(),
        {},
    )
    assert.equal(response.status, 200)
    assert.deepEqual(limitCalls, [{ key: 'contact:203.0.113.7' }],
        "one sender's burst must not spend another's allowance")

    sent = []
    limitSuccess = false
    const refused = await post(DRAFT)
    assert.equal(refused.status, 429)
    assert.equal(refused.headers.get('Cache-Control'), 'no-store')
    assert.match((await refused.json() as { reason: string }).reason, /too many messages/)
    assert.deepEqual(sent, [], 'a flood never reaches Email Service')
})

test('a limiter that throws is a closed door, not an open one', async () => {
    limitError = new Error('limiter down')
    const response = await post(DRAFT)
    assert.equal(response.status, 502)
    assert.deepEqual(sent, [])
})

test('the allowance is spent AFTER the cheap refusals, so a 415 costs nothing', async () => {
    await post(DRAFT, { headers: { 'Content-Type': 'text/plain' } })
    assert.deepEqual(limitCalls, [], 'the wrong content type never reached the limiter')
})

test('a refused send is a 502 whose reason keeps Email Service internals out of the browser', async () => {
    sendError = Object.assign(new Error('unverified sender'), { code: 'E_SENDER_NOT_VERIFIED' })
    const response = await post(DRAFT)
    assert.equal(response.status, 502)
    const answer = await response.json() as { ok: boolean; reason: string }
    assert.equal(answer.ok, false)
    assert.equal(answer.reason, 'the message could not be sent')
    assert.doesNotMatch(answer.reason, /E_SENDER_NOT_VERIFIED|unverified/)
})

test('a missing binding is LOUD — a 500 naming which one, before the body is read', async () => {
    for (const [overrides, reason] of [
        [{ CONTACT_EMAIL: undefined }, 'contact mailer not configured'],
        [{ CONTACT_EMAIL: {} }, 'contact mailer not configured'],
        [{ CONTACT_FROM: undefined }, 'contact sender not configured'],
        [{ CONTACT_FROM: 'not-an-address' }, 'contact sender not configured'],
        [{ CONTACT_LIMIT: undefined }, 'contact rate limit not configured'],
    ] as const) {
        const response = await post(DRAFT, { overrides: overrides as Env })
        assert.equal(response.status, 500, reason)
        assert.equal((await response.json() as { reason: string }).reason, reason)
    }
    assert.deepEqual(sent, [])
})

test('the contact path is exact: a neighbour under /api falls through to the assets layer', async () => {
    // wrangler.jsonc lists the exact path, so in production nothing else
    // under /api reaches the Worker at all. If a widened list ever sends one
    // here, it must be served, not 404ed or mistaken for a message.
    for (const path of ['/api/contact/', '/api/contacts', '/api/contact/extra', '/api']) {
        const response = await worker.fetch(
            new Request(`https://cleanplateva.test${path}`, { method: 'POST' }),
            env(),
            {},
        )
        assert.equal(await response.text(), 'asset', path)
    }
    assert.deepEqual(sent, [])
})
