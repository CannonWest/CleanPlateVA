/**
 * The drag handle between the map (or List) and the facility panel.
 *
 * `.food-body` is a flex container: the map grows, the panel holds a size. The
 * bar only sets that size, so nothing else in the layout has to know it exists
 * — and because the map is the flexible half, it takes whatever is left.
 *
 * It works on BOTH axes. Wide windows lay the two out side by side and the bar
 * trades WIDTH; under 900px the body stacks the panel beneath the map and the
 * same bar lies down and trades HEIGHT. Which one is in force is asked of the
 * layout (`flex-direction`), never of a duplicated breakpoint — the CSS owns
 * that number, and a second copy in here would be one more thing to drift.
 *
 * Three things a splitter over a map has to get right:
 *
 *   · MapLibre sizes its canvas to the container it was given, and a flex
 *     reflow is not a window resize. Without an explicit `resize()` the canvas
 *     keeps its old size and the basemap stretches. It is called on every drag
 *     frame (rAF-throttled) rather than only at the end, so the map tracks the
 *     bar instead of snapping to it.
 *
 *   · The JS clamp and the CSS cap must stop in the same place, or the handle
 *     travels somewhere the panel will not follow. Both are a fraction of the
 *     row's CONTENT box — `clientWidth` includes padding, and using it once
 *     put them 22px apart.
 *
 *   · It is a real `separator` control, focusable, with arrow keys — a divider
 *     that only answers to a mouse is a divider half the visitors cannot move.
 *
 * `splitterMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard); the pure helpers are exported
 * for the tests.
 */

import {
    DETAIL_HEIGHT_DEFAULT_FRACTION, DETAIL_HEIGHT_KEY, DETAIL_HEIGHT_MAX_FRACTION,
    DETAIL_HEIGHT_MIN, DETAIL_WIDTH_DEFAULT, DETAIL_WIDTH_KEY, DETAIL_WIDTH_MAX_FRACTION,
    DETAIL_WIDTH_MIN,
} from './constants.js';

/** The two axes, each carrying everything that differs between them, so the
 *  drag, the clamp, the keys and the storage all read from one description
 *  rather than each branching on the layout separately. */
export const SPLIT_AXES = {
    horizontal: {                       // side by side; the bar trades WIDTH
        prop: 'width',
        other: 'height',
        key: DETAIL_WIDTH_KEY,
        min: DETAIL_WIDTH_MIN,
        maxFraction: DETAIL_WIDTH_MAX_FRACTION,
        defaultSize: () => DETAIL_WIDTH_DEFAULT,
        ariaOrientation: 'vertical',    // a separator BETWEEN columns is vertical
        grow: 'ArrowLeft',
        shrink: 'ArrowRight',
    },
    stacked: {                          // panel beneath the map; trades HEIGHT
        prop: 'height',
        other: 'width',
        key: DETAIL_HEIGHT_KEY,
        min: DETAIL_HEIGHT_MIN,
        maxFraction: DETAIL_HEIGHT_MAX_FRACTION,
        // A share rather than a pixel count: the stacked layout always gave
        // the panel 60%, and a fraction travels between screen sizes.
        defaultSize: (available) => Math.round(available * DETAIL_HEIGHT_DEFAULT_FRACTION),
        ariaOrientation: 'horizontal',
        grow: 'ArrowUp',
        shrink: 'ArrowDown',
    },
};

/** The far edge a percentage cap resolves against: the row's CONTENT box.
 *  `clientWidth`/`clientHeight` include padding, and using them made the JS
 *  ceiling 22px looser than the CSS cap on a 1280px window — the bar would
 *  travel to 896 while the panel stopped at 874, which is exactly the
 *  handle-without-its-panel the clamp exists to prevent. */
export function rowContentSize(el, prop = 'width') {
    if (!el) return 0;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const [a, b] = prop === 'height' ? ['paddingTop', 'paddingBottom'] : ['paddingLeft', 'paddingRight'];
    const pad = style ? (parseFloat(style[a]) || 0) + (parseFloat(style[b]) || 0) : 0;
    const box = prop === 'height' ? el.clientHeight : el.clientWidth;
    return Math.max(0, box - pad);
}

