# CleanPlateVA

A restaurant-inspection map for Virginia (Richmond metro and beyond).
Virginia Department of Health food-establishment inspections, rendered as an
interactive map with computed 0–100 scores, letter grades, and ranked red
flags per facility.

**The scores are computed, not official.** VDH publishes no numeric score;
ours is derived from the violation record of each inspection:
`100 − 6 × risk-factor violations (form items 1–29) − 2 × good-retail-practice
violations (items 30+)`, repeat violations weighted ×1.5, floored at 0.
Grades: A ≥90 · B ≥80 · C ≥70 · D ≥60 · F <60. Every score surface in the UI
is labeled "computed".

## Architecture

Fully static — no server. The site is the contents of [`public/`](public/):

- **MapLibre GL JS** front-end: CARTO vector basemaps (light + dark),
  clustered grade-colored markers, map/list view toggle, search + zip +
  grade filters, and a facility detail panel with full inspection history —
  violations, corrective actions, the food-code checklist, temperature logs,
  and a score sparkline.
- **Data snapshots** published by a separate collection pipeline as plain
  JSON under `public/data/`:
  - `data/facilities.json` — the full facility roster, shaped for map
    markers: `{available, facilities: [...], counts, fetched_at}`
  - `data/facility/<permitID>.json` — one facility + its full inspection
    history, with re-issued permits pre-merged:
    `{available, facility, inspections, fetched_at}`
  - `data/standards.json` — the food-code checklist vocabulary
    (`item → {category, text}`). Inspection checklists are stored compact —
    each row is `[item, disposition, flags(, override)]` with a bitmask
    (`1 compliant | 2 violation | 4 cos | 8 repeat | 16 sentinel`) — and
    decoded against this vocabulary in the browser (`app.js`).

The site never fetches from VDH or any live source; it reads only the
published snapshot.

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
works just as well (e.g. `python -m http.server -d public`). Without data
snapshots in `public/data/`, the UI loads and reports "no data published
yet".

## Data source

Inspection records originate from the
[VDH MyHealthDepartment portal](https://inspections.myhealthdepartment.com/virginia)
(public records). The app serves an archived snapshot; each facility panel
links back to the official VDH record.
