/**
 * /admin — the session page (CPE-M1, design ref frontend-redesign.md §6.6).
 *
 * Reached only at /admin, which has no link anywhere on the site and sits
 * behind a Cloudflare Access application (both the apex and the www host,
 * one-time PIN, Cannon's address alone). This module ships in its own lazy
 * chunk — main.tsx branches here before the app mounts — so a visitor never
 * downloads it.
 *
 * What it does: asks the Worker who is signed in (`GET /admin/api/session`,
 * which verifies the token Access forwarded — src/worker.js) and, on a
 * verified answer, writes the DEVICE FLAG (app/admin/session.ts) that lets
 * the public views render their Edit controls. Reaching this page at all
 * means Access let the browser through; the Worker's answer is the second
 * lock, and the flag is what the rest of the site reads.
 *
 * What it no longer does: edit. The About editor that lived here (#208)
 * is the About view's own edit mode now (app/admin/AboutEditor.tsx, from
 * the Edit control at the document's head); the map's follows at M2.
 */

import { useEffect, useMemo, useState } from 'react'
import { mountFromBaseURI } from '../router'
import { clearSession, persistSession, probeSession, storedSession } from './session'
import type { AdminSession, ProbeResult } from './session'

type PageState =
    | { kind: 'checking' }
    | { kind: 'signed-in'; session: AdminSession }
    | { kind: 'signed-out' }
    | { kind: 'unavailable'; reason: string }

/** Where Access ends the session for this host. */
export const SIGN_OUT_PATH = '/cdn-cgi/access/logout'

export function AdminApp() {
    const mount = useMemo(() => mountFromBaseURI(document.baseURI), [])
    const [state, setState] = useState<PageState>(() => {
        // A flag already on the device shows at once; the probe confirms it.
        const stored = storedSession(window.localStorage)
        return stored ? { kind: 'signed-in', session: stored } : { kind: 'checking' }
    })

    useEffect(() => {
        let alive = true
        void probeSession().then((result: ProbeResult) => {
            if (!alive) return
            if (result.state === 'signed-in') {
                persistSession(window.localStorage, result.session)
                setState({ kind: 'signed-in', session: result.session })
            } else if (result.state === 'signed-out') {
                clearSession(window.localStorage)
                setState({ kind: 'signed-out' })
            } else {
                setState({ kind: 'unavailable', reason: result.reason })
            }
        })
        return () => { alive = false }
    }, [])

    const signOut = () => {
        clearSession(window.localStorage)
        window.location.assign(SIGN_OUT_PATH)
    }

    return (
        <main className="mx-auto max-w-[36rem] px-4 pt-6 pb-8 text-cp-ink">
            <h1 className="text-cp-22 leading-tight font-bold">CleanPlateVA — session</h1>
            <p className="mt-2 text-cp-13 text-cp-ink-2">
                This page is the administrator's sign-in check. It publishes nothing and is not
                linked from the site.
            </p>

            <section className="mt-4 rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-4 shadow-cp" aria-live="polite">
                {state.kind === 'checking' && (
                    <p className="text-cp-13">Checking the session…</p>
                )}
                {state.kind === 'signed-in' && (
                    <>
                        <p className="text-cp-13">
                            Signed in as <strong>{state.session.email}</strong>.
                        </p>
                        <p className="mt-1 text-cp-11.5 text-cp-ink-3">
                            The session ends {fmtExpiry(state.session.exp)}. Edit controls are shown on this
                            device until then.
                        </p>
                    </>
                )}
                {state.kind === 'signed-out' && (
                    <p className="text-cp-13">
                        The session could not be verified. Sign out and sign in again.
                    </p>
                )}
                {state.kind === 'unavailable' && (
                    <p className="text-cp-13">
                        Session verification is not available in this build ({state.reason}).
                    </p>
                )}
            </section>

            <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label="Session">
                <a className={LINK} href={mount}>Map</a>
                <a className={LINK} href={`${mount}about`}>About</a>
                <button type="button" className={`${LINK} ml-auto`} onClick={signOut}>
                    Sign out
                </button>
            </nav>
        </main>
    )
}

const LINK = 'rounded-cp-pill border border-cp-hairline bg-cp-surface-2 px-3.5 py-2 text-cp-13 font-semibold '
    + 'text-cp-ink-2 shadow-cp hover:text-cp-ink'

function fmtExpiry(exp: number): string {
    try {
        return new Date(exp * 1000).toLocaleString(undefined, {
            dateStyle: 'medium', timeStyle: 'short',
        })
    } catch {
        return `at ${exp}`
    }
}
