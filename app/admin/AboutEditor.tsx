/**
 * The About edit mode (CPE-M1) — the editor that was /admin (#208), now an
 * overlay the public About view enters from its Edit control and leaves
 * with Exit edit. It wraps the LIVE document it is given (the same
 * `AboutView` element App renders, live data and all) and lets an element be
 * clicked, its own words rewritten, or the element hidden. Every change is
 * an op in ./ops.ts, kept in this device's localStorage and exported as
 * text — nothing here publishes, exactly as before.
 *
 * One thing moved with the mount: the ops' paths are anchored on the
 * document's own root — the `<main>` AboutView renders, this host's first
 * element child — rather than on the host. The first editor's exports all
 * began `0/` for that reason; these do not, and ops.ts's storage key went
 * to v2 with it. The document's own links and buttons are inert while the
 * mode is on: the click is captured at the surface before it reaches them.
 *
 * Chrome is the app's own (the theme, the palette and the text size are on
 * <html>, so the overlay follows the visitor's settings); the first
 * editor's Light/Dark switch is gone with its standalone page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
    applyOps, describeElement, directText, exportText, HIDDEN_ATTR, isTextEditable,
    loadOps, opsForPath, pathOf, resolvePath, revertOps, saveOps, withOp, withoutPath,
} from './ops'
import type { EditOp } from './ops'

interface Selection {
    path: string
    tag: string
    text: string
    editable: boolean
}

export function AboutEditor({ children, onExit }: {
    /** The live About document (an `AboutView` element). */
    children: ReactNode
    onExit: () => void
}) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    /** The document's root — the host's first element child — or null while
     *  the lazy document is still arriving. */
    const docRoot = () => hostRef.current?.firstElementChild ?? null

    const [ops, setOps] = useState<EditOp[]>(() => loadOps(window.localStorage))
    const [selection, setSelection] = useState<Selection | null>(null)
    const [draftText, setDraftText] = useState('')
    const [copied, setCopied] = useState(false)
    const [hoverRect, setHoverRect] = useState<DOMRect | null>(null)
    const [selectRect, setSelectRect] = useState<DOMRect | null>(null)
    // A deleted element GHOSTS by default — an editor should show what it
    // is about to remove, and a ghost stays clickable to undo. "Hide
    // deleted" is the other half of the job: seeing the page as it would
    // actually read once the element is gone.
    const [hideDeleted, setHideDeleted] = useState(false)
    const [showExport, setShowExport] = useState(false)

    const commit = useCallback((next: EditOp[]) => {
        setOps(next)
        saveOps(window.localStorage, next)
    }, [])

    // The draft lands on the document after EVERY render — React owns
    // these nodes and re-renders (a roster arriving, a theme flip) restore
    // what it knows. Deliberately dependency-free: cheap, and the only
    // thing that keeps a draft on screen through a re-render.
    useEffect(() => {
        const root = docRoot()
        if (root) applyOps(root, ops)
    })

    // Keep the two outlines glued to their elements while the page moves.
    const measure = useCallback(() => {
        const root = docRoot()
        if (!root) return
        setSelectRect(selection
            ? resolvePath(root, selection.path)?.getBoundingClientRect() ?? null
            : null)
    }, [selection])
    useEffect(() => {
        measure()
        window.addEventListener('scroll', measure, true)
        window.addEventListener('resize', measure)
        return () => {
            window.removeEventListener('scroll', measure, true)
            window.removeEventListener('resize', measure)
        }
    }, [measure])

    const select = useCallback((el: Element) => {
        const root = docRoot()
        if (!root) return
        const path = pathOf(root, el)
        if (path === null || path === '') return
        const existing = opsForPath(ops, path).find((o) => o.kind === 'text')
        const own = directText(el)
        setSelection({
            path,
            tag: el.tagName.toLowerCase(),
            text: describeElement(el).text,
            editable: isTextEditable(el),
        })
        setDraftText(existing && existing.kind === 'text' ? existing.to : own)
        setSelectRect(el.getBoundingClientRect())
    }, [ops])

    // Edit mode owns the pointer: About's own links and tier buttons must
    // not fire while an element is being picked. Capture phase, so the
    // click never reaches the component underneath.
    const onSurfaceClick = useCallback((event: React.MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const target = event.target as Element | null
        if (target && target.nodeType === 1) select(target)
    }, [select])

    const onSurfaceMove = useCallback((event: React.MouseEvent) => {
        const target = event.target as Element | null
        const host = hostRef.current
        if (!target || !host || target.nodeType !== 1 || target === host) {
            setHoverRect(null)
            return
        }
        setHoverRect(target.getBoundingClientRect())
    }, [])

    const selectedOps = selection ? opsForPath(ops, selection.path) : []
    const isDeleted = selectedOps.some((o) => o.kind === 'delete')
    const priorText = selectedOps.find(
        (o): o is Extract<EditOp, { kind: 'text' }> => o.kind === 'text',
    )

    const applyText = () => {
        const root = docRoot()
        if (!root || !selection) return
        const el = resolvePath(root, selection.path)
        if (!el) return
        // The shipped words, not the draft's: re-editing must never make an
        // earlier draft look like the JSX (withOp keeps `from` for the same
        // reason — this is the first-edit case).
        const from = priorText ? priorText.from : directText(el)
        const value = draftText.trim()
        if (!value || value === from) return
        commit(withOp(ops, {
            kind: 'text', path: selection.path, from, to: value, note: describeElement(el),
        }))
    }

    const deleteSelected = () => {
        const root = docRoot()
        if (!root || !selection) return
        const el = resolvePath(root, selection.path)
        if (!el) return
        commit(withOp(ops, { kind: 'delete', path: selection.path, note: describeElement(el) }))
    }

    const undoSelected = () => {
        const root = docRoot()
        if (!root || !selection) return
        revertOps(root, opsForPath(ops, selection.path))
        const next = withoutPath(ops, selection.path)
        commit(next)
        const el = resolvePath(root, selection.path)
        if (el) setDraftText(directText(el))
    }

    const resetAll = () => {
        const root = docRoot()
        if (root) revertOps(root, ops)
        commit([])
        setSelection(null)
    }

    // Leaving puts the document back as React rendered it — the ops stay in
    // storage for the next entry; the visitor-facing page never carried them.
    const exit = () => {
        const root = docRoot()
        if (root) revertOps(root, ops)
        onExit()
    }

    // The export is the tool's ONLY output, so it is always readable on
    // screen; the clipboard is a convenience on top. A blocked or absent
    // clipboard (a pane without focus, an insecure context) must not be
    // the difference between having a session's work and losing it.
    const copyExport = async () => {
        try {
            await navigator.clipboard.writeText(exportText(ops))
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
        } catch {
            setCopied(false)
        }
    }

    return (
        <div className="fixed inset-0 z-40 flex flex-col bg-cp-bg text-cp-ink" data-cp-about-editor="">
            <style>{hideDeleted
                ? `[${HIDDEN_ATTR}]{display:none!important;}`
                : `[${HIDDEN_ATTR}]{outline:2px dashed var(--cp-grade-f);outline-offset:2px;opacity:.28;}`}</style>

            <header className="flex flex-none flex-wrap items-center gap-2.5 border-b border-cp-hairline bg-cp-surface-1 px-3.5 py-2.5">
                <span className="text-cp-13 font-bold">About editor</span>
                <span className="rounded-cp-pill border border-cp-hairline px-2 py-0.5 text-cp-10.5 text-cp-ink-3">
                    draft on this device · nothing published
                </span>
                <span className="text-cp-11.5 text-cp-ink-3">
                    {ops.length} edit{ops.length === 1 ? '' : 's'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        className={hideDeleted ? BTN_ACCENT : BTN}
                        onClick={() => setHideDeleted((v) => !v)}
                        aria-pressed={hideDeleted}
                    >
                        {hideDeleted ? 'Showing without deleted' : 'Hide deleted'}
                    </button>
                    <button type="button" className={BTN} onClick={resetAll} disabled={!ops.length}>
                        Reset all
                    </button>
                    <button type="button" className={BTN_ACCENT} onClick={() => setShowExport(true)} disabled={!ops.length}>
                        Export
                    </button>
                    <button type="button" className={BTN} onClick={exit}>
                        Exit edit
                    </button>
                </div>
            </header>

            {showExport && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-cp-scrim-2 p-6">
                    <div className="flex max-h-full w-full max-w-[760px] flex-col gap-2.5 rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-4 shadow-cp">
                        <div className="flex items-center gap-2.5">
                            <span className="text-cp-13 font-bold">Export</span>
                            <span className="text-cp-11.5 text-cp-ink-3">
                                hand this to Claude to fold into app/AboutView.tsx
                            </span>
                            <div className="ml-auto flex gap-2">
                                <button type="button" className={BTN_ACCENT} onClick={copyExport}>
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                                <button type="button" className={BTN} onClick={() => setShowExport(false)}>
                                    Close
                                </button>
                            </div>
                        </div>
                        <textarea
                            readOnly
                            className="min-h-[320px] w-full flex-1 resize-none rounded-[8px] border border-cp-hairline bg-cp-surface-2 p-2.5 font-mono text-cp-11.5"
                            value={exportText(ops)}
                            onFocus={(e) => e.currentTarget.select()}
                        />
                    </div>
                </div>
            )}

            <div className="flex min-h-0 flex-1">
                <div
                    ref={hostRef}
                    className="min-w-0 flex-1 cursor-crosshair overflow-y-auto"
                    onClickCapture={onSurfaceClick}
                    onMouseMove={onSurfaceMove}
                    onMouseLeave={() => setHoverRect(null)}
                >
                    {children}
                </div>

                <aside className="w-[300px] flex-none overflow-y-auto border-l border-cp-hairline bg-cp-surface-1 px-3.5 py-3">
                    {!selection ? (
                        <p className="text-cp-12.5 leading-normal text-cp-ink-3">
                            Click any element in the document to pick it. Its own words can be
                            rewritten; the element itself can be hidden. Edits persist on this
                            device and are exported as text — <strong>/about is never changed</strong>.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div>
                                <div className="text-cp-10.5 font-semibold tracking-[.07em] text-cp-accent uppercase">
                                    Selected
                                </div>
                                <div className="mt-1 text-cp-13 font-bold">&lt;{selection.tag}&gt;</div>
                                <div className="mt-1 break-words text-cp-11.5 text-cp-ink-3">
                                    {selection.text || '(no text)'}
                                </div>
                                <div className="mt-1 font-mono text-cp-10.5 text-cp-ink-3">
                                    path {selection.path}
                                </div>
                            </div>

                            {isDeleted && (
                                <p className="rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-2.5 py-2 text-cp-11.5">
                                    Marked for deletion.
                                </p>
                            )}

                            {selection.editable && !isDeleted && (
                                <div>
                                    <label className="text-cp-11.5 font-semibold" htmlFor="cp-admin-text">
                                        Text
                                    </label>
                                    <textarea
                                        id="cp-admin-text"
                                        className="mt-1 w-full resize-y rounded-[8px] border border-cp-hairline bg-cp-surface-2 px-2.5 py-2 text-cp-12.5"
                                        rows={5}
                                        value={draftText}
                                        onChange={(e) => setDraftText(e.target.value)}
                                    />
                                    <button type="button" className={`${BTN_ACCENT} mt-2 w-full`} onClick={applyText}>
                                        Apply text
                                    </button>
                                </div>
                            )}

                            {!selection.editable && !isDeleted && (
                                <p className="text-cp-11.5 text-cp-ink-3">
                                    This element has no words of its own — pick the element inside
                                    it to edit text, or hide this one whole.
                                </p>
                            )}

                            {!isDeleted && (
                                <button type="button" className={`${BTN} w-full`} onClick={deleteSelected}>
                                    Delete element
                                </button>
                            )}
                            {!!selectedOps.length && (
                                <button type="button" className={`${BTN} w-full`} onClick={undoSelected}>
                                    Undo edits here
                                </button>
                            )}
                        </div>
                    )}
                </aside>
            </div>

            {hoverRect && <Outline rect={hoverRect} tone="var(--cp-ink-3)" />}
            {selectRect && <Outline rect={selectRect} tone="var(--cp-accent)" />}
        </div>
    )
}

const BTN = 'rounded-cp-pill border border-cp-hairline px-2.5 py-1 text-cp-11.5 font-semibold '
    + 'disabled:opacity-40'
const BTN_ACCENT = 'rounded-cp-pill border border-cp-accent px-2.5 py-1 text-cp-11.5 font-semibold '
    + 'text-cp-accent disabled:opacity-40'

/** A hairline over an element's box — drawn beside the document rather
 *  than on it, so picking never mutates what it is measuring. */
function Outline({ rect, tone }: { rect: DOMRect; tone: string }) {
    return (
        <div
            aria-hidden="true"
            className="pointer-events-none fixed z-50"
            style={{
                top: rect.top, left: rect.left, width: rect.width, height: rect.height,
                outline: `1.5px solid ${tone}`, outlineOffset: '1px',
            }}
        />
    )
}
