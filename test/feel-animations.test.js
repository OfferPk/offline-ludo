// v1.6.6: more feel-good game animations (hop, capture splash, safe sparkle,
// dice glow/chips, arrow trail, turn pulse, yard exit, home lane, soft UI press).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('www/index.html');
const css = read('www/css/style.css');
const game = read('www/js/game.js');
const logic = read('www/js/logic.js');
const pathAnim = read('www/js/path-animation.js');
const celebration = read('www/js/celebration.js');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('  ok -', m); };

console.log('feel-animations.test.js');

const [maj, min, pat] = pkg.version.split('.').map(Number);
ok(maj > 1 || (maj === 1 && (min > 6 || (min === 6 && pat >= 6))), 'version >= 1.6.6 (' + pkg.version + ')');
const code = Number((gradle.match(/versionCode (\d+)/) || [])[1]);
ok(code >= 23, 'versionCode >= 23 (' + code + ')');
const esc = pkg.version.replace(/\./g, '\\.');
ok(new RegExp('versionName "' + esc + '"').test(gradle) && new RegExp('Crossfour v' + esc).test(html), 'gradle + footer match package.json');
ok(!/\?v=1\.6\.5"/.test(html) && new RegExp('css/style\\.css\\?v=' + esc).test(html), 'assets cache-busted for ' + pkg.version);

// Logic exposes leave / entersHomeColumn / arrowJump on move results (so FX can fire).
ok(/leave: !!m\.leave, entersHomeColumn: !!m\.entersHomeColumn, arrowJump: !!m\.arrowJump/.test(logic), 'move() copies leave/home-lane/arrowJump flags');

// Path hop bounce (stronger stretch/squash) still WebView-safe transform only.
ok(/1 \+ 0\.07 \* arc, 1 - 0\.09 \* arc/.test(pathAnim), 'path hop has bounce stretch/squash');
ok(/arcHeight: CELL \* 0\.42/.test(game), 'token hops use a taller arc');
ok(/reducedMotion/.test(pathAnim) && /prefersReducedMotion\(\)/.test(game), 'path + game respect reduced motion');

// FX helpers present and wired.
for (const fn of ['killBurst', 'sixFlourish', 'safePulse', 'arrowWhoosh', 'yardExitFx', 'hopStepFx', 'homeLaneFx', 'homeCelebrate', 'turnChangeFx']) {
  ok(new RegExp('function ' + fn + '\\b').test(game), 'FX helper ' + fn);
}
ok(/hopStepFx\(points\[k\]\.x/.test(game) && /yardExitFx\(s, points\[k\]\)/.test(game), 'hop + yard exit fire on move steps');
ok(/homeLaneFx\(points\[k\]\.x/.test(game) && /homeLaneFx\(c\.x, c\.y/.test(game), 'home-stretch sparkles on lane steps + land');
ok(/arrowWhoosh\(s, piece, res\.path\)/.test(game) && /streak\('trail'/.test(game), 'arrow whoosh + trail streak');
ok(/kill-splash/.test(game) && /burst-splash/.test(game), 'capture splash particles + radial splash');
ok(/six-glow/.test(game) && /chip-in/.test(game), 'dice glow on 6 + stack chips animate in');
ok(/turn-pulse/.test(game) && /ring-seat/.test(game), 'turn handoff pulse on active seat');

// CSS keyframes / reduced-motion guards (transform/opacity only classes).
for (const k of ['kill-splash', 'safe-spark', 'arrow-whoosh', 'arrow-trail-dot', 'hop-spark', 'yard-burst', 'lane-spark', 'six-glow', 'chip-in', 'seat-pulse']) {
  ok(css.includes('@keyframes ' + k) || css.includes('.' + k), 'CSS present for ' + k);
}
ok(/prefers-reduced-motion: reduce/.test(css) && /yard-burst/.test(css) && /hop-spark/.test(css), 'reduced-motion disables new FX');
ok(/\.mode-card:active \{ transform: scale\(\.97\); opacity: \.94; \}/.test(css), 'soft UI press on mode cards');
ok(/\.howto-open:active \{ transform: scale\(\.97\); opacity: \.94; \}/.test(css), 'soft UI press on How to play');

// Must not regress die picker, 4s timer, camel, ads, online.
ok(/MOVE_DECIDE_MS = 4000/.test(game) && /function showDiePick/.test(game), 'die picker + 4s timer intact');
ok(/CamelCelebration|celebrateWin/.test(game) && /cc-walk/.test(css) && /function play\(/.test(celebration), 'camel win celebration kept');
ok(/Ads\./.test(game) && /DANGER_FILL = '#d23a30'/.test(game), 'ads + arrow danger intact');
ok(/G\.online/.test(game) && /paintOnlineChrome|online-turn-timer/.test(game), 'online paths intact');
ok(/howto-card/.test(html) && /Rule \| Kaise/.test(html) || /howto-table/.test(html), 'How to play / rules markup intact');

console.log('feel-animations checks passed (' + checks + ' checks).');
