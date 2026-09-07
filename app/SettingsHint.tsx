/**
 * The hint under the Settings pill (2026-09-07, Cannon's ask): a small
 * closeable note that points UP at the pill and says where the theme and
 * the accessibility choices live. It exists because the dialog's one
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
            className="relative max-w-[16rem] self-start rounded-cp-card border border-cp-hairline bg-cp-surface-1 py-2 pr-8 pl-3 text-cp-11.5 text-cp-ink-2 shadow-cp"
        >
            {/* The tip: a rotated square under the pill's gear, showing the
                card's own two edges so it reads as one piece of chrome. */}
            <span
                aria-hidden="true"
                className="absolute -top-[5px] left-[22px] h-2 w-2 rotate-45 border-t border-l border-cp-hairline bg-cp-surface-1"
            />
            {SETTINGS_HINT_TEXT}
            <button
                type="button"
                aria-label="Dismiss"
                onClick={onDismiss}
                className="absolute top-1.5 right-1.5 rounded-[4px] p-1 text-cp-ink-3 hover:text-cp-ink"
            >
                <X size={13} aria-hidden="true" />
            </button>
        </div>
    )
}
