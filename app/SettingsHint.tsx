/**
 * The hint under the Settings pill (2026-09-07, a design request): a closeable
 * note that points UP at the pill and says where the theme and the
 * accessibility choices live. **It is the pointer AT the accessibility
 * choices, so it is the one piece of chrome that does not whisper**
 * (design decisions on the first two looks — "make it bigger", then "give
 * the whole shape an outline and make the font BIGGER even on default
 * settings"): 15px ink at medium weight — above the 14px body, where every
 * other floating control sits at 11.5–13 — inside a 2px accent outline
 * that the tip carries too, so the whole shape reads as one object over a
 * busy map rather than a hairline card that blends into it. The accent
 * border is the band's own "look here" signal (an active filter pill, a
 * chosen option in the dialog). It exists because the dialog's one
 * self-opening (App, `settingsSeen`) teaches what the choices ARE and then
 * disappears — a visitor who closes it has no reason to look at a gear
 * again. The hint answers that afterwards: it renders behind the dialog on
 * a first visit and is still there when the scrim goes.
 *
 * Help, not a notification: nothing times it out and nothing animates. It
 * stands on every map view until the visitor closes it or opens Settings
 * themselves (either is the same news — App persists it,
 * `cleanplateva.settingsHintDismissed`). It needs no positioning of its own:
 * App places it in the same column as the pill, and the flex order does the
 * rest. The List / About documents render neither pill nor hint.
 *
 * It points DOWN, from ABOVE the pill, since 2026-09-09 — the day Settings
 * left the band for the bottom-left corner, over the attribution chip. An
 * arrow is only worth drawing if it points at the thing it names, so the tip
 * has followed the gear through all three placements that day: up-and-left
 * under the band's left edge, up-and-right under its right, and now down at
 * a pill below it.
 */

import { X } from 'lucide-react'

export const SETTINGS_HINT_TEXT = 'Theme and accessibility options are in Settings.'

export function SettingsHint({ onDismiss }: { onDismiss: () => void }) {
    return (
        <div
            role="note"
            className="pointer-events-auto relative max-w-[21rem] self-start rounded-cp-card border-2 border-cp-accent bg-cp-surface-1 py-3 pr-11 pl-4 text-cp-15 leading-snug font-medium text-cp-ink shadow-cp"
        >
            {/* The tip: a rotated square hanging off the card's BOTTOM
                edge, centred on the gear of the pill below it — 24px from
                the left, which is the pill's 16px of padding plus half its
                16px glyph. Both numbers are fixed, so the tip stays on the
                gear at every text size; measuring from the other edge could
                not, since the pill's width moves with the word. A square
                turned 45° points DOWN through its bottom and right sides, so
                those are the two it wears, at the card's own 2px; its fill
                covers the outline behind it, and outline and tip read as one
                unbroken shape. */}
            <span
                aria-hidden="true"
                className="absolute -bottom-[7px] left-[18px] h-3 w-3 rotate-45 border-r-2 border-b-2 border-cp-accent bg-cp-surface-1"
            />
            {SETTINGS_HINT_TEXT}
            <button
                type="button"
                aria-label="Dismiss"
                onClick={onDismiss}
                className="absolute top-2 right-2 rounded-[4px] p-1 text-cp-ink-3 hover:text-cp-ink"
            >
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    )
}
