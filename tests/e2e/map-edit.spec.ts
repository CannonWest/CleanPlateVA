/**
 * The map edit mode, end to end on the production build (design ref §6.6,
 * CPE-M2) — with REAL mouse events, the one way a drag on a MapLibre canvas
 * can be proven (the RFE lesson: synthetic events bypass the map's own
 * arming). A device holding the session flag sees the Edit pill beside
 * Settings; the mode's banner and drawer appear; a dot dragged away becomes
 * an orange pin tethered to where the record stands; a pin dropped back on
 * its dot is discarded; the draft survives a reload; a row dragged out of a
 * stack's popover becomes a pin; a ZIP-centroid place drags as a site fix
 * with its badge. A visitor's map shows no pill and makes no /admin request.
 * Submit (CPE-M3) posts one `cleanplateva.map-draft.v1` draft per place to
 * the proposals route — Playwright's stub here, the Worker on the host —
 * and a build without the route cannot pretend to store.
 *
 * The places are read from the committed public/data/ finder shards at
 * test time (content-addressed; the roster moves with every publish). The
 * session route is Playwright's stub — `vite preview` runs no Worker — and
 * the Full tier's detail is absent here, so every pin reports its detail
 * unavailable (D-CPE-3): the drag does not depend on it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ACK_AGREED, ACK_KEY } from '../../app/ack'
import { LYR_PROPOSAL_PINS, LYR_PROPOSAL_TETHERS } from '../../app/admin/mapDraft'
import {
    ADMIN_SESSION_KEY, LYR_AERIAL, LYR_POINTS, MAP_DRAFT_KEY, SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY,
} from '../../app/constants'
import { SELECT_ZOOM } from '../../app/mapCamera'
import { stackKey } from '../../app/mapData'

interface FinderRow { permit_id: string; name: string; lat: number; lon: number; loc: number; mobile: boolean }
interface MapHandle {
    loaded(): boolean
    isMoving(): boolean
    getZoom(): number
    project(lngLat: [number, number]): { x: number; y: number }
    querySourceFeatures(source: string): unknown[]
}
type WithHandle = { __cpMap?: MapHandle }

const EMAIL = 'operator@example.test'

function roster(): FinderRow[] {
    const dir = join(import.meta.dirname, '..', '..', 'public', 'data', 'finder')
    const rows: FinderRow[] = []
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
        rows.push(...(JSON.parse(readFileSync(join(dir, name), 'utf8')) as { facilities: FinderRow[] }).facilities)
    }
    return rows
}

/** The roster grouped by 6-dp point. Mobile units are left out: they are
 *  hidden by the visitor's default flag, which the mode respects (OQ-E). */
function groups() {
    const rows = roster().filter((r) => r.lat != null && r.lon != null && !r.mobile)
    const byPoint = new Map<string, FinderRow[]>()
    for (const r of rows) {
        const key = stackKey(r.lat, r.lon)
        byPoint.set(key, [...(byPoint.get(key) ?? []), r])
    }
    return byPoint
}

function lonePlace(loc: (value: number) => boolean): FinderRow {
    for (const members of groups().values()) {
        if (members.length === 1 && loc(members[0]!.loc)) return members[0]!
    }
    throw new Error('no such lone place in the committed roster')
}

function smallStack(): FinderRow[] {
    for (const members of groups().values()) {
        if (members.length >= 2 && members.length <= 6 && members.every((m) => m.loc !== 2)) return members
    }
    throw new Error('no small stack in the committed roster')
}

async function seed(page: Page, extra: Record<string, string> = {}) {
    await page.addInitScript((entries) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value)
    }, Object.entries({ [SETTINGS_SEEN_KEY]: '1', [SETTINGS_HINT_KEY]: '1', [ACK_KEY]: ACK_AGREED, ...extra }))
}

const session = () => JSON.stringify({ email: EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 })

async function stubSession(page: Page) {
    await page.route('**/admin/api/session', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true, email: EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 }),
    }))
}

/** Open the map on a place and wait for the deep link's ease to land. */
async function openOn(page: Page, place: FinderRow) {
    await page.goto(`/?permit=${encodeURIComponent(place.permit_id)}`)
    await page.waitForFunction(
        (floor) => {
            const map = (window as unknown as WithHandle).__cpMap
            return !!map && map.loaded() && !map.isMoving() && map.getZoom() >= floor
        },
        SELECT_ZOOM,
        { timeout: 60_000, polling: 250 },
    )
    // The deep link opened the place's panel; the mode closes it on entry
    // anyway, but a clean start makes the assertions below unambiguous.
    await page.getByLabel(`${place.name} details`).getByRole('button', { name: 'Close' }).click()
    await expect(page).not.toHaveURL(/permit=/)
}

