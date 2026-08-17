/**
 * Status surfaces — the footer freshness line and the About tab's live
 * cards. `aboutMethods` is installed on FoodDashboard.prototype by
 * foodDashboard.js (`this` is the dashboard).
 */

import { esc, fmtDate, fmtDateShort } from './presentation.js';

export const aboutMethods = {
    // Freshness reads at two lengths: the full phrasing where the footer has
    // room, a trimmed one under 1500px (CSS picks — see .food-freshness).
    // Both stay in the DOM so the swap is layout-only, no re-render on resize.
    _renderFreshness(el, snapshotIso, latestIso) {
        if (!snapshotIso && !latestIso) {
            el.innerHTML = '';
            el.removeAttribute('title');
            return;
        }
        const full = [];
        const short = [];
        if (snapshotIso) {
            full.push(`snapshot ${fmtDate(snapshotIso)}`);
            short.push(`snap ${fmtDateShort(snapshotIso)}`);
        }
        if (latestIso) {
            full.push(`newest report ${fmtDate(latestIso)}`);
            short.push(`report ${fmtDateShort(latestIso)}`);
        }
        el.innerHTML = `<span class="food-freshness-full">${esc(full.join(' · '))}</span>`
            + `<span class="food-freshness-short">${esc(short.join(' · '))}</span>`;
        // The tooltip always spells out the distinction the short form drops.
        // In the footer the label never hides outright — it wraps to its own
        // row instead — so the hover target survives at every width. About
        // still states both dates in full as the durable record.
        el.title = [
            snapshotIso ? `Archive snapshot published ${fmtDate(snapshotIso)}` : null,
            latestIso ? `Newest inspection report in it: ${fmtDate(latestIso)}` : null,
        ].filter(Boolean).join('\n');
    },

    _updateAboutStatus(payload, lite) {
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        const zips = Object.keys(this._counts?.by_zip || {}).filter((z) => z !== '?').length;
        const total = this._counts?.total ?? this._facilities.length;
        // Contract V4: the newest held report is a manifest fact on BOTH tiers
        // (`freshness.newest_report`) — no client-side scan of every row.
        const latest = payload.freshness?.newest_report || null;
        const snapshot = payload.fetched_at ? fmtDate(payload.fetched_at.slice(0, 10)) : 'Not recorded';

        setText('aboutTierLabel', lite ? 'Public finder' : 'Authenticated archive');
        setText('aboutTierDetail', lite
            ? 'Identity, geocoded location, and retained permit ID'
            : 'Inspection histories plus CleanPlateVA-derived signals');
        setText('aboutSnapshotDate', snapshot);
        const totalNumber = Number(total || 0);
        setText('aboutCoverageCount', `${totalNumber.toLocaleString()} `
            + `${totalNumber === 1 ? 'facility' : 'facilities'} · ${zips} ${zips === 1 ? 'ZIP' : 'ZIPs'}`);
        setText('aboutLatestDate', latest ? fmtDate(latest) : 'No dated report');
    },

    _updateAboutUnavailable() {
        const values = {
            aboutTierLabel: 'Data unavailable',
            aboutTierDetail: 'Methodology remains available; try refresh',
            aboutSnapshotDate: 'Unavailable',
            aboutCoverageCount: 'Unavailable',
            aboutLatestDate: 'Unavailable',
        };
        Object.entries(values).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
    },
};
