# CleanPlateVA

A finder map for Virginia food establishments, built from Virginia Department
of Health inspection records. Every marker links to the establishment's
official VDH inspection record.

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
  Acknowledgment** (About §06). `public/static/js/ack.js` shows a first-load
  dialog over the empty basemap that blocks and fetches nothing until
  answered — "Agree and View Grades" loads Full, "Decline and Use Basic Map"
  the basic map — remembers the answer per device
  (`localStorage['cleanplateva.ack.v1']`; bump `ACK_VERSION` to re-ask), and
  keeps a header control that re-opens the terms so the answer can change.
  If full data is unavailable for any reason, the same client falls back to
  the basic map. There is no login: the Cloudflare Access application that
  used to gate `/data-full/*` was retired 2026-08-17 (CPF-M3).

## Architecture

> **Design reference (V4):** the shared design — public Full behind an
> acknowledgement instead of Access, the barest boot payload per view, and
> real per-view URLs — is [`docs/architecture-v4.md`](docs/architecture-v4.md).
> Contract V4 (the data below) shipped with the CPD arc; the acknowledgement
> gate, the public transport, and the Access retirement (CPF-M1..M3) shipped
> 2026-08-17. CPX (the close-out sweep) is the remaining V4 arc.

The site is a static MapLibre client. A small Cloudflare Worker
([`src/worker.js`](src/worker.js)) serves [`public/`](public/) and the full
channel from R2 with public cache-control and an edge cache. It never queries
VDH or CouchDB at request time.

The client is plain ES modules under `public/static/js/` — no build step.
`app.js` boots the page; `dataClient.js` loads the manifest-led tiers;
`foodDashboard.js` is the dashboard orchestrator (constructor, toolbar
wiring, load/refresh, view switch) and re-exports the pure helpers. Every
other concern is one sibling module installed onto the dashboard prototype:
`constants` · `stacks` · `presentation` · `receipt` (pure) and `map` ·
`markers` · `hover` · `filters` · `list` · `about` · `detail` · `sparkline` ·
`inspection` · `router` (method bundles). `tests/support/dashboard.mjs` is
how the suites import the graph and its concatenated source.

### Routes

Each view is a real path — `/` (map), `/list`, `/about` — and the shareable
state rides in the query string: `q`, `zip`, `grade`, `restaurants`,
`closed`, `new`, `mobile`, `permit` on every view, plus `sort`, `dir`, and
`page` (the List's load-more position, 50 rows per chunk) on `/list`. A URL
wins over the stored toggle preferences for whatever it names; only
non-default state is written, so shared links stay short. `/map` and any
unknown path normalize to `/`, and the legacy `#about` hash migrates to
`/about`.

Serving this needs one thing from the host: any non-asset path must return
`index.html` so the client can route it. Cloudflare does that through
`assets.not_found_handling` in [`wrangler.jsonc`](wrangler.jsonc); `app.py`
and the CannonAI embed mount mirror it.

A missing asset must still 404, and Cloudflare's setting alone does not do
that — it is all-or-nothing, so a genuinely missing data shard would come
back as `200 text/html` and `dataClient` would parse markup as JSON.
[`src/worker.js`](src/worker.js) re-imposes the honest answer for the paths
it sees: an asset-shaped request (last segment carrying a non-HTML
extension) answered with the HTML shell is returned as a 404.

Which paths it sees is set by `run_worker_first`, and in its array form that
list is *the* set of paths that invoke the worker at all — everything else,
SPA fallback included, is answered by the assets layer. So it names both
channels the worker owns and nothing else: `/data/*`, the public channel,
where a masked 404 is *silent* (the client mis-parses and degrades with a
confusing reason) and which already routes through the worker for its
cache-control headers; and `/data-full/*`, the R2-backed full channel, which
is not a static asset and therefore *is* the shell under the fallback unless
the worker runs first (before the fallback existed a miss fell through to the
worker on its own; measured 2026-08-16, the fallback removed that path and
the full tier degraded to gray Lite until this entry was added).
Static assets stay on the fast path: a missing `.js` there announces itself
immediately as a console MIME error, and a per-file worker invocation would
be a real request-quota cost for a cosmetic improvement. `app.py` and the
embed mount have no such split — they decide before serving, so everything
404s correctly there.

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
300 s by ETag. The Worker answers repeat `/data-full/*` reads from the edge (Cache API,
`X-Cache: HIT`/`MISS`) and turns an unchanged object's conditional request into a 304. The full publisher
retains the previous manifest's referenced shards for one generation, so a
browser holding a cached full manifest never sees missing resources during a
publish.

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

### Public finder contract

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
street-level (Census centerline), `2` ZIP centroid — and drives the
"≈ approximate location" notes. `pt` is a code into the manifest's
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
`tests/lite-roster-contract.test.mjs`.

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
 latest_scope_code, latest_out, latest_items, compliance_pct]
```

The client fetches finder and overlay in parallel, checks the sha binding and
the row count per bucket, and merges by position; a mismatch degrades to the
public finder rather than rendering a misaligned map. The grade letter is
never shipped — it is `gradeForScore(grade_score)`. `latest_items` is the
addressed-item count for a focused visit and the applicable count for a broad
one; `latest_scope_code` indexes `vocab.scope`. There is no series on the
roster: the hover card renders instantly from the overlay (grade circle,
NEW / no-grade text, last-broad and last-visit dates) and fills its sparkline
in from the facility detail, fetched on hover through the same LRU the click
panel reads. **closed** — the non-active permits as finder fields + `status`
+ `o` (their overlay row), fetched lazily on the first "Show closed".
**standards** and **facility/*.json** are unchanged (the detail keeps
`cleanplateva.facility-detail.v3`, deliberately: its bytes did not change at
cutover, so nothing re-uploaded for naming symmetry).

Facility detail files remain nested by design. Updating one inspection rewrites
one small `facility/<permitID>.json` object rather than a statewide roster, and
opening a facility still needs one history request instead of dozens. Re-issued
permits are presentation-merged into that history with lineage retained.
Details have no timestamp, so unchanged bytes preserve local mtimes and skip
R2 upload. Compact checklist rows use
`[item, disposition, flags(, override)]`, where flags are
`1 compliant | 2 violation | 4 cos | 8 repeat | 16 sentinel`; `dataClient.js`
expands them using `standards.json`.

The client accepts Contract V4 only. A failed or gated full-manifest read falls
back to the public finder; a missing, incomplete, or older public manifest is
reported as unavailable. The publisher's manifest-derived inventory is the
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
`main`; there is no build step.

```text
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5001`. Put an exported full tier under
`public/data-full/` (gitignored) to exercise the full presentation locally:
the first visit shows the Terms of Use and Data Acknowledgment dialog over the
empty basemap and fetches nothing until you answer; "Agree and View Grades"
loads the full tier, "Decline and Use Basic Map" the basic map. The answer is
remembered under `localStorage['cleanplateva.ack.v1']` (clear it, or bump
`ACK_VERSION` in `ack.js`, to be asked again); the header's terms control
re-opens the dialog. Append `?tier=lite` to force the basic map with no terms
asked and the control hidden.

`app.py` is the dev server *because* it does the view-path fallback (see
Routes above). A bare static server over `public/` still works for the map,
but loading `/list` or `/about` directly will 404 on it — reach those through
the in-page tabs, or use `app.py`.

## Data source

Inspection records originate from the
[VDH MyHealthDepartment portal](https://inspections.myhealthdepartment.com/virginia).
The map is a prepared snapshot, not a live feed; VDH remains authoritative.