async function enterEdit(page: Page) {
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByRole('note').filter({ hasText: 'Edit mode.' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Proposed pins' })).toBeVisible()
}

function screenPoint(page: Page, place: FinderRow) {
    return page.evaluate(
        (p) => (window as unknown as WithHandle).__cpMap!.project(p), [place.lon, place.lat] as [number, number])
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 })
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 })
    await page.mouse.up()
}

const pinCount = (page: Page) => page.locator('[data-cp-pin-count]')

function proposalFeatures(page: Page) {
    return page.evaluate(() => (window as unknown as WithHandle).__cpMap!.querySourceFeatures('cp-proposals').length)
}

test('a visitor: no Edit pill on the map, and not one request under /admin', async ({ page }) => {
    const seen: string[] = []
    page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith('/admin')) seen.push(url.pathname)
    })
    await seed(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    expect(seen).toEqual([])
})

test('drag a dot: the pin and its tether appear, the drawer names it, the draft survives a reload, Undo clears it', async ({ page }) => {
    const place = lonePlace((loc) => loc !== 2)
    await seed(page, { [ADMIN_SESSION_KEY]: session() })
    await stubSession(page)
    await openOn(page, place)
    await enterEdit(page)
    await expect(pinCount(page)).toHaveText('0')

    const at = await screenPoint(page, place)
    await drag(page, at, 90, 60)

    await expect(pinCount(page)).toHaveText('1')
    const item = page.locator(`[data-cp-pin="${place.permit_id}"]`)
    await expect(item).toContainText(place.name)
    await expect(item).toContainText('Refinement')
    const moved = await item.locator('[data-cp-pin-moved]').textContent()
    expect(Number.parseFloat(moved ?? '0')).toBeGreaterThan(0)
    // The record never moved: the source holds the pin AND its tether.
    expect(await proposalFeatures(page)).toBeGreaterThanOrEqual(2)
    // The dot is still where it was — a second gesture from the same spot
    // picks the place up again rather than a second one.
    await expect(page.getByRole('button', { name: 'Reset all' })).toBeEnabled()

    // The draft survives a reload (OQ-B), and the mode is re-entered.
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as WithHandle).__cpMap?.loaded(), null, { timeout: 60_000 })
    await enterEdit(page)
    await expect(pinCount(page)).toHaveText('1')
    await expect(page.locator(`[data-cp-pin="${place.permit_id}"]`)).toContainText(place.name)

    await page.getByRole('button', { name: `Undo the pin for ${place.name}` }).click()
    await expect(pinCount(page)).toHaveText('0')
    expect(await page.evaluate((key) => window.localStorage.getItem(key), MAP_DRAFT_KEY)).toBeNull()
})

test('a pin dropped back on its dot is discarded, and a click on a dot opens no panel', async ({ page }) => {
    const place = lonePlace((loc) => loc !== 2)
    await seed(page, { [ADMIN_SESSION_KEY]: session() })
    await stubSession(page)
    await openOn(page, place)
    await enterEdit(page)
    const at = await screenPoint(page, place)
    await drag(page, at, 3, 2)
    await expect(pinCount(page)).toHaveText('0')
    await page.mouse.click(at.x, at.y)
    await expect(page).not.toHaveURL(/permit=/)
    await expect(pinCount(page)).toHaveText('0')
})

test('drag a row out of a stack\'s popover: the member becomes a pin tethered to the stack, the popover stays', async ({ page }) => {
    const members = smallStack()
    const member = members[0]!
    await seed(page, { [ADMIN_SESSION_KEY]: session() })
    await stubSession(page)
    await openOn(page, member)
    await enterEdit(page)

    const at = await screenPoint(page, member)
    await page.mouse.click(at.x, at.y)
    const popover = page.locator('.maplibregl-popup.cp-pop')
    await expect(popover).toContainText(`${members.length} places at this point`)
    const rowButton = popover.getByRole('button', { name: member.name })
    const box = await rowButton.boundingBox()
    if (!box) throw new Error('no row box')
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 160, 110)

    await expect(pinCount(page)).toHaveText('1')
    await expect(page.locator(`[data-cp-pin="${member.permit_id}"]`)).toContainText(member.name)
    await expect(popover).toBeVisible()
    expect(await proposalFeatures(page)).toBeGreaterThanOrEqual(2)
})

