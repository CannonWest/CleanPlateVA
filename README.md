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
  (`public/data/facilities.json` — 10 identity/location fields per active
  facility).
- **Full (authenticated)** — the complete archived inspection history with
  computed scores, letter grades, violation detail, food-code checklists,
  and temperature logs, rendered in the same UI. Served from a private
  channel at `/data-full/*` that anonymous visitors can't reach; the page
  tries it first and falls back to lite. The full-tier data is never
  committed to this repository.

## Architecture

Fully static — no server. The site is the contents of [`public/`](public/):
a MapLibre GL front-end (CARTO vector basemaps, light + dark, clustered
markers, map/list toggle) over plain JSON fetched at load.

Public data contract (`public/data/facilities.json`):
`{available, mode: "lite", facilities: [...], counts: {total, by_zip},
fetched_at}` — each facility carries `permit_id, name, address, address2,
city, zip, lat, lon, is_restaurant, approx` and nothing else. `permit_id`
exists to build the VDH link; `approx` flags markers that only geocoded to
a zip centroid.

Full-tier contract (same shapes the UI renders in full mode, served
privately): a rich `facilities.json`, per-facility
`facility/<permitID>.json` histories with re-issued permits pre-merged, and
`standards.json` — the food-code checklist vocabulary against which the
compact checklist rows (`[item, disposition, flags(, override)]`, bitmask
`1 compliant | 2 violation | 4 cos | 8 repeat | 16 sentinel`) are decoded
in the browser.

The site never fetches from VDH or any live source; it reads only archived
snapshots published by a separate collection pipeline.

## Hosting

Deployed on Cloudflare Workers (static assets, no worker code — see
[`wrangler.jsonc`](wrangler.jsonc)) at
[cleanplateva.com](https://cleanplateva.com). The Workers Builds git
integration runs `npx wrangler deploy` on every push to `main`; no build
step.

## Running locally

```
pip install -r requirements.txt   # flask, dev server only
python app.py
```

Then open http://127.0.0.1:5001. Any static file server over `public/`
works just as well (e.g. `python -m http.server -d public`). The committed
lite payload renders the finder; to exercise full mode, place full-tier
data under `public/data-full/` (gitignored).

## Data source

Inspection records originate from the
[VDH MyHealthDepartment portal](https://inspections.myhealthdepartment.com/virginia)
(public records). The map is a snapshot, not a live feed; each facility
links back to the official VDH record.
