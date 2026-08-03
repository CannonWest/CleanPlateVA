# CleanPlateVA

A finder map for Virginia food establishments (Richmond metro and beyond),
built from Virginia Department of Health inspection records. Every marker
links to the establishment's official VDH inspection record.

## Two tiers, one site

The deployed page serves two audiences from the same code:

- **Lite (public, the default)** — a gray finder map: facility names,
  locations, a search box, a zip filter, and a hand-off link to the official
  VDH record for each place. No scores, no inspection content — inspection
  reports live on VDH's portal, this map just helps you find them. Powered
  by the one data file committed to this repo
  (`public/data/facilities.json` — a 12-field identity/location contract per
  active facility, including the VDH tenant route and mobile-unit flag).
- **Full (authenticated)** — the complete archived inspection history with
  raw computed scores, scope-qualified letter grades, violation detail, food-code checklists,
  and temperature logs, rendered in the same UI. Served from a private
  channel at `/data-full/*` that anonymous visitors can't reach; the page
  tries it first and falls back to lite. The full-tier data is never
  committed to this repository.

## Architecture

Static client, no application server or live data API. A small Cloudflare
Worker ([`src/worker.js`](src/worker.js)) serves the contents of
[`public/`](public/) and routes authenticated `/data-full/*` reads to R2. The
client is MapLibre GL (CARTO vector basemaps, light + dark, clustered markers,
map/list toggle) over prepared JSON fetched at load.

Public data contract (`public/data/facilities.json`):
`{available, mode: "lite", facilities: [...], counts: {total, by_zip},
fetched_at}` — each facility carries exactly `permit_id, name, address,
address2, city, zip, tenant, lat, lon, is_restaurant, approx, mobile` and
nothing else. `permit_id` + `tenant` build the district-scoped VDH link;
`approx` flags ZIP-centroid geocodes; `mobile` lets the public map hide mobile
food units whose permit address is not where the unit normally parks. The
artifact contract is pinned by `tests/lite-roster-contract.test.mjs`.

Full-tier contract (same shapes the UI renders in full mode, served
privately): a rich `facilities.json`, per-facility
`facility/<permitID>.json` histories with re-issued permits pre-merged, and
`standards.json` — the food-code checklist vocabulary against which the
compact checklist rows (`[item, disposition, flags(, override)]`, bitmask
`1 compliant | 2 violation | 4 cos | 8 repeat | 16 sentinel`) are decoded
in the browser.

Full roster records carry `latest`, `latest_assessment`, `grade`,
`score_trend`, `declining`, and a compact oldest-first `trend` event sequence.
Broad/focused tuples are `["b", date, score, applicable, form]` and
`["f", date, out, applicable, form]`; narrative and unknown events are
`["n", date, verdict(, items)]` and `["u", date]`. Detail files intentionally
have no `fetched_at`: the snapshot timestamp lives once on the roster so an
unchanged facility remains byte-identical and R2 delta publishing can skip it.

Each inspection is classified from distinct numbered, non-sentinel form items:
`broad` (20+, grade/trend eligible), `focused` (1–19, targeted outcome with
an OUT/applicable ratio colored by compliance and the raw formula shown
secondarily), or `unknown` (zero/no checklist, no grade or breadth claim).
`form_item_count` owns breadth; the separate `applicable_item_count` counts
distinct IN/OUT items and owns the focused denominator. N/A and N/O rows can
prove form breadth but are never compliant passes.
A scope-unknown **follow-up whose verdict lives only in the inspector's
written comment** may carry an `adjudication {status, verdict, items?}`
block — the comment translated into a machine verdict by a separate,
audited pipeline step. The UI renders it as the row's ✓/✗ badge and
verdict chip, and as a filled diamond on the sparkline at the height the
verdict describes ("all corrected" at the r100 line, "not corrected" at
r0); hollow diamonds remain focused checklist re-checks.

Facility records keep the chronological `latest` event, one
`latest_assessment`, a broad-only `score_trend` / `declining` signal, and
the computed `grade` block — the facility's score + A–F letter: the latest
broad assessment adjusted by follow-up re-checks through **both** channels
(structured checklists and adjudicated written verdicts; the block's
`narrative_followups` / `narrative_items` fields carry that provenance,
surfaced in inspection verdicts, the trend, and the grade-receipt breakdown).
The methodology view on the site documents the full formula, the adjustment
ladder, and the written-verdict rules.

The site never fetches from VDH or any live source; it reads only archived
snapshots published by a separate collection pipeline.

## Hosting

Deployed on Cloudflare Workers ([`src/worker.js`](src/worker.js) plus static
assets and the private R2 binding configured in
[`wrangler.jsonc`](wrangler.jsonc)) at
[cleanplateva.com](https://cleanplateva.com). The Workers Builds git integration
runs `npx wrangler deploy` on every push to `main`; no build step.

## Running locally

```
pip install -r requirements.txt   # flask, dev server only
python app.py
```

Then open http://127.0.0.1:5001. Any static file server over `public/`
works just as well (e.g. `python -m http.server -d public`). The committed
lite payload renders the finder; to exercise full mode, place full-tier
data under `public/data-full/` (gitignored). To preview the anonymous
(lite) experience while full-tier data is on disk, append `?tier=lite` —
the page then skips the full channel entirely and hides the sign-in CTA.

## Data source

Inspection records originate from the
[VDH MyHealthDepartment portal](https://inspections.myhealthdepartment.com/virginia)
(public records). The map is a snapshot, not a live feed; each facility
links back to the official VDH record.
