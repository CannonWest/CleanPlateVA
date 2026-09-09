/**
 * The band's two objects and the phone sheet's stop (design ref §6.2,
 * 2026-09-09) — measured on the production build, because all of it is
 * LAYOUT and PAINT, and jsdom has neither: no wrapping, no widths, no media
 * queries, no font to measure a placeholder against, no computed
 * backdrop-filter.
 *
 * What is measured:
 *  1. identity and query as two separate painted objects that flow like
 *     ordinary elements — side by side while the width allows it, the query
 *     bar dropping under identity when it does not (a phone, or a desktop
 *     beside an open panel), never the other way round;
 *  2. the query bar's own clothes: ovular from `sm` up, translucent over a
 *     backdrop blur — the look, not just the class list;
 *  3. the search never clipping its placeholder at ANY of the settings
 *     dialog's text sizes (12–20 px), on a desktop and on a phone. The
 *     placeholder is measured in the input's OWN computed font against the
 *     input's content box, which is the same comparison the browser makes
 *     when it decides to clip;
 *  4. the phone detail sheet stopping under the identity card rather than
 *     taking the screen — at the default size and at 20 px, where identity
 *     itself wraps and the stop has to follow it (this is why
 *     `--cp-band-line-1` is measured and re-published rather than computed
 *     from the box model), and on the LIST view including a list scrolled
 *     far enough to carry its band off the screen, which is the case the
 *     scroll-free edge exists for: it is a height plus a gutter, not a
 *     rect, so a scrolled document publishes the same number as a fresh
 *     one.
 *
 * `?tier=lite` keeps the boot cheap and the ack out of the way; the basic
 * map carries the same band minus the grade chips (P6), and the search is
 * the control under test either way.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SEARCH_LABEL, SETTINGS_HINT_KEY, SETTINGS_SEEN_KEY, TEXT_SIZE_KEY } from '../../app/constants'
import { TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '../../app/settings'

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

/** Every text size the slider offers. */
const SIZES = Array.from(
    { length: TEXT_SIZE_MAX - TEXT_SIZE_MIN + 1 },
    (_, i) => TEXT_SIZE_MIN + i,
)

async function seed(page: Page, textSize?: number) {
    await page.addInitScript(([seen, hint, sizeKey, size]) => {
        window.localStorage.setItem(seen as string, '1')
        window.localStorage.setItem(hint as string, '1')
        if (size) window.localStorage.setItem(sizeKey as string, String(size))
    }, [SETTINGS_SEEN_KEY, SETTINGS_HINT_KEY, TEXT_SIZE_KEY, textSize ?? 0])
}

interface Line {
    top: number
    bottom: number
    left: number
    right: number
    height: number
    rows: number
    radius: string
    background: string
    backdrop: string
}

/** The band's two objects: where each sits, how many ROWS its controls
 *  wrapped into (they are `items-center`, so everything on one flex line
 *  shares a centerline), and the paint that makes it its own object. */
function bandLines(page: Page) {
    return page.evaluate(() => {
        const band = document.querySelector('header')
        if (!band) throw new Error('no band')
        return Array.from(band.children).map((line) => {
            const box = line.getBoundingClientRect()
            const style = getComputedStyle(line)
            const centres = new Set(Array.from(line.children).map((c) => {
                const b = c.getBoundingClientRect()
                return Math.round(b.top + b.height / 2)
            }))
            return {
                top: box.top,
                bottom: box.bottom,
                left: box.left,
                right: box.right,
                height: box.height,
                rows: centres.size,
                radius: style.borderTopLeftRadius,
                background: style.backgroundColor,
                backdrop: style.backdropFilter,
            }
        })
    })
}

/** The search box's content width against the width its placeholder needs
 *  in the font the browser will draw it in. */
