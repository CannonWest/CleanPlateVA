# CleanPlateVA

A finder map for Virginia food establishments, built from Virginia Department
of Health inspection records and, for the Fairfax localities it serves, the
Fairfax County Health Department's. Every marker links to the establishment's
official record at the publishing department.

## Two tiers, one site

The tier boundary is **judgment, not secrecy** (design ref P1): everything is
public; the judgment-bearing tier is fetched only after the visitor
acknowledges the terms.

- **Basic map (the default before acknowledgement, and the fallback)** — a
  gray finder map with identity, location, search/filter controls, and a
  hand-off to VDH. It exposes no scores, grades, report dates, or inspection
  content. `?tier=lite` forces it and asks no terms.
- **Inspection grades (Full)** — archived inspection histories, derived scores
  and facility grades, violations, checklists, temperatures, and comments,
  fetched only after the visitor acknowledges the **Terms of Use and Data
  Acknowledgment** (About §06). `app/AckDialog.tsx` (state in `app/ack.ts`)
  shows a first-load dialog over the empty basemap that blocks and fetches
  nothing until answered — "Agree and View Grades" loads Full, "Decline and
  Use Basic Map" the basic map — and remembers the answer per device
  (`localStorage['cleanplateva.ack.v1']`; bump `ACK_VERSION` to re-ask);
  About §06 re-opens the terms so the answer can change.
  If full data is unavailable for any reason, the same client falls back to
  the basic map. There is no login: the Cloudflare Access application that
  used to gate `/data-full/*` was retired 2026-08-17 (CPF-M3).

## Architecture

> **Design references:** the shared V4 design — public Full behind an
> acknowledgement instead of Access, the barest boot payload per view, and
> real per-view URLs — is [`docs/architecture-v4.md`](docs/architecture-v4.md);
> the V4 program (CPR → CPD → CPF → CPH → CPX) closed 2026-08-18, and every
> published object is Contract V4. The front end is the CR program's
> React + Vite + Tailwind client, designed and built against
> [`docs/frontend-redesign.md`](docs/frontend-redesign.md) (the front-end
> constitution: §2 invariants, §6 per-view specs, §9 the cutover receipts);
> production flipped to it 2026-09-06, and CRX, the close-out sweep, is that
> program's last arc.

The site is a static MapLibre client. Cloudflare's static-assets layer serves
the Vite build in `dist/` — the app shell, its hashed assets, and the
committed public data channel copied verbatim from [`public/`](public/) —
and a small Cloudflare Worker ([`src/worker.js`](src/worker.js))
serves only the full channel from R2, with public cache-control and an edge
cache. Nothing queries VDH or CouchDB at request time, and nothing invokes
the Worker for a static file: on Workers Free the metered unit is the
request, so the basic map costs zero Worker requests and the acked boot
seventeen (the full manifest and sixteen overlay shards); the shared finder
is read from the static channel by content-addressed name.

The client is a React + TypeScript app under [`app/`](app/), built by Vite
(design ref [`docs/frontend-redesign.md`](docs/frontend-redesign.md)).
`app/main.tsx` boots it; `app/data/client.ts` loads the manifest-led tiers;
`app/App.tsx` owns the views (`MapView`, `ListView`, `AboutView`) over the
router hook (`app/useAppRouter.ts`, on the pure `app/router.ts`), the
acknowledgement gate (`app/ack.ts`, `app/AckDialog.tsx`), and the visitor's
presentation choices — theme (`app/theme.ts`, light / dark / system), grade
colors (`app/palette.ts`, the ratified ramp or a color-blind friendly one),
"Group nearby places" (`app/clusters.ts`) and text size (`app/settings.ts`)
— set in the settings dialog (`app/SettingsDialog.tsx`, Radix primitives),
which opens once on a first map view and from the Settings button under
the band on the map. The suites under `tests/vitest/` and beside the
modules import them directly.

### Routes

