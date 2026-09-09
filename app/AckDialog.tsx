/**
 * The acknowledgement dialog (§6.1, CRVb-M2) — the ratified anatomy: the
 * title alone (no kicker, no lede), the terms as ONE verbatim document
 * (the shared TermsBody — the same component About §05 mounts, C2) in an
 * inset, recessed scroll box with a PERSISTENT scrollbar, and the two
 * decision buttons centered — Decline left (filled red) / Agree right
 * (filled blue), the shipped labels. Filled for the dialog's fork;
 * standing controls elsewhere stay outlined (§6.0).
 *
 * Blocking (first load, D-ACK-1): no close affordance that reads as a
 * third choice — no ✕, backdrop clicks ignored, Escape = decline for
 * THIS page load only (unpersisted; the next load asks again). Zero data
 * requests until answered (C2/C3 — the provider defers the boot).
 * Re-opened (from About §05's declined-side action): an ordinary dialog
 * over the current view — ✕, backdrop, and Escape just close it.
 *
 * Mobile (<sm): a bottom sheet with stacked full-width actions, Agree on
 * top (flex-col-reverse keeps the DOM order Decline-then-Agree).
 */

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { ACK_AGREED, ACK_DECLINED } from './ack'
import { TermsBody } from './TermsBody'
import { ThemeLogo } from './ThemeLogo'

export function AckDialog({ blocking, onDecide, onEscapeDecline, onClose }: {
    blocking: boolean
    /** Agree or Decline — the only two ways a decision persists. */
    onDecide: (value: string) => void
    /** Blocking only: Escape declines for this load, writing nothing. */
    onEscapeDecline: () => void
    /** Non-blocking only: dismiss without deciding. */
    onClose: () => void
}) {
    const dialog = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (blocking) onEscapeDecline()
            else onClose()
        }
        const onFocus = (e: FocusEvent) => {
            if (dialog.current && !dialog.current.contains(e.target as Node)) {
                dialog.current.focus()
            }
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('focusin', onFocus)
        dialog.current?.focus()
        return () => {
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('focusin', onFocus)
        }
    }, [blocking, onEscapeDecline, onClose])

    return (
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-cp-scrim backdrop-blur-[2px]" aria-hidden="true" />
            <div
                className="absolute inset-0 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0"
                onClick={(e) => {
                    if (e.target === e.currentTarget && !blocking) onClose()
                }}
            >
                <div
                    ref={dialog}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="cpAckTitle"
                    tabIndex={-1}
                    className="flex max-h-[min(86vh,720px)] w-[min(41rem,100%)] flex-col rounded-cp-card border border-cp-hairline bg-cp-surface-1 px-5 pt-5 pb-4 shadow-cp outline-none max-sm:max-h-[92vh] max-sm:w-full max-sm:rounded-b-none"
                >
                    {!blocking && (
                        <button
                            type="button"
                            aria-label="Close"
                            onClick={onClose}
                            className="absolute top-3.5 right-3.5 text-cp-ink-3 hover:text-cp-ink"
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    )}
                    <div className="mb-2 flex justify-center">
                        <ThemeLogo className="h-12 w-auto sm:h-14" />
                    </div>
                    <h1 id="cpAckTitle" className="mb-3 text-center text-cp-17 font-bold tracking-[.01em]">
                        Terms of Use and Data Acknowledgment
                    </h1>
                    <div className="min-h-0 w-[min(36rem,100%)] flex-1 self-center rounded-cp-control border border-cp-hairline bg-cp-bg py-1 pr-0.5">
                        <div className="h-full max-h-[46vh] [overflow-y:scroll] px-4 py-2.5 [scrollbar-color:var(--cp-ink-3)_transparent] [scrollbar-width:thin]">
                            <TermsBody />
                        </div>
                    </div>
                    <div className="flex items-center justify-center gap-2.5 pt-4 max-sm:flex-col-reverse max-sm:[&>button]:w-full">
                        <button
                            type="button"
                            onClick={() => onDecide(ACK_DECLINED)}
                            className="rounded-cp-control bg-cp-danger-solid px-3.5 py-2 text-cp-12.5 font-semibold text-white"
                        >
                            Decline and Use Basic Map
                        </button>
                        <button
                            type="button"
                            onClick={() => onDecide(ACK_AGREED)}
                            className="rounded-cp-control bg-cp-accent-solid px-3.5 py-2 text-cp-12.5 font-semibold text-cp-accent-ink"
                        >
                            Agree and View Grades
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
