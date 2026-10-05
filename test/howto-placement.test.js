// v1.6.5: home "How to play" placement — a compact full-width row that closes the mode section.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('www/index.html');
const css = read('www/css/style.css');
const game = read('www/js/game.js');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('  ok -', m); };

console.log('howto-placement.test.js');

// Release markers (forward-compatible: later releases keep this test green).
const [maj, min, pat] = pkg.version.split('.').map(Number);
ok(maj > 1 || (maj === 1 && (min > 6 || (min === 6 && pat >= 5))), 'version >= 1.6.5 (' + pkg.version + ')');
const code = Number((gradle.match(/versionCode (\d+)/) || [])[1]);
ok(code >= 22, 'versionCode >= 22 (' + code + ')');
const esc = pkg.version.replace(/\./g, '\\.');
ok(new RegExp('versionName "' + esc + '"').test(gradle) && new RegExp('Crossfour v' + esc).test(html), 'gradle versionName and settings footer match package.json');
ok(!/\?v=1\.6\.4"/.test(html) && new RegExp('css/style\\.css\\?v=' + esc).test(html), 'assets cache-busted for ' + pkg.version);

// Markup order inside .home-actions: 4 mode cards -> quick-mode grid -> How to play -> end of group.
const actionsStart = html.indexOf('<div class="home-actions"');
const actionsEnd = html.indexOf('<div class="home-row">');
const actions = html.slice(actionsStart, actionsEnd);
const at = s => actions.indexOf(s);
ok(at('id="btn-pass"') > 0 && at('class="mode-grid"') > at('id="btn-pass"'), 'quick-mode grid follows the four mode cards directly');
ok(at('id="howto-card"') > at('id="btn-friendly"'), 'How to play sits after the quick-mode grid (closes the mode section)');
ok(!/id="howto-card"[\s\S]*class="mode-grid"/.test(actions), 'nothing mode-related is pushed below the How to play row');
ok(actions.indexOf('id="howto-card"') > 0 && html.indexOf('id="howto-card"') < actionsEnd, 'How to play stays inside the home mode group (above Skins / Rules / Settings)');

// Accessible disclosure: native button, aria wiring, decorative icon + chevron, table untouched.
const card = html.slice(html.indexOf('<section id="howto-card"'), html.indexOf('</section>', html.indexOf('<section id="howto-card"')));
ok(/<button id="btn-howto-home" class="howto-open" type="button" aria-expanded="false" aria-controls="howto-panel">/.test(card), 'native disclosure button with aria-expanded / aria-controls');
ok(/class="howto-open-mark" aria-hidden="true"/.test(card) && /class="howto-open-chevron" aria-hidden="true"/.test(card), 'icon and chevron are decorative');
ok(/<b>How to play<\/b>/.test(card) && /<small>[^<]+<\/small>/.test(card), 'title + one-line subtitle like the other home CTAs');
ok(/id="howto-panel" class="howto-panel hidden"/.test(card) && (card.match(/<tr><td>/g) || []).length === 11, 'Rule | Kaise table (11 rows) still starts closed');

// CSS: compact auto-height row, full width, no forced two-card height, scrollable panel.
const rule = sel => { const i = css.indexOf('\n' + sel + ' {'); assert.ok(i >= 0, sel + ' rule'); return css.slice(i, css.indexOf('}', i)); };
const cardRule = rule('.howto-card');
ok(/grid-column: 1 \/ -1/.test(cardRule), 'How to play spans both grid columns');
ok(!/height:\s*calc\(var\(--card-h\)/.test(css) && !/min-height:\s*calc\(var\(--card-h\)/.test(css), 'no fixed two-row height (the old empty box)');
ok(/\.home-actions > \.mode-grid \{ grid-column: 1 \/ -1; \}/.test(css), 'quick-mode grid spans the full width (no half-empty row)');
ok(/min-height: 56px/.test(rule('.howto-open')), 'collapsed row is 56px like the Leaderboard CTA');
ok(/max-height: min\(46vh, 300px\)/.test(rule('.howto-scroll')) && /overflow: auto/.test(rule('.howto-scroll')), 'opened table scrolls inside a bounded panel');
ok(/\.howto-open\[aria-expanded="true"\] \.howto-open-chevron \{ transform: rotate\(90deg\); \}/.test(css), 'chevron turns when open');
for (const sel of ['body.light .howto-card', 'body.light .howto-open', 'body.light .howto-open-mark', 'body.light .howto-open-chevron', 'body.light .howto-open-copy small', 'body.light .howto-table th']) {
  ok(css.indexOf(sel + ' {') > css.indexOf('v1.6.4 · Light theme contrast'), 'light-theme override: ' + sel);
}

// JS: no more inline height forcing; toggle keeps aria + card state in sync.
ok(!/sizeHowtoCard/.test(game), 'sizeHowtoCard (inline two-row height) removed');
ok(/card\.classList\.toggle\('is-open', open\)/.test(game) && /setAttribute\('aria-expanded', open \? 'true' : 'false'\)/.test(game), 'toggle updates aria-expanded and .is-open');

console.log('howto-placement checks passed (' + checks + ' checks).');
