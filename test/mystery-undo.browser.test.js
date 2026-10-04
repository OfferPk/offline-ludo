// Mystery Tiles undo limits in a real local browser. No rewarded ad is completed or simulated.
// Run: node test/mystery-undo.browser.test.js [chrome-path]
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '../www');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + pathname);
  const target = file === root ? path.join(root, 'index.html') : file;
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(data);
  });
});
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log('  ok - ' + message); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ executablePath: process.argv[2] || process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle0' });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('#btn-pass');
    await page.click('#mode-seg [data-mode="mystery"]');
    await page.click('#presets [data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf && window.__cf.game && window.__cf.game.mode === 'mystery' && !document.querySelector('#game').classList.contains('hidden'));
    await page.evaluate(() => { window.__cf.save.settings.auto = false; window.__cf.save.settings.fast = true; window.__cf.persist(); });
    ok(await page.evaluate(() => {
      const g = window.__cf.game, saved = JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game;
      return g.mysteryUndo.total === 0 && g.mysteryUndo.turn === 0 && g.mysteryUndo.ad === 0 && saved.mysteryUndo.total === 0;
    }), 'new Mystery Tiles match initializes and saves zeroed counters');
    ok(await page.evaluate(() => {
      const note = document.getElementById('undo-limit-note'), button = document.getElementById('btn-undo');
      return !note.classList.contains('hidden') && /Match total: 6\/6/.test(note.textContent) && /This turn: 2\/2/.test(note.textContent) && /Ad claims: 2\/2/.test(note.textContent) && button.getAttribute('aria-describedby') === 'undo-limit-note';
    }), 'visible in-game counts and accessible undo description expose all three Mystery limits');

    async function rollCurrentTurn(value) {
      await page.evaluate(v => {
        const c = window.__cf, seat = c.game.st.turn;
        c.force([v]);
        document.querySelector('.pod[data-seat="' + seat + '"] .pdice').click();
      }, value);
      await page.waitForFunction(() => window.__cf.undoActive && !window.__cf.busy, { timeout: 8000 }).catch(async () => {
        const state = await page.evaluate(() => ({ game: window.__cf.game && { mode: window.__cf.game.mode, turn: window.__cf.game.st.turn, phase: window.__cf.game.st.phase, rolls: window.__cf.game.st.rolls, turnCount: window.__cf.game.st.turnCount }, busy: window.__cf.busy, errors: window.__cf.lastSaveError }));
        throw new Error('roll did not expose undo: ' + JSON.stringify(state));
      });
    }
    async function waitForCounts(total, turn, label) {
      await page.waitForFunction((t, u) => window.__cf.game.mysteryUndo.total === t && window.__cf.game.mysteryUndo.turn === u, {}, total, turn);
      ok(await page.evaluate((t, u) => window.__cf.game.mysteryUndo.total === t && window.__cf.game.mysteryUndo.turn === u, total, turn), label);
    }
    async function commitFreeUndo() {
      await page.evaluate(() => document.getElementById('btn-undo').click());
    }

    await rollCurrentTurn(1);
    await commitFreeUndo();
    await waitForCounts(1, 1, 'only a successfully committed first undo increments match and turn totals');
    ok(await page.evaluate(() => window.__cf.game.undoLeft === 2), 'successful free undo consumes one existing free allowance');
    const savedOnce = await page.evaluate(() => JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game.mysteryUndo);
    ok(savedOnce.total === 1 && savedOnce.turn === 1 && savedOnce.ad === 0, 'committed undo is immediately persisted with the match');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#btn-continue:not(.hidden)');
    await page.click('#btn-continue');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'mystery' && !document.querySelector('#game').classList.contains('hidden'));
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo.total === 1 && window.__cf.game.mysteryUndo.turn === 1 && window.__cf.game.mysteryUndo.ad === 0), 'reload and Continue preserve all saved undo counters');

    await rollCurrentTurn(1);
    await commitFreeUndo();
    await waitForCounts(2, 2, 'undo rewind does not reset the per-turn counter');
    await rollCurrentTurn(1);
    ok(await page.evaluate(() => {
      const button = document.getElementById('btn-undo'), note = document.getElementById('undo-limit-note');
      return button.disabled && /at most 2 successful undos in a single turn/.test(note.textContent) && /Undo limited/.test(document.getElementById('undo-label').textContent);
    }), 'third same-turn undo is disabled with a clear accessible reason');
    await page.evaluate(() => document.getElementById('btn-undo').click());
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo.total === 2 && window.__cf.game.mysteryUndo.turn === 2), 'blocked undo does not consume a counter');
    await page.waitForFunction(() => !window.__cf.undoActive && window.__cf.game.st.turnCount === 1 && window.__cf.game.mysteryUndo.turn === 0, { timeout: 6000 });
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo.total === 2 && window.__cf.game.mysteryUndo.turn === 0 && window.__cf.game.mysteryUndo.turnId === 1), 'per-turn counter resets only after the non-undone game turn advances');

    await rollCurrentTurn(1);
    await commitFreeUndo();
    await waitForCounts(3, 1, 'next actual turn gets a fresh allowance while match total remains');
    await page.evaluate(() => {
      const g = window.__cf.game;
      g.mysteryUndo.ad = 2; // Seed an already-used persisted ad allowance; no ad flow is invoked.
      g.mysteryUndo.total = 3;
      window.__cf.persist();
    });
    await rollCurrentTurn(1);
    ok(await page.evaluate(() => {
      const b = document.getElementById('btn-undo'), note = document.getElementById('undo-limit-note');
      return b.disabled && document.getElementById('undo-ad').classList.contains('hidden') && /at most 2 ad-based undo claims per match/.test(note.textContent);
    }), 'ad redemption is blocked at its cap without invoking or simulating ad completion');

    await page.evaluate(() => { window.__cf.game.mysteryUndo.total = 6; window.__cf.persist(); });
    await rollCurrentTurn(1);
    ok(await page.evaluate(() => {
      const b = document.getElementById('btn-undo'), note = document.getElementById('undo-limit-note');
      return b.disabled && /at most 6 successful undos per match/.test(note.textContent);
    }), 'match-total cap blocks further undo after a committed total of six');
    const atTotalCap = await page.evaluate(() => JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game.mysteryUndo);
    ok(atTotalCap.total === 6 && atTotalCap.ad === 2, 'reload snapshot preserves the total and separate ad cap state');

    async function finishMatchForFlowTest() {
      await page.evaluate(() => window.__cf.edit(st => {
        st.phase = 'over'; st.ranking = st.players.slice(); st.queue = []; st.moves = [];
        st.pieces.forEach(pieces => { if (pieces) pieces.fill(window.__cf.logic.HOME); });
      }));
      await page.waitForSelector('#result:not(.hidden)', { timeout: 5000 });
    }
    await finishMatchForFlowTest();
    await page.click('#btn-r-again');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'mystery' && window.__cf.game.mysteryUndo.total === 0 && window.__cf.game.mysteryUndo.turn === 0 && window.__cf.game.mysteryUndo.ad === 0, { timeout: 8000 });
    ok(true, 'Replay starts a genuinely new Mystery match with fresh counters');

    await finishMatchForFlowTest();
    await page.click('#btn-r-home');
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-vs-ai');
    await page.click('#presets [data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'classic');
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo === undefined && document.getElementById('undo-limit-note').classList.contains('hidden') && document.getElementById('undo-label').textContent === 'Undo (3)'), 'Classic retains its existing undo allowance and no Mystery feedback/counters');

    await finishMatchForFlowTest();
    await page.click('#btn-r-home');
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-pass');
    await page.click('#mode-seg [data-mode="lucky"]');
    await page.click('#presets [data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'lucky');
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo === undefined && document.getElementById('undo-limit-note').classList.contains('hidden') && document.getElementById('undo-label').textContent === 'Undo (3)'), 'Lucky Chaos retains its existing undo allowance and no Mystery feedback/counters');
    ok(errors.length === 0, 'no browser JavaScript errors: ' + (errors.join(' | ') || 'none'));
    console.log('\n' + checks + ' Mystery undo browser checks passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
