# CleanPlateVA V4 — shared design reference

**Public Full behind an acknowledgement · the barest boot on both data views · real per-view URLs.**

| | |
|---|---|
| Status | **Living design reference.** Governs three sequenced arcs — **CPR** (routes) → **CPD** (boot diet / Contract V4) → **CPF** (public Full). Each arc's runway briefing cites this doc by section instead of restating it. |
| Owner | Cannon decides; the active agent (lead dev) maintains. |
| Written | 2026-08-16, against the V3 snapshot `2026-08-16T15:13:33Z` (27,919 Full markers · 24,990 Lite). Every measured number below is stamped; treat them as dated receipts, not constants. |
| Update rule | When a runway milestone resolves an entry in **§12 Open decisions**, flip its status **in this doc, same PR**. When a principle changes, change it here first, then the briefings. Superseded content is struck or moved to **§13 History**, never silently deleted. |
| Runways | `c-ground-code/runway/cleanplate-routes.md` · `cleanplate-boot-diet.md` · `cleanplate-public-full.md` (created 2026-08-16). |

The shipped V3 contract is documented in [`README.md`](../README.md); it stays authoritative for what is *live* until CPD-M3 cuts over. This doc is authoritative for where the site is *going* and why.

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
| Full is | Finder + signals + standards + details, 33 requests at boot. | Finder + **overlay** at boot; **closed** on toggle; **detail** on hover-dwell/click; standards on first panel. |
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

- `wrangler.jsonc` `assets` gains `"not_found_handling": "single-page-application"`. `run_worker_first` for `/data/manifest.json` and `/data/finder/*` is unaffected; `/data-full/*` still routes to the Worker.
- **CannonAI embed (shipped, D-URL-6):** `cleanplate_site` now falls back to `index.html` for extension-less paths and rewrites the served `<base href>` to `/cleanplate/` on the way out — so `/cleanplate/list` works on a hard reload without a second committed `index.html`, and the checkout's own file stays the deployable one. The Food tab's iframe carries the sub-route: it re-reads the frame's location (same-origin) so Reload and the tier toggle keep the visitor's view instead of snapping back to the map, and "open in a new tab" opens what is on screen.
- The `?tier=lite` override is orthogonal to routes and survives.

**Module split (decided 2026-08-16, Cannon; shipped CPR-M1a the same day):** `foodDashboard.js` was one 3,866-line class; its own section markers showed the seams. CPR-M1a split it into per-concern ES modules with **zero behavior change** — `constants` · `stacks` · `presentation` · `receipt` (pure) and `map` · `markers` · `hover` · `filters` · `list` · `about` · `detail` · `sparkline` · `inspection` (method bundles installed on `FoodDashboard.prototype`), with `foodDashboard.js` left as the ~370-line orchestrator (constructor, toolbar wiring, load/refresh, view switch) that re-exports the pure helpers. Method bodies moved verbatim; the 16 `node --test` suites (193 tests) and a dark-mode DOM/text fingerprint of Map / hover / panel / receipt / List / About in both tiers were byte-identical before and after. CPD's rewrites of the List, hover card, and presentation layer now land in small named files. Insurance, not a feature.

## 5. View → data-need matrix

What each surface needs, which family carries it, and *when* it is fetched. This is the table the routes and the exporter both serve.

| Surface | Needs | Family | When |
|---|---|---|---|
| **Map boot** | coordinates · name/address/city/zip (search) · `tenant` · `is_restaurant` · `mobile` · approximate-location bit | **finder** | boot (both tiers) |
| | grade score (marker color, A–F chips) · `newly_permitted` · status | **overlay** | boot, **after ack** (Full) |
| **Map hover card** | grade + last-visit date — *instant* | overlay | already in memory |
| | trend sparkline + last-broad date — *enriched* | **detail** | hover-dwell prefetch (D-DATA-10) |
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
| **`facility/{permit_id}.json`** ×27,919 | Full | nested history (V3 shape retained unless CPD-M0 finds cause; D-DATA-8) | `permit_id` | `max-age=300` + ETag | hover-dwell / click | unchanged |
| ~~`signals/*`~~ | — | — | — | — | — | **retired.** Its `trend` tuples were a hover-latency optimization; hover-fetch of the detail makes them redundant. This family is 27.7 MB of the 39.7 MB V3 raw boot. |

**Manifest additions (both):** `freshness: { snapshot_id, newest_report }` (exact naming D-DATA-9). **Full manifest resources:** `finder`, `overlay`, `closed`, `standards`, `details.path_template` — and the publisher's inventory guard derives the only legal R2 object set from exactly this list, as it does today.

