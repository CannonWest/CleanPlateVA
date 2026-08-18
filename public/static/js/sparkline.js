/**
 * Trend sparkline — the broad-score line with focused / narrative diamonds
 * and baseline ticks, its hover highlight, and the click-through to the
 * exact history row. Shared by the hover card (static) and the detail panel
 * (interactive, width-fitted). `sparklineMethods` is installed on
 * FoodDashboard.prototype by foodDashboard.js (`this` is the dashboard).
 */

import { GRADE_COLORS } from './constants.js';
import {
    buildScopeSeries, esc, fmtDate, focusedOutcomePresentation, narrativeVerdictPresentation,
} from './presentation.js';

// The static markup around one plot. Initial render at the default viewBox
// width; _bindSparkline (panel only) re-renders at a width matched to the
// card's rendered size so the points spread to fill it (the height stays
// locked — see _sparkSvg and the CSS). `dashboard` is whatever object carries
// `_sparkSvg` + `_scoreColor` — the FoodDashboard prototype in the app, a bare
// context in the suites.
function sparkMarkup(dashboard, series) {
    if (!series?.events?.length) return '';
    const { svg, nodes } = dashboard._sparkSvg(series, 280);
    return `<div class="food-spark" data-spark-nodes="${esc(JSON.stringify(nodes))}">
            <span class="food-grade-caption">Trend</span>
            ${svg}
        </div>`;
}

