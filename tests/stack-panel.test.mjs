/** The list that opens with a spider web.
 *
 *  A ring of identical dots answers "how many places are here" but not
 *  "which", and reaching one means aiming at a 15px dot in a ring that may
 *  hold 82 of them. The panel answers both, pages through them 5 at a time,
 *  and gives a keyboard a way in that DOM markers never did.
 *
 *  Three decisions it encodes (Cannon, 2026-08-19):
 *
 *  1. A FILTER CHANGE UPDATES IT rather than closing it. The web is torn down
 *     and re-seated against whatever survived; a stack that is gone, or down
 *     to one member, declines to reopen and becomes a lone dot again.
 *
 *  2. THE HEADER CARRIES WHAT THE MEMBERS SHARE, the rows carry what makes
 *     them differ. This is not cosmetic: 665 of 1,950 stacks on the committed
 *     roster hold at least two different address strings, almost always one
 *     doorway with its suite folded in differently.
 *
 *  3. HOVER WINS WHEN THEY COLLIDE. The panel is a standing reference; the
 *     card is what the pointer is asking about right now.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dashboard, moduleSource } from './support/dashboard.mjs';

const { baseAddress, memberSuite, sharedPlace, spiderReach, STACK_PANEL_PAGE } = dashboard;
const css = readFileSync(new URL('../public/static/css/style.css', import.meta.url), 'utf8');

const place = (name, address, address2 = '', city = 'Stone Ridge', zip = '20105') =>
    ({ name, address, address2, city, zip });

test('a trailing suite is stripped, one in the middle is left alone', () => {
    assert.equal(baseAddress('42010 Village Center Plaza #130'), '42010 Village Center Plaza');
    assert.equal(baseAddress('620 N 25th St, Suite 4'), '620 N 25th St');
    assert.equal(baseAddress('100 Main St Ste 2B'), '100 Main St');
    assert.equal(baseAddress('7 Oak Ave Unit 12'), '7 Oak Ave');
    // Untouched: nothing to strip, or the token is not at the end. Guessing at
    // a mid-string suite would mangle real addresses, so it is left to the
    // vote in sharedPlace instead.
    assert.equal(baseAddress('1401 W Broad St'), '1401 W Broad St');
    assert.equal(baseAddress('1541 Premium Outlets #170 Blvd.'), '1541 Premium Outlets #170 Blvd.');
    assert.equal(baseAddress(''), '');
    assert.equal(baseAddress(undefined), '');
});

test('the header states what the members actually share', () => {
    // The real plaza: four permits, suites folded two different ways, and two
    // different cities on the same point.
    const plaza = [
        place('Vocelli Pizza', '42010 Village Center Plaza #130', '', 'Aldie'),
        place('Glory Days Grill', '42010 Village Center Plaza', '#180'),
        place('Subway', '42010 Village Center Plaza', '#140'),
        place('Biryani Grill', '42010 Village Center Plaza #170', '', 'Aldie'),
    ];
    const shared = sharedPlace(plaza);
    assert.equal(shared.address, '42010 Village Center Plaza');
    assert.equal(shared.zip, '20105');
    assert.ok(['Aldie', 'Stone Ridge'].includes(shared.city), 'one of the two, not a blend');

    // A tie goes to the SHORTEST, which is the one without a suite in it —
    // this is the "#170 Blvd." case, where the suite sits mid-string and
    // stripping cannot help.
    const outlets = [
        place('Which Wich', '1541 Premium Outlets #170 Blvd.', '', 'Norfolk', '23502'),
        place('Which Wich Superior', '1541 Premium Outlets #170 Blvd.', '', 'Norfolk', '23502'),
        place('Duck Donuts', '1541 Premium Outlets Blvd', '220', 'Norfolk', '23502'),
        place('Poketastic', '1541 Premium Outlets Blvd', '220', 'Norfolk', '23502'),
    ];
    assert.equal(sharedPlace(outlets).address, '1541 Premium Outlets Blvd');

    // Spelling variants: no common base, so the shorter reading wins and the
    // rows below carry the rest.
    const danville = [
        place('Sam\'s Backstreet Catering', '142 S Main St', '', 'Danville', '24541'),
        place('SOVAH Health Cafeteria', '142 South Main Street', '', 'Danville', '24541'),
    ];
    assert.equal(sharedPlace(danville).address, '142 S Main St');

    // The ordinary case is still ordinary.
    assert.equal(sharedPlace([
        place('Taco Bell', '1401 W Broad St', '', 'Richmond', '23220'),
        place('Sub Rosa', '1401 W Broad St', '', 'Richmond', '23220'),
    ]).address, '1401 W Broad St');
});

test('each row carries only what makes it different', () => {
    const shared = '42010 Village Center Plaza';
    // An explicit address2 is the suite, verbatim.
    assert.equal(memberSuite(place('Subway', shared, '#140'), shared), '#140');
    // Folded into the street line instead: only the remainder shows.
    assert.equal(memberSuite(place('Vocelli', `${shared} #130`), shared), '#130');
    // Nothing to add — the row is just the name.
    assert.equal(memberSuite(place('Solo', shared), shared), '');
    // A street line that is not the shared one keeps its address IN FULL,
    // rather than a remainder that would imply it is somewhere it is not.
    assert.equal(memberSuite(place('Elsewhere', '9 Other Rd'), shared), '9 Other Rd');
    assert.equal(memberSuite(place('Nameless', ''), shared), '');
});

test('the web tells the panel how far to stand off', () => {
    // Offsets are screen-space, so the reach is the furthest seat plus the leg
    // itself — the panel clears that, and therefore never covers a leg.
    assert.equal(spiderReach([[0, -26], [26, 0]], 7.5), 33.5);
    assert.equal(spiderReach([[0, -26], [0, -70]], 10.5), 80.5);
    assert.equal(Math.round(spiderReach([[30, 40]], 7.5)), 58);
    const stacks = moduleSource('stacks.js');
    assert.match(stacks, /reach: spiderReach\(offsets, coarse \? 10\.5 : 7\.5\)/);
    // Above by preference; flipped below when the top would run off; and when
    // NEITHER fits — a short map with a tall panel — clamped onto the map
    // rather than left hanging off its bottom edge, which is where the flip
    // put it on a 534px-tall viewport before this clamp existed.
    assert.match(stacks, /if \(at\.y \+ up - half >= EDGE\) \{/);
    assert.match(stacks, /\} else if \(at\.y \+ down \+ half <= view - EDGE\) \{/);
    assert.match(stacks, /const centre = Math\.min\(Math\.max\(at\.y \+ dy, EDGE \+ half\), view - EDGE - half\);/);
});

test('a filter change re-seats the open web instead of closing it', () => {
    const markers = moduleSource('markers.js');
    // The page position is carried across, so re-rendering does not throw the
    // visitor back to the first five.
    assert.match(markers, /page: this\._stackPanel\?\.page \|\| 1/);
    assert.match(markers, /if \(open\) this\._expandStack\(open\.key, \{ recenter: false, page: open\.page \}\)/);
    // Re-seating must not fly the camera: the visitor moved a switch.
    const stacks = moduleSource('stacks.js');
    assert.match(stacks, /if \(recenter\) \{\s*this\._map\.easeTo\(/);
});

test('the panel pages in fives and never outlives its web', () => {
    assert.equal(STACK_PANEL_PAGE, 5);
    const stacks = moduleSource('stacks.js');
    assert.match(stacks, /const pages = Math\.max\(1, Math\.ceil\(members\.length \/ STACK_PANEL_PAGE\)\)/);
    // A page that no longer exists after a filter change is clamped, not left
    // pointing past the end.
    assert.match(stacks, /panel\.page = Math\.min\(Math\.max\(1, panel\.page\), pages\)/);
    // Dismissing the web closes the panel first — it has no life of its own.
    assert.match(stacks, /_dismissSpider\(\) \{\s*this\._closeStackPanel\(\);/);
    // Clicks inside belong to the panel; markers are DOM siblings of the
    // canvas, so without this the map would read one as empty ground and
    // close the very web the panel belongs to.
    assert.match(stacks, /el\.addEventListener\('click', \(e\) => e\.stopPropagation\(\)\)/);
});

test('the whole row is the control, and it is a real button', () => {
    const stacks = moduleSource('stacks.js');
    // A <button>, so the keyboard reaches it and Enter/Space work without a
    // role or tabindex bolted on.
    assert.match(stacks, /<button type="button" class="food-stack-row" data-i="\$\{i\}"/);
    assert.match(stacks, /aria-label="Open \$\{esc\(f\.name\)\}"/);
    assert.match(stacks, /row\.addEventListener\('click', \(\) => \{[\s\S]{0,120}?this\._select\(members\[i\]\)/);
    // The separate Open button is gone — it was a second target for the thing
    // the row already is.
    assert.doesNotMatch(stacks, /food-stack-row-open/);
    assert.doesNotMatch(css, /\.food-stack-row-open/);
    assert.match(css, /\.food-stack-row \{[^}]*cursor: pointer/);
    assert.match(css, /\.food-stack-row:focus-visible \{/);
});

test('the panel is judgment-free on the basic map', () => {
    // P6: Lite ships no scores, so the rows are names and suites only.
    const stacks = moduleSource('stacks.js');
    assert.match(stacks, /const score = lite \? ''/);
    assert.match(stacks, /_stackRowHTML\(f, from \+ n, lite\)/);
});

test('the row and its leg light each other up', () => {
    const stacks = moduleSource('stacks.js');
    assert.match(stacks, /el\.addEventListener\('mouseenter', \(\) => this\._linkStackRow\(i, true\)\)/);
    assert.match(stacks, /row\.addEventListener\('mouseenter', \(\) => this\._linkStackLeg\(i, true\)\)/);
    // A ring, not a transform: MapLibre owns each leg's transform to place it.
    assert.match(css, /\.food-spider-leg\.is-linked \{\s*box-shadow:/);
    assert.doesNotMatch(css, /\.food-spider-leg\.is-linked \{[^}]*transform:/);
});

test('an active hover card takes the space only when moving it did not help', () => {
    const hover = moduleSource('hover.js');
    // Measured, not assumed, and by area: a card is moved to the other side of
    // its marker first, and only a card that STILL buries the panel makes the
    // panel step aside.
    assert.match(hover, /_panelCoveredBy\(\) \{/);
    assert.match(hover, /this\._yieldStackPanel\(this\._panelCoveredBy\(\) > PANEL_COVER_LIMIT\)/);
    // ...and the panel comes straight back when the pointer leaves.
    assert.match(hover, /_hideHoverCard\(\) \{[\s\S]{0,200}?this\._yieldStackPanel\(false\)/);
    // Opacity, not display: the panel keeps its box so the offset maths does
    // not jump while it is away.
    assert.match(css, /\.food-stack-panel\.is-yielded \{ opacity: 0; pointer-events: none; \}/);
});

test('the suite survives truncation; the name is what gives way', () => {
    // At one address the suite is the ONLY thing telling two rows apart, so it
    // cannot live inside the ellipsizing name — it did at first, and every row
    // rendered as "Wing Stop (01-0402) #…" with the suite clipped off.
    const stacks = moduleSource('stacks.js');
    // The name span closing right after the name IS the guarantee: nest the
    // suite back inside it and this stops matching.
    assert.match(stacks, /<span class="food-stack-row-name">\$\{esc\(f\.name\)\}<\/span>/);
    assert.match(css, /\.food-stack-row-name \{[^}]*text-overflow:\s*ellipsis/);
    assert.match(css, /\.food-stack-row-suite \{ flex: 0 0 auto;/);
});

test('a leg card hangs BELOW its leg while the panel is up', () => {
    // MapLibre opens a popup upward by default and the panel stands above the
    // web, so the two competed for one strip of screen and the panel yielded
    // on nearly every hover — hiding the row that same hover had highlighted.
    const hover = moduleSource('hover.js');
    const stacks = moduleSource('stacks.js');
    assert.match(hover, /_hoverPopupFor\(anchor\) \{/);
    assert.match(hover, /\.\.\.\(anchor \? \{ anchor \} : \{\}\)/);
    assert.match(hover, /_showHoverCard\(lngLat, f, \{ below = false \} = \{\}\)/);
    assert.match(stacks, /\{ below: !!this\._stackPanel \}\);/);
    // ...and the same move now applies to ANY marker's card, not just the
    // legs inside the web: an ordinary marker beside the stack used to open
    // upward straight over the panel, which then vanished entirely.
    assert.match(hover, /if \(this\._stackPanel && !below && this\._panelCoveredBy\(\) > PANEL_COVER_LIMIT\) \{\s*place\('top'\);/);
    // Coverage is a FRACTION, not a rectangle test: clipping an edge is fine,
    // burying the panel is not, and a boolean would make cards hop around
    // every time they brushed a corner. 0.6 is calibrated against Cannon's own
    // two examples, measured on the Carytown stack: East Coast Provisions
    // covers 52% and he called it fine, so it is left alone; McDonald's 6684
    // covers 93%, moves to the other side, and — still buried there, being
    // right beside the panel — makes the panel step aside. The other ten
    // markers in view covered 0–16% and are never touched.
    assert.match(hover, /const PANEL_COVER_LIMIT = 0\.6;/);
    assert.match(hover, /return \(w \* h\) \/ \(a\.width \* a\.height\);/);
    // The yield stays as the last resort for when moving it did not help.
    assert.match(hover, /_yieldStackPanel\(this\._panelCoveredBy\(\) > PANEL_COVER_LIMIT\)/);
});

test('the panel is chrome, so every rule has a dark pair', () => {
    for (const sel of ['.food-stack-panel', '.food-stack-panel-where', '.food-stack-row.is-linked',
        '.food-stack-row-suite', '.food-stack-panel-pager', '.food-stack-row:hover']) {
        const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(css, new RegExp(`\\.theme-dark ${escaped}\\b`), `${sel} needs a dark pair`);
    }
});
