// Captures raw 1080x1920 screenshots from the real game (360x640 CSS px @3x) for the store kit.
// Usage: PUPPETEER=puppeteer-core node store/capture_screens.js <url> <outdir>
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const L = require('../www/js/logic.js');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const OUT = process.argv[3] || 'store/raw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'crossfour.save.v1';
const H = { type: 'human' }, AI = lv => ({ type: 'ai', level: lv });

function midGame(seats, seed, rolls, human) {
  // play with AI for every seat to get a natural position, then hand the turn to the human seat
  const aiSeats = seats.map(x => x ? AI(x.level || 'hard') : null);
  const st = L.newGame(aiSeats, {}, seed);
  while (st.rolls < rolls && st.phase !== 'over') { if (st.phase === 'roll') L.roll(st); else L.move(st, L.chooseMove(st, 'hard')); }
  st.seats = seats.map(x => x ? { type: x.type, level: x.level || 'medium', name: null } : null);
  st.turn = human; st.phase = 'roll'; st.moves = []; st.sixes = 0; st.dice = 0; st.ranking = [];
  return st;
}
const game = (st, seats) => ({ st, seats, undoLeft: 3, snap: null, coins: 0, doubled: false, counted: false, started: Date.now() });
const base = (extra) => Object.assign({
  coins: 1260, owned: { boards: ['graphite', 'linen', 'walnut', 'aurora'], dice: ['ivory', 'onyx', 'brass', 'frost', 'ember'] }, board: 'graphite', dice: 'ivory',
  settings: { sound: false, haptics: false, auto: true, fast: false },
  setup: { ai: [AI('hard'), AI('medium'), AI('easy'), H], pass: [null, H, null, H], rules: { safeSquares: true, extraOnSix: true, extraOnCapture: true } },
  stats: { played: 48, won: 27, captures: 131, home: 164, sixes: 212, pass: 9, vs: { easy: [12, 10], medium: [15, 9], hard: [12, 5] } },
  game: null, ad: { sessions: 5 }
}, extra || {});

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async n => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
  async function load(save, cont = true) {
    await page.goto(URL + 'privacy.html', { waitUntil: 'networkidle0' });
    await page.evaluate((k, s) => localStorage.setItem(k, JSON.stringify(s)), KEY, save);
    await page.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
    if (cont) { await page.tap('#btn-continue'); await sleep(500); }
  }
  const seats4 = [AI('hard'), AI('medium'), AI('easy'), H];

  // 1) 4-player match vs computer, choosing a piece (graphite)
  {
    const st = midGame(seats4, 31, 150, 3);
    st.pieces[3] = [-1, 14, 33, -1];
    await load(base({ settings: { sound: false, haptics: false, auto: false, fast: false }, game: game(st, seats4) }));
    await page.evaluate(() => window.__cf.force([6])); await page.tap('#dice');
    await page.waitForFunction(() => document.querySelectorAll('.pc.can').length > 1, { timeout: 5000 }); await sleep(250);
    await shot('1-choose');
  }
  // 2) capture moment
  {
    const st = midGame(seats4, 77, 120, 3);
    st.pieces[3] = [20, 56, -1, -1]; st.pieces[1] = [49, 30, -1, -1]; st.pieces[0] = [44, 8, -1, 56]; st.pieces[2] = [12, -1, -1, -1];
    await load(base({ game: game(st, seats4) }));
    await page.evaluate(() => window.__cf.force([3])); await page.tap('#dice');
    await page.waitForFunction(() => document.querySelectorAll('#fx .burst').length > 0, { timeout: 6000 }); await sleep(90);
    await shot('2-capture');
  }
  // 3) Walnut board, 2 players
  {
    const seats2 = [null, AI('hard'), null, H];
    const st = midGame(seats2, 12, 90, 3);
    await load(base({ board: 'walnut', dice: 'brass', game: game(st, seats2) })); await sleep(300);
    await shot('3-walnut');
  }
  // 4) Aurora board, pass & play with 3 humans
  {
    const seats3 = [H, H, null, H];
    const st = midGame(seats3, 5, 110, 0);
    await load(base({ board: 'aurora', dice: 'frost', game: game(st, seats3) })); await sleep(300);
    await shot('4-aurora-pass');
  }
  // 5) setup screen
  { await load(base(), false); await page.tap('#btn-vs-ai'); await sleep(400); await shot('5-setup'); }
  // 6) win screen
  {
    const st = midGame(seats4, 44, 200, 3);
    st.pieces[3] = [56, 56, 56, 55];
    await load(base({ game: game(st, seats4) }));
    await page.evaluate(() => window.__cf.force([1])); await page.tap('#dice');
    await page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'), { timeout: 8000 }); await sleep(700);
    await shot('6-win');
  }
  // 7) skins
  { await load(base({ coins: 420, owned: { boards: ['graphite', 'linen', 'walnut'], dice: ['ivory', 'onyx'] }, board: 'walnut' }), false); await page.tap('#btn-skins'); await sleep(500); await shot('7-skins'); }
  // 8) home (Linen, light)
  { const st = midGame(seats4, 9, 60, 3); await load(base({ board: 'linen', game: game(st, seats4) }), false); await sleep(200); await shot('8-home'); }
  console.log('errors:', errors);
  await browser.close();
})();
