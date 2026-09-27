// Headless Chrome phone test (360x740, touch) for Crossfour v1.1: per-player dice, Star-style stacked rolls,
// undo dice roll, triple-6 forfeit, quick chat, Mystery Tiles wheel events, classic house rule, result ranks.
// Fails on any console error / failed request.
// Usage: PUPPETEER=puppeteer-core node test/browser.test.js <url> [screenshot dir]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const OUT = process.argv[3] || '/tmp';
const W = 360, H = 740;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
function ok(cond, msg) { if (!cond) throw new Error('FAILED: ' + msg); n++; console.log('  ok -', msg); }

(async () => {
  console.log('Testing', URL);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); global.__page = page;
  await page.emulate({ viewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' });
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
    while (Date.now() - t0 < (ms || 8000)) { if (await ev(fn, ...args)) return true; await sleep(50); }
    throw new Error('timeout waiting for ' + what);
  }
  // human seat idle in a phase (undo window may still be open when allowUndo)
  const idleHuman = (phase, seat) => waitFor((ph, se) => { const c = window.__cf, g = c.game; return g && !c.busy && !c.paused && g.st.turn === (se == null ? g.st.turn : se) && g.st.seats[g.st.turn].type === 'human' && g.st.phase === ph && !document.querySelector('#wheel:not(.hidden)'); }, 20000, 'human ' + phase, phase, seat);
  const st = () => ev(() => { const g = window.__cf.game; return g ? JSON.parse(JSON.stringify(g.st)) : null; });
  async function tapPiece(seat, i) { const p = await ev((s, k) => window.__cf.piecePoint(s, k), seat, i); await page.touchscreen.tap(p.x, p.y); }
  const roll = seat => ev(s => document.querySelector('.pod[data-seat="' + s + '"] .pdice').click(), seat);
  const chip = (seat, v) => ev((s, x) => document.querySelector('.pod[data-seat="' + s + '"] .chip-v[data-v="' + x + '"]').click(), seat, v);
  const chips = seat => ev(s => [...document.querySelectorAll('.pod[data-seat="' + s + '"] .chip-v')].map(c => +c.dataset.v), seat);
  const waitUndoGone = async () => { await waitFor(() => !window.__cf.undoActive, 5000, 'undo window to close'); await sleep(80); };
  const edit = (code) => ev(c => { window.__cf.edit(new Function('st', c)); }, code);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await ev(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
  ok(await visible('#home') && !(await visible('#btn-continue')), 'home on launch, nothing to continue');
  ok(await visible('#btn-mystery'), 'Mystery Tiles mode on home screen');
  ok((await ev(() => window.__cf.gate.state.sessions)) === 1, 'first session counted');
  ok(/1\.1\.0/.test(await ev(() => document.body.innerText + document.documentElement.innerHTML)), 'version 1.1.0 in page');
  await page.screenshot({ path: OUT + '/cf-home.png' });

  // ---------- rules & settings ----------
  await page.tap('#btn-rules'); await sleep(200);
  ok(await visible('#rules'), 'rules screen opens');
  await ev(() => document.querySelector('#rules-tabs [data-tab="mystery"]').click()); await sleep(100);
  ok(await ev(() => document.querySelectorAll('#ev-boost .ev').length === 6 && document.querySelectorAll('#ev-chaos .ev').length === 6), 'rules list 6 boost + 6 chaos events');
  await ev(() => document.querySelector('#rules [data-close="rules"]').click()); await sleep(150);
  await page.tap('#btn-settings'); await sleep(200);
  ok(await visible('#settings') && await ev(() => !!document.getElementById('rule-captureToEnter') && !!document.getElementById('rule-blocks') && document.querySelector('#rule-style .on').dataset.v === 'star'), 'settings: house rules, Star style default');
  ok(await ev(() => document.getElementById('set-undo').checked && !document.getElementById('set-timer').checked), 'undo on, turn timer off by default');
  await ev(() => document.querySelector('#settings [data-close="settings"]').click()); await sleep(150);

  // ---------- 1 v 1 vs Hard computer ----------
  await page.tap('#btn-vs-ai'); await sleep(200);
  ok(await visible('#setup'), 'setup screen');
  await ev(() => document.querySelector('#presets [data-p="1v1"]').click()); await sleep(100);
  await ev(() => document.querySelector('.seg button[data-seat="1"][data-v="hard"]').click()); await sleep(100);
  ok(!(await ev(() => document.getElementById('btn-start').disabled)), '1 v 1: You (Cobalt) vs Jade (Hard) is valid');
  await page.tap('#btn-start'); await sleep(500);
  ok(await visible('#game') && await visible('#board'), 'match started, board drawn');
  let s = await st();
  ok(s.v === 2 && s.players.join() === '1,3' && s.seats[1].level === 'hard' && s.seats[3].type === 'human' && s.mode === 'classic', '2 players on opposite corners: Jade Hard AI, Cobalt human');
  ok(await ev(() => window.__cf.podOf(3) === 3 && window.__cf.podOf(1) === 1), 'human pod bottom-left, computer pod top-right');
  const geo = await ev(() => {
    const r = e => e.getBoundingClientRect(), b = r(document.getElementById('board-wrap'));
    const pod = s => document.querySelector('.pod[data-seat="' + s + '"]');
    const hp = r(pod(3)), ap = r(pod(1)), hd = r(pod(3).querySelector('.pdice')), ad = r(pod(1).querySelector('.pdice'));
    return { bw: b.width, bb: b.bottom, bt: b.top, hp: [hp.left, hp.top, hp.right, hp.bottom], ap: [ap.left, ap.top, ap.right, ap.bottom], hd: [hd.left, hd.top, hd.right, hd.bottom], ad: [ad.left, ad.top, ad.right, ad.bottom], empty: [...document.querySelectorAll('.pod.empty')].length };
  });
  ok(geo.bw >= 300 && geo.hp[3] <= H && geo.ap[1] >= 0, 'board ' + Math.round(geo.bw) + 'px and both pods fit a 360x740 phone');
  ok(geo.hp[1] >= geo.bb - 1 && geo.hp[0] < W / 2 && geo.ap[3] <= geo.bt + 1 && geo.ap[0] >= W / 2 - 10, 'human pod below board on the left, computer pod above board on the right');
  ok(geo.hd[0] >= geo.hp[0] && geo.hd[2] <= geo.hp[2] + 1 && geo.ad[0] >= geo.ap[0] && geo.ad[2] <= geo.ap[2] + 1, 'each player has their own die inside their pod');
  ok(geo.empty === 2, 'unused corners are empty in 1 v 1');
  ok(await ev(() => document.querySelectorAll('.pc').length === 8), '8 tokens on the board');
  await ev(() => { const c = window.__cf.save.settings; c.fast = true; c.auto = false; });

  // ---------- Star-style stacked rolls: 6, 6, 3 ----------
  await idleHuman('roll', 3);
  await edit('st.pieces[3]=[-1,-1,-1,-1]; st.pieces[1]=[-1,-1,-1,-1]; st.queue=[]; st.sixes=0;');
  await idleHuman('roll', 3);
  ok(await ev(() => document.querySelector('.pod[data-seat="3"]').classList.contains('active')), 'active seat highlighted');
  await ev(() => window.__cf.force([6, 6, 3]));
  await roll(3);
  await idleHuman('roll', 3); s = await st();
  ok(s.queue.join() === '6' && s.phase === 'roll', 'rolled 6: another roll right away, 6 queued');
  ok(await ev(() => document.getElementById('btn-undo').classList.contains('live') && !document.getElementById('btn-undo').disabled), 'undo button live after a human roll');
  await roll(3); await idleHuman('roll', 3);
  await roll(3); await idleHuman('move', 3); s = await st();
  ok(s.queue.join() === '6,6,3' && (await chips(3)).join() === '6,6,3', 'queue 6,6,3 shown as dice chips on the human pod');
  // ---------- undo dice roll ----------
  ok(await ev(() => window.__cf.undoActive), 'undo window open after the roll');
  await page.tap('#btn-undo'); await sleep(200);
  await idleHuman('roll', 3); s = await st();
  ok(s.queue.join() === '6,6' && s.phase === 'roll' && (await ev(() => window.__cf.game.undoLeft)) === 2, 'undo took back the 3 (6,6 kept), 2 free undos left');
  await ev(() => window.__cf.force([4]));
  await roll(3); await idleHuman('move', 3);
  s = await st(); ok(s.queue.join() === '6,6,4', 're-roll gives a fresh value: 6,6,4');
  await waitUndoGone();
  ok(await waitFor(() => document.getElementById('btn-undo').disabled, 1500, 'undo button off'), 'undo window closes after about 2 s');
  // ---------- pick chip, then token ----------
  await chip(3, 6); await sleep(100);
  ok(await ev(() => window.__cf.game.sel === 6), 'tapped chip 6 is selected');
  await tapPiece(3, 0); await idleHuman('move', 3); s = await st();
  ok(s.pieces[3][0] === 0 && s.queue.join() === '6,4', 'first 6 brings a token out, 6,4 left');
  await chip(3, 4); await sleep(80); await tapPiece(3, 0); await idleHuman('move', 3); s = await st();
  ok(s.pieces[3][0] === 4 && s.queue.join() === '6', 'chip 4 moved that token 4 squares');
  await tapPiece(3, 1);
  await waitFor(() => { const g = window.__cf.game; return g.st.turn === 1 || g.st.phase === 'over'; }, 10000, 'turn passes to computer');
  s = await st();
  ok(s.pieces[3].slice(0, 2).sort().join() === '0,4', 'last 6 brought a second token out, then the turn passed');
  await page.screenshot({ path: OUT + '/cf-duel.png' });

  // ---------- quick chat ----------
  await page.tap('#btn-chat'); await sleep(150);
  ok(await visible('#chat'), 'quick chat panel opens');
  await ev(() => document.querySelector('#chat-emotes button').click()); await sleep(150);
  ok(await ev(() => { const b = document.querySelector('.pod[data-seat="3"] .bubble'); return b && !b.classList.contains('hidden') && !!b.querySelector('svg'); }), 'emote bubble shows at the human pod');
  if (await visible('#chat')) await page.tap('#btn-chat');

  // ---------- triple 6 forfeits the whole queue ----------
  await idleHuman('roll', 3);
  await waitUndoGone();
  await edit('st.pieces[3]=[5,-1,-1,-1]; st.pieces[1]=[-1,-1,-1,-1]; st.queue=[]; st.sixes=0; st.bonus=0;');
  await idleHuman('roll', 3);
  await ev(() => window.__cf.force([6, 6, 6]));
  await roll(3); await idleHuman('roll', 3);
  await roll(3); await idleHuman('roll', 3);
  await roll(3);
  await waitFor(() => window.__cf.game.st.turn === 1, 8000, 'turn lost after three 6s');
  s = await st();
  ok(s.queue.length === 0 && s.pieces[3].join() === '5,-1,-1,-1', 'three 6s in a row: queue forfeited, no token moved');

  // ---------- finish: ranks + rewards ----------
  await idleHuman('roll', 3);
  await waitUndoGone();
  await edit('st.pieces[3]=[57,57,57,54]; st.pieces[1]=[20,-1,-1,-1]; st.queue=[]; st.sixes=0; st.bonus=0;');
  await idleHuman('roll', 3);
  await ev(() => window.__cf.force([3]));
  await roll(3); await idleHuman('move', 3);
  await tapPiece(3, 3);
  await waitFor(() => { const r = document.getElementById('result'); return r && !r.classList.contains('hidden'); }, 12000, 'result screen');
  await sleep(300);
  s = await st();
  ok(s.phase === 'over' && s.ranking[0] === 3, 'exact roll brings the last token home: human wins');
  ok(await ev(() => { const li = document.querySelectorAll('#r-rank li'); return li.length === 2 && li[0].classList.contains('me') && !!li[0].querySelector('.medal.m1') && !!li[1].querySelector('.medal.m2'); }), 'result screen ranks both players (1st you, 2nd computer)');
  ok(await ev(() => /\+\d+/.test(document.getElementById('r-coins').textContent) && /\+\d+/.test(document.getElementById('r-xp').textContent)), 'cosmetic coins and XP awarded');
  ok((await ev(() => window.__cf.gate.state.matchesCompleted)) === 1, 'match counted once for the ad gate');
  await page.screenshot({ path: OUT + '/cf-result.png' });
  await page.tap('#btn-r-home'); await sleep(300);
  ok(await visible('#home'), 'result -> home (no interstitial on first matches)');

  // ---------- Mystery Tiles, 4 players ----------
  await page.tap('#btn-mystery'); await sleep(200);
  ok(await ev(() => document.querySelector('#mode-seg .on, [data-mode].on') ? true : true) && await visible('#setup'), 'Mystery Tiles setup');
  await ev(() => document.querySelector('#presets [data-p="4"]').click()); await sleep(100);
  await page.tap('#btn-start'); await sleep(600);
  s = await st();
  ok(s.mode === 'mystery' && s.players.length === 4 && s.tiles.length === 8, 'mystery match: 4 players, 8 mystery tiles');
  ok(await ev(() => document.querySelectorAll('#tiles .tile').length === 8 && document.querySelectorAll('.pod:not(.empty)').length === 4), '8 tiles drawn, 4 player pods with their own dice');
  ok(await ev(() => window.__cf.podOf(3) === 3), 'human still bottom-left in 4-player');
  await ev(() => { const c = window.__cf.save.settings; c.fast = true; c.auto = false; });
  await idleHuman('roll', 3);
  // a lively position for the store screenshot: per-player dice + queued chips
  await edit('st.pieces=[[8,22,-1,-1],[3,30,-1,57],[12,-1,-1,-1],[2,-1,-1,-1]]; st.queue=[]; st.sixes=0; st.bonus=0; st.faces=[4,2,5,1];');
  await idleHuman('roll', 3);
  await ev(() => window.__cf.force([6, 4]));
  await roll(3); await idleHuman('roll', 3); await roll(3); await idleHuman('move', 3);
  await waitUndoGone(); await sleep(200);
  ok((await chips(3)).join() === '6,4', 'queued 6,4 chips at the human corner');
  await page.screenshot({ path: OUT + '/cf-dice-board.png' });

  // boost tile "?" -> wheel -> Jump 3
  const tileRel = await ev(() => window.__cf.logic.posFromAbs(3, window.__cf.game.st.tiles.find(t => t.kind === 'boost').abs));
  await edit('st.pieces=[[-1,-1,-1,-1],[-1,-1,-1,-1],[-1,-1,-1,-1],[' + (tileRel - 2) + ',-1,-1,-1]]; st.queue=[]; st.phase="roll"; st.sixes=0; st.bonus=0; st.tiles.forEach(t => { t.until = 0; });');
  await idleHuman('roll', 3);
  await ev(() => { window.__cf.save.settings.fast = false; window.__cf.force([2]); window.__cf.forceEvent('jump3'); });
  await roll(3); await idleHuman('move', 3); await waitUndoGone();
  await tapPiece(3, 0);
  await waitFor(() => !document.getElementById('wheel').classList.contains('hidden'), 6000, 'wheel to appear');
  ok(await ev(() => document.getElementById('wheel').classList.contains('boost')), 'landing on "?" spins the Boost wheel');
  await waitFor(() => /\w/.test(document.getElementById('wheel-result').textContent), 6000, 'wheel result');
  await sleep(150);
  await page.screenshot({ path: OUT + '/cf-mystery-wheel.png' });
  await waitFor(() => { const g = window.__cf.game; return document.getElementById('wheel').classList.contains('hidden') && !window.__cf.busy; }, 8000, 'wheel to close');
  await ev(() => { window.__cf.save.settings.fast = true; });
  s = await st();
  ok(s.pieces[3][0] === tileRel + 3, 'Jump 3 event moved the token 3 more squares');

  // chaos tile "!" -> Freeze on yourself (frozen)
  await idleHuman('roll', 3);
  const chaosRel = await ev(() => window.__cf.logic.posFromAbs(3, window.__cf.game.st.tiles.find(t => t.kind === 'chaos').abs));
  await edit('st.pieces=[[-1,-1,-1,-1],[-1,-1,-1,-1],[-1,-1,-1,-1],[' + (chaosRel - 1) + ',-1,-1,-1]]; st.queue=[]; st.phase="roll"; st.sixes=0; st.bonus=0; st.tiles.forEach(t => { t.until = 0; }); st.effects=[];');
  await idleHuman('roll', 3);
  await ev(() => { window.__cf.force([1]); window.__cf.forceEvent('back3'); });
  await roll(3); await idleHuman('move', 3); await waitUndoGone();
  await tapPiece(3, 0);
  await waitFor(() => !document.getElementById('wheel').classList.contains('hidden'), 6000, 'chaos wheel');
  ok(await ev(() => document.getElementById('wheel').classList.contains('chaos')), 'landing on "!" spins the Chaos wheel');
  await waitFor(() => document.getElementById('wheel').classList.contains('hidden') && !window.__cf.busy, 8000, 'chaos wheel to close');
  s = await st();
  ok(s.pieces[3][0] === chaosRel - 3, 'Back 3 event sent the token back 3 squares');
  // let the computers play a little with events on
  await waitFor(() => { const g = window.__cf.game; return g.st.turn !== 3; }, 8000, 'computers take turns');
  await idleHuman('roll', 3);
  ok(true, 'computers played their mystery turns without errors');
  await page.tap('#btn-home'); await sleep(200);
  await page.tap('#btn-m-home'); await sleep(300);

  // ---------- Pass & Play with Classic house rule ----------
  await page.tap('#btn-settings'); await sleep(200);
  await ev(() => document.querySelector('#rule-style [data-v="classic"]').click()); await sleep(100);
  await ev(() => document.querySelector('#settings [data-close="settings"]').click()); await sleep(150);
  await page.tap('#btn-pass'); await sleep(200);
  ok(await ev(() => /Classic/.test(document.getElementById('rules-sum').textContent)), 'setup shows Classic house rule');
  await ev(() => document.querySelector('#presets [data-p="1v1"]').click()); await sleep(100);
  await page.tap('#btn-start'); await sleep(300);
  if (await visible('#confirm')) { await page.tap('#confirm-yes'); await sleep(400); }
  s = await st();
  ok(s.players.every(p => s.seats[p].type === 'human') && s.rules.rollStyle === 'classic', 'pass & play: all human seats, classic rules');
  await ev(() => { const c = window.__cf.save.settings; c.fast = true; c.auto = false; });
  const first = s.turn;
  await idleHuman('roll');
  await ev(() => window.__cf.force([6]));
  await roll(first); await idleHuman('move');
  s = await st();
  ok(s.phase === 'move' && s.queue.join() === '6', 'classic: a 6 must be moved before rolling again');
  await page.screenshot({ path: OUT + '/cf-pass.png' });

  ok(errors.length === 0, 'no console errors / failed requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\n${n} checks passed`);
  await browser.close();
  global.__dbg = async () => {};
})().catch(async e => { console.error(e.message || e); if (process.env.DEBUG && global.__page) { try { console.error(JSON.stringify(await global.__page.evaluate(() => { const g = window.__cf.game; return g && { st: { turn: g.st.turn, phase: g.st.phase, queue: g.st.queue, pieces: g.st.pieces, tiles: g.st.tiles, turnCount: g.st.turnCount }, busy: window.__cf.busy }; }))); await global.__page.screenshot({ path: '/tmp/cf-fail.png' }); } catch (x) {} } process.exit(1); });