### 6.2 Row shapes (proposal — CPD-M0 measures and fixes)

**finder row** — the Lite row, slimmed. Keep: `permit_id`, `name`, `address`, `address2`, `city`, `zip`, `tenant`, `is_restaurant`, `mobile`, effective `lat`/`lon`, an approximate-location bit. Move to detail: `precision`, `source`, `site_source`, `site_lat`/`site_lon`, `site_group_id`, `site_count` — same-coordinate stacks are already computed client-side from coordinates (`stackKey`), and the shared-point notice depends on current effective coordinates, not historical site count. Object vs positional encoding: D-DATA-3. Coordinate decimals: D-DATA-4.

**overlay row** — positional, one per finder row, letter *derived* (`gradeForScore(score)`, never shipped): `[status_code, grade_score|null, new, compliance_pct|null, trend_delta|null, latest_yyyymmdd|null, latest_scope_code, latest_out|null, latest_addressed|null]` (~30 chars). Whether the filter bits become a single `permit_type_code` instead of booleans is D-DATA-6 — *investigated, not pre-decided*; note `is_restaurant` also uses name patterns, so a type code cannot fully replace it.

**closed row** — finder fields + overlay fields inline (never shared with Lite, so no split needed).

**Sharding is unchanged:** `bucket = int.from_bytes(sha256(permit_id)[:4], "big") % 16`, rows sorted by `permit_id`, filename `<bucket>-<sha256(bytes)[:12]>.json`. Even split (V3: 1,679–1,810 rows/bucket) with no rebalancing logic; a permit's bucket never moves.

### 6.3 Shared finder — the two ways to share

The finder is *one contract, one exporter path, one tripwire test* for both tiers. Whether Full literally fetches the *public URLs* is a separate choice (D-DATA-2):

- **Same URL** — Full manifest points at `/data/finder/*`. Saves R2 storage (14 MB — trivial) and lets a Full visitor's cache reuse public shards, but binds a Full family to a public generation across two transports → every daily publish opens a skew window (git deploy vs R2 flip) in which a position-keyed overlay misaligns and the client must degrade to gray. Violates P9.
- **Same bytes, republished under `/data-full/`** — Full manifest names the same content-addressed shard files, uploaded to R2 alongside the overlay. Each tier is atomic on its own manifest; no cross-transport binding; no daily skew. **Recommended.** Post-CPF, `/data-full/*` is public and cached too, so the "reuse" advantage of same-URL mostly disappears anyway.

## 7. Boot budget — V3 measured, V4 targeted

Measured 2026-08-16 from the local materialized view (`public/data-full/`) and the committed Lite shards; gzip is local `gzip -6`; brotli is the live-edge ratio measured on `cleanplateva.com` the same day (br ≈ 0.91 × gzip on these files). Modern browsers receive **brotli**.

| Payload | requests | raw | gzip | ≈ wire (br) |
|---|---|---|---|---|
| **V3 Lite boot** | 17 | 10.86 MB | 2.33 MB | ~2.1 MB |
| **V3 Full boot** (manifest + 16 finder + 16 signals) | 33 | 39.66 MB | 7.32 MB | ~6.7 MB |
| V3 finder family alone | 16 | 13.91 MB | 2.83 MB | ~2.6 MB |
| V3 signals family alone | 16 | 27.67 MB | 4.85 MB | ~4.4 MB |
| V3 detail corpus (not at boot) | 27,919 | 406.1 MB | p50 ≈ 4 KB/obj | p50 12.6 KB raw · p90 28.9 KB · max 197.8 KB |
| **V4 Lite boot** — *target, estimate* | 17 | ~7 MB | | **~1.6 MB** |
| **V4 Full boot** — *target, estimate* (finder + overlay + manifest) | 33 | ~8 MB | | **~2.0 MB** |
| V4 closed supplement — *lazy, estimate* | ≤16 | ~1.5 MB | | ~0.3 MB |

