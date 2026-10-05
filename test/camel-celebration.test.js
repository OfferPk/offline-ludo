// v1.6.3: Gulaab Camel win celebration — geometry, wiring and release markers.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const game = read('www/js/game.js');
const online = read('www/js/online.js');
const cel = read('www/js/celebration.js');
const css = read('www/css/style.css');
const html = read('www/index.html');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
const C = require(path.join(root, 'www/js/celebration.js'));

console.log('camel-celebration.test.js');

// Version moves forward with each release (v1.6.4 = versionCode 21); the camel wiring must remain.
const [cMaj, cMin, cPat] = pkg.version.split('.').map(Number);
assert.ok(cMaj > 1 || (cMaj === 1 && (cMin > 6 || (cMin === 6 && cPat >= 3))), 'version >= 1.6.3');
const vCode = Number((gradle.match(/versionCode (\d+)/) || [])[1]);
assert.ok(vCode >= 20, 'versionCode >= 20');
const vEsc = pkg.version.replace(/\./g, '\\.');
assert.match(gradle, new RegExp('versionName "' + vEsc + '"'));
assert.match(html, new RegExp('Crossfour v' + vEsc));
assert.doesNotMatch(html, /\?v=1\.6\.2/);
assert.match(html, new RegExp('<script src="js/celebration\\.js\\?v=' + vEsc + '"></script>\\s*<script src="js/game\\.js\\?v=' + vEsc + '">'));
console.log('  ok - version ' + pkg.version + ' / versionCode ' + vCode + ' (>= 1.6.3 / 20), celebration.js loads before game.js');

// Geometry: 390x844 phone, seats as laid out by buildPods (slot 0 TL, 1 TR, 2 BR, 3 BL).
const VW = 390, VH = 844;
const seats = {
  tl: { pod: { left: 6, top: 167, width: 186, height: 58 }, av: { left: 12, top: 174, width: 44, height: 44 } },
  tr: { pod: { left: 198, top: 167, width: 186, height: 58 }, av: { left: 334, top: 174, width: 44, height: 44 } },
  br: { pod: { left: 198, top: 615, width: 186, height: 58 }, av: { left: 334, top: 622, width: 44, height: 44 } },
  bl: { pod: { left: 6, top: 615, width: 186, height: 58 }, av: { left: 12, top: 622, width: 44, height: 44 } }
};
for (const [k, s] of Object.entries(seats)) {
  const p = C.plan(s.pod, s.av, VW, VH);
  const left = k[1] === 'l', top = k[0] === 't';
  assert.equal(p.side, left ? 'left' : 'right', k + ' side');
  assert.equal(p.dir, left ? -1 : 1, k + ' faces the winner');
  assert.equal(p.upper, top, k + ' upper');
  // enters off-screen from the far side and ends on-screen next to the avatar
  if (left) { assert.ok(p.x0 >= VW, k + ' enters from right'); assert.ok(p.x1 >= s.av.left + s.av.width, k + ' stops right of avatar'); }
  else { assert.ok(p.x0 + p.w <= 0, k + ' enters from left'); assert.ok(p.x1 + p.w <= s.av.left, k + ' stops left of avatar'); }
  assert.ok(p.x1 >= 4 && p.x1 + p.w <= VW - 4, k + ' camel fully on screen at rest');
  assert.ok(p.y >= 4 && p.y + p.h <= VH - 4, k + ' camel inside viewport vertically');
  // camel overlaps the seat band vertically (it walks *to* the profile)
  assert.ok(p.y < s.pod.top + s.pod.height && p.y + p.h > s.pod.top, k + ' camel at the seat row');
  // garland centred on the avatar; petals start above and fall past it, staying on screen
  assert.equal(p.cx, s.av.left + s.av.width / 2); assert.equal(p.cy, s.av.top + s.av.height / 2);
  assert.ok(p.petalTop < s.av.top && p.petalTop + p.petalFall > s.av.top + s.av.height, k + ' petals fall over the avatar');
  assert.ok(p.petalCx - p.petalSpread >= 0 && p.petalCx + p.petalSpread <= VW, k + ' petal band on screen');
  assert.ok(p.walkMs >= 1500 && p.walkMs <= 2800, k + ' walk duration bounded');
}
console.log('  ok - camel path toward every seat (TL/TR/BR/BL): enters off-screen, faces & stops beside the avatar');

