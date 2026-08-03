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

The site is a static MapLibre client. A small Cloudflare Worker
([`src/worker.js`](src/worker.js)) serves [`public/`](public/) and proxies
authenticated full-data reads from R2. It never queries VDH or CouchDB at
request time.

Prepared data uses explicit Contract V2 manifests:

```text
public/data/
├── manifest.json                 # freshness + finder digest/size/count
└── facilities.json               # stable 12-field public finder

/data-full/ (private R2)
├── manifest.json                 # atomic snapshot pointer
├── finder/<bucket>-<hash>.json   # identity/location/status shards
├── signals/<bucket>-<hash>.json  # sparse grade/inspection-signal shards
├── standards.json                # shared checklist vocabulary
└── facility/<permitID>.json      # one facility's nested inspection history
```

The exporter uploads changed data objects first and publishes `manifest.json`
last. Content-addressed finder/signal shards are immutable; the Worker gives
them a long browser-private cache while the mutable manifest and detail objects
revalidate quickly. The previous manifest's referenced shards are retained for
one generation, so a browser holding a cached manifest never sees missing
resources during a publish.

### Public finder contract

`public/data/facilities.json` is `cleanplateva.finder.v2`:

```json
{
  "contract": "cleanplateva.finder.v2",
  "schema_version": 2,
  "available": true,
  "mode": "lite",
  "facilities": [],
  "counts": { "total": 0, "by_zip": {} }
}
```

Each facility has exactly `permit_id, name, address, address2, city, zip,
tenant, lat, lon, is_restaurant, approx, mobile`. `permit_id` + `tenant` build
the district-scoped VDH link; `approx` flags ZIP-centroid geocodes; `mobile`
lets the public map hide mobile units whose permit address is not where they
normally operate.

Freshness intentionally lives in the small `cleanplateva.finder-manifest.v2`
`manifest.json`, along with the finder's SHA-256, byte size, and record count.
Removing `fetched_at` from the multi-megabyte finder keeps it byte-identical on
days when only archive/grade data changed. The committed artifact contract is
pinned by `tests/lite-roster-contract.test.mjs`.

### Full archive contract

`cleanplateva.full-manifest.v2` points to 16 deterministic finder shards and 16
sparse signal shards. The client joins them by `permit_id` in memory. Signal
rows omit values the browser can derive or safely default:

- `score_trend` and `declining` are derived from the compact `trend` events;
- `latest_assessment` is absent when it is identical to `latest`;
- false/empty grade defaults are omitted;
- `newly_permitted` is present only when true.

Compact trend tuples are oldest-first: broad/focused events are
`["b", date, score, applicable, form]` and
`["f", date, out, applicable, form]`; narrative/unknown events are
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

The client accepts Contract V2 only. A failed or gated full-manifest read falls
back to the public V2 tier; a missing, incomplete, or older public manifest is
reported as unavailable. R2 contains no monolithic full-roster artifact.

## Inspection and grade semantics

Each inspection is classified from distinct numbered, non-sentinel form items:
`broad` (20+, grade/trend eligible), `focused` (1–19, targeted outcome), or
`unknown` (no trustworthy checklist breadth). `form_item_count` owns breadth;
`applicable_item_count` separately counts distinct IN/OUT items. N/A and N/O
can prove breadth but are never compliant passes.

An inspection has a deterministic 0–100 score and never a letter. A facility
grade is a score plus A–F letter anchored to its newest broad assessment and
adjusted by later focused re-checks. A scope-unknown follow-up may carry an
audited `adjudication {status, verdict, items?}` when the outcome exists only in
the inspector's written comments. The About view documents the formula,
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
