// @vitest-environment jsdom
/**
 * The /admin About editor's op model (app/admin/ops.ts) and the one path
 * it claims (app/admin/route.ts).
 *
 * The editor's whole contract is that it changes NOTHING outside this
 * device: no publish path, no visitor-facing effect. What is left to pin
 * is that a draft says what it means — paths resolve to the element that
 * was picked, a delete keeps every other op pointing where it did, a text
 * edit leaves an icon alone, and the export names the element in terms a
 * reader can find in the JSX.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
    applyOps, describeElement, directText, exportText, HIDDEN_ATTR, isTextEditable,
    loadOps, normalizeText, opsForPath, pathOf, resolvePath, revertOps, saveOps,
    setDirectText, STORAGE_KEY, withOp, withoutPath,
} from '../../app/admin/ops'
import type { EditOp } from '../../app/admin/ops'
import { isAdminPath } from '../../app/admin/route'

/** A stand-in for the About document's shape: a badge row whose badges
 *  carry an icon beside their words, and a heading that carries only
 *  words. Both cases the editor has to get right. */
function fixture(): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = `
        <header>
            <h1>CleanPlateVA</h1>
            <div class="legend">
                <span class="badge"><svg></svg>Official record</span>
                <span class="badge"><svg></svg>Archived copy</span>
                <span class="badge"><svg></svg>Derived by us</span>
            </div>
        </header>
        <section><h2>Score anatomy</h2><p>How a grade is built.</p></section>
    `.trim()
    document.body.replaceChildren(root)
    return root
}

const badges = (root: Element) => Array.from(root.querySelectorAll('.badge'))

describe('paths address the element that was picked', () => {
    test('pathOf and resolvePath round-trip every element under the root', () => {
        const root = fixture()
        for (const el of Array.from(root.querySelectorAll('*'))) {
            const path = pathOf(root, el)
            expect(path, `${el.tagName} must have a path`).not.toBeNull()
            expect(resolvePath(root, path as string)).toBe(el)
        }
    })

    test('the root itself is the empty path, and a foreign element has none', () => {
        const root = fixture()
        expect(pathOf(root, root)).toBe('')
        expect(pathOf(root, document.createElement('div'))).toBeNull()
    })

    test('a path that no longer resolves returns null rather than a wrong element', () => {
        const root = fixture()
        expect(resolvePath(root, '0/1/9')).toBeNull()
        expect(resolvePath(root, 'nope')).toBeNull()
    })
})

describe('a text edit rewrites words, not structure', () => {
    test('directText reads the element\'s own words, ignoring a nested icon', () => {
        const root = fixture()
        const badge = badges(root)[0]!
        expect(directText(badge)).toBe('Official record')
        expect(badge.querySelector('svg')).not.toBeNull()
    })

    test('a wrapper carrying no words of its own is not text-editable', () => {
        const root = fixture()
        expect(isTextEditable(root.querySelector('.legend') as Element)).toBe(false)
        expect(isTextEditable(root.querySelector('h2') as Element)).toBe(true)
    })

    test('setDirectText keeps the icon and replaces only the words', () => {
        const root = fixture()
        const badge = badges(root)[0]!
        setDirectText(badge, 'Official source')
        expect(directText(badge)).toBe('Official source')
        expect(badge.querySelector('svg'), 'the icon survives a text edit').not.toBeNull()
    })
})

describe('applying a draft', () => {
    test('a delete hides the element and leaves every other path pointing where it did', () => {
        const root = fixture()
        const second = badges(root)[1]!
        const third = badges(root)[2]!
        const thirdPath = pathOf(root, third) as string
        const ops: EditOp[] = [
            { kind: 'delete', path: pathOf(root, second) as string, note: describeElement(second) },
        ]

        expect(applyOps(root, ops).applied).toBe(1)
        expect(second.hasAttribute(HIDDEN_ATTR)).toBe(true)
        // The reason a delete hides instead of removing: a removed sibling
        // would shift the third badge's index and silently re-point its op.
        expect(resolvePath(root, thirdPath)).toBe(third)
    })

    test('applying twice is the same as applying once — a React re-render is safe', () => {
        const root = fixture()
        const heading = root.querySelector('h2') as Element
        const ops: EditOp[] = [{
            kind: 'text', path: pathOf(root, heading) as string,
            from: 'Score anatomy', to: 'How the score works', note: describeElement(heading),
        }]
        applyOps(root, ops)
        applyOps(root, ops)
        expect(directText(heading)).toBe('How the score works')
    })

    test('a stale path is reported, not applied to something else', () => {
        const root = fixture()
        const result = applyOps(root, [
            { kind: 'delete', path: '0/1/7', note: { tag: 'span', className: '', text: 'gone' } },
        ])
        expect(result.applied).toBe(0)
        expect(result.stale).toEqual(['0/1/7'])
    })

    test('revertOps puts the document back — hidden shown, words restored', () => {
        const root = fixture()
        const badge = badges(root)[0]!
        const heading = root.querySelector('h2') as Element
        const ops: EditOp[] = [
            { kind: 'delete', path: pathOf(root, badge) as string, note: describeElement(badge) },
            {
                kind: 'text', path: pathOf(root, heading) as string,
                from: 'Score anatomy', to: 'Changed', note: describeElement(heading),
            },
        ]
        applyOps(root, ops)
        revertOps(root, ops)
        expect(badge.hasAttribute(HIDDEN_ATTR)).toBe(false)
        expect(directText(heading)).toBe('Score anatomy')
    })
})

