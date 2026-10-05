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
  const rawTap = page.tap.bind(page);
  page.tap = async (sel, opts) => {
    if (typeof sel === 'string') await page.evaluate(q => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: 'center' }); }, sel);
    return rawTap(sel, opts);
  };
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
  async function tap(sel){ await page.evaluate(q=>{ const e=document.querySelector(q); if(!e) throw new Error('missing '+q); e.scrollIntoView({block:'center'}); }, sel); await page.tap(sel); }
  async function dicePoint(seat) { return ev(s => { const r = document.querySelector('.pod[data-seat="' + s + '"] .pdice').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, seat); }
  async function swipeDice(seat) {
    const p = await dicePoint(seat), cdp = await page.target().createCDPSession();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + 34, y: p.y + 6, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  async function tapDice(seat) { const p = await dicePoint(seat); await page.touchscreen.tap(p.x, p.y); }
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
  await ev(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); }); await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
  ok(await visible('#home') && !(await visible('#btn-continue')), 'home on launch, nothing to continue');
  ok(await visible('#btn-mystery'), 'Mystery Tiles mode on home screen');
  ok((await ev(() => window.__cf.gate.state.sessions)) === 1, 'first session counted');
  ok(/1\.3\.0/.test(await ev(() => document.body.innerText + document.documentElement.innerHTML)), 'version 1.3.0 in page');

  const failedSave = await ev(() => {
    const proto = Storage.prototype, original = proto.setItem;
    proto.setItem = function (key, value) {
      if (key === 'crossfour.save.v3') throw new DOMException('quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    window.__cf.persist();
    const warned = !document.getElementById('save-warning').classList.contains('hidden');
    proto.setItem = original; window.__cf.persist();
    return { warned, cleared: document.getElementById('save-warning').classList.contains('hidden') };
  });
  ok(failedSave.warned && failedSave.cleared, 'failed local save shows a persistent warning that clears after storage recovers');

  await ev(() => {
    const primary = JSON.parse(localStorage.getItem('crossfour.save.v3'));
    const checkpoint = JSON.parse(JSON.stringify(primary)); checkpoint.payload.coins = 41;
    primary.payload.coins = -1;
    localStorage.setItem('crossfour.save.checkpoint.v3', JSON.stringify(checkpoint));
    localStorage.setItem('crossfour.save.v3', JSON.stringify(primary));
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(200);
  ok(await ev(() => window.__cf.loadStatus === 'recovered' && window.__cf.save.coins === 41 && /last safe save/i.test(document.getElementById('toast').textContent)),
    'checkpoint recovery resumes known-good progress and warns that recent moves may be missing');

  await ev(() => {
    localStorage.clear();
    localStorage.setItem('crossfour.tutorial.v1', '1');
    localStorage.setItem('crossfour.save.v1', JSON.stringify({ coins: 77, xp: 123, owned: { boards: ['linen'], dice: ['brass'] }, board: 'linen', dice: 'brass',
      settings: { sound: false, fast: true }, stats: { played: 4, won: 2 }, ad: { matchesCompleted: 7 }, setup: { rules: { safeSquares: false, extraOnCapture: false } } }));
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(250);
  ok(await ev(() => {
    const c = window.__cf;
    return c.save.coins === 77 && c.save.xp === 123 && c.save.stats.played === 4 && c.save.settings.sound === false &&
      c.save.rules.safeSquares === false && c.save.rules.bonusOnCapture === false && c.save.game === null && c.save.ad.matchesCompleted === 7;
  }), 'v1 migration preserves profile, settings, stats, ad pacing and compatible house rules');
  ok(!(await visible('#btn-continue')), 'incompatible legacy v1 match format is not resumed as if it were a current game');
  await page.tap('#btn-settings'); await sleep(120); await page.tap('#btn-reset'); await sleep(120);
  if (await visible('#confirm')) {
    const resetNavigation = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => null);
    await page.tap('#confirm-yes'); await resetNavigation;
  }
  await sleep(200);
  ok(await ev(() => {
    const c = window.__cf, checkpoint = JSON.parse(localStorage.getItem('crossfour.save.checkpoint.v3'));
    return c.save.coins === 0 && c.save.xp === 0 && c.save.stats.played === 0 && c.save.ad.matchesCompleted === 7 && !localStorage.getItem('crossfour.tutorial.v1') &&
      !localStorage.getItem('crossfour.save.v1') && !localStorage.getItem('crossfour.save.v2') && checkpoint.payload.coins === 0;
  }), 'confirmed Reset progress clears stale snapshots/legacy keys while retaining ad pacing');
  await ev(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); }); await page.reload({ waitUntil: 'networkidle0' }); await sleep(250);

  const v2 = await ev(() => {
    const c = window.__cf, seats = [{ type: 'human' }, { type: 'human' }, null, null];
    const st = c.logic.newGame(seats, {}, 123456, 'mystery');
    st.turn = 0; st.phase = 'roll'; st.queue = []; st.moves = []; st.pieces[0] = [0, -1, -1, -1]; st.pieces[1] = [4, -1, -1, -1]; st.rng = 991723;
    const legacy = JSON.parse(JSON.stringify(c.save));
    legacy.coins = 321; legacy.xp = 654; legacy.board = 'linen'; legacy.settings.fast = true; legacy.settings.auto = false;
    legacy.stats.played = 9; legacy.stats.won = 4;
    legacy.game = { st, seats, mode: st.mode, view: 3, undoLeft: 2, undo: null, sel: null, coins: 0, xp: 0, doubled: false, counted: false, started: Date.now() };
    ['crossfour.save.v3', 'crossfour.save.checkpoint.v3', 'crossfour.save.v1', 'crossfour.save.v2'].forEach(k => localStorage.removeItem(k));
    localStorage.setItem('crossfour.save.v2', JSON.stringify(legacy));
    return { rng: st.rng, turn: st.turn, pieces: st.pieces[0].slice(), mode: st.mode };
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(250);
  ok(await visible('#btn-continue'), 'migrated v2 match is offered from the home screen');
  ok(await ev(() => {
    const c = window.__cf, snap = JSON.parse(localStorage.getItem('crossfour.save.v3'));
    return c.save.coins === 321 && c.save.xp === 654 && c.save.stats.played === 9 && c.save.settings.fast &&
      c.save.game.st.rng === 991723 && c.save.game.st.pieces[0][0] === 0 && snap.schemaVersion === 3 && !!snap.savedAt;
  }), 'v2 save migration preserves progression, settings and match state in a validated v3 snapshot');
  await page.tap('#btn-continue'); await sleep(150);
  ok(await visible('#game') && (await st()).rng === v2.rng && (await st()).mode === v2.mode, 'Continue restores the same on-device match after reload');
  const beforeSwipe = await st();
  const expectedAfterSwipe = await ev(() => {
    const c = window.__cf, expected = c.logic.clone(c.game.st), result = c.logic.roll(expected);
    return { state: expected, raw: result.raw, value: result.value };
  });
  await swipeDice(0);
  await waitFor(expectedRolls => { const c = window.__cf; return !c.busy && c.game.st.turn === 0 && c.game.st.rolls === expectedRolls && (c.game.st.phase === 'roll' || c.game.st.phase === 'move'); }, 8000, 'human swipe roll after restored match', beforeSwipe.rolls + 1);
  const afterSwipe = await st();
  ok(afterSwipe.rolls === beforeSwipe.rolls + 1 && afterSwipe.faces[0] === expectedAfterSwipe.raw && JSON.stringify(afterSwipe) === JSON.stringify(expectedAfterSwipe.state), 'a real touch swipe triggers exactly one roll and preserves the deterministic RNG/result');
  ok(await ev(() => getComputedStyle(document.querySelector('.pod[data-seat="0"] .pdice')).animationName.includes('toss')), 'normal-motion swipe shows the brief dice bounce');
  ok(await ev(() => /tap or swipe/i.test(document.querySelector('.pod[data-seat="0"] .pdice').getAttribute('aria-label'))), 'the focused dice button advertises swipe while retaining an accessible tap action');
  ok(await ev(() => {
    const c = window.__cf, old = window.Capacitor; let calls = 0, threw = false;
    window.Capacitor = { Plugins: { Haptics: { impact() { calls++; } } } };
    try { c.save.settings.haptics = true; c.haptic('light'); } catch (e) { threw = true; }
    window.Capacitor = old;
    return !c.native && calls === 0 && !threw;
  }), 'unsupported browser haptics safely no-op without calling an unavailable native plugin');

  await ev(() => window.__cf.edit(st => { st.phase = 'roll'; st.queue = []; st.moves = []; st.sixes = 0; st.bonus = 0; st.rollAgain = false; }));
  await idleHuman('roll', 0);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const beforeTap = await st();
  const expectedAfterTap = await ev(() => {
    const c = window.__cf, expected = c.logic.clone(c.game.st), result = c.logic.roll(expected);
    return { state: expected, raw: result.raw };
  });
  await page.focus('.pod[data-seat="0"] .pdice'); await page.keyboard.press('Enter');
  await waitFor(expectedRolls => { const c = window.__cf; return !c.busy && c.game.st.turn === 0 && c.game.st.rolls === expectedRolls && (c.game.st.phase === 'roll' || c.game.st.phase === 'move'); }, 8000, 'reduced-motion tap fallback roll', beforeTap.rolls + 1);
  const afterTap = await st();
  ok(afterTap.rolls === beforeTap.rolls + 1 && afterTap.faces[0] === expectedAfterTap.raw && JSON.stringify(afterTap) === JSON.stringify(expectedAfterTap.state), 'focused die activation still rolls exactly once with the same RNG results');
  ok(await ev(() => matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(document.querySelector('.pod[data-seat="0"] .pdice')).animationName === 'none' && getComputedStyle(document.querySelector('.pod[data-seat="0"] .cube')).transitionDuration === '0s'), 'reduced motion removes dice animation and rotation transition');
  await idleHuman('move', 0);
  ok(await ev(() => {
    const tokens = [...document.querySelectorAll('#pieces .pc.is-turn')];
    return matchMedia('(prefers-reduced-motion: reduce)').matches && tokens.length > 0 && tokens.every(t =>
      getComputedStyle(t, '::before').animationName === 'none' && getComputedStyle(t.querySelector('.gem-core')).animationName === 'none');
  }), 'reduced motion suppresses legal-token breathing as well as travel animation');
  await ev(() => {
    const animator = window.PathAnimation, animate = animator.animate;
    const probe = window.__reducedPathProbe = { calls: 0, reduced: false, immediate: false, completes: 0 };
    probe.restore = () => { animator.animate = animate; };
    animator.animate = function (opts) {
      probe.calls++; probe.reduced = opts.reducedMotion;
      const done = opts.onComplete; let returned = false;
      opts.onComplete = function () { probe.immediate = !returned; probe.completes++; if (done) done(); };
      const cancel = animate(opts); returned = true; return cancel;
    };
  });
  await page.focus('#pieces .pc.can'); await page.keyboard.press('Enter');
  await waitFor(() => window.__reducedPathProbe.completes === 1 && !window.__cf.busy, 5000, 'reduced-motion token path completion');
  const reducedPath = await ev(() => { const p = window.__reducedPathProbe; const out = { calls: p.calls, reduced: p.reduced, immediate: p.immediate, completes: p.completes, clean: !document.querySelector('.pc.hop'), noRipple: !document.querySelector('.pc.land') }; p.restore(); delete window.__reducedPathProbe; return out; });
  ok(reducedPath.calls === 1 && reducedPath.reduced && reducedPath.immediate && reducedPath.completes === 1 && reducedPath.clean && reducedPath.noRipple, 'reduced-motion token movement is immediate with no hop styling or landing ripple');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  await edit('st.phase="over"; st.ranking=st.players.slice(); st.queue=[]; st.moves=[]; st.pieces.forEach(function (p) { if (p) p.fill(57); });');
  await waitFor(() => !document.getElementById('result').classList.contains('hidden'), 5000, 'migrated match result before fixture cleanup');
  await page.tap('#btn-r-home'); await waitFor(() => { const h = document.getElementById('home'); return h && !h.classList.contains('hidden'); }, 5000, 'migrated match cleared through normal result flow');
  await ev(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); }); await page.reload({ waitUntil: 'networkidle0' }); await sleep(250);
  ok(await visible('#home') && !(await visible('#btn-continue')) && (await ev(() => window.__cf.gate.state.sessions)) === 1, 'clean browser fixture restored after migration tests');
  await page.screenshot({ path: OUT + '/cf-home.png' });

  // ---------- rules & settings ----------
  await tap('#btn-rules'); await sleep(200);
  ok(await visible('#rules'), 'rules screen opens');
  await ev(() => document.querySelector('#rules-tabs [data-tab="mystery"]').click()); await sleep(100);
  ok(await ev(() => document.querySelectorAll('#ev-boost .ev').length === 6 && document.querySelectorAll('#ev-chaos .ev').length === 6), 'rules list 6 boost + 6 chaos events');
  await ev(() => document.querySelector('#rules [data-close="rules"]').click()); await sleep(150);
  await tap('#btn-settings'); await sleep(200);
  ok(await visible('#settings') && await ev(() => !!document.getElementById('rule-captureToEnter') && !!document.getElementById('rule-blocks') && document.querySelector('#rule-style .on').dataset.v === 'star'), 'settings: house rules, Star style default');
  ok(await ev(() => document.getElementById('set-undo').checked && !document.getElementById('set-timer').checked), 'undo on, turn timer off by default');
  await ev(() => document.querySelector('#settings [data-close="settings"]').click()); await sleep(150);

  // ---------- 1 v 1 vs Hard computer ----------
  await tap('#btn-vs-ai'); await sleep(200);
  ok(await visible('#setup'), 'setup screen');
  await ev(() => document.querySelector('#presets [data-p="1v1"]').click()); await sleep(100);
  await ev(() => document.querySelector('.seg button[data-seat="1"][data-v="hard"]').click()); await sleep(100);
  ok(!(await ev(() => document.getElementById('btn-start').disabled)), '1 v 1: You (Cobalt) vs Jade (Hard) is valid');
  await tap('#btn-start'); await sleep(500);
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
  const gemCheck = await ev(() => {
    const tokens = [...document.querySelectorAll('#pieces .pc')];
    const seats = [...new Set(tokens.map(t => t.dataset.seat))];
    const ready = tokens.every(t => {
      const svg = t.querySelector('.gem-token'), body = svg && svg.querySelector('.gem-body'), pad = svg && svg.querySelector('.gem-pad');
      const size = svg && svg.getBoundingClientRect();
      return t.tagName === 'BUTTON' && !!t.getAttribute('aria-label') && svg.getAttribute('aria-hidden') === 'true' &&
        body && pad && svg.querySelector('.gem-glint') && svg.querySelector('.gem-core') && svg.querySelector('.gem-shadow') &&
        /^fill:url\(#gem-body-/.test(body.getAttribute('style')) && svg.querySelector('linearGradient') && svg.querySelector('radialGradient') && size.width >= 14 && size.height >= 14;
    });
    const coreBySeat = Object.fromEntries(seats.map(s => [s, getComputedStyle(document.querySelector('.pc[data-seat="' + s + '"]')).getPropertyValue('--pccore').trim()]));
    const first = tokens[0], svg = first && first.querySelector('.gem-token'), shadow = svg && svg.querySelector('.gem-shadow');
    const gradient = svg && svg.querySelector('radialGradient');
    const body = svg && svg.querySelector('.gem-body');
    return { ready, seats, tag: body && body.tagName, radius: body && body.getAttribute('r'), glint: svg && svg.querySelector('.gem-glint') && svg.querySelector('.gem-glint').getAttribute('d'),
      rim: !!(svg && svg.querySelector('.gem-rim-outer')), emboss: !!(svg && svg.querySelector('.gem-num-hi')),
      coreStops: gradient ? [...gradient.querySelectorAll('stop')].map(stop => stop.getAttribute('stop-color')) : [],
      shadowFilter: shadow ? getComputedStyle(shadow).filter : '', shadowOpacity: shadow ? getComputedStyle(shadow).opacity : '',
      colors: [...new Set(seats.map(s => getComputedStyle(document.querySelector('.pc[data-seat="' + s + '"]')).getPropertyValue('--pc').trim()))], coreBySeat };
  });
  ok(gemCheck.ready && gemCheck.colors.length === gemCheck.seats.length && gemCheck.coreBySeat['1'] === '#a0ffd2' && gemCheck.coreBySeat['3'] === '#a9ddff', 'circular hero tokens, layered gradients, player-colored pads, and Jade/Cobalt core hues are legible at board size');
  ok(gemCheck.tag === 'circle' && Number(gemCheck.radius) >= 7 && gemCheck.rim && gemCheck.emboss && gemCheck.glint, 'circular crystal body, metallic rim, embossed numeral, and reflection glint stay crisp');
  ok(gemCheck.coreStops[0] === '#fff' && gemCheck.coreStops.includes('var(--pccore)') && gemCheck.shadowFilter.includes('blur(') && Number(gemCheck.shadowOpacity) < .9, 'white-hot radial core glows inside the crystal over a soft contact shadow');
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
  ok(await ev(() => {
    const st = window.__cf.game.st, tokens = [...document.querySelectorAll('#pieces .pc')];
    const legal = new Set(st.moves.filter(m => m.seat === st.turn).map(m => m.seat + ':' + m.piece));
    return st.phase === 'move' && legal.size > 0 && tokens.every(p => {
      const isLegal = legal.has(p.dataset.seat + ':' + p.dataset.piece);
      return p.classList.contains('is-turn') === isLegal && getComputedStyle(p.querySelector('.gem-core')).animationName === (isLegal ? 'gem-core-breathe' : 'none');
    });
  }), 'only currently legal tokens breathe during their owner’s move turn');
  // ---------- undo dice roll ----------
  ok(await ev(() => window.__cf.undoActive), 'undo window open after the roll');
  await tap('#btn-undo'); await sleep(200);
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
  await tap('#btn-chat'); await sleep(150);
  ok(await visible('#chat'), 'quick chat panel opens');
  await ev(() => document.querySelector('#chat-emotes button').click()); await sleep(150);
  ok(await ev(() => { const b = document.querySelector('.pod[data-seat="3"] .bubble'); return b && !b.classList.contains('hidden') && !!b.querySelector('svg'); }), 'emote bubble shows at the human pod');
  if (await visible('#chat')) await tap('#btn-chat');

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
  await tap('#btn-r-home'); await sleep(300);
  ok(await visible('#home'), 'result -> home (no interstitial on first matches)');

  // ---------- Mystery Tiles, 4 players ----------
  await tap('#btn-mystery'); await sleep(200);
  ok(await ev(() => document.querySelector('#mode-seg .on, [data-mode].on') ? true : true) && await visible('#setup'), 'Mystery Tiles setup');
  await ev(() => document.querySelector('#presets [data-p="4"]').click()); await sleep(100);
  await tap('#btn-start'); await sleep(600);
  s = await st();
  ok(s.mode === 'mystery' && s.players.length === 4 && s.tiles.length === 8, 'mystery match: 4 players, 8 mystery tiles');
  ok(await ev(() => document.querySelectorAll('#tiles .tile').length === 8 && document.querySelectorAll('.pod:not(.empty)').length === 4), '8 tiles drawn, 4 player pods with their own dice');
  ok(await ev(() => window.__cf.podOf(3) === 3), 'human still bottom-left in 4-player');
  ok(await ev(() => {
    const seats = [...new Set([...document.querySelectorAll('#pieces .pc')].map(t => t.dataset.seat))];
    const colors = new Set(seats.map(s => getComputedStyle(document.querySelector('.pc[data-seat="' + s + '"]')).getPropertyValue('--pc').trim()));
    const cores = new Set(seats.map(s => getComputedStyle(document.querySelector('.pc[data-seat="' + s + '"]')).getPropertyValue('--pccore').trim()));
    return seats.length === 4 && colors.size === 4 && cores.size === 4 && [...document.querySelectorAll('#pieces .pc .gem-body')].length === 16;
  }), 'all four Lucky-mode seats retain distinct gem and inner-core color mappings');
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
  await ev(() => {
    const probe = window.__pathProbe = { paths: [], steps: [], completes: 0, tileEvents: 0, gemDuringHop: false, landingRipple: false, crystalCalls: 0 };
    const sfx = window.SFX, crystal = sfx.crystal;
    sfx.crystal = function (i) { probe.crystalCalls++; return crystal.call(this, i); };
    probe.restoreCrystal = () => { sfx.crystal = crystal; };
    const animator = window.PathAnimation, animate = animator.animate;
    probe.restoreAnimator = () => { animator.animate = animate; };
    animator.animate = function (opts) {
      probe.paths.push(opts.points.map(p => ({ x: p.x, y: p.y })));
      const step = opts.onStep, complete = opts.onComplete;
      opts.onStep = function (i) { probe.steps.push(i); if (step) step(i); if (opts.el.classList.contains('land') && getComputedStyle(opts.el, '::after').animationName === 'gem-ripple') probe.landingRipple = true; };
      opts.onComplete = function () { probe.completes++; if (complete) complete(); };
      return animate(opts);
    };
    const logic = window.__cf.logic, move = logic.move;
    probe.restoreMove = () => { logic.move = move; };
    logic.move = function () { const result = move.apply(this, arguments); if (result.event) probe.tileEvents++; return result; };
    const token = document.querySelector('.pc[data-seat="3"][data-piece="0"]');
    token.disabled = false;
    token.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    probe.gemDuringHop = token.classList.contains('hop') && !!token.querySelector('.gem-token .gem-body');
    token.disabled = false;
    token.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  });
  await sleep(90); await page.screenshot({ path: OUT + '/cf-crystal-hop.png' });
  ok(await ev(rel => window.__cf.busy && window.__cf.game.st.pieces[3][0] === rel + 3, tileRel), 'rapid second token activation is ignored while the first move owns the input lock');
  await waitFor(() => !document.getElementById('wheel').classList.contains('hidden'), 6000, 'wheel to appear');
  ok(await ev(() => document.getElementById('wheel').classList.contains('boost')), 'landing on "?" spins the Boost wheel');
  await waitFor(() => /\w/.test(document.getElementById('wheel-result').textContent), 6000, 'wheel result');
  await sleep(150);
  await page.screenshot({ path: OUT + '/cf-mystery-wheel.png' });
  await waitFor(() => { const g = window.__cf.game; return document.getElementById('wheel').classList.contains('hidden') && !window.__cf.busy; }, 8000, 'wheel to close');
  await ev(() => { window.__cf.save.settings.fast = true; });
  s = await st();
  ok(s.pieces[3][0] === tileRel + 3, 'Jump 3 event moved the token 3 more squares');
  const movementProbe = await ev(rel => {
    const p = window.__pathProbe;
    const result = { pathLengths: p.paths.map(path => path.length), steps: p.steps.slice(), completes: p.completes, tileEvents: p.tileEvents, gemDuringHop: p.gemDuringHop, landingRipple: p.landingRipple, crystalCalls: p.crystalCalls,
      tileCooling: window.__cf.game.st.tiles.find(t => t.abs === window.__cf.logic.absOf(3, rel)).until > window.__cf.game.st.turnCount };
    p.restoreAnimator(); p.restoreMove(); p.restoreCrystal(); delete window.__pathProbe; return result;
  }, tileRel);
  ok(movementProbe.pathLengths.join() === '2,3' && movementProbe.steps.join() === '0,1,0,1,2' && movementProbe.completes === 2,
    'the legal two-step arrival and three-step tile effect animate in sequence with exact endpoints');
  ok(movementProbe.gemDuringHop, 'crystal token stays visible and elevated during the locked move');
  ok(movementProbe.landingRipple && movementProbe.crystalCalls === 5, 'normal-motion steps add one quiet crystal-clink call and soft landing ripples');
  ok(movementProbe.tileEvents === 1 && movementProbe.tileCooling, 'the tile arrival resolves exactly once and keeps its existing cooldown');

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
  await edit('st.effects = st.effects.filter(function(e){ return !(e.type === "freeze" && e.seat === 3 && e.piece === 0); }); st.effects.push({type:"freeze",seat:3,piece:0,at:st.turnCount});');
  ok(await ev(() => { const p = document.querySelector('.pc[data-seat="3"][data-piece="0"]'); return p.classList.contains('is-frozen') && getComputedStyle(p.querySelector('.gem-frost-wash')).opacity === '1' && getComputedStyle(p.querySelector('.gem-frost-crack')).opacity === '1' && getComputedStyle(p.querySelector('.gem-core')).animationName === 'none'; }), 'existing Freeze state extinguishes the core and shows frost-crack facets');
  await edit('st.effects = st.effects.filter(function(e){ return !(e.type === "freeze" && e.seat === 3 && e.piece === 0); });');
  // let the computers play a little with events on
  await waitFor(() => { const g = window.__cf.game; return g.st.turn !== 3; }, 8000, 'computers take turns');
  await idleHuman('roll', 3);
  ok(true, 'computers played their mystery turns without errors');
  await tap('#btn-home'); await sleep(200);
  await tap('#btn-m-home'); await sleep(300);

  // ---------- Lucky Chaos Ludo, 4 players ----------
  ok(await visible('#btn-lucky') && /Lucky Chaos Ludo/.test(await ev(() => document.getElementById('btn-lucky').textContent)), 'Lucky Chaos Ludo on home screen');
  await tap('#btn-lucky'); await sleep(200);
  ok(await visible('#setup') && (await ev(() => document.getElementById('setup-title').textContent)) === 'Lucky Chaos Ludo' && await ev(() => document.querySelector('#mode-seg [data-mode="lucky"]').classList.contains('on')), 'Lucky Chaos setup selected');
  ok(await visible('#btn-howto'), 'How to play button in Lucky Chaos setup');
  await tap('#btn-howto'); await sleep(200);
  ok(await visible('#rules') && await ev(() => !document.querySelector('.rules-page[data-page="lucky"]').classList.contains('hidden') && document.querySelectorAll('#ev-lboost .ev').length === 6 && document.querySelectorAll('#ev-lchaos .ev').length === 6 && document.querySelectorAll('#ev-mega .ev').length === 6), 'in-game How to play: Boost, Chaos and Mega wheels listed');
  ok(await ev(() => /High Risk \/ High Reward/.test(document.querySelector('.rules-page[data-page="lucky"]').textContent)), 'How to play explains Danger tiles');
  await ev(() => document.querySelector('#rules [data-close="rules"]').click()); await sleep(150);
  await ev(() => document.querySelector('#presets [data-p="4"]').click()); await sleep(100);
  await tap('#btn-start'); await sleep(300);
  if (await visible('#confirm')) { await tap('#confirm-yes'); await sleep(400); }
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
  await waitFor(() => { const p = document.querySelector('.pc[data-seat="3"][data-piece="0"]'); return p && p.classList.contains('is-shielded') && getComputedStyle(p.querySelector('.gem-shield')).opacity === '1' && getComputedStyle(p.querySelector('.gem-shield-glint')).opacity === '1'; }, 2000, 'Shield gem visual transition');
  ok(true, 'existing Shield state renders a translucent glass-bubble guard');

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
  ok(await ev(() => { const e = document.querySelectorAll('#pieces .pc.is-king'); return e.length === 1 && getComputedStyle(e[0].querySelector('.crown')).display !== 'none' && getComputedStyle(e[0].querySelector('.crown')).color === 'rgb(255, 210, 74)' && getComputedStyle(e[0].querySelector('.crown')).animationName === 'crownbob'; }), 'King token wears a floating gold crown');
  await edit('st.effects = st.effects.filter(function(e){ return !((e.type === "shield" && e.seat === 2 && e.piece === 0) || (e.type === "freeze" && e.seat === 1 && e.piece === 0)); }); st.effects.push({type:"shield",seat:2,piece:0,at:st.turnCount}); st.effects.push({type:"freeze",seat:1,piece:0,at:st.turnCount});');
  await page.screenshot({ path: OUT + '/cf-crystal-states.png' });
  await edit('st.effects = st.effects.filter(function(e){ return !((e.type === "shield" && e.seat === 2 && e.piece === 0) || (e.type === "freeze" && e.seat === 1 && e.piece === 0)); });');
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
  await tap('#btn-home'); await sleep(200);
  await tap('#btn-m-home'); await sleep(300);

  // ---------- Pass & Play with Classic house rule ----------
  await tap('#btn-settings'); await sleep(200);
  await ev(() => document.querySelector('#rule-style [data-v="classic"]').click()); await sleep(100);
  await ev(() => document.querySelector('#settings [data-close="settings"]').click()); await sleep(150);
  await tap('#btn-pass'); await sleep(200);
  ok(await ev(() => /Classic/.test(document.getElementById('rules-sum').textContent)), 'setup shows Classic house rule');
  await ev(() => document.querySelector('#presets [data-p="1v1"]').click()); await sleep(100);
  await tap('#btn-start'); await sleep(300);
  if (await visible('#confirm')) { await tap('#confirm-yes'); await sleep(400); }
  s = await st();
  ok(s.players.every(p => s.seats[p].type === 'human') && s.rules.rollStyle === 'classic', 'pass & play: all human seats, classic rules');
  await ev(() => { const c = window.__cf.save.settings; c.fast = true; c.auto = false; });
  ok(s.players.join() === '1,3', '1v1 pass & play seats Jade and Cobalt');
  await edit('st.pieces=[null,[-1,-1,-1,-1],null,[5,-1,-1,-1]]; st.queue=[]; st.moves=[]; st.phase="roll"; st.turn=3; st.sixes=0; st.bonus=0; st.rollAgain=false;');
  await idleHuman('roll', 3);
  const duelRolls = s.rolls, duelTurns = s.turnCount;
  await keyboardMoveToHandoff(3, 1, 'Cobalt to Jade');
  s = await st();
  ok(s.turn === 1 && s.phase === 'roll' && s.pieces[3][0] === 6 && s.rolls === duelRolls + 1 && s.turnCount === duelTurns + 1, 'valid Cobalt move advances exactly one square and hands the turn to Jade');
  await page.screenshot({ path: OUT + '/cf-pass.png' });

  // ---------- v1.3 Quick, Team, rules ----------
  await tap('#btn-home'); await sleep(150); await tap('#btn-m-home'); await sleep(250);
  await tap('#btn-quick'); await sleep(250);
  ok((await ev(() => document.getElementById('setup-title').textContent)) === 'Quick Ludo', 'Quick Ludo setup');
  await ev(() => document.querySelector('#presets [data-p="1v1"]').click()); await sleep(80);
  await tap('#btn-start'); await sleep(300);
  if (await visible('#confirm')) { await tap('#confirm-yes'); await sleep(400); }
  s = await st();
  ok(s.mode === 'quick' && s.pieces[3].length === 2, 'quick match: 2 tokens per player');
  ok(await ev(() => document.querySelectorAll('#pieces .pc').length === 4), '1v1 quick draws 4 tokens');
  await ev(() => { const c = window.__cf.save.settings; c.fast = true; c.auto = false; });
  await edit('st.pieces[3]=[10,-1]; st.queue=[]; st.phase="roll"; st.sixes=0; st.bonus=0; st.turn=3;');
  await idleHuman('roll', 3);
  await ev(() => window.__cf.force([3]));
  await roll(3); await idleHuman('move', 3); await waitUndoGone();
  await tapPiece(3, 0);
  await waitFor(() => !window.__cf.busy && window.__cf.game.st.pieces[3][0] === 13, 8000, 'quick move');
  ok(await ev(() => !!document.querySelector('#pieces .pc.last') && document.querySelectorAll('#trail .trail').length >= 1), 'last move highlights the token and the squares');
  await page.screenshot({ path: OUT + '/cf-quick.png' });
  await tap('#btn-home'); await sleep(150); await tap('#btn-m-home'); await sleep(250);

  await tap('#btn-team'); await sleep(400);
  ok((await ev(() => document.getElementById('setup-title').textContent)) === 'Team Ludo', 'Team Ludo setup');
  await ev(() => document.querySelector('#presets [data-p="4"]').click()); await sleep(80);
  await tap('#btn-start'); await sleep(200);
  if (await visible('#confirm')) { await tap('#confirm-yes'); await sleep(400); }
  s = await st();
  ok(s.mode === 'team' && s.players.length === 4, 'team match is 2v2');
  ok(await ev(() => document.querySelectorAll('.pod:not(.empty) .team').length === 4), 'team badge on every pod');
  await ev(() => window.__cf.edit(st => { st.pieces=[[6,18,-1,-1],[4,22,-1,-1],[9,30,-1,-1],[3,14,-1,-1]]; st.faces=[2,5,3,4]; st.queue=[]; st.phase='roll'; st.sixes=0; st.bonus=0; st.turn=3; }));
  await idleHuman('roll', 3); await sleep(200);
  await page.screenshot({ path: OUT + '/cf-team.png' });
  await tap('#btn-home'); await sleep(150); await tap('#btn-m-home'); await sleep(250);

  await tap('#btn-rules'); await sleep(150);
  await ev(() => document.querySelector('#rules-tabs [data-tab="modes"]').click()); await sleep(80);
  ok(/Quick Ludo/.test(await ev(() => document.querySelector('.rules-page[data-page="modes"]').textContent)) && /Arrow Ludo/.test(await ev(() => document.querySelector('.rules-page[data-page="modes"]').textContent)), 'in-game rules cover the new modes');
  await ev(() => document.querySelector('#rules [data-close="rules"]').click()); await sleep(100);

  await tap('#btn-arrow'); await sleep(200);
  ok(/one-way/.test(await ev(() => document.getElementById('mode-note').textContent)), 'Arrow setup explains one-way tiles');
  await tap('#btn-setup-back'); await sleep(150);
  await tap('#btn-friendly'); await sleep(200);
  ok(/captures are off/i.test(await ev(() => document.getElementById('mode-note').textContent)), 'Friendly setup says captures are off');
  await tap('#btn-setup-back'); await sleep(150);
  // ---------- keyboard focus handoff in four-player pass & play ----------
  if (await visible('#game')) { await page.tap('#btn-home'); await sleep(150); await page.tap('#btn-m-home'); await sleep(250); }
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

  const hapticsPage = await browser.newPage(), hapticErrors = [];
  hapticsPage.on('pageerror', e => hapticErrors.push('pageerror: ' + e.message));
  hapticsPage.on('console', m => { if (m.type() === 'error') hapticErrors.push('console: ' + m.text()); });
  await hapticsPage.evaluateOnNewDocument(() => { window.Capacitor = { isNativePlatform: () => true, Plugins: {} }; });
  await hapticsPage.goto(URL, { waitUntil: 'networkidle0' });
  await hapticsPage.waitForFunction(() => window.__cf && window.__cf.game !== undefined, { timeout: 8000 });
  const hapticChecks = await hapticsPage.evaluate(async () => {
    const c = window.__cf;
    let missingPluginSafe = true;
    try { c.save.settings.haptics = true; c.haptic('light'); } catch (e) { missingPluginSafe = false; }
    let calls = 0;
    window.Capacitor.Plugins.Haptics = {
      impact() { calls++; return Promise.reject(new Error('native haptics unavailable')); },
      notification() { calls++; return Promise.reject(new Error('native haptics unavailable')); }
    };
    c.save.settings.haptics = false; c.haptic('light');
    const disabledSettingBlocks = calls === 0;
    c.save.settings.haptics = true; c.haptic('light');
    await new Promise(resolve => setTimeout(resolve, 20));
    return { native: c.native, missingPluginSafe, disabledSettingBlocks, calls };
  });
  await sleep(30);
  ok(hapticChecks.native && hapticChecks.missingPluginSafe && hapticChecks.disabledSettingBlocks && hapticChecks.calls === 1 && hapticErrors.length === 0,
    'missing or rejecting native haptics fail gracefully, while the haptics setting blocks calls when disabled');
  await hapticsPage.close();

  ok(errors.length === 0, 'no console errors / failed requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\n${n} checks passed`);
  await browser.close();
  global.__dbg = async () => {};
})().catch(async e => { console.error(e.stack || e.message || e); if (process.env.DEBUG && global.__page) { try { console.error(JSON.stringify(await global.__page.evaluate(() => { const c = window.__cf, g = c.game; return g && { st: { turn: g.st.turn, phase: g.st.phase, queue: g.st.queue, pieces: g.st.pieces, tiles: g.st.tiles, turnCount: g.st.turnCount }, busy: c.busy, validGame: c.isValidGame(g), validSave: c.isValidSave(c.save), lastSaveError: c.lastSaveError }; }))); await global.__page.screenshot({ path: '/tmp/cf-fail.png' }); } catch (x) {} } process.exit(1); });
