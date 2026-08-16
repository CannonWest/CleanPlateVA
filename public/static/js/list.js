/**
 * List view — filter, sort, and render the roster table. `listMethods` is
 * installed on FoodDashboard.prototype by foodDashboard.js (`this` is the
 * dashboard).
 */

import {
    esc, facilityPresentation, fmtDate, focusedOutcomePresentation, gradeColor, permitUrl,
} from './presentation.js';

export const listMethods = {
    _rebuildList() {
        const body = document.getElementById('foodListBody');
        if (!body) return;
        const filtered = this._facilities.filter((f) => this._matchesFilters(f));
        const { key, dir } = this._sort;
        const val = (f) => {
            const lt = f.latest || {};
            const fp = facilityPresentation(f);
            const assessment = fp.assessmentRecord || {};
            switch (key) {
                case 'address': return `${f.address || ''} ${f.address2 || ''}`.trim().toLowerCase();
                case 'name': return (f.name || '').toLowerCase();
                case 'zip': return f.zip || '';
                case 'score': return fp.grade?.score ?? -1;
                case 'compliance': return assessment.compliance_rate ?? -1;
                case 'trend': return fp.trend.length >= 2 ? fp.trend[0] - fp.trend[1] : 0;
                case 'date': return lt.date || '';
                default: return 0;
            }
        };
        filtered.sort((a, b) => {
            const va = val(a), vb = val(b);
            if (va < vb) return dir === 'asc' ? -1 : 1;
            if (va > vb) return dir === 'asc' ? 1 : -1;
            return 0;
        });
        const CAP = 600;
        const rows = filtered.slice(0, CAP);
        body.innerHTML = rows.map((f) => {
            const lt = f.latest || {};
            const fp = facilityPresentation(f);
            const latest = fp.latest;
            const g = fp.grade;
            const assessmentRecord = fp.assessmentRecord || {};
            const address = [f.address, f.address2].filter(Boolean).join(' ');
            const t = fp.trend;
            const arrow = t.length >= 2 ? (t[0] < t[1] ? '▼' : t[0] > t[1] ? '▲' : '▬') : '';
            const tcol = t.length >= 2 ? '#228be6' : '';
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
                <td class="food-list-date food-list-full-only food-list-col-date">${fmtDate(lt.date)}</td>
                <td class="food-list-col-vdh"><a class="food-list-vdh-link" href="${permitUrl(f)}" target="_blank" rel="noopener" aria-label="View ${esc(f.name)} on VDH" title="View ${esc(f.name)} on VDH"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a></td>
            </tr>`;
        }).join('') + (filtered.length > CAP
            ? `<tr class="food-list-more"><td colspan="${this._mode === 'lite' ? 4 : 8}">Showing first ${CAP} of ${filtered.length} — narrow the filters to see the rest.</td></tr>` : '');
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