test('a ZIP-centroid place drags as a site fix and says what it moves', async ({ page }) => {
    const place = lonePlace((loc) => loc === 2)
    await seed(page, { [ADMIN_SESSION_KEY]: session() })
    await stubSession(page)
    await openOn(page, place)
    await enterEdit(page)
    const at = await screenPoint(page, place)
    await drag(page, at, 100, 40)
    const item = page.locator(`[data-cp-pin="${place.permit_id}"]`)
    await expect(item).toContainText('Site fix')
    await expect(item).toContainText(/Moves \d+ permits? at /)
})

// ── the aerial basemap inside edit mode (2026-09-08) ─────────────────────
// Found merging the aerial (#220) over this mode: the mode's tether (line)
// and pin (circle) layers sit above the markers, and a flip that re-scanned
// the style for "the last drawn layer" took the pins for the basemap and put
// the photograph over the dots. MapView now measures the seam on the pristine
// style at style.load and hands it to every flip (map-layers.spec.ts pins the
// rule); this is the same thing on the production build with the real mode.

test('flipping to the aerial in edit mode keeps the photo under the dots AND under the proposal layers', async ({ page }) => {
    await seed(page, { [ADMIN_SESSION_KEY]: session() })
    await stubSession(page)
    await openOn(page, lonePlace((v) => v !== 2))
    await enterEdit(page)
    const ids = { aerial: LYR_AERIAL, points: LYR_POINTS, tethers: LYR_PROPOSAL_TETHERS, pins: LYR_PROPOSAL_PINS }
    const order = () => page.evaluate((ids) => {
        const map = (window as unknown as { __cpMap?: { getStyle(): { layers: Array<{ id: string }> } } }).__cpMap
        if (!map) throw new Error('no map handle')
        const layers = map.getStyle().layers.map((l) => l.id)
        return {
            aerial: layers.indexOf(ids.aerial), points: layers.indexOf(ids.points),
            tethers: layers.indexOf(ids.tethers), pins: layers.indexOf(ids.pins),
        }
    }, ids)
    const before = await order()
    // The shape the first cut got wrong: the mode's layers ABOVE the markers.
    expect(before.tethers).toBeGreaterThan(before.points)
    expect(before.pins).toBeGreaterThan(before.points)
    expect(before.aerial).toBe(-1)

    // By keyboard, deliberately: the mode's drawer (`fixed top-3 right-3
    // bottom-3`) covers the whole bottom-right control lane, so the layers
    // button — and Find me and the zoom buttons beside it, a CPE-M2 fact
    // that predates the aerial — is pointer-unreachable in edit mode
    // (Playwright: the aside "intercepts pointer events"). Reported with
    // this PR, not decided here. Focus + Enter is the path a pointer cannot
    // take, and a real one: the control is a button, the entries are radios.
    const layers = page.getByRole('button', { name: 'Basemap', exact: true })
    await layers.focus()
    await page.keyboard.press('Enter')
    const aerialEntry = page.getByRole('radio', { name: /Aerial/ })
    await aerialEntry.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(
        (id) => !!(window as unknown as { __cpMap?: { getLayer(id: string): unknown } }).__cpMap?.getLayer(id),
        LYR_AERIAL,
        { timeout: 60_000 },
    )
    const after = await order()
    expect(after.aerial).toBeGreaterThan(-1)
    expect(after.aerial).toBeLessThan(after.points)
    expect(after.aerial).toBeLessThan(after.tethers)
    expect(after.aerial).toBeLessThan(after.pins)
    // The mode is still on, its layers still above the markers, untouched.
    expect(after.tethers).toBeGreaterThan(after.points)
    await expect(page.getByRole('note').filter({ hasText: 'Edit mode.' })).toBeVisible()
})

// ── Submit (CPE-M3) ─────────────────────────────────────────────────────
// `vite preview` runs no Worker, so the proposals route is Playwright's: a
// Worker that stores what it is sent and lists it back, or the SPA shell a
// host without the route answers. The draft's SHAPE is the contract under
// test here — the Worker's own checks are worker-admin-proposals.spec.ts.

interface StoredDraft {
    key: string; name: string; saved_at: string; pins: number; sha256: string; stack_key: string
    snapshot_id: string; submitted_by: string; size: number; uploaded: string; pulled: boolean
}

