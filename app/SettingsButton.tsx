/**
 * The settings button (2026-09-06, a design decision): a labeled pill — gear
 * glyph + the word — on the MAP VIEW ONLY; it opens the settings dialog,
 * which holds the theme, the cluster switch and the text size. Obvious, not
 * a buried icon (the M0 review call for the theme control carries
 * over), in the band's own pill chrome so it lightens with the theme.
 *
 * It lives in the map's BOTTOM-LEFT corner, directly over the attribution
 * chip, since 2026-09-09 — a design decision, and the third address it held that
 * day: under the band's left edge (where the theme switch stood until the
 * dialog took the theme, 2026-09-06), then the band's right edge when Layers
 * came off the map's control lane and the two were mirrored, then down here.
 * The corner is where the cluster switch stood until the settings dialog
 * swallowed it, and the box it goes in kept the column shape for exactly
 * this (App's note there). App places it; `self-start` keeps it its own
 * width in a box the wide attribution chip also sits in.
 *
 * The List / About documents render no button — a document is a page of
 * records, and the presentation controls belong with the thing they present.
 * The choices themselves hold on every view (the theme is on <html>, the
 * text scale beside it).
 */

import { Settings } from 'lucide-react'

export function SettingsButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="pointer-events-auto flex flex-none items-center gap-1.5 self-start rounded-cp-pill border border-cp-hairline bg-cp-surface-2 px-4 py-2.5 text-cp-13 font-semibold text-cp-ink-2 shadow-cp hover:text-cp-ink"
        >
            <Settings size={16} aria-hidden="true" />
            Settings
        </button>
    )
}
