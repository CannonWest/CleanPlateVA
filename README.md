# CleanPlateVA

A standalone, single-purpose public implementation of the CannonAI **Food** tab —
the Henrico/West-End Richmond restaurant-inspection map. Same data, same scoring,
no CannonAI shell around it.

## Relationship to the rest of CannonGround

- **Data source**: `cannon_food_facilities` / `cannon_food_inspections` in CouchDB,
  built by the [cannon-food](../cannon-food/SKILL.md) pipeline (VDH MyHealthDepartment
  scrape → geocode → score → load). This app reads that data; it does not scrape.
- **Pattern reference**: CannonAI's `cannonai/food/` module (Leaflet map,
  score-colored markers, facility detail panel, read-time re-permit merge in
  `facilities.py`) is the design to port from. CannonAI isn't checked out on this
  machine, so porting the exact route/template logic is a later step.
- **Scoring**: computed, not VDH's (`references/scoring.md` in cannon-food) —
  `100 − 6×risk-factor − 2×GRP violations`, repeats ×1.5. Must always be labeled
  "computed score" in the UI, never implied official.
- **Target domain**: `cleanplateva.com` (Cloudflare zone created 2026-07-03).
  Deployment will follow the same pattern as the existing
  `cannonai.djsweetheartclubmix.com` / `cannongate.djsweetheartclubmix.com` routes —
  a local service on the ThinkPad, fronted by the `claudeground-couchdb-laptop`
  Cloudflare Tunnel plus a DNS record, once there's something worth exposing.

## Status: skeleton

Bare Flask scaffold — a working `/` route, no real data wiring yet. Building one
step at a time:

1. ~~Repo + skeleton~~ (this commit)
2. Port facility list + map (read from CouchDB, Leaflet rendering)
3. Facility detail panel (score/grade/red flags/inspection history)
4. Deploy behind the tunnel at cleanplateva.com

## Running locally

```
pip install -r requirements.txt
cp .env.example .env   # fill in COUCHDB_URL if not running alongside CouchDB
python app.py
```

CouchDB is not LAN-exposed, so this only reaches live data when run on the same
machine as CouchDB (currently the ThinkPad). Elsewhere it'll start but show no data.
