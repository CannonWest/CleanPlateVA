/**
 * The contact dialog (a design decision, 2026-09-17; design ref §6.7) — the
 * one place a visitor can write to the maintainer, opened from the box under
 * About §05.
 *
 * Chrome is §6.5's: Radix `Dialog` in the theme's tokens, a bottom sheet
 * below `sm`, ✕ / backdrop / Escape to leave. The fork is a FORM, not §6.1's
 * decision, so the two actions are Cancel (outlined — a standing control,
 * §6.0) and Send (filled accent, the affirmative, as Settings' Done is).
 *
 * No lede: the title names the dialog and each label carries its own
 * "(required)" (a design decision, 2026-09-17 — the paragraph that said it
 * for all three at once is gone, as §6.5's lede was cut on its first look).
 *
 * Three states, one dialog:
 *   · the form — three required fields, each complaining in place once it
 *     has been asked to (`touched`), never before a visitor has had a
 *     chance to type;
 *   · sending — Send says so and both actions are inert, so a double-click
 *     cannot post twice;
 *   · sent — the form is replaced by an acknowledgement and ONE Close, so
 *     there is nothing left to press twice. A failure keeps the form and its
 *     words, with the reason above the actions: a message that cost the
 *     visitor five minutes must never be swallowed by a bad minute on the
 *     network.
 *
 * Validation is `contact.ts`'s, not the browser's: `noValidate` is on the
 * form because the native bubbles are unthemed, dismiss on scroll and read
 * nothing like the rest of the site. The fields keep their semantic types
 * all the same (`type="email"`), which is what a phone keyboard reads.
 *
 * `trap` is the honeypot — hidden from sight, from the accessible tree and
 * from the tab order, so no person can fill it and a bot that fills every
 * input is answered with a cheerful nothing (see `contact.ts`).
 */

import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { MESSAGE_MAX, SUBJECT_MAX, EMAIL_MAX, sendContact, validateContact } from './contact'
import type { ContactDraft, ContactErrors, ContactField, ContactSender } from './contact'

const EMPTY: ContactDraft = { email: '', subject: '', message: '' }

type Phase = 'form' | 'sending' | 'sent'

/** The shared field chrome: label, control, and the one complaint.
 *
 *  `required` marks the label rather than the form, because the lede that
 *  used to say it for all three at once is gone (a design decision,
 *  2026-09-17): the fact belongs beside the field it constrains, where it is
 *  still there when the visitor reaches that field. It rides INSIDE the
 *  label, so it joins the control's accessible name — "Subject (required)" —
 *  instead of being decoration a screen reader steps past. A prop rather
 *  than a constant: all three fields are required today (`validateContact`),
 *  and an optional one should not have to remove a hard-coded word. */
function Field({ id, label, required, error, hint, children }: {
    id: string
    label: string
    required?: boolean
    error?: string
    hint?: string
    children: React.ReactNode
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-cp-12.5 font-semibold">
                {label}
                {/* A LITERAL space, not a margin: `ml-1` is a visual gap the
                    accessible name does not have, and the label read
                    "Your email address(required)" with one. */}
                {required && <>{' '}<span className="text-cp-11.5 font-normal text-cp-ink-3">(required)</span></>}
            </label>
            {children}
            {error ? (
                <p id={`${id}-error`} className="m-0 text-cp-11.5 text-cp-danger">
                    {error}
                </p>
            ) : hint ? (
                <p id={`${id}-hint`} className="m-0 text-cp-11.5 text-cp-ink-3">
                    {hint}
                </p>
            ) : null}
        </div>
    )
}

// Whole quoted strings, never a class spliced against a `${`: Tailwind v4's
// scanner reads source TEXT and would emit no rule for the glued token while
// React stamped the class on anyway (the 2026-09-06 finding).
const CONTROL = 'w-full rounded-cp-control border border-cp-hairline bg-cp-bg px-2.5 py-2'
    + ' text-cp-13 text-cp-ink outline-none placeholder:text-cp-ink-3'
    + ' focus-visible:border-cp-accent disabled:opacity-60'