export const sparklineMethods = {
    // One comparison history: broad assessments form the connected line;
    // focused inspections keep their time position as unconnected raw-formula
    // diamonds, colored by their own OUT/addressed compliance outcome. They do
    // not join the broad score line. Unknown-scope events are baseline ticks.
    _sparkline(inspections) {
        return sparkMarkup(this, buildScopeSeries(inspections));
    },

    // The one renderer behind both surfaces: the click panel hands it the
    // detail's inspections (through buildScopeSeries, above); the hover card
    // hands it the roster row's `visits` (through presentation.visitsOf) —
    // same series shape, same marks, no fetch.
    _sparklineFromSeries(series) {
        return sparkMarkup(this, series);
    },

    // The trend SVG for a given viewBox width W, plus the hover node registry.
    // Only the x-spacing depends on W: the vertical geometry (H and the pads) is
    // fixed, so the plot HEIGHT is locked (CSS renders the svg at 5.0775rem).
    // Re-running with a wider W — _bindSparkline matches it to
    // the rendered width — spreads the points to fill the room WITHOUT resizing
    // the marks, because the scale stays uniform. `padTop = 45.55` leaves
    // hairline headroom above the 1.5x hover label; innerH 34 is the score band.
    _sparkSvg(series, W) {
        const H = 101.55, padX = 27, padTop = 45.55, padBot = 22;
        const innerH = H - padTop - padBot;
        const x = (i) => series.events.length === 1 ? W / 2
            : padX + i * ((W - padX * 2) / (series.events.length - 1));
        const y = (s) => padTop + (1 - s / 100) * innerH;
        // Hover hit-test registry: one entry per plotted mark, in viewBox
        // units. `_bindSparkline` reads this back off the DOM to enlarge the
        // nearest node. Replaces the per-node <title> tooltips (pure-visual
        // hover — the score labels already sit on-canvas).
        const nodes = [];
        const coords = series.broad.map((event) =>
            `${x(event.index).toFixed(1)},${y(event.presentation.score).toFixed(1)}`);
        const broadDots = series.broad.map((event) => {
            const px = x(event.index), py = y(event.presentation.score);
            const c = this._scoreColor(event.presentation.score);
            nodes.push({
                k: 'broad', x: +px.toFixed(1), y: +py.toFixed(1),
                s: event.presentation.score, c, historyIndex: event.historyIndex,
            });
            return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.95" fill="${c}"/>`;
        }).join('');
        const broadLabels = series.broad.map((event) =>
            `<text class="food-spark-score" x="${x(event.index).toFixed(1)}" y="${(y(event.presentation.score) - 9).toFixed(1)}" text-anchor="middle">${event.presentation.score}</text>`).join('');
        // Neutral baseline tick, below the score band: an event happened here
        // and the record doesn't support claiming how it went.
        const baselineTick = (px, event) => {
            const y1 = H - padBot + 1, y2 = H - 6;
            nodes.push({
                k: 'unknown', x: +px.toFixed(1),
                y: +((y1 + y2) / 2).toFixed(1), y1, y2,
                historyIndex: event.historyIndex,
            });
            return `<line class="food-spark-unknown" x1="${px.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${px.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
        };
        // A focused re-check plots at its COMPLIANCE — the IN-share of the few
        // items actually re-examined — and is labeled with that same X/Y OUT
        // ratio. It is NOT plotted at its raw VDH score, and the raw score is
        // not shown here at all.
        //
        // The raw score is `100 − the point weights of the items looked at`, so
        // on a 3-item follow-up docket it is structurally pinned near 100 no
        // matter how the visit went: its denominator is the whole 100-point
        // inspection while its numerator is a handful of items. Lakeside Grill
        // (6920 Lakeside Ave) is the case that surfaced it — its 2026-03-06 and
        // 2026-04-02 follow-ups were 3/3 OUT, nothing corrected either time, and
        // they plotted as r90 and r92 at the top of the chart inside the A band.
        // The line even ROSE between them, because the second inspector wrote
        // one fewer violation row for the identical three failed items.
        // Compliance is the axis the failure actually lives on — and it is the
        // axis the narrative verdicts below already plot against, so all three
        // mark families now speak one language.
        const focusedMarks = series.focused.map((event) => {
            const px = x(event.index);
            const outcome = focusedOutcomePresentation(event.presentation);
            // No trustworthy distinct-OUT ratio ⇒ no height to claim.
            if (!outcome.ratioKnown) return baselineTick(px, event);
            const py = y(outcome.complianceRate * 100);
            const label = `${outcome.out}/${outcome.total}`;
            nodes.push({
                k: 'focused', x: +px.toFixed(1), y: +py.toFixed(1),
                s: label, tone: outcome.tone, historyIndex: event.historyIndex,
            });
            return `<rect class="food-spark-focused food-outcome-${outcome.tone}" x="${(px - 6.3).toFixed(1)}" y="${(py - 6.3).toFixed(1)}" width="12.6" height="12.6" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`
                + `<text class="food-spark-mark-label" x="${px.toFixed(1)}" y="${(py - 11.25).toFixed(1)}" text-anchor="middle">${label}</text>`;
        }).join('');
        // Scope-unknown events: an adjudicated written verdict plots as a
        // FILLED diamond at the height its verdict describes — "all
        // corrected" up at the 100 line (it IS the full-clear the comment
        // claims), "not corrected" down at 0, priority/enumerated between
        // (adj.height). Filled = comment verdict; hollow = focused checklist
        // re-check. Un-adjudicated events keep the neutral baseline tick,
        // below the score area, claiming nothing.
        let narrCount = 0;
        const unknownMarks = series.unknown.map((event) => {
            const px = x(event.index);
            const adj = narrativeVerdictPresentation(event.inspection);
            if (adj) {
                narrCount += 1;
                const py = y(adj.height);
                // Enumerated written verdicts already know how many items the
                // glyph asserts: IN beside a check, OUT beside an X. Carry the
                // same counted label used by the history badge onto both the
                // static trend and its enlarged hover clone. Blanket verdicts
                // deliberately stay unnumbered because they name no item set.
                const label = `${adj.glyph}${adj.count ?? ''}`;
                nodes.push({
                    k: 'narr', x: +px.toFixed(1), y: +py.toFixed(1),
                    tone: adj.tone, g: adj.glyph, s: label,
                    historyIndex: event.historyIndex,
                });
                return `<rect class="food-spark-narr food-outcome-${adj.tone}" x="${(px - 6.3).toFixed(1)}" y="${(py - 6.3).toFixed(1)}" width="12.6" height="12.6" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})"/>`
                    + `<text class="food-spark-mark-label" x="${px.toFixed(1)}" y="${(py - 11.25).toFixed(1)}" text-anchor="middle">${label}</text>`;
            }
            return baselineTick(px, event);
        }).join('');
        // Vertical gradient in user space: top (score 100) → bottom (score 0),
        // stops at the grade-band boundaries (A green · B lime · C amber · D
        // orange · F red).
        const grad = `<linearGradient id="food-spark-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${y(100).toFixed(1)}" x2="0" y2="${y(0).toFixed(1)}">`
            + `<stop offset="0" stop-color="${GRADE_COLORS.A}"/>`
            + `<stop offset="0.1" stop-color="${GRADE_COLORS.A}"/>`
            + `<stop offset="0.2" stop-color="${GRADE_COLORS.B}"/>`
            + `<stop offset="0.3" stop-color="${GRADE_COLORS.C}"/>`
            + `<stop offset="0.4" stop-color="${GRADE_COLORS.D}"/>`
            + `<stop offset="0.45" stop-color="${GRADE_COLORS.F}"/>`
            + `<stop offset="1" stop-color="${GRADE_COLORS.F}"/>`
            + `</linearGradient>`;
        const line = coords.length > 1
            ? `<polyline points="${coords.join(' ')}" fill="none" stroke="url(#food-spark-grad)" stroke-width="2.625" stroke-linejoin="round" stroke-linecap="round"/>` : '';
        const broadSummary = series.broad.length
            ? `Broad scores oldest to newest: ${series.broad.map((event) => `${fmtDate(event.inspection.date)} ${event.presentation.score}`).join(', ')}`
            : 'No broad scores captured';
        const focusedSummary = series.focused.length
            ? `Focused re-checks: ${series.focused.map((event) => `${fmtDate(event.inspection.date)} ${focusedOutcomePresentation(event.presentation).description}`).join(' · ')}`
            : 'No focused re-checks';
        const accessibleSummary = `${broadSummary}. ${focusedSummary}. `
            + `${series.unknown.length} unknown-scope event${series.unknown.length === 1 ? '' : 's'}`
            + (narrCount ? `, ${narrCount} with an adjudicated written verdict` : '') + '.';
        // No width/height attrs — CSS sizes the svg (fixed height, 100% width);
        // the viewBox width W (matched to the render by _bindSparkline) is what
        // spreads the points. No legend under the plot: the About page teaches
        // the line-vs-◇ vocabulary, and hover + the aria summary carry the rest.
        const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(accessibleSummary)}">
                <defs>${grad}</defs>
                ${line}
                ${broadDots}
                ${broadLabels}
                ${focusedMarks}
                ${unknownMarks}
                <g class="food-spark-hl" pointer-events="none"></g>
                <rect class="food-spark-overlay" x="0" y="0" width="${W}" height="${H}"/>
            </svg>`;
        return { svg, nodes };
    },

    // Enlarged foreground clone of the hovered node — pure visual, no text
    // tooltip. Shape mirrors the base mark (dot / rotated square / baseline
    // tick); painted into the top <g> so it lifts above its neighbours.
    _sparkHighlight(n) {
        if (n.k === 'broad') {
            return `<circle class="food-spark-hl-dot" cx="${n.x}" cy="${n.y}" r="9.9" fill="${n.c}"/>`
                + `<text class="food-spark-score food-spark-hl-label" x="${n.x}" y="${(n.y - 19.125).toFixed(1)}" text-anchor="middle">${n.s}</text>`;
        }
        if (n.k === 'focused') {
            const h = 10.35;
            return `<rect class="food-spark-focused food-spark-hl-dia food-outcome-${n.tone}" x="${(n.x - h).toFixed(1)}" y="${(n.y - h).toFixed(1)}" width="${(h * 2).toFixed(1)}" height="${(h * 2).toFixed(1)}" transform="rotate(45 ${n.x} ${n.y})"/>`
                + `<text class="food-spark-mark-label food-spark-hl-label" x="${n.x}" y="${(n.y - 21.375).toFixed(1)}" text-anchor="middle">${n.s}</text>`;
        }
        if (n.k === 'narr') {
            const h = 10.35;
            return `<rect class="food-spark-narr food-spark-hl-dia food-outcome-${n.tone}" x="${(n.x - h).toFixed(1)}" y="${(n.y - h).toFixed(1)}" width="${(h * 2).toFixed(1)}" height="${(h * 2).toFixed(1)}" transform="rotate(45 ${n.x} ${n.y})"/>`
                + `<text class="food-spark-mark-label food-spark-hl-label" x="${n.x}" y="${(n.y - 21.375).toFixed(1)}" text-anchor="middle">${n.s ?? n.g}</text>`;
        }
        return `<line class="food-spark-unknown food-spark-hl-tick" x1="${n.x}" y1="${n.y1}" x2="${n.x}" y2="${n.y2}"/>`;
    },

    // Open the exact history row represented by a trend node, then bring the
    // expanded card into view inside the scrolling detail panel.
    _openInspectionFromTrend(root, historyIndex) {
        if (!Number.isInteger(historyIndex) || historyIndex < 0) return false;
        const target = root.querySelector(
            `.food-insp[data-inspection-index="${historyIndex}"]`);
        if (!target) return false;
        target.open = true;
        // Scroll the compact summary, not the potentially multi-screen details
        // body. Pin it directly below the sticky facility title so the selected
        // inspection reads as the new top of the view, regardless of title
        // height or how tall the expanded violation copy is.
        const anchor = target.querySelector('summary') || target;
        const scroller = root.closest?.('.food-detail');
        const stickyHead = root.querySelector('.food-detail-head');
        requestAnimationFrame(() => {
            if (!scroller || !stickyHead) {
                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            const top = scroller.scrollTop
                + anchor.getBoundingClientRect().top
                - stickyHead.getBoundingClientRect().bottom
                - 1; // clear the sticky header's bottom border after subpixel rounding
            scroller.scrollTo({ top, behavior: 'smooth' });
        });
        return true;
    },

    // Desktop hover: enlarge the single nearest node within a max radius and
    // lift it to the foreground; clicking that highlighted node expands and
    // scrolls to its exact inspection row. Nothing activates outside the
    // radius. No-op on touch (no mousemove). Rebound on every detail render —
    // a stale closure would address phantom points after a scope/facility
    // change.
    _bindSparkline(root, inspections) {
        const container = root.querySelector('.food-spark');
        if (!container) return;
        const series = buildScopeSeries(inspections || []);
        if (!series.events.length) return;

        // Enlarge the single nearest node within a max radius and lift it to the
        // foreground. Re-queries the current svg each call, so it re-binds
        // cleanly after a resize re-render — the old overlay (and its listener)
        // is replaced, never stacked.
        const bindHover = () => {
            const svg = container.querySelector('svg');
            const hl = container.querySelector('.food-spark-hl');
            const overlay = container.querySelector('.food-spark-overlay');
            if (!svg || !hl || !overlay) return;
            let nodes;
            try { nodes = JSON.parse(container.dataset.sparkNodes || '[]'); }
            catch { nodes = []; }
            if (!nodes.length) return;
            const vb = svg.viewBox.baseVal;
            const MAX_R = 12;                 // max-boundary, viewBox units
            // Base score labels: the active node's small label hides while its
            // enlarged one shows, so the two sizes don't overlap and smear.
            const baseLabels = [...svg.querySelectorAll('text.food-spark-score, text.food-spark-mark-label')];
            let activeIdx = -1;
            const clear = () => {
                overlay.classList.remove('food-spark-overlay-active');
                if (activeIdx === -1) return;
                hl.textContent = '';
                baseLabels.forEach((t) => { t.style.visibility = ''; });
                activeIdx = -1;
            };
            overlay.addEventListener('mousemove', (evt) => {
                const rect = svg.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const px = (evt.clientX - rect.left) / rect.width * vb.width;
                const py = (evt.clientY - rect.top) / rect.height * vb.height;
                let best = -1, bestD = MAX_R * MAX_R;
                for (let i = 0; i < nodes.length; i++) {
                    const dx = nodes[i].x - px, dy = nodes[i].y - py;
                    const d = dx * dx + dy * dy;
                    if (d <= bestD) { bestD = d; best = i; }
                }
                if (best === -1) { clear(); return; }
                if (best !== activeIdx) {
                    hl.innerHTML = this._sparkHighlight(nodes[best]);
                    const nx = nodes[best].x;
                    baseLabels.forEach((t) => {
                        t.style.visibility = Math.abs(parseFloat(t.getAttribute('x')) - nx) < 0.6 ? 'hidden' : '';
                    });
                    activeIdx = best;
                    overlay.classList.add('food-spark-overlay-active');
                }
            });
            overlay.addEventListener('click', () => {
                const node = nodes[activeIdx];
                if (node) this._openInspectionFromTrend(root, node.historyIndex);
            });
            overlay.addEventListener('mouseleave', clear);
        };

        // Match the viewBox width to the rendered width so the points spread to
        // fill the card while the marks keep their size (uniform scale) and the
        // height stays locked. Returns true when it actually re-rendered.
        const fit = () => {
            const svg = container.querySelector('svg');
            if (!svg) return false;
            const svgH = svg.getBoundingClientRect().height;   // the locked height, px
            if (!svgH) return false;
            const H = svg.viewBox.baseVal.height;
            const cs = getComputedStyle(container);
            const availW = container.clientWidth
                - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
            if (availW <= 0) return false;
            // The viewBox width tracks the available px width at the locked height,
            // so the svg's intrinsic size (width:auto) fills the card — the points
            // spread and the scale stays uniform. Round DOWN so intrinsic ≤ availW.
            const W = Math.max(120, Math.floor(availW * H / svgH));
            if (Math.abs(svg.viewBox.baseVal.width - W) < 1) return false;
            const next = this._sparkSvg(series, W);
            container.dataset.sparkNodes = JSON.stringify(next.nodes);
            svg.outerHTML = next.svg;      // old svg + its hover listener go with it
            return true;
        };

        bindHover();                       // wire the initial (default-width) svg
        if (fit()) bindHover();            // fit to the render, re-wire if it changed
        // Keep it fitted as the panel/viewport changes width (rAF-debounced; a
        // re-render never changes the container width, so this can't loop).
        if (typeof ResizeObserver !== 'undefined') {
            let raf = 0;
            const ro = new ResizeObserver(() => {
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => { if (fit()) bindHover(); });
            });
            ro.observe(container);
        }
    },
};
