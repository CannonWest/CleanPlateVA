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