const CONTROL_AREA = `${CONTROL} resize-y leading-normal`

export function ContactDialog({ open, onOpenChange, send = sendContact }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Injected by the spec; the real one posts to the Worker. */
    send?: ContactSender
}) {
    const ids = useId()
    const [draft, setDraft] = useState<ContactDraft>(EMPTY)
    const [trap, setTrap] = useState('')
    const [touched, setTouched] = useState<Partial<Record<ContactField, boolean>>>({})
    const [phase, setPhase] = useState<Phase>('form')
    const [failure, setFailure] = useState<string | null>(null)
    const alive = useRef(true)

    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
        }
    }, [])

    // A closed dialog forgets everything: the next visitor to open it is
    // starting a message, not resuming one. (Deliberately NOT persisted —
    // an unsent draft is not worth a storage key, and §6.5's keys are
    // preferences, not content.)
    useEffect(() => {
        if (open) return
        setDraft(EMPTY)
        setTrap('')
        setTouched({})
        setPhase('form')
        setFailure(null)
    }, [open])

    const errors: ContactErrors = validateContact(draft)
    const shown = (field: ContactField): string | undefined =>
        (touched[field] ? errors[field] : undefined)

    const set = (field: ContactField) => (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
        setDraft((d) => ({ ...d, [field]: event.target.value }))
        setFailure(null)
    }
    const blur = (field: ContactField) => () => setTouched((t) => ({ ...t, [field]: true }))

    const submit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (phase === 'sending') return
        // A refused submit asks EVERY field at once — the visitor pressed
        // Send, so they have had their chance to type in all three.
        if (Object.keys(errors).length > 0) {
            setTouched({ email: true, subject: true, message: true })
            return
        }
        setPhase('sending')
        setFailure(null)
        const result = await send(draft, { trap })
        if (!alive.current) return
        if (result.ok) {
            setPhase('sent')
            return
        }
        // The words stay put; only the phase goes back.
        setPhase('form')
        setFailure(result.reason ?? 'The message could not be sent.')
    }

    const sending = phase === 'sending'

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-cp-scrim backdrop-blur-[2px]" />
                <Dialog.Content
                    // The form has no lede any more (the 2026-09-17 cut — the
                    // title names the dialog and each label carries its own
                    // "(required)", as §6.5's dialog has no lede either). The
                    // SENT state's acknowledgement is a real description, so
                    // it stays wired; pointing at an id that is not in the
                    // tree would be worse than pointing at nothing.
                    aria-describedby={phase === 'sent' ? `${ids}-lede` : undefined}
                    className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(86vh,720px)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-cp-card border border-cp-hairline bg-cp-surface-1 px-5 pt-5 pb-4 shadow-cp outline-none max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[92vh] max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none"
                >
                    <Dialog.Close asChild>
                        <button
                            type="button"
                            aria-label="Close"
                            className="absolute top-3.5 right-3.5 text-cp-ink-3 hover:text-cp-ink"
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    </Dialog.Close>
                    <Dialog.Title className="mb-1 text-cp-17 font-bold">
                        {phase === 'sent' ? 'Message sent' : 'Send a message'}
                    </Dialog.Title>

                    {phase === 'sent' ? (
                        <>
                            <p id={`${ids}-lede`} className="mt-1 mb-4 text-cp-13 leading-normal text-cp-ink-2">
                                Thank you — your message is on its way, and a reply will come to
                                the address you gave. CleanPlateVA cannot change an inspection
                                record or a health department's findings; for those, the
                                authorities linked on this page are the ones to write to.
                            </p>
                            <div className="flex justify-end">
                                <Dialog.Close asChild>
                                    <button
                                        type="button"
                                        className="rounded-cp-control bg-cp-accent-solid px-3.5 py-2 text-cp-12.5 font-semibold text-cp-accent-ink"
                                    >
                                        Close
                                    </button>
                                </Dialog.Close>
                            </div>
                        </>
                    ) : (
                        <form noValidate onSubmit={submit} className="mt-2 flex flex-col gap-3.5">
                            <Field
                                id={`${ids}-email`}
                                label="Your email address"
                                required
                                error={shown('email')}
                                hint="Used only to reply to this message."
                            >
                                <input
                                    id={`${ids}-email`}
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    maxLength={EMAIL_MAX}
                                    disabled={sending}
                                    value={draft.email}
                                    onChange={set('email')}
                                    onBlur={blur('email')}
                                    aria-invalid={shown('email') ? true : undefined}
                                    aria-describedby={shown('email') ? `${ids}-email-error` : `${ids}-email-hint`}
                                    className={CONTROL}
                                />
                            </Field>

                            <Field id={`${ids}-subject`} label="Subject" required error={shown('subject')}>
                                <input
                                    id={`${ids}-subject`}
                                    name="subject"
                                    type="text"
                                    required
                                    maxLength={SUBJECT_MAX}
                                    disabled={sending}
                                    value={draft.subject}
                                    onChange={set('subject')}
                                    onBlur={blur('subject')}
                                    aria-invalid={shown('subject') ? true : undefined}
                                    aria-describedby={shown('subject') ? `${ids}-subject-error` : undefined}
                                    className={CONTROL}
                                />
                            </Field>

                            <Field
                                id={`${ids}-message`}
                                label="Message"
                                required
                                error={shown('message')}
                                hint={`${draft.message.trim().length.toLocaleString('en-US')} of ${MESSAGE_MAX.toLocaleString('en-US')} characters.`}
                            >
                                <textarea
                                    id={`${ids}-message`}
                                    name="message"
                                    rows={7}
                                    required
                                    maxLength={MESSAGE_MAX}
                                    disabled={sending}
                                    value={draft.message}
                                    onChange={set('message')}
                                    onBlur={blur('message')}
                                    aria-invalid={shown('message') ? true : undefined}
                                    aria-describedby={shown('message') ? `${ids}-message-error` : `${ids}-message-hint`}
                                    className={CONTROL_AREA}
                                />
                            </Field>

                            {/* The honeypot. Hidden three ways — off-screen, out of the
                                accessible tree, out of the tab order — so only something
                                filling every input reaches it. */}
                            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                                <label htmlFor={`${ids}-trap`}>Website</label>
                                <input
                                    id={`${ids}-trap`}
                                    name="website"
                                    type="text"
                                    tabIndex={-1}
                                    autoComplete="off"
                                    value={trap}
                                    onChange={(e) => setTrap(e.target.value)}
                                />
                            </div>

                            {failure && (
                                <p role="alert" className="m-0 rounded-cp-control border border-cp-danger px-2.5 py-2 text-cp-12.5 text-cp-danger">
                                    {failure}
                                </p>
                            )}

                            <div className="flex items-center justify-end gap-2.5 pt-0.5 max-sm:flex-col-reverse max-sm:items-stretch max-sm:[&>button]:w-full">
                                <Dialog.Close asChild>
                                    <button
                                        type="button"
                                        disabled={sending}
                                        className="rounded-cp-control border border-cp-hairline px-3.5 py-2 text-cp-12.5 font-semibold text-cp-ink-2 hover:bg-cp-surface-3 disabled:opacity-60"
                                    >
                                        Cancel
                                    </button>
                                </Dialog.Close>
                                <button
                                    type="submit"
                                    disabled={sending}
                                    className="rounded-cp-control bg-cp-accent-solid px-3.5 py-2 text-cp-12.5 font-semibold text-cp-accent-ink disabled:opacity-60"
                                >
                                    {sending ? 'Sending…' : 'Send'}
                                </button>
                            </div>
                        </form>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
