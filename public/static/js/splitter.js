/**
 * The drag handle between the map (or List) and the facility panel.
 *
 * `.food-body` is a flex row: the map grows, the panel holds a width. The bar
 * just sets that width, so nothing else in the layout has to know it exists —
 * and because the map is the flexible half, it takes whatever is left.
 *
 * Two things a splitter over a map has to get right:
 *
 *   · MapLibre sizes its canvas to the container it was given, and a flex
 *     reflow is not a window resize. Without an explicit `resize()` the canvas
 *     keeps its old width and the basemap stretches. It is called on every
 *     drag frame (rAF-throttled) rather than only at the end, so the map
 *     tracks the bar instead of snapping to it.
 *
 *   · It is a real `separator` control, focusable, with arrow keys — a divider
 *     that only answers to a mouse is a divider half the visitors cannot move.
 *
 * Below 900px the body stacks the panel UNDER the map (style.css), where a
 * vertical bar has nothing to divide, so CSS hides it there and the stacked
 * `max-height` governs instead.
 *
 * `splitterMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard); the pure helpers are exported
 * for the tests.
 */

import { DETAIL_WIDTH_DEFAULT, DETAIL_WIDTH_KEY, DETAIL_WIDTH_MAX_FRACTION, DETAIL_WIDTH_MIN }
    from './constants.js';

/** Keep the panel between a readable floor and a share of the row that still
 *  leaves the map worth looking at. The bar and the panel are clamped by the
 *  SAME function the CSS cap mirrors, so the handle can never travel somewhere
 *  the panel refuses to follow — a bar that moves without its panel reads as
 *  broken far faster than one that stops. */
/** The width the panel's `max-width: 70%` actually resolves against: the
 *  row's CONTENT box. `clientWidth` includes padding, and using it made the JS
 *  ceiling 22px looser than the CSS cap on a 1280px window — the bar would
 *  travel to 896 while the panel stopped at 874, which is exactly the
 *  handle-without-its-panel this clamp exists to prevent. Measured in the
 *  browser; the constants matched all along, the boxes did not. */
export function rowContentWidth(el) {
    if (!el) return 0;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const pad = style
        ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
        : 0;
    return Math.max(0, el.clientWidth - pad);
}

export function detailWidthCeiling(bodyWidth) {
    return bodyWidth > 0
        ? Math.max(DETAIL_WIDTH_MIN, Math.round(bodyWidth * DETAIL_WIDTH_MAX_FRACTION))
        : Number.POSITIVE_INFINITY;   // before first layout there is nothing to divide
}

export function clampDetailWidth(px, bodyWidth) {
    const want = Number(px);
    if (!Number.isFinite(want)) return DETAIL_WIDTH_DEFAULT;
    return Math.round(Math.min(Math.max(want, DETAIL_WIDTH_MIN), detailWidthCeiling(bodyWidth)));
}

/** A stored width is a preference, not state to trust: anything unparseable
 *  or out of range falls back to the shipped default rather than to a panel
 *  the visitor cannot see. */
export function readStoredDetailWidth(storage) {
    try {
        const raw = Number(storage?.getItem(DETAIL_WIDTH_KEY));
        return Number.isFinite(raw) && raw > 0 ? raw : DETAIL_WIDTH_DEFAULT;
    } catch (_) {
        return DETAIL_WIDTH_DEFAULT;   // private mode / sandboxed frame
    }
}

