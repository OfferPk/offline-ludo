// Unit tests for the interstitial frequency rules. Run: node test/adgate.test.js
const assert = require('assert');
const fs = require('fs');
const AdGate = require('../www/js/adgate.js');
// load the shipped browser config (it assigns window.ADS_CONFIG)
const vm = require('vm'); const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/../www/js/ads-config.js', 'utf8'), sandbox);
const CFG = sandbox.window.ADS_CONFIG;
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', e.message); } }
const MIN = 60000;
const fresh = () => AdGate.create(CFG, {});
const secondSession = () => { const g = fresh(); g.sessionStarted(); g.sessionStarted(); return g; };

console.log('adgate.test.js');
t('shipped config: 2nd session, 5 matches, 3 min, every 2 matches, 120 s', () => {
  assert.strictEqual(CFG.INTERSTITIAL_MIN_SESSIONS, 2); assert.strictEqual(CFG.INTERSTITIAL_MIN_MATCHES, 5);
  assert.strictEqual(CFG.INTERSTITIAL_MIN_PLAY_MS, 3 * MIN); assert.strictEqual(CFG.INTERSTITIAL_EVERY_N_MATCHES, 2);
  assert.strictEqual(CFG.INTERSTITIAL_MIN_INTERVAL_MS, 120000);
});
t('never on a fresh install (launch)', () => { const g = fresh(); g.sessionStarted(); assert.strictEqual(g.canShow(Date.now()), false); });
t('never in the first session, however many matches and minutes', () => {
  const g = fresh(); g.sessionStarted();
  for (let i = 0; i < 20; i++) { g.matchCompleted(); for (let k = 0; k < 60; k++) g.addPlayTime(1000); assert.strictEqual(g.canShow(1e12 + i * 10 * MIN), false); }
  g.sessionStarted(); assert.strictEqual(g.canShow(2e12), true, 'allowed from the 2nd launch');
});
t('not before 5 completed matches even with lots of play time', () => {
  const g = secondSession(); for (let i = 0; i < 40; i++) g.addPlayTime(30000);
  for (let m = 1; m <= 4; m++) { g.matchCompleted(); assert.strictEqual(g.canShow(1e12), false, 'after ' + m + ' matches'); }
  g.matchCompleted(); assert.strictEqual(g.canShow(1e12), true);
});
t('not before 3 minutes of play even after many matches', () => {
  const g = secondSession(); for (let i = 0; i < 10; i++) g.matchCompleted();
  for (let s = 0; s < 179; s++) g.addPlayTime(1000);
  assert.strictEqual(g.canShow(1e12), false);
  g.addPlayTime(1000); assert.strictEqual(g.canShow(1e12), true);
});
t('play-time ignores bogus deltas (negative / huge)', () => { const g = fresh(); g.addPlayTime(-5); g.addPlayTime(10 * MIN); assert.strictEqual(g.state.playMs, 0); });
function eligible() { const g = secondSession(); for (let i = 0; i < 5; i++) g.matchCompleted(); for (let i = 0; i < 180; i++) g.addPlayTime(1000); return g; }
t('after one ad: needs 2 more completed matches', () => {
  const g = eligible(); let now = 1e9;
  assert.ok(g.canShow(now)); g.shown(now); now += 10 * MIN;
  g.matchCompleted(); assert.strictEqual(g.canShow(now), false);
  g.matchCompleted(); assert.strictEqual(g.canShow(now), true);
});
t('at most one per 120 s even if matches are quick', () => {
  const g = eligible(); const now = 1e9; g.shown(now);
  for (let i = 0; i < 6; i++) g.matchCompleted();
  assert.strictEqual(g.canShow(now + 30000), false); assert.strictEqual(g.canShow(now + 119999), false); assert.strictEqual(g.canShow(now + 120000), true);
});
t('abandoned matches do not count', () => {
  const g = eligible(); const now = 1e9; g.shown(now);
  for (let i = 0; i < 10; i++) assert.strictEqual(g.canShow(now + 10 * MIN), false);
});
t('clock moving backwards resets the interval instead of blocking forever', () => {
  const g = eligible(); g.shown(2e9); for (let i = 0; i < 2; i++) g.matchCompleted();
  assert.strictEqual(g.canShow(1e9), false); assert.strictEqual(g.canShow(1e9 + 120000), true);
});
t('state persists through JSON round trip (sessions included)', () => {
  const g = eligible(); g.shown(1e9); g.matchCompleted();
  const g2 = AdGate.create(CFG, JSON.parse(JSON.stringify(g.state)));
  assert.strictEqual(g2.state.sessions, 2); assert.strictEqual(g2.state.matchesCompleted, 6); assert.strictEqual(g2.state.matchesSince, 1); assert.strictEqual(g2.state.playMs, 180000);
  g2.matchCompleted(); assert.strictEqual(g2.canShow(1e9 + 120000), true);
});
t('corrupt saved state is repaired', () => { const g = AdGate.create(CFG, { sessions: 'x', playMs: null, lastTs: NaN }); assert.strictEqual(g.state.sessions, 0); assert.strictEqual(g.state.playMs, 0); assert.strictEqual(g.state.lastTs, 0); });
t('simulated player: 2 sessions of quick matches, ads only on qualifying match ends', () => {
  const g = fresh(); let now = 1e9, shown = [];
  for (let session = 1; session <= 2; session++) {
    g.sessionStarted();
    for (let m = 1; m <= 12; m++) {
      for (let s = 0; s < 70; s++) { g.addPlayTime(1000); now += 1000; } // 70 s matches
      g.matchCompleted();
      if (g.canShow(now)) { g.shown(now); shown.push({ session, n: g.state.matchesCompleted, now }); }
    }
  }
  assert.ok(shown.length > 0); assert.ok(shown.every(x => x.session === 2));
  for (let i = 1; i < shown.length; i++) { assert.ok(shown[i].n - shown[i - 1].n >= 2); assert.ok(shown[i].now - shown[i - 1].now >= 120000); }
});

