import { useSyncExternalStore } from 'react'

import logoDark from './logo-dark.png'
import logoLight from './logo-light.png'

/**
 * The wordmark, in the resolved theme's artwork.
 *
 * ONE <img> is rendered, never two. The earlier shape rendered both and hid
 * one with the `light:` variant, but `display: none` does not stop an <img>
 * from loading — so every visitor fetched BOTH PNGs and looked at one.
 * Measured on launch traffic 2026-09-14: logo-light 575 requests and
 * logo-dark 591, against ~470 arrivals — 204 MB, 10.5% of the day's
 * bandwidth, about half of it for artwork nobody saw.
 *
 * The theme is read from the same place applyThemeClass() writes it —
 * `.theme-light` on <html> (app/theme.ts) — rather than taken as a prop, so
 * the component stays droppable anywhere without threading `dark` through
 * AboutView and AckDialog. index.html adds that class pre-paint, so the very
 * first render already picks the right file and the wrong one is never
 * requested; a live theme change re-renders through the observer below.
 *
 * Each variant carries its OWN intrinsic size — the two files differ
 * (1855x897 vs 1972x954) — so the box is reserved correctly either way and
 * swapping themes costs no layout shift.
 */

const ART = {
    dark: { src: logoDark, width: 1855, height: 897 },
    light: { src: logoLight, width: 1972, height: 954 },
} as const

/** `.theme-light` on <html> is the light hook; its absence IS the dark base. */
function lightSnapshot(): boolean {
    return document.documentElement.classList.contains('theme-light')
}

/** Dark is the un-prefixed design, so it is also the pre-hydration answer. */
function serverSnapshot(): boolean {
    return false
}

function subscribeToThemeClass(onChange: () => void): () => void {
    if (typeof MutationObserver !== 'function') return () => {}
    const observer = new MutationObserver(onChange)
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
    })
    return () => observer.disconnect()
}

export function ThemeLogo({
    className = '',
    alt = 'CleanPlateVA',
}: {
    className?: string
    alt?: string
}) {
    const light = useSyncExternalStore(subscribeToThemeClass, lightSnapshot, serverSnapshot)
    const art = light ? ART.light : ART.dark

    return (
        <div className={`relative inline-flex items-center justify-center ${className}`.trim()}>
            <img
                src={art.src}
                alt={alt}
                width={art.width}
                height={art.height}
                aria-hidden={alt ? undefined : 'true'}
                className="block h-full w-auto max-w-full object-contain"
            />
        </div>
    )
}
