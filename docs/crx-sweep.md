# CRX-M0 — the sweep, measured (2026-09-06)

The CR program's close-out arc (CRX, `c-ground-code/runway/cleanplate-close-out.md`) opens by measuring, not rewriting: every CRC retired-vocabulary row and every candidate present-tense phrase printed against the corpus the arc owns, each hit classified from its own line, nothing changed yet. This is that record. M1 acts on §4; M2 closes on §5. The design reference's §9.3 carries the summary.

## 1. Method

- **Patterns.** The nine CRC rows verbatim from `tests/vitest/retired-vocabulary.spec.ts` (the site's list as of the flip), plus twelve candidate phrases for the class a regex cannot own — "no build step", "until CRC", the bare dev-server and runner names, the preview's hostname, the old client's names, the retired suites' file names. A phrase hit is a question, never a verdict; §3 answers each by reading the line.
- **Corpus.** The tracked files of the `cground-skills` checkout (`git ls-files`: 20,057 files; the text suffixes the Tier-0 tripwire scans, plus `.html/.css/.ts/.tsx`), bucketed into `c-ground-code/**`, `cannon-food/**` and *the rest of the checkout* (awareness only — no tripwire scans it); this repo's `README.md` (the site tripwire already holds `docs/`, `app/`, `src/`, `tests/`, `public/` green); the workspace `.claude/launch.json` (untracked; the dev-server launch entries).
- **Exemptions, as the Tier-0 tripwire applies them** (`cannon-food/tests/test_retired_vocabulary.py`; architecture-v4 §14.1): `c-ground-code/memory/**`, `runway/archive/**`, `runway/HISTORY.md`; `cannon-food/references/retros/**`, `data/**`. Exempt hits are counted, not dropped — they are what M2's identity-card rewrite inherits (§5).
- **Mechanics.** `git grep -nIP` with every pattern OR'd generated the candidate lines (instant over 20k tracked files; a Python walk of the same set ran past five minutes and was killed — `feedback_search_scope_exclude_venvs`); every pattern was then re-applied per line, so each record names the regex that matched; only files with hits were opened, for a ±5-line window that flags a nearby CleanPlateVA / cannon-food word. 446 records; 216 live, 230 exempt (memory 35 · runway archive 176 · HISTORY 17 · retros 2). The same `git grep` per pattern reproduces every count below.

## 2. Counts — pattern × scope

Live = not exempt by policy; `(+n)` = exempt hits in that scope. "Rest" is everything in the checkout outside the two owned scopes; "README" this repo's. The verdict column is what M1 takes (§4).

| kind | pattern (regex) | c-ground-code | cannon-food | rest | README | verdict |
|---|---|---|---|---|---|---|
| row | `cdn\.jsdelivr\.net` | 1 | 0 | 0 | 0 | row as-is — the one live hit is the CRX charter naming it | <!-- retired-ok: CRX-M0 inventory -->
| row | `bootstrap-icons` | 1 (+2) | 0 | 0 | 0 | row as-is — charter only | <!-- retired-ok: CRX-M0 inventory -->
| row | `data-bs-theme` | 1 (+1) | 0 | 0 | 0 | row as-is — charter only | <!-- retired-ok: CRX-M0 inventory -->
| row | `static/css/style\.css` | 2 (+2) | 0 | 2 | 0 | **narrow to `public/static/css/style\.css`** (0 live): the bare form is CannonAI's own stylesheet path | <!-- retired-ok: CRX-M0 inventory -->
| row | `static/js/` | 30 (+53) | 3 (+1) | 8 | 0 | **narrow** (§4.1): 28 of the 30 are CannonAI's `cannonai/gui/static/js/**`, live; the 3 cannon-food hits are real | <!-- retired-ok: CRX-M0 inventory -->
| row | `dashboard\.mjs` | 2 (+5) | 0 | 0 | 0 | row as-is — charter only | <!-- retired-ok: CRX-M0 inventory -->
| row | `python app\.py` | 1 (+1) | 0 | 0 | 0 | row as-is — charter only | <!-- retired-ok: CRX-M0 inventory -->
| row | `node --test\|test:node` | 3 (+11) | 1 | 0 | 0 | row as-is — charter ×3 + one dated milestone line (marker) | <!-- retired-ok: CRX-M0 inventory -->
| row | `wrangler\.preview\.jsonc\|cleanplateva-preview` | 1 (+12) | 0 | 0 | 0 | row as-is — charter only; the 12 exempt are the memory card + archive | <!-- retired-ok: CRX-M0 inventory -->
| phrase | `\bno[- ]build\b` | 2 (+8) | 0 | 3 | 1 | **0 stale** — charter ×2, README's is past tense, the rest are other projects. The unbounded form also matched "no building" (`venue_anchor.py:83`): the bound is load-bearing |
| phrase | `(until\|before\|pending\|awaiting) (CRC\|the flip)`, `CRC's flip`, `pre-flip` | 3 (+13) | 0 | 1 | 0 | **0 stale** — charter, plus two dated past-tense lines the regex cannot tell from future tense ("CRC pre-flip", "the CRC flip") |
| phrase | `\bapp\.py\b` (bare) | 4 (+15) | 0 (+1) | 17 | 0 | **0 stale** in CleanPlateVA context — charter ×4; the 17 are api-oracle's own `app.py` |
| phrase | `(old\|legacy\|no-build) client`, `production still serves` | 2 (+21) | 0 | 0 | 1 | **0 stale** — charter ×2; README's names the deletion |
| phrase | `next\.cleanplateva\.com` | 1 (+12) | 0 | 0 | 0 | **0 stale** — charter; 12 dated exempt (memory card, archive) |
| phrase | `dual[- ]track`, `preview Worker` | 3 (+8) | 0 | 11 | 0 | **0 stale** — charter ×3; the 11 are iran-war "dual track" and api-oracle "preview" |
| phrase | `\bBootstrap\b`, `jsDelivr` (bare) | 10 (+9) | 0 | 22 | 0 | **rejected** — CannonAI's Bootstrap 5 and the English word (CouchDB replication bootstrap); nothing CleanPlateVA |
| phrase | `foodDashboard\.js` | 2 (+22) | 3 | 0 | 0 | **promote to a row** (§4.1): dead outright in both projects now — CannonAI #300 deleted its own 2026-07-18, the flip deleted the site's; 2 rewrites, 3 dated mentions |
| phrase | `\.test\.mjs` | 0 (+27) | 3 | 0 | 0 | **promote the exact form** `lite-roster-contract\.test\.mjs` (§4.1): all 3 are real, one of them code |
| phrase | `:5001`, `port 5001` | 0 (+1) | 0 | 0 | 0 | nothing live |
| phrase | `tests/support/` | 0 (+3) | 0 | 0 | 0 | nothing live |
| phrase | `requirements\.txt` | 21 (+2) | 0 | 50 | 0 | **rejected** — every hit is another project's; the site's went with the flip and nothing outside it named it |

**Read across:** the feared present-tense sentences — "no build step", "the no-build client keeps serving until CRC", "`app.py` is the dev server", "`node --test` runs the suites" — have **zero live instances** outside the CRX charter itself (the runway row and briefing, which name what they sweep). What the sweep did find is smaller and sharper: eight stale lines in cannon-food, one CannonAI-side sentence in c-ground-code, two README sentences the regexes could not see, **and two live invocations of files the flip deleted** — one in cannon-food's publisher, one in this repo's `tools/` — which no tripwire scans (§3.4). <!-- retired-ok: CRX-M0 inventory — the read-across names the sentences it measured -->

## 3. The hits, classified

Classes: **rewrite** (stale, M1 fixes it) · **marker** (a deliberate dated mention — `retired-ok` on the line at M1) · **self** (the CRX charter naming what it sweeps — markers at M1, gone at M2 when the briefing archives) · **live-other** (another project's live vocabulary; not a hit, but the evidence for narrowing a row) · **code** (a live invocation of a deleted file — not prose; a call, §4.3) · **exempt** (by policy; §5).

### 3.1 cannon-food — 10 live records in 7 files

| File | Line | Match | Class | Note |
|---|---|---|---|---|
| `scripts/cf_publish_cleanplate.py` | 618 | `lite-roster-contract.test.mjs` | **code** | `_stream(["node", "--test", "tests/lite-roster-contract.test.mjs"], cwd=site)` — the Lite contract gate runs a file the flip deleted (`tests/lite-roster-contract.test.mjs` → `tests/vitest/lite-roster-contract.spec.ts`). `_stream` raises `PublicationError` on a non-zero exit, so every publish halts at phase `lite_contract` from the first post-flip run; the last publish was 2026-09-05 09:26 (pre-flip), the nightly fires `0 20 * * *`. `tests/test_publish_cleanplate.py` pins the phase, not the command. §4.3. | <!-- retired-ok: CRX-M0 inventory -->
| `references/operations.md` | 386 | `lite-roster-contract.test.mjs` | rewrite | "its guard lives there: `tests/lite-roster-contract.test.mjs` pins…" → the Vitest spec by name; "CI runs it on every PR" stays true |
| `routines/food-log-update.md` | 305 | `lite-roster-contract.test.mjs` | rewrite | the orchestrator description names the deleted suite; follows the publisher fix |
| `references/script-surface.md` | 1310 | `node --test` | marker | "vitest 181 (+5) · node --test 292" — a dated milestone-log line, correct about its moment | <!-- retired-ok: CRX-M0 inventory -->
| `scripts/cf_export_site.py` | 194 | `static/js/presentation.js` | rewrite | "Mirrored by both site clients (…presentation.js and app/data/presentation.ts); change all three together" → one client: `app/data/presentation.ts` (`TREND_DECLINE_BAND`, line 61); change both together | <!-- retired-ok: CRX-M0 inventory -->
| `scripts/cf_export_site.py` | 517 | `foodDashboard.js` | rewrite | "Mirrors the front-end's `distinctOutItems` (foodDashboard.js)" → `app/data/presentation.ts` (`distinctOutItems`, line 246) |
| `SKILL.md` | 214 | `foodDashboard.js` | marker | correct history: CannonAI's bespoke tab "was deleted 2026-07-18 (CannonAI #300)" |
| `SKILL.md` | 256 | `foodDashboard.js` | rewrite | "the facility PERMIT link (`permitUrl` in CleanPlateVA's foodDashboard.js)" → `permitUrl` in `app/data/presentation.ts` (line 193) |
| `tools/studies/cf_map_stack_study.py` | 23, 47 | `public/static/js/stacks.js` | rewrite | `stackKey` / `STACK_DP` now live in `app/mapData.ts` (`stackKey`, line 48); the census's "keep in step" pointer must name the live module | <!-- retired-ok: CRX-M0 inventory -->
| `cannon_food/location/venue_anchor.py` | 83 | "no building" | — | the unbounded phrase's false positive; not a hit |

### 3.2 c-ground-code — 90 live records in 23 files, of which 26 are the charter

| Where | Records | Class | Note |
|---|---|---|---|
| `runway/INDEX.md:13` · `runway/cleanplate-close-out.md:3,14,15` | 26 | **self** | the CRX row and briefing name every string they sweep. Markers at M1 (four lines); both leave the scan at M2 (row removed, briefing archived) |
| `references/architecture/cannonai-project.md:19` · `runway/{cannon-electricity,cannonai-openrouter-model-selector,cannonai-tab-separation,cannonai-weather-tab,lyric-vault-gui-integration,vault-generic-browser}.md` | 29 | live-other | CannonAI's own `cannonai/gui/static/js/**` and `static/css/style.css` — the front end of a different app, all live. **This is why the two path rows must be narrowed** (§4.1); bare, they would fail Tier-0 on 29 correct lines | <!-- retired-ok: CRX-M0 inventory -->
| `references/architecture/cannonai-project.md:93` | 2 | **rewrite (M2's check, folded into M1)** | the phrase hits are dated and correct ("since #338, 2026-09-05, CRC pre-flip"); the sentence after them is stale on CannonAI's side: "Legacy `cannonai/food/` + `/api/food/*` + `foodDashboard.js` + the bespoke map CSS are retired-in-place (on disk, unused) pending the deletion milestone" — CannonAI #300 deleted them 2026-07-18 (cannon-food SKILL.md:214 records it); on disk today `cannonai/food/` holds the refinement editor's `proposals.py` and `/api/food/refine/*` is live (RFE-M2). This is the paragraph the briefing has M2 check "against the mount as it is" |
| `runway/cannonai-tab-separation.md:5` | 1 | marker | "The JS is already modular (`foodDashboard.js`, `oilDashboard.js`, …)" — the arc-origin state of 2026-06-24, before FOOD-EMBED; dated, kept |
| `scripts/bootup.py:321` | 1 | — | "measured at the CRC flip, 2026-09-06" — past tense; the future-tense regex cannot tell |
| `mcps/claude-preview-usage.md:61` · `references/architecture/durable-storage-design.md:287,304,492` · `local-mcp-supervision.md` · `omen-lan-topology.md` · `designs/**` · `runway/{clarity-omr,discogs,moonshot}*.md` | 31 | live-other | `requirements.txt` of other connectors, "Bootstrap" the English word, CannonAI's Bootstrap 5 — the two rejected phrases' whole yield |

`mcps/**` carries no CleanPlateVA residue at all; `references/**` carries one sentence (above). The c-ground-code prose §9.2 expected to find ("refs/mcps that still say `static/js/`, `app.py`, `node --test`") does not exist outside the charter. <!-- retired-ok: CRX-M0 inventory -->

### 3.3 the site README — 0 regex hits, 4 sentences by reading

The regexes are clean here (the site tripwire already scans the file). The deeper prose sweep CRC handed on found:

| Line(s) | Sentence | Class | Note |
|---|---|---|---|
| 34–36 | "CPX (the close-out sweep) is the remaining V4 arc." | rewrite | CPX closed 2026-08-18; the CR program then rewrote the front end and flipped 2026-09-06. The design-reference callout should name both constitutions and the state |
| 311–312 | "Workers Builds runs `npm ci && npx vite build` on every push and deploys the result" | rewrite | on pushes to `main` only — a non-production branch runs no build command (design ref §3, corrected at the flip) |
| 316–317 | "A branch push builds too, so a PR proves its build before it merges." | rewrite | false since the flip made `./dist` need a build: the PR proof is GitHub Actions (`npm ci · npx vite build · npx vitest run`) plus a local `npx wrangler deploy --dry-run`; the Workers Builds branch check reads red until D-CRX-2 |
| 246, 342 | `tools/visits-crosscheck.mjs` described as the live exporter/renderer parity proof | rewrite, after §3.4's call | the tool is dead (below); `tests/vitest/visits-parity.spec.ts` is the parity pin on the CR stack | <!-- retired-ok: CRX-M0 inventory -->
| 317 | "The no-build client this replaced was deleted at CRC (2026-09-06)" | — | correct past tense; the phrase regex's one README hit |

### 3.4 the site's `tools/` — unscanned, and one dead tool

`tests/vitest/retired-vocabulary.spec.ts` scans `docs/ src/ public/ tests/ app/` and the root files; `tools/` is outside it, and the strings there are built by `path.join`, so no regex would see them anyway:

| File | Line | Class | Note |
|---|---|---|---|
| `tools/visits-crosscheck.mjs` | 34–38 | **code** | `pathToFileURL(join(root, 'public', 'static', 'js'))` then `import(new URL('presentation.js', jsDir))` and `dataClient.js` — both deleted by the flip. The archive-wide exporter-vs-renderer crosscheck (27,919/27,919 at CPH-M0/M1; architecture-v4 §13, §15) has no CR-stack equivalent; `visits-parity.spec.ts` pins the derivation from the row on fixtures, not over the archive. §4.3 | <!-- retired-ok: CRX-M0 inventory -->
| `tools/dev_preview_mockups.py` | — | — | the CRD mockup server; imports nothing from the client |

### 3.5 the rest of the checkout, and `launch.json`

114 live records in 60 files outside the two owned scopes; **none within five lines of a CleanPlateVA or cannon-food word.** They are api-oracle's `app.py`, lyric-vault's and portfolio-mgmt's `static/js/`, iran-war's "dual track", other connectors' `requirements.txt` — proof that none of the bare forms could ever be a checkout-wide row, and that no third skill describes the old CleanPlateVA client. `.claude/launch.json`: 0 hits — the three `app.py` launch entries went at the flip; `cleanplateva-vite` (:5620), `cleanplateva-vite-ux`, `cleanplate-mockups` remain. <!-- retired-ok: CRX-M0 inventory -->

## 4. What M1 takes from this

### 4.1 The Tier-0 rows — measured, not read

Add to `cannon-food/tests/test_retired_vocabulary.py`'s `RETIRED` (its scope: `cannon-food/**` + `c-ground-code/{SKILL.md,mcps,references,scripts,routines,runway}` minus the policy exemptions). Live hits below are after the markers of §4.2 and the rewrites of §4.4 — i.e. what the test must see green:

| Row (regex) | Live hits today | After M1 | Why this form |
|---|---|---|---|
| `cdn\.jsdelivr\.net` · `bootstrap-icons` · `data-bs-theme` · `dashboard\.mjs` · `python app\.py` · `wrangler\.preview\.jsonc\|cleanplateva-preview` | 1–2 each, all charter | 0 | bare is safe: nothing else in the two scopes says them | <!-- retired-ok: CRX-M0 inventory -->
| `node --test\|test:node` | 4 (charter ×3, script-surface ×1) | 0 | bare is safe; the dated line takes a marker | <!-- retired-ok: CRX-M0 inventory -->
| `public/static/css/style\.css` | 0 | 0 | the bare form is CannonAI's live stylesheet path (`lyric-vault-gui-integration.md:59`) | <!-- retired-ok: CRX-M0 inventory -->
| `public/static/js/\|static/js/(?:about\|ack\|constants\|dataClient\|detail\|filters\|foodDashboard\|hover\|inspection\|list\|map\|markers\|presentation\|receipt\|router\|sparkline\|splitter\|stacks)\.js` | 3 (cannon-food, all real) | 0 | the 18 deleted modules by name — `app.js` deliberately absent, CannonAI's entry is `static/js/app.js`; the bare form fails on 29 live CannonAI lines. Measured: narrowed A alone misses `cf_export_site.py:194`, B alone would miss a future `public/static/js/` mention; the union is exact | <!-- retired-ok: CRX-M0 inventory -->
| `lite-roster-contract\.test\.mjs` | 3 (publisher, operations, routine) | 0 | exact, not `\.test\.mjs`: `cannonwest-me`'s live `tests/links.test.mjs` would false-positive any ref about that site |
| `foodDashboard\.js` | 5 | 0 | dead outright in both projects; two rewrites, three markers/rewrites in §4.2–4.4 |

`test_retired_vocabulary.py` also documents in its trailer what it does not check; the phrases §2 measured to zero (no build step · until CRC · bare `app.py` · the old-client names · the preview hostname) belong there as measured-and-declined, with the date.

### 4.2 Markers (`retired-ok`) — seven lines

`c-ground-code/runway/INDEX.md:13` · `runway/cleanplate-close-out.md:3,14,15` (self; gone at M2) · `cannon-food/references/script-surface.md:1310` · `cannon-food/SKILL.md:214` · `c-ground-code/runway/cannonai-tab-separation.md:5`.

### 4.3 Calls — two live breaks, both outside CRX's stated scope

1. **`cannon-food/scripts/cf_publish_cleanplate.py:618` — the Lite gate runs a deleted file.** Not prose: the next publish halts at `lite_contract`. Fix shape: `["node", "node_modules/vitest/vitest.mjs", "run", "tests/vitest/lite-roster-contract.spec.ts"]` with `cwd=site` (the `node …/bin` form the workspace launch file already uses for Vite; `npx` is a `.cmd` shim `subprocess` will not resolve without a shell), plus the two prose lines. The routine's version pins name the archive schema only, so no `routine_version` bump. The briefing says cannon-food's publisher is not CRX — it is a CRC regression on a nightly, so it is a hotfix on its own PR, before 20:00 local, on Cannon's go. |
2. **`tools/visits-crosscheck.mjs` — dead since the flip.** Delete it (README ×2 and architecture-v4 §15 re-pointed at `visits-parity.spec.ts`; the §13 history rows are exempt and stay), or port it to the CR stack as a Vitest spec gated on a local `public/data-full/`. Cannon's call; the recommendation is delete — the archive-wide check ran at CPH-M0/M1 for the encoding decision and has not been needed since. <!-- retired-ok: CRX-M0 inventory -->

### 4.4 Rewrites — the M1 PR list

- **cground-skills (one PR, cannon-food + c-ground-code):** `operations.md:386` · `food-log-update.md:305` · `cf_export_site.py:194,517` · `SKILL.md:256` · `cf_map_stack_study.py:23,47` · `cannonai-project.md:93` (the stale CannonAI sentence — M2's check, done here because the row would otherwise fail on it) · the rows of §4.1 · the markers of §4.2 · `cg-test.py --tier 0` green. `SKILL.md` changes → `package_skill.py` before the commit.
- **CleanPlateVA (one PR):** README lines 34–36, 311–317, and 246/342 per the §4.3 call; §9.3 of the design reference gets the receipt.

## 5. What M2 inherits — the exempt hits

| Where | Hits | Disposition |
|---|---|---|
| `c-ground-code/memory/project_clean_plate_va.md` | 19 (preview name ×4, old-client ×5, until-CRC ×2, hostname ×2, no-build ×2, `app.py`, `dashboard.mjs`, `node --test`, dual track) | the identity-card rewrite drops every one: what / where / status / invariants + pointer, ≤1.2 KB | <!-- retired-ok: CRX-M0 inventory -->
| `memory/MEMORY.md:45` | 2 | the index line trims with the card |
| `memory/feedback_{dark_mode_default_cannonai,node_check_misses_module_errors}.md` · `project_cannonwest_me.md` | 9 | CannonAI's and cannonwest-me's own vocabulary — correct, untouched |
| `memory/feedback_workers_builds_branch_builds_skip_build_command.md` · `feedback_measure_host_behavior_not_the_stand_in.md` | 3 | dated findings — correct |
| `runway/archive/**` (12 briefings) · `runway/HISTORY.md` · `cannon-food/references/retros/**` | 195 | history is allowed to say old words |

Beyond the hits: `frontend-redesign.md` §1's status line and arcs table re-base ("the CR program closed <date>"); D-CRX-1 (a by-name `_headers` rule for the hashed assets) and D-CRX-2 (the red branch check) go to Cannon as one chip round; then this arc archives.
