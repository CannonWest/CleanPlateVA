/**
 * The auto-locate waits for the acknowledgement (design ref §6.1 / §6.2,
 * 2026-09-07) — the page, end to end. A first-time visitor lands on the
 * blocking terms dialog with the map already mounted behind it; the
 * browser's location prompt must NOT be raised under that dialog. It fires
 * once the terms are answered.
 *
 * The prompt itself is browser chrome Playwright cannot observe, so the
 * REQUEST is what is counted: a recording stand-in for `navigator.geolocation`
 * (and a Permissions API answering `prompt`, so nothing short-circuits) is
 * installed before the page's scripts run, and the spec reads its call log.
 * The stand-in never answers, so no fix ever moves the camera.
 */
import { expect, test } from '@playwright/test'
import { SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY } from '../../app/constants'

type Probe = { __geoCalls?: unknown[]; __cpMap?: unknown }

test('a first-time visitor is not asked for their location under the terms dialog; the auto-locate fires once the terms are answered', async ({ page }) => {
    await page.addInitScript(({ seen, hint }) => {
        // Not the ack: this visitor has never answered. The settings dialog
        // and its hint are marked seen so the map view is bare afterwards.
        window.localStorage.setItem(seen, '1')
        window.localStorage.setItem(hint, '1')
        const calls: unknown[] = []
        ;(window as unknown as Probe).__geoCalls = calls
        Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: {
                getCurrentPosition: (_ok: unknown, _err: unknown, options: unknown) => { calls.push(options) },
                watchPosition: () => 0,
                clearWatch: () => {},
            },
        })
        Object.defineProperty(navigator, 'permissions', {
            configurable: true,
            value: { query: async () => ({ state: 'prompt' }) },
        })
    }, { seen: SETTINGS_SEEN_KEY, hint: SETTINGS_HINT_KEY })

    await page.goto('/')
    // The terms are up, and the map is mounted behind them — the moment the
    // old client asked for the visitor's location.
    const decline = page.getByRole('button', { name: /decline/i })
    await expect(decline).toBeVisible()
    await page.waitForFunction(() => !!(window as unknown as Probe).__cpMap)
    // Absence needs a bounded wait: the mount-time request, when it existed,
    // was synchronous with the map's construction — a second is generous.
    await page.waitForTimeout(1000)
    expect(await page.evaluate(() => (window as unknown as Probe).__geoCalls?.length)).toBe(0)

    await decline.click()
    // Answered: the basic map, and the ONE patient request.
    await page.waitForFunction(
        () => ((window as unknown as Probe).__geoCalls?.length ?? 0) > 0,
        null,
        { timeout: 15_000 },
    )
    expect(await page.evaluate(() => (window as unknown as Probe).__geoCalls)).toEqual([
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    ])
    // And it was once: nothing re-asks while the page lives.
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as unknown as Probe).__geoCalls?.length)).toBe(1)
})

/**
 * The terms scroll box CONTAINS its scroller (2026-09-10, Cannon's catch —
 * "text in the terms is overrunning the box a little").
 *
 * The scroller used to be `h-full max-h-[46vh]` inside a box sized by
 * `flex-1`. A percentage height does not resolve against a parent whose
 * height comes from flex, so `h-full` fell back to `auto` — the whole
 * ~2,200px document — and the 46vh cap then set the scroller's height to a
 * number derived from the VIEWPORT rather than from its parent. At 900px
 * that was 414.16px inside a 404.22px content box: a 5px overhang past a
 * rounded border with no `overflow-hidden`, so the terms' last line painted
 * over it. The box is a flex column now and the scroller is `flex-1
 * min-h-0`, so it is sized BY its parent and cannot exceed it.
 *
 * Only a real layout engine can say this, which is why it lives out here:
 * jsdom reports every box as 0×0 and would pass either way. Measured at
 * three heights because the old bug's size scaled with the viewport.
 */
for (const [w, h] of [[1280, 900], [1280, 700], [375, 812]] as const) {
    test(`the terms scroller stays inside its box at ${w}x${h}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h })
        await page.goto('/')
        await expect(page.getByRole('button', { name: /decline/i })).toBeVisible()

        const box = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]')!
            const scroller = [...dialog.querySelectorAll('div')]
                .find((d) => getComputedStyle(d).overflowY === 'scroll')!
            const outer = scroller.parentElement!
            const o = outer.getBoundingClientRect()
            const i = scroller.getBoundingClientRect()
            return {
                bottomInset: o.bottom - i.bottom,
                topInset: i.top - o.top,
                leftInset: i.left - o.left,
                rightInset: o.right - i.right,
                scrollable: scroller.scrollHeight > scroller.clientHeight,
            }
        })

        // Every edge of the scroller is at or inside the box's border.
        expect(box.bottomInset).toBeGreaterThanOrEqual(0)
        expect(box.topInset).toBeGreaterThanOrEqual(0)
        expect(box.leftInset).toBeGreaterThanOrEqual(0)
        expect(box.rightInset).toBeGreaterThanOrEqual(0)
        // The document is long enough that this is a real scroll box — a
        // scroller that fit its content would satisfy the insets trivially.
        expect(box.scrollable).toBe(true)
    })
}

/**
 * The terms carry no outward links (2026-09-10). The GitHub and PeerPush
 * badges rode the foot of this scroll box for one deploy and came out
 * again, along with About's pair.
 */
test('the terms dialog and the About page carry no project badges', async ({ page }) => {
    await page.goto('/')
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('a[href*="peerpush.com"], a[href*="github.com"]')).toHaveCount(0)
    await expect(dialog.locator('img')).toHaveCount(2)

    await page.getByRole('button', { name: /agree/i }).click()
    await page.goto('/about')
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('a[href*="peerpush.com"], a[href*="github.com"]')).toHaveCount(0)
    await expect(page.locator('img[src*="peerpush.com"]')).toHaveCount(0)

    // The hero logo stands alone and centered in its row.
    const row = page.locator('main section').first().locator('> div').first()
    await expect(row).toHaveClass(/justify-center/)
    const gaps = await row.evaluate((el) => {
        const img = [...el.querySelectorAll('img')]
            .find((i) => getComputedStyle(i).display !== 'none')!
        const r = el.getBoundingClientRect()
        const b = img.getBoundingClientRect()
        return { left: b.left - r.left, right: r.right - b.right, kids: el.children.length }
    })
    expect(gaps.kids).toBe(1)
    expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(1)
})
