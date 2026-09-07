/**
 * The one path the editor claims.
 *
 * Its own module, not `router.ts`: /admin is not a VIEW. The router's
 * grammar (three views, their query keys, their normalization) is a public
 * contract with tests to match, and the editor has no business inside it.
 * main.tsx branches on this before the app mounts; everything else about
 * an unknown path is unchanged — it still normalizes to the Map.
 *
 * Kept out of main.tsx so it can be tested without running the bootstrap,
 * and out of AdminApp.tsx so the entry chunk does not pull the editor in
 * just to ask the question.
 */

/** True for the editor's path under `mount` — '/admin', with or without a
 *  trailing slash, in any case. Everything else is false, including
 *  '/admin/anything': the editor has no sub-pages, so a deeper path falls
 *  through to the public app and normalizes to the Map like any unknown
 *  path. The Access application is deliberately WIDER than this — it
 *  covers '/admin' as a prefix — so a deeper path is gated before it can
 *  reach anything, and the two never disagree about what is protected.
 *  ('/administrator' is outside both: Access matches on the segment.) */
export function isAdminPath(pathname: string, mount = '/'): boolean {
    const path = String(pathname || '/')
    const rest = path.startsWith(mount) ? path.slice(mount.length) : path.replace(/^\/+/, '')
    return rest.replace(/\/+$/, '').toLowerCase() === 'admin'
}