Each view is a real path — `/` (map), `/list`, `/about` — and the shareable
state rides in the query string: `q`, `grade`, `restaurants`, `closed`,
`new`, `mobile`, `permit` on every view, plus `sort`, `dir`, and `page` (the
List's load-more position, 50 rows per chunk) on `/list`. A URL wins over the
stored toggle preferences for whatever it names; only non-default state is
written, so shared links stay short. `/map` and any unknown path normalize to
`/`, and the legacy `#about` hash migrates to `/about`.

`q` is the whole search, over four fields. It is split on whitespace and
**every term must match something**, but each term may match a *different*
field — so `richmond taco` is taco in the name and Richmond in the city, and
`23220 taco` pairs a ZIP with a name. Order does not matter. Within one term,
name / address / city match as a substring anywhere, and the ZIP matches as a
**prefix**: `232` means the 232\*\* ZIPs, while `3231 Duke St` still answers to
`231` through its address. The prefix split is deliberate — a substring test on
the ZIP answers `231` with Alexandria's 22311/22312/22314/22315.

**A `"quoted phrase"` is one term that must be found whole, inside a single
field.** Unquoted `taco bell` also returns Taco Bamba on Camp*bell* Ave, because
the words are free to scatter; `"taco bell"` returns only the 196 rows that
carry the phrase. Matching a phrase against the fields *joined* would let it
straddle the seam between them — the roster holds 28,250 distinct
name|address and address|city boundary bigrams and not one occurs inside a
single field, so each would be a phantom hit (`"hwy madison"` = `4764 S Amherst
Hwy` + `Madison Heights`). Bare words are indifferent to the split: a word has
no space, so it cannot straddle a seam. An unterminated quote is read as a
phrase, since the closing quote is usually just not typed yet.

A single word behaves exactly as it did before word matching (`taco` = 423 rows
either way); only multi-word queries change. The ZIP dropdown all this replaced
is retired, and a legacy `?zip=23220` is read once, folded into `q`, and cleared
from the address bar.

Serving this needs one thing from the host: any non-asset path must return
`index.html` so the client can route it. Cloudflare does that through
`assets.not_found_handling` in [`wrangler.jsonc`](wrangler.jsonc); the Vite
dev server and the CannonAI embed mount mirror it.

That setting is all-or-nothing: a genuinely missing data shard comes back as
`200 text/html` too. The client keeps that honest — `dataClient` treats the
HTML shell on any data path as a miss, never as JSON: the full tier falls
back to R2 for that shard, the basic map reports "no data published yet".

`run_worker_first` in [`wrangler.jsonc`](wrangler.jsonc) is, in its array
form, *the* set of paths that invoke the worker at all — everything else,
SPA fallback included, is answered by the assets layer without a Worker
request. It names exactly one thing: `/data-full/*`, the R2-backed full
channel, which is not a static asset and therefore *is* the shell under the
fallback unless the worker runs first (measured 2026-08-16: with it absent
the full tier silently degraded to the basic map). The public channel
`/data/*` is static: its cache-control lives in
[`public/_headers`](public/_headers) (the manifest revalidates in 60 s;
content-addressed finder shards are immutable), and the client fetches the
finder from there first — same bytes as the R2 copy, content-addressed, so a
name the static tree lacks (the minutes between a site deploy and the R2
flip) simply falls back to R2 by the same name. Static assets stay on the
fast path: a missing `.js` announces itself as a console MIME error, and a
per-file worker invocation would be a request-quota cost for a cosmetic
improvement. The embed mount has no such split — it decides before serving,
so a missing shard 404s there (and `_headers` is a Workers-only file, inert
locally).

The page declares its mount with `<base href>` (`/` here, rewritten to
`/cleanplate/` by the CannonAI passthrough) and the router reads it from
`document.baseURI`, which is what lets one build serve from either.

Prepared data uses explicit Contract V4 manifests:

```text
public/data/                       (public, git)
├── manifest.json                  # freshness + vocab + finder shard descriptors
└── finder/<bucket>-<hash>.json    # the finder: active permits, identity + location

/data-full/                        (R2; public channel, edge-cached — the client fetches it after the acknowledgement)
├── manifest.json                  # atomic snapshot pointer, published last
├── finder/<bucket>-<hash>.json    # the SAME finder bytes, republished
├── overlay/<bucket>-<hash>.json   # one judgment row per finder row, position-aligned
├── closed/<bucket>-<hash>.json    # non-active permits (finder fields + status + overlay row)
├── standards.json                 # shared checklist vocabulary
└── facility/<permitID>.json       # one facility's nested inspection history
```

The full publisher uploads changed data objects first and publishes
`manifest.json` last. Content-addressed shards on BOTH channels use a long shared
immutable cache; mutable manifests revalidate every 60 s and full detail objects every
300 s by ETag (the public channel's rules ride in `public/_headers`, the full
channel's in the Worker). The Worker answers repeat `/data-full/*` reads from the edge (Cache API,
`X-Cache: HIT`/`MISS`) and turns an unchanged object's conditional request into a 304. The full publisher
retains the previous manifest's referenced shards for one generation, so a
browser holding a cached full manifest never sees missing resources during a
publish.

**Request budget** (design ref §9). Workers Free meters requests — 100K/day,
reset 00:00 UTC — and static-asset requests served without the Worker do
not count. Per session, measured on production: dialog before answering 0;
basic map **0** Worker requests (17 static); acked boot **17** (`/data-full/`
manifest + 16 overlay; the 16 finder shards are static); hovers **0** (the
card draws from the overlay's `visits`); each distinct facility clicked +1
(its detail) plus `standards.json` once. Should the daily cap ever trip, the
full channel fails and the client degrades to the basic map, which is static
and keeps working; the Worker's route can additionally be set to fail open
where Cloudflare offers the setting.

Publication is driven from cannon-food by a strict source-fact change set or an
explicit full-build run ID. The persistent local Full cache is treated as a
materialized view. A permit-bounded update is accepted only when current
identity/site ownership and, for inspection changes, the shared-standards vote
state prove it equivalent to a full rebuild. Any missing proof or global/schema
change falls back to the deterministic two-pass full exporter. The publisher is
resumable, records a manifest-bound receipt, runs the Lite contract and shrink
gates, previews R2, flips R2 manifest-last, then commits/pushes the Lite data.
There is no cross-system distributed transaction, but each tier changes through
one atomic pointer (the R2 manifest or the Git commit), and completed phases are
not repeated on resume.

### /admin — the About page's edit surface

`/admin` renders the About document (`app/AboutView.tsx`) as an edit surface:
click an element to pick it, rewrite its own words, or mark it deleted. No
link anywhere on the site points at it.

It sits behind a Cloudflare Access application (**CleanPlateVA admin**,
`b421f71e-d025-48d2-96be-c64620d8dbbb`) covering **both**
`cleanplateva.com/admin` and `www.cleanplateva.com/admin` — the `www` host is
listed deliberately, because it is outside a bare apex-scoped application and
would otherwise serve the path unauthenticated. One-time PIN, 24 h session,
one email policy. Access matches the `/admin` segment, so `/admin/*` redirects
and `/administrator` does not; the editor itself renders at `/admin` alone,
which makes the gate strictly wider than the surface.

**Nothing here publishes.** There is no write path, no token and no Worker
route: edits are ops in this device's `localStorage` (`app/admin/ops.ts`) and
leave only as exported text, which is then folded into `AboutView.tsx` as an
ordinary change. `/about` is identical for every visitor while a draft exists,
including in the same browser. Two consequences worth knowing:

- The editor is its own lazy chunk (~9 kB) that a visitor never downloads —
  `main.tsx` branches on the path before the app mounts, so the entry chunk,
  the three public views and their URL grammar are untouched.
- A delete **hides**, never removes. React owns those nodes, and a removed
  sibling would shift every later element's index and silently re-point every
  other op. "Hide deleted" in the header shows the page as it would read.

Paths are child-index chains, stable for as long as `AboutView.tsx` is — a
session and the handoff that follows it. Every op therefore also records the
element's tag, class and text as they were, so the export names what to change
even if the path has gone stale.

### Shared finder contract

`cleanplateva.finder-manifest.v4` points to 16 deterministic
`cleanplateva.finder-shard.v4` files — the ONE finder family both tiers boot
on (design ref §6):

```json
{
  "contract": "cleanplateva.finder-shard.v4",
  "schema_version": 4,
  "bucket": "00",
  "facilities": []
}
```

Each facility is a flat object with exactly thirteen fields: `permit_id,
name, address, address2, city, zip, tenant, is_restaurant, mobile, pt, lat,
lon, loc`. `lat`/`lon` are the effective point (an accepted permit-level
refinement when one exists, else the physical-site fallback) rounded to 6
decimal places at export; `loc` classifies it — `0` rooftop-quality, `1`
street-level (a road centreline, Census or VGIN), `2` ZIP centroid, `3`
venue-level (seated on
the venue rather than the unit, for an address that is a room or space number)
— and drives the "≈ approximate location" notes on BOTH the hover card and the
detail panel. The vocabulary is append-only: a code is positional identity, so
a new class joins the end and never renumbers what is already published. `pt` is a code into the manifest's
`vocab.permit_type` list (sorted, so codes are a pure function of the archive);
`is_restaurant` and `mobile` are the exporter's booleans (`is_restaurant` also
uses name patterns, so it can never be derived from `pt`). `permit_id` +
`tenant` build the district-scoped VDH link. Nothing judgment-bearing rides
here — no scores, grades, dates, status, or inspection content (P6). Same-point
stacks are computed client-side from the coordinates.

The manifest carries `freshness: {snapshot_id, newest_report}` — the archive
snapshot and the newest inspection report it holds, which is what the footer
and About state — and `vocab: {permit_type, loc, scope}`. Shard descriptors
include path, bucket, SHA-256, byte size, and record count; shards contain no
timestamp. There is no public `facilities.json` monolith or compatibility
loader. The committed artifact contract is pinned by
`tests/vitest/lite-roster-contract.spec.ts`.

### Full archive contract

`cleanplateva.full-manifest.v4` names five families. **finder** — the same 16
shards (same bytes) the public tier commits, republished under `/data-full/`
so each tier flips atomically on its own manifest (P9). **overlay** — 16
`cleanplateva.overlay-shard.v4` files, one positional row per finder row in
the same bucket, in the same order; each shard's envelope carries
`finder_sha256`, the digest of the finder shard it aligns to, and its
`columns`:

```text
[grade_score, new, trend_delta, latest_yyyymmdd, base_yyyymmdd,
 latest_scope_code, latest_out, latest_items, compliance_pct, visits]
```

The client fetches finder and overlay in parallel, checks the sha binding and
the row count per bucket, and merges by position; a mismatch degrades to the
public finder rather than rendering a misaligned map. The grade letter is
never shipped — it is `gradeForScore(grade_score)`. `latest_items` is the
addressed-item count for a focused visit and the applicable count for a broad
one; `latest_scope_code` indexes `vocab.scope`. `visits` is the hover
sparkline's series — one entry per inspection, oldest-first, in a compact
`[kind, yyyymmdd, value…]` form: `[1, d, score]` a broad visit with a
published score (`[1, d]` without one — an x-slot with no mark), `[2, d, out,
addressed]` a focused re-check with a trustworthy ratio (`[2, d]` without — a
baseline tick), `[3, d, code]` a scope-unknown Follow-Up with an adjudicated
written verdict (1 all corrected · 2 priority corrected · 3 none corrected;
`[3, d, 4, ins, outs]` an item-by-item verdict), `[0, d]` nothing claimable.
The exporter writes exactly the marks the trend instrument would derive from
the detail (pinned by `tests/vitest/visits-parity.spec.ts`; cross-checked
across the whole archive at CPH-M0/M1, design ref §13), so
the hover card renders **completely from the row in memory** — grade circle,
NEW / no-grade text, last-broad and last-visit dates, and the trend — and
**nothing is fetched on hover** (on Workers Free the metered unit is the
request). The click panel fetches the facility detail. **closed** — the
non-active permits as finder fields + `status` + `o` (their overlay row),
fetched lazily on the first "Show closed".
**standards** and **facility/*.json** are unchanged in shape; the detail's
contract string is `cleanplateva.facility-detail.v4` (bumped 2026-08-18 for
one-contract consistency — every published object is Contract V4 — once it was
clear nothing consumed the string and the cutover had re-uploaded the details
anyway; the client validates it on the click path and reports an unsupported
detail as unavailable, uncached).

Facility detail files remain nested by design. Updating one inspection rewrites
one small `facility/<permitID>.json` object rather than a statewide roster, and
opening a facility still needs one history request instead of dozens. Re-issued
permits are presentation-merged into that history with lineage retained.
Details have no timestamp, so unchanged bytes preserve local mtimes and skip
R2 upload. Compact checklist rows use
`[item, disposition, flags(, override)]`, where flags are
`1 compliant | 2 violation | 4 cos | 8 repeat | 16 sentinel`; `app/data/client.ts`
expands them using `standards.json`.

The client accepts Contract V4 only. A failed Full-manifest read falls back to
the shared finder — the basic map — and a missing, incomplete, or older Lite
manifest is reported as unavailable. The publisher's manifest-derived inventory is the
only legal R2 object set (finder, overlay, closed, standards, details); the
previous manifest's shards are retained for one generation, which is also how
the retired V3 `signals/*` family was pruned after cutover. Arbitrary JSON in
the local Full cache blocks publication instead of silently becoming public.
Production publication also fetches both repositories and requires clean local
`main` heads synchronized with `origin/main`. Broad attended migrations can
checkpoint after the exact R2 dry-run and resume from the recorded phase/head
state after review; the content-addressed plan is recomputed before apply and
remote drift forces another checkpoint.

## Inspection and grade semantics

Each inspection is classified from distinct numbered, non-sentinel form items:
`broad` (20+, grade/trend eligible), `focused` (1–19, targeted outcome), or
`unknown` (no trustworthy checklist breadth). `form_item_count` owns breadth;
`applicable_item_count` separately counts distinct IN/OUT items. N/A and N/O
can prove breadth but are never compliant passes.

Focused Follow-Ups can be hybrid: VDH may put corrected items only in the
comments while the structured checklist contains the remaining OUT rows.
`addressed_item_count` is the distinct union of those comment-enumerated and
structured outcomes. A same-item structured row wins a comment collision, and
the visit counts once. Thus a checklist with three OUT rows plus fourteen other
corrected items presents as `3/17 OUT`, without pretending the comments changed
the report's checklist-derived scope or form breadth.

Only a broad inspection publishes a deterministic 0–100 score, and it never
has a letter. Focused and scope-unknown inspections publish `score: null`; the
focused presentation uses its OUT/addressed result instead. A facility grade
is a score plus A–F letter anchored to its newest broad assessment and adjusted
by later focused re-checks. A scope-unknown or focused hybrid follow-up may
carry an audited `adjudication {status, verdict, items?}` derived from the
inspector's written comments. The About view documents the formula,
adjustment ladder, provenance, and limitations.

## Hosting and local use

Cloudflare Workers deploys [cleanplateva.com](https://cleanplateva.com) from
`main`. On a push to `main`, Workers Builds runs `npm ci && npx vite build`
and deploys the result (design ref `docs/frontend-redesign.md` §3):
`wrangler.jsonc` serves `dist/` — the app shell, its hashed assets, the
publisher's `data/` copied verbatim from `public/`, and its `_headers`
carried verbatim with the build's own rules appended (one `immutable` rule
per content-hashed asset, by name, never a splat; `public/_headers` itself is
never edited) — `tests/vitest/dist-contract.spec.ts` pins all of it — with
the Worker in front of `/data-full/*` only. A push to any other branch runs **no build command**
(measured at the flip, design ref §3), so its Workers Builds check reads
red now that `dist/` needs a build; the pre-merge proof of a PR is the
GitHub Actions job below plus a local `npx wrangler deploy --dry-run`
against `dist/`. The no-build client this replaced was deleted at CRC
(2026-09-06); its files are in git history.

```text
npm ci
npm run dev
```

Open the URL Vite prints. It serves the app from `app/` with `public/` as a
passthrough, so put an exported full tier under `public/data-full/`
(gitignored, unwatched) to exercise the full presentation locally: the first
visit shows the Terms of Use and Data Acknowledgment dialog over the empty
basemap and fetches nothing until you answer; "Agree and View Grades" loads
the full tier, "Decline and Use Basic Map" the basic map. The answer is
remembered under `localStorage['cleanplateva.ack.v1']` (clear it, or bump
`ACK_VERSION` in `app/ack.ts`, to be asked again); About §06 re-opens the
dialog. Append `?tier=lite` to force the basic map with no terms asked.

`npm test` runs the Vitest suite — the component and contract suites, the
committed-artifact tripwire (`lite-roster-contract`), the retired-vocabulary
tripwire, and, once `npm run build` has produced `dist/`, the build-output
contract; `npm run typecheck` runs `tsc`. `npm run test:e2e` builds and runs
the Playwright smoke (`tests/e2e/`): the production build served by `vite
preview` in a real Chromium, asked through `window.__cpMap` whether the map
actually painted — dots rendered, the canvas holding more than one color, in
both themes and with "Group nearby places" on. Every Vitest map spec runs
against a fake; this is the one that asks the running map, and the only test
that exercises the worker file the build copies beside the main chunk. It
needs the Playwright Chromium once (`npx playwright install chromium`) and
CARTO's basemap live. CI runs `npm ci`, `npx vite build`, `npx vitest run`,
then the smoke, on every PR and push; the smoke's report is uploaded as an
artifact when it fails.

`tools/` holds helpers the build never runs:
`tools/dev_preview_mockups.py` serves the CRD mockups under `docs/mockups/`
on a throwaway port, and `tools/make_favicon.py` renders `public/favicon.ico`
and `public/apple-touch-icon.png` from the brand mark. The icons are
COMMITTED and ship from `public/`, under stable names a bare `/favicon.ico`
probe can find; nothing regenerates them, so re-run the tool after any edit
to `app/clean-plate-va-logo.png` and commit what changes. The
exporter/renderer parity proof behind design ref
D-DATA-13 is `tests/vitest/visits-parity.spec.ts`; the archive-wide
crosscheck tool that established it at CPH-M0/M1 retired with the old
client (design ref §14.1).

## Data source

Inspection records originate from the
[VDH MyHealthDepartment portal](https://inspections.myhealthdepartment.com/virginia)
and, for the Fairfax Health District, from the
[Fairfax County Health Department's inspection reports](https://www.fairfaxcounty.gov/health/food/inspection-reports)
(the exporter publishes those facilities with `tenant: "fairfax"`, which both
clients route to the county instead of a portal path). The map is a prepared
snapshot, not a live feed; the publishing health department remains
authoritative.
