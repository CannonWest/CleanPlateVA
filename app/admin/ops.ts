/**
 * The edit-op model — the pure half of the /admin About editor.
 *
 * The About document (app/AboutView.tsx) is hand-written JSX, not content:
 * there is no data model to point an editor at. So the editor works on the
 * RENDERED DOM and records what was done as a list of ops keyed by the
 * element's position under the About root. Ops live in this device's
 * localStorage and are exported as a handoff — nothing here is published,
 * and no visitor ever loads this module (it ships in the /admin chunk
 * alone, behind Cloudflare Access).
 *
 * Two invariants make the whole thing work:
 *
 *  · A delete HIDES (an attribute this module owns), never removes. React
 *    owns those nodes; removing one risks a reconciliation throw on the
 *    next render, and — the reason that matters here — a removed sibling
 *    would shift every later path and silently re-point every other op.
 *  · A text edit rewrites the element's DIRECT text nodes only, so a badge
 *    like `<span><Icon/>Official record</span>` keeps its icon.
 *
 * Paths are child-index chains ("2/0/1"), which are stable for exactly as
 * long as AboutView.tsx is: a session, and the handoff that follows it.
 * That is why every op also carries a `note` — the tag, class and text as
 * they were when the edit was made — so the export names the element in
 * terms a reader can find in the JSX even if the path has gone stale.
 *
 * Since CPE-M1 (2026-09-08) the paths are anchored on AboutView's OWN root
 * — the `<main>` it renders — not on the editor's host element. Under the
 * first editor (/admin, #208) every path began `0/` because the host's
 * first child WAS that root; now the editor wraps the live document
 * wherever it is mounted, so the anchor had to be the document itself. The
 * storage key moved with it (v1 → v2): a v1 draft's paths are one level
 * deep and would mis-apply.
 */

export interface EditNote {
    tag: string
    className: string
    text: string
}

export type EditOp =
    | { kind: 'delete'; path: string; note: EditNote }
    | { kind: 'text'; path: string; from: string; to: string; note: EditNote }

/** The attribute a hidden element carries. Owned by this module; the
 *  admin stylesheet is what actually hides it. No About element uses it. */
export const HIDDEN_ATTR = 'data-cp-admin-hidden'

/** Versioned per device — bump to abandon a draft shape. v2 (CPE-M1): the
 *  paths anchor on AboutView's root, one level up from v1's. */
export const STORAGE_KEY = 'cleanplateva.admin.about.v2'

const NOTE_TEXT_MAX = 140

export function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

/** `el`'s position under `root` as a child-index chain, or null when `el`
 *  is not a descendant. The root itself is '' — callers treat that as
 *  unselectable rather than as a valid target. */
export function pathOf(root: Element, el: Element): string | null {
    const parts: number[] = []
    let node: Element | null = el
    while (node && node !== root) {
        const parent: Element | null = node.parentElement
        if (!parent) return null
        parts.push(Array.prototype.indexOf.call(parent.children, node))
        node = parent
    }
    if (node !== root) return null
    return parts.reverse().join('/')
}

/** The element a path names, or null when the document no longer has it. */
export function resolvePath(root: Element, path: string): Element | null {
    if (path === '') return root
    let node: Element = root
    for (const segment of path.split('/')) {
        const index = Number(segment)
        if (!Number.isInteger(index) || index < 0) return null
        const next = node.children[index]
        if (!next) return null
        node = next
    }
    return node
}

/** The element's own text — the direct text-node children, ignoring any
 *  nested element's text. This is what a text edit may rewrite. */
export function directText(el: Element): string {
    let out = ''
    for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3) out += node.nodeValue ?? ''
    }
    return normalizeText(out)
}

/** Only elements carrying their own words can have their text edited;
 *  a wrapper's "text" belongs to its children. */
export function isTextEditable(el: Element): boolean {
    return directText(el).length > 0
}

/** Write `value` into the element's direct text nodes: all of it into the
 *  first one that carried words (position preserved), the rest emptied. */
export function setDirectText(el: Element, value: string): void {
    const texts = Array.from(el.childNodes).filter((n) => n.nodeType === 3)
    if (!texts.length) return
    const first = texts.findIndex((n) => normalizeText(n.nodeValue ?? '').length > 0)
    const target = first >= 0 ? first : 0
    texts.forEach((node, i) => {
        node.nodeValue = i === target ? value : ''
    })
}

/** What the element was when an op was recorded — the handoff's anchor. */
export function describeElement(el: Element): EditNote {
    const raw = typeof el.className === 'string' ? el.className : ''
    const text = normalizeText(el.textContent ?? '')
    return {
        tag: el.tagName.toLowerCase(),
        className: normalizeText(raw),
        text: text.length > NOTE_TEXT_MAX ? `${text.slice(0, NOTE_TEXT_MAX)}…` : text,
    }
}

export interface ApplyResult {
    applied: number
    /** Paths that no longer resolve — the JSX moved under the draft. */
    stale: string[]
}

/** Put every op onto the live document. Idempotent: re-running after a
 *  React render is how the draft survives one. */
