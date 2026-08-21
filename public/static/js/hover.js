/**
 * Marker-bound hover card — the display-only popup a mouse gets over a
 * marker. Contract V4: the card renders INSTANTLY and COMPLETELY from the
 * roster row — the finder + overlay: name, address, grade circle / NEW /
 * no-grade dash, the "Last broad inspection · Last visit" date cards, and
 * the trend sparkline drawn from the overlay's `visits` column (CPH,
 * D-DATA-13). Nothing is fetched on hover: on Workers Free the metered unit
 * is the request, and a curious mouse must cost zero. The click panel still
 * fetches the facility detail (P5). `hoverMethods` is installed on
 * FoodDashboard.prototype by foodDashboard.js (`this` is the dashboard).
 */

import {
    approximateLabel, esc, gradePresentation, facilityPresentation, isActivePermit,
    isNewlyPermitted, latestDateOf, visitsOf,
} from './presentation.js';

// How much of the stack panel a hover card may sit on before the card is moved
// to the other side of its marker. Cannon's line, 2026-08-19: a card covering
// the WHOLE panel has to move; one clipping its edge is honestly fine. Area,
// not a rectangle test — an overlap that leaves the header and most rows
// readable is not worth making the card jump.
const PANEL_COVER_LIMIT = 0.6;

// The card's standoff from its point when nothing is in the way. Named because
// a nudged card gives it up, and the nudge has to know what it is restoring.
const TIP_OFFSET = 12;

// The width floor is real: below ~220 the hero stops laying out and the
// sparkline has nowhere to go, and a map that narrow is a sliver nobody is
// reading.
const TIP_MIN_WIDTH = 220;
// The height floor is deliberately near-nothing. Anything above the room
// available means the card hangs over the very bar this is meant to keep it
// off — measured at 18px of overhang on a 95px map when the floor was 96. An
// abbreviated card inside the map beats a complete one spilling out of it.
const TIP_MIN_HEIGHT = 40;

/** Correct a popup anchor so the card lands INSIDE the map.
 *
 *  `.food-map-wrap` clips its overflow, so a card that runs past the map's
 *  edge is not merely ugly — the part of it beyond the edge is cut off, and
 *  the edge that matters most is the one the detail panel or the stacked
 *  bottom bar has just moved inward. Measured with the panel open: a card near
 *  the right edge ran 66px past it and lost that strip. MapLibre flips at the
 *  left and top edges on its own but did not at the right.
 *
 *  Anchor names say where the POPUP'S OWN corner sits, so they read inverted:
 *  hanging off the right edge is fixed by anchoring `right`, which puts the
 *  card to the LEFT of its point. Returns null when nothing needs moving, so
 *  the common case re-renders nothing.
 */
export function fitAnchor(card, view, anchor = null) {
    const parts = new Set(String(anchor || '').split('-').filter(Boolean));
    let moved = false;
    if (card.right > view.right) { parts.delete('left'); parts.add('right'); moved = true; }
    else if (card.left < view.left) { parts.delete('right'); parts.add('left'); moved = true; }
    if (card.bottom > view.bottom) { parts.delete('top'); parts.add('bottom'); moved = true; }
    else if (card.top < view.top) { parts.delete('bottom'); parts.add('top'); moved = true; }
    if (!moved) return null;
    // MapLibre wants the vertical component first.
    const vertical = parts.has('top') ? 'top' : (parts.has('bottom') ? 'bottom' : '');
    const horizontal = parts.has('left') ? 'left' : (parts.has('right') ? 'right' : '');
    return [vertical, horizontal].filter(Boolean).join('-') || null;
}

