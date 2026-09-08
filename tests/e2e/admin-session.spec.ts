/**
 * The edit modes' visitor contract, on the production build (design ref
 * §6.6, CPE-M1): a visitor's page renders no Edit control and makes ZERO
 * `/admin/*` requests; a device holding the session flag sees the control on
 * About, one probe confirms the session, the editor mounts over the live
 * document and Exit edit takes it down; Access's redirect on the probe reads
 * as signed out; and /admin is the session page.
 *
 * `vite preview` runs no Worker, so `/admin/api/session` is answered by
 * Playwright's route — a 200 with the identity shape, or a 302 to the Access
 * login page, which the browser withholds from a `redirect: 'manual'` fetch
 * exactly as the host does (measured 2026-09-07).
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ACK_AGREED, ACK_KEY } from '../../app/ack'
import { ADMIN_SESSION_KEY, SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY } from '../../app/constants'

const EMAIL = 'operator@example.test'
const LOGIN = 'https://cannonwest.cloudflareaccess.com/cdn-cgi/access/login/cleanplateva.com?kid=test'

function session(exp = Math.floor(Date.now() / 1000) + 3600) {
    return { email: EMAIL, exp }
}

async function seed(page: Page, extra: Record<string, string> = {}) {
    await page.addInitScript((entries) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value)
    }, Object.entries({ [SETTINGS_SEEN_KEY]: '1', [SETTINGS_HINT_KEY]: '1', [ACK_KEY]: ACK_AGREED, ...extra }))
}

/** Every request under /admin, as the visitor's page makes them. */
function adminRequests(page: Page): string[] {
    const seen: string[] = []
    page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith('/admin')) seen.push(url.pathname)
    })
    return seen
}

test('a visitor: no Edit control on About, and not one request under /admin', async ({ page }) => {
    const seen = adminRequests(page)
    await seed(page)
    await page.goto('/about')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('CleanPlateVA')
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Exit edit' })).toHaveCount(0)
    // Let the page settle (the roster, the document) before reading the log.
    await page.waitForLoadState('networkidle')
    expect(seen).toEqual([])
})

test('a device with a session: Edit on About → one probe → the editor over the live document → Exit edit', async ({ page }) => {
    const seen = adminRequests(page)
    await seed(page, { [ADMIN_SESSION_KEY]: JSON.stringify(session()) })
    let probes = 0
    await page.route('**/admin/api/session', async (route) => {
        probes += 1
        await route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: { 'cache-control': 'no-store' },
            body: JSON.stringify({ ok: true, ...session() }),
        })
    })
    await page.goto('/about')
    const edit = page.getByRole('button', { name: 'Edit', exact: true })
    await expect(edit).toBeVisible()
    expect(probes).toBe(0)
    await edit.click()
    const editor = page.locator('[data-cp-about-editor]')
    await expect(editor.getByText('About editor')).toBeVisible()
    expect(probes).toBe(1)
    // The live document is inside the editor: the About heading, once.
    await expect(editor.getByRole('heading', { level: 1 })).toContainText('CleanPlateVA')
    // Two ways out — the head pill, now pressed, and the editor's own
    // header button; the overlay covers the page, so the header's is the one
    // in reach.
    await expect(page.getByRole('button', { name: 'Exit edit' })).toHaveCount(2)
    await editor.getByRole('button', { name: 'Exit edit' }).click()
    await expect(page.getByText('About editor')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('CleanPlateVA')
    expect(seen).toEqual(['/admin/api/session'])
})

test("Access's redirect on the probe: the control stays, the flag goes, the line says where to sign in", async ({ page }) => {
    await seed(page, { [ADMIN_SESSION_KEY]: JSON.stringify(session()) })
    await page.route('**/admin/api/session', (route) => route.fulfill({ status: 302, headers: { location: LOGIN } }))
    await page.goto('/about')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Sign in at /admin')
    await expect(page.getByText('About editor')).toHaveCount(0)
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ADMIN_SESSION_KEY)).toBeNull()
})

test('/admin is the session page: it names the operator and writes the device flag', async ({ page }) => {
    await seed(page)
    await page.route('**/admin/api/session', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true, ...session() }),
    }))
    await page.goto('/admin')
    await expect(page.getByText(`Signed in as`)).toBeVisible()
    await expect(page.getByText(EMAIL)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    const flag = await page.evaluate((key) => window.localStorage.getItem(key), ADMIN_SESSION_KEY)
    expect(JSON.parse(flag ?? 'null')).toMatchObject({ email: EMAIL })
    // Nothing of the public app renders on the session page.
    await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0)
})
