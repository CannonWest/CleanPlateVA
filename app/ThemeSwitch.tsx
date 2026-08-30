/**
 * The theme control (CRVa-M1, Cannon's M0 review call): an actual SWITCH in
 * the bottom-left corner — obvious, not a buried icon button. Dark is the
 * document default (C10); the thumb slides to the sun for light. Sits just
 * above the attribution footer.
 */

import { Moon, Sun } from 'lucide-react'

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
            className="fixed bottom-10 left-3 z-10 flex items-center gap-0 rounded-cp-pill border border-cp-hairline bg-cp-surface-1 p-[3px] shadow-cp"
        >
            <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    dark ? 'bg-cp-surface-3 text-cp-ink' : 'text-cp-ink-3'
                }`}
            >
                <Moon size={13} aria-hidden="true" />
            </span>
            <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    dark ? 'text-cp-ink-3' : 'bg-cp-accent-solid text-cp-accent-ink'
                }`}
            >
                <Sun size={13} aria-hidden="true" />
            </span>
        </button>
    )
}
