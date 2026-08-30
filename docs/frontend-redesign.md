# CleanPlateVA front-end redesign — the CR program design reference

**React + Vite + Tailwind, redesigned as it is rebuilt, on a frozen Contract V4.**

| | |
|---|---|
| Status | **Living design reference.** Governs the CR program — **CRD** (design) → **CRF** (foundation) → **CRV-a/b** (views) → **CRC** (cutover) → **CRX** (close-out). Each arc's runway briefing cites this doc by section instead of restating it. |
| Owner | Cannon decides; the active agent (lead dev) maintains. |
| Written | 2026-08-29 (CRD-M0), against the shipped Contract V4 site (V4 program closed 2026-08-18) and the production asset baseline measured the same day (§8). Measured numbers are dated receipts, not constants. |
| Update rule | When a milestone resolves an entry in **§10 Open decisions**, flip its status **in this doc, same PR**. When a principle changes, change it here first, then the briefings. Superseded content is struck or moved to **§11 History**, never silently deleted. |
| Relationship to [`architecture-v4.md`](architecture-v4.md) | That doc stays **authoritative for data + transport** — the families, the tier boundary, the request budget's mechanics, the publisher. This doc is **authoritative for the front-end** — stack, build, components, styling, tests, and the cutover. This doc *cites* the constitution, never restates it; where the two could ever disagree, architecture-v4.md wins on data/transport and this doc wins on the client that consumes them. |
| Runways | `c-ground-code/runway/cleanplate-react-redesign.md` (CRD, the program opener) · CRF/CRV/CRC/CRX briefings are teed up one at a time as the prior arc closes. |

---

## 1. Why + the program frame

The V4 program left the site on a settled floor: Contract V4 on both tiers, public Full behind the acknowledgement, a request-dieted transport, residue tripwires green. What remains old is the **front-end fabric**: ~6.7k lines of no-build ES modules across 19 files, a 705-line `index.html`, a ~2,800-line `style.css` over **Bootstrap 5.3.3 + bootstrap-icons from the jsDelivr CDN**, and MapLibre GL 5.19.0 CDN-loaded as a classic script.

**Ratified 2026-08-29 (Cannon, the CR tee-up session) — the four program decisions:**

1. **Stack:** React + Vite, styled with Tailwind.
2. **Scope:** **redesign as we rewrite** — each view is built to its new design, never a pixel-port of its old one.
3. **Shape:** a series of arcs + this one shared design reference (the V4 pattern).
4. **Data contract:** **Contract V4 is frozen for the whole program.** cannon-food, the published families, and `src/worker.js` are untouched end to end. A redesigned view that genuinely needs data the families do not carry is an out-of-program escalation to Cannon, never a quiet PR.

Because the scope is redesign-not-port, the existing suites stop refereeing presentation. The referee becomes **per-view acceptance specs** (§6): CRD writes them with the mockups, CRV builds against them, CRC verifies them at the flip.

### The arcs

| Arc | Lands | Gate |
|---|---|---|
| **CRD** — design | This reference merged, every D-CR-* fork resolved, the wire baseline measured (§8), visual direction (style tile + per-view mockups), per-view acceptance specs (§6) | none — fires first |
| **CRF** — foundation | Vite + React + Tailwind scaffold, build + Workers Builds pipeline proven, the Contract V4 data client and ack gate on the new stack, contract tripwires ported and green — boots to a working gray basic map + acked overlay merge, zero UI beyond proof | CRD |
| **CRV-a** — shell + Map + hover + detail panel | The redesigned map surface built to its acceptance specs | CRF |
| **CRV-b** — List + About/terms + ack chrome | The remaining views | CRV-a |
| **CRC** — cutover | Production flips to the new client in one PR (new build live, old modules deleted), embed re-verified, budgets re-measured on the host, retirements appended to architecture-v4.md §14.1 | CRV |
| **CRX** — close-out | Stale-prose sweep across repos, retired-vocabulary tripwires extended, docs/memory re-based | CRC |

One PR per milestone, pause between milestones, later arcs get their own briefings teed up as the prior closes.

## 2. Parity constitution — what survives the rewrite

The redesign may move **everything except these**. Every arc inherits this table; CRC verifies it on the host. Sources: [`architecture-v4.md`](architecture-v4.md) (§ cited per row), [`README.md`](../README.md), [`wrangler.jsonc`](../wrangler.jsonc). *(Moved here from the CRD runway briefing at M0; the briefing now cites this section.)*

