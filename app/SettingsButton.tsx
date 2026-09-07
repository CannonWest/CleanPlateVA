/**
 * The settings button (2026-09-06, Cannon's call): a labeled pill — gear
 * glyph + the word — under the band's left edge on the MAP VIEW ONLY,
 * where the theme switch stood; it opens the settings dialog, which now
 * holds the theme, the cluster switch and the text size. Obvious, not a
 * buried icon (Cannon's M0 review call for the theme control carries
 * over), in the band's own pill chrome so it lightens with the theme.
 * App's top column places it (`self-start` keeps it its own width; the
 * band above it stretches); the List / About documents render no button —
 * a document is a page of records, and the presentation controls belong
 * with the thing they present. The choices themselves hold on every view
 * (the theme is on <html>, the text scale beside it).
 */

import { Settings } from 'lucide-react'

export function SettingsButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex flex-none items-center gap-1.5 self-start rounded-cp-pill border border-cp-hairline bg-cp-surface-2 px-4 py-2.5 text-cp-13 font-semibold text-cp-ink-2 shadow-cp hover:text-cp-ink"
        >
            <Settings size={16} aria-hidden="true" />
            Settings
        </button>
    )
}