// tablet / landscape sanity
const wide = C.plan({ left: 900, top: 40, width: 260, height: 70 }, { left: 1090, top: 50, width: 50, height: 50 }, 1280, 800);
assert.equal(wide.side, 'right'); assert.ok(wide.x1 + wide.w <= 1090 && wide.w <= 170);
console.log('  ok - large screens keep the camel size capped and beside the avatar');

// Art: original, inline SVG; no emoji glyphs, external images or trademark cues
const svg = C.camelSVG();
assert.match(svg, /^<svg class="cc-camel-svg"/);
for (const part of ['cc-leg', 'cc-bob', 'cc-head', 'cc-rider', 'cc-wave']) assert.ok(svg.includes(part), 'svg has ' + part);
assert.doesNotMatch(svg, /<image|href=|xlink/);
assert.match(C.roseSVG(), /<svg class="cc-rose"/);
assert.doesNotMatch(cel + css, /ludo\s*star|yalla/i);
assert.doesNotMatch(game, /ludo\s*star|yalla/i);
console.log('  ok - original inline SVG camel (legs, bob, head bow, rider wave) + roses; no Ludo Star / Yalla cues');

// WebView-safe: fixed overlay, pointer-events none, transform/opacity keyframes, reduced motion
assert.match(css, /\.camel-cel \{ position: fixed; inset: 0; z-index: 75; pointer-events: none;/);
assert.match(css, /@keyframes cc-walk \{ from \{ transform: translate3d\(var\(--x0\)/);
assert.match(css, /@keyframes cc-petal/);
const kf = css.slice(css.indexOf('v1.6.3 · Gulaab Camel'));
const props = [...kf.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\}\s*\n?(?=@keyframes|\.|\/\*|$)/g)].map(m => m[1]).join(' ');
assert.doesNotMatch(props, /\b(left|top|width|height|margin)\s*:/, 'keyframes animate transform/opacity only');
assert.match(kf, /@media \(prefers-reduced-motion: reduce\) \{\s*\.camel-cel \.cc-walker, \.camel-cel \.cc-petals \{ display: none !important; \}/);
assert.match(cel, /prefers-reduced-motion: reduce/);
console.log('  ok - fixed pointer-events:none overlay, transform/opacity keyframes, prefers-reduced-motion static roses');

// Wiring: every result screen (all offline modes, human or AI winner) + online classic + online chess
assert.match(game, /if \(entering\) \{ spotlightWinner\(winner\); celebrateWin\(winner\); \}/);
assert.match(game, /function celebrateWin\(seat\)[\s\S]*?var pod = podEl\(seat\)[\s\S]*?C\.play\(\{ target: pod, anchor: pod\.querySelector\('\.avatar'\) \|\| pod/);
assert.match(game, /st\.phase === 'over' && st\.ranking\.length\)[\s\S]*?celebrateWin\(st\.ranking\[0\]\)/);
assert.match(game, /function leaveResult\(dest\) \{\s*if \(!G \|\| G\.st\.phase !== 'over'\) return;\s*stopCelebration\(\);/);
assert.match(game, /function startMatch\(seats, mode, offerTutorial\) \{\s*cancelFlow\(\); stopCelebration\(\);/);
assert.match(online, /function celebrateChessWin\(state, room\)/);
assert.match(online, /celebrateChessWin\(state, room\);/);
console.log('  ok - wired into showResult (all modes), online classic over-state and online chess decisive results');

// Celebration is cosmetic: it never edits game state or rewards
const celBody = game.slice(game.indexOf('function celebrateWin'), game.indexOf('function stopCelebration'));
assert.doesNotMatch(celBody, /save\.|G\.st\.\w+\s*=|persist\(|coins|xp/);
assert.doesNotMatch(cel, /LudoLogic|localStorage|__cf/);
console.log('  ok - celebration touches no game state, saves or rewards');

// Existing features still present
assert.match(game, /DANGER_FILL = '#d23a30'/);
assert.match(game, /function showDiePick/);
assert.match(game, /Yard pads: inset wells/);
assert.match(game, /function spotlightWinner/);
console.log('  ok - arrow danger, die picker, yard pads, confetti spotlight unchanged');

console.log('camel-celebration checks passed');