/** Is an open card's placement stale — does it need placing again?
 *
 *  Split out from the reflow so the rule is testable without a map. Two
 *  reasons to re-place, and only two:
 *
 *  OUTSIDE. The map's box moved out from under the card. The splitter shrinks
 *  the map horizontally against the sidebar and vertically against the bottom
 *  bar, and a pan or a zoom slides the card's own point across it — measured
 *  live, a card placed in an 814px map sat 147px behind the sidebar after a
 *  drag to 341px, and a 160px pan carried another exactly 160px out.
 *
 *  OUTGROWN. The card is inside, but only because `_nudgeCardIntoView` bought
 *  it room with an offset — AND the map's box has changed since. That offset
 *  was owed to the box it was measured against; once the splitter hands the
 *  room back, holding it strands the card away from its own marker.
 *
 *  The box comparison is what makes the second reason affordable. "Nudged"
 *  alone is a permanent condition — a card pinned to an edge stays pinned —
 *  so reflowing on it would re-show on every move event for ever, measured at
 *  24ms a time against 25k markers — a re-show that has to re-anchor and
 *  re-nudge is three times one that only re-lays the card. Nudged AND MOVED
 *  is a one-shot.
 *
 *  Everything else is left alone on purpose. `move` fires on every frame of a
 *  pan, so the quiet case has to cost nothing, and it does: measured at
 *  0.01ms across 40 pans of a card sitting comfortably inside, with zero
 *  re-shows. Panel coverage is NOT a reason either: `is-yielded` is opacity,
 *  not layout, so a yielded panel keeps its box and a card resting over one
 *  would re-show every frame for ever. Coverage is placement-time logic, and
 *  the re-show re-runs it anyway.
 */
export function needsReflow(card, view, placed = null) {
    if (!card || !card.width) return false;
    // An unmeasured map constrains nothing, so nothing about it is stale.
    if (!Number.isFinite(view.right)) return false;
    if (card.left < view.left || card.right > view.right) return true;
    if (card.top < view.top || card.bottom > view.bottom) return true;
    if (!placed || !placed.nudged) return false;
    return !sameBox(view, placed.view);
}

/** Two map boxes, same rectangle? Rounded, because a fractional device-pixel
 *  difference is not the splitter moving — and treating it as one would put
 *  the reflow back on every frame, which is the cost this avoids. */
function sameBox(a, b) {
    if (!a || !b) return false;
    return Math.round(a.left) === Math.round(b.left)
        && Math.round(a.top) === Math.round(b.top)
        && Math.round(a.right) === Math.round(b.right)
        && Math.round(a.bottom) === Math.round(b.bottom);
}

