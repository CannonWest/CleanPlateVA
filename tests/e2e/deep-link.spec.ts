/**
 * A shared link shows the place (design ref §6.2, 2026-09-07) — the page,
 * end to end, on the production build: `?permit=` brings the camera to the
 * facility at neighborhood radius with its panel open, and a dot the
 * visitor clicks THEMSELVES never moves the camera (mapCamera.ts).
 *
 * The facility is read from the committed public/data/ finder shards at
 * test time, never hard-coded: the shards are content-addressed and the
 * roster moves with every publish. A LONE place is chosen — one whose
 * 6-dp point no other permit shares across the whole roster — so the click
 * hits a dot (the panel) and not a stack (the member popover).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SELECT_ZOOM } from '../../app/mapCamera'
import { stackKey } from '../../app/mapData'
import { SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY } from '../../app/constants'

interface MapHandle {
    loaded(): boolean
    isMoving(): boolean
    getZoom(): number
    getCenter(): { lng: number; lat: number }
    project(lngLat: [number, number]): { x: number; y: number }
}
type WithHandle = { __cpMap?: MapHandle }

interface FinderRow { permit_id: string; name: string; lat: number | null; lon: number | null }

/** The first place in the committed roster that stands alone on its point. */
function lonePlace(): FinderRow {
    const dir = join(import.meta.dirname, '..', '..', 'public', 'data', 'finder')
    const rows: FinderRow[] = []
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
        const shard = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { facilities: FinderRow[] }
        rows.push(...shard.facilities)
    }
    const perPoint = new Map<string, number>()
    for (const r of rows) {
        if (r.lat == null || r.lon == null) continue
        const key = stackKey(r.lat, r.lon)
        perPoint.set(key, (perPoint.get(key) ?? 0) + 1)
    }
    const lone = rows.find((r) => r.lat != null && r.lon != null && perPoint.get(stackKey(r.lat, r.lon)) === 1)
    if (!lone) throw new Error('no lone place in the committed roster')
    return lone
}

async function seed(page: Page) {
    await page.addInitScript(([seen, hint]) => {
        window.localStorage.setItem(seen as string, '1')
        window.localStorage.setItem(hint as string, '1')
    }, [SETTINGS_SEEN_KEY, SETTINGS_HINT_KEY])
}

/** The camera once it has settled (no ease in flight). */
function settledCamera(page: Page) {
    return page.evaluate(() => {
        const map = (window as unknown as WithHandle).__cpMap
        if (!map) throw new Error('no map handle')
        const c = map.getCenter()
        return { zoom: map.getZoom(), lng: c.lng, lat: c.lat }
    })
}

test('a shared link brings the camera to the place at neighborhood radius, panel open; the visitor\'s own click never moves it', async ({ page }) => {
    const place = lonePlace()
    const lon = place.lon as number
    const lat = place.lat as number
    await seed(page)
    await page.goto(`/?tier=lite&permit=${encodeURIComponent(place.permit_id)}`)

    // The ease lands: neighborhood radius, centered on the place.
    await page.waitForFunction(
        (floor) => {
            const map = (window as unknown as WithHandle).__cpMap
            return !!map && map.loaded() && !map.isMoving() && map.getZoom() >= floor
        },
        SELECT_ZOOM,
        { timeout: 60_000, polling: 250 },
    )
    const arrived = await settledCamera(page)
    expect(arrived.zoom).toBeCloseTo(SELECT_ZOOM, 3)
    expect(arrived.lng).toBeCloseTo(lon, 4)
    expect(arrived.lat).toBeCloseTo(lat, 4)
    // The panel is the place's.
    await expect(page.getByText(place.name, { exact: true }).first()).toBeVisible()

    // The panel's ✕ (a cold deep link has no in-app history entry, so Back
    // would leave the page). The selection clears; the camera stays put.
    await page.getByLabel(`${place.name} details`).getByRole('button', { name: 'Close' }).click()
    await expect(page).not.toHaveURL(/permit=/)
    expect(await settledCamera(page)).toEqual(arrived)

    // The visitor clicks the dot themselves: the panel returns, and the
    // camera does not move under the click.
    const at = await page.evaluate(
        (p) => (window as unknown as WithHandle).__cpMap!.project(p), [lon, lat] as [number, number])
    await page.mouse.click(at.x, at.y)
    await expect(page).toHaveURL(new RegExp(`permit=${encodeURIComponent(place.permit_id)}`))
    await expect(page.getByText(place.name, { exact: true }).first()).toBeVisible()
    await page.waitForTimeout(700) // longer than any ease
    expect(await settledCamera(page)).toEqual(arrived)
})