test('Submit stores one draft per place: the pin leaves the device, the line names the draft, the Submitted panel lists it', async ({ page }) => {
    const place = lonePlace((loc) => loc !== 2)
    await seed(page, { [ADMIN_SESSION_KEY]: session() })
    await stubSession(page)
    const posted: Record<string, unknown>[] = []
    const stored: StoredDraft[] = []
    await page.route('**/admin/api/proposals', async (route) => {
        const request = route.request()
        if (request.method() === 'POST') {
            const body = request.postDataJSON() as Record<string, unknown>
            posted.push(body)
            const name = `20260908T191503Z-${String(posted.length).padStart(8, '0')}`
            const entry: StoredDraft = {
                key: `drafts/${name}.json`, name, saved_at: '2026-09-08T19:15:03Z', pins: (body.pins as unknown[]).length,
                sha256: 'ab'.repeat(32), stack_key: (body.batch as { stack_key: string }).stack_key,
                snapshot_id: String(body.snapshot_id), submitted_by: EMAIL, size: 1,
                uploaded: '2026-09-08T19:15:03.000Z', pulled: false,
            }
            stored.push(entry)
            await route.fulfill({
                status: 201,
                contentType: 'application/json; charset=utf-8',
                headers: { 'cache-control': 'no-store' },
                body: JSON.stringify({ ok: true, key: entry.key, sha256: entry.sha256, pins: entry.pins, saved_at: entry.saved_at, existing: false }),
            })
            return
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: { 'cache-control': 'no-store' },
            body: JSON.stringify({ ok: true, drafts: [...stored].reverse(), truncated: false }),
        })
    })
    await openOn(page, place)
    await enterEdit(page)
    await expect(page.locator('[data-cp-submitted-count]')).toHaveText('0')
    const submit = page.locator('[data-cp-submit]')
    await expect(submit).toBeDisabled()

    const at = await screenPoint(page, place)
    await drag(page, at, 90, 60)
    await expect(pinCount(page)).toHaveText('1')
    await expect(submit).toHaveText('Submit 1 pin')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(pinCount(page)).toHaveText('0')
    expect(posted).toHaveLength(1)
    const draft = posted[0]!
    expect(draft.contract).toBe('cleanplateva.map-draft.v1')
    expect(draft.schema_version).toBe(1)
    expect(draft.tier).toBe('lite')
    expect(typeof draft.snapshot_id).toBe('string')
    for (const field of ['operator', 'instrument', 'saved_at', 'submitted_by']) expect(draft).not.toHaveProperty(field)
    expect(['positron', 'dark-matter']).toContain((draft.basemap as { style: string }).style)
    expect((draft.basemap as { zoom: number }).zoom).toBeGreaterThanOrEqual(SELECT_ZOOM)
    const batch = draft.batch as { stack_key: string; group_lat: number; group_lon: number; facility_count: number; site_group_id: null }
    expect(batch.stack_key).toBe(stackKey(place.lat, place.lon))
    expect(batch.facility_count).toBe(1)
    expect(batch.site_group_id).toBeNull()
    const pins = draft.pins as { permit_id: string; kind: string; covers: string[]; published: { lat: number; lon: number; loc: number; location: null }; after: { lat: number; lon: number }; note: null }[]
    expect(pins).toHaveLength(1)
    expect(pins[0]!.permit_id).toBe(place.permit_id)
    expect(pins[0]!.kind).toBe('refinement')
    expect(pins[0]!.covers).toEqual([place.permit_id])
    expect(pins[0]!.published).toEqual({ lat: place.lat, lon: place.lon, loc: place.loc, location: null })
    expect(pins[0]!.after).not.toEqual({ lat: place.lat, lon: place.lon })
    expect(pins[0]!.note).toBeNull()

    await expect(page.locator('[data-cp-result="stored"]')).toContainText('20260908T191503Z-00000001')
    await expect(page.locator('[data-cp-submitted-count]')).toHaveText('1')
    await expect(page.locator('[data-cp-submitted="20260908T191503Z-00000001"]')).toContainText('Awaiting pull')
    expect(await page.evaluate((key) => window.localStorage.getItem(key), MAP_DRAFT_KEY)).toBeNull()
})

test('a build without the Worker: Submit cannot store, says so, and the pin stays', async ({ page }) => {
    const place = lonePlace((loc) => loc !== 2)
    await seed(page, { [ADMIN_SESSION_KEY]: session() })
    await stubSession(page)
    // What a host without the route answers: the SPA shell, 200 text/html.
    await page.route('**/admin/api/proposals', (route) => route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>shell</title>',
    }))
    await openOn(page, place)
    await enterEdit(page)
    await expect(page.locator('[data-cp-submitted-panel]')).toContainText('not listed in this build')
    const at = await screenPoint(page, place)
    await drag(page, at, 90, 60)
    await expect(pinCount(page)).toHaveText('1')
    const submit = page.locator('[data-cp-submit]')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.locator('[data-cp-result="unavailable"]')).toContainText('cannot store drafts')
    await expect(pinCount(page)).toHaveText('1')
    expect(await page.evaluate((key) => window.localStorage.getItem(key), MAP_DRAFT_KEY)).not.toBeNull()
})
