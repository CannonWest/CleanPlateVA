// CR app bootstrap (CRF-M0); the served site since CRC (2026-09-06).
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import { App } from './App'
import { mountFromBaseURI } from './router'
import { isAdminPath } from './admin/route'

// /admin is the administrator's session page (CPE-M1; the About editor it
// was until then is the About view's own edit mode now) — no link points at
// it, and the path sits behind a Cloudflare Access application (apex + www).
// It is branched HERE rather than added to the router's views on purpose:
// the three public views, their URL grammar and their tests stay exactly as
// they are, and the page's code leaves the entry chunk entirely, so a
// visitor never downloads it. An unknown path still normalizes to the Map
// the way it always has (router.ts viewFromPath) — only this one segment
// is claimed. (/admin/api/* never reaches this client on the host: it is
// the Worker's — wrangler.jsonc run_worker_first.)
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })))

const root = document.getElementById('root')
if (root) {
    const admin = isAdminPath(window.location.pathname, mountFromBaseURI(document.baseURI))
    createRoot(root).render(
        <StrictMode>
            {admin ? (
                <Suspense fallback={null}>
                    <AdminApp />
                </Suspense>
            ) : (
                <App />
            )}
        </StrictMode>,
    )
}
