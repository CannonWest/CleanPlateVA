/**
 * Inspection rows — one history row (badge, scope, counts, violations,
 * checklist, comments, temperatures) inside the detail panel.
 * `inspectionMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard).
 */

import { GRADE_COLORS } from './constants.js';
import {
    esc, fmtDate, focusedOutcomeBadge, inspectionCountsPresentation, inspectionPresentation,
    narrativeVerdictPresentation,
} from './presentation.js';

export const inspectionMethods = {
    _renderInspection(insp, openByDefault, historyIndex = null) {
        const view = inspectionPresentation(insp);
        const violations = insp.violations || [];
        const sets = this._disposSets(insp.checklist);
        // An adjudicated comment can stand alone on a scope-unknown report or
        // supplement a focused checklist whose rows contain only what remains
        // OUT. The focused badge shows the combined OUT/addressed ratio; the
        // verdict chip below names the comment-side corrections.
        const adj = narrativeVerdictPresentation(insp);
        const badge = view.scope === 'broad'
            ? `<span class="food-insp-score food-insp-signal" style="background:${view.score != null ? this._scoreColor(view.score) : GRADE_COLORS.none}" title="Inspection score (0–100, no letter — letters are a facility grade)">${view.score ?? '—'}</span>`
            : view.scope === 'focused'
                ? focusedOutcomeBadge(view)
                : adj
                    ? `<span class="food-insp-score food-insp-score-adj food-insp-signal food-outcome-${adj.tone}" role="img" title="${esc(adj.detail)}" aria-label="${esc(adj.detail)}"><span aria-hidden="true">${adj.glyph}</span>${adj.count ? `<small aria-hidden="true">${adj.count}</small>` : ''}</span>`
                    : '<span class="food-insp-score food-insp-score-unknown food-insp-signal">?</span>';
        // An adjudicated row shows its VERDICT chip instead of a scope label:
        // "Scope unknown" describes the missing checklist, which is exactly the
        // thing the adjudication resolved — showing both reads as a
        // contradiction. Un-adjudicated unknowns keep the honest label.
        const scopeBadge = adj && view.scope === 'unknown' ? ''
            : `<span class="food-scope-badge food-scope-badge-${view.scope}">${view.scope === 'broad' ? 'Broad' : view.scope === 'focused' ? 'Focused' : 'Scope unknown'}</span>`;
        const adjChip = adj
            ? `<span class="food-adj-chip food-outcome-${adj.tone}" title="${esc(adj.detail)}">${esc(adj.label)}</span>` : '';
        // Violation counts as the grade-receipt chip row, ported onto the summary
        // (replaces the old muted "N viol." text). The count split + the
        // scope-unknown-zero suppression live in inspectionCountsPresentation so
        // they're a tested contract; here we just paint it — a filled box (red for
        // any, green at zero) then the rf / retail-practice bubbles the receipt uses.
        const counts = inspectionCountsPresentation(insp);
        const inspCounts = !counts.show ? '' : `<span class="food-insp-counts">
                <span class="food-receipt-count" style="background:${counts.n ? GRADE_COLORS.F : GRADE_COLORS.A}">${counts.n} violation${counts.n === 1 ? '' : 's'}</span>
                ${counts.rf ? `<span class="food-receipt-cat food-receipt-cat-rf" title="Foodborne-illness risk factors (form items 1–29)">${counts.rf} risk factor</span>` : ''}
                ${counts.grp ? `<span class="food-receipt-cat food-receipt-cat-grp" title="Good Retail Practices (items 30+)">${counts.grp} retail practice</span>` : ''}
            </span>`;
        const noViolations = view.scope === 'broad'
            ? `No violations recorded across ${view.count} distinct applicable code items.`
            : view.scope === 'focused'
                ? `No violations recorded in this focused ${view.count}-item check.`
                // Adjudicated rows suppress this line entirely — their
                // raw-score line states the missing checklist and the chip
                // states the verdict.
                : 'No violations recorded; checklist breadth was not published.';
        // The VDH report link rides in the collapsed summary row (right of the
        // metadata, next to the caret) as an icon-only control. stopPropagation
        // is bound in _select so a click opens VDH without also toggling the row.
        // OQ-I (FFX-M4): the county lists the visit; the archive holds no
        // report. OQ-D: the county's recorded outcome — shown with its
        // explanation, never a badge, never an input to the score.
        const unavailable = insp.report_available === false;
        const outcome = typeof insp.source_outcome === 'string' && insp.source_outcome
            ? insp.source_outcome : null;
        // The link's wording follows the department: a county report is a PDF
        // download, not a page (`this._fairfax` is set by _renderDetail).
        const linkLabel = unavailable
            ? 'Download the county’s copy of this report (PDF)'
            : this._fairfax
                ? 'Download the official Fairfax County Health Department report for this inspection (PDF)'
                : 'Open the official VDH report for this inspection';
        const sourceLink = insp.report_url
            ? `<a class="food-insp-report" href="${esc(insp.report_url)}" target="_blank" rel="noopener"
                aria-label="${esc(linkLabel)}"
                title="${esc(linkLabel)}"><i class="bi bi-file-earmark-text" aria-hidden="true"></i><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>`
            : '';
        return `
        <details class="food-insp"${Number.isInteger(historyIndex) ? ` data-inspection-index="${historyIndex}"` : ''}${openByDefault ? ' open' : ''}>
            <summary>
                ${badge}
                <span class="food-insp-r1">
                    <span class="food-insp-when">${fmtDate(insp.date)}</span>
                    <span class="food-insp-kind text-muted">${esc(insp.purpose)}</span>
                    ${scopeBadge}
                    <span class="food-insp-r1-right">
                        ${sourceLink}
                        <span class="food-insp-caret" aria-hidden="true"></span>
                    </span>
                </span>
                ${adj ? `<span class="food-insp-counts">${adjChip}</span>` : inspCounts}
            </summary>
            <div class="food-insp-body">
                ${unavailable
                    ? '<div class="food-raw-score">No report is held for this visit; the county’s copy may be available.</div>' : ''}
                ${outcome
                    ? `<div class="food-insp-comments"><strong>County outcome: ${esc(outcome)}.</strong> Outcome recorded by the Fairfax County Health Department for this visit. It is not derived from, and does not determine, CleanPlateVA’s computed score. Across the archived county reports, about 3 percent of visits recorded as Passed score in the D or F range under CleanPlateVA’s formula; the basis for the county’s outcome is not stated in the report.</div>` : ''}
                ${adj
                    ? `<div class="food-raw-score">No checklist published; verdict read from the inspector's written comments.</div>` : ''}
                ${unavailable ? '' : violations.length ? violations.map((v) => `
                    <div class="food-viol${(v.item != null && v.item <= 29) ? ' food-viol-rf' : ''}">
                        <div class="food-viol-head">
                            ${this._disposBadge(v.item, sets)}
                            <span class="food-viol-item" title="${esc(v.code || 'no regulation code')}">#${esc(v.item ?? '?')}</span>
                            ${sets.repeat.has(v.item) ? '<span class="food-flag-repeat">repeat</span>' : ''}
                            <span class="food-viol-text">${esc(v.text)}</span>
                        </div>
                        ${v.corrective ? `<div class="food-viol-corrective">↳ ${esc(v.corrective)}</div>` : ''}
                    </div>`).join('')
                : adj ? ''
                    : `<div class="text-muted small px-1">${esc(noViolations)}</div>`}
                ${unavailable ? '' : this._renderChecklist(insp.checklist, view)}
                ${insp.comments ? `<div class="food-insp-comments"><strong>Inspector comments:</strong> ${esc(insp.comments)}</div>` : ''}
                ${this._renderTemps(insp.temps_v2, insp.temps)}
            </div>
        </details>`;
    },

    // The inspection's published checklist rows (passing items too), grouped by category,
    // each category collapsible with a pass-rate bar. Sentinel rows excluded.
    _renderChecklist(checklist, presentation = {}) {
        const rows = (checklist || []).filter((r) => !r.is_sentinel);
        if (!rows.length) return '';
        const cats = [], byCat = new Map();
        for (const r of rows) {
            const c = r.category || 'Other';
            if (!byCat.has(c)) { byCat.set(c, []); cats.push(c); }
            byCat.get(c).push(r);
        }
        const out = rows.filter((r) => r.violation).length;
        const cats_html = cats.map((c) => {
            const cr = byCat.get(c);
            const cOk = cr.filter((r) => r.compliant).length;
            const cOut = cr.filter((r) => r.violation).length;
            const denom = cOk + cOut;
            const okPct = denom ? Math.round((cOk / denom) * 100) : 100;
            const rowsHtml = cr.map((r) => {
                const cls = r.compliant ? 'in' : (r.violation ? 'out' : 'na');
                return `<div class="food-cl-row food-cl-${cls}">
                    <span class="food-cl-disp food-cl-disp-${cls}">${esc(r.disposition || (r.compliant ? 'IN' : 'OUT'))}</span>
                    <span class="food-cl-item">#${esc(r.item ?? '?')}</span>
                    ${r.cos ? '<span class="food-dispos food-dispos-cos">fixed</span>' : ''}
                    ${r.repeat ? '<span class="food-flag-repeat">repeat</span>' : ''}
                    <span class="food-cl-text">${esc(r.standard_text)}</span>
                </div>`;
            }).join('');
            return `<details class="food-cl-cat${cOut ? ' has-out' : ''}">
                <summary>
                    <span class="food-cl-cat-name">${esc(c)}</span>
                    <span class="food-cl-cat-count">${cOk}/${denom}</span>
                    <span class="food-cl-cat-bar"><span style="width:${okPct}%"></span></span>
                </summary>
                <div class="food-cl-rows">${rowsHtml}</div>
            </details>`;
        }).join('');
        return `<details class="food-checklist">
            <summary class="text-muted small">Inspection checklist — ${presentation.count ?? 0} distinct applicable code items · ${rows.length} published rows · ${out} OUT</summary>
            <div class="food-checklist-body">${cats_html}</div>
        </details>`;
    },

    _renderTemps(tv, fallback) {
        const has = tv && (tv.food_present || tv.warewashing_present || tv.equipment_present);
        if (!has) return this._renderTempsLegacy(fallback);
        const out = [];
        if (tv.food_present && (tv.food || []).length) {
            out.push(`<div class="food-temp-cat">Food temperatures</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Item</th><th>Temp</th><th>State</th></tr>`
                + tv.food.map((r) => {
                    const bad = this._foodTempBad(r);
                    return `<tr class="${bad ? 'food-temp-bad' : ''}"><td>${esc(r.description || '')}</td>`
                        + `<td>${esc(r.temperature || '')}</td><td>${esc(r.state_of_food || '')}`
                        + `${bad ? ' <i class="bi bi-exclamation-triangle" title="outside the safe holding range"></i>' : ''}</td></tr>`;
                }).join('') + `</table></div>`);
        }
        if (tv.warewashing_present && (tv.warewashing || []).length) {
            out.push(`<div class="food-temp-cat">Warewashing &amp; sanitizer</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Machine</th><th>Method</th><th>PPM</th><th>Temp</th></tr>`
                + tv.warewashing.map((r) => {
                    const bad = this._sanitizerBad(r);
                    const chem = [r.method, r.sanitizer_type || r.sanitizer_name].filter(Boolean).join(' ');
                    return `<tr class="${bad ? 'food-temp-bad' : ''}"><td>${esc(r.machine || '')}</td>`
                        + `<td>${esc(chem)}</td><td>${r.ppm != null ? esc(r.ppm) : ''}`
                        + `${bad ? ' <i class="bi bi-exclamation-triangle" title="sanitizer concentration / temp out of range"></i>' : ''}</td>`
                        + `<td>${esc(r.temperature || '')}</td></tr>`;
                }).join('') + `</table></div>`);
        }
        if (tv.equipment_present && (tv.equipment || []).length) {
            out.push(`<div class="food-temp-cat">Equipment temperatures</div><div class="food-temp-scroll"><table class="food-temp-table">`
                + `<tr><th>Equipment</th><th>Temp</th></tr>`
                + tv.equipment.map((r) =>
                    `<tr><td>${esc(r.description || '')}</td><td>${esc(r.temperature || '')}</td></tr>`).join('')
                + `</table></div>`);
        }
        if (!out.length) return this._renderTempsLegacy(fallback);
        const n = (tv.food || []).length + (tv.warewashing || []).length + (tv.equipment || []).length;
        return `<details class="food-temps"><summary class="text-muted small">Temperatures &amp; sanitizer (${n} readings)</summary>${out.join('')}</details>`;
    },

    _renderTempsLegacy(temps) {
        if (!temps || !temps.length) return '';
        return `<details class="food-temps">
            <summary class="text-muted small">Temperature log (${temps.reduce((n, t) => n + t.rows.length, 0)} readings)</summary>
            ${temps.map((t) => `<div class="food-temp-cat">${esc(t.category)}</div>`
                + `<div class="food-temp-scroll"><table class="food-temp-table">${t.rows.map((r) =>
                    `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`).join('')}
        </details>`;
    },

    _foodTempBad(r) {
        const t = typeof r.temperature_f === 'number' ? r.temperature_f : null;
        if (t == null) return false;
        const s = (r.state_of_food || '').toLowerCase();
        if (s.includes('cold')) return t > 41;
        if (s.includes('hot')) return t < 135;
        return false;
    },

    _sanitizerBad(r) {
        const method = (r.method || '').toLowerCase();
        if (method.includes('high') || method.includes('heat'))
            return typeof r.temperature_f === 'number' && r.temperature_f < 160;
        const ppm = typeof r.ppm === 'number' ? r.ppm : null;
        if (ppm == null) return false;
        const type = (r.sanitizer_type || r.sanitizer_name || '').toLowerCase();
        if (type.includes('chlor')) return ppm < 50 || ppm > 200;
        if (type.includes('quat')) return ppm < 150 || ppm > 400;
        return ppm < 50;
    },
};
