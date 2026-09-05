/**
 * List view — filter, sort, and render the roster table. `listMethods` is
 * installed on FoodDashboard.prototype by foodDashboard.js (`this` is the
 * dashboard).
 */

import { LIST_PAGE_SIZE } from './constants.js';
import { maxPage, revealCount } from './router.js';
import {
    esc, facilityPresentation, fmtDate, focusedOutcomePresentation, gradeColor, permitUrl,
    sourceDepartment,
} from './presentation.js';

export const listMethods = {
    _rebuildList() {
        const body = document.getElementById('foodListBody');
        if (!body) return;
        const filtered = this._facilities.filter((f) => this._matchesFilters(f));
        const { key, dir } = this._sort;
        // Sort keys ride the Contract V4 overlay (grade score, compliance,
        // trend delta, latest date) — thin enough that the List needs no
        // family of its own (design ref §5, §10.4).
        const val = (f) => {
            const fp = facilityPresentation(f);
            const assessment = fp.assessmentRecord || {};
            switch (key) {
                case 'address': return `${f.address || ''} ${f.address2 || ''}`.trim().toLowerCase();
                case 'name': return (f.name || '').toLowerCase();
                case 'zip': return f.zip || '';
                case 'score': return fp.grade?.score ?? -1;
                case 'compliance': return assessment.compliance_rate ?? -1;
                case 'trend': return fp.trendDelta ?? 0;
                case 'date': return fp.latestDate || '';
                default: return 0;
            }
        };
        filtered.sort((a, b) => {
            const va = val(a), vb = val(b);
            if (va < vb) return dir === 'asc' ? -1 : 1;
            if (va > vb) return dir === 'asc' ? 1 : -1;
            return 0;
        });
        // Load-more (D-DATA-11): the sorted, filtered array is all in memory;
        // `_page` says how many chunks of LIST_PAGE_SIZE are revealed (the
        // URL's `page`). Clamp a stale page once the roster is in so the URL
        // never claims more chunks than the list has.
        if (this._facilities.length && this._page > maxPage(filtered.length)) {
            this._page = maxPage(filtered.length);
        }
        const shown = revealCount(filtered.length, this._page);
        const rows = filtered.slice(0, shown);
        body.innerHTML = rows.map((f) => {
            const fp = facilityPresentation(f);
            const latest = fp.latest;
            const g = fp.grade;
            const assessmentRecord = fp.assessmentRecord || {};
            const address = [f.address, f.address2].filter(Boolean).join(' ');
            const delta = fp.trendDelta;
            const arrow = delta != null ? (delta < 0 ? '▼' : delta > 0 ? '▲' : '▬') : '';
            const tcol = delta != null ? '#228be6' : '';
            // Focused rows carry the OUT ratio only — no raw score. See the
            // note in `_tooltipHTML`.
            const eventLine = latest.scope === 'focused'
                ? `Latest: focused · ${focusedOutcomePresentation(latest).label}`
                : latest.scope === 'broad'
                    ? `Latest: broad · ${latest.count ?? '?'} items`
                    : 'Latest: checklist scope unavailable';
            const rowCls = [this._selectedPermit === f.permit_id ? 'sel' : '',
                (this._mode === 'lite' || this._isActive(f)) ? '' : 'food-closed'].filter(Boolean).join(' ');
            return `<tr data-permit="${esc(f.permit_id)}"${rowCls ? ` class="${rowCls}"` : ''}>
                <td class="food-list-col-address">${esc(address)}</td>
                <td class="food-list-name food-list-col-name">${esc(f.name)}<span class="food-list-event food-list-full-only">${esc(eventLine)}</span></td>
                <td class="food-list-col-zip">${esc(f.zip || '')}</td>
                <td class="food-list-full-only food-list-col-score">${g ? `<span class="food-list-score" style="background:${gradeColor(g.letter)}" title="${g.adjusted
                    ? `Grade after ${g.followups} follow-up${g.followups === 1 ? '' : 's'} · from broad ${esc(g.baseScore)}${assessmentRecord.date ? ` on ${esc(fmtDate(assessmentRecord.date))}` : ''}`
                    : assessmentRecord.date ? `Grade from the broad inspection on ${esc(fmtDate(assessmentRecord.date))}` : 'Facility grade'}">${esc(g.letter)} ${esc(g.score)}</span>`
                    : this._isNew(f)
                        ? '<span class="food-list-score food-list-score-new" title="Newly permitted; grade pending a broad inspection">NEW</span>'
                        : '<span class="food-list-score food-list-score-none" title="No broad inspection captured">—</span>'}</td>
                <td class="food-list-full-only food-list-col-compliance">${assessmentRecord.compliance_rate != null ? Math.round(assessmentRecord.compliance_rate * 100) + '%' : '—'}</td>
                <td class="food-list-full-only food-list-col-trend" style="color:${tcol}">${arrow || '—'}</td>
                <td class="food-list-date food-list-full-only food-list-col-date">${fmtDate(fp.latestDate)}</td>
                <td class="food-list-col-vdh"><a class="food-list-vdh-link" href="${permitUrl(f)}" target="_blank" rel="noopener" aria-label="View ${esc(f.name)} ${esc(sourceDepartment(f).handoff)}" title="View ${esc(f.name)} ${esc(sourceDepartment(f).handoff)}"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a></td>
            </tr>`;
        }).join('') + (filtered.length > shown
            ? `<tr class="food-list-more"><td colspan="${this._mode === 'lite' ? 4 : 8}">`
                + `<button type="button" class="btn btn-sm btn-outline-secondary food-list-more-btn">`
                + `Show ${Math.min(LIST_PAGE_SIZE, filtered.length - shown).toLocaleString()} more</button>`
                + `<span class="food-list-more-note">${shown.toLocaleString()} of ${filtered.length.toLocaleString()} shown</span></td></tr>`
            : filtered.length > LIST_PAGE_SIZE
                ? `<tr class="food-list-more"><td colspan="${this._mode === 'lite' ? 4 : 8}">All ${filtered.length.toLocaleString()} shown</td></tr>`
                : '');
        body.querySelector('.food-list-more-btn')?.addEventListener('click', () => {
            const firstNew = shown;
            this._page += 1;
            this._rebuildList();
            this._syncUrl();
            // Keep the reader's place: focus lands on the first newly revealed
            // row's VDH link (the row itself isn't focusable), scrolled into view.
            const next = body.querySelectorAll('tr[data-permit]')[firstNew];
            next?.querySelector('a')?.focus({ preventScroll: true });
            next?.scrollIntoView({ block: 'nearest' });
        });
        body.querySelectorAll('tr[data-permit]').forEach((tr) => {
            tr.addEventListener('click', (event) => {
                // The VDH link is its own destination; don't also open the
                // facility detail panel when the click bubbles to the row.
                if (event.target.closest('a')) return;
                const f = this._facilities.find((x) => x.permit_id === tr.dataset.permit);
                if (f) this._select(f);
            });
        });
        document.querySelectorAll('#foodListTable th[data-sort]').forEach((th) => {
            const on = th.dataset.sort === key;
            th.classList.toggle('sorted', on);
            th.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
        });
        this._updateCounts(filtered.length);
    },
};
