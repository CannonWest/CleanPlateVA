/**
 * The residue tripwire (CPX-M2; `node --test` original until CRC, ported to
 * Vitest with the flip, 2026-09-06).
 *
 * Every arc appends what it retired to `docs/architecture-v4.md` §14.1.
 * This test is the mechanical half of that list for THIS repo: it fails when a
 * retired name comes back into live prose or code. The design ref remains the
 * human-readable union — see "What this deliberately does not check" below,
 * because a term-grep bounds residue of *named* things and nothing more.
 *
 * D-CLOSEOUT-1: term lists are per-repo. The site's CI runs this repo alone,
 * so a shared cross-repo file would have to be vendored or fetched — and would
 * silently skip if it were not. cannon-food owns the mirror of this test for
 * its own rows.
 *
 * D-CLOSEOUT-2: a deliberate historical mention escapes with an inline
 * `retired-ok` marker on that line. The exemption then sits where the reason
 * is, and a line that stops being deliberate loses its marker naturally.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')

/**
 * Retired names owned by this repo (§14.1). Deliberately restricted to strings
 * that are dead outright — a deleted symbol, a retired contract, a UI string
 * nobody should ship again. Anything needing context to judge is excluded on
 * purpose; see the bottom of this file.
 */
const RETIRED: { re: RegExp; why: string }[] = [
    // --- contract strings: nothing published is .v3 since 2026-08-18 ---
    { re: /cleanplateva\.[a-z-]+\.v3/, why: 'Contract V4 is the only published contract (D-DATA-8 closed 2026-08-18)' },

    // --- CPF: the Access era ---
    // The Access header's NAME left this list 2026-09-08 (CPE-M1, D-CPE-1): the
    // header is live again as the identity check on /admin/api/* — one
    // operator's route, never a tier boundary. The full channel still reads
    // no header (worker-cache-contract.spec.ts pins that directly).
    { re: /data-full\/signin/, why: 'the signin route was removed from the Worker (CPF-M2)' },
    { re: /signInBtn/, why: 'replaced by #ackTermsBtn (CPF-M1)' },
    { re: /cp-signin-label/, why: 'replaced by .cp-ack-label (CPF-M1)' },
    { re: /Sign in to view inspection detail/, why: 'there is no sign-in (CPF-M1)' },
    { re: /Public finder(?! contract)/, why: 'the public name is "basic map" (CPF-M1)' },
    { re: /Authenticated archive/, why: 'the public name is "inspection grades" (CPF-M1)' },
    { re: /Detecting data tier/, why: 'the live card states the answer on file (CPF-M1)' },
    { re: /Not exposed publicly/, why: 'the Lite footer reads manifest.freshness.newest_report (CPD-M3)' },
    { re: /Show inspection grades/, why: 'the affordance is "View Grades" / "Terms" (CPF-M1)' },
    { re: /Access-gated/, why: '/data-full/* is public behind the ack (CPF-M2/M3)' },
    { re: /browser-private/, why: 'cache-control is public since CPF-M2' },
    { re: /private,\s*max-age/, why: 'cache-control is public since CPF-M2' },
    { re: /CleanPlateVA full data/, why: 'the Access application was deleted 2026-08-17 (CPF-M3)' },

    // --- CPD: the roster shapes ---
    { re: /trendInspections/, why: 'the roster tuple decoder is gone (CPD-M3)' },
    { re: /_trend_event/, why: 'the roster trend stream is gone (CPD-M3)' },
    { re: /_geoNote\(source\)/, why: '_geoNote takes the facility now (CPD-M3)' },

    // --- CPH: the request diet ---
    { re: /prefetchDetail/, why: 'the hover card renders from the overlay row (CPH-M2)' },
    { re: /prefetch(?:ed)? on hover/, why: 'a hover costs zero requests (CPH-M2)' },
    { re: /no dwell/, why: 'D-DATA-10 was superseded by D-DATA-13 (CPH)' },
    { re: /publicDataCacheControl/, why: 'public/_headers carries /data/* cache-control (CPH-M3)' },
    { re: /looksLikeAsset/, why: 'the Worker sheds asset classification (CPH-M3)' },
    { re: /isSpaFallback/, why: 'the client treats an HTML answer on a data path as a miss (CPH-M3)' },

    // --- CPR ---
    { re: /CAP = 600/, why: 'the List tail is load-more, 50 per chunk (CPR-M1b)' },

    // --- the ZIP select, folded into the search box (2026-08-18) ---
    { re: /foodZipFilter/, why: 'the ZIP select is retired; one search box matches name/address/city and ZIP by prefix' },
    { re: /_populateZipFilter/, why: 'nothing populates a select that no longer exists' },
    { re: /All zips/, why: 'the empty option is gone along with the select' },

    // --- retired test files ---
    { re: /data-client-v3\.test\.mjs/, why: 'replaced by the data-client-v4 suite (CPD-M3)' },

    // --- CRC (2026-09-06): the no-build client, its dev server and its runner ---
    { re: /cdn\.jsdelivr\.net/, why: 'no CDN host — the Vite build vendors every dependency first-party (CRC)' },
    { re: /bootstrap-icons/, why: 'Lucide, inlined and tree-shaken; the icon font is gone (CRC)' },
    { re: /data-bs-theme/, why: 'Bootstrap is gone; the theme is .theme-light on <html> over the dark CSS base (CRC)' },
    { re: /static\/css\/style\.css/, why: 'app/theme.css (CRC)' },
    { re: /static\/js\//, why: 'the shipped client is the Vite build from index.html + app/ (CRC)' },
    { re: /dashboard\.mjs/, why: 'Vitest imports the modules; the concatenated-source shim died with the module graph it shimmed (CRC)' },
    { re: /python app\.py/, why: 'dev is `npm run dev`; the Flask dev server retired (CRC)' },
    { re: /node --test|test:node/, why: 'Vitest is the one runner (CRC)' },
    { re: /wrangler\.preview\.jsonc|cleanplateva-preview/, why: 'the dual-track preview retired at CRC-M2 (2026-09-06); production serves dist/' },

    // --- CRX (2026-09-06): the dev tool that imported the deleted client ---
    { re: /visits-crosscheck\.mjs/, why: 'deleted at CRX-M1 — it imported the old client\'s presentation.js + dataClient.js; tests/vitest/visits-parity.spec.ts pins the derivation' },

    // --- post-CR (2026-09-06): the grade letters left the map ---
    { re: /food-point-letters|LYR_POINT_LETTERS/, why: "the letters layer is deleted; the dot is grade color + ring alone (Cannon's call 2026-09-06)" },
    { re: /LETTER_ZOOM|LETTER_TEXT_SIZE/, why: "the letters' zoom gate and text size went with the layer that read them" },
]

const SCAN_DIRS = ['docs', 'src', 'public', 'tests', 'app']
const SCAN_FILES = ['README.md', 'wrangler.jsonc', '.gitignore', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json']
const TEXT = /\.(md|mjs|js|json|jsonc|html|css|py|yml|yaml|toml|ts|tsx)$/

/** Generated prepared-data trees are not prose. */
const SKIP_DIR = (rel: string) =>
    rel.startsWith(join('public', 'data')) ||
    rel.includes(`${sep}node_modules${sep}`) ||
    rel.endsWith('node_modules')

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const rel = relative(ROOT, full)
        if (SKIP_DIR(rel)) continue
        const st = statSync(full)
        if (st.isDirectory()) walk(full, out)
        else if (TEXT.test(name)) out.push(full)
    }
    return out
}