function searchFit(page: Page) {
    return page.evaluate(() => {
        const input = document.querySelector('input[type="search"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('no search box')
        const style = getComputedStyle(input)
        const ctx = document.createElement('canvas').getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const card = document.querySelector('header')!.getBoundingClientRect()
        const pill = input.closest('div')!.getBoundingClientRect()
        return {
            has: input.clientWidth,
            shown: input.placeholder,
            label: input.getAttribute('aria-label'),
            needs: ctx.measureText(input.placeholder).width,
            // Negative = the pill has spilled out of the card.
            insideCard: Math.min(pill.left - card.left, card.right - pill.right),
        }
    })
}

test('the band is two objects that flow: side by side with room, stacked without', async ({ page }) => {
    await seed(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/?tier=lite')
    await expect(page.getByRole('navigation', { name: 'View' })).toBeVisible()

    const wide = await bandLines(page)
    expect(wide).toHaveLength(2)
    const [identity, query] = wide as [Line, Line]
    // With the room for it they share a row, identity first — the ordinary
    // flow Cannon asked for, not an unconditional new line.
    expect(identity.top).toBeCloseTo(query.top, 0)
    expect(identity.right).toBeLessThanOrEqual(query.left)
    // Two OBJECTS: each paints its own ground, and they are separated by a
    // real gap rather than a seam inside one card.
    expect(identity.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(query.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(query.left - identity.right).toBeGreaterThan(0)
    // Neither has wrapped inside itself at the ratified size.
    expect(identity.rows).toBe(1)
    expect(query.rows).toBe(1)
    // The switcher is identity's; the search is the query bar's.
    const inLine = (selector: string) => page.evaluate((sel) => {
        const el = document.querySelector(sel)!
        const lines = Array.from(document.querySelector('header')!.children)
        return lines.findIndex((line) => line.contains(el))
    }, selector)
    expect(await inLine('nav[aria-label="View"]')).toBe(0)
    expect(await inLine('input[type="search"]')).toBe(1)

    // Take the width away and the query bar drops UNDER identity — the same
    // two objects, stacked, never reordered.
    await page.setViewportSize(PHONE)
    await expect(page.getByRole('navigation', { name: 'View' })).toBeVisible()
    const narrow = await bandLines(page)
    const [stackedIdentity, stackedQuery] = narrow as [Line, Line]
    expect(stackedIdentity.bottom).toBeLessThanOrEqual(stackedQuery.top)
    expect(stackedIdentity.left).toBeCloseTo(stackedQuery.left, 0)
})

/** A computed colour's alpha, in either notation the engine may hand back:
 *  `rgba(r, g, b, a)` for a plain colour, `oklab(l a b / alpha)` for
 *  Tailwind's opacity modifier (which resolves through `color-mix`). */
function alphaOf(colour: string): number {
    const slash = /\/\s*([0-9.]+)\s*\)/.exec(colour)
    if (slash) return parseFloat(slash[1]!)
    const rgba = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([0-9.]+)\s*\)$/.exec(colour)
    return rgba ? parseFloat(rgba[1]!) : 1
}

test('the query bar wears its own clothes: ovular from `sm` up, translucent over a blur', async ({ page }) => {
    await seed(page)
    await page.setViewportSize(DESKTOP)
    await page.goto('/?tier=lite')
    await expect(page.locator('input[type="search"]')).toBeVisible()

    const [identity, query] = await bandLines(page) as [Line, Line]
    // Ovular: the radius is at least half the bar's height, which is what
    // makes the ends semicircles rather than rounded corners. The identity
    // card is deliberately NOT — the different shape is the separation.
    expect(parseFloat(query.radius)).toBeGreaterThanOrEqual(query.height / 2)
    expect(parseFloat(identity.radius)).toBeLessThan(identity.height / 2)
    // Translucent over a blur — the fuzzy look, read off the COMPUTED style
    // rather than the class list.
    expect(alphaOf(query.background), `the query bar is opaque: ${query.background}`)
        .toBeLessThan(1)
    expect(query.backdrop).toMatch(/blur\(/)
    // The identity card stays solid: the contrast between the two is the
    // separation, so this is a pin, not an accident.
    expect(alphaOf(identity.background)).toBe(1)

    // Below `sm` the bar wraps to several rows, and a stadium that tall
    // reads as a blob — the radius steps down to the card's.
    await page.setViewportSize(PHONE)
    await expect(page.locator('input[type="search"]')).toBeVisible()
    const [, phoneQuery] = await bandLines(page) as [Line, Line]
    expect(parseFloat(phoneQuery.radius)).toBeLessThan(phoneQuery.height / 2)
    expect(phoneQuery.backdrop).toMatch(/blur\(/)
})

for (const viewport of [DESKTOP, PHONE]) {
    const where = viewport === DESKTOP ? 'a desktop' : 'a phone'
    test(`the search shows its whole placeholder at every text size on ${where}`, async ({ page }) => {
        for (const size of SIZES) {
            await seed(page, size)
            await page.setViewportSize(viewport)
            await page.goto('/?tier=lite')
            await expect(page.locator('input[type="search"]')).toBeVisible()
            const fit = await searchFit(page)
            expect(fit.has, `${size}px on ${where}: the placeholder is clipped`)
                .toBeGreaterThanOrEqual(fit.needs)
            expect(fit.insideCard, `${size}px on ${where}: the pill has spilled out of the band`)
                .toBeGreaterThanOrEqual(0)
            // Whatever it shows, the full sentence is what it is CALLED.
            expect(fit.label).toBe(SEARCH_LABEL)
            // Shortening is the corner, not the rule: with a desktop's width
            // the full sentence stands at every size, and a phone keeps it
            // at the size the design was ratified at.
            if (viewport === DESKTOP || size <= TEXT_SIZE_DEFAULT) {
                expect(fit.shown, `${size}px on ${where}: the sentence shortened with room to spare`)
                    .toBe(SEARCH_LABEL)
            }
        }
    })
}

/** A facility the roster actually carries, so the sheet has something to
 *  open — the shards are content-addressed and move with every publish. */
function anyPlace(): { permit_id: string; name: string } {
    const dir = join(import.meta.dirname, '..', '..', 'public', 'data', 'finder')
    const [first] = readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    if (!first) throw new Error('no committed finder shards')
    const shard = JSON.parse(readFileSync(join(dir, first), 'utf8')) as {
        facilities: Array<{ permit_id: string; name: string }>
    }
    const [place] = shard.facilities
    if (!place) throw new Error('the first finder shard is empty')
    return place
}

test('the phone sheet stops in the same place on the List, scrolled or not', async ({ page }) => {
    const place = anyPlace()
    await seed(page)
    await page.setViewportSize(PHONE)
    await page.goto('/list?tier=lite')
    await expect(page.getByRole('navigation', { name: 'View' })).toBeVisible()

    // The List's band rides the flow, so the edge it publishes has to be
    // the one it would publish unscrolled. Read it fresh, then scroll the
    // records past it and read it again.
    const edge = () => page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--cp-band-line-1').trim())
    const [identity] = await bandLines(page) as [Line, Line]
    const atRest = await edge()
    expect(parseFloat(atRest)).toBeCloseTo(identity.bottom, 0)

    const scroller = page.locator('div.overflow-y-auto').first()
    await scroller.evaluate((el) => { el.scrollTop = 1200 })
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000)
    // The band has left the screen; the published edge has not moved.
    const [scrolledIdentity] = await bandLines(page) as [Line, Line]
    expect(scrolledIdentity.bottom).toBeLessThan(0)
    expect(await edge()).toBe(atRest)

    // Open a place from the scrolled list: the sheet stops at that same
    // edge, not at the top of the screen.
    await page.goto(`/list?tier=lite&permit=${encodeURIComponent(place.permit_id)}`)
    const sheet = page.getByLabel(`${place.name} details`)
    await expect(sheet).toBeVisible()
    const box = (await sheet.boundingBox())!
    expect(box.y).toBeCloseTo(parseFloat(atRest) + 8, 0)
    expect(box.x).toBe(0)
    expect(box.width).toBe(PHONE.width)
    expect(box.y + box.height).toBe(PHONE.height)
})

for (const size of [undefined, TEXT_SIZE_MAX]) {
    const label = size ? `${size}px, where line 1 wraps` : 'the ratified size'
    test(`the phone sheet stops under the band's first line at ${label}`, async ({ page }) => {
        const place = anyPlace()
        await seed(page, size)
        await page.setViewportSize(PHONE)
        await page.goto(`/?tier=lite&permit=${encodeURIComponent(place.permit_id)}`)

        const sheet = page.getByLabel(`${place.name} details`)
        await expect(sheet).toBeVisible()
        const box = (await sheet.boundingBox())!
        const [identity] = await bandLines(page) as [Line, Line]

        // The sheet clears line 1 — and only line 1: it starts at the edge
        // the band published, not at the top of the screen and not below
        // the whole card.
        expect(box.y).toBeCloseTo(identity.bottom + 8, 0)
        expect(box.y).toBeGreaterThan(0)
        // Flush to the phone's other three edges.
        expect(box.x).toBe(0)
        expect(box.width).toBe(PHONE.width)
        expect(box.y + box.height).toBe(PHONE.height)
        // The identity line is standing above it, not behind it.
        await expect(page.getByRole('navigation', { name: 'View' })).toBeVisible()
        expect(identity.bottom).toBeLessThanOrEqual(box.y)
    })
}
