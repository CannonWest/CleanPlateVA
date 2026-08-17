# CleanPlateVA V4 — shared design reference

**Public Full behind an acknowledgement · the barest boot on both data views · real per-view URLs.**

| | |
|---|---|
| Status | **Living design reference.** Governs three sequenced arcs — **CPR** (routes) → **CPD** (boot diet / Contract V4) → **CPF** (public Full). Each arc's runway briefing cites this doc by section instead of restating it. |
| Owner | Cannon decides; the active agent (lead dev) maintains. |
| Written | 2026-08-16, against the V3 snapshot `2026-08-16T15:13:33Z` (27,919 Full markers · 24,990 Lite). Every measured number below is stamped; treat them as dated receipts, not constants. |
| Update rule | When a runway milestone resolves an entry in **§12 Open decisions**, flip its status **in this doc, same PR**. When a principle changes, change it here first, then the briefings. Superseded content is struck or moved to **§13 History**, never silently deleted. |
| Runways | `c-ground-code/runway/archive/cleanplate-routes.md` (CPR, shipped 2026-08-16) · `cleanplate-boot-diet.md` (CPD, **shipped 2026-08-17** — Contract V4 is live on both tiers) · `cleanplate-public-full.md` (CPF, **ungated**) · `cleanplate-v4-closeout.md` (CPX — the verification net + residue tripwire, gated on CPF-M3). |

The shipped contract — **Contract V4 since CPD-M3, 2026-08-17** — is documented in [`README.md`](../README.md), which is authoritative for what is *live*. This doc is authoritative for the design and for where the site is still *going* (CPF: the acknowledgement gate; CPX: the close-out sweep) and why.

---

## 1. Why this doc exists

Three things Cannon wants are one design, not three:

1. **The public should get Full.** The only gate should be an acknowledgement — *these scores are CleanPlateVA's own derivation; the underlying records belong to VDH, the address points to VGIN, etc.* — not Cloudflare Access.
2. **Both data-bearing views should boot on the barest payload their job needs.** Map needs broad-and-thin (every marker, few fields). List needs narrow-and-deep (a page of rows, richer per row). Today both boot the same 33-request, 39.66 MB-raw payload.
3. **Map and List should be real URLs** that load different data, deep-link, and survive back/forward — today only `#about` touches the URL.

They interlock: the ack boundary decides *which* data family is gated, the data families decide *what each route loads*, and the routes are the lazy-load seams. Designing any one of them alone produces a shape the other two have to undo. So this doc fixes the shared shape once; the arcs execute it in order.

## 2. Principles (durable)

These are the invariants every V4 decision must satisfy. Several are inherited from V3 and restated here only because V4 work touches them; the full V3 invariant list lives in `README.md` and `c-ground-code/memory/project_clean_plate_va.md`.

