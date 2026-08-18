/**
 * The acknowledgement — CPF-M1 (design ref docs/architecture-v4.md §3, §12
 * D-ACK-1..3).
 *
 * The judgment-bearing tier is public after the visitor acknowledges the
 * Terms of Use and Data Acknowledgment. This module owns three things:
 *
 *   · the stored decision — ONE versioned localStorage key. Bump ACK_VERSION
 *     whenever the terms text changes and every device is asked again;
 *   · the dialog — body-appended like the grade receipt (detail.js), its body
 *     a CLONE of About §06's #aboutTermsBody so the words have exactly one
 *     source and the page and the dialog cannot drift. On first load it is
 *     BLOCKING (D-ACK-1): the empty basemap renders behind it and NO data is
 *     fetched until the visitor answers — Agree loads the full tier, Decline
 *     loads the basic map. Nobody pays for both;
 *   · the two ways back. The header control (#ackTermsBtn, where the sign-in
 *     button was) is the invitation INTO the grades and shows only while they
 *     are not being shown; once the terms are accepted it hides, and the
 *     single switch back out is About §06's status panel — which is what the
 *     terms mean by "changed later from the About page"
 *     (#aboutTermsStatus). The footer's in-app link reaches that section.
 *
 * Only the two buttons persist a decision. Escape on the first-load dialog is
 * a decline for this page load and writes nothing, so the next load asks
 * again; Escape (or the backdrop) on a re-opened dialog just closes it.
 *
 * `?tier=lite` (D-ACK-3) bypasses all of it: no dialog, no control, the basic
 * map — the dev/preview override needs no terms.
 *
 * `ackMethods` is installed on FoodDashboard.prototype by foodDashboard.js
 * (`this` is the dashboard); the pure helpers are exported for app.js and the
 * tests.
 */

export const ACK_VERSION = 1;
export const ACK_KEY = `cleanplateva.ack.v${ACK_VERSION}`;
export const ACK_AGREED = 'agreed';
export const ACK_DECLINED = 'declined';

/** The stored decision, or null when this device has not answered the
 *  CURRENT version of the terms (a value under an older key is ignored). */
export function readAck(storage) {
    try {
        const value = storage?.getItem(ACK_KEY);
        return value === ACK_AGREED || value === ACK_DECLINED ? value : null;
    } catch (_) {
        return null;   // private mode / sandboxed frame
    }
}

export function writeAck(storage, value) {
    try { storage?.setItem(ACK_KEY, value); } catch (_) { /* private mode */ }
}

/** The in-memory decision the page runs on. It starts from storage and is
 *  shared by the data client's gate (`isAcknowledged`) and the dashboard, so
 *  an unpersisted decision (Escape on first load) still governs this load. */
export function createAckState(storage) {
    let value = readAck(storage);
    let persisted = value !== null;   // a stored answer is, by definition, persisted
    return {
        get value() { return value; },
        get agreed() { return value === ACK_AGREED; },
        get decided() { return value !== null; },
        /** False for an answer that governs only this page load (Escape). */
        get persisted() { return persisted; },
        set(next, { persist = true } = {}) {
            value = next === ACK_AGREED || next === ACK_DECLINED ? next : null;
            persisted = !!(persist && value);
            if (persisted) writeAck(storage, value);
        },
    };
}