// ---- static checks on the game code ----
const game = fs.readFileSync(__dirname + '/../www/js/game.js', 'utf8');
t('game.js asks for an interstitial in exactly one place: leaving the match-result screen', () => {
  const calls = game.match(/maybeInterstitial\(/g) || []; assert.strictEqual(calls.length, 1);
  const i = game.indexOf('maybeInterstitial('); const fn = game.lastIndexOf('function ', i); assert.ok(/function leaveResult/.test(game.slice(fn, fn + 40)));
  assert.ok(!/showInterstitial/.test(game), 'no direct interstitial calls');
  const uses = game.match(/leaveResult\(/g) || []; assert.strictEqual(uses.length, 3, 'definition + 2 buttons');
  assert.ok(/btn-r-again'\)\.addEventListener\('click', function \(\) \{ leaveResult\('again'\)/.test(game) && /btn-r-home'\)\.addEventListener\('click', function \(\) \{ leaveResult\('home'\)/.test(game));
  assert.ok(/function leaveResult[\s\S]{0,400}phase !== 'over'/.test(game), 'guards: only when the match is over');
});
t('the session counter is bumped once at boot', () => { assert.strictEqual((game.match(/gate\.sessionStarted\(\)/g) || []).length, 1); });
t('matchCompleted is counted in one place (match end)', () => { assert.strictEqual((game.match(/gate\.matchCompleted\(\)/g) || []).length, 1); });
t('rewarded ads only from the Undo-roll and 2x-coins buttons (player taps)', () => {
  const calls = game.match(/Ads\.showRewarded\(/g) || []; assert.strictEqual(calls.length, 2);
  assert.ok(/function undoRoll[\s\S]{0,1200}Ads\.showRewarded\(/.test(game)); assert.ok(/function doubleCoins[\s\S]{0,600}Ads\.showRewarded\(/.test(game));
  assert.ok(/btn-undo'\)\.addEventListener\('click', undoRoll\)/.test(game) && /btn-r-double'\)\.addEventListener\('click', doubleCoins\)/.test(game));
});
t('no billing anywhere in the app', () => {
  const pkg = fs.readFileSync(__dirname + '/../package.json', 'utf8'); const man = fs.readFileSync(__dirname + '/../android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.ok(!/billing|purchase/i.test(pkg + man + game));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