/** Kept for the width-only callers and the tests that name it. */
export function rowContentWidth(el) {
    return rowContentSize(el, 'width');
}

export function detailSizeCeiling(available, axis = SPLIT_AXES.horizontal) {
    return available > 0
        ? Math.max(axis.min, Math.round(available * axis.maxFraction))
        : Number.POSITIVE_INFINITY;   // before first layout there is nothing to divide
}

export function detailWidthCeiling(bodyWidth) {
    return detailSizeCeiling(bodyWidth, SPLIT_AXES.horizontal);
}

/** Keep the panel between a readable floor and a share of the row that still
 *  leaves the map worth looking at. */
export function clampDetailSize(px, available, axis = SPLIT_AXES.horizontal) {
    const want = Number(px);
    if (!Number.isFinite(want)) return axis.defaultSize(available);
    return Math.round(Math.min(Math.max(want, axis.min), detailSizeCeiling(available, axis)));
}

export function clampDetailWidth(px, bodyWidth) {
    return clampDetailSize(px, bodyWidth, SPLIT_AXES.horizontal);
}

/** A stored size is a preference, not state to trust: anything unparseable or
 *  out of range falls back to the axis default rather than to a panel the
 *  visitor cannot see. */
export function readStoredDetailSize(storage, axis = SPLIT_AXES.horizontal, available = 0) {
    try {
        const raw = Number(storage?.getItem(axis.key));
        return Number.isFinite(raw) && raw > 0 ? raw : axis.defaultSize(available);
    } catch (_) {
        return axis.defaultSize(available);   // private mode / sandboxed frame
    }
}

export function readStoredDetailWidth(storage) {
    return readStoredDetailSize(storage, SPLIT_AXES.horizontal);
}

