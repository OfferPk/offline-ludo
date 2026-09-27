// Headless Chrome phone test (360x640, touch). Plays real matches through the UI and fails on any console error.
// Usage: PUPPETEER=puppeteer-core node test/browser.test.js <url> [screenshot dir]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const OUT = process.argv[3] || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
function ok(cond, msg) { if (!cond) throw new Error('FAILED: ' + msg); n++; console.log('  ok -', msg); }

(async () => {
  console.log('Testing', URL);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  page.on('dialog', d => d.dismiss());
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const visible = sel => ev(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.offsetParent !== null; }, sel);
  async function waitFor(fn, ms, what, ...args) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) { if (await ev(fn, ...args)) return true; await sleep(60); }
    throw new Error('timeout waiting for ' + what);
  }
  const idleHuman = (phase) => waitFor((ph) => { const c = window.__cf, g = c.game; return g && c.idle && !c.busy && g.st.seats[g.st.turn].type === 'human' && g.st.phase === ph; }, 15000, 'human ' + phase, phase);
  const st = () => ev(() => { const g = window.__cf.game; return g ? JSON.parse(JSON.stringify(g.st)) : null; });
  async function tapPiece(seat, i) { const p = await ev((s, k) => window.__cf.piecePoint(s, k), seat, i); await page.touchscreen.tap(p.x, p.y); }
  const setPieces = (seat, arr) => ev((s, a) => { window.__cf.game.st.pieces[s] = a; window.__cf.layout(); }, seat, arr);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await ev(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
  ok(await visible('#home') && !(await visible('#btn-continue')), 'home on launch, nothing to continue');
  ok((await ev(() => window.__cf.gate.state.sessions)) === 1, 'first session counted');
  await page.screenshot({ path: OUT + '/cf-home.png' });

  // ---------- setup ----------
  await page.tap('#btn-vs-ai'); await sleep(200);
  ok(await visible('#setup'), 'setup screen');
  await ev(() => document.querySelector('.seg button[data-seat="1"][data-v="off"]').click());
  ok(await ev(() => document.getElementById('btn-start').disabled && /at least 2/.test(document.getElementById('setup-msg').textContent)), 'needs at least 2 players');
  await ev(() => document.querySelector('.seg button[data-seat="3"][data-v="hard"]').click());
  await ev(() => document.querySelector('.seg button[data-seat="1"][data-v="hard"]').click());
  ok(await ev(() => document.getElementById('btn-start').disabled && /human/.test(document.getElementById('setup-msg').textContent)), 'needs a human player');
  await ev(() => document.querySelector('.seg button[data-seat="3"][data-v="human"]').click());
  ok(!(await ev(() => document.getElementById('btn-start').disabled)), 'You (Cobalt) vs Jade (Hard AI) is valid');
  await page.tap('#btn-start'); await sleep(400);
  ok(await visible('#game') && await visible('#board'), 'match started, board drawn');
  let s = await st();
  ok(s.players.join() === '1,3' && s.seats[1].level === 'hard' && s.seats[3].type === 'human', '2 players: Jade Hard AI, Cobalt human');
  ok(await ev(() => document.querySelectorAll('.pc').length === 8), '8 pieces on the board');
  const bw = await ev(() => { const r = document.getElementById('board-wrap').getBoundingClientRect(); const d = document.getElementById('dice').getBoundingClientRect(); return { b: r.bottom, w: r.width, d: d.bottom }; });
  ok(bw.w >= 280 && bw.d <= 640, 'board ' + Math.round(bw.w) + 'px and the die fit the phone screen');
  await ev(() => { window.__cf.save.settings.fast = true; });

  // ---------- turns, 6 to leave base, AI plays ----------
  await waitFor(() => { const g = window.__cf.game; return g.st.turn === 3 || g.st.rolls > 0; }, 15000, 'first turns');
  await idleHuman('roll');
  await ev(() => window.__cf.force([3])); await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.turn === 1 || window.__cf.game.st.rolls > 1, 5000, 'turn passes');
  ok(true, 'a 3 with all pieces in base: no move, turn passes to the AI');
  await idleHuman('roll');
  ok((await st()).rolls >= 2, 'AI took its turn automatically');
  await setPieces(1, [-1, -1, -1, -1]); await setPieces(3, [-1, -1, -1, -1]);
  await ev(() => window.__cf.force([6, 2])); await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.pieces[3].some(p => p === 0), 5000, 'leave base');
  ok(true, 'a 6 brings a piece out (auto-move: only one distinct move)');
  await idleHuman('roll');
  s = await st(); ok(s.turn === 3, '6 gives an extra roll');
  await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.pieces[3].some(p => p === 2), 5000, 'step 2');
  ok(true, 'piece stepped 2 squares (auto-move)');
  await page.screenshot({ path: OUT + '/cf-play.png' });

  // ---------- choice between pieces + capture ----------
  await idleHuman('roll');
  await setPieces(3, [20, 30, -1, -1]); await setPieces(1, [49, -1, -1, -1]); // Jade p49 = abs 10; Cobalt p20 = abs 7
  await ev(() => window.__cf.force([3])); await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.phase === 'move' && window.__cf.idle, 5000, 'move choice');
  ok(await ev(() => document.querySelectorAll('.pc.can').length === 2), 'two movable pieces highlighted');
  await tapPiece(3, 0);
  await waitFor(() => window.__cf.game.st.pieces[1][0] === -1, 5000, 'capture');
  ok((await st()).pieces[3][0] === 23, 'tapped piece moved 3 and captured the AI piece (sent to base)');
  await waitFor(() => document.querySelectorAll('#fx .burst, #fx .ring, #fx .float').length > 0, 3000, 'capture effect');
  ok(true, 'capture effect shown (burst, ring, "Captured!")');
  await idleHuman('roll');
  ok((await st()).turn === 3, 'capture gives an extra roll');

  // ---------- undo vs AI (rewarded; the web build grants it) ----------
  await setPieces(3, [23, 30, -1, -1]);
  await ev(() => window.__cf.force([4])); await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.phase === 'move' && window.__cf.idle, 5000, 'move');
  await tapPiece(3, 1);
  await waitFor(() => window.__cf.game.st.pieces[3][1] === 34, 5000, 'moved');
  await waitFor(() => !document.getElementById('btn-undo').disabled, 3000, 'undo enabled');
  ok(await visible('#btn-undo'), 'Undo (▶ ad) offered after your move vs AI');
  await page.tap('#btn-undo');
  await waitFor(() => { const g = window.__cf.game; return g.st.turn === 3 && g.st.phase === 'move' && g.st.pieces[3][1] === 30; }, 5000, 'undo');
  ok((await ev(() => window.__cf.game.undoLeft)) === 2, 'undo restored the position before your move (same roll, pick again)');
  await waitFor(() => window.__cf.idle, 3000, 'idle'); await tapPiece(3, 0);
  await waitFor(() => window.__cf.game.st.pieces[3][0] === 27, 5000, 'other piece');
  ok(true, 'picked the other piece instead');

  // ---------- exact roll + triple six ----------
  await idleHuman('roll');
  await setPieces(3, [56, 56, 56, 53]); await setPieces(1, [5, -1, -1, -1]);
  await ev(() => window.__cf.force([4])); await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.turn === 1, 5000, 'overshoot passes');
  ok((await st()).pieces[3][3] === 53, 'overshooting home is not allowed (exact roll)');
  await idleHuman('roll');
  await setPieces(3, [56, 56, 56, 5]); await setPieces(1, [-1, -1, -1, -1]);
  await ev(() => window.__cf.force([6, 6, 6])); await page.tap('#dice');
  await idleHuman('roll'); await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.pieces[3][3] === 17 && window.__cf.idle, 5000, 'two sixes');
  ok(await ev(() => document.querySelectorAll('#sixes i.on').length === 2), 'sixes counter shows 2');
  await page.tap('#dice');
  await waitFor(() => window.__cf.game.st.turn === 1, 5000, 'forfeit');
  ok((await st()).pieces[3][3] === 17, 'third 6 in a row forfeits the turn');

  // ---------- save / resume ----------
  await idleHuman('roll');
  const before = await st();
  await page.tap('#btn-home'); await sleep(200);
  ok(await visible('#menu'), 'menu pauses the match');
  await page.tap('#btn-m-home'); await sleep(200);
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
  ok(await visible('#btn-continue'), 'home offers Continue after reload');
  ok((await ev(() => window.__cf.gate.state.sessions)) === 2, 'second session counted');
  await page.tap('#btn-continue'); await sleep(400);
  const after = await st();
  ok(JSON.stringify(after.pieces) === JSON.stringify(before.pieces) && after.turn === before.turn, 'pieces and turn restored');
  await ev(() => { window.__cf.save.settings.fast = true; });

  // ---------- finish the match ----------
  await idleHuman('roll');
  await setPieces(3, [56, 56, 56, 55]);
  await ev(() => window.__cf.force([1])); await page.tap('#dice');
  await waitFor(() => !document.getElementById('result').classList.contains('hidden'), 8000, 'result');
  ok(/You win/.test(await ev(() => document.getElementById('r-title').textContent)), 'result: You win!');
  const coins = await ev(() => window.__cf.save.coins);
  ok(coins === 50, 'coins +50 (1st place vs Hard AI)');
  ok((await ev(() => window.__cf.gate.state.matchesCompleted)) === 1, 'ad gate counted the match');
  await page.screenshot({ path: OUT + '/cf-result.png' });
  await page.tap('#btn-r-double'); await sleep(200);
  ok((await ev(() => window.__cf.save.coins)) === 100 && !(await visible('#btn-r-double')), '2x coins (rewarded) doubled the coins once');
  ok(!(await ev(() => window.__cf.gate.canShow(Date.now()))), 'no interstitial before 3 matches + 3 minutes');
  await page.tap('#btn-r-home'); await sleep(400);
  ok(await visible('#home') && !(await visible('#btn-continue')), 'Home after the match; nothing to continue');

  // ---------- rule toggles + pass & play ----------
  await page.tap('#btn-pass'); await sleep(200);
  ok((await ev(() => [...document.querySelectorAll('.seg button.on')].map(b => b.dataset.v).join())) === 'off,human,human,off', 'pass & play setup: two humans (Jade, Cobalt)');
  await ev(() => { document.getElementById('rule-six').click(); });
  ok(!(await ev(() => window.__cf.save.setup.rules.extraOnSix)), 'extra turn on 6 switched off');
  await page.tap('#btn-start'); await sleep(400);
  s = await st();
  ok(s.seats.filter(Boolean).every(x => x.type === 'human') && !s.rules.extraOnSix, 'pass & play match with the rule off');
  ok(!(await visible('#btn-undo')), 'no Undo ad in pass & play (only vs AI)');
  await ev(() => { window.__cf.save.settings.fast = true; });
  const first = s.turn;
  await idleHuman('roll'); await ev(() => window.__cf.force([6])); await page.tap('#dice');
  await waitFor((f) => window.__cf.game.st.turn !== f, 5000, 'turn passes after a 6', first);
  ok(true, 'with the rule off, a 6 moves a piece and the turn passes to the other human');
  await page.screenshot({ path: OUT + '/cf-pass.png' });

  // ---------- skins ----------
  await page.tap('#btn-home'); await sleep(150); await page.tap('#btn-m-home'); await sleep(200);
  await ev(() => { window.__cf.save.coins = 700; });
  await page.tap('#btn-skins'); await sleep(250);
  await ev(() => [...document.querySelectorAll('#skin-grid .skin')].find(e => e.dataset.id === 'walnut').querySelector('button').click());
  ok((await ev(() => window.__cf.save.board)) === 'walnut' && (await ev(() => window.__cf.save.coins)) === 450, 'bought and applied the Walnut board (250 coins)');
  await ev(() => document.querySelector('#skin-tabs [data-tab="dice"]').click()); await sleep(100);
  await ev(() => [...document.querySelectorAll('#skin-grid .skin')].find(e => e.dataset.id === 'onyx').querySelector('button').click());
  ok((await ev(() => window.__cf.save.dice)) === 'onyx' && (await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--d-face').trim())) === '#23272f', 'bought and applied Onyx dice');
  await ev(() => document.querySelector('[data-close="skins"]').click());

  // ---------- settings ----------
  await page.tap('#btn-settings'); await sleep(200);
  await ev(() => document.getElementById('set-sound').click());
  ok((await ev(() => window.__cf.save.settings.sound)) === false, 'sound toggle');
  await ev(() => document.querySelector('[data-close="settings"]').click());

  await sleep(300);
  ok(errors.length === 0, 'no console errors / failed requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`BROWSER TEST PASSED (${n} checks)`);
  await browser.close();
})().catch(async e => { console.error('BROWSER TEST FAILED:', e.message); process.exit(1); });