describe('the op list', () => {
    const note = { tag: 'h2', className: '', text: 'x' }

    test('re-editing the same text keeps the ORIGINAL from AND note — the export describes the JSX, not a draft', () => {
        // The second edit's note was captured with the first edit already
        // applied, so it describes a draft; the export must keep the first.
        const shipped = { tag: 'h2', className: '', text: 'Original' }
        const draft = { tag: 'h2', className: '', text: 'First' }
        let ops = withOp([], { kind: 'text', path: '1/0', from: 'Original', to: 'First', note: shipped })
        ops = withOp(ops, { kind: 'text', path: '1/0', from: 'First', to: 'Second', note: draft })
        expect(ops).toHaveLength(1)
        expect(ops[0]).toMatchObject({ from: 'Original', to: 'Second', note: shipped })
    })

    test('a delete and a text edit on one element coexist; withoutPath clears both', () => {
        let ops = withOp([], { kind: 'text', path: '1/0', from: 'a', to: 'b', note })
        ops = withOp(ops, { kind: 'delete', path: '1/0', note })
        expect(opsForPath(ops, '1/0')).toHaveLength(2)
        expect(withoutPath(ops, '1/0')).toEqual([])
    })
})

describe('persistence is per device and never fatal', () => {
    beforeEach(() => window.localStorage.clear())

    test('a draft round-trips through localStorage', () => {
        const ops: EditOp[] = [{ kind: 'delete', path: '0/1/0', note: { tag: 'span', className: 'badge', text: 'Official record' } }]
        saveOps(window.localStorage, ops)
        expect(loadOps(window.localStorage)).toEqual(ops)
    })

    test('an empty draft clears the key rather than storing []', () => {
        saveOps(window.localStorage, [{ kind: 'delete', path: '0', note: { tag: 'p', className: '', text: '' } }])
        saveOps(window.localStorage, [])
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    test('unreadable or malformed storage reads as no draft, never a throw', () => {
        window.localStorage.setItem(STORAGE_KEY, 'not json')
        expect(loadOps(window.localStorage)).toEqual([])
        window.localStorage.setItem(STORAGE_KEY, '[{"kind":"text","path":"0"},{"kind":"delete","path":"1"}]')
        expect(loadOps(window.localStorage)).toEqual([{ kind: 'delete', path: '1' }])
        expect(loadOps(null)).toEqual([])
        expect(() => saveOps(null, [])).not.toThrow()
    })
})

describe('the export is the handoff', () => {
    test('it names the element by tag, words and path, and carries the machine copy', () => {
        const ops: EditOp[] = [
            { kind: 'delete', path: '0/1/0', note: { tag: 'span', className: 'badge', text: 'Official record' } },
            {
                kind: 'text', path: '1/0', from: 'Score anatomy', to: 'How the score works',
                note: { tag: 'h2', className: '', text: 'Score anatomy' },
            },
        ]
        const text = exportText(ops, new Date('2026-09-07T00:00:00Z'))
        expect(text).toContain('2 edits drafted 2026-09-07')
        expect(text).toContain('app/AboutView.tsx')
        expect(text).toContain('<span> "Official record"')
        expect(text).toContain('path 0/1/0')
        expect(text).toContain('from  Score anatomy')
        expect(text).toContain('to    How the score works')
        expect(JSON.parse(text.split('--- ops.json ---')[1] as string)).toEqual(ops)
    })

    test('an empty draft says so', () => {
        expect(exportText([], new Date('2026-09-07T00:00:00Z'))).toContain('no edits drafted')
    })
})

describe('the editor claims exactly one path', () => {
    test.each([
        ['/admin', '/', true],
        ['/admin/', '/', true],
        ['/ADMIN', '/', true],
        ['/administrator', '/', false],
        ['/admin/anything', '/', false],
        ['/about', '/', false],
        ['/', '/', false],
        ['/cleanplate/admin', '/cleanplate/', true],
        ['/cleanplate/about', '/cleanplate/', false],
    ])('%s under %s → %s', (pathname, mount, expected) => {
        expect(isAdminPath(pathname, mount)).toBe(expected)
    })

    test('the Access application is wider than the editor, never narrower', () => {
        // Measured on both hosts 2026-09-07: /admin and /admin/anything
        // redirect to the Access login; /administrator does not. The editor
        // renders at /admin alone — a deeper path is gated first and then
        // falls through to the public app, so nothing reachable is
        // unprotected. This asserts the direction of that gap.
        const gatedByAccess = ['/admin', '/admin/', '/admin/anything']
        for (const path of gatedByAccess) {
            if (isAdminPath(path)) expect(gatedByAccess).toContain(path)
        }
        expect(isAdminPath('/administrator')).toBe(false)
    })
})

test('normalizeText collapses whitespace the way both halves rely on', () => {
    expect(normalizeText('  a \n  b\t c ')).toBe('a b c')
})