export const hoverMethods = {
    // ── marker-bound hover card ────────────────────────────────────────
    _hideHoverCard() {
        this._hoverPid = null;
        this._hoverShown = null;
        this._hoverPlaced = null;
        this._hoverPopup?.remove();
        this._yieldStackPanel(false);
    },

    /** The popup to use, built with the anchor this moment needs.
     *
     *  MapLibre opens a popup UPWARD by default, and the stack panel stands
     *  above the web — so a leg's card and the panel compete for the same
     *  strip of screen and the panel would yield on nearly every hover. That
     *  is worse than it sounds: the row the leg lights up lives IN the panel,
     *  so yielding hides the very highlight the hover just produced. Anchoring
     *  a leg's card to 'top' hangs it BELOW the leg instead, where the panel
     *  is not, and the two coexist the way they should. Recreated rather than
     *  mutated because `anchor` is a construction option. */
    _hoverPopupFor(anchor) {
        if (this._hoverPopup && this._hoverPopupAnchor === anchor) return this._hoverPopup;
        if (typeof maplibregl === 'undefined') return this._hoverPopup;
        this._hoverPopup?.remove();
        this._hoverPopup = new maplibregl.Popup({
            closeButton: false, closeOnClick: false,
            offset: 12, maxWidth: '280px', className: 'food-tip',
            ...(anchor ? { anchor } : {}),
        });
        this._hoverPopupAnchor = anchor;
        return this._hoverPopup;
    },

    _showHoverCard(lngLat, f, { below = false } = {}) {
        if (!this._hoverPopupFor(below ? 'top' : null)) return;
        this._hoverPid = f.permit_id;
        // Kept so the card can be placed AGAIN when the map moves under it.
        // Placement is only true for the geometry it was measured in.
        this._hoverShown = { lngLat, f, below };
        const lite = this._mode === 'lite';
        const html = this._hoverCardHTML(f);
        const view = this._mapViewBox();
        const place = (anchor) => {
            const popup = this._hoverPopupFor(anchor);
            // Lite keeps the slim name+address tip; the hero card needs room —
            // but neither may be WIDER THAN THE MAP. `.food-map-wrap` clips its
            // overflow, so a card bigger than its container is not re-anchored
            // out of trouble, it is sliced. The splitter made that reachable:
            // drag the panel to 70% and a 1280px window leaves a 349px map
            // against a 380px hero, which lost 217px off its right edge.
            const room = Math.round(view.right - view.left);
            const tier = lite ? 280 : 380;
            // An unmeasured map caps nothing; the tier's own width stands.
            popup.setMaxWidth(`${Number.isFinite(room)
                ? Math.max(TIP_MIN_WIDTH, Math.min(tier, room)) : tier}px`);
            // Start from the plain standoff every time: a nudge left over from
            // the last card would bias the measurement taken after this one.
            popup.setOffset(TIP_OFFSET);
            popup.setLngLat(lngLat).setHTML(html).addTo(this._map);
            // The same argument on the other axis, which the stacked splitter
            // reaches sooner: drag the bottom bar up and a 193px map faces the
            // same 263px card, overflowing 179px INTO the panel. Capped here
            // rather than in the stylesheet because only this knows the map's
            // current height. A card with no room left is abbreviated, which
            // is at least a clean edge inside the map instead of a slice.
            const headroom = view.bottom - view.top;
            const el = popup.getElement();
            const content = el.querySelector('.maplibregl-popup-content');
            if (content) {
                // Capped on the CONTENT, but the overflow is measured on the
                // OUTER box, so the popup's own chrome — padding and tip — has
                // to come off the allowance or the card lands exactly that much
                // too tall. Measured live at 9px, which is what was left over
                // the top of a 245px map. Measured rather than hardcoded: the
                // padding differs between the slim tip and the hero card.
                const chrome = el.getBoundingClientRect().height
                    - content.getBoundingClientRect().height;
                content.style.maxHeight = Number.isFinite(headroom)
                    ? `${Math.max(TIP_MIN_HEIGHT, Math.round(headroom - chrome))}px`
                    : '';
            }
        };
        let anchor = below ? 'top' : null;
        place(anchor);
        // Any card that would bury the stack panel moves to the other side of
        // its own marker — not just the legs inside the web (Cannon,
        // 2026-08-19). Measured after placing rather than predicted: a card is
        // a slim tip in Lite and a hero with a sparkline in Full, so its
        // height is not knowable up front. Both placements happen in one task,
        // so nothing is painted in between and the move is invisible.
        if (this._stackPanel && !below && this._panelCoveredBy() > PANEL_COVER_LIMIT) {
            anchor = 'top';
            place(anchor);
        }
        // ...and whatever it settled on, keep the card inside the map, because
        // the wrap clips what hangs over the edge. Last, so it corrects the
        // final placement rather than one the rule above may replace. One
        // pass: the corrected anchor moves the card AWAY from the edge it
        // overshot, so a second could only chase it back.
        const fixed = fitAnchor(
            this._hoverPopup.getElement().getBoundingClientRect(),
            this._mapViewBox(), anchor);
        if (fixed) place(fixed);
        // An anchor can only put the card to one SIDE of its point, which is no
        // help once the card is nearly as wide as the map: both sides overflow,
        // and flipping just trades which edge is lost. Measured on production
        // with the panel at 900px — a 341px card in a 349px map, over the left
        // edge, re-anchored, then 178px over the right. Only an offset can sit
        // a card on the MAP's centre rather than its point's.
        this._nudgeCardIntoView();
        // Only if moving it did not help does the panel step aside.
        this._yieldStackPanel(this._panelCoveredBy() > PANEL_COVER_LIMIT);
        // What this placement was measured against. A nudge is owed to a
        // particular box, so the reflow can tell a card the map has outgrown
        // from one that is simply pinned where it belongs.
        this._hoverPlaced = { view: this._mapViewBox(), nudged: this._hoverNudged };
    },

    /** Slide the card the last few pixels so no edge hangs over the map.
     *
     *  Runs after the anchor pass, so it only ever has the remainder to fix,
     *  and one pass is exact: the offset is applied in screen space, so moving
     *  by precisely the overflow lands the card flush against the edge. The
     *  price is the standoff from the marker, which is the right thing to
     *  spend when the alternative is a card sliced by the wrap. */
    _nudgeCardIntoView() {
        // Cleared first, before any early return: a stale flag from the last
        // card would make the reflow re-place this one for no reason.
        this._hoverNudged = false;
        const popup = this._hoverPopup;
        if (!popup) return;
        const view = this._mapViewBox();
        if (!Number.isFinite(view.right)) return;   // unmeasured map constrains nothing
        let dx = 0;
        let dy = 0;
        // TWO passes, and the second is not belt-and-braces. Swapping the plain
        // standoff for an explicit offset moves the card BY that standoff, so a
        // correction measured under the old regime lands one standoff short —
        // measured live as exactly 12px of overhang left behind. The second
        // pass measures in the regime the card will keep, and accumulates.
        for (let pass = 0; pass < 2; pass += 1) {
            const card = popup.getElement().getBoundingClientRect();
            if (!card.width) return;
            let ex = 0;
            let ey = 0;
            if (card.right > view.right) ex = view.right - card.right;
            else if (card.left < view.left) ex = view.left - card.left;
            if (card.bottom > view.bottom) ey = view.bottom - card.bottom;
            else if (card.top < view.top) ey = view.top - card.top;
            if (!ex && !ey) return;                 // already inside; nothing owed
            dx += ex;
            dy += ey;
            popup.setOffset([Math.round(dx), Math.round(dy)]);
            this._hoverNudged = true;
        }
    },

    /** Place the open card again when the map has moved under it.
     *
     *  A placement is only true for the geometry it was measured in, and that
     *  geometry moves in two ways nothing else was watching. The splitter
     *  shrinks the map horizontally against the sidebar and vertically against
     *  the bottom bar, and a pan or a zoom slides the card's own point across
     *  it. Both were measured on production with a card left open: a card
     *  placed in an 814px map ended up 147px behind the sidebar when the panel
     *  went to 900px, and a 160px pan carried another one exactly 160px out.
     *
     *  Gated on MEASUREMENT rather than on the event, because `move` fires on
     *  every frame of a pan and a re-show costs 8ms when it only has to re-lay
     *  the card and 24 when it has to re-anchor and re-nudge it too.
     *  `needsReflow` holds the rule and the reasons; here it is only asked. */
    _reflowHoverCard() {
        const shown = this._hoverShown;
        if (!shown || !this._hoverPopup?.isOpen()) return;
        const view = this._mapViewBox();
        // `needsReflow` checks this too; asking here as well skips the card's
        // own rect read, which forces layout, on every frame of a boot.
        if (!Number.isFinite(view.right)) return;
        const card = this._hoverPopup.getElement().getBoundingClientRect();
        if (!needsReflow(card, view, this._hoverPlaced)) return;
        this._showHoverCard(shown.lngLat, shown.f, { below: shown.below });
    },

    /** The box a card has to stay inside: the map itself, whose wrapper clips
     *  overflow. Inset slightly so a card does not sit flush against the edge
     *  it was just moved off. */
    _mapViewBox() {
        const el = document.getElementById('foodMap');
        const r = el && el.getBoundingClientRect();
        // A map with no box yet — booting, a hidden tab, a display:none
        // ancestor — constrains nothing. Insetting a zero rect inverts it, and
        // the nudge then "corrects" against an impossible box: seen live as a
        // 220px card shoved to a [232, 118] offset because the map measured 0.
        if (!r || r.width <= 0 || r.height <= 0) {
            return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
        }
        const inset = 4;
        return {
            left: r.left + inset, top: r.top + inset,
            right: r.right - inset, bottom: r.bottom - inset,
        };
    },

    /** How much of the stack panel the open card sits on, 0–1 of its area.
     *
     *  A fraction rather than a yes/no because clipping a corner is fine and
     *  burying the thing is not: a card that leaves most of the panel readable
     *  can stay where it is, which keeps cards from hopping around every time
     *  they brush an edge. */
    _panelCoveredBy() {
        const panel = this._stackPanel?.el;
        const card = this._hoverPopup?.getElement();
        if (!panel || !card) return 0;
        const a = panel.getBoundingClientRect();
        const b = card.getBoundingClientRect();
        if (!a.width || !a.height || !b.width) return 0;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w <= 0 || h <= 0) return 0;
        return (w * h) / (a.width * a.height);
    },

    /** The active hover wins (Cannon, 2026-08-19): the panel is a standing
     *  reference, the card is what the pointer is asking about right now. It
     *  comes back the moment the pointer leaves. */
    _yieldStackPanel(yielding) {
        this._stackPanel?.el?.classList.toggle('is-yielded', !!yielding);
    },

    // The hover card previews the detail panel's grade hero: name + address,
    // then the same circle / NEW badge / no-grade dash, the static sparkline,
    // and the date cards. No flat "Grade A · 94" text — the circle is the
    // verdict, and a focused raw score prints nowhere (the #42/#43 invariant
    // carries over by construction: the shared sparkline plots ratios, not
    // raw scores). Controls are deliberately omitted here; those belong to
    // the clicked detail panel.
    _hoverCardHTML(f) {
        // Both tiers qualify an approximate pin. Until 2026-08-19 only Lite
        // did, so the tier carrying MORE information gave LESS warning: a
        // Full-tier hover over a DCA concession showed a Crystal City rooftop
        // with no hint, and you had to click into the panel to learn it was a
        // centroid.
        const approx = approximateLabel(f);
        const approxLine = approx
            ? `<br><span class="food-tip-sub">≈ ${esc(approx)}</span>` : '';
        if (this._mode === 'lite') {
            return `<strong>${esc(f.name)}</strong><br>`
                + `${esc(f.address || '')}${f.city ? ', ' + esc(f.city) : ''}`
                + approxLine;
        }
        const grade = gradePresentation(f);
        const latestView = facilityPresentation(f).latest;
        const isNew = isNewlyPermitted(f);
        const active = isActivePermit(f);
        // The sparkline plots the row's `visits` — one entry per inspection,
        // the marks the detail would yield — through the exact `_sparkSvg`
        // pipeline the panel uses: one renderer, two sources, no fetch. A
        // facility with no history has no plot; a newly permitted one has
        // nothing to trend.
        const series = visitsOf(f);
        const sparkHtml = (series.events.length && !isNew) ? this._sparklineFromSeries(series) : '';
        const hero = grade
            ? this._gradeHero(grade, sparkHtml, false)
            : isNew
                ? this._newHero(latestView)
                : this._noGradeHero(latestView, sparkHtml);
        const latestDate = latestDateOf(f);
        const heroBlock = (grade || isNew || series.events.length || latestDate)
            ? `${hero}${this._gradeDates(grade?.baseDate || null, latestDate)}`
            : '<div class="text-muted small mb-2">No inspections on record yet.</div>';
        return `
            <div class="food-hover-card">
                <div class="food-hover-card-head">
                    <strong>${esc(f.name)}</strong>
                    ${active ? '' : `<span class="food-tip-closed">${esc(f.status || 'closed')}</span>`}
                    <div class="food-tip-sub">${esc(f.address || '')}${f.address2 ? ' ' + esc(f.address2) : ''}${f.city ? ', ' + esc(f.city) : ''}${approxLine}</div>
                </div>
                ${heroBlock}
            </div>`;
    },
};
