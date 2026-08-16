# CleanPlateVA

A finder map for Virginia food establishments, built from Virginia Department
of Health inspection records. Every marker links to the establishment's
official VDH inspection record.

## Two tiers, one site

- **Lite (public, the default)** — a gray finder map with identity, location,
  search/filter controls, and a hand-off to VDH. It exposes no scores, grades,
  report dates, or inspection content.
- **Full (authenticated)** — archived inspection histories, derived scores and
  facility grades, violations, checklists, temperatures, and comments through
  the Access-gated `/data-full/*` channel. If full data is unavailable, the
  same client falls back to lite.

## Architecture

> **Direction (V4):** the next design — public Full behind an acknowledgement
> instead of Access, the barest boot payload per view, and real per-view URLs —
> is specified in [`docs/architecture-v4.md`](docs/architecture-v4.md). That
> doc is authoritative for where the site is going; this README stays
> authoritative for the shipped V3 contract until the CPD arc cuts over.

The site is a static MapLibre client. A small Cloudflare Worker
([`src/worker.js`](src/worker.js)) serves [`public/`](public/) and proxies
authenticated full-data reads from R2. It never queries VDH or CouchDB at
request time.

The client is plain ES modules under `public/static/js/` — no build step.
`app.js` boots the page; `dataClient.js` loads the manifest-led tiers;
`foodDashboard.js` is the dashboard orchestrator (constructor, toolbar
wiring, load/refresh, view switch) and re-exports the pure helpers. Every
other concern is one sibling module installed onto the dashboard prototype:
`constants` · `stacks` · `presentation` · `receipt` (pure) and `map` ·
`markers` · `hover` · `filters` · `list` · `about` · `detail` · `sparkline` ·
`inspection` (method bundles). `tests/support/dashboard.mjs` is how the
suites import the graph and its concatenated source.

Prepared data uses explicit Contract V3 manifests:

```text
public/data/
├── manifest.json                 # freshness + public shard descriptors
└── finder/<bucket>-<hash>.json   # stable public finder shards

/data-full/ (private R2)
├── manifest.json                 # atomic snapshot pointer
├── finder/<bucket>-<hash>.json   # identity/location/status shards
├── signals/<bucket>-<hash>.json  # sparse grade/inspection-signal shards
├── standards.json                # shared checklist vocabulary
└── facility/<permitID>.json      # one facility's nested inspection history
```

The full publisher uploads changed data objects first and publishes
`manifest.json` last. Content-addressed public shards use a long shared immutable cache;
authenticated finder/signal shards use a long browser-private immutable cache.
Mutable manifests and full detail objects revalidate quickly. The full publisher
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

`cleanplateva.finder-manifest.v3` points to 16 deterministic
`cleanplateva.finder-shard.v3` files:

```json
{
  "contract": "cleanplateva.finder-shard.v3",
  "schema_version": 3,
  "bucket": "00",
  "facilities": []
}
```

Each facility has exactly ten top-level fields: `permit_id, name, address,
address2, city, zip, tenant, location, is_restaurant, mobile`. `location` has
exactly `lat, lon, precision, source, site_group_id, site_count, site_lat,
site_lon, site_source`. The effective `lat`/`lon` use an accepted permit-level
refinement when one exists and otherwise equal the physical-site fallback.
The `site_*` fields always retain that fallback, while the stable group ID/count
preserve address-level co-location lineage. The browser separately counts the
effective `lat`/`lon` values in the loaded roster and shows a shared-map-point
notice only while multiple facility records still render at that coordinate; a
tenant refinement that separates successfully does not inherit its original
site warning. `permit_id` + `tenant` build the district-scoped VDH link;
`source: zip_centroid` identifies approximate locations; `mobile` lets the
public map hide mobile units whose permit address is not where they normally
operate.

Freshness intentionally lives only in `manifest.json`; every shard descriptor
includes path, bucket, SHA-256, byte size, and record count. Shards contain no
timestamp, so a grade-only refresh changes only the manifest and a single
facility/location edit replaces only its bucket plus the manifest. There is no
public `facilities.json` monolith or compatibility loader. The committed
artifact contract is pinned by `tests/lite-roster-contract.test.mjs`.

### Full archive contract

`cleanplateva.full-manifest.v3` points to 16 deterministic finder shards and 16
sparse signal shards. The client joins them by `permit_id` in memory. Signal
rows omit values the browser can derive or safely default:

- `score_trend` and `declining` are derived from the compact `trend` events;
- `latest_assessment` is absent when it is identical to `latest`;
- false/empty grade defaults are omitted;
- `newly_permitted` is present only when true.

Compact trend tuples are oldest-first: broad/focused events are
`["b", date, score, applicable, form]` and
`["f", date, out, addressed, form]`; narrative/unknown events are
`["n", date, verdict(, items)]` and `["u", date]`.

Facility detail files remain nested by design. Updating one inspection rewrites
one small `facility/<permitID>.json` object rather than a statewide roster, and
opening a facility still needs one history request instead of dozens. Re-issued
permits are presentation-merged into that history with lineage retained.
Details have no timestamp, so unchanged bytes preserve local mtimes and skip
R2 upload. Compact checklist rows use
`[item, disposition, flags(, override)]`, where flags are
`1 compliant | 2 violation | 4 cos | 8 repeat | 16 sentinel`; `dataClient.js`
expands them using `standards.json`.

The client accepts Contract V3 only. A failed or gated full-manifest read falls
back to the public V3 tier; a missing, incomplete, or older public manifest is
reported as unavailable. The publisher's manifest-derived inventory forbids
and deletes the retired monolithic full-roster artifact; arbitrary JSON in the
local Full cache blocks publication instead of silently becoming public.
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

Open `http://127.0.0.1:5001`. Any static server over `public/` also works. Put
an exported full tier under `public/data-full/` (gitignored) to exercise the
authenticated presentation locally. Append `?tier=lite` to force the public
experience and hide the sign-in CTA.

## Data source

Inspection records originate from the
[VDH MyHealthDepartment portal](https://inspections.myhealthdepartment.com/virginia).
The map is a prepared snapshot, not a live feed; VDH remains authoritative.