export const splitterMethods = {
    _installSplitter() {
        const bar = document.getElementById('foodSplitter');
        const body = document.getElementById('foodBody');
        if (!bar || !body) return;

        this._applyDetailWidth(readStoredDetailWidth(window.localStorage));

        let frame = 0;
        // Distance from the bar's centre to the panel's leading edge, measured
        // at grab time rather than derived. The bar carries negative margins so
        // it sits IN the row's gap instead of widening it, which makes that
        // distance a function of gap, margin and border — computing it by hand
        // left the bar drifting 7px behind the cursor (measured in the
        // browser). Taking it at grab time makes the grip land wherever the
        // visitor actually took hold of it.
        let grip = 0;
        const drag = (e) => {
            // Measure from the row's RIGHT edge: the panel is the right-hand
            // half, so its width is whatever the pointer leaves after it.
            // Measure to the row's inner right edge, the same box the CSS cap
            // is a percentage of.
            const rect = body.getBoundingClientRect();
            const padRight = parseFloat(getComputedStyle(body).paddingRight) || 0;
            this._applyDetailWidth(rect.right - padRight - e.clientX - grip);
            if (!frame) {
                frame = requestAnimationFrame(() => { frame = 0; this._map?.resize(); });
            }
        };
        const end = (e) => {
            bar.removeEventListener('pointermove', drag);
            try { bar.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
            document.body.classList.remove('is-splitting');
            this._map?.resize();
            this._storeDetailWidth();
        };

        bar.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();               // no text selection, no drag-image
            // Capture keeps the drag alive when the pointer outruns a 10px
            // bar. It can refuse (a synthetic event, a pointer already gone),
            // and a refused capture is not a reason to refuse the drag.
            try { bar.setPointerCapture(e.pointerId); } catch (_) { /* drag on */ }
            const panel = document.getElementById('foodDetail');
            const barBox = bar.getBoundingClientRect();
            grip = panel
                ? panel.getBoundingClientRect().left - (barBox.left + barBox.width / 2)
                : 0;
            document.body.classList.add('is-splitting');
            bar.addEventListener('pointermove', drag);
        });
        bar.addEventListener('pointerup', end);
        bar.addEventListener('pointercancel', end);

        // Arrows nudge, shift-arrows stride, Home/End go to the stops. Left
        // grows the panel because the panel lies to the RIGHT of the bar.
        bar.addEventListener('keydown', (e) => {
            const step = e.shiftKey ? 48 : 12;
            const width = this._detailWidth || DETAIL_WIDTH_DEFAULT;
            let next = null;
            if (e.key === 'ArrowLeft') next = width + step;
            else if (e.key === 'ArrowRight') next = width - step;
            else if (e.key === 'Home') next = rowContentWidth(body);   // clamps to max
            else if (e.key === 'End') next = 0;                      // clamps to min
            else if (e.key === 'Enter' || e.key === ' ') next = DETAIL_WIDTH_DEFAULT;
            if (next === null) return;
            e.preventDefault();
            this._applyDetailWidth(next);
            this._map?.resize();
            this._storeDetailWidth();
        });

        // The usual escape hatch for a divider dragged somewhere regrettable.
        bar.addEventListener('dblclick', () => {
            this._applyDetailWidth(DETAIL_WIDTH_DEFAULT);
            this._map?.resize();
            this._storeDetailWidth();
        });

        // A window that narrows can put a stored width past the ceiling, which
        // would leave the map a sliver. Re-clamp against the new row.
        window.addEventListener('resize', () => {
            this._applyDetailWidth(this._detailWidth || DETAIL_WIDTH_DEFAULT);
        });
    },

    _applyDetailWidth(px) {
        const body = document.getElementById('foodBody');
        const panel = document.getElementById('foodDetail');
        const bar = document.getElementById('foodSplitter');
        const width = clampDetailWidth(px, rowContentWidth(body));
        this._detailWidth = width;
        if (panel) panel.style.width = `${width}px`;
        if (bar) {
            bar.setAttribute('aria-valuenow', String(width));
            bar.setAttribute('aria-valuemin', String(DETAIL_WIDTH_MIN));
            // The ceiling, asked for directly. Routing it through
            // clampDetailWidth was wrong: that function rejects a non-finite
            // request and answers with the DEFAULT, so the bar reported a
            // maximum of 400 no matter how wide the window was.
            const ceiling = detailWidthCeiling(rowContentWidth(body));
            if (Number.isFinite(ceiling)) bar.setAttribute('aria-valuemax', String(ceiling));
        }
    },

    _storeDetailWidth() {
        try {
            window.localStorage.setItem(DETAIL_WIDTH_KEY, String(this._detailWidth));
        } catch (_) { /* private mode */ }
    },
};