| # | Principle | Consequence |
|---|---|---|
| **P1** | **The tier boundary is judgment, not secrecy.** Judgment-free facts (identity, location, source hand-off) are public without ceremony. Judgment-bearing content (derived scores and grades, and inspection detail *as presented through our scoring*) is public **after acknowledgement**. | The ack gates a *fetch decision in the client*, not a transport secret. Lite is "the finder without judgments"; Full is "the finder plus the judgment families." |
| **P2** | **The site never computes at request time.** Static assets and prepared objects only. Every interaction after boot is a local operation. | No query server, no search API, no server-side sort. Boot must therefore carry whatever statewide search/filter needs — which is why the roster is small-and-whole, not windowed. |
| **P3** | **Small mutable pointer, immutable content-addressed payload.** Manifests revalidate on a short TTL; shard filenames embed a hash of their bytes and are cached forever. | A shard's *name* changes iff its *bytes* change. Anything cache-forever must be content-addressed; anything addressed by a stable key (details, manifests) must be short-TTL + ETag. |
| **P4** | **Full → Lite fallback is the transition mechanism.** A client that meets a manifest or shard contract it does not understand degrades to the public finder. It never renders a broken page. | Contract cutovers are *choreographed* (§8) so the worst case during a flip is a brief gray map, and there is no dual-contract compatibility path (V3 invariant, kept). |
| **P5** | **Details stay nested per facility and carry no timestamp.** One inspection rewrites one object; opening a panel is one request; unchanged bytes stay unchanged. | The hover card and the click panel read the *same* object. Nothing else duplicates per-inspection content. |
| **P6** | **Lite is judgment-free forever.** The public finder ships no scores, grades, dates, or inspection content — and, post-CPF, the pre-acknowledgement view is exactly the Lite finder. | The finder family cannot grow a judgment field "for convenience." Judgments live only in overlay / closed / detail. |
| **P7** | **Presentation merge at publish; CouchDB stays one document per permit.** | Marker identity is a *published* concept; families are keyed by the published marker's `permit_id`. |
| **P8** | **`tenant` routes VDH links.** Never hardcode `/virginia/permit/`. | `tenant` stays in the finder row (needed by List's VDH column and the panel in both tiers). |
| **P9** | **Both tiers flip atomically on their own manifest; there is no distributed transaction between them.** | Cross-tier references (a Full family binding to a public shard generation) reintroduce skew windows — avoid them (§6, D-DATA-2). |

## 3. The tier boundary, re-based

| | Today (V3, shipped) | End state (post-CPF) |
|---|---|---|
| What separates the tiers | **Access.** Full data is *secret*: `/data-full/*` requires `Cf-Access-Jwt-Assertion`, cache-control `private`. | **Acknowledgement.** Full data is *public but conditioned*: the client fetches the judgment families only after the visitor has acknowledged the terms (stored in `localStorage`); transport is public and cacheable. |
| Lite is | A separate published contract of active-only, ten-field rows. | The same finder family, rendered gray, without the judgment families. Also the explicit fallback (P4) and the `?tier=lite` dev override. |
| Full is | Finder + signals + standards + details, 33 requests at boot. | Finder + **overlay** at boot; **closed** on toggle; **detail** on hover (prefetched) / click; standards on first panel. |
| Sign-in affordance | "Sign in" button visible in Lite. | Replaced by the acknowledgement affordance ("Show inspection grades" / re-open terms). |
| Who sees judgments | Whoever holds an Access session (≈ Cannon). | Everyone who acknowledges. |

**Why this collapses cleanly:** the ack is *about* the judgments — that's what the disclaimer text disclaims — and "judgment-free vs judgment-bearing" is precisely the line Lite already draws (P6). So the tier split does not have to be merged or redesigned; it re-bases from a secrecy line to the ack line, and the finder becomes common to both.

## 4. URL scheme (CPR)

**Ratified at CPR-M0 and shipped in CPR-M1b (2026-08-16)** — every D-URL-* row in §12 is resolved and live. `public/static/js/router.js` owns the scheme below; the site declares its mount with `<base href>` (`/` in production, rewritten to `/cleanplate/` by the CannonAI passthrough) and the router reads it from `document.baseURI`, so the same client works at any mount depth.

| Route | View | Notes |
|---|---|---|
| `/` | Map — **canonical** | `/map` accepted and normalized to `/` (D-URL-1). |
| `/list` | List | Same filter set as Map plus `sort`, `dir`, `page`. |
| `/about` | About | Legacy `#about` migrates on load. |
| unknown | → `/` | Static-asset `not_found_handling: "single-page-application"` serves `index.html`; the client `replaceState`-normalizes unknown paths (D-URL-2). Mirrored by `app.py` and the CannonAI mount. **The SPA setting is all-or-nothing** — measured on production 2026-08-16, it also answers a missing `/data/finder/*.json` (or a mistyped `.js`) with `200 text/html`, which would have `dataClient` parsing markup as JSON — so `src/worker.js` re-404s asset-shaped paths (non-HTML extension in the last segment) that come back as the shell. That correction only applies where the worker actually runs, which `run_worker_first` sets: **`/data/*`**, chosen because the data channel is where a masked 404 is silent and it already routes through the worker for cache-control. Static assets stay on the assets fast path (a miss there is an immediate console MIME error; a per-file worker invocation would cost request quota). `app.py` and the CannonAI mount decide before serving, so they have no such split. |

**Query state (both views unless noted):** `q` (search) · `zip` · `grade` · `restaurants` · `closed` · `new` · `mobile` · `permit` (selected facility → panel open) · List-only `sort`, `dir`, `page` · Map-only stretch: viewport as `#@lat,lon,z` (deferred; D-URL-3). With List paging decided as load-more (D-DATA-11), `page=N` means "N chunks of 50 revealed" — a load-more position stays deep-linkable; it resets when filters or sort change.

**Precedence:** URL wins when present; toggles keep persisting to `localStorage` as the default for URLs that omit them; the client writes only non-default state into the URL so shared links stay short (D-URL-4).

**"Non-default" is measured against what an omitted key falls back to** — which for the four toggles is the visitor's *persisted* value, not the shipped one. That is what makes the address bar reload-stable: `?closed=0` survives over a persisted `closed=1` (drop it and a refresh would silently flip the toggle back), while a toggle that already matches storage stays out of the URL. Toggle preferences remain the visitor's; the content state (place, filters, sort, page, selection) is what a shared link carries. The URL never writes `localStorage` — only the visitor's own clicks persist.

**History:** `pushState` on a view change and on selecting a facility, so Back returns to the previous view / closes the panel; `replaceState` for filter, sort, and page writes and for the load-time normalization, so filter churn never spams history. Inside the CannonAI frame everything is `replaceState` — the parent owns its history — and the frame's URL still tracks the view so a reload or a copied link lands where the visitor was.

**Deployment consequences**

- `wrangler.jsonc` `assets` gains `"not_found_handling": "single-page-application"`. **`run_worker_first` in array form is the complete set of paths that invoke the Worker** (Cloudflare: "define the routes that invoke your Worker explicitly"; it also opts out of the `Sec-Fetch-Mode` heuristic) — so it must list *both* channels the Worker owns, `/data/*` and `/data-full/*`. The full channel is not a static asset; before the SPA fallback a miss fell through to the Worker on its own, and the fallback removed that path. Measured 2026-08-16 (post-#107): the un-Access-gated `www` host answered `/data-full/manifest.json` with the HTML shell instead of the Worker's 403, i.e. the authenticated tier was degrading to gray Lite; hotfixed by adding `/data-full/*` (PR #108) and pinned by `tests/worker-cache-contract.test.mjs`. **CPF-M2 must keep both entries** when it rewrites the Worker's cache posture. Side fact for CPF-M0/M3: the Access application is scoped to the apex host only — `www.cleanplateva.com/data-full/*` reaches the Worker unauthenticated, where the JWT check (defense-in-depth) is what returns 403.
- **CannonAI embed (shipped, D-URL-6):** `cleanplate_site` now falls back to `index.html` for extension-less paths and rewrites the served `<base href>` to `/cleanplate/` on the way out — so `/cleanplate/list` works on a hard reload without a second committed `index.html`, and the checkout's own file stays the deployable one. The Food tab's iframe carries the sub-route: it re-reads the frame's location (same-origin) so Reload and the tier toggle keep the visitor's view instead of snapping back to the map, and "open in a new tab" opens what is on screen.
- The `?tier=lite` override is orthogonal to routes and survives.

**Module split (decided 2026-08-16, Cannon; shipped CPR-M1a the same day):** `foodDashboard.js` was one 3,866-line class; its own section markers showed the seams. CPR-M1a split it into per-concern ES modules with **zero behavior change** — `constants` · `stacks` · `presentation` · `receipt` (pure) and `map` · `markers` · `hover` · `filters` · `list` · `about` · `detail` · `sparkline` · `inspection` (method bundles installed on `FoodDashboard.prototype`), with `foodDashboard.js` left as the ~370-line orchestrator (constructor, toolbar wiring, load/refresh, view switch) that re-exports the pure helpers. Method bodies moved verbatim; the 16 `node --test` suites (193 tests) and a dark-mode DOM/text fingerprint of Map / hover / panel / receipt / List / About in both tiers were byte-identical before and after. CPD's rewrites of the List, hover card, and presentation layer now land in small named files. Insurance, not a feature.

## 5. View → data-need matrix

What each surface needs, which family carries it, and *when* it is fetched. This is the table the routes and the exporter both serve.

| Surface | Needs | Family | When |
|---|---|---|---|
| **Map boot** | coordinates · name/address/city/zip (search) · `tenant` · `is_restaurant` · `mobile` · approximate-location bit | **finder** | boot (both tiers) |
| | grade score (marker color, A–F chips) · `newly_permitted` · status | **overlay** | boot, **after ack** (Full) |
| **Map hover card** | grade + last-visit and last-broad dates + the NEW / no-grade hero text (scope, item count) — *instant* | overlay | already in memory |
| | trend sparkline — *enriched* | **detail** | prefetched on hover, no dwell (D-DATA-10, resolved) |
| **Map click panel** | full nested history + checklist decode | detail + standards | click (free if hover already prefetched); standards memoized on first panel |
| **List boot** | everything Map boot needs, plus sort/columns: compliance %, trend delta, latest date + scope + OUT ratio | finder + overlay | boot |
| **List page** | a page of the sorted, filtered rows | (in memory) | client-side slice; no fetch |
| **List row click** | detail | detail | click |
| **"Show closed" on** | the non-active permits (finder + overlay shape) | **closed** | lazy, first toggle-on (off by default → boot never pays) |
| **About live cards · footer freshness** | totals · by-grade · by-zip · snapshot time · **newest held report** | **manifest** | boot (`newest_report` moves into the manifest — today the footer scans every `latest.date` client-side, which the diet removes) |
| **Lite / pre-ack / `?tier=lite`** | finder only | finder | boot |

Map is *broad and thin*: every marker, ~10 fields. List is *narrow and deep only at the row you open*: its whole-population needs are the four thin sort keys, which ride the overlay; depth is per-row on click. That is why List does not need its own family or a server (see §10 rejects 4–5).

## 6. Data families — Contract V4

### 6.1 The families

| Family | Tier | Rows | Keyed / addressed by | Cache | Loaded | V3 predecessor |
|---|---|---|---|---|---|---|
| **`manifest.json`** (public) | Lite | — | stable name | `public, max-age=60, must-revalidate` | boot | `finder-manifest.v3` |
| **`manifest.json`** (Full) | Full | — | stable name; **atomic pointer, publishes last** | short TTL | boot | `full-manifest.v3` |
| **`finder/<bucket>-<hash>.json`** ×16 | **both** | active permits, judgment-free identity/location rows | `permit_id` (sha256-bucketed, sorted) | immutable | boot | `finder-shard.v3` (Lite) + the identity half of `full-finder-shard.v3` |
| **`overlay/<bucket>-<hash>.json`** ×16 | Full | one row per finder row: status · grade score · new · compliance · trend delta · latest date/scope/OUT | **position-aligned to `finder/<bucket>`**, sha-bound in the manifest (D-DATA-5) | immutable | boot after ack | the thin subset of `full-signal-shard.v3` |
| **`closed/<bucket>-<hash>.json`** ×N | Full | non-active permits, finder+overlay-shaped rows inline | `permit_id` | immutable | lazy on "Show closed" | the ~2,900-row Lite/Full gap |
| **`standards.json`** | Full | checklist vocabulary | stable name | short TTL | first panel | unchanged |
| **`facility/{permit_id}.json`** ×27,919 | Full | nested history (V3 shape retained unless CPD-M0 finds cause; D-DATA-8) | `permit_id` | `max-age=300` + ETag | hover (prefetch) / click | unchanged |
| ~~`signals/*`~~ | — | — | — | — | — | **retired.** Its `trend` tuples were a hover-latency optimization; hover-fetch of the detail makes them redundant. This family is 27.7 MB of the 39.7 MB V3 raw boot. |

**Manifest additions (both):** top-level `freshness: { snapshot_id, newest_report }` (D-DATA-9, resolved) and a `vocab` block for the row code tables (`permit_type` → `pt`, `loc`, `scope`). **Full manifest resources:** `finder`, `overlay`, `closed`, `standards`, `details.path_template` — and the publisher's inventory guard derives the only legal R2 object set from exactly this list, as it does today.

### 6.2 Row shapes (ratified CPD-M0, 2026-08-16 — measured by `cannon-food/tools/developer/cf_v4_prototype.py`)

**finder row** — an object (D-DATA-3: positional measured −7.5% wire, under the pre-registered ≥15% bar), coordinates rounded to **6 dp at export** (D-DATA-4; Couch keeps 9): `{permit_id, name, address, address2, city, zip, tenant, is_restaurant, mobile, pt, lat, lon, loc}`. `pt` is a small-int **`permit_type` code** into a vocabulary the manifest publishes (D-DATA-6, Cannon: keep both booleans *and* add the code — `mobile` ≡ "Mobile Food Unit" exactly, but 689 of 6,725 non-restaurants are denied by name pattern alone, so `is_restaurant` can never be derived from the code); `loc` is a 3-class location code (0 rooftop-quality · 1 street-level `census_*` · 2 `zip_centroid`) — the "approximate-location bit" generalized at zero cost so the panel's street-level note keeps working from the finder. Moved to detail (which already carries the full `location` dict): `precision`, `source`, `site_source`, `site_lat`/`site_lon`, `site_group_id`, `site_count` — same-coordinate stacks are computed client-side from coordinates (`stackKey`), and the shared-point notice depends on current effective coordinates, not historical site count. Measured: 276 B/row raw, **65.4 B/row wire**.

**overlay row** — positional, one per finder row, letter *derived* (`gradeForScore(score)`, never shipped), **nine fields = the union of what Map and List read at boot** (a Map-only / List-only split was measured at 10 KB apart and rejected — one family): `[grade_score|null, new (0/1), trend_delta|null, latest_yyyymmdd|null, base_yyyymmdd|null, latest_scope_code (0 unknown · 1 broad · 2 focused), latest_out|null, latest_items|null, compliance_pct|null]`. Map reads grade/new/delta (marker colour, NEW badge, declining ring), latest + base dates and scope/items (the hover hero's "Last broad inspection · Last visit" boxes and its NEW / no-grade text); List reads grade/new/delta/latest/scope/out/items/compliance (score, trend arrow, event line, compliance column). `latest_items` is `addressed_item_count` for a focused visit and `applicable_item_count` for a broad one (the client's `count`). **No `status_code`**: the finder is active-only, so every overlay row's status was measured to be literally `Permitted`; status rides on closed rows. **No series at boot**: the hover sparkline comes from the detail prefetched on hover (D-DATA-10) — shipping the V3 trend tuples would have added 0.53 MB, a broad-only score series 0.09 MB. The shard envelope carries `finder_sha256` of the finder shard it aligns to (D-DATA-5). Measured: 43 B/row raw, **8.6 B/row wire**.

**closed row** — the finder object fields + `status` + `o: [overlay row]` inline (never shared with Lite, so no split needed). Measured 336 B/row raw, 87 B/row wire; 2,929 rows.

**Manifest additions (both tiers):** top-level `freshness: {snapshot_id, newest_report}` (D-DATA-9) and a `vocab` block naming the code tables the rows use (`permit_type` for `pt`, `loc`, `scope`).

**Found while measuring, fixed in CPD-M1:** the V3 roster projection publishes `compliance_rate` / `checklist_out` / `checklist_compliant` / `cos` as `null` on 100% of markers — every inspection doc carries those keys top-level as `null`, and `_shape_marker_inspection` uses `insp.get(k, cs.get(…))`, whose default never fires for a present-but-null key — while `checklist_summary` carries them on ~88K of 97K inspections. The detail reads `checklist_summary` directly and is unaffected. M1 prefers the non-null value, pinned by a test; the List's Compliance column lights up for the first time (under V3 too, from the next publish).

**Sharding is unchanged:** `bucket = int.from_bytes(sha256(permit_id)[:4], "big") % 16`, rows sorted by `permit_id`, filename `<bucket>-<sha256(bytes)[:12]>.json`. Even split (V3: 1,679–1,810 rows/bucket) with no rebalancing logic; a permit's bucket never moves.

### 6.3 Shared finder — the two ways to share

The finder is *one contract, one exporter path, one tripwire test* for both tiers. Whether Full literally fetches the *public URLs* is a separate choice (D-DATA-2):

- **Same URL** — Full manifest points at `/data/finder/*`. Saves R2 storage (14 MB — trivial) and lets a Full visitor's cache reuse public shards, but binds a Full family to a public generation across two transports → every daily publish opens a skew window (git deploy vs R2 flip) in which a position-keyed overlay misaligns and the client must degrade to gray. Violates P9.
- **Same bytes, republished under `/data-full/`** — Full manifest names the same content-addressed shard files, uploaded to R2 alongside the overlay. Each tier is atomic on its own manifest; no cross-transport binding; no daily skew. **Recommended.** Post-CPF, `/data-full/*` is public and cached too, so the "reuse" advantage of same-URL mostly disappears anyway.

## 7. Boot budget — V3 measured, V4 measured (CPD-M0) and live (CPD-M3)

**Measured 2026-08-16 by `cannon-food/tools/developer/cf_v4_prototype.py`** against the live archive (28,561 facility docs → 27,919 markers → 24,990 active + 2,929 closed; snapshot of the same day) with the *ratified* V4 row shapes of §6.2, and against the V3 materialized view (`public/data-full/`) + committed Lite shards **with the same compressor** so the columns are comparable. Units: **MB = 10⁶ bytes throughout** (the earlier version of this table mixed MB and MiB — 39.66 was MiB; the same bytes are 41.59 MB). gzip = level 6; wire = **brotli q4**, calibrated the same day against the live edge (cleanplateva.com served br at 0.91 × gzip-6 on the V3 finder shards; q4 reproduces 0.90 locally). Modern browsers receive brotli.

| Payload | requests | raw | gzip-6 | **wire (br q4)** | vs V3 |
|---|---|---|---|---|---|
| V3 Lite boot (manifest + 16 finder) | 17 | 11.40 MB | 2.44 MB | 2.21 MB | — |
| V3 Full boot (manifest + 16 finder + 16 signals) | 33 | 41.59 MB | 7.68 MB | 6.71 MB | — |
| · V3 Full finder alone (498 B/row raw · 90.8 B wire) | 16 | 13.91 MB | 2.83 MB | 2.53 MB | |
| · V3 signals alone (991 B/row raw · 149.5 B wire) | 16 | 27.67 MB | 4.85 MB | 4.17 MB | |
| **V4 Lite boot** (manifest + 16 finder) | 17 | 6.90 MB | 1.77 MB | **1.64 MB** | **74%** |
| **V4 Full boot** (manifest + 16 finder + 16 overlay) | 33 | 7.99 MB | 1.95 MB | **1.85 MB** | **28%** |
| · V4 finder — both tiers (276 B/row raw · 65.4 B wire) | 16 | 6.89 MB | 1.76 MB | 1.63 MB | |
| · V4 overlay — Full (43 B/row raw · 8.6 B wire) | 16 | 1.08 MB | 0.19 MB | 0.21 MB | |
| V4 closed supplement — lazy, on first "Show closed" (2,929 rows) | 16 | 0.98 MB | 0.25 MB | 0.26 MB | new |
| V4 manifests (public · Full) | 1 · 1 | ~0.01 MB each | | ~0.005 MB | |
| Detail corpus — unchanged under V4 (D-DATA-8); n=1000 sample | 27,919 | 425.8 MB on disk · p50 12.7 KB · p90 27.8 KB | | **p50 2.9 KB · p90 5.9 KB** | |

The design's targets (~1.6 / ~2.0 MB) were met: Lite lands on target, Full beats it. **Live since 2026-08-17 03:50Z** — the cutover publish rebuilt these families from the same archive (Lite 24,990 rows; Full 24,990 + 2,929 closed) and R2 holds exactly the manifest-derived V4 inventory (second dry-run: 0 uploads). Retiring signals removes 4.17 MB of wire (62% of the V3 Full boot); the overlay adds back 0.21 MB. Alternatives measured and not taken (all in the prototype's report): positional finder rows −7.5% wire (−42% raw); a Map-only / List-only overlay split −10 KB on the Map boot; the V3 trend tuples at boot +0.53 MB (broad-score series only +0.09 MB); GUID-keyed overlay +0.50 MB, 8-hex-hash-keyed +0.11 MB; closed as one file −0.05 MB; 9-dp coordinates +0.08 MB; a code-only filter field ±0.02 MB.

**A cost that does not go away:** grades change on every publish and permits scatter across buckets by hash, so all 16 overlay (and most finder) shard names rotate essentially daily — (1 − (15/16)^100) ≈ 99.8% per bucket at 100 changed permits. `immutable` makes caching *correct*, not *warm*; a daily visitor re-pays most of the boot each day. Proportional to the slim payload, so acceptable; just never describe the shards as "cached across days."

## 8. Cutover mechanics (CPD-M3)

The choreography that makes P4 the safety net rather than a broken page:

1. **The publisher runs the site repo's committed Lite contract test as a gate and refuses non-clean / non-`main` / unsynced checkouts.** So the V4 client, the V4 Lite tripwire test, *and* the V4 Lite data (materialized locally by the V4 exporter) must land in **one site PR**. Merge deploys client + Lite data atomically through Workers Builds. → D-CUTOVER-1: same-PR, not a transitional dual-accept.
2. **Then** run `cf_publish_cleanplate.py` for R2. Between (1) and (2), the new client meets the V3 Full manifest → rejects it → renders V4 Lite (gray). Never broken. When the R2 manifest flips, the next load is Full V4.
3. The publisher must recognize "Lite already at this generation" instead of producing a second data-only commit (D-CUTOVER-2 — idempotence on shard shas).
4. After the flip, the inventory guard treats `signals/*` as stray: retained for the one-generation grace the V3 publisher already implements, then pruned. `public/data-full/` (the persistent local materialized view) drops the family the same way.
5. The reverse order (R2 first) also degrades to gray rather than breaking (old client rejects V4 Full → V3 Lite), but the publisher's own gates make it unreachable — the site's committed test would still be V3 and would fail V4 Lite output. **Site PR first is therefore the only sequence.**

## 9. Transport and caching in the public-Full end state (CPF)

- **Worker:** drop the `Cf-Access-Jwt-Assertion` check; `/data-full/*` cache-control flips `private` → `public` with the same TTL shape (manifest 60 s revalidate · content-addressed shards `immutable` · details `max-age=300` + ETag). The site's `worker-cache-contract.test.mjs` is updated in the same PR.
- **Edge caching:** Worker responses are **not** CDN-cached by default. Two options (D-TRANSPORT-1): the Worker uses the Cache API (`caches.default`) for GET hits — smallest change, one origin, no CORS; or Full data moves to an **R2 public custom domain** (e.g. `data.cleanplateva.com`) with Cloudflare cache in front and no Worker in the data path. **Plan tier matters:** Workers Free caps at 100K requests/day and Cache API hits still invoke the Worker; the R2 custom domain does not. CPF-M0 establishes the plan tier before choosing.
- **Access app:** retired only after client and Worker no longer depend on it (D-TRANSPORT-3). Cannon fires the dashboard/connector action; the agent verifies nothing 403s afterward.
- **The git Lite channel** (`public/data/`) stays through CPF for defense-in-depth availability. Whether it is retired afterward — making R2 the sole data transport and ending the daily "Data refresh" commits + redeploys — is D-TRANSPORT-2, deliberately *not* a CPF precondition.

## 10. Considered and rejected

Written down so no future session re-litigates them without new evidence.

1. **Geo-tiled sharding for first paint.** Statewide name/address search at boot needs the whole roster; geo-tiles would force a second identity copy (a search index) → more total bytes for a faster first frame. Not worth it at ~2 MB. Revisit only if the finder cannot get under ~3 MB wire.
2. **Committing Full to git / static assets.** 27,919 detail objects (406 MB) that churn daily is the wrong channel for git; it also exceeds the Workers Free static-asset cap of 20,000 files (100,000 on Paid, since 2025-09). R2 stays the detail transport.
3. **A separate "hover stub" family.** The detail already carries what hover needs at ~4 KB wire p50; a stub family adds a publisher family, inventory rules, and change-set mapping to save ~15 bytes per visit. Prefetch the detail instead; the click becomes free.
4. **Pre-sorted index families for List.** The sort keys are thin enough to ride the overlay; the client sorts ~25K numerics in ~10 ms. Only if List gains a sort key that cannot fit the overlay.
5. **A server-side search/query API.** Violates P2 and requires a backend to exist, scale, and be secured. The whole point of the boot payload is that no such server exists.
6. **Shipping the grade letter.** It is `gradeForScore(score)`; ship the score only. (Inspections have scores; facilities have grades — no per-inspection letters, ever.)
7. **Same-URL shared finder** — see §6.3; rejected on P9 (daily skew window).
8. **Bigger page caps instead of pagination.** Today List sorts everything and shows the first 600. Client-side pagination over the in-memory sorted array is strictly better and needs no data change.

## 11. The arcs and their gates

| Arc | Briefing | Lands | Gate |
|---|---|---|---|
| **CPR** — routes ✅ **complete 2026-08-16** | `cleanplate-routes.md` | M0 ratify §4 + adopt §5 ✅ · M1a module split ✅ (PR #104) · M1b routes, URL state, load-more paging, SPA + embed fallbacks ✅ | none — fired first |
| **CPD** — boot diet / Contract V4 ✅ **complete 2026-08-17** | `cleanplate-boot-diet.md` | M0 measure + design ✅ (`cf_v4_prototype.py`; §7 measured; D-DATA-1..9, -12, D-CUTOVER-3 resolved) · M1 cannon-food emits V4 flag-gated ✅ (cground-skills #1667) · M2 site V4 client ✅ built + held (CleanPlateVA #111) · **M3 cutover ✅ 2026-08-17 03:50Z** — cannon-food V3 retirement (#1668) → #111 merged (client + Lite data deployed ~30 s) → `cf_publish_cleanplate.py --full --run-id cpd-m3-cutover --apply` (dry-run reviewed: 48 shards + 26,999 details + manifest, delete 0 → 27,047 uploads, 0 deletes, 643 s) → verified (R2 `full-manifest.v4` 27,919 = 24,990 + 2,929; second dry-run 0 uploads / 32 deletes = the retained V3 generation; public manifest V4) → D-CUTOVER-2 landed (#1669) · M4 stretch not needed | **shipped** — CPF ungated |
| **CPF** — public Full | `cleanplate-public-full.md` | M0 terms copy + attribution inventory (Cannon's voice; agent drafts) + plan-tier check · M1 ack UX (modal, `localStorage`, decline → Lite, replaces sign-in button, About/footer wording, embed behavior) · M2 transport per §9 · M3 Access app retirement + verification + README/memory · M4 observe volume/hit rates; consider D-TRANSPORT-2 | **gated on CPD-M3** — public boot must be slim, and the overlay *is* the ack-gated family |
| **CPX** — V4 close-out sweep | `cleanplate-v4-closeout.md` | M0 inventory (grep the retired vocabulary in §14.1 across cannon-food, clean-plate-va, c-ground-code memory/references/mcps, CannonAI's Food tab; classify every hit keep-as-history / rewrite / delete) · M1 apply (rewrites/deletes; identity cards re-based; this doc's "today vs end state" framing collapses into present tense; skills repackaged) · M2 **residue tripwire** (per-repo retired-vocabulary tests, Tier-0 / `node --test`, history and archives exempt) · M3 runway hygiene (CPD/CPF archived, HISTORY, §11/§13 closed) | **gated on CPF-M3** — a verification net: each arc still updates what it touches |

CPR and CPD both edit `foodDashboard.js` (or its split successors) — **sequential is mandatory**. The other gates exist so nothing is designed against a shape that is about to change. Each arc: one PR per milestone, pause between, no auto-chain.

**CPX is a net, not a deferral target.** CPD-M3 and CPF-M3 each carry their own README / SKILL.md / memory steps and each *appends what it retires to §14.1*. CPX exists for the files those arcs never opened — prose that described the old world in places nobody edited — and to make the class mechanical afterward.

## 12. Open decisions registry

Every fork the runways inherit. **Resolver** = the milestone that must close it; **Status** flips in this doc, same PR, when it does. Recommendations are the lead dev's; Cannon decides (via `AskUserQuestion` at the resolving milestone).

| ID | Question | Options | Recommendation | Resolver | Status |
|---|---|---|---|---|---|
| **D-URL-1** | Which route is canonical for Map? | `/` canonical, `/map` alias → normalize · `/map` canonical, `/` redirects | `/` canonical | CPR-M0 | **shipped CPR-M1b 2026-08-16** — `/` canonical, `/map` normalizes |
| **D-URL-2** | Unknown path behavior | SPA fallback + client normalizes to `/` · real 404 page | SPA fallback + normalize | CPR-M0 | **shipped CPR-M1b 2026-08-16** — wrangler + `app.py` + the CannonAI mount; missing assets still 404 |
| **D-URL-3** | Which state rides in the URL | filters (both) + `permit` + List `sort/dir/page` · + Map viewport hash | all of the first; viewport as stretch | CPR-M0 | **shipped CPR-M1b 2026-08-16** — filters + `permit` + List `sort/dir/page`; **Map viewport hash deferred** (still open as a stretch) |
| **D-URL-4** | URL vs `localStorage` precedence for toggles | URL wins when present, else stored default; write only non-default state · URL always authoritative | URL-wins-when-present | CPR-M1 | **shipped CPR-M1b 2026-08-16** — non-default is measured against the *persisted* value, which is what makes it reload-stable (§4) |
| **D-URL-5** | Split `foodDashboard.js` into modules in CPR? | yes, zero-behavior-change per-concern split · leave to CPD | **decided: yes-light** | CPR-M1 | **shipped CPR-M1a 2026-08-16** (decided the same day, Cannon) — 13 modules + orchestrator, §4 |
| **D-URL-6** | CannonAI embed deep-linking | Flask `/cleanplate/<path>` falls back to `index.html` for view paths + iframe `src` carries sub-route · embed stays at `/cleanplate/` root only | fallback + sub-route (tiny CannonAI PR) | CPR-M1 | **shipped CPR-M1b 2026-08-16** (CannonAI PR) — fallback + `<base>` rewrite + the frame keeps its view across reload/tier flips |
| **D-DATA-1** | Is the shared finder feasible — do Lite and Full produce the *same* active-marker partition? | verify with `tools/developer/cf_merge_diff.py --compare` · if unequal, Full owns its own slim finder | verify first; expect equal | CPD-M0 | **resolved CPD-M0 2026-08-16 — EQUAL three ways:** committed Lite 24,990 == materialized Full-active 24,990 (Δ 0; Full closed 2,929), by construction (both tiers call one `merge_facilities()`), and order-independent (`cf_merge_diff --shuffle 2`). Shared finder stands. |
| **D-DATA-2** | Shared finder: same URL vs same bytes republished under `/data-full/` | see §6.3 | same bytes under `/data-full/` | CPD-M0 | **resolved CPD-M0 2026-08-16 — same bytes under `/data-full/`** (P9; ~6.9 MB of duplicate R2 storage is trivial) |
| **D-DATA-3** | Finder row encoding | objects (V3 style) · positional arrays | measure; positional if ≥15% wire | CPD-M0 | **resolved CPD-M0 2026-08-16 — objects.** Positional measured −7.5% wire (1.49 vs 1.61 MB at 6 dp; −42% raw), under the pre-registered bar. Positional remains the M4 stretch. |
| **D-DATA-4** | Published coordinate precision (9 dp today) | keep · round to 6 dp at export (Couch untouched) | 6 dp | CPD-M0 | **resolved CPD-M0 2026-08-16 — 6 dp at export** (−5.0% finder wire, −80 KB; Couch keeps 9) |
| **D-DATA-5** | Overlay keying | position-aligned + per-bucket sha binding · full GUID per row · short permit hash per row | position + sha binding | CPD-M0 | **resolved CPD-M0 2026-08-16 — position + per-bucket `finder_sha256` in the overlay envelope** (0.19 MB vs 8-hex hash 0.32 vs GUID 0.71 on the 9-field row) |
| **D-DATA-6** | Filter bits: `permit_type_code` vs booleans | enumerate `permit_type` vocabulary; measure both | *investigate, do not pre-decide* (Cannon 2026-08-16) | CPD-M0 | **resolved CPD-M0 2026-08-16 (Cannon) — all three: `pt` code + `is_restaurant` + `mobile`** (+1.7% finder wire, ~27 KB). 18-value vocabulary published in the manifest; `mobile` ≡ "Mobile Food Unit"; 689 name-pattern-only denials mean `is_restaurant` stays a boolean. Future type filters (schools + child care 3,369 · caterers 751 · institutional ~1,170) need no data change. |
| **D-DATA-7** | Closed permits as their own lazy family | own `closed/*` family · inline in finder+overlay | own family | CPD-M0 | **resolved CPD-M0 2026-08-16 — own family, 16 shards** (0.26 MB lazy; one file measured 0.21 MB, rejected for uniformity with the inventory guard and incremental path) |
| **D-DATA-8** | Detail contract under V4 | keep V3 shape and contract string · bump to v4 for uniformity | keep; bump only if bytes change | CPD-M1 | **resolved CPD-M0 2026-08-16 — keep V3 shape + `cleanplateva.facility-detail.v3`** (Cannon indifferent; the no-churn path taken — detail bytes don't move at cutover, so the ETag delta skips ~all 27,919 objects). The detail already carries the full `location` dict the finder drops. |
| **D-DATA-9** | Freshness field in the manifest | `freshness: {snapshot_id, newest_report}` top-level · under `counts` | top-level `freshness` | CPD-M1 | **resolved CPD-M0 2026-08-16 — top-level `freshness`** (measured `newest_report` 2026-08-07 on the day's archive) |
| **D-DATA-10** | Hover-dwell threshold + prefetch policy | ~150 ms dwell, cancel on leave, LRU ~200 details; touch = click | as stated | CPD-M2 | **resolved CPD-M2 2026-08-16 (Cannon) — fetch on hover immediately (no dwell), LRU 200; touch = click.** The card renders instantly from the overlay and re-renders with the sparkline when the detail lands; a late detail for a marker the pointer already left is dropped; the click panel reuses the cached detail (one fetch total, verified on the throwaway port). |
| **D-DATA-11** | List page size + style | 50/page numbered, URL-carried · load-more | 50 numbered | CPR-M1b (moved from CPD-M2 — pure UI change, no data dependency) | **shipped CPR-M1b 2026-08-16** — **load-more, append 50** (Cannon's call, not the recommendation); `page=N` = N chunks revealed, clamped to the filtered length |
| **D-DATA-12** | Overlay families by view — one shared overlay vs Map-only + List-only | shared union · split | shared (measured 10 KB apart) | CPD-M0 | **resolved CPD-M0 2026-08-16 (Cannon) — one shared UNION-9 overlay** (§6.2); Map-7 and List-8 share six fields; the route seams still gate closed/detail/standards |
| **D-CUTOVER-1** | V4 flip: same-PR Lite data vs transitional dual-accept | see §8 | same-PR | CPD-M3 | **resolved CPD-M3 2026-08-17 — same-PR** (#111 carried client + V4 Lite data + tripwire; committed in prose at the go/no-go, as expected) |
| **D-CUTOVER-2** | Publisher idempotence when Lite is already at the generation | detect by shard shas → skip Lite commit · always commit | detect + skip | CPD-M3 | **resolved CPD-M3 2026-08-17 (Cannon) — detect + skip:** `lite_generation_unchanged()` in `cf_publish_cleanplate.py` restores a stamp-only manifest and commits nothing (cground-skills #1669). The cutover publish itself made the last manifest-only Data-refresh commit. |
| **D-CUTOVER-3** | How cannon-food carries V4 before the site client is V4 | flag-gated `--contract v4` (default v3) landed in M1, flag deleted at M3 · V4 kept off `main` on a branch until M3 | flag-gated; delete at M3 | CPD-M0 (confirm) → CPD-M3 (delete) | **confirmed CPD-M0 2026-08-16, executed CPD-M3 2026-08-17 — flag-gated at M1 (#1667), flag + V3 emit deleted at M3 (#1668)** (no compat path survives; the flag itself is a §14.1 retirement). Cannon's note: the daily `food-log-update` task is **disabled** (store: last ran 2026-08-15T04:07Z), so no publish can carry a V4 manifest to R2 during M1/M2 regardless; the flag remains the mechanism that keeps V3 pinned by tests and makes M3 a flip. |
| **D-ACK-1** | When the acknowledgement appears | first load, map loading gray behind the modal, decline → Lite · on first judgment-bearing interaction | first load (Cannon: the public *should* get Full) | CPF-M0/M1 | open |
| **D-ACK-2** | Attribution inventory + placement | modal only · modal + footer + About | modal + About; footer keeps the VDH line | CPF-M0 | open |
| **D-ACK-3** | `?tier=lite` survives as dev override | yes · no | yes | CPF-M1 | open |
| **D-TRANSPORT-1** | Edge caching for R2-served Full data | Cache API in Worker · R2 public custom domain | Cache API first; custom domain if plan tier / volume argues | CPF-M2 | open |
| **D-TRANSPORT-2** | Retire the git Lite data channel after CPF (R2 sole transport) | yes · keep for availability defense | revisit after CPF; not a precondition | CPF-M4+ | open |
| **D-TRANSPORT-3** | Access app retirement sequencing | after client+Worker no longer depend on it; Cannon fires | — | CPF-M3 | open |

## 13. History

| Date | Change |
|---|---|
| 2026-08-16 | Doc created from the design conversation of the same day. D-URL-5 decided (module split: yes-light). Three runway briefings created against it. |
| 2026-08-16 | CPR-M0 ratified D-URL-1, -2, -3, -4, -6 as recommended and D-DATA-11 as **load-more** (resolver moved CPD-M2 → CPR-M1b). CPR-M1a shipped the module split (D-URL-5 → shipped): `foodDashboard.js` → 13 per-concern modules + orchestrator, zero behavior change (CleanPlateVA PR #104). |
| 2026-08-16 | **CPR-M1b shipped** — `router.js` (paths, URL state, history, `#about` migration), `<base href>` mount, load-more List paging, SPA fallbacks in `wrangler.jsonc` / `app.py` / the CannonAI mount, `tests/routes.test.mjs`. D-URL-1..4, -6 and D-DATA-11 → shipped; the Map viewport hash stays deferred. **CPR is complete — CPD is ungated.** |
| 2026-08-16 | **Post-CPR review hotfix (PR #108):** the SPA fallback had silently broken the authenticated tier — `run_worker_first` in array form is the *complete* set of Worker-invoking paths, and `/data-full/*` was not on it, so R2 requests were answered with `index.html`. Found via the un-Access-gated `www` host (§4). Fixed by listing `/data-full/*`; §4 corrected; test pinned. Lesson folded into `c-ground-code/memory/feedback_measure_host_behavior_not_the_stand_in.md`. |
| 2026-08-16 | **CPX teed up** (`c-ground-code/runway/cleanplate-v4-closeout.md`, gated on CPF-M3) — the close-out sweep + residue tripwire. §11 gains the CPX row and the "net, not a deferral target" rule; §14.1 seeds the retired-vocabulary list that CPD-M3 / CPF-M3 append to. |
| 2026-08-16 | **CPD-M0 shipped** — `cannon-food/tools/developer/cf_v4_prototype.py` materialized every candidate V4 shape from the live archive and measured it (brotli q4 calibrated to the live edge). §7 replaced with measured numbers in one unit (the V3 table had mixed MB/MiB): **V4 Lite 1.64 MB · V4 Full 1.85 MB wire** vs V3 2.21 / 6.71. §6.2 row shapes ratified: object finder rows at 6 dp with `pt` + `is_restaurant` + `mobile` + `loc`; one shared **UNION-9** overlay (Cannon raised and rejected a Map/List overlay split — measured 10 KB apart; and confirmed the sparkline comes from the detail on dwell, not the boot); closed ×16; detail unchanged; top-level `freshness` + `vocab`. D-DATA-1 EQUAL three ways. D-DATA-6 decided by Cannon (all three fields). D-CUTOVER-3 added and confirmed (flag-gated V4 emit; the daily is currently disabled). **Found:** the V3 roster publishes `compliance_rate` / `checklist_out` / `checklist_compliant` / `cos` as null on 100% of markers (a present-but-null top-level key shadows the `checklist_summary` fallback) — fix scheduled for M1 with a pinned test. |
| 2026-08-16 | **CPD-M1 shipped** (cground-skills #1667) — cannon-food emits Contract V4 behind `--contract v4` (default v3, byte-identical): exporter families + v4 manifests, publisher guard (V3 or V4), incremental route with membership frozen (status flips refuse), orchestrator `assert_contract_roots` (alternate roots + stop after materialization while the site is V3). 27 new tests. Materialized from Couch: finder shard shas identical across tiers; R2 dry-run of the alternate root: guard passed, delete 0, 26,999 detail re-uploads once (the fallback fix lands in `facility.latest`). |
| 2026-08-16 | **CPD-M2 built and held** (this PR — the cutover PR of §8). `dataClient.js` v4: finder + overlay in parallel, per-bucket `finder_sha256` + row-count check, position merge into `f.o` by the shard's `columns`, `counts.active` tripwire; `loadClosed()` memoized; one detail LRU (200) shared by hover prefetch and click; Full → V4 Lite fallback; no V3 loader. Presentation reads the overlay for roster rows and the detail for the panel; `trendInspections` and the roster `trend` tuples are gone. Hover: instant card, sparkline from the prefetched detail (D-DATA-10 → fetch on hover, Cannon). Footer/About freshness from `manifest.freshness` on both tiers. `app.py` gained `CLEANPLATE_DATA_ROOT` / `CLEANPLATE_DATA_FULL_ROOT`. Tests: `data-client-v4.test.mjs` (replaces v3), `lite-roster-contract.test.mjs` for V4 rows, hover/scope/about/lite-override re-pinned — 208 green. **V4 Lite data (24,990 rows, snapshot 2026-08-17T03:16:03Z) committed here.** QA on a throwaway port: boot = manifest + 16 finder + 16 overlay (no `signals/`), markers painted from the overlay, hover instant→enriched, click free after hover, List sorts every column with the Compliance column populated for the first time, closed toggle fetches 16 once, `?tier=lite` gray V4, and the new client meeting the **V3** Full manifest degrades to V4 Lite (the M3 window). README contract sections rewritten to V4 (take effect at merge). |
| 2026-08-17 | **CPD-M3 shipped — Contract V4 is live on both tiers** (Cannon's go). (a) cground-skills #1668: cannon-food V3 retirement — every emit V4; flag, V3 shapers/writers/manifest builders, `_trend_event`, `--changed-permits`, V3 guard branch, V3 incremental route, `assert_contract_roots`, `test_export_contract_v3.py`, `test_export_trend.py` deleted; `tests/v4_fixtures.py` shared. (b) #111 merged 03:49Z; public manifest V4 by 03:50Z. (c) `cf_publish_cleanplate.py --full --run-id cpd-m3-cutover --apply --stop-after r2_dry_run` → plan reviewed (48 shards + 26,999 details + manifest, delete 0, skip 921) → resumed → 27,047 uploads + manifest, 0 deletes, 0 failed, 643 s; Lite commit manifest-only. Verified R2 `full-manifest.v4` (27,919 = 24,990 + 2,929, snapshot 03:50:48Z), second dry-run 0 uploads / 32 deletes (the retained V3 finder + signals generation — §8.4), local view V4 without `signals/`. (d) D-CUTOVER-1 same-PR, D-CUTOVER-2 detect + skip (#1669), identity cards + runway closed; §14.1 rows below marked ✅ and extended. **CPF ungated.** |

## 14. Terminology

- **tier** — Lite (judgment-free) or Full (judgment-bearing). Post-CPF the boundary is the acknowledgement, not Access.
- **ack** — the visitor's acknowledgement of the terms (derived scoring; source attribution), stored client-side; gates the client's fetch of judgment families.
- **family** — a named prepared-data resource set in the manifest (`finder`, `overlay`, `closed`, `standards`, `details`).
- **shard / bucket / generation** — one content-addressed file of a family / its sha256-of-`permit_id` slot (00–0f) / the set of shard names a manifest points at.
- **overlay** — the Full-only, position-aligned per-row judgment family that replaces `signals`.
- **judgment-free / judgment-bearing** — identity/location/source facts vs anything derived by CleanPlateVA's scoring or presented through it.

### 14.1 Retired vocabulary — the CPX tripwire seed

Every term, name, path, header, or number that an arc retires goes here **in the PR that retires it** (CPD-M3, CPF-M3, and any hotfix). CPX-M0 greps live prose and code for this list; CPX-M2 turns it into per-repo tests. Columns: what · replaced by · retired by · owner repo(s) for the tripwire.

**Exempt from the tripwire (history is allowed to say old words):** `c-ground-code/runway/archive/**`, `runway/HISTORY.md`, `cannon-food/references/retros/**`, `c-ground-code/memory/**` (memories are dated observations; CPX-M1 re-bases identity cards by hand), this doc's §13 and this §14.1, git history, and any line carrying an explicit `retired-ok` marker for a deliberate historical mention.

| Retired | Replaced by | Retired by | Tripwire owner |
|---|---|---|---|
| `#about` hash as the About route; `_setView(mode, syncHash)` writing hashes | `/about` route via `router.js`; legacy hash migrates on load | CPR-M1b ✅ | site |
| `CAP = 600` / the "N more" List tail | load-more, 50 per chunk, `page=N` in the URL | CPR-M1b ✅ | site |
| "the 3,866-line `foodDashboard.js`" as present tense | 13 per-concern modules + a ~380-line orchestrator | CPR-M1a ✅ | site, c-ground-code refs |
| `run_worker_first: ["/data/manifest.json", "/data/finder/*"]` or `["/data/*"]` | `["/data/*", "/data-full/*"]` — array form is the complete worker-invoking set | CPR-M1b + hotfix #108 ✅ | site |
| "`/data-full/*` still routes to the Worker" (unqualified) | it does **only because** it is listed in `run_worker_first` | hotfix #108 ✅ | site |
| `signals/`, `cleanplateva.full-signal-shard.v3`, "sparse signal shards", "16 signal shards" | `overlay/` (`cleanplateva.overlay-shard.v4`, named CPD-M0) + `closed/` (`cleanplateva.closed-shard.v4`) | CPD-M3 ✅ | cannon-food, site |
| `cleanplateva.finder-shard.v3` · `full-finder-shard.v3` · `finder-manifest.v3` · `full-manifest.v3` | `cleanplateva.finder-shard.v4` (one string, both tiers) · `finder-manifest.v4` · `full-manifest.v4` (named CPD-M0; `facility-detail.v3` is **kept**, D-DATA-8) | CPD-M3 ✅ | cannon-food, site |
| roster-level `trend` tuples, `_trend_event` feeding the roster, "hover card without a fetch" | detail-derived hover (prefetched on hover, no dwell — D-DATA-10) | CPD-M3 ✅ | cannon-food, site |
| roster-level `latest_assessment`, `newly_permitted`, 17-field `latest` | overlay row fields (`f.o`) | CPD-M3 ✅ | cannon-food, site |
| the client-side "newest held report" scan of every `latest.date`; "Not exposed publicly" as the Lite footer's newest-report text | `manifest.freshness.newest_report` (both tiers) | CPD-M3 ✅ | site |
| "33 requests / 39.66 MB raw / ~6.7 MB" as the *current* boot | the measured V4 numbers (Lite 1.64 · Full 1.85 MB wire) | CPD-M3 ✅ | site README, cannon-food SKILL |
| `data-client-v3.test.mjs` · `test_export_contract_v3.py` · `test_export_trend.py` · "Contract V3" as present tense | `data-client-v4.test.mjs`, `test_export_contract_v4.py`, `tests/v4_fixtures.py`; "Contract V4" | CPD-M3 ✅ | site, cannon-food |
| the transitional `--contract v4` flag itself; `assert_contract_roots`; the `--changed-permits` partial-export path | default v4, flag deleted; `--lite-out` stays | CPD-M3 ✅ | cannon-food |
| `trendInspections` (client tuple decoder), `f.trend`/`f.latest`/`f.grade` roster reads, `f.location.{lat,lon,source}` roster reads, `_geoNote(source)` | `f.o` + `coordsOf` / `locationClass` / `latestDateOf` / `isNewlyPermitted` / `isActivePermit` in `presentation.js`; `_geoNote(f)` | CPD-M3 ✅ | site |
| exporter V3 surface: `_shape_lite`, `_shape_finder`, `_sparse_marker_inspection`, `_sparse_grade`, `_shape_signal`, `write_shard_set`, `build_public_manifest`, `build_full_manifest`, `_trend_event`; publisher V3 guard branch + `_validated_family_ids`; incremental `_load_family` / `_full_counts` / `_lite_counts` / `_signal_declining` | `_shape_finder_v4` / `_shape_overlay_v4` / `_shape_closed_v4` / `bucketize_v4` / `write_v4_family` / `build_*_manifest_v4`; `_validated_family_shards` + `_assert_export_contract_v4`; `_load_v4_keyed` / `_load_v4_active` / `v4_full_counts` | CPD-M3 ✅ | cannon-food |
| `manifest.counts.scored` / `.declining` / `.open_repeat` | dropped (never read by the client; `open_repeat` not derivable from V4 rows); `counts` = `total, active, closed, by_grade, by_zip` | CPD-M3 ✅ | cannon-food, site |
| "Full is authenticated / Access-gated"; "authenticated full-data channel" | "Full is acknowledged" — the tier boundary is the ack | CPF-M3 | site, cannon-food SKILL, c-ground-code refs/mcps |
| `Cf-Access-Jwt-Assertion` check in `src/worker.js`; the `data-full/signin` route | none (Access retired); public cache-control | CPF-M2/M3 | site |
| `#signInBtn`, "Sign in to view inspection detail", `cp-signin-label` | the acknowledgement affordance ("Show inspection grades") | CPF-M1 | site |
| `private, max-age=…` on `/data-full/*`; "browser-private immutable" | `public, …` (shards immutable, details 300 s + ETag) | CPF-M2 | site |
| the Cloudflare Access application "CleanPlateVA full data" (apex-scoped) | retired — **not** CannonAI's own Access app | CPF-M3 | c-ground-code mcps/memory |
| *kept, not retired:* `?tier=lite` dev override; `tenant`-routed VDH links; one document per permit in Couch; `cleanplateva.facility-detail.v3` (D-DATA-8) | — | — | (do not flag) |

**Pre-V4 retirements worth catching while the sweep is running** (opportunistic in CPX-M0 — fix on hit, do not hunt): `public/data/facilities.json` (public monolith, retired 2026-08-05); `cf_couch_check.py` → `cf_couch_probe.py --mode transport`; `cf_scrape_recent.py` (deleted); `cf_migrate_location_v3.py` → `cf_apply_location_projection.py`; `cf_facility_location_{candidates,adjudicate,promote}.py` → `cf_location.py <stage>`; `cf_facility_location_google.py` → `cannon_food/location/google.py`; `cf_geocode_repair.py` (folded into `cf_geocode_backfill.py`); `cf_statewide_runner.py` + `cf_targetzips_commit.py` (deleted 2026-08-05); Contract V1/V2 language.

## 15. Cross-references

| Path | Why |
|---|---|
| [`README.md`](../README.md) | Shipped V3 contract; authoritative for what is live until CPD-M3 |
| `public/static/js/dataClient.js` | V3 client: manifest-led loads, `decodeChecklist`, Full→Lite fallback |
| `public/static/js/foodDashboard.js` + siblings (`constants` · `stacks` · `presentation` · `receipt` · `map` · `markers` · `hover` · `filters` · `list` · `about` · `detail` · `sparkline` · `inspection`) | The dashboard, split per concern by CPR-M1a (§4); CPD rewrites `list`, `hover`, `presentation`, `markers` in part |
| `src/worker.js` · `wrangler.jsonc` | Transport: Access header check, cache-control, assets config CPR/CPF change |
| `tests/lite-roster-contract.test.mjs` · `tests/worker-cache-contract.test.mjs` · `tests/data-client-v3.test.mjs` | Tripwires CPD/CPF rewrite |
| `cannon-food/scripts/cf_export_site.py` | Deterministic full-rebuild authority; `shard_bucket`, `write_shard_set`, `_trend_event` |
| `cannon-food/scripts/cf_publish_cleanplate.py` · `cf_publish_full.py` · `cf_publication_change.py` | Orchestrator, R2 inventory guard, change-set domains (`location`/`inspection`/`assessment` incremental; `facility`/`site`/`standards`/`contract` full-rebuild) |
| `cannon-food/tests/test_export_contract_v3.py` · `test_export_incremental.py` · `test_publication_change.py` · `test_publish_full.py` · `test_publish_cleanplate.py` | cannon-food suites CPD-M1 updates |
| `cannon-food/tools/developer/cf_merge_diff.py` | Merge-partition comparison for D-DATA-1 |
| `CannonAI/cannonai/gui/server.py` (`cleanplate_site`) | The embed passthrough D-URL-6 touches |
| `c-ground-code/memory/project_clean_plate_va.md` · `project_cannon_food.md` | Identity cards; update when milestones land |
| `c-ground-code/runway/cannonai-tab-separation.md` | CTS — CannonAI's own routes (`/food`), the embed's parent |
