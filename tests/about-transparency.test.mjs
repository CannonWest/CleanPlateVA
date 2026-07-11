import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');
const dashboardSource = readFileSync(
    new URL('../public/static/js/foodDashboard.js', import.meta.url),
    'utf8',
);

const dashboardModule = await import(
    `data:text/javascript;base64,${Buffer.from(dashboardSource).toString('base64')}`
);

test('the About view is public, directly linkable, and replaces the footer formula', () => {
    assert.match(html, /data-view="about"/);
    assert.match(html, /id="foodAboutWrap"/);
    assert.match(html, /data-view-link="about"/);
    assert.match(html, /Every marker has a source ID\. Every score has math\./);
    assert.match(html, /not affiliated with or endorsed by VDH or MyHealthDepartment/);
    assert.match(dashboardSource, /window\.location\.hash\.toLowerCase\(\) === '#about'/);

    const footer = html.match(/<div class="food-source-footer[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    assert.match(footer, /methodology &amp; provenance/);
    assert.doesNotMatch(footer, /100\s*[−-]\s*6 per risk-factor/);
    assert.doesNotMatch(html, /food-footer-full/);
    assert.doesNotMatch(css, /food-mode-lite[^}]*foodAboutWrap/);
});

test('the interactive score explainer uses the production scoring coefficients', () => {
    const { computeScoreBreakdown } = dashboardModule;

    assert.deepEqual(
        computeScoreBreakdown({ riskRegular: 1, riskRepeat: 1, grpRegular: 2 }),
        { score: 81, grade: 'B', riskDeduction: 15, grpDeduction: 4 },
    );
    assert.deepEqual(
        computeScoreBreakdown({ riskRegular: 20, grpRepeat: 4 }),
        { score: 0, grade: 'F', riskDeduction: 120, grpDeduction: 12 },
    );
    assert.equal(computeScoreBreakdown({ riskRegular: 1, grpRegular: 2 }).grade, 'A');
    assert.equal(computeScoreBreakdown({ riskRegular: 2, grpRegular: 1 }).grade, 'B');
    assert.equal(computeScoreBreakdown({ riskRegular: 4, grpRegular: 2 }).grade, 'C');
    assert.equal(computeScoreBreakdown({ riskRegular: 6, grpRegular: 2 }).grade, 'D');
    assert.equal(computeScoreBreakdown({ riskRegular: 7 }).grade, 'F');

    for (const [id, penalty] of [
        ['aboutRiskRegular', 6],
        ['aboutRiskRepeat', 9],
        ['aboutGrpRegular', 2],
        ['aboutGrpRepeat', 3],
    ]) {
        const input = html.match(new RegExp(`<input id="${id}"[\\s\\S]*?>`))?.[0] || '';
        assert.match(input, new RegExp(`data-penalty="${penalty}"`));
    }
});

test('transparency content draws the official/derived boundary and full pipeline', () => {
    for (const label of ['Official source', 'Archived snapshot', 'CleanPlateVA-derived']) {
        assert.match(html, new RegExp(label));
    }
    for (const step of [
        'Official VDH surfaces',
        'Archive a snapshot',
        'Parse &amp; preserve IDs',
        'Derive &amp; store',
        'Merge &amp; whitelist',
        'Publish two contracts',
    ]) {
        assert.match(html, new RegExp(step));
    }
    assert.match(html, /Public finder/);
    assert.match(html, /Authenticated archive/);
    assert.match(html, /VDH wins conflicts/);
    assert.match(html, /Exact red-flag ranking weights/);
    assert.match(html, /<b>\+10<\/b> risk-factor item/);
    assert.match(html, /Some unbadged pins are street-level or interpolated/);
    assert.match(html, /marker is not operating-status proof/i);
    assert.doesNotMatch(html, /first occurrence/i);
    assert.doesNotMatch(html, /report JSON/);
    assert.match(dashboardSource, /snapshot \$\{fmtDate\(payload\.fetched_at\.slice\(0, 10\)\)\}/);
    assert.match(dashboardSource, /newest report \$\{fmtDate\(latest\)\}/);
    assert.match(dashboardSource, /Not exposed publicly/);
    assert.doesNotMatch(dashboardSource, /fetchedEl\.textContent = latest \? `as of/);
});

test('About owns an internal scroller and removes map chrome from layout', () => {
    const wrapRule = css.match(/\.food-about-wrap\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(wrapRule, /flex:\s*1\s+1\s+auto/);
    assert.match(wrapRule, /min-height:\s*0/);
    assert.match(wrapRule, /overflow-y:\s*auto/);

    assert.match(
        css,
        /\.food-view-about #foodToolbar,[\s\S]*?\.food-view-about #foodBody\s*\{\s*display:\s*none\s*!important/,
    );
    assert.match(dashboardSource, /classList\.toggle\('food-view-about', mode === 'about'\)/);
    assert.match(html, /id="foodAboutTitle" tabindex="-1"/);
    assert.match(dashboardSource, /foodAboutTitle'\)\?\.focus\(\{ preventScroll: true \}\)/);
    assert.match(dashboardSource, /this\._updateAboutUnavailable\(\)/);
});

test('the grade scale keeps a truthful axis and readable band labels on phones', () => {
    assert.doesNotMatch(css, /\.about-grade-segments\s*\{[^}]*repeat\(5/);
    assert.match(css, /\.about-grade-segments\s*\{[^}]*6fr repeat\(4, 1fr\)/);
    assert.match(
        css,
        /\.about-grade-segments \.grade-d,[\s\S]*?color:\s*#10141c;[\s\S]*?text-shadow:\s*none/,
    );
});
