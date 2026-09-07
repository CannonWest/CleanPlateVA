/**
 * The hint under the Settings pill (2026-09-07, Cannon's ask): a closeable
 * note that points UP at the pill and says where the theme and the
 * accessibility choices live. **It is the pointer AT the accessibility
 * choices, so it is the one piece of chrome that does not whisper**
 * (Cannon's calls on the first two looks — "make it bigger", then "give
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
 * `cleanplateva.settingsHintDismissed`). Placed by App's top column as the
 * third child under the pill, so it needs no positioning of its own; the
 * List / About documents render neither pill nor hint.
 */

import { X } from 'lucide-react'

export const SETTINGS_HINT_TEXT = 'Theme and accessibility options are in Settings.'

export function SettingsHint({ onDismiss }: { onDismiss: () => void }) {
    return (
        <div
            role="note"
            className="relative max-w-[21rem] self-start rounded-cp-card border-2 border-cp-accent bg-cp-surface-1 py-3 pr-11 pl-4 text-cp-15 leading-snug font-medium text-cp-ink shadow-cp"
        >
            {/* The tip: a rotated square centred under the pill's gear (its
                own centre is 24px in, matching the pill's 16px padding plus
                half the 16px glyph). It wears the same two edges at the
                same 2px, and its fill covers the card's outline behind it,
                so outline and tip read as one unbroken shape. */}
            <span
                aria-hidden="true"
                className="absolute -top-[7px] left-[18px] h-3 w-3 rotate-45 border-t-2 border-l-2 border-cp-accent bg-cp-surface-1"
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