/**
 * History is allowed to say old words: §13 (History) and §14.1 (the list
 * itself) of the constitution, and §11 (History) of the design reference.
 * Computed from the headings so the ranges cannot drift out of date; a
 * heading that goes missing fails loudly rather than exempting the file.
 */
function headingLine(lines: string[], prefix: string): number {
    const index = lines.findIndex((line) => line.startsWith(prefix))
    assert.ok(index >= 0, `heading ${JSON.stringify(prefix)} not found`)
    return index + 1
}

const EXEMPT_RANGES: Record<string, (lines: string[]) => [number, number][]> = {
    [join('docs', 'architecture-v4.md')]: (lines) => [
        [headingLine(lines, '## 13.'), headingLine(lines, '## 14.') - 1],
        [headingLine(lines, '### 14.1'), headingLine(lines, '## 15.') - 1],
    ],
    [join('docs', 'frontend-redesign.md')]: (lines) => {
        const start = headingLine(lines, '## 11.')
        const next = lines.findIndex((line, i) => i >= start && line.startsWith('## '))
        return [[start, next >= 0 ? next : lines.length]]
    },
}

test('no retired vocabulary in live prose or code (design ref §14.1)', () => {
    const files = [
        ...SCAN_FILES.map((f) => join(ROOT, f)),
        ...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))),
    ]
    const selfRel = relative(ROOT, fileURLToPath(import.meta.url))
    const findings: string[] = []

    for (const file of files) {
        const rel = relative(ROOT, file)
        if (rel === selfRel) continue               // this file names them all by definition
        const lines = readFileSync(file, 'utf8').split('\n')
        const exempt = EXEMPT_RANGES[rel]?.(lines) ?? []

        lines.forEach((line, i) => {
            const n = i + 1
            if (line.includes('retired-ok')) return   // D-CLOSEOUT-2
            if (exempt.some(([lo, hi]) => n >= lo && n <= hi)) return
            for (const { re, why } of RETIRED) {
                const m = line.match(re)
                if (m) findings.push(`${rel}:${n}  ${JSON.stringify(m[0])} — ${why}`)
            }
        })
    }

    assert.deepEqual(findings, [],
        `Retired vocabulary is back in live files:\n\n  ${findings.join('\n  ')}\n\n` +
        'Either the prose is stale and should be rewritten, or the mention is a\n' +
        'deliberate historical one — in which case add a `retired-ok` marker to\n' +
        'that line and say why. New retirements go in docs/architecture-v4.md\n' +
        '§14.1 first, then here.')
})

