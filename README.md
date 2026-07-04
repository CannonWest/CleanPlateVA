# CleanPlateVA

A restaurant-inspection map for the Richmond, VA area (Henrico / West End).
Virginia Department of Health food-establishment inspections, rendered as an
interactive map with computed 0–100 scores, letter grades, and ranked red
flags per facility.

**The scores are computed, not official.** VDH publishes no numeric score;
ours is derived from the violation record of each inspection:
`100 − 6 × risk-factor violations (form items 1–29) − 2 × good-retail-practice
violations (items 30+)`, repeat violations weighted ×1.5, floored at 0.
Grades: A ≥90 · B ≥80 · C ≥70 · D ≥60 · F <60. Every score surface in the UI
is labeled "computed".

## What's here

- **Flask** backend serving a read-only JSON API (`/api/food/facilities`,
  `/api/food/facility`) over an archived inspection snapshot — never a live
  feed, and never a scraper. Data collection happens in a separate pipeline.
- **MapLibre GL JS** front-end: CARTO vector basemaps (light + dark),
  clustered grade-colored markers, map/list view toggle, search + zip +
  grade filters, and a facility detail panel with full inspection history —
  violations, corrective actions, the food-code checklist, temperature logs,
  and a score sparkline.

## Status

The UI is in place; the data layer is not wired up yet. The API endpoints
return `available: false` until a data source is configured.

## Running locally

```
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5001.

## Data source

Inspection records originate from the
[VDH MyHealthDepartment portal](https://inspections.myhealthdepartment.com/virginia)
(public records). The app serves an archived snapshot; each facility panel
links back to the official VDH record.
