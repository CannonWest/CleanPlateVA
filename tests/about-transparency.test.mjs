import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');
const dashboardSource = readFileSync(
    new URL('../public/static/js/foodDashboard.js', import.meta.url),
    'utf8',
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

test('the static score explainer states the production scoring coefficients', () => {
    // Weight board: −6/−9 per risk-factor violation, −2/−3 per
    // good-retail-practice violation, repeats at ×1.5.
    for (const [weight, label] of [[6, '−6'], [9, '−9'], [2, '−2'], [3, '−3']]) {
        assert.match(html, new RegExp(`data-weight="${weight}"[^>]*>${label}<`));
    }
    assert.match(html, /6 × 1\.5/);
    assert.match(html, /2 × 1\.5/);

    // The worked example is static, so the honesty check is arithmetic:
    // 100 − Σ(data-points) must equal data-example-total, the per-family
    // sums must match the equation, and the ring/marker must sit at the
    // same value.
    const points = [...html.matchAll(/data-family="(risk|grp)" data-points="(\d+)"/g)]
        .map(([, family, n]) => ({ family, n: Number(n) }));
    assert.ok(points.length >= 3, 'worked example lists at least three deduction lines');
    const sum = (family) => points.filter((p) => p.family === family)
        .reduce((acc, p) => acc + p.n, 0);
    const total = Number(html.match(/data-example-total="(\d+)"/)?.[1]);
    assert.equal(100 - sum('risk') - sum('grp'), total);
    assert.equal(Number(html.match(/data-risk-deduction="(\d+)"/)?.[1]), sum('risk'));
    assert.equal(Number(html.match(/data-grp-deduction="(\d+)"/)?.[1]), sum('grp'));
    assert.match(html, new RegExp(`--about-score-angle:${total * 3.6}deg`));
    assert.match(html, new RegExp(`--about-score-position:${total}%`));
    assert.match(html, new RegExp(`${total} · B`));
    assert.match(html, /Grade B/);
});

test('the score explainer visibly gates grades by assessment breadth', () => {
    assert.match(html, /20\+/);
    assert.match(html, /1–19/);
    assert.match(html, /0 \/ no checklist/);
    assert.match(html, /When does a score become a grade\?/);
    // The gate itself lives in the production presentation path.
    assert.match(dashboardSource, /count >= BROAD_MIN_APPLICABLE_ITEMS \? 'broad' : 'focused'/);
    assert.match(html, /◇ r100/);
    assert.match(html, /Focused inspections remain visible as unconnected raw-formula event markers/);
    // The explainer is deliberately static — no interactive controls, no
    // score-demo wiring anywhere in the About view.
    const aboutView = html.match(/<main class="food-about-wrap[\s\S]*?<\/main>/)?.[0] || '';
    assert.ok(aboutView.length > 0, 'About view markup found');
    assert.doesNotMatch(aboutView, /<(input|output)\b/);
    assert.doesNotMatch(dashboardSource, /data-about-score/);
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
