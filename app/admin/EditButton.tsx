/**
 * The admin's Edit control (CPE-M1, design ref frontend-redesign.md §6.6):
 * a pill in the band's own chrome — the SettingsButton's — reading "Edit",
 * or "Exit edit" while a mode is on. Rendered by App only when this device
 * holds the session flag (app/admin/session.ts); a visitor never sees it.
 * At M1 it stands at the About document's head; M2 seats a second one in
 * the map's top column beside Settings.
 */

import { Pencil, PencilOff } from 'lucide-react'

export function EditButton({ editing, busy = false, onClick }: {
    editing: boolean
    /** A probe is in flight: the click is taken once. */
    busy?: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            aria-pressed={editing}
            className="flex flex-none items-center gap-1.5 self-start rounded-cp-pill border border-cp-hairline bg-cp-surface-2 px-4 py-2.5 text-cp-13 font-semibold text-cp-ink-2 shadow-cp hover:text-cp-ink disabled:opacity-60"
        >
            {editing
                ? <PencilOff size={16} aria-hidden="true" />
                : <Pencil size={16} aria-hidden="true" />}
            {editing ? 'Exit edit' : 'Edit'}
        </button>
    )
}
