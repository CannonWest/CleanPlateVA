/**
 * The theme control (CRVa-M1, Cannon's M0 review call): an actual SWITCH —
 * obvious, not a buried icon button. Under the band's left edge on the
 * MAP VIEW ONLY since 2026-09-06 (Cannon's calls that day, in order:
 * bottom-left corner → beside the band → under it → off the List / About
 * documents), placed by App's top column at 1.5× the corner column's
 * pill. `self-start` keeps it its own width in that column; the band
 * above it stretches. The documents render no switch: the theme lives on
 * <html> and the visitor's choice persists across every view.
 *
 * Its colors are its own, not the theme's: an off-white moon and a yellow
 * sun on a night-slate track. A theme switch is a picture of its two
 * options, and the picture must read the same in either theme — an
 * off-white moon on the light theme's white surface would vanish. The
 * thumb (the disc under the active glyph: the sun for light, the moon for
 * dark) is the state; the other glyph dims. Light is the visitor default
 * (theme.ts); the control asks for the OTHER state on click and never
 * flips itself.
 */

import { Moon, Sun } from 'lucide-react'

/** The glyph colors (Cannon's call 2026-09-06): Open Color gray-1 for the
 *  moon, yellow-5 for the sun — solid (fill + stroke), so each reads as a
 *  body, not an outline. Pinned by tests/vitest/theme-switch.spec.tsx. */
export const MOON_COLOR = '#f1f3f5'
export const SUN_COLOR = '#fcc419'

export function ThemeSwitch({ dark, onTheme }: {
    dark: boolean
    onTheme: (dark: boolean) => void
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label="Dark theme"
            title={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
            onClick={() => onTheme(!dark)}
            className="flex flex-none self-start items-center gap-0 rounded-cp-pill border border-white/10 bg-[#1d2126] p-[5px] shadow-cp"
        >
            <span
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    dark ? 'bg-[#343a40]' : 'opacity-50'
                }`}
            >
                <Moon size={20} color={MOON_COLOR} fill={MOON_COLOR} aria-hidden="true" />
            </span>
            <span
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    dark ? 'opacity-50' : 'bg-cp-accent-solid'
                }`}
            >
                <Sun size={20} color={SUN_COLOR} fill={SUN_COLOR} aria-hidden="true" />
            </span>
        </button>
    )
}
