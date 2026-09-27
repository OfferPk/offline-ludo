// Captures raw 1080x1920 screenshots from the real game (360x640 CSS px @3x) for the store kit (v1.1).
// Usage: PUPPETEER=puppeteer-core node store/capture_screens.js <url> <outdir>
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const OUT = process.argv[3] || 'store/raw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'crossfour.save.v2';
const H = { type: 'human' }, AI = lv => ({ type: 'ai', level: lv });
const baseSave = extra => Object.assign({
  coins: 1260, xp: 2350, owned: { boards: ['graphite', 'linen', 'walnut', 'aurora'], dice: ['ivory', 'onyx', 'brass', 'frost', 'ember'] }, board: 'graphite', dice: 'ivory',
  settings: { sound: false, haptics: false, auto: false, fast: false, undo: true, timer: false, chat: true },
  setup: { ai: [AI('hard'), AI('medium'), AI('easy'), H], pass: [H, null, H, null], mode: { ai: 'classic', pass: 'classic' } },
  stats: { played: 48, won: 27, captures: 131, home: 164, sixes: 212, pass: 9, events: 57, vs: { easy: [12, 10], medium: [15, 9], hard: [12, 5] }, mystery: [11, 6], duel: [20, 13], four: [19, 9] },
  game: null, ad: { sessions: 5 }
}, extra || {});

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const shot = async n => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
  const waitFor = (fn, ms, ...a) => page.waitForFunction(fn, { timeout: ms || 15000, polling: 50 }, ...a);
  const humanIdle = (phase) => waitFor(ph => { const c = window.__cf, g = c.game; return g && !c.busy && g.st.seats[g.st.turn].type === 'human' && g.st.phase === ph && document.getElementById('wheel').classList.contains('hidden'); }, 20000, phase);
  const edit = code => ev(c => window.__cf.edit(new Function('st', c)), code);
  const roll = s => ev(x => document.querySelector('.pod[data-seat="' + x + '"] .pdice').click(), s);
  const tapPiece = async (s, i) => { const p = await ev((a, b) => window.__cf.piecePoint(a, b), s, i); await page.touchscreen.tap(p.x, p.y); };
  const noUndo = () => waitFor(() => !window.__cf.undoActive, 5000);
  async function load(save) {
    await page.goto(URL + 'privacy.html', { waitUntil: 'networkidle0' });
    await ev((k, s) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, KEY, save);
    await page.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  }
  async function start(btn, preset, mode) {
    await page.tap(btn); await sleep(250);
    if (mode) await ev(m => { const b = document.querySelector('#mode-seg [data-v="' + m + '"], [data-mode="' + m + '"]'); if (b) b.click(); }, mode);
    if (preset) await ev(p => document.querySelector('#presets [data-p="' + p + '"]').click(), preset);
    await sleep(100); await page.tap('#btn-start'); await sleep(500);
  }
  const RESET = 'st.queue=[]; st.phase="roll"; st.sixes=0; st.bonus=0; st.turn=3; st.tiles && st.tiles.forEach(t => { t.until = 0; });';

  // 1) 4 players vs computer: per-player dice + stacked 6,6,3 chips
  await load(baseSave());
  await start('#btn-vs-ai', null);
  await humanIdle('roll');
  await edit('st.pieces=[[8,22,-1,57],[3,30,-1,-1],[12,40,-1,-1],[2,17,-1,-1]]; st.faces=[4,2,5,1];' + RESET);
  await humanIdle('roll');
  await ev(() => window.__cf.force([6, 6, 3]));
  for (let k = 0; k < 3; k++) { await roll(3); await sleep(900); }
  await humanIdle('move'); await noUndo(); await ev(() => document.querySelector('.pod[data-seat="3"] .chip-v[data-v="6"]').click()); await sleep(300);
  await shot('1-dice');

  // 2) capture moment (same match)
  await edit('st.pieces=[[8,22,-1,57],[3,30,-1,-1],[12,40,-1,-1],[20,17,-1,-1]];' + RESET);
  await humanIdle('roll');
  // Jade (seat 1) token at 30 -> abs 43; Cobalt (seat 3) at 20 -> abs 7... place Cobalt 3 behind Jade: rel(43) for seat 3 = 4
  await edit('st.pieces=[[8,22,-1,57],[3,30,-1,-1],[12,40,-1,-1],[1,17,-1,-1]];' + RESET);
  await humanIdle('roll'); await ev(() => window.__cf.force([3])); await roll(3); await humanIdle('move'); await noUndo();
  await tapPiece(3, 0);
  await waitFor(() => document.querySelectorAll('#fx .burst').length > 0, 6000); await sleep(90);
  await shot('2-capture');

  // 3) Mystery Tiles wheel (4 players)
  await load(baseSave());
  await start('#btn-mystery', '4', 'mystery');
  await humanIdle('roll');
  const rel = await ev(() => window.__cf.logic.posFromAbs(3, window.__cf.game.st.tiles.find(t => t.kind === 'boost').abs));
  await edit('st.pieces=[[8,22,-1,-1],[3,-1,-1,-1],[12,-1,-1,-1],[' + (rel - 2) + ',30,-1,-1]]; st.faces=[4,2,5,1];' + RESET);
  await humanIdle('roll'); await ev(() => { window.__cf.force([2]); window.__cf.forceEvent('shield'); }); await roll(3); await humanIdle('move'); await noUndo();
  await tapPiece(3, 0);
  await waitFor(() => /\w/.test(document.getElementById('wheel-result').textContent) && !document.getElementById('wheel').classList.contains('hidden'), 8000); await sleep(200);
  await shot('3-wheel');

  // 4) Mystery board with chat bubbles (1 v 1)
  await load(baseSave());
  await start('#btn-mystery', '1v1', 'mystery');
  await humanIdle('roll');
  await edit('st.pieces=[[-1,-1,-1,-1],[5,27,-1,-1],[-1,-1,-1,-1],[9,33,-1,-1]]; st.effects=[{type:"shield",seat:3,piece:1,at:st.turnCount},{type:"freeze",seat:1,piece:0,at:st.turnCount}];' + RESET);
  await humanIdle('roll');
  await page.tap('#btn-chat'); await sleep(200);
  await ev(() => document.querySelector('#chat-phrases button').click());
  await waitFor(() => { const b = document.querySelector('.pod[data-seat="1"] .bubble'); return b && !b.classList.contains('hidden'); }, 8000); await sleep(150);
  await shot('4-chat');

  // 5) Settings: house rules
  await load(baseSave()); await page.tap('#btn-settings'); await sleep(300);
  await ev(() => { const p = document.querySelector('#settings .panel'); p.scrollTop = p.scrollHeight; }); await sleep(200);
  await shot('5-rules');

  // 6) ranked result, 4 players
  await load(baseSave());
  await start('#btn-vs-ai', null);
  await humanIdle('roll');
  await edit('st.pieces=[[57,57,40,20],[57,30,12,-1],[44,8,-1,-1],[57,57,57,54]]; st.ranking=[];' + RESET);
  await humanIdle('roll'); await ev(() => window.__cf.force([3])); await roll(3); await humanIdle('move'); await noUndo();
  await tapPiece(3, 3);
  await waitFor(() => !document.getElementById('result').classList.contains('hidden'), 10000); await sleep(800);
  await shot('6-win');

  // 7) Walnut skin, pass & play
  await load(baseSave({ board: 'walnut', dice: 'brass' }));
  await start('#btn-pass', '4');
  await ev(() => { const g = window.__cf.game; });
  await waitFor(() => { const c = window.__cf; return c.game && !c.busy; });
  await edit('st.pieces=[[6,19,-1,-1],[14,45,-1,-1],[28,-1,-1,52],[33,2,-1,-1]]; st.queue=[]; st.phase="roll"; st.sixes=0; st.bonus=0;');
  await sleep(400);
  await shot('7-walnut');

  // 8) home
  await load(baseSave()); await sleep(200); await shot('8-home');
  console.log('errors:', errors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
