// v1.7.1 Token Evolution: levels, unlock (coins/wins), selection, version + non-regression.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Evo = require('../www/js/token-evolution.js');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('www/index.html');
const css = read('www/css/style.css');
const game = read('www/js/game.js');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
const celebration = read('www/js/celebration.js');
const ads = read('www/js/ads-config.js');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('  ok -', m); };

console.log('token-evolution.test.js');

ok(pkg.version === '1.7.1', 'package version 1.7.1');
ok(/versionCode 25/.test(gradle) && /versionName "1\.7\.1"/.test(gradle), 'gradle versionCode 25 / 1.7.1');
ok(/Crossfour v1\.7\.1/.test(html) && /css\/style\.css\?v=1\.7\.1/.test(html), 'footer + asset cache-bust 1.7.1');
ok(/token-evolution\.js\?v=1\.7\.1/.test(html), 'token-evolution.js script tagged');
ok(/data-tab="tokens"/.test(html) && />Tokens</.test(html), 'Skins Tokens tab present');

ok(Evo.maxLevel === 5 && Evo.LEVELS.length === 5, '5 evolution levels');
ok(Evo.LABELS.join(',') === 'Basic,Polished,Elite,Mythic,Legendary', 'level labels');
ok(Evo.LEVELS.every((l, i) => l.level === i + 1 && l.gloss >= 1 && l.glow >= 1), 'monotonic cosmetic multipliers');
ok(Evo.LEVELS[0].coinCost === 0 && Evo.LEVELS[0].winsRequired === 0, 'Lv1 free');
ok(Evo.LEVELS[3].badge && Evo.LEVELS[4].badge && !Evo.LEVELS[0].badge, 'badge from Mythic+');
ok(Evo.LEVELS.every(l => l.particles >= 0 && l.particles <= 5), 'particle counts in range');

function save(partial) {
  return Object.assign({ coins: 0, tokenEvo: 1, tokenEvoUnlocked: 1, stats: { won: 0 } }, partial);
}
function persistOk() { return true; }

ok(Evo.normalize(save()).unlocked === 1 && Evo.normalize(save()).selected === 1, 'default normalize Lv1');
ok(Evo.normalize(save({ tokenEvo: 4, tokenEvoUnlocked: 2 })).selected === 2, 'selected clamped to unlocked');

{
  const s = save({ coins: 199, stats: { won: 2 } });
  const g = Evo.canUnlockNext(s);
  ok(!g.ok && g.needCoins === 1 && g.needWins === 1, 'Lv2 locked without coins or wins');
}
{
  const s = save({ coins: 200, stats: { won: 0 } });
  const r = Evo.unlockNext(s, persistOk);
  ok(r.ok && r.level === 2 && r.spent === 200 && !r.free && s.coins === 0 && s.tokenEvoUnlocked === 2, 'Lv2 unlock via coins');
}
{
  const s = save({ coins: 0, stats: { won: 3 } });
  const r = Evo.unlockNext(s, persistOk);
  ok(r.ok && r.free && r.spent === 0 && s.tokenEvo === 2, 'Lv2 unlock free via wins');
}
{
  const s = save({ coins: 5000, stats: { won: 100 }, tokenEvoUnlocked: 1, tokenEvo: 1 });
  const granted = Evo.collectEligible(s);
  ok(granted.length === 4 && s.tokenEvoUnlocked === 5 && granted[3].name === 'Legendary', 'collectEligible free path to Legendary');
  ok(s.coins === 5000, 'win unlocks do not spend coins');
}
{
  const s = save({ tokenEvoUnlocked: 3, tokenEvo: 3 });
  const r = Evo.select(s, 1, persistOk);
  ok(r.ok && s.tokenEvo === 1, 'can select lower unlocked level');
  ok(Evo.select(s, 5, persistOk).reason === 'not-unlocked', 'cannot select locked level');
}
{
  const s = save({ coins: 200 });
  const failed = Evo.unlockNext(s, () => false);
  ok(failed.reason === 'save-failed' && s.coins === 200 && s.tokenEvoUnlocked === 1, 'rollback on save failure');
}

ok(/TOKEN_EVOLUTION/.test(game) && /evoLevelForSeat/.test(game) && /renderTokenEvolution/.test(game), 'game wires evolution');
ok(/tokenEvo: 1, tokenEvoUnlocked: 1/.test(game), 'save defaults include evo fields');
ok(/dataset\.evo = String\(evoLv\)/.test(game), 'dataset.evo applied from selected level');
ok(/evo-badge/.test(game) && /hopStepFx\(/.test(game), 'badge + hop particles wired');
ok(/data-evo="5"/.test(css) && /\.pc \.evo-badge/.test(css) && /\.evo-prev/.test(css), 'CSS Lv1–5 + badge + skins preview');

// Non-regression
ok(/MOVE_DECIDE_MS = 4000/.test(game) && /function showDiePick/.test(game), 'die picker + 4s timer intact');
ok(/CamelCelebration|celebrateWin/.test(game) && /function play\(/.test(celebration), 'camel celebration kept');
ok(/ca-app-pub-3940256099942544/.test(ads) && /IS_TESTING: true/.test(ads), 'ads test IDs intact');
ok(/DANGER_FILL = '#d23a30'/.test(game), 'arrow danger intact');
ok(/G\.online/.test(game) && /paintOnlineChrome|online-turn-timer/.test(game), 'online paths intact');
ok(!/Ludo Star|Yalla|yalla|ludostar/i.test(game + css + read('www/js/token-evolution.js')), 'no Ludo Star / Yalla names');

console.log('token-evolution checks passed (' + checks + ' checks).');
