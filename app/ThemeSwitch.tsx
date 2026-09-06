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
 * The TRACK is chrome — the same surface + hairline the band and the
 * cluster switch wear — so the pill lightens with the theme instead of
 * sitting on the light map as a black slab (Cannon's call 2026-09-06;
 * it was a fixed night slate before, and the dark theme's value is
 * unchanged). The GLYPHS keep colors of their own: a yellow sun in both
 * themes, and a moon that is off-white on the dark track and mid-slate on
 * the light one — one ink per theme, because an off-white moon on a
 * near-white track would vanish. The thumb (the disc under the active
 * glyph: the sun for light, the moon for dark) is the state; the other
 * glyph dims to half. Light is the visitor default (theme.ts); the
 * control asks for the OTHER state on click and never flips itself.
 */

import { Moon, Sun } from 'lucide-react'

/** The glyph inks (Cannon's calls 2026-09-06). The moon is Open Color
 *  gray-1 where it is the ACTIVE glyph on the dark track, and gray-7 where
 *  it is the dimmed one on the light track; the sun is yellow-5 in both,
 *  reading on its blue thumb and dimmed on the dark track alike. Both
 *  glyphs are filled as well as stroked (`currentColor`), so each is a
 *  body, not an outline. The class strings below are the live values —
 *  Tailwind scans source text, so a hex cannot reach the stylesheet
 *  through a constant; these mirror them and are pinned together by
 *  tests/vitest/theme-switch.spec.tsx. */
export const MOON_COLOR = '#f1f3f5'
export const MOON_COLOR_LIGHT = '#495057'
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
            className="flex flex-none self-start items-center gap-0 rounded-cp-pill border border-cp-hairline bg-cp-surface-2 p-[5px] shadow-cp"
        >
            <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[#f1f3f5] light:text-[#495057] ${
                    dark ? 'bg-[#343a40]' : 'opacity-50'
                }`}
            >
                <Moon size={20} fill="currentColor" aria-hidden="true" />
            </span>
            <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[#fcc419] ${
                    dark ? 'opacity-50' : 'bg-cp-accent-solid'
                }`}
            >
                <Sun size={20} fill="currentColor" aria-hidden="true" />
            </span>
        </button>
    )
}