| # | Invariant | Source |
|---|---|---|
| **C1** | **Contract V4 client semantics.** Manifest-led boot; finder + overlay fetched in parallel, per-bucket `finder_sha256` + row-count check, position merge; closed lazy on first toggle; standards with the first click; detail on click only (P5), LRU-cached; detail contract validated on the click path; **an HTML-200 answer on any data path is a miss, never JSON**; Full → basic-map degrade on any contract failure (P4); static-first finder from `/data/` by content-addressed name with R2 fallback on miss; the grade letter is never shipped — always `gradeForScore(score)`. | v4 §5–§6, README |
| **C2** | **The ack gate.** Blocking first-load dialog over the empty basemap; **zero data fetches until answered**; Agree → Full, Decline → basic map; versioned `localStorage['cleanplateva.ack.v1']`; Escape = unpersisted decline; `?tier=lite` forces the basic map, asks no terms, hides the control; accepted chrome carries no terms control — About §06 owns the switch back; the terms are ONE document (Cannon's words, formal register), single-sourced in About and cloned into the dialog. | v4 §3, D-ACK-1..3 |
| **C3** | **The request budget is a hard gate.** Basic map / decline **0** Worker requests; acked boot **17** Worker (+16 static finder); hover **0** (the card renders wholly from the overlay's `visits` column); first click +2 (detail + standards), each further new facility +1. New UI adds no per-interaction fetches; new app assets are static (free). Never enable the opt-in "Workers Caching" (it bills static requests). | v4 §9, README |
| **C4** | **Transport config.** `run_worker_first` stays exactly `["/data-full/*"]`; `not_found_handling: "single-page-application"`; the Worker serves the R2 full channel and nothing else; `workers_dev` / `preview_urls` stay off unless D-CR-STAGE-1 consciously flips one. | wrangler.jsonc, v4 §4 |
| **C5** | **Publisher-written files keep their paths and reach the deploy verbatim.** `public/data/**` (manifest + 16 finder shards) and `public/_headers` (by-name immutable rules, rewritten and committed by cannon-food with every Lite publish) are cannon-food's write targets — the frozen contract means the publisher never learns the front-end changed, so the build must carry both into the served assets dir untouched. | v4 D-TRANSPORT-4, cground-skills #1684 |
| **C6** | **URL scheme + search semantics.** `/` canonical (`/map` normalizes) · `/list` · `/about`; query keys `q` `grade` `restaurants` `closed` `new` `mobile` `permit` + List `sort` `dir` `page` (load-more, 50/chunk); URL wins when present, non-default-only writes measured against the *persisted* toggle value; pushState on view/facility change, replaceState for filter churn; inside the CannonAI frame everything is replaceState. Search: whitespace-split terms, every term must match, per-term name/address/city substring + ZIP **prefix**, quoted phrase whole-within-one-field, legacy `?zip=` folds into `q` once. The redesign may *add* routes/keys; it may not re-mean these. | v4 §4, README Routes |
| **C7** | **The embed contract.** CannonAI's Food tab iframes the site at `/cleanplate/` (`?tier=lite` for the basic-map toggle); the served `<base href>` is rewritten by the passthrough and the router reads `document.baseURI` — one build serves any mount depth; the frame tracks the view across reloads; ack is once per origin. The Vite build must keep base-relative assets for this to keep working (D-CR-EMBED-1). | v4 D-URL-6 |
| **C8** | **Copy register.** Public copy is the formal register; the public word is **"basic map"**, never "Lite" to a visitor; every displayed score/grade is CleanPlateVA's own derivation and is never described as official VDH scoring; footer keeps the VDH line + "Terms & attribution"; attribution inventory (D-ACK-2) rides wherever About's content lands. | memory cards, v4 D-ACK-2 |
| **C9** | **Vocabulary + derivation rules.** `loc` / `pt` / `scope` decode via the manifest's `vocab` block and are **append-only** (codes are positional identity); `is_restaurant` is a boolean, never derived from `pt`; both tiers qualify all three approximate-location classes (one label switch); a ZIP-centroid pin is a failed site, never dressed up. | v4 §6.2, 2026-08-19 row |
| **C10** | **Dark theme is default.** The redesign restyles freely, but dark stays the default and light stays first-class (Tailwind dark strategy is D-CR-STYLE-1). | memory card |
| **C11** | **Tripwires stay green throughout.** `tests/retired-vocabulary.test.mjs` (site) and `cannon-food/tests/test_retired_vocabulary.py` (scans c-ground-code too) run on every PR of every arc — the rewrite *appends* its own retirements at CRC, it never resurrects V4's. `worker-cache-contract.test.mjs` keeps passing untouched until CRC (the Worker doesn't change). | v4 §14.1 |
| **C12** | **P1–P9 in full** — especially P2: the site never computes at request time. React + Vite here means a **static SPA build**; no SSR, no server functions, no query API, ever. | v4 §2 |

### Explicitly redesignable

Layout, chrome, information hierarchy, component structure, styling system (Bootstrap + `style.css` retire wholesale), interaction patterns (hover card presentation, panel anatomy, list density, filter affordances), iconography, typography, the About page's shape (content + single-source mechanism survive per C2/C8), responsive posture, and the module graph itself. The 19 ES modules, `index.html`, and `app.py`'s SPA-fallback role all retire at CRC (each retirement → v4 §14.1, same PR). List columns may change presentation freely but can only *draw* on what the frozen overlay carries (nine fields + `visits`) — a column needing new data is out of program (§1.4).

## 3. Stack + build pipeline

*Resolutions from D-CR-LANG-1 and D-CR-BUILD-1/2/3 (§10). This section records the end state; CRF proves it.*

- **Language: TypeScript, `strict`.** The data client's decode/merge/fallback paths — overlay `columns` decoding, `visits` mark kinds, checklist flag bits, the Full → basic-map degrade ladder — are exactly where types pay. Contract V4's row shapes become checked types (`FinderRow`, `OverlayRow`, `VisitMark`, `FacilityDetail`), written from v4 §6.2 and pinned by the ported contract tests.
- **Repo layout: Vite at the repo root, the app under `app/`, output `dist/`.** `public/` remains the publisher's channel and rides into the build verbatim as Vite's `publicDir` (with `public/data-full/**` — 400+ MB, gitignored, local-only — excluded from the build copy). `src/worker.js` and wrangler's `main` pointer never move. The old `public/index.html` + `public/static/**` remain the *served* site until CRC and are ignored by the build; CRC deletes them.
- **Deploy: the existing Workers Builds git integration gains a build command** (`npm ci && npx vite build`). Sequencing so production never flips early: CRF adds the build command while `assets.directory` still points at `./public` — builds run and are proven green, but what is served does not change. CRC's one-PR flip is `assets.directory` → `./dist` (+ deleting the old client). **Metered-unit check — recorded CRF-M0 (2026-08-29):** the unit Workers Builds meters is the **build minute**; the Free plan carries **3,000 build minutes/month, 1 concurrent build, 20-minute timeout** (docs, retrieved 2026-08-29). Push rate measured from `main`'s last 30 days: **~89 builds/month in an active dev month** (24 cannon-food data publishes + 65 PR merges; a quiet month floors near 30) — **plus PR-branch builds**: Workers Builds checks every branch push too (observed live on CleanPlateVA #163, pre-build-command), so an active month runs ~150–200 builds all-in. At a conservative 3 min/build that is ~450–600 min ≈ **15–20% of quota** (quiet month ~3%) — the pipeline is safe to rely on with wide margin. The build command went live in the dashboard 2026-08-29 (build `npm ci && npx vite build`, deploy `npx wrangler deploy`, version `npx wrangler versions upload`, root `/`, builds-for-non-production-branches on). **First real builds measured 2026-08-30 (#164):** branch build push→green **~34 s** wall; production build push→deployed **~47 s** (deployment record 01:52:28Z vs merge push 01:51:42Z; the pre-command baseline was ~40 s, so the build itself rides in well under a metered minute) — call it **≤1 build-minute per push**, making the earlier 3-min/build estimate a ~3× overcount: even a 200-build month spends ~200 of 3,000 minutes (~7%). Production verified byte-identical after both merges (shell, `style.css`, `app.js`, `/data/manifest.json` sha256-matched the pre-M0 baseline). Re-check the math if the plan or the push rate changes an order of magnitude.
- **Local dev: the Vite dev server** (serving `public/` passthrough including a local `data-full/` for full-tier work). **`app.py` survives untouched until CRC**, then retires → v4 §14.1.
- **`wrangler.jsonc` is untouched until CRC** (C4): same `run_worker_first`, same SPA fallback, same Worker. The only CRC change to it is the assets directory.

## 4. Component architecture + state

*Resolutions from D-CR-ROUTE-1, D-CR-MAP-1, D-CR-STATE-1, D-CR-STYLE-1 (§10). The component tree below is a sketch — CRV builds to the acceptance specs, not to this diagram; this section constrains the seams, not the pixels.*

- **Router: hand-rolled hook** porting `router.js`'s semantics — C6 is the spec, and route libraries fight exactly its load-bearing parts (URL-wins-when-present, non-default-only writes measured against *persisted* toggle values, replaceState-in-frame, mount from `document.baseURI`). The pure functions (`parseUrlState`, `serializeUrlState`, `viewFromPath`, `mountFromBaseURI`, `revealCount`, `storedFlagDefaults`) port nearly verbatim to TS with their tests. Revisit a library only if the redesign grows real route depth.
- **MapLibre: direct instance in a ref'd container** (a React island). The map is imperative on purpose — data-driven circle layers over ~25k markers, same-point stack spiderfy, theme swap via `setStyle` + re-add — and a wrapper would fight all of it. The npm `maplibre-gl` dep replaces the CDN classic script; React owns the container, the toolbar, and every overlay *around* the canvas.
- **State: React context + reducers first.** Roster, filters, selection, ack state, and URL sync live in one app-level store shape; adopt an external store (zustand or similar) only if the URL ↔ map ↔ list sync measures painful, with the measurement written down in §11.
- **Styling: Tailwind v4** (CSS-first config), **class-based dark variant, dark default** (C10), theme tokens as CSS variables so both themes are first-class and the style tile (§6) is the single vocabulary. Bootstrap and `style.css` do not survive; bootstrap-icons is replaced by **Lucide** (ISC, vendored via npm, tree-shaken inline SVGs — never an icon font, never emoji; ratified CRD-M1; the retired font alone is 130 KB of today's baseline, §8).

Component sketch (seams, not pixels): `App` (providers: ack, data, router, theme) → `AckDialog` · `Toolbar` (search, grade chips, toggles) · `MapView` (MapLibre island + `HoverCard` + stack fan-out) · `DetailPanel` (history, checklist, grade receipt) · `ListView` (load-more rows) · `AboutView` (terms §06 single-source, live cards) · `Footer`.

## 5. Data layer — the Contract V4 client in React terms

C1 restated as module responsibilities. The three modules whose *semantics* survive verbatim are today's [`dataClient.js`](../public/static/js/dataClient.js), [`router.js`](../public/static/js/router.js), and [`ack.js`](../public/static/js/ack.js) — they port as TypeScript modules with the same observable behavior, pinned by the ported contract tests (§7).

- **`data/client.ts`** — `createFoodApi` ported whole: manifest-led `loadFullV4`/`loadLite`, static-first finder with R2 fallback, `finder_sha256` + row-count verification, position merge by the shard's own `columns`, closed/standards/detail lazy paths, the detail LRU (200), contract validation on the click path, HTML-200-is-a-miss, and the P4 degrade. The ack gate stays a call-time predicate (`isAcknowledged`), not a module-level flag.
- **`data/presentation.ts`** — the pure derivation layer (`gradeForScore`, `visitsOf`, scope/trend/date math) ports from today's `presentation.js`/`receipt.js`; every displayed judgment keeps deriving client-side from the overlay/detail (C1, C9).
- **React bindings** — one provider owns the loaded roster + manifest and exposes it; hooks select filtered/sorted views. The provider re-runs the load when the ack answer changes (C2's re-load semantics). No fetch happens in any component body: every network read goes through the client module, so the request budget (C3) stays auditable in one file.
- **Vocabulary** — `loc`/`pt`/`scope` decode only via the manifest's `vocab` block (C9); types encode the append-only discipline by never enumerating the codes as a closed union.

## 6. Per-view specs — ratified CRD-M1 (2026-08-29)

The mockups under [`docs/mockups/`](mockups/) are the ratified visual direction (reviewed view by view with Cannon on a throwaway port, 2026-08-29); the specs below are what CRV builds to and CRC verifies on the host. `mockups/tokens.css` is the token vocabulary the style tile ([`style-tile.html`](mockups/style-tile.html)) documents — it becomes the Tailwind v4 `@theme` at CRF. Mockups are direction, not pixel contracts: the spec rows are binding, the mockup settles taste questions the prose can't.

### 6.0 Shared vocabulary — cross-view rules the tile ratified

- **Direction: "slate & signal."** Neutral slate chrome; color is reserved for judgment (the grade ramp) and action. Dark is the document default, light first-class (C10); dark elevates by border + surface tint (no shadows), light by soft shadow. System font stack; `tabular-nums` on every date, score, ratio, and count.
- **Action color language:** blue = the way to the grades, red = the way to the basic map — dialog buttons, About's status panel, and any future tier affordance all speak it. Filled for the dialog's fork, outlined for standing controls.
- **Grade ramp (mode-invariant):** A `#2f9e44` · B `#94be1b` · C `#f59f00` · D `#e8590c` · F `#a61e1e` · no-grade `#868e96` · NEW `#1c7ed6` · closed `#9aa0a6` · basic-map `#8d939c`. Only F moves from the live site — **darkened, which fixes its worst normal-vision failure** (D↔F ΔE 7.6 → ~15). B stays the lime family by Cannon's call (a teal B validated stronger — deutan 7.0, normal 15.7 — but read as blue-adjacent, and **blue belongs to NEW alone**; decision record: [`mockups/ramp-candidates.html`](mockups/ramp-candidates.html)). Final numbers (dataviz six-checks, all pairs, both surfaces, 2026-08-29): deutan worst ΔE 3.8 (B↔C) · normal worst 14.4 (A↔B, a hair under the 15 bar — accepted). The compensating control is mandatory: **the letter always rides the color** — chips/badges/hover/panel carry it everywhere, markers wear a ring and gain their letter past a zoom threshold.
- **Icons: Lucide only, inlined/tree-shaken (npm at CRF), never an icon font, never emoji.** bootstrap-icons retires wholesale at CRC.
- **Badges are a sometimes thing.** Pills are reserved for conditional notes (`≈ approximate location`, NEW). Permanent facts render structurally: kind as icon + word, status as dot + word, canonical actions as real buttons.
- **The external grammar:** a blue-outlined control carrying the box-and-arrow (Lucide `external-link`) means "leaves CleanPlateVA" — the facility-level **Source** button and every per-inspection link-out share it, and nothing else uses it.
- **The trend instrument** (one spec for the hover card's sparkline and the panel's trend section):
  - *Scale:* y is **absolute over the grade domain**, resting at 100→55 so the F threshold is always in frame; when a real score falls below the floor the domain **extends to include it** (thresholds keep their absolute positions and compress upward). A real value is never clipped; the range is never normalized to the data's own min/max. A below-floor outlier gets its score printed beside the mark. Reference renderings: [`mockups/trend-compare.html`](mockups/trend-compare.html).
  - *Threshold furniture:* hairlines at 90/80/70/60 with the 60-line dashed in the F color; band labels **A · C · F only**; endpoint dates inside the plot edges (start-anchored left, end-anchored right).
  - *Mark grammar* (ports `sparkline.js` semantics): line + dots = broad scores only, dot filled with the score's grade color; **diamonds** = focused re-checks at their outcome height, outcome-toned, never joined to the line; **filled diamond at the verdict's height** = adjudicated follow-up (all-corrected rides the 100 line); **baseline tick below the band** = scope-unknown. Legend: ○ broad score · ◇ re-check · | scope unknown.
  - *Hover:* the hovered mark scales ~1.7× while every other element (marks, line, grid, labels) dims to ~30%, ~150 ms ease both ways; the existing per-mark readout behavior ports.
  - *Panel sizing:* the trend is a labeled, framed section ("Trend · N visits"), full content width, ≥13px axis text — never a decorative micro-spark.

### 6.1 Ack dialog — ratified (mockup: [`ack-dialog.html`](mockups/ack-dialog.html))

**Draws on:** nothing — renders before any data fetch (C2).
**Must show:** the title alone ("Terms of Use and Data Acknowledgment", no kicker/lede); the terms as ONE verbatim document (cloned from About §06's single source) in an inset, recessed scroll box with a **persistent** scrollbar; actions centered, **Decline left (filled red) / Agree right (filled blue)** with the shipped labels; the empty basemap + ghosted brand/search shell behind a scrim.
**Must never show:** any fetched content; a second copy of the terms; a dismiss affordance that reads as a third choice.
**Interaction contract:** blocking on first load, zero data requests until answered (C2/C3); Agree → Full, Decline → basic map; Escape = unpersisted decline; `?tier=lite` bypasses entirely. Mobile (<~560px): bottom sheet, stacked full-width actions, Agree on top.
**C-invariants touched:** C2, C3, C8 (formal register, verbatim document).
**Theme:** both, scrim-over-basemap in each.

### 6.2 Map + hover + detail — ratified, 11 passes (mockup: [`map-view.html`](mockups/map-view.html))

**Draws on:** finder + overlay at boot; closed on toggle; detail + standards on click (C1).
**Must show:**
- *Chrome:* ONE floating band — brand · Map/List/About segmented switcher (navigation sits brand-adjacent) · search pill · A–F grade chips · Filters pill · Show closed · counts — that **reflows into the space left of an open panel; the panel never obscures chrome**. Footer attribution line per C8.
- *Markers:* grade-colored dots with a ring in every mode; letters on markers past a zoom threshold; dashed ring = declining; gray = basic map/unscored; same-point stacks as count bubbles.
- *Hover card* (fine pointers only; touch = click): identity + grade circle, the two anchor boxes (last broad · last visit), and the trend instrument per §6.0 — rendered wholly from the overlay row, zero fetches (C3).
- *Detail panel* (right sheet desktop, bottom sheet mobile): header = name/address + **Source** button (external grammar) + close; fact line (kind icon + word · status dot + word) with `≈ approximate location` as the one badge; the **grade hero as a single centered tappable box** — grade circle → score + trend chip (↘ Declining etc.) → anchor line ("Broad inspection · date") → divider → blue "Tap to see Grade breakdown" — the whole box opens the grade breakdown (the report-card modal, which carries the formula story; no separate wordy button); the trend section per §6.0; inspection history as expandable rows.
- *Inspection rows* (the full `inspection.js` inventory): collapsed = outcome badge (score pill / OUT-ratio / adjudicated ✓-chip) · date · purpose · scope badge (suppressed when an adjudication chip shows) · count chips (filled red/green violations box + risk-factor / retail-practice split) · boxed link-out · caret. Expanded = per-violation blocks (severity left-rail, red for risk factors; disposition + `#item` + fixed/repeat flags; **the ↳ per-violation corrective/comment line**); the grouped checklist ("N distinct applicable code items · N published rows · N OUT") with per-category pass-rate bars; the **Inspector comments** block (general + Additional text); Temperatures & sanitizer as its own collapsible.
**Must never show:** grade letters on individual inspections (scores only — the letter is the facility's, C1/C9); judgment content on the basic map (P6); per-hover or per-interaction fetches (C3); "official VDH" framing on any derived number (C8).
**Interaction contract:** hover fetches nothing; click fetches detail (+standards once); URL semantics per C6 (permit in the URL, pushState on select); panel close = Back; band controls write filter state per C6.
**C-invariants touched:** C1, C3, C6, C8, C9 (approximate-location note both tiers), C10.
**Theme:** both; markers re-validated against both basemaps.

### 6.3 List — ratified (mockup: [`list-view.html`](mockups/list-view.html))

**Draws on:** finder + overlay only (the nine fields + `visits`); no new data (frozen contract).
**Must show:** the same band chrome (List active); a dense sortable table — grade chip + score · name over address/city/zip · compliance % · trend (colored arrow + signed delta, em-dash when null) · last visit (date + scope/outcome); sticky headers with the active sort in accent + direction arrow; closed rows muted with a CLOSED word-badge (only when Show closed is on); NEW as the blue-dot word-badge; load-more ("Show 50 more · N match") per D-DATA-11.
**Must never show:** judgment columns on the basic map (name/address/identity only, P6); a pagination scheme other than load-more; columns needing data the overlay doesn't carry (out-of-program).
**Interaction contract:** header click sorts (URL `sort`/`dir` per C6); row click opens the shared detail panel (`permit` in URL); load-more appends 50 and writes `page=N`; narrow widths drop Compliance/Trend columns.
**C-invariants touched:** C1, C6 (sort/dir/page semantics, default sort worst-first score on Full / name on the basic map), C8, C9.
**Theme:** both.

### 6.4 About — ratified (mockup: [`about-view.html`](mockups/about-view.html))

**Draws on:** `manifest.freshness` + `counts` for the live cards; everything else is static content.
**Must show (content parity with the live page, restyled):** the hero with the three-badge **provenance legend** (Official source · Archived snapshot · CleanPlateVA-derived — a color+icon vocabulary reused by every section) + independent-presentation lede + four live cards (snapshot · newest report · places · coverage); **§01 Score anatomy** — weight board with point-block visuals (hollow blocks = repeat), both worked receipts (inspection 100−6−9−3=82 with score ring + banded-grade pill; grade 70→83·B with the not-laundered note), scope cards (20+/1–19/0), the grade scale bar in the ramp with a score marker, the four adjustment cards, the scoring edge cases disclosure; **§02 signals** — four cards (compliance formula · trend demo with unconnected diamond · red flags marked *Heuristic* · open repeats) + the red-flag weight disclosure; **§03 pipeline** — six steps with code chips + the GUID note; **§04 lineage** — official-vs-derived card pair + tier cards with the acknowledged-route line + current-access live card; **§05 limits** — all eight + the Verify-at-the-source card (external grammar); **§06 Terms** — the verbatim single-source body (`#aboutTermsBody` equivalent — the dialog clones it, C2) + the status panel OUTSIDE the cloned body, owning the one tier switch (red outline out / blue outline in; `?tier=lite` states the override, no button).
**Must never show:** a second terms copy; "official VDH rating" framing for any derived number; a terms control in the accepted chrome outside §06 (C2).
**Interaction contract:** `/about#aboutTerms` cold-loads to §06 (footer link target); disclosures expand in place; the status-panel button switches tier per C2's re-load semantics.
**C-invariants touched:** C2, C8 (register + attribution inventory), C9.
**Theme:** both.

### The acceptance-spec template (future views fill this)

```markdown
### <View> — acceptance spec (ratified <date>)
**Draws on:** <which finder/overlay/closed/detail/manifest fields — frozen-contract fields only>
**Must show:** <the content and states the view is required to render, incl. empty/degraded/lite states>
**Must never show:** <C8/C9/P6 guards — e.g. no judgment content on the basic map, no "official VDH score" framing, no shipped grade letters>
**Interaction contract:** <clicks/hovers/keys and what they do; which are URL-writing (C6) and which fetch (C3 — hover fetches nothing, detail on click only)>
**C-invariants touched:** <the §2 rows this view is responsible for upholding>
**Theme:** <dark-default + light parity notes (C10)>
```

## 7. Test strategy

*Resolution from D-CR-TEST-1 (§10).* **Vitest** replaces `node --test` as the runner on the new stack; `tests/support/dashboard.mjs` (the concatenated-source import shim) dies with the module graph it shims. The repo's CI check stays green-defined through every arc — at no point does `main` carry a red or empty suite.

**Port order — contract tripwires first** (these referee the rewrite itself):

| Today's suite | Disposition |
|---|---|
| `data-client-v4.test.mjs` | **Port first** — pins C1 whole (manifest/shard validation, sha binding, merge, fallbacks, LRU) |
| `lite-roster-contract.test.mjs` | **Port** — pins the committed Lite artifact contract + C5/C9 |
| `routes.test.mjs` · `search.test.mjs` | **Port** — pin C6's URL + search semantics (the pure functions port with their tests) |
| `ack.test.mjs` · `lite-override.test.mjs` | **Port** — pin C2 (versioned key, blocking first load, Escape, `?tier=lite`) |
| `permit-link-tenant.test.mjs` · `mobile-food-units.test.mjs` | **Port** — pin P8 tenant-routed VDH links + `is_restaurant`/`mobile` semantics (C9) |
| `retired-vocabulary.test.mjs` | **Stays as-is** (already runner-agnostic prose scan); CRC appends the rewrite's retirements |
| `worker-cache-contract.test.mjs` | **Untouched until CRC** — the Worker doesn't change; still runs under `node --test` until the flip PR consolidates runners |
| `grade-receipt.test.mjs` · `narrative-verdicts.test.mjs` · `scope-presentation.test.mjs` · `inspection-counts.test.mjs` · `hover-card.test.mjs` (the visits↔detail parity half) | **Port the pure-derivation halves** — they pin C1/C9 judgment math (`gradeForScore`, verdict presentation, visits parity), independent of markup |
| `dark-basemap-contrast` · `list-layout` · `toolbar-layout` · `marker-hit-slop` · `splitter` · `stack-panel` · `stack-spiderfy` · `about-transparency` · `hover-card` (markup half) | **Superseded by acceptance specs** — presentation pins of the old design; CRV re-pins the new design per §6, and these retire with the old client at CRC |

**Port status (CRF-M1, 2026-08-30):** the six contract rows above are PORTED — `tests/vitest/{data-client-v4, lite-roster-contract, routes, search, ack, lite-override, permit-link-tenant, mobile-food-units}.spec.ts` run against the `app/` modules (behavioral halves; the .mjs originals keep refereeing the served client until CRC, so both runners pin the same contracts). The pure-derivation rows (`grade-receipt` etc.) port at **CRV-a** together with `receipt.ts` and the surfaces that render them.

## 8. Budgets

*Resolution from D-CR-PERF-1 (§10, Cannon 2026-08-29): the request budget is the only hard gate; there is no wire budget.*

1. **The request budget is identical and hard (C3).** The rewrite adds no per-interaction fetches and no Worker-invoking asset paths. Vendored assets (MapLibre, fonts→SVG icons, all JS/CSS) are first-party static assets — free requests, zero Worker invocations, same as today's `/static/**`. The CDN's 5 requests leave the waterfall entirely.
2. **Asset wire bytes carry no pass/fail.** The baseline below stays as the dated reference point, and CRC still re-measures and *reports* the new build's asset table on the host with the same method — observed and compared, not gated.

**Production asset baseline — measured 2026-08-29** (`curl`, `accept-encoding: br` wire / `identity` raw, fresh visitor, app shell only — Contract V4 data payloads excluded, they don't change):

| Asset group | Requests | Wire (br) | Raw |
|---|---|---|---|
| Shell `/` (index.html) | 1 | 15.0 KB | 60.4 KB |
| `static/css/style.css` | 1 | 27.3 KB | 106.0 KB |
| 19 ES modules `static/js/*.js` | 19 | 118.6 KB | 350.5 KB |
| Bootstrap 5.3.3 CSS (jsDelivr) | 1 | 33.2 KB | 232.8 KB |
| bootstrap-icons 1.11.3 CSS + woff2 (jsDelivr) | 2 | 143.8 KB | 216.3 KB |
| MapLibre GL 5.19.0 CSS + JS (jsDelivr) | 2 | 276.3 KB | 1,093.4 KB |
| **Total** | **26** | **614.2 KB** | **2,053.3 KB** |

Notes for the CRC re-measure: the icons **font** (130.4 KB, incompressible) is the largest non-MapLibre line — inline tree-shaken SVGs replace it outright. Bootstrap's 33.2 KB retires into Tailwind's purged output. MapLibre (~267 KB wire) is the floor no stack choice moves; it merely changes host (CDN → first-party bundle). A same-order React + Tailwind build is *expected* to land under today's numbers; per D-CR-PERF-1 that expectation is reported against, not enforced.

## 9. Cutover sketch — what CRC inherits

- **One PR flips production:** `assets.directory` → `./dist`; delete `public/index.html`, `public/static/**`, `tests/support/dashboard.mjs`, and the superseded presentation suites (§7); `app.py` retires. Nothing else in `wrangler.jsonc` moves (C4).
- **Verified on the host after deploy** (`feedback_measure_host_behavior_not_the_stand_in`): the §2 constitution row by row; the §8 budgets re-measured (fresh-visitor Worker request counts + asset wire table, same method, stamped); the miss paths (`/data/finder/<missing>` → shell at `max-age=0`, HTML-200 = client miss).
- **Embed smoke:** the CannonAI Food tab against the new build — mount depth via `<base href>` rewrite, view tracked across reload, ack once per origin, `?tier=lite` (C7).
- **Retirements appended to architecture-v4.md §14.1, same PR:** Bootstrap 5.3.3 + bootstrap-icons + the jsDelivr CDN as a host; `static/css/style.css`; the 19 no-build ES modules and `public/index.html` as the shipped client; `tests/support/dashboard.mjs`; `app.py` as dev server; `node --test` as the app-suite runner. The site tripwire gains the rows CRC owns.

## 10. Open decisions registry — D-CR-*

Every fork the CR runways inherit. **Resolver** = the milestone that must close it; **Status** flips in this doc, same PR. Recommendations are the lead dev's; Cannon decides (via `AskUserQuestion` at the resolving milestone).

| ID | Question | Options | Recommendation | Resolver | Status |
|---|---|---|---|---|---|
| **D-CR-DOC-1** | Design reference name + home | `docs/frontend-redesign.md` (site repo, beside architecture-v4.md) · other name · runway-side doc | `docs/frontend-redesign.md`; site repo; architecture-v4.md's update rule | CRD-M0 | **resolved CRD-M0 2026-08-29 — `docs/frontend-redesign.md`, site repo** (this doc; the runway briefing now cites it) |
| **D-CR-LANG-1** | TypeScript or JS | TS strict · TS loose · JS + JSDoc | TS strict — the data client's decode/merge/fallback paths are exactly where types pay | CRD-M0 | **resolved CRD-M0 2026-08-29 — TypeScript strict** |
| **D-CR-BUILD-1** | Repo + build layout | Vite at repo root, app in `app/`, `publicDir: 'public'` (`data-full/**` excluded), output `dist/`, wrangler `assets.directory` → `./dist` at CRC · build into `public/` in place · separate package dir | First option — publisher write targets (C5) ride publicDir verbatim into `dist/`; `src/worker.js` and its `main` pointer never move | CRD-M0 | **resolved CRD-M0 2026-08-29 — root Vite, app in `app/`, output `dist/`**; `assets.directory` flips to `./dist` only at CRC (§3) |
| **D-CR-BUILD-2** | Workers Builds pipeline | add build command (`npm ci && npx vite build`) to the existing git integration · GitHub Action builds + commits `dist/` | Build command; **count builds/month against the Workers Builds quota at CRF-M0** — every daily data commit becomes a real build | CRD-M0 | **resolved CRD-M0 2026-08-29 — build command on the existing Workers Builds integration**; builds/month counted against the quota at CRF-M0 before relying (§3) |
| **D-CR-BUILD-3** | Local dev + `app.py`'s fate | Vite dev server; `app.py` retires at CRC · keep `app.py` as a parallel fallback indefinitely | Vite dev; `app.py` survives untouched until CRC, then retires → v4 §14.1 | CRD-M0 | **resolved CRD-M0 2026-08-29 — Vite dev server; `app.py` untouched until CRC, then retires** |
| **D-CR-ROUTE-1** | Router implementation | hand-rolled hook porting `router.js` semantics · react-router (library mode) · TanStack Router | Hand-rolled — C6's semantics are the spec, and libraries fight exactly those; revisit only if the redesign grows real route depth | CRD-M0 | **resolved CRD-M0 2026-08-29 — hand-rolled hook**; the pure functions port with their tests (§4) |
| **D-CR-MAP-1** | MapLibre binding | direct MapLibre instance in a ref'd container (React island) · react-map-gl wrapper | Direct — full control over markers/layers/events at 25k markers; the vendored npm dep replaces the CDN classic script | CRD-M0 | **resolved CRD-M0 2026-08-29 — direct MapLibre instance in a ref'd container (React island)** |
| **D-CR-STYLE-1** | Tailwind version + dark strategy | v4 (CSS-first config), class-based dark variant, dark default, tokens as CSS variables · v3.4 config-file | v4; class-dark; both themes first-class per C10 | CRD-M0 | **resolved CRD-M0 2026-08-29 — Tailwind v4, class-based dark variant, dark default** |
| **D-CR-STATE-1** | App state | React context + reducers · zustand (or similar) from day one | Context first; adopt an external store only if the URL ↔ map ↔ list sync measures painful, with the measurement written down | CRD-M0 | **resolved CRD-M0 2026-08-29 — context + reducers first**; an external store needs a written measurement (§4) |
| **D-CR-TEST-1** | Test strategy | Vitest; port contract tripwires first, presentation re-pinned per acceptance specs; `worker-cache-contract` untouched till CRC · keep `node --test` | Vitest; port order per §7; CI stays green-defined through every arc | CRD-M0 | **resolved CRD-M0 2026-08-29 — Vitest; port order per §7**; `worker-cache-contract` + `retired-vocabulary` untouched till CRC |
| **D-CR-EMBED-1** | CannonAI embed | preserve the iframe contract exactly (Vite `base` relative, router reads `baseURI`, replaceState-in-frame; CRC smokes it) · revisit the embed (out-of-program CannonAI arc) | Preserve; any Food-tab redesign is CannonAI's own arc, not CR's | CRD-M0 | **resolved CRD-M0 2026-08-29 — preserve the iframe contract exactly**; CRC smokes it (C7) |
| **D-CR-STAGE-1** | Where WIP is reviewed | local-only — Vite dev + throwaway-port builds with Cannon; production untouched until CRC · enable preview URLs · second Worker (`cleanplateva-next`) | Local-only — the other two publish WIP to the internet for a single-reviewer program; C4 stays undisturbed | CRD-M0 | **resolved CRD-M0 2026-08-29 — local-only**; production untouched until CRC's one-PR flip |
| **D-CR-PERF-1** | Budgets | request budget identical (hard, C3) + wire ceiling = §8's measured 614.2 KB baseline, negotiable with evidence at CRC · no wire budget | First — measured, not assumed | CRD-M0 | **resolved CRD-M0 2026-08-29 (Cannon) — NO wire budget** (not the recommendation): the request budget (C3) is the only hard gate; §8's baseline stays a dated reference point, and CRC re-measures and *reports* the wire on the host without a byte gate |
| **D-CR-ARC-1** | CRV single or split | split CRV-a (shell/Map/hover/detail) + CRV-b (List/About/terms/ack chrome) · one CRV arc | Split — matches pace-yourself; each half is one reviewable surface | CRD-M0 | **resolved CRD-M0 2026-08-29 — split CRV-a + CRV-b** (Cannon: two arcs for finer review) |
| **D-CR-UX-1** | Per-view redesign directions | resolved at **CRD-M1** with mockups in hand, not in prose at M0 | Constraints pinned in advance: C2 ack semantics + Cannon's terms document verbatim · C8 register + "basic map" · C9 labels · red = the way to the basic map, blue = the way to the grades (ratified dialog color language) | CRD-M1 | **resolved CRD-M1 2026-08-29 — all four views ratified in-session** (ack dialog · Map/hover/detail after 11 passes · List · About at full content parity), specs in §6, mockups under `docs/mockups/`. The session also ratified the style tile ("slate & signal"), the grade-ramp change (F darkened; B lime by Cannon's call, §6.0), Lucide-only icons, the badges-are-a-sometimes-thing rule, the external grammar, and the trend instrument (absolute rest-and-extend scale, full mark grammar, hover enlarge+dim). |

## 11. History

| Date | Change |
|---|---|
| 2026-08-29 | Doc created at CRD-M0 from `c-ground-code/runway/cleanplate-react-redesign.md` (the program opener): program frame (§1, ratified this day), parity constitution moved here from the briefing (§2), production asset baseline measured and stamped (§8), acceptance-spec template (§6), fork registry seeded (§10). |
| 2026-08-29 | **CRD-M0 fork rounds (Cannon, `AskUserQuestion`, 4 rounds).** All 14 M0 forks resolved — twelve as recommended (D-CR-DOC/LANG/BUILD-1..3/ROUTE/MAP/STYLE/STATE/TEST/EMBED/STAGE-1), two Cannon's own calls: **D-CR-PERF-1 no wire budget** (the request budget is the only hard gate; §8 re-framed the same day) and **D-CR-ARC-1 split CRV-a + CRV-b** for finer review. D-CR-UX-1 remains open for M1. §3–§5, §7–§8 record the resolved end state. |
| 2026-08-29 | **CRD-M1 — the visual direction, ratified view by view** (same session; mockups on a throwaway :5610, reviewed live). The style tile ("slate & signal": slate chrome, judgment/action color reservation, dark default, system type + tabular-nums) ratified with `mockups/tokens.css` as the vocabulary. The **grade ramp** re-validated: F darkened `#e03131`→`#a61e1e` (fixes the live D↔F normal-vision fail, 7.6→~15); a teal B was ratified then reverted on review — **B stays lime `#94be1b` (Cannon: blue belongs to NEW alone)**, decision record `mockups/ramp-candidates.html`. The **Map ensemble took eleven passes** and produced the cross-view rules of §6.0: Lucide-only icons (no emoji); badges-are-a-sometimes-thing (permanent facts render structurally; **Source** + per-inspection link-outs in the blue-outline box-and-arrow external grammar); the tappable centered grade hero; and the **trend instrument** — absolute rest-100→55-extend-on-demand scale (stress-tested against a one-visit-29 outlier, `mockups/trend-compare.html`), A·C·F band labels, full `sparkline.js` mark grammar (dots/diamonds/verdict-height/ticks), hover enlarge+dim, full-size framed presentation. Inspection rows rebuilt to the full `inspection.js` inventory (purpose, scope, count chips, per-violation ↳ corrective lines, Inspector comments + Additional, grouped checklist with pass bars, temps). List ratified first pass; About after a rebuild to full content parity (hero provenance legend + §01–§06). **Acceptance specs written (§6.1–6.4); D-CR-UX-1 resolved; CRD is complete** — CRF next, teed up as its own briefing. |
| 2026-08-29 | **CRF-M0 — scaffold + pipeline.** The D-CR-BUILD-1 layout landed: Vite at the repo root (v8.2, Rolldown-based), app under `app/`, React 19.2 + TypeScript 7.0 `strict` + Tailwind v4.3 + Vitest 4.1 + Lucide; `docs/mockups/tokens.css` translated to the Tailwind `@theme` (`app/theme.css`, `--cp-*` vars source-of-truth, class-flip `.theme-light`, dark default per C10). Build = `vite build` + a filtered publicDir copy (`copyPublicDir: false` + plugin): `public/data/**` + `_headers` ride into `dist/` byte-identical (C5, pinned by `tests/vitest/dist-contract.spec.ts`), `data-full/**` + the old client (`index.html`, `static/**`) excluded. CI runs both suites (`npm ci`, `vite build`, `vitest run`, `node --test` — 290 legacy tests stay green). Dev = Vite dev server with `public/` passthrough (`data-full/**` unwatched — a 13.6 s cold load without that). Metered-unit check recorded in §3; build command handed to the dashboard post-merge. `wrangler.jsonc` untouched (C4). |
| 2026-08-30 | **CRF-M1 — the V4 client on the new stack.** The data layer ported to TS strict per §5: `app/data/client.ts` (`createFoodApi` whole — manifest-led boot, static-first finder w/ R2 fallback, sha binding, position merge, closed/standards/detail lazy paths, LRU 200, HTML-200-is-a-miss, P4 degrade, call-time ack gate), `app/data/presentation.ts` (grade/scope/trend/date math + `visitsOf`; HTML emitters dropped — React owns markup; `receipt.ts` deferred to CRV-a with its suite), `app/ack.ts` (versioned key, `createAckState`, `forceLiteFromSearch`), `app/router.ts` (the §4 pure functions), `app/search.ts` (terms/phrase/ZIP-prefix + filter predicate), types from v4 §6.2 (`app/data/types.ts` — vocab codes typed open, never closed unions). Six §7 contract suites ported to Vitest (64 tests; legacy 290 stay green). **Proof boot verified on the dev server** (`app/App.tsx` + `ProofMap.tsx` + a §5 provider): undecided → zero data fetches (C2); decline → gray basic map, 1+16 lite requests exactly; agree → full boot with finder off the static channel + 16 `/data-full/` overlays, 25,164 dots in the ratified ramp; `?tier=lite` → basic map, controls hidden (D-ACK-3). Found + fixed: Vite 8/Rolldown's dep optimizer breaks maplibre-gl's worker silently (`optimizeDeps.exclude`, dev-only). Bundle 309 KB gzip (reported, no gate — under the old client's MapLibre-alone wire). Zero view UI — CRV-a next. |