export function applyOps(root: Element, ops: EditOp[]): ApplyResult {
    const result: ApplyResult = { applied: 0, stale: [] }
    for (const op of ops) {
        const el = resolvePath(root, op.path)
        if (!el || el === root) {
            result.stale.push(op.path)
            continue
        }
        if (op.kind === 'delete') el.setAttribute(HIDDEN_ATTR, '')
        else if (directText(el) !== op.to) setDirectText(el, op.to)
        result.applied += 1
    }
    return result
}

/** Undo everything this module did to the document, in place. `ops` is
 *  needed because a text edit's original lives in the op, not the DOM. */
export function revertOps(root: Element, ops: EditOp[]): void {
    for (const el of Array.from(root.querySelectorAll(`[${HIDDEN_ATTR}]`))) {
        el.removeAttribute(HIDDEN_ATTR)
    }
    for (const op of ops) {
        if (op.kind !== 'text') continue
        const el = resolvePath(root, op.path)
        if (el && el !== root) setDirectText(el, op.from)
    }
}

/** Add `op`, replacing any existing op of the same kind on the same
 *  element. A re-edit of the same text keeps the ORIGINAL `from` AND the
 *  original `note`: the export must describe the shipped JSX, never a
 *  draft. (The first real export, 2026-09-07, carried 14 notes that
 *  described an intermediate draft because only `from` was kept — the
 *  paths and `from` were right, so nothing was lost, but the reader's
 *  anchor was wrong.) */
export function withOp(ops: EditOp[], op: EditOp): EditOp[] {
    const prior = ops.find((o) => o.path === op.path && o.kind === op.kind)
    const next = prior && op.kind === 'text' && prior.kind === 'text'
        ? { ...op, from: prior.from, note: prior.note }
        : op
    return [...ops.filter((o) => !(o.path === op.path && o.kind === op.kind)), next]
}

/** Drop every op on one element (both kinds) — the per-element undo. */
export function withoutPath(ops: EditOp[], path: string): EditOp[] {
    return ops.filter((o) => o.path !== path)
}

export function opsForPath(ops: EditOp[], path: string): EditOp[] {
    return ops.filter((o) => o.path === path)
}

// ── persistence ─────────────────────────────────────────────────────────

interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** A stored draft, or [] for anything unreadable — a private window, a
 *  cleared store, a shape from an older build. */
export function loadOps(storage: Partial<StorageLike> | null | undefined): EditOp[] {
    try {
        const raw = storage?.getItem?.(STORAGE_KEY)
        if (!raw) return []
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(isEditOp)
    } catch {
        return []
    }
}

export function saveOps(storage: Partial<StorageLike> | null | undefined, ops: EditOp[]): void {
    try {
        if (ops.length) storage?.setItem?.(STORAGE_KEY, JSON.stringify(ops))
        else storage?.removeItem?.(STORAGE_KEY)
    } catch {
        // A device that cannot persist still edits for this visit.
    }
}

function isEditOp(value: unknown): value is EditOp {
    if (!value || typeof value !== 'object') return false
    const op = value as Record<string, unknown>
    if (typeof op.path !== 'string') return false
    if (op.kind === 'delete') return true
    return op.kind === 'text' && typeof op.from === 'string' && typeof op.to === 'string'
}

// ── the handoff ─────────────────────────────────────────────────────────

/** The export: what changed, in words a reader can act on, followed by the
 *  machine copy. This is the whole output of the tool — the draft is never
 *  published, so this text is what turns a session into a change. */
export function exportText(ops: EditOp[], now: Date = new Date()): string {
    const stamp = now.toISOString().slice(0, 10)
    if (!ops.length) return `CleanPlateVA About — no edits drafted (${stamp}).\n`

    const deletes = ops.filter((o): o is Extract<EditOp, { kind: 'delete' }> => o.kind === 'delete')
    const texts = ops.filter((o): o is Extract<EditOp, { kind: 'text' }> => o.kind === 'text')
    const lines: string[] = [
        `CleanPlateVA About — ${ops.length} edit${ops.length === 1 ? '' : 's'} drafted ${stamp}`,
        'Target: app/AboutView.tsx. Drafted on one device; nothing is published.',
        'Paths are child-index chains from the document root — the <main> AboutView renders.',
        '',
    ]

    if (deletes.length) {
        lines.push(`DELETE (${deletes.length})`)
        for (const op of deletes) {
            lines.push(`  <${op.note.tag}> "${op.note.text}"`)
            lines.push(`      path ${op.path}${op.note.className ? `  class ${op.note.className}` : ''}`)
        }
        lines.push('')
    }

    if (texts.length) {
        lines.push(`TEXT (${texts.length})`)
        for (const op of texts) {
            lines.push(`  <${op.note.tag}>`)
            lines.push(`      from  ${op.from}`)
            lines.push(`      to    ${op.to}`)
            lines.push(`      path ${op.path}${op.note.className ? `  class ${op.note.className}` : ''}`)
        }
        lines.push('')
    }

    lines.push('--- ops.json ---', JSON.stringify(ops, null, 2), '')
    return lines.join('\n')
}
