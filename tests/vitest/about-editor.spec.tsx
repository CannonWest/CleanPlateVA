// @vitest-environment jsdom
/**
 * The About edit mode's shell (CPE-M1, app/admin/AboutEditor.tsx) and the
 * session page (app/admin/AdminApp.tsx). The op model itself is pinned by
 * admin-editor.spec.ts; what is pinned here is the one thing that moved
 * with the mount — the paths anchor on the DOCUMENT's root, not the host —
 * plus the mode's exit, and the session page's three states.
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AboutEditor } from '../../app/admin/AboutEditor'
import { AdminApp } from '../../app/admin/AdminApp'
import { STORAGE_KEY } from '../../app/admin/ops'
import { ADMIN_SESSION_KEY } from '../../app/constants'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    window.localStorage.clear()
})

afterEach(async () => {
    await act(async () => { root?.unmount() })
    root = null
    host.remove()
    vi.restoreAllMocks()
})

async function render(element: React.ReactElement) {
    root = createRoot(host)
    await act(async () => {
        root?.render(<StrictMode>{element}</StrictMode>)
    })
}

const click = (el: Element) => act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})

/** A stand-in for the About document: a <main> with two children, the way
 *  AboutView renders. */
function Doc() {
    return (
        <main>
            <h2>Score anatomy</h2>
            <p>How a grade is built.</p>
        </main>
    )
}

test('a picked element is addressed from the document root — the path has no leading 0/', async () => {
    const onExit = vi.fn()
    await render(<AboutEditor onExit={onExit}><Doc /></AboutEditor>)
    const paragraph = host.querySelector('main > p')
    expect(paragraph).not.toBeNull()
    await click(paragraph as Element)
    const aside = host.querySelector('aside')
    expect(aside?.textContent).toContain('<p>')
    // Under the first editor this read "path 0/1": the host's first child was
    // the document. The anchor is the document now.
    expect(aside?.textContent).toContain('path 1')
    expect(aside?.textContent).not.toContain('path 0/1')
})

test("the document's own controls are inert while the mode is on", async () => {
    const fired = vi.fn()
    await render(
        <AboutEditor onExit={() => {}}>
            <main><button type="button" onClick={fired}>Switch</button></main>
        </AboutEditor>,
    )
    await click(host.querySelector('main > button') as Element)
    expect(fired).not.toHaveBeenCalled()
})

test('Exit edit hands back a document with no draft applied, and keeps the draft in storage', async () => {
    const onExit = vi.fn()
    await render(<AboutEditor onExit={onExit}><Doc /></AboutEditor>)
    const heading = host.querySelector('main > h2') as Element
    await click(heading)
    const textarea = host.querySelector('#cp-admin-text') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
        setter?.call(textarea, 'How the score works')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const apply = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Apply text')
    await click(apply as Element)
    expect(heading.textContent).toBe('How the score works')
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('How the score works')

    const exit = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Exit edit')
    await click(exit as Element)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(heading.textContent).toBe('Score anatomy')
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('How the score works')
})

test('the storage key is the v2 key: a v1 draft (host-anchored paths) is never read', () => {
    expect(STORAGE_KEY).toBe('cleanplateva.admin.about.v2')
})

// The Export hint is the only place the editor says what to DO with a draft,
// and it names a real file. It went unpinned until CPP-M1 rewrote it, so it
// is pinned here: what the operator is told, and that the instruction is
// tool-agnostic — the export is a paste, whoever or whatever does the pasting.
test('the Export dialog tells the operator where the draft goes, without naming a tool', async () => {
    await render(<AboutEditor onExit={() => {}}><Doc /></AboutEditor>)
    const heading = host.querySelector('main > h2') as Element
    await click(heading)
    const textarea = host.querySelector('#cp-admin-text') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
        setter?.call(textarea, 'How the score works')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Apply text') as Element)

    const exportBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Export') as HTMLButtonElement
    expect(exportBtn.disabled).toBe(false)      // an op exists, so the dialog can open
    await click(exportBtn)

    const hint = host.querySelector('.fixed.z-\\[60\\]')?.textContent ?? ''
    expect(hint).toContain('app/AboutView.tsx')
    expect(hint).not.toMatch(/claude|chatgpt|copilot|\bAI\b/i)
})

// ── the session page ─────────────────────────────────────────────────────

function fetchAnswering(status: number, body: unknown, contentType = 'application/json; charset=utf-8') {
    return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } }))
}

test('a verified session: the page names the operator and writes the device flag', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    vi.stubGlobal('fetch', fetchAnswering(200, { ok: true, email: 'x@example.test', exp }))
    await render(<AdminApp />)
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('Signed in as')
    expect(host.textContent).toContain('x@example.test')
    expect(JSON.parse(window.localStorage.getItem(ADMIN_SESSION_KEY) ?? 'null')).toEqual({ email: 'x@example.test', exp })
    expect(host.querySelector('a[href="/"]')).not.toBeNull()
    expect(host.querySelector('a[href="/about"]')).not.toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent === 'Sign out')).toBe(true)
})

test('the Worker refusing the token: the flag is cleared and the page says to sign in again', async () => {
    window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ email: 'old@example.test', exp: Math.floor(Date.now() / 1000) + 60 }))
    vi.stubGlobal('fetch', fetchAnswering(401, { ok: false, reason: 'invalid session' }))
    await render(<AdminApp />)
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('could not be verified')
    expect(window.localStorage.getItem(ADMIN_SESSION_KEY)).toBeNull()
})

test('a build without the Worker: the shell comes back and the page says verification is unavailable', async () => {
    vi.stubGlobal('fetch', fetchAnswering(200, '<!doctype html>', 'text/html'))
    await render(<AdminApp />)
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('not available in this build')
    expect(window.localStorage.getItem(ADMIN_SESSION_KEY)).toBeNull()
})