Targets are the design's expectation, not a promise; **CPD-M0 replaces this table with measured V4 numbers** from a prototype export before any exporter code lands. The structural claim that *is* firm: retiring signals removes ~70% of V3 raw boot; the overlay adds back ~2%.

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
| **CPD** — boot diet / Contract V4 | `cleanplate-boot-diet.md` | M0 measure + design (prototype families; real wire numbers; merge-partition check; resolve D-DATA-*) · M1 cannon-food emits V4 (exporter, publisher inventory, incremental change-set→family mapping, tests) local-only · M2 site V4 client (finder+overlay boot, hover→detail prefetch, presentation refactor, freshness from manifest — List paging already shipped in CPR-M1b) · M3 cutover per §8 + V3 retirement · M4 stretch slimming per M0 numbers | **ungated 2026-08-16** — CPR-M1a + M1b both merged |
| **CPF** — public Full | `cleanplate-public-full.md` | M0 terms copy + attribution inventory (Cannon's voice; agent drafts) + plan-tier check · M1 ack UX (modal, `localStorage`, decline → Lite, replaces sign-in button, About/footer wording, embed behavior) · M2 transport per §9 · M3 Access app retirement + verification + README/memory · M4 observe volume/hit rates; consider D-TRANSPORT-2 | **gated on CPD-M3** — public boot must be slim, and the overlay *is* the ack-gated family |

CPR and CPD both edit `foodDashboard.js` (or its split successors) — **sequential is mandatory**. The other gates exist so nothing is designed against a shape that is about to change. Each arc: one PR per milestone, pause between, no auto-chain.

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
| **D-DATA-1** | Is the shared finder feasible — do Lite and Full produce the *same* active-marker partition? | verify with `tools/developer/cf_merge_diff.py --compare` · if unequal, Full owns its own slim finder | verify first; expect equal | CPD-M0 | open |
| **D-DATA-2** | Shared finder: same URL vs same bytes republished under `/data-full/` | see §6.3 | same bytes under `/data-full/` | CPD-M0 | open |
| **D-DATA-3** | Finder row encoding | objects (V3 style) · positional arrays | measure; positional if ≥15% wire | CPD-M0 | open |
| **D-DATA-4** | Published coordinate precision (9 dp today) | keep · round to 6 dp at export (Couch untouched) | 6 dp | CPD-M0 | open |
| **D-DATA-5** | Overlay keying | position-aligned + per-bucket sha binding · full GUID per row · short permit hash per row | position + sha binding | CPD-M0 | open |
| **D-DATA-6** | Filter bits: `permit_type_code` vs booleans | enumerate `permit_type` vocabulary; measure both | *investigate, do not pre-decide* (Cannon 2026-08-16) | CPD-M0 | open |
| **D-DATA-7** | Closed permits as their own lazy family | own `closed/*` family · inline in finder+overlay | own family | CPD-M0 | open |
| **D-DATA-8** | Detail contract under V4 | keep V3 shape and contract string · bump to v4 for uniformity | keep; bump only if bytes change | CPD-M1 | open |
| **D-DATA-9** | Freshness field in the manifest | `freshness: {snapshot_id, newest_report}` top-level · under `counts` | top-level `freshness` | CPD-M1 | open |
| **D-DATA-10** | Hover-dwell threshold + prefetch policy | ~150 ms dwell, cancel on leave, LRU ~200 details; touch = click | as stated | CPD-M2 | open |
| **D-DATA-11** | List page size + style | 50/page numbered, URL-carried · load-more | 50 numbered | CPR-M1b (moved from CPD-M2 — pure UI change, no data dependency) | **shipped CPR-M1b 2026-08-16** — **load-more, append 50** (Cannon's call, not the recommendation); `page=N` = N chunks revealed, clamped to the filtered length |
| **D-CUTOVER-1** | V4 flip: same-PR Lite data vs transitional dual-accept | see §8 | same-PR | CPD-M3 | open |
| **D-CUTOVER-2** | Publisher idempotence when Lite is already at the generation | detect by shard shas → skip Lite commit · always commit | detect + skip | CPD-M3 | open |
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

## 14. Terminology

- **tier** — Lite (judgment-free) or Full (judgment-bearing). Post-CPF the boundary is the acknowledgement, not Access.
- **ack** — the visitor's acknowledgement of the terms (derived scoring; source attribution), stored client-side; gates the client's fetch of judgment families.
- **family** — a named prepared-data resource set in the manifest (`finder`, `overlay`, `closed`, `standards`, `details`).
- **shard / bucket / generation** — one content-addressed file of a family / its sha256-of-`permit_id` slot (00–0f) / the set of shard names a manifest points at.
- **overlay** — the Full-only, position-aligned per-row judgment family that replaces `signals`.
- **judgment-free / judgment-bearing** — identity/location/source facts vs anything derived by CleanPlateVA's scoring or presented through it.

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
