// Mystery Tiles undo limits and soft-wallet payment in a real local browser.
// No rewarded ad is completed or simulated. Run: node test/mystery-undo.browser.test.js [chrome-path]
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
      return g.mysteryUndo.total === 0 && g.mysteryUndo.turn === 0 && g.mysteryUndo.ad === 0 && g.undoLeft === 0 && saved.mysteryUndo.total === 0 && saved.undoLeft === 0;
    }), 'new Mystery match starts with zero counters and no free undo credits');
    ok(await page.evaluate(() => {
      const note = document.getElementById('undo-limit-note'), button = document.getElementById('btn-undo');
      return !note.classList.contains('hidden') && note.scrollHeight <= note.clientHeight && /25 coins/.test(note.textContent) && /Match 6 left/.test(note.textContent) && /Turn 2 left/.test(note.textContent) && /Ads 2 left/.test(note.textContent) && button.getAttribute('aria-describedby') === 'undo-limit-note';
    }), 'visible in-game price and remaining caps are associated with the accessible undo control');

    async function setWallet(coins) {
      await page.evaluate(value => {
        const c = window.__cf; c.save.coins = value; c.persist();
        document.querySelectorAll('.coins-val').forEach(el => { el.textContent = value; });
      }, coins);
    }
    async function rollCurrentTurn(value = 1) {
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
    async function openChoice() {
      await page.evaluate(() => document.getElementById('btn-undo').click());
      await page.waitForSelector('#undo-choice:not(.hidden)');
    }
    async function commitCoinUndo() {
      await openChoice();
      await page.waitForFunction(() => !document.getElementById('btn-undo-coins').disabled);
      await page.evaluate(() => document.getElementById('btn-undo-coins').click());
    }
    async function waitForCounts(total, turn, label) {
      await page.waitForFunction((t, u) => window.__cf.game.mysteryUndo.total === t && window.__cf.game.mysteryUndo.turn === u, {}, total, turn);
      ok(await page.evaluate((t, u) => window.__cf.game.mysteryUndo.total === t && window.__cf.game.mysteryUndo.turn === u, total, turn), label);
    }
    async function waitForTurnReset(turnId, label) {
      await page.waitForFunction(id => {
        const g = window.__cf.game;
        return g.st.turnCount === id && g.mysteryUndo.turnId === id && g.mysteryUndo.turn === 0 && !window.__cf.undoActive;
      }, { timeout: 9000 }, turnId);
      ok(true, label);
    }

    await setWallet(200);
    await rollCurrentTurn(1);
    await commitCoinUndo();
    await waitForCounts(1, 1, 'a committed 25-coin undo increments match and turn counts once');
    ok(await page.evaluate(() => window.__cf.save.coins === 175), 'coin undo deducts exactly 25 from the existing offline soft wallet');
    ok(await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('crossfour.save.v3')).payload;
      return saved.coins === 175 && saved.game.mysteryUndo.total === 1 && saved.game.mysteryUndo.turn === 1;
    }), 'wallet deduction and undo counters persist together in one match save');
    await page.evaluate(() => document.getElementById('btn-undo-coins').click());
    ok(await page.evaluate(() => window.__cf.save.coins === 175 && window.__cf.game.mysteryUndo.total === 1), 'retrying the consumed coin-choice callback cannot double-charge or duplicate the undo');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#btn-continue:not(.hidden)');
    await page.click('#btn-continue');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'mystery' && !document.querySelector('#game').classList.contains('hidden'));
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo.total === 1 && window.__cf.game.mysteryUndo.turn === 1 && window.__cf.game.undoLeft === 0 && window.__cf.save.coins === 175), 'reload and Continue preserve counters, wallet balance, and Mystery no-free-undo policy');

    await rollCurrentTurn(1);
    await commitCoinUndo();
    await waitForCounts(2, 2, 'a second coin undo in the same turn consumes the shared allowance');
    ok(await page.evaluate(() => window.__cf.save.coins === 150), 'second successful coin undo charges another exact 25 coins');
    await rollCurrentTurn(1);
    ok(await page.evaluate(() => {
      const button = document.getElementById('btn-undo'), note = document.getElementById('undo-limit-note');
      return button.disabled && /at most 2 successful undos in a single turn/.test(note.textContent) && /Undo limited/.test(document.getElementById('undo-label').textContent);
    }), 'third same-turn undo is disabled with an accessible shared-cap explanation');
    await page.evaluate(() => document.getElementById('btn-undo').click());
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo.total === 2 && window.__cf.game.mysteryUndo.turn === 2 && window.__cf.save.coins === 150), 'blocked third undo consumes neither coins nor counters');
    await waitForTurnReset(1, 'per-turn counter resets only after the non-undone turn advances');

    await rollCurrentTurn(1);
    await commitCoinUndo();
    await waitForCounts(3, 1, 'next actual turn receives a fresh allowance while match total remains');
    await rollCurrentTurn(1);
    await waitForTurnReset(2, 'another actual turn advance resets only per-turn usage');

    await setWallet(24);
    await rollCurrentTurn(1);
    await openChoice();
    ok(await page.evaluate(() => {
      const coin = document.getElementById('btn-undo-coins'), ad = document.getElementById('btn-undo-ad-choice'), detail = document.getElementById('undo-choice-status').textContent;
      return coin.disabled && /25 coins/.test(coin.getAttribute('aria-label')) && /current balance is 24/.test(detail) && !ad.disabled;
    }), 'insufficient balance disables the coin route accessibly while the free-ad alternative remains available');
    await page.evaluate(() => document.getElementById('btn-undo-coins').click());
    ok(await page.evaluate(() => window.__cf.save.coins === 24 && window.__cf.game.mysteryUndo.total === 3 && window.__cf.game.mysteryUndo.turn === 0), 'insufficient-balance attempt is atomic and consumes nothing');
    await page.click('#btn-undo-cancel');
    await waitForTurnReset(3, 'canceling the route choice does not itself reset or spend undo allowance');

    await page.evaluate(() => {
      const g = window.__cf.game;
      g.mysteryUndo.ad = 2; // Seed used ad claims; no ad flow is invoked.
      window.__cf.persist();
    });
    await rollCurrentTurn(1);
    ok(await page.evaluate(() => {
      const b = document.getElementById('btn-undo'), note = document.getElementById('undo-limit-note');
      return b.disabled && note.scrollHeight <= note.clientHeight && /Need 25 coins; current balance is 24/.test(note.textContent) && /at most 2 ad-based undo claims per match/.test(note.textContent) && document.getElementById('undo-ad').classList.contains('hidden');
    }), 'no coins plus a capped ad route disables undo and explains both blockers');
    await page.evaluate(() => document.getElementById('btn-undo').click());
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo.total === 3 && window.__cf.game.mysteryUndo.ad === 2 && window.__cf.save.coins === 24), 'blocked coin/ad routes do not invoke an ad or alter wallet/counters');
    await waitForTurnReset(4, 'a later non-undone game turn advances after routes are unavailable');

    await setWallet(25);
    await rollCurrentTurn(1);
    await openChoice();
    ok(await page.evaluate(() => !document.getElementById('btn-undo-coins').disabled && document.getElementById('btn-undo-ad-choice').disabled && /2 ad-based undo claims/.test(document.getElementById('btn-undo-ad-choice').title)), 'ad cap disables only ad redemption while a 25-coin route remains enabled');
    await page.evaluate(() => document.getElementById('btn-undo-coins').click());
    await waitForCounts(4, 1, 'coin-paid undo remains commit-able after both ad claims are used');
    ok(await page.evaluate(() => window.__cf.save.coins === 0 && window.__cf.game.mysteryUndo.ad === 2), 'coin route reaches zero exactly and leaves ad counter unchanged');

    await rollCurrentTurn(1);
    await waitForTurnReset(5, 'a committed-coin match can advance to another actual turn');
    await setWallet(25);
    await rollCurrentTurn(1);
    await commitCoinUndo();
    await waitForCounts(5, 1, 'fifth successful undo commits on a later turn');
    ok(await page.evaluate(() => window.__cf.save.coins === 0), 'fifth undo cannot overdraw a 25-coin wallet');

    await rollCurrentTurn(1);
    await waitForTurnReset(6, 'actual turn advancement still resets usage before the final undo');
    await setWallet(25);
    await rollCurrentTurn(1);
    await commitCoinUndo();
    await waitForCounts(6, 1, 'sixth successful undo reaches the match cap');
    await rollCurrentTurn(1);
    ok(await page.evaluate(() => {
      const b = document.getElementById('btn-undo'), note = document.getElementById('undo-limit-note');
      return b.disabled && /at most 6 successful undos per match/.test(note.textContent);
    }), 'match cap disables all further undo routes even with coins available');
    const atTotalCap = await page.evaluate(() => JSON.parse(localStorage.getItem('crossfour.save.v3')).payload);
    ok(atTotalCap.coins === 0 && atTotalCap.game.mysteryUndo.total === 6 && atTotalCap.game.mysteryUndo.ad === 2, 'total cap, ad cap and wallet balance persist together after reload');

    async function finishMatchForFlowTest() {
      await page.evaluate(() => window.__cf.edit(st => {
        st.phase = 'over'; st.ranking = st.players.slice(); st.queue = []; st.moves = [];
        st.pieces.forEach(pieces => { if (pieces) pieces.fill(window.__cf.logic.HOME); });
      }));
      await page.waitForSelector('#result:not(.hidden)', { timeout: 5000 });
    }
    await finishMatchForFlowTest();
    await page.click('#btn-r-again');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'mystery' && window.__cf.game.mysteryUndo.total === 0 && window.__cf.game.mysteryUndo.turn === 0 && window.__cf.game.mysteryUndo.ad === 0 && window.__cf.game.undoLeft === 0, { timeout: 8000 });
    ok(true, 'Replay starts a genuinely new Mystery match with fresh paid-route counters');

    await finishMatchForFlowTest();
    await page.click('#btn-r-home');
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-vs-ai');
    await page.click('#presets [data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'classic');
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo === undefined && document.getElementById('undo-limit-note').classList.contains('hidden') && document.getElementById('undo-label').textContent === 'Undo (3)'), 'Classic keeps its existing free allowance and no Mystery wallet rules');

    await finishMatchForFlowTest();
    await page.click('#btn-r-home');
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-pass');
    await page.click('#mode-seg [data-mode="lucky"]');
    await page.click('#presets [data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.mode === 'lucky');
    ok(await page.evaluate(() => window.__cf.game.mysteryUndo === undefined && document.getElementById('undo-limit-note').classList.contains('hidden') && document.getElementById('undo-label').textContent === 'Undo (3)'), 'Lucky Chaos keeps its existing free allowance and no Mystery wallet rules');
    ok(errors.length === 0, 'no browser JavaScript errors: ' + (errors.join(' | ') || 'none'));
    console.log('\n' + checks + ' Mystery undo browser checks passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