/*
 * What this deliberately does not check, and why — the honest boundary.
 *
 * These §14.1 rows need context a regex cannot supply, so they stay with the
 * design ref as the human-readable union rather than becoming false failures:
 *
 *  - `signals/`, `facilities.json`, `Contract V3` — live guard code must name
 *    the old thing in order to refuse it, and the dated milestone logs record
 *    what was true when they were written.
 *  - roster-level `latest_assessment` / `newly_permitted` / `open_repeat` —
 *    retired from the ROSTER only. The detail keeps them, so the bare field
 *    name is correct V4 code in most places it appears.
 *  - `#about` — the legacy-hash migration is the shipped replacement.
 *  - `run_worker_first`, `/data/finder/*` — the config key and the URL are
 *    live; only particular values and the `_headers` splat rule were retired.
 *    `worker-cache-contract.spec.ts` pins the values directly, which is a
 *    stronger check than a vocabulary grep.
 *  - `UNION-9` — correct wherever it is written "UNION-9 + visits".
 *  - `app.py` bare, `index.html`, `style.css` bare — live words: `index.html`
 *    is the Vite entry, and the constitution's decision rows quote the files
 *    they retired. Only the dead-outright forms (`python app.py`, the
 *    `static/js/` and `static/css/style.css` paths) are listed.
 *  - `next.cleanplateva.com` — the dual-track preview's hostname survives in
 *    dated receipts (design ref §3, §8, §9.1); its config file and Worker
 *    name were the dead-outright strings and are listed above (CRC-M2).
 *
 * And the class it cannot catch at all: prose built entirely from live
 * vocabulary that describes a world which changed. CPX-M0 finding F5 — the
 * CannonAI Food tab called ?tier=lite "what anonymous visitors see" while
 * containing not one term from this list.
 */