export const splitterMethods = {
    /** Which way the body is laid out, asked of the layout rather than of a
     *  copy of the breakpoint. The CSS owns 900px; this just reads the result. */
    _splitAxis() {
        const body = document.getElementById('foodBody');
        const column = body && typeof getComputedStyle === 'function'
            && getComputedStyle(body).flexDirection === 'column';
        return column ? SPLIT_AXES.stacked : SPLIT_AXES.horizontal;
    },

    _installSplitter() {
        const bar = document.getElementById('foodSplitter');
        const body = document.getElementById('foodBody');
        if (!bar || !body) return;

        this._restoreDetailSize();

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
            const axis = this._splitAxis();
            const rect = body.getBoundingClientRect();
            const style = getComputedStyle(body);
            // To the row's inner FAR edge — the same box the CSS cap is a
            // percentage of, so the clamp and the cap stop in the same place.
            const size = axis.prop === 'height'
                ? rect.bottom - (parseFloat(style.paddingBottom) || 0) - e.clientY - grip
                : rect.right - (parseFloat(style.paddingRight) || 0) - e.clientX - grip;
            this._applyDetailSize(size);
            if (!frame) {
                frame = requestAnimationFrame(() => { frame = 0; this._map?.resize(); });
            }
        };
        const end = (e) => {
            bar.removeEventListener('pointermove', drag);
            try { bar.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
            document.body.classList.remove('is-splitting');
            this._map?.resize();
            this._storeDetailSize();
        };

        bar.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();               // no text selection, no drag-image
            // Capture keeps the drag alive when the pointer outruns a 10px
            // bar. It can refuse (a synthetic event, a pointer already gone),
            // and a refused capture is not a reason to refuse the drag.
            try { bar.setPointerCapture(e.pointerId); } catch (_) { /* drag on */ }
            const axis = this._splitAxis();
            const panel = document.getElementById('foodDetail');
            const barBox = bar.getBoundingClientRect();
            const panelBox = panel ? panel.getBoundingClientRect() : null;
            grip = panelBox
                ? (axis.prop === 'height'
                    ? panelBox.top - (barBox.top + barBox.height / 2)
                    : panelBox.left - (barBox.left + barBox.width / 2))
                : 0;
            document.body.classList.add('is-splitting');
            bar.addEventListener('pointermove', drag);
        });
        bar.addEventListener('pointerup', end);
        bar.addEventListener('pointercancel', end);

        // Arrows nudge, shift-arrows stride, Home/End go to the stops. The
        // growing key is whichever one points AWAY from the panel, so the
        // divider always moves the way the key does.
        bar.addEventListener('keydown', (e) => {
            const axis = this._splitAxis();
            const step = e.shiftKey ? 48 : 12;
            const size = this._detailSize || axis.defaultSize(this._availableFor(axis));
            let next = null;
            if (e.key === axis.grow) next = size + step;
            else if (e.key === axis.shrink) next = size - step;
            else if (e.key === 'Home') next = this._availableFor(axis);   // clamps to max
            else if (e.key === 'End') next = 0;                           // clamps to min
            else if (e.key === 'Enter' || e.key === ' ') next = axis.defaultSize(this._availableFor(axis));
            if (next === null) return;
            e.preventDefault();
            this._applyDetailSize(next);
            this._map?.resize();
            this._storeDetailSize();
        });

        // The usual escape hatch for a divider dragged somewhere regrettable.
        bar.addEventListener('dblclick', () => {
            const axis = this._splitAxis();
            this._applyDetailSize(axis.defaultSize(this._availableFor(axis)));
            this._map?.resize();
            this._storeDetailSize();
        });

        // A row that narrows can put a stored size past the ceiling, which would
        // leave the map a sliver — and crossing the breakpoint swaps the axis
        // entirely, where the size on file measures the OTHER dimension and
        // must not be reused.
        //
        // Both, because they catch different things and re-applying is
        // idempotent. A ResizeObserver sees the ROW change for any reason and
        // runs after layout, so the axis it reads is the one in force; the
        // window event covers a viewport change if the observer is missing.
        //
        // Neither could be exercised in the preview pane — it never paints, so
        // ResizeObserver callbacks are never delivered, and the pane's resize
        // tool changes the viewport without dispatching `resize` at all (both
        // counters measured at zero). So this pair is reasoned, not observed:
        // what IS verified is that `_restoreDetailSize` does the right thing
        // when called, on either axis.
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => this._restoreDetailSize()).observe(body);
        }
        window.addEventListener('resize', () => this._restoreDetailSize());
    },

    /** The room the panel is competing for, on the axis in force. */
    _availableFor(axis) {
        return rowContentSize(document.getElementById('foodBody'), axis.prop);
    },

    /** Re-read the size for whichever axis is now in force. Called on install
     *  and on every window resize, so crossing the breakpoint picks up that
     *  axis's own remembered size rather than carrying a width into a height. */
    _restoreDetailSize() {
        const axis = this._splitAxis();
        this._applyDetailSize(readStoredDetailSize(
            window.localStorage, axis, this._availableFor(axis)));
    },

    _applyDetailSize(px) {
        const axis = this._splitAxis();
        const panel = document.getElementById('foodDetail');
        const bar = document.getElementById('foodSplitter');
        const available = this._availableFor(axis);
        const size = clampDetailSize(px, available, axis);
        this._detailSize = size;
        if (panel) {
            panel.style[axis.prop] = `${size}px`;
            // The other axis is the layout's business, not ours: a width left
            // behind from the wide view would fight the stacked one.
            panel.style[axis.other] = '';
        }
        if (bar) {
            bar.setAttribute('aria-orientation', axis.ariaOrientation);
            bar.setAttribute('aria-valuenow', String(size));
            bar.setAttribute('aria-valuemin', String(axis.min));
            const ceiling = detailSizeCeiling(available, axis);
            if (Number.isFinite(ceiling)) bar.setAttribute('aria-valuemax', String(ceiling));
        }
    },

    /** Kept as the width-named entry point the earlier code and tests use. */
    _applyDetailWidth(px) {
        this._applyDetailSize(px);
    },

    _storeDetailSize() {
        try {
            window.localStorage.setItem(this._splitAxis().key, String(this._detailSize));
        } catch (_) { /* private mode */ }
    },
};