export const ackMethods = {
    /** Wire the header control and the footer's terms link. Called from
     *  init(). The dialog itself is opened by load() (first visit) or the
     *  control (any later time). */
    _installAck() {
        const btn = document.getElementById('ackTermsBtn');
        btn?.addEventListener('click', () => this._openTerms({ trigger: btn }));
        // About §06's panel: the one switch an accepted visitor still has.
        // Accepted → decline outright (a downgrade needs no acknowledgement);
        // otherwise → the terms, which is where accepting belongs.
        const action = document.getElementById('aboutTermsAction');
        action?.addEventListener('click', () => {
            if (this._ack?.agreed) this._decideAck(ACK_DECLINED);
            else this._openTerms({ trigger: action });
        });
        document.querySelectorAll('[data-terms-link]').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this._showTermsSection();
            });
        });
        this._syncAckControl();
    },

    /** First load only: does the boot have to wait for an answer? */
    _needsAckDecision() {
        return !this._forceLite && !!this._ack && !this._ack.decided;
    },

    /** The header control is the invitation into the grades, so it exists
     *  only while they are NOT being shown: declined or not yet asked. Once
     *  the terms are accepted it hides — there is nothing left to invite, and
     *  the way back out is About §06's panel (`_syncTermsStatus`). Also
     *  hidden under ?tier=lite by CSS, which asks no terms at all. */
    _syncAckControl() {
        const btn = document.getElementById('ackTermsBtn');
        if (btn) {
            const agreed = !!this._ack?.agreed;
            btn.classList.toggle('d-none', agreed);
            const hint = 'Acknowledge the Terms of Use to view inspection grades';
            btn.title = hint;
            btn.setAttribute('aria-label', hint);
        }
        this._syncTermsStatus();
    },

    /** About §06's panel: which tier this device is on, and the single switch
     *  to the other one. `?tier=lite` overrides any answer, so there the panel
     *  states the override and offers nothing to press. */
    _syncTermsStatus() {
        const panel = document.getElementById('aboutTermsStatus');
        const text = document.getElementById('aboutTermsStatusText');
        const action = document.getElementById('aboutTermsAction');
        if (!panel || !text || !action) return;
        const agreed = !!this._ack?.agreed;
        if (this._forceLite) {
            text.textContent = 'The basic map is in effect for this visit because the address '
                + 'includes ?tier=lite. Inspection grades are not shown, and no acknowledgement is asked.';
        } else if (agreed) {
            text.textContent = 'These terms are acknowledged on this device, and CleanPlateVA '
                + 'inspection grades are shown. The acknowledgement can be withdrawn at any time.';
            // Same colour language as the dialog — red is the way to the
            // basic map, blue the way to the grades — but outlined on both
            // sides here: this is a standing preference, not a fork.
            action.textContent = 'Switch to the basic map';
            action.className = 'btn btn-outline-danger';
        } else {
            text.textContent = 'These terms are not acknowledged on this device. The basic map is '
                + 'shown, without CleanPlateVA inspection grades.';
            action.textContent = 'Review the terms and view grades';
            action.className = 'btn btn-outline-primary';
        }
        action.classList.toggle('d-none', !!this._forceLite);
        panel.classList.remove('d-none');
    },

    /** Open the terms dialog. `blocking` is the first-load shape (D-ACK-1):
     *  no close affordance, backdrop clicks ignored, Escape = decline for this
     *  load. Otherwise it is an ordinary dialog over the current view. */
    _openTerms({ blocking = false, trigger = null } = {}) {
        this._closeTerms();
        const source = document.getElementById('aboutTermsBody');
        if (!source) return;
        const host = document.createElement('div');
        host.className = 'food-ack-host';
        host.innerHTML = renderTermsDialog({ blocking });
        // The words come from About §06 — one source. Strip the id so the
        // clone cannot shadow the section it came from.
        const body = host.querySelector('.food-ack-body');
        const clone = source.cloneNode(true);
        clone.removeAttribute('id');
        body?.appendChild(clone);
        document.body.appendChild(host);
        document.body.classList.add('food-ack-open');
        this._ackHost = host;
        this._ackTrigger = trigger;
        this._ackBlocking = blocking;

        host.querySelectorAll('button[data-ack]').forEach((el) => {
            el.addEventListener('click', () => this._decideAck(el.dataset.ack));
        });
        host.querySelector('[data-ack-close]')?.addEventListener('click', () => this._closeTerms());
        const backdrop = host.querySelector('.food-ack-backdrop');
        backdrop?.addEventListener('click', (e) => {
            if (e.target === backdrop && !this._ackBlocking) this._closeTerms();
        });
        this._ackKeydown = (e) => {
            if (e.key !== 'Escape') return;
            if (this._ackBlocking) this._decideAck(ACK_DECLINED, { persist: false });
            else this._closeTerms();
        };
        document.addEventListener('keydown', this._ackKeydown);
        // Focus containment, as the grade receipt does it: anything tabbing
        // out of the dialog is pulled back in.
        this._ackFocusin = (e) => {
            if (this._ackHost && !this._ackHost.contains(e.target)) {
                this._ackHost.querySelector('.food-ack')?.focus();
            }
        };
        document.addEventListener('focusin', this._ackFocusin);
        host.querySelector('.food-ack')?.focus();
    },

    _closeTerms() {
        if (!this._ackHost) return;
        if (this._ackKeydown) document.removeEventListener('keydown', this._ackKeydown);
        if (this._ackFocusin) document.removeEventListener('focusin', this._ackFocusin);
        this._ackKeydown = null;
        this._ackFocusin = null;
        this._ackHost.remove();
        this._ackHost = null;
        this._ackBlocking = false;
        document.body.classList.remove('food-ack-open');
        const trigger = this._ackTrigger;
        this._ackTrigger = null;
        if (trigger && trigger.isConnected) trigger.focus();
    },

    /** Record the answer and act on it: the deferred first load runs now, or
     *  a changed answer re-runs the load on the other tier (the data client's
     *  gate reads the shared state). An unchanged answer just closes. */
    _decideAck(value, { persist = true } = {}) {
        if (!this._ack) return;
        const changed = this._ack.value !== value;
        this._ack.set(value, { persist });
        this._closeTerms();
        this._syncAckControl();
        if (this._bootDeferred) {
            this._bootDeferred = false;
            this.refresh();
        } else if (changed) {
            // The tier is about to flip; a panel or hover from the old tier
            // must not outlive it.
            this._hideHoverCard?.();
            if (this._selectedPermit) this._closeDetail?.({ write: true });
            this.refresh();
        }
    },

    /** The footer's "Terms & attribution": land on About with §06 in view
     *  and its heading focused. Also honors a cold-loaded /about#aboutTerms. */
    _showTermsSection() {
        this._setView('about');
        requestAnimationFrame(() => {
            document.getElementById('aboutTerms')?.scrollIntoView({ block: 'start' });
            document.getElementById('aboutTermsTitle')?.focus({ preventScroll: true });
        });
    },
};

function renderTermsDialog({ blocking }) {
    return `
        <div class="food-ack-backdrop">
            <div class="food-ack" role="dialog" aria-modal="true" aria-labelledby="foodAckTitle" aria-describedby="foodAckBody" tabindex="-1">
                <div class="food-ack-head">
                    <div>
                        <h5 id="foodAckTitle">Terms of Use and Data Acknowledgment</h5>
                    </div>
                    ${blocking ? '' : `<button type="button" class="btn-close" data-ack-close aria-label="Close"></button>`}
                </div>
                <!-- The terms sit in their own inset box, narrower than the
                     dialog: the border stays put while the text scrolls inside
                     it, so the reader can see how much is left. -->
                <div class="food-ack-body" id="foodAckBody" tabindex="0"></div>
                <!-- Decline left, Agree right (Cannon 2026-08-17): the
                     affirmative action is where a reader ends up. -->
                <div class="food-ack-actions">
                    <button type="button" class="btn btn-outline-danger" data-ack="${ACK_DECLINED}">Decline and Use Basic Map</button>
                    <button type="button" class="btn btn-primary" data-ack="${ACK_AGREED}">Agree and View Grades</button>
                </div>
            </div>
        </div>`;
}
