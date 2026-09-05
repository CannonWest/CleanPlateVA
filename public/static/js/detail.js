/**
 * Detail panel — selecting a facility, the lite hand-off panel, the full
 * panel with its grade hero / dates / red flags / history, and the
 * grade-receipt modal that opens from the hero. `detailMethods` is
 * installed on FoodDashboard.prototype by foodDashboard.js (`this` is the
 * dashboard).
 */

import { GRADE_COLORS, NEW_COLOR } from './constants.js';
import {
    LOCATION_CLASS, esc, fmtDate, fmtDateNum, gradeColor, gradePresentation, inspectionPresentation,
    isFairfax, locationClass, permitUrl, sourceDepartment,
} from './presentation.js';
import { gradeReceiptPresentation } from './receipt.js';

export const detailMethods = {
    // ── detail panel ────────────────────────────────────────────────────

    async _select(f, { write = true } = {}) {
        this._closeReceipt();   // a stale receipt must not outlive its facility
        this._selectedPermit = f.permit_id;
        // The selection is shareable state (`?permit=`), pushed so Back closes
        // the panel; the router passes write:false when it is applying a URL.
        if (write) this._syncUrl({ push: true });
        const panel = document.getElementById('foodDetail');
        const inner = document.getElementById('foodDetailInner');
        if (!panel || !inner) return;
        panel.classList.remove('d-none');
        setTimeout(() => this._map?.resize(), 60);

        // Lite: everything shown is already in the roster record — render
        // locally and hand off to the official VDH page for the substance.
        if (this._mode === 'lite') {
            inner.innerHTML = this._renderLiteDetail(f);
            inner.querySelector('.food-detail-close')
                ?.addEventListener('click', () => this._closeDetail());
            if (this._viewMode === 'list') this._rebuildList();
            return;
        }

        inner.innerHTML = `<div class="p-3 text-muted">Loading ${esc(f.name)}…</div>`;

        const detail = await this.api.getFoodFacilityDetail(f.permit_id);
        if (this._selectedPermit !== f.permit_id) return;  // user clicked away
        if (!detail || !detail.available) {
            inner.innerHTML = `<div class="p-3 text-muted">Failed to load: `
                + `${esc(detail?.reason || detail?.error || 'unknown')}</div>`;
            return;
        }
        inner.innerHTML = this._renderDetail(detail.facility, detail.inspections);
        inner.querySelector('.food-detail-close')
            ?.addEventListener('click', () => this._closeDetail());
        // The per-inspection report link lives inside the <summary>; keep a click
        // on it from also toggling the row open/closed.
        inner.querySelectorAll('.food-insp-report').forEach((a) =>
            a.addEventListener('click', (e) => e.stopPropagation()));
        this._bindSparkline(inner, detail.inspections);
        this._bindGradeReceipt(inner, detail.facility, detail.inspections);
    },

    _closeDetail({ write = true } = {}) {
        this._closeReceipt();
        this._selectedPermit = null;
        if (write) this._syncUrl();
        document.getElementById('foodDetail')?.classList.add('d-none');
        setTimeout(() => this._map?.resize(), 60);
    },

    /** Lite detail panel: identity + the hand-off to the official record. */
    _renderLiteDetail(f) {
        const geoNote = this._geoNote(f);
        return `
            <div class="food-detail-head">
                <div class="food-detail-title">
                    <h5>${esc(f.name)}</h5>
                    <button type="button" class="btn-close food-detail-close" aria-label="Close"></button>
                </div>
                <div class="text-muted small">
                    ${esc(f.address)}${f.address2 ? ' ' + esc(f.address2) : ''}${f.city ? ', ' + esc(f.city) : ''}, VA ${esc(f.zip || '')}
                    ${geoNote}
                </div>
            </div>
            <div class="food-lite-cta">
                <a class="btn btn-sm btn-primary" target="_blank" rel="noopener"
                   href="${permitUrl(f)}">
                    View inspections ${esc(sourceDepartment(f).handoff)} <i class="bi bi-box-arrow-up-right"></i>
                </a>
                <div class="text-muted small mt-2">
                    Inspection reports live on the official ${isFairfax(f) ? 'Fairfax County Health Department site' : 'VDH portal'} — this map is a finder.
                </div>
            </div>`;
    },

    _geoNote(f) {
        // Rooftop-quality points get no flag. The class comes from the V4
        // finder's `loc` (both tiers) or a detail's `location.source`.
        const cls = locationClass(f);
        if (cls === LOCATION_CLASS.zip_centroid) {
            return '<span class="food-approx" title="Address didn\'t geocode — marker sits at the ZIP centroid, not the building">≈ ZIP-centroid</span>';
        }
        if (cls === LOCATION_CLASS.venue) {
            // Claim pitched at the WEAKEST case this class covers: an airport
            // terminal really is the building, a spread-out campus is not, and
            // "the venue it belongs to" is true of both.
            return '<span class="food-approx food-approx-venue" title="Address is a room or space number, not one a geocoder can place — pin sits at the venue this facility belongs to (airport, mall, campus), not at its own unit">≈ venue-level</span>';
        }
        if (cls === LOCATION_CLASS.street) {
            return '<span class="food-approx food-approx-street" title="Street-level only (a road centreline, from Census or VGIN) — pin may sit ~50 m off, on the road rather than the building">≈ street-level</span>';
        }
        return '';
    },

    _renderDetail(fac, inspections) {
        const latest = inspections[0] || null;
        const latestView = inspectionPresentation(latest);
        const geoNote = this._geoNote(fac);
        const sets = this._disposSets(latest?.checklist);
        // Whose record the links open (FFX-M4): VDH, or the Fairfax Health
        // District — named in the fact line and the Source title; the
        // inspection rows read the flag for their report-link wording.
        this._fairfax = isFairfax(fac);
        const dept = sourceDepartment(fac);

        // The facility GRADE circle leads the panel for every facility; the
        // latest inspection is just the first (open) card in the history below.
        const grade = gradePresentation(fac);
        // Newly permitted → a blue NEW badge and no sparkline (no broad-score
        // history to trend). Uses the exporter's flag (see _isNew), not merely
        // "no grade".
        const isNew = this._isNew(fac);
        const sparkHtml = (latest && !isNew) ? this._sparkline(inspections) : '';
        const latestDate = latest?.date || null;
        const gradeHero = grade
            ? this._gradeHero(grade, sparkHtml)
            : isNew
                ? this._newHero(latestView)
                : this._noGradeHero(latestView, sparkHtml);
        // NARRATIVE arc provenance is carried by the history row's verdict chip
        // and the sparkline's ◆ legend — the hero stays the verdict itself, no
        // channel commentary under the circle.
        const scoreHero = (latest || isNew)
            ? `${gradeHero}${this._gradeDates(grade?.baseDate || null, latestDate)}`
            : '<div class="text-muted small mb-2">No inspection detail available yet.</div>';

        const statusNote = (fac.status_onpage && fac.status
            && fac.status_onpage.toLowerCase() !== (fac.status || '').toLowerCase()) ? `
            <div class="food-status-note" title="The inspection page reports a different status than the permit roster">
                <i class="bi bi-exclamation-triangle"></i> inspection page says: ${esc(fac.status_onpage)}</div>` : '';

        const flags = (latest?.red_flags || []);
        // Newly-permitted places have no real inspection to flag — skip the
        // red-flag section entirely (it would only ever say "none").
        const flagsHtml = (latest && !isNew) ? (flags.length ? `
            <div class="food-flags">
                <div class="food-section-title">Biggest red flags — latest report</div>
                ${flags.map((fl) => `
                    <div class="food-flag${fl.category === 'risk_factor' ? ' food-flag-rf' : ''}">
                        ${this._disposBadge(fl.item, sets)}
                        <span class="food-flag-item" title="VA form item ${esc(fl.item ?? '?')} · ${esc(fl.code || 'no code')}">#${esc(fl.item ?? '?')}</span>
                        ${(fl.repeat || sets.repeat.has(fl.item)) ? '<span class="food-flag-repeat">repeat</span>' : ''}
                        <span class="food-flag-text">${esc(fl.text)}</span>
                    </div>`).join('')}
            </div>` : '<div class="food-flags"><div class="food-section-title">Biggest red flags — latest report</div><div class="text-muted small">None prioritized by the display heuristic; this is not a safety finding.</div></div>') : '';

        const history = inspections.length ? `
            <div class="food-section-title">Inspection history (${inspections.length})</div>
            ${inspections.map((insp, i) => this._renderInspection(insp, i === 0, i)).join('')}`
            : '';

        return `
            <div class="food-detail-head">
                <div class="food-detail-title">
                    <h5>${esc(fac.name)}</h5>
                    <div class="food-detail-title-right">
                        <a class="food-insp-report food-detail-source" href="${permitUrl(fac)}"
                            target="_blank" rel="noopener" title="${this._fairfax ? "Find this facility's official record at the Fairfax County Health Department" : "Open this facility's VDH record"}"><i class="bi bi-file-earmark-text"></i><span>Source</span><i class="bi bi-box-arrow-up-right"></i></a>
                        <button type="button" class="btn-close food-detail-close" aria-label="Close"></button>
                    </div>
                </div>
            </div>
            <div class="food-detail-sub">
                <div class="text-muted small">
                    ${esc(fac.address)}${fac.address2 ? ' ' + esc(fac.address2) : ''}, ${esc(fac.city)}, ${esc(fac.state)} ${esc(fac.zip)}
                    ${geoNote}
                </div>
                <div class="text-muted small">
                    ${esc(fac.permit_type)} · ${esc(fac.status)} · <span title="Inspection records published by the ${esc(dept.name)}">${esc(dept.name)}</span>
                </div>
                ${statusNote}
                ${(fac.merged_from || []).length ? `
                <div class="text-muted small" title="Same address, near-identical name — a re-issued permit. History below spans all permits.">
                    Includes earlier permit${fac.merged_from.length === 1 ? '' : 's'}:
                    ${fac.merged_from.map((m) =>
                        // A merged_from entry carries no tenant of its own —
                        // a re-permit group shares one address, so the
                        // surviving facility's district fixes the path for all
                        // (mirrors the exporter's claimed_tenant grouping).
                        `<a href="${permitUrl(m, fac.tenant)}" target="_blank" rel="noopener">${esc(m.name)}</a>`).join(' · ')}
                </div>` : ''}
            </div>
            ${scoreHero}
            ${flagsHtml}
            <div class="food-history">${history}</div>`;
    },

    // The circular grade badge: one circle, small letter over big score. The
    // CIRCLE is the facility verdict; rounded SQUARES below are the inspections.
    _gradeCircle(letter, score, extraClass = '') {
        return `<span class="food-grade-circle${extraClass ? ' ' + extraClass : ''}" style="--grade-color:${gradeColor(letter)}" role="img" aria-label="Grade ${esc(letter)}, score ${esc(score)} of 100">
            <span class="food-grade-letter">${esc(letter)}</span>
            <span class="food-grade-score">${esc(score)}</span></span>`;
    },

    // Caption over the circle, a pill under it — one centered stack that reads
    // as a single labeled badge. The pill answers "where does this verdict
    // come from": `computed` when there's a grade, `no grade yet` when there's
    // nothing to compute from. Same slot, same shape, either way.
    _gradeBadgeCol(circleHtml, caption = 'Grade', tagHtml = '') {
        return `
            <div class="food-grade-badge-col">
                <span class="food-grade-caption">${caption}</span>
                ${circleHtml}
                ${tagHtml}
            </div>`;
    },

    // The grade hero: the facility verdict, on top of every full detail panel.
    // Just the badge and the broad-score trend line — the dated provenance
    // rides below in its own objects (_gradeDates). In the detail panel the
    // circle and `computed` pill are buttons that open the grade-receipt modal;
    // the hover preview requests the same visuals without those controls.
    _gradeHero(g, sparkHtml = '', interactive = true) {
        const tag = '<span class="food-score-computed" title="CleanPlateVA formula; the health department publishes no numeric score">computed</span>';
        const circle = this._gradeCircle(g.letter, g.score);
        const circleControl = interactive
            ? `<button type="button" class="food-receipt-trigger" data-grade-receipt`
                + ` aria-haspopup="dialog" title="See how this grade was computed"`
                + ` aria-label="Grade ${esc(g.letter)}, score ${esc(g.score)} of 100 — open the score breakdown">`
                + `${circle}</button>`
            : circle;
        const tagControl = interactive
            ? `<button type="button" class="food-receipt-trigger food-receipt-trigger-pill" data-grade-receipt`
                + ` aria-haspopup="dialog" aria-label="Open the score breakdown">${tag}</button>`
            : tag;
        return `
            <div class="food-score-hero food-grade-hero">
                ${this._gradeBadgeCol(circleControl, 'Grade', tagControl)}
                ${sparkHtml}
            </div>`;
    },

    // Newly permitted: an active permit with no broad assessment yet. A blue
    // NEW badge + a simple headline says "cleared to open, grade still to
    // come" — a positive state, not the neutral "no data" dash. No sparkline
    // and no trend: there's no broad-score history yet.
    _newHero(latestView) {
        const detail = latestView && latestView.scope === 'focused'
            ? 'Grade pending a broad inspection; latest visit was a focused re-check.'
            : 'Cleared to open; grade pending its first broad inspection.';
        const circle = `<span class="food-grade-circle food-grade-circle-new" style="--grade-color:${NEW_COLOR}" role="img" aria-label="Newly permitted, grade pending a broad inspection">
                    <span class="food-grade-new-label">NEW</span></span>`;
        return `
            <div class="food-score-hero food-grade-hero food-grade-hero-new">
                ${this._gradeBadgeCol(circle, 'Status')}
                <div class="food-score-meta">
                    <div class="food-score-grade food-score-grade-new">Permitted</div>
                    <div class="text-muted small">${esc(detail)}</div>
                </div>
            </div>`;
    },

    // No scored broad assessment → no grade. A neutral circle keeps the panel
    // shape, and the note says what a grade would need. "No grade yet" rides in
    // the pill slot where a graded facility says "computed" — the verdict sits
    // with the badge, so the prose beside it is only the explanation.
    _noGradeHero(latestView, sparkHtml = '') {
        const detail = latestView.scope === 'focused'
            ? `The latest report is a focused ${latestView.count}-item check. A grade needs a broad inspection (20+ items).`
            : 'No broad inspection (20+ items) captured yet, so no grade — the inspections below stand on their own.';
        const circle = `<span class="food-grade-circle food-grade-circle-none" role="img" aria-label="No grade yet">
                    <span class="food-grade-letter">–</span>
                    <span class="food-grade-score">n/a</span></span>`;
        const tag = '<span class="food-score-computed food-grade-tag-none">no grade yet</span>';
        // Badge and trend take the row exactly as they do on a graded facility;
        // the explanation follows on the line beneath. Three objects across a
        // 400px panel would leave both the copy and the plot too narrow to read.
        return `
            <div class="food-score-hero food-grade-hero food-grade-hero-none">
                ${this._gradeBadgeCol(circle, 'Grade', tag)}
                ${sparkHtml}
                <div class="food-score-meta">
                    <div class="text-muted small">${esc(detail)}</div>
                </div>
            </div>`;
    },

    // Dated provenance as its own graphical objects below the hero: the broad
    // that anchors the grade, and the most recent visit of any kind.
    _gradeDates(baseDate, latestDate) {
        if (!baseDate && !latestDate) return '';
        // Both boxes always render when there's anything to show; a missing
        // date is a dash — a newly-permitted place keeps "Last broad inspection"
        // as "—" rather than dropping the box.
        const obj = (label, iso) => `
            <div class="food-grade-date">
                <span class="food-grade-date-label">${label}</span>
                <span class="food-grade-date-value">${iso ? fmtDateNum(iso) : '—'}</span>
            </div>`;
        return `<div class="food-grade-dates">`
            + obj('Last broad inspection', baseDate)
            + obj('Last visit', latestDate)
            + `</div>`;
    },

    // ── grade-receipt modal ─────────────────────────────────────────────
    // The breakdown behind the hero's grade circle: broad anchor → follow-up
    // effects → ledger. Data model comes from gradeReceiptPresentation; when
    // its engine-mirror reconcile failed (`verified` false), per-item point
    // values are absent and the receipt leans on the published aggregates —
    // membership and copy render either way.

    _bindGradeReceipt(root, fac, inspections) {
        root.querySelectorAll('[data-grade-receipt]').forEach((btn) => {
            btn.addEventListener('click', () => this._openReceipt(fac, inspections, btn));
        });
    },

    _openReceipt(fac, inspections, trigger = null) {
        const receipt = gradeReceiptPresentation(fac, inspections);
        if (!receipt) return;
        this._closeReceipt();
        const host = document.createElement('div');
        host.className = 'food-receipt-host';
        host.innerHTML = this._renderGradeReceipt(receipt, fac.name);
        document.body.appendChild(host);
        document.body.classList.add('food-receipt-open');
        this._receiptHost = host;
        this._receiptTrigger = trigger;
        host.querySelectorAll('[data-receipt-close]').forEach((el) =>
            el.addEventListener('click', () => this._closeReceipt()));
        // The About link routes through the real header tab so its
        // scroll-to-top + focus-the-title behavior runs; the modal closes
        // first so focus restoration can't fight the About handoff.
        host.querySelector('[data-receipt-about]')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._closeReceipt();
            document.querySelector('#foodViewToggle button[data-view="about"]')?.click();
        });
        const backdrop = host.querySelector('.food-receipt-backdrop');
        backdrop?.addEventListener('click', (e) => {
            if (e.target === backdrop) this._closeReceipt();
        });
        this._receiptKeydown = (e) => {
            if (e.key === 'Escape') this._closeReceipt();
        };
        document.addEventListener('keydown', this._receiptKeydown);
        // Light focus containment: anything tabbing out of the dialog is
        // pulled back to it (small dialog, no full trap machinery needed).
        this._receiptFocusin = (e) => {
            if (this._receiptHost && !this._receiptHost.contains(e.target)) {
                this._receiptHost.querySelector('.food-receipt')?.focus();
            }
        };
        document.addEventListener('focusin', this._receiptFocusin);
        host.querySelector('.food-receipt')?.focus();
    },

    _closeReceipt() {
        if (!this._receiptHost) return;
        if (this._receiptKeydown) document.removeEventListener('keydown', this._receiptKeydown);
        if (this._receiptFocusin) document.removeEventListener('focusin', this._receiptFocusin);
        this._receiptKeydown = null;
        this._receiptFocusin = null;
        this._receiptHost.remove();
        this._receiptHost = null;
        document.body.classList.remove('food-receipt-open');
        const trigger = this._receiptTrigger;
        this._receiptTrigger = null;
        if (trigger && trigger.isConnected) trigger.focus();
    },

    _renderGradeReceipt(r, name) {
        const fmt1 = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
        const chip = (cls, text, title = '') =>
            `<span class="${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
        // `points` off in the journey groups: there the charge is the whole
        // item at full weight ×1.5, so a per-violation "−6" beside a "−4.5
        // more" states two numbers that do not reconcile. The category still
        // earns its place — a risk-factor re-offense is not a grease smear.
        const catChip = (category, points = true) => (category === 'risk_factor'
            ? chip('food-receipt-cat food-receipt-cat-rf', points ? 'risk factor −6' : 'risk factor',
                'Foodborne-illness risk factor (form items 1–29) — 6 points per violation')
            : chip('food-receipt-cat food-receipt-cat-grp', points ? 'retail practice −2' : 'retail practice',
                'Good Retail Practices (items 30+) — 2 points per violation'));

        // One item row, shared by the base list and the journey groups. Every
        // observation filed under the item number prints: several unrelated
        // findings routinely share one item, so a single line would state one
        // reason and silently swallow the others behind the ×N chip.
        const shell = (it, headExtras, body, deltaHtml, catPoints = true) => `
            <div class="food-receipt-item${it.category === 'risk_factor' ? ' food-receipt-item-rf' : ''}">
                <div class="food-receipt-item-head">
                    <span class="food-receipt-item-no">#${esc(it.item)}</span>
                    ${catChip(it.category, catPoints)}
                    ${headExtras}
                    ${deltaHtml}
                </div>
                ${body}
            </div>`;

        // Base docket: ONE ROW PER VIOLATION, because that is how the charge
        // is computed. Each finding shows the badges the inspector filed against it and
        // the points it alone cost, so an item holding a fixed-on-site finding
        // beside an uncorrected one reads as the two different things it is.
        const findingRow = (it) => shell(it, `
                    ${it.repeat ? chip('food-flag-repeat', 'repeat ×1.5',
                        'The inspector badged THIS finding a repeat — 1.5× its weight') : ''}
                    ${it.cos ? chip('food-dispos food-dispos-cos', 'fixed on site ×0.75',
                        'This finding was corrected while the inspector watched — '
                            + 'docks 75% of its weight, provisionally') : ''}`,
            it.text ? `<div class="food-receipt-item-text">${esc(it.text)}</div>` : '',
            it.points != null
                ? `<span class="food-receipt-pts">−${fmt1(it.points)}</span>` : '');

        // Journey groups stay per ITEM: a re-check publishes one verdict per
        // form line and cannot say WHICH finding under it was fixed, so the
        // outcome genuinely belongs to the number, not to any one violation.
        // Whether the base's corrected-on-site discount SURVIVES into the
        // grade. It does where facility_grade charges the discounted dock
        // (IN restores a fraction of it; an un-re-checked item carries it
        // forward), and does NOT where the branch charges `full` — both
        // OUT and OUT_COS revoke it. Badging a revoked credit in a group
        // headed "any on-site credit revoked" advertises a discount the
        // arithmetic already took back.
        const creditHeld = (bucket) => bucket === 'restored' || bucket === 'unchecked';

        const itemRow = (it, deltaHtml, bucket) => {
            const texts = it.texts || [];
            const body = texts.length > 1
                ? `<ul class="food-receipt-item-texts">${texts.map(
                    (t) => `<li class="food-receipt-item-text">${esc(t)}</li>`).join('')}</ul>`
                : texts.length
                    ? `<div class="food-receipt-item-text">${esc(texts[0])}</div>` : '';
            return shell(it, `
                    ${it.count > 1 ? chip('food-receipt-cat', `×${it.count} findings`, it.countSums
                        ? 'Several violations were cited under this item; the re-check '
                            + 'resolves the whole item at once'
                        : 'Several violations were cited under this item on the re-check — '
                            + 'the item docks once, at its category weight') : ''}
                    ${it.repeat ? chip('food-flag-repeat',
                        it.repeatCount && it.repeatCount < it.count
                            ? `${it.repeatCount} of ${it.count} repeat ×1.5`
                            : 'repeat ×1.5',
                        'Repeats weigh 1.5× — charged to the findings the inspector badged') : ''}
                    ${it.cosBase && creditHeld(bucket) ? chip('food-dispos food-dispos-cos',
                        it.cosCount && it.cosCount < it.count
                            ? `${it.cosCount} of ${it.count} fixed on site`
                            : 'fixed on site ×0.75',
                        'Corrected while the inspector watched — docks 75% of that '
                            + 'finding\'s weight, provisionally') : ''}
                    ${it.narrative ? chip('food-receipt-narr', 'written verdict',
                        'Outcome read from the inspector\'s written comments (adjudicated)') : ''}`,
                body, deltaHtml, false);
        };

        // ── section 1: the broad anchor ────────────────────────────────
        const b = r.base;
        let baseBody;
        if (!b.found) {
            baseBody = `<div class="food-receipt-note">The anchoring broad inspection isn't in the
                shipped history, so the per-item breakdown is unavailable — the published totals below still stand.</div>`;
        } else if (!b.items.length && !b.itemless) {
            baseBody = '<div class="food-receipt-note">No violations recorded: a clean 100-point inspection.</div>';
        } else {
            baseBody = b.items.map(findingRow).join('')
                + (b.itemless ? `<div class="food-receipt-note">${b.itemless.count} observation${b.itemless.count === 1 ? '' : 's'}
                    without a form item number — dock${b.itemless.count === 1 ? 's' : ''} at face value${b.itemless.points != null
                        ? ` (−${fmt1(b.itemless.points)})` : ''} and can't be re-checked by item.</div>` : '');
        }
        // Counts as a chip row: total in a filled box (red when any, green at
        // zero — data hues, inline like every grade color), category counts
        // in the same red/amber bubbles the item rows use, weights omitted
        // (the items below carry the −6/−2).
        const n = b.violationCount || 0;
        const baseCounts = b.found ? `
            <div class="food-receipt-counts">
                <span class="food-receipt-count" style="background:${n ? GRADE_COLORS.F : GRADE_COLORS.A}">${n} violation${n === 1 ? '' : 's'}</span>
                ${b.rfCount ? chip('food-receipt-cat food-receipt-cat-rf', `${b.rfCount} risk factor`,
                    'Foodborne-illness risk factors (form items 1–29)') : ''}
                ${b.grpCount ? chip('food-receipt-cat food-receipt-cat-grp', `${b.grpCount} retail practice`,
                    'Good Retail Practices (items 30+)') : ''}
            </div>` : '';
        const baseSection = `
            <div class="food-receipt-sec">
                <div class="food-receipt-sec-title">
                    <span>Broad inspection — ${fmtDate(b.date)}</span>
                    <span class="food-insp-score" style="background:${this._scoreColor(b.score)}"
                        title="This inspection's score — the grade's base">${esc(b.score)}</span>
                </div>
                ${baseCounts}
                ${baseBody}
            </div>`;

        // ── section 2: follow-ups and their effects ────────────────────
        let followupSection = '';
        if (r.adjusted) {
            const visits = r.followups.map((v) => `
                <div class="food-receipt-visit">
                    <span class="food-receipt-visit-date">${fmtDateNum(v.date)}</span>
                    <span class="food-adj-chip food-outcome-${esc(v.tone)}" title="${esc(v.detail)}">${esc(v.label)}</span>
                    <span class="food-receipt-visit-kind">${v.kind === 'narrative' ? 'written verdict' : 'focused re-check'}</span>
                </div>`).join('');
            const groups = [
                ['restored', 'Verified fixed', 'restores 65% of the item\'s deduction',
                    (row) => (row.delta != null
                        ? `<span class="food-receipt-pts food-receipt-delta-pos">+${fmt1(row.delta)}</span>` : '')],
                ['failed', 'Found OUT again', 'full weight ×1.5 — any on-site credit revoked',
                    (row) => (row.delta != null
                        ? `<span class="food-receipt-pts food-receipt-delta-neg">−${fmt1(row.delta)} more</span>` : '')],
                ['cos', 'OUT again, re-fixed on the spot', 'full weight — the base on-site credit is revoked',
                    // With no base COS credit to revoke, the charge is unchanged: ±0.
                    (row) => (row.delta != null
                        ? (row.delta > 0
                            ? `<span class="food-receipt-pts food-receipt-delta-neg">−${fmt1(row.delta)} more</span>`
                            : '<span class="food-receipt-pts food-receipt-delta-mut">±0</span>') : '')],
                ['new', 'New findings on re-checks', 'dock at category weight',
                    (row) => (row.delta != null
                        ? `<span class="food-receipt-pts food-receipt-delta-neg">−${fmt1(row.delta)}</span>` : '')],
                ['unchecked', 'Not re-checked', 'the deduction stands as-is',
                    (row) => (row.dockPts != null
                        ? `<span class="food-receipt-pts food-receipt-delta-mut">−${fmt1(row.dockPts)} carried</span>` : '')],
            ];
            const journeyHtml = groups
                .filter(([bucket]) => r.journeys[bucket].length)
                .map(([bucket, title, sub, delta]) => `
                    <div class="food-receipt-group">${title} <small>${sub}</small></div>
                    ${r.journeys[bucket].map((row) => itemRow(row, delta(row), bucket)).join('')}`)
                .join('');
            followupSection = `
                <div class="food-receipt-sec">
                    <div class="food-receipt-sec-title"><span>Since then —
                        ${r.followups.length} re-check${r.followups.length === 1 ? '' : 's'}</span></div>
                    ${visits}
                    <div class="food-receipt-sub">For each item the broad visit docked, the newest re-check governs:</div>
                    ${journeyHtml}
                </div>`;
        }
        // Unadjusted: no follow-up section at all — the base IS the grade,
        // and the header circle already says so.

        // ── section 3: the ledger ──────────────────────────────────────
        const ledger = r.adjusted ? `
            <div class="food-receipt-ledger">
                <div class="food-receipt-ledger-row"><span>Base broad score</span><b>${r.ledger.baseScore}</b></div>
                <div class="food-receipt-ledger-row"><span>Restored by verified fixes</span>
                    <b class="food-receipt-delta-pos">+${fmt1(r.ledger.restored)}</b></div>
                <div class="food-receipt-ledger-row"><span>Added by failed re-checks &amp; new findings</span>
                    <b class="food-receipt-delta-neg">−${fmt1(r.ledger.added)}</b></div>
                <div class="food-receipt-ledger-row food-receipt-ledger-total"><span>Facility grade</span>
                    <span class="food-receipt-ledger-grade" style="--grade-color:${gradeColor(r.ledger.letter)}">${r.ledger.score} ${esc(r.ledger.letter)}</span></div>
                ${r.ledger.exact ? '' : `<div class="food-receipt-foot">Components are shown to one decimal;
                    the score itself rounds once, at the end (halves up), so the lines may not visibly sum.</div>`}
            </div>` : '';

        return `
            <div class="food-receipt-backdrop">
                <div class="food-receipt" role="dialog" aria-modal="true" aria-labelledby="foodReceiptTitle" tabindex="-1">
                    <div class="food-receipt-head">
                        <div>
                            <div class="food-receipt-kicker">How this grade was computed</div>
                            <h5 id="foodReceiptTitle">${esc(name)}</h5>
                        </div>
                        ${this._gradeCircle(r.grade.letter, r.grade.score, 'food-grade-circle-sm')}
                        <button type="button" class="btn-close" data-receipt-close aria-label="Close"></button>
                    </div>
                    <div class="food-receipt-body">
                        ${baseSection}
                        ${followupSection}
                        ${ledger}
                        <div class="food-receipt-foot">${this._fairfax
                            ? 'Fairfax County grades are anchored on the most recent full inspection. '
                                + 'The county records every visit as a complete inspection, so no '
                                + 'follow-up or re-check adjustment applies. ' : ''}CleanPlateVA computes this score and grade;
                            neither the Virginia Department of Health nor the Fairfax County Health Department
                            publishes a numeric score of its own.
                            Read the full method on the <a href="#about" data-receipt-about>About</a> tab.</div>
                    </div>
                </div>
            </div>`;
    },

    // item#s by disposition, from a parsed checklist — used to badge violations
    // "fixed on site" / "open" / "repeat" (the authoritative structured source).
    _disposSets(checklist) {
        const cos = new Set(), open = new Set(), repeat = new Set();
        for (const r of (checklist || [])) {
            if (r.item == null) continue;
            if (r.cos) cos.add(r.item);
            if (r.violation && !r.cos) open.add(r.item);
            if (r.repeat) repeat.add(r.item);
        }
        return { cos, open, repeat };
    },

    _disposBadge(item, sets) {
        if (item != null && sets.cos.has(item))
            return '<span class="food-dispos food-dispos-cos" title="Corrected on site during the inspection">fixed</span>';
        if (item != null && sets.open.has(item))
            return '<span class="food-dispos food-dispos-open" title="Cited and left open at the inspection">open</span>';
        return '';
    },

    // Per-score grade color (the A≥90 … F<60 bands / GRADE_COLORS).
    _scoreColor(s) {
        return s >= 90 ? GRADE_COLORS.A : s >= 80 ? GRADE_COLORS.B
            : s >= 70 ? GRADE_COLORS.C : s >= 60 ? GRADE_COLORS.D : GRADE_COLORS.F;
    },
};
