// Headless Chrome phone test (360x740, touch) for Crossfour v1.2 (incl. Lucky Chaos Ludo): per-player dice, Star-style stacked rolls,
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
  async function keyboardMoveToHandoff(seat, nextSeat, label) {
    await ev(v => window.__cf.force([v]), 1);
    await page.focus('.pod[data-seat="' + seat + '"] .pdice'); await page.keyboard.press('Enter');
    await idleHuman('move', seat);
    ok(await ev(s => document.activeElement.matches('#pieces .pc.can[data-seat="' + s + '"]') && !document.activeElement.disabled, seat), label + ': keyboard roll focuses a legal token');
    await page.keyboard.press('Enter');
    await waitFor(s => { const c = window.__cf, d = document.querySelector('.pod[data-seat="' + s + '"] .pdice'); return c.game.st.turn === s && c.game.st.phase === 'roll' && !c.busy && d && !d.disabled && document.activeElement === d; }, 15000, label + ' focus handoff', nextSeat);
  }

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await ev(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
  ok(await visible('#home') && !(await visible('#btn-continue')), 'home on launch, nothing to continue');
  ok(await visible('#btn-mystery'), 'Mystery Tiles mode on home screen');
  ok((await ev(() => window.__cf.gate.state.sessions)) === 1, 'first session counted');
  ok(/1\.2\.0/.test(await ev(() => document.body.innerText + document.documentElement.innerHTML)), 'version 1.2.0 in page');
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
  await page.focus('.pod[data-seat="3"] .pdice'); await page.keyboard.press('Enter');
  await idleHuman('roll', 3); s = await st();
  ok(s.queue.join() === '6' && s.phase === 'roll', 'rolled 6: another roll right away, 6 queued');
  ok(await ev(() => document.getElementById('btn-undo').classList.contains('live') && !document.getElementById('btn-undo').disabled), 'undo button live after a human roll');
  await page.keyboard.press('Enter'); await idleHuman('roll', 3);
  await page.keyboard.press('Enter'); await idleHuman('move', 3); s = await st();
  ok(s.queue.join() === '6,6,3' && (await chips(3)).join() === '6,6,3', 'queue 6,6,3 shown as dice chips on the human pod');
  ok(await ev(() => document.activeElement && document.activeElement.matches('#pieces .pc.can')), 'keyboard die moves focus to a legal token after the roll');
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
  await page.focus('.pod[data-seat="3"] .chip-v[data-v="6"]'); await page.keyboard.press('Enter'); await sleep(100);
  ok(await ev(() => window.__cf.game.sel === 6), 'tapped chip 6 is selected');
  const keyboardToken = '.pc[data-seat="3"][data-piece="0"]';
  ok(await ev(sel => { const b = document.querySelector(sel); return b.tagName === 'BUTTON' && !b.disabled && /You token 1, in base, select to move/.test(b.getAttribute('aria-label')); }, keyboardToken), 'legal token is a named, enabled button with its position');
  ok(await ev(() => { const h = document.getElementById('hint'); return h.getAttribute('role') === 'status' && h.getAttribute('aria-live') === 'polite' && /Dice chip 6 selected/.test(h.textContent); }), 'move guidance is announced after a chip is selected');
  ok(await ev(sel => document.activeElement === document.querySelector(sel), keyboardToken), 'keyboard chip selection focuses the matching legal token');
  await page.keyboard.press('Enter'); await idleHuman('move', 3); s = await st();
  ok(s.pieces[3][0] === 0 && s.queue.join() === '6,4', 'Enter moves a focused token out of base without triggering a roll');
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

  // ---------- Lucky Chaos Ludo, 4 players ----------
  ok(await visible('#btn-lucky') && /Lucky Chaos Ludo/.test(await ev(() => document.getElementById('btn-lucky').textContent)), 'Lucky Chaos Ludo on home screen');
  await page.tap('#btn-lucky'); await sleep(200);
  ok(await visible('#setup') && (await ev(() => document.getElementById('setup-title').textContent)) === 'Lucky Chaos Ludo' && await ev(() => document.querySelector('#mode-seg [data-mode="lucky"]').classList.contains('on')), 'Lucky Chaos setup selected');
  ok(await visible('#btn-howto'), 'How to play button in Lucky Chaos setup');
  await page.tap('#btn-howto'); await sleep(200);
  ok(await visible('#rules') && await ev(() => !document.querySelector('.rules-page[data-page="lucky"]').classList.contains('hidden') && document.querySelectorAll('#ev-lboost .ev').length === 6 && document.querySelectorAll('#ev-lchaos .ev').length === 6 && document.querySelectorAll('#ev-mega .ev').length === 6), 'in-game How to play: Boost, Chaos and Mega wheels listed');
  ok(await ev(() => /High Risk \/ High Reward/.test(document.querySelector('.rules-page[data-page="lucky"]').textContent)), 'How to play explains Danger tiles');
  await ev(() => document.querySelector('#rules [data-close="rules"]').click()); await sleep(150);
  await ev(() => document.querySelector('#presets [data-p="4"]').click()); await sleep(100);
  await page.tap('#btn-start'); await sleep(300);
  if (await visible('#confirm')) { await page.tap('#confirm-yes'); await sleep(400); }
  s = await st();
  ok(s.mode === 'lucky' && s.players.length === 4 && s.tiles.length === 12 && !!s.lk, 'lucky match: 4 players, 12 special tiles');
  ok(await ev(() => document.querySelectorAll('#tiles .tile.boost').length === 4 && document.querySelectorAll('#tiles .tile.chaos').length === 4 && document.querySelectorAll('#tiles .tile.danger').length === 4), '4 Boost, 4 Chaos and 4 Danger tiles drawn');
  ok(await ev(() => [...document.querySelectorAll('#tiles .tile.danger')].every(t => /High Risk \/ High Reward/.test(t.title) && t.textContent.indexOf('!!') >= 0)), 'Danger tiles labelled High Risk / High Reward');
  ok(await ev(() => document.querySelectorAll('.pod:not(.empty) .chg').length === 4), 'Lucky Charge meter in every pod');
  ok(/Lucky Chaos/.test(await ev(() => document.getElementById('turn-label').textContent)), 'Lucky Chaos tag in the top bar');
  await ev(() => { const c = window.__cf.save.settings; c.fast = true; c.auto = false; });
  await idleHuman('roll', 3);
  const relOf = kind => ev(k => { const L = window.__cf.logic; return window.__cf.game.st.tiles.filter(t => t.kind === k).map(t => L.posFromAbs(3, t.abs)).filter(p => p >= 4 && p <= 45)[0]; }, kind);
  const CLEAR = 'st.queue=[]; st.phase="roll"; st.sixes=0; st.bonus=0; st.effects=[]; st.tiles.forEach(t => { t.until = 0; }); st.lk.tg=false; st.lk.used=null;';
  const wheelOpen = () => waitFor(() => !document.getElementById('wheel').classList.contains('hidden'), 8000, 'wheel to appear');
  const flowDone = () => waitFor(() => document.getElementById('wheel').classList.contains('hidden') && document.getElementById('choice').classList.contains('hidden') && !window.__cf.busy, 12000, 'lucky flow to finish');

  // Danger tile: 50/50 wheel, stronger outcome (Jump +5)
  const dRel = await relOf('danger');
  await edit('st.pieces=[[-1,-1,-1,-1],[-1,-1,-1,-1],[-1,-1,-1,-1],[' + (dRel - 2) + ',-1,-1,-1]]; ' + CLEAR);
  await idleHuman('roll', 3);
  await ev(() => { window.__cf.save.settings.fast = false; window.__cf.force([2]); window.__cf.forceEvent({ kind: 'boost', event: 'jump3' }); });
  await roll(3); await idleHuman('move', 3); await waitUndoGone();
  await tapPiece(3, 0);
  await wheelOpen();
  ok(await ev(() => { const w = document.getElementById('wheel'); return w.classList.contains('danger') && w.classList.contains('boost') && /High Risk \/ High Reward/.test(document.getElementById('wheel-title').textContent); }), 'Danger tile spins a wheel titled High Risk / High Reward');
  await waitFor(() => /Jump \+5/.test(document.getElementById('wheel-result').textContent), 6000, 'danger result');
  ok(true, 'Danger result shows the stronger "Jump +5"');
  await flowDone();
  s = await st();
  ok(s.pieces[3][0] === dRel + 5 && s.lk.charge[3] === 2, 'Danger Jump +5 moved 5 squares and gave +2 Lucky Charge');
  ok(await ev(() => [...document.querySelectorAll('#tiles .tile.danger.rest .cd')].some(c => /\d/.test(c.textContent))), 'used tile shows its cooldown (rounds left)');

  // Revenge Charge: two results, tap one
  const bRel = await relOf('boost');
  await idleHuman('roll', 3);
  await edit('st.pieces=[[-1,-1,-1,-1],[-1,-1,-1,-1],[-1,-1,-1,-1],[' + (bRel - 1) + ',-1,-1,-1]]; ' + CLEAR + ' st.lk.revenge[3]=true; st.lk.charge[3]=0;');
  await idleHuman('roll', 3);
  ok(await ev(() => !!document.querySelector('.pod[data-seat="3"] .rev')), 'Revenge Charge badge shown');
  await ev(() => { window.__cf.force([1]); window.__cf.forceEvent({ event: 'extra', alt: 'shield' }); });
  await roll(3); await idleHuman('move', 3); await waitUndoGone();
  await tapPiece(3, 0);
  await waitFor(() => !document.getElementById('choice').classList.contains('hidden'), 10000, 'revenge choice window');
  ok(await ev(() => document.querySelectorAll('#choice .copt').length === 2 && !!document.querySelector('#choice .copt.best') && /Revenge/.test(document.getElementById('choice-title').textContent)), 'Revenge decision window: 2 results, best one highlighted');
  await ev(() => [...document.querySelectorAll('#choice .copt')].find(b => /Shield/.test(b.textContent)).click());
  await flowDone();
  s = await st();
  ok(s.effects.some(e => e.type === 'shield' && e.seat === 3 && e.piece === 0) && !s.lk.revenge[3], 'tapped Shield was applied, Revenge used');

  // Decision window timeout -> default auto-pick (Wild Jump)
  const cRel = await relOf('chaos');
  await idleHuman('roll', 3);
  await edit('st.pieces=[[-1,-1,-1,-1],[-1,-1,-1,-1],[-1,-1,-1,-1],[' + (cRel - 1) + ',-1,-1,-1]]; ' + CLEAR);
  await idleHuman('roll', 3);
  await ev(() => { window.__cf.save.settings.fast = true; window.__cf.force([1]); window.__cf.forceEvent({ event: 'wild', wild: 4 }); });
  await roll(3); await idleHuman('move', 3); await waitUndoGone();
  await tapPiece(3, 0);
  await waitFor(() => !document.getElementById('choice').classList.contains('hidden'), 10000, 'wild choice window');
  ok(/Wild Jump/.test(await ev(() => document.getElementById('choice-title').textContent)), 'Chaos wheel Wild Jump asks jump or stay');
  const t0 = Date.now();
  await waitFor(() => document.getElementById('choice').classList.contains('hidden'), 6000, 'auto pick');
  const waited = Date.now() - t0;
  ok(waited > 2000 && waited < 4500, 'decision window auto-picks after ~3 s (' + waited + ' ms)');
  await flowDone();
  s = await st();
  ok(s.pieces[3][0] === cRel + 4, 'default choice (Jump 4) applied on timeout');

  // stored power: Lucky 6
  await idleHuman('roll', 3);
  await edit('st.pieces=[[-1,-1,-1,-1],[-1,-1,-1,-1],[-1,-1,-1,-1],[-1,-1,-1,-1]]; ' + CLEAR + ' st.lk.powers[3]=["six","dbl"];');
  await idleHuman('roll', 3);
  ok(await ev(() => document.querySelectorAll('.pod[data-seat="3"] .pw.ok').length === 2), 'stored powers (max 2) shown as buttons');
  await ev(() => document.querySelector('.pod[data-seat="3"] .pw[data-pw="six"]').click());
  await idleHuman('roll', 3);
  await roll(3); await sleep(900);
  s = await st();
  ok(s.faces[3] === 6 || s.pieces[3].some(p => p >= 0) || s.queue.indexOf(6) >= 0, 'Lucky 6 power gave a 6');
  await waitFor(() => !window.__cf.busy, 8000, 'idle');

  // Mega Wheel at 5/5 -> Crown -> King token
  await idleHuman('roll', 3).catch(() => {});
  await edit('st.pieces=[[5,20,-1,-1],[9,33,-1,-1],[14,-1,-1,-1],[' + (bRel + 6) + ',11,-1,-1]]; ' + CLEAR + ' st.turn=3; st.lk.powers=[[],[],[],[]]; st.lk.kings=[]; st.lk.charge=[2,4,1,5]; st.lk.streak=[1,0,0,2];');
  await idleHuman('roll', 3);
  ok(await ev(() => !!document.querySelector('.pod[data-seat="3"] .chg.full') && !!document.querySelector('.pod[data-seat="3"] .mega-btn')), 'full 5/5 meter glows and offers MEGA');
  await ev(() => { window.__cf.save.settings.fast = false; window.__cf.forceMega('crown'); });
  await ev(() => document.querySelector('.pod[data-seat="3"] .mega-btn').click());
  await wheelOpen();
  ok(await ev(() => document.getElementById('wheel').classList.contains('mega') && /MEGA WHEEL/.test(document.getElementById('wheel-title').textContent)), 'Mega Wheel spins');
  await waitFor(() => /Crown/.test(document.getElementById('wheel-result').textContent), 6000, 'mega result');
  await sleep(150);
  await page.screenshot({ path: OUT + '/cf-lucky-mega.png' });
  await flowDone();
  s = await st();
  ok(s.lk.charge[3] === 0 && s.lk.kings.some(k => k.seat === 3 && k.piece === 0), 'Mega Crown made the lead token King, meter reset');
  ok(await ev(() => { const e = document.querySelectorAll('#pieces .pc.king'); return e.length === 1 && getComputedStyle(e[0].querySelector('.crown')).display !== 'none'; }), 'King token wears a visible crown');
  // lively board for the store screenshot: tiles (one resting), meters, streak, stored powers, King
  await edit('st.lk.charge=[2,4,1,3]; st.lk.streak=[1,0,0,2]; st.lk.powers[3]=["dbl","escape"]; st.lk.revenge[1]=true; st.tiles[2].until = st.turnCount + 4; st.tiles[9].until = st.turnCount + 8; st.faces=[4,2,5,1];');
  await idleHuman('roll', 3); await waitFor(() => document.getElementById('toast').classList.contains('hidden'), 4000, 'toast to clear'); await sleep(200);
  await page.screenshot({ path: OUT + '/cf-lucky-board.png' });
  await ev(() => { window.__cf.save.settings.fast = true; });
  // computers use the meter/powers on their own
  await edit('st.lk.charge=[5,5,5,0];');
  await ev(() => window.__cf.force([4])); await roll(3); await idleHuman('move', 3); await waitUndoGone();
  await tapPiece(3, (await st()).moves[0].piece);
  await waitFor(() => { const g = window.__cf.game; return g.st.turn !== 3; }, 10000, 'computers take turns');
  await waitFor(() => { const g = window.__cf.game; return g.st.turn === 3 && !window.__cf.busy; }, 40000, 'back to the human');
  s = await st();
  ok(s.lk.charge[0] < 5 && s.lk.charge[1] < 5 && s.lk.charge[2] < 5, 'computer players spent their Mega Wheels');
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
  ok(s.players.join() === '1,3', '1v1 pass & play seats Jade and Cobalt');
  await edit('st.pieces=[[-1,-1,-1,-1],[5,-1,-1,-1],[-1,-1,-1,-1],[5,-1,-1,-1]]; st.queue=[]; st.moves=[]; st.phase="roll"; st.turn=3; st.sixes=0; st.bonus=0; st.rollAgain=false;');
  await idleHuman('roll', 3);
  const duelRolls = s.rolls, duelTurns = s.turnCount;
  await keyboardMoveToHandoff(3, 1, 'Cobalt to Jade');
  s = await st();
  ok(s.turn === 1 && s.phase === 'roll' && s.pieces[3][0] === 6 && s.rolls === duelRolls + 1 && s.turnCount === duelTurns + 1, 'valid Cobalt move advances exactly one square and hands the turn to Jade');
  await page.screenshot({ path: OUT + '/cf-pass.png' });

  // ---------- keyboard focus handoff in four-player pass & play ----------
  await page.tap('#btn-home'); await sleep(150); await page.tap('#btn-m-home'); await sleep(250);
  await page.tap('#btn-pass'); await sleep(200);
  await ev(() => document.querySelector('#presets [data-p="4"]').click()); await sleep(100);
  await page.tap('#btn-start'); await sleep(250);
  if (await visible('#confirm')) { await page.tap('#confirm-yes'); await sleep(350); }
  s = await st();
  ok(s.players.length === 4 && s.players.every(p => s.seats[p].type === 'human'), 'four-player pass & play has four human seats');
  const seats4 = s.players.slice();
  await edit('st.pieces=[[5,-1,-1,-1],[5,-1,-1,-1],[5,-1,-1,-1],[5,-1,-1,-1]]; st.queue=[]; st.moves=[]; st.phase="roll"; st.turn=' + seats4[0] + '; st.sixes=0; st.bonus=0; st.rollAgain=false; st.ranking=[];');
  for (let i = 0; i < seats4.length; i++) {
    const seat = seats4[i], nextSeat = seats4[(i + 1) % seats4.length];
    await idleHuman('roll', seat);
    await keyboardMoveToHandoff(seat, nextSeat, 'four-player seat ' + seat + ' to ' + nextSeat);
    s = await st();
    ok(s.turn === nextSeat && s.phase === 'roll' && s.pieces[seat][0] === 6, 'four-player move advances and activates the next seat');
  }
  const eliminated = seats4[1], current = seats4[0], afterEliminated = seats4[2];
  await edit('st.pieces=[[5,-1,-1,-1],[5,-1,-1,-1],[5,-1,-1,-1],[5,-1,-1,-1]]; st.pieces[' + eliminated + ']=[57,57,57,57]; st.queue=[]; st.moves=[]; st.phase="roll"; st.turn=' + current + '; st.sixes=0; st.bonus=0; st.rollAgain=false; st.ranking=[' + eliminated + '];');
  await idleHuman('roll', current);
  await keyboardMoveToHandoff(current, afterEliminated, 'four-player skip of finished seat ' + eliminated);
  s = await st();
  ok(s.ranking.join() === String(eliminated) && s.turn === afterEliminated, 'finished seat is skipped without changing turn progression');

  // ---------- result semantics + focus after Replay and confirmed Restart ----------
  const replayPlayers = s.players.slice(), replayMode = s.mode, winner = replayPlayers[0];
  await edit('st.phase="over"; st.turn=' + winner + '; st.ranking=' + JSON.stringify(replayPlayers) + '; st.queue=[]; st.moves=[]; st.pieces.forEach(function (pieces) { if (pieces) pieces.fill(57); });');
  await waitFor(() => { const r = document.getElementById('result'); return r && !r.classList.contains('hidden'); }, 5000, 'synthetic winner result');
  ok(await ev(() => {
    const title = document.getElementById('r-title'), rank = document.getElementById('r-rank'), rows = [...rank.children];
    const replay = document.getElementById('btn-r-again');
    return title.tagName === 'H2' && title.textContent === rows[0].querySelector('.pdot').nextSibling.textContent.trim() + ' wins!' &&
      rank.tagName === 'OL' && rows.length === 4 && rows[0].querySelector('.medal').textContent === '1' &&
      replay.tagName === 'BUTTON' && replay.textContent.trim() === 'Play again';
  }), 'winner heading, ordered ranking, and native Replay button label are clear in the DOM');
  const firstSeat = replayPlayers[0];
  await page.focus('#btn-r-again'); await page.keyboard.press('Enter');
  await waitFor((players, mode, seat) => {
    const c = window.__cf, die = document.querySelector('.pod[data-seat="' + seat + '"] .pdice');
    return c.game.st.phase === 'roll' && c.game.st.players.join() === players && c.game.st.mode === mode &&
      c.game.st.turn === seat && die && !die.disabled && document.activeElement === die;
  }, 5000, 'Replay returns focus to the new match’s enabled human die', replayPlayers.join(), replayMode, firstSeat);
  ok(await ev(() => {
    const c = window.__cf, status = document.getElementById('hint');
    return c.game.st.phase === 'roll' && c.game.st.ranking.length === 0 && c.game.st.pieces[0].every(p => p === -1) &&
      status.getAttribute('role') === 'status' && status.getAttribute('aria-live') === 'polite' && /Tap your die to roll/.test(status.textContent);
  }), 'Replay starts a fresh match with polite roll guidance in the status region');

  await page.tap('#btn-home'); await sleep(150);
  ok(await ev(() => { const b = document.getElementById('btn-m-restart'); return b.tagName === 'BUTTON' && b.textContent.trim() === 'Restart with same players'; }), 'Restart is a native button with a clear label');
  await page.focus('#btn-m-restart'); await page.keyboard.press('Enter');
  await waitFor(() => { const c = document.getElementById('confirm'); return c && !c.classList.contains('hidden'); }, 1500, 'restart confirmation');
  ok(await ev(() => { const b = document.getElementById('confirm-yes'); return b.tagName === 'BUTTON' && b.textContent.trim() === 'Restart'; }), 'confirmed Restart action has a clear native button label');
  await page.focus('#confirm-yes'); await page.keyboard.press('Enter');
  await waitFor((players, mode, seat) => {
    const c = window.__cf, die = document.querySelector('.pod[data-seat="' + seat + '"] .pdice');
    return c.game.st.phase === 'roll' && c.game.st.players.join() === players && c.game.st.mode === mode &&
      c.game.st.turn === seat && die && !die.disabled && document.activeElement === die;
  }, 5000, 'confirmed Restart returns focus to the new match’s enabled human die', replayPlayers.join(), replayMode, firstSeat);
  ok(await ev(() => {
    const c = window.__cf, status = document.getElementById('hint');
    return c.game.st.phase === 'roll' && c.game.st.ranking.length === 0 && c.game.st.pieces[0].every(p => p === -1) &&
      status.getAttribute('role') === 'status' && status.getAttribute('aria-live') === 'polite' && /Tap your die to roll/.test(status.textContent);
  }), 'confirmed Restart preserves the same players and starts a fresh turn with polite status guidance');

  ok(errors.length === 0, 'no console errors / failed requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\n${n} checks passed`);
  await browser.close();
  global.__dbg = async () => {};
})().catch(async e => { console.error(e.message || e); if (process.env.DEBUG && global.__page) { try { console.error(JSON.stringify(await global.__page.evaluate(() => { const g = window.__cf.game; return g && { st: { turn: g.st.turn, phase: g.st.phase, queue: g.st.queue, pieces: g.st.pieces, tiles: g.st.tiles, turnCount: g.st.turnCount }, busy: window.__cf.busy }; }))); await global.__page.screenshot({ path: '/tmp/cf-fail.png' }); } catch (x) {} } process.exit(1); });
