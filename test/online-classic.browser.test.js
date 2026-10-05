'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || '/workspace/offline-ludo-shots';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, rel);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}
(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#home:not(.hidden)');
    const size = await page.evaluate(() => {
      const cards = ['btn-vs-ai', 'btn-lucky', 'btn-mystery', 'btn-pass'].map(id => document.getElementById(id).getBoundingClientRect());
      const howto = document.getElementById('howto-card').getBoundingClientRect();
      const width = cards[1].right - cards[0].left;
      const height = cards[3].bottom - cards[0].top;
      const glow = getComputedStyle(document.getElementById('howto-card')).boxShadow;
      return { width, height, cardW: howto.width, cardH: howto.height, glow, rows: document.querySelectorAll('#howto-card tbody tr').length };
    });
    assert.ok(Math.abs(size.cardW - size.width) < 2, 'howto card width ' + size.cardW + ' vs ' + size.width);
    assert.ok(Math.abs(size.cardH - size.height) < 2, 'howto card height ' + size.cardH + ' vs ' + size.height);
    assert.ok(/rgb\(/.test(size.glow) || size.glow !== 'none', 'howto card has a glow');
    assert.equal(size.rows, 9, 'Rule / Kaise rows');
    await page.evaluate(() => {
      const L = window.__cf.logic;
      const deadline = Date.now() + 45000;
      window.__moves = [];
      window.__expired = 0;
      window.__cf.presentOnline({
        state: {
          protocol: 1, mode: 'classic', players: [0, 2],
          pieces: [[4, -1, -1, -1], null, [10, -1, -1, -1], null],
          turn: 0, phase: 'move', queue: [3], sixes: 0, bonus: 0, ranking: [],
          rules: Object.assign({}, L.DEFAULT_RULES), capd: [false, false, false, false],
          faces: [6, 1, 4, 1], turn_count: 1, turn_deadline: deadline,
          grace: { seat: 2, until: Date.now() + 20000 }
        },
        mySeat: 0,
        names: { 0: 'You', 2: 'Rival' },
        deadline: deadline,
        grace: { seat: 2, until: Date.now() + 20000 },
        onMove: function (piece, index) { window.__moves.push([piece, index]); },
        onRoll: function () {},
        onExpire: function () { window.__expired++; }
      });
    });
    await page.waitForSelector('#game:not(.hidden) #board');
    const board = await page.evaluate(() => ({
      game: !document.querySelector('#game').classList.contains('hidden'),
      canvas: !!document.querySelector('#board'),
      textHidden: document.querySelector('#online-match-pieces').classList.contains('hidden'),
      timer: document.querySelector('#online-turn-timer').textContent,
      grace: document.querySelector('#online-grace').textContent,
      piece: document.querySelector('#pieces .pc[data-seat="0"][data-piece="0"]') && !document.querySelector('#pieces .pc[data-seat="0"][data-piece="0"]').disabled
    }));
    assert.equal(board.game, true);
    assert.equal(board.canvas, true);
    assert.equal(board.textHidden, true, 'text token panel is hidden');
    assert.match(board.timer, /s$/);
    assert.match(board.grace, /Reconnect window/);
    assert.equal(board.piece, true, 'a legal token is tappable');
    await page.evaluate(() => document.querySelector('#pieces .pc[data-seat="0"][data-piece="0"]').click());
    const moved = await page.evaluate(() => window.__moves.slice());
    assert.deepEqual(moved, [[0, 0]], 'canvas tap sends the legal queue index');
    await page.evaluate(() => {
      const L = window.__cf.logic;
      const st = L.newGame([{ type: 'human' }, null, { type: 'human' }, null], L.DEFAULT_RULES, 9, 'classic');
      st.pieces[0][0] = 4; st.turn = 0; st.phase = 'move'; st.queue = [3];
      st.moves = L.queueMoves(st);
      const res = L.move(st, 0, 3);
      window.__landed = res.to;
      window.__cf.presentOnline({
        state: { players: [0, 2], pieces: st.pieces, turn: st.turn, phase: st.phase, queue: st.queue, rules: st.rules, ranking: st.ranking, faces: [3, 1, 1, 1], capd: st.capd },
        mySeat: 2, names: { 0: 'You', 2: 'Rival' }, onMove: function () {}, onRoll: function () {}
      });
    });
    const second = await page.evaluate(() => ({ to: window.__landed, seen: window.__cf.game.st.pieces[0][0] }));
    assert.equal(second.seen, second.to, 'the other client sees the same landed square');
    await page.click('#btn-game-settings');
    const locked = await page.$eval('#rule-safeSquares', el => el.disabled);
    assert.equal(locked, true, 'house rules lock while the online match is open');
    await page.evaluate(() => document.querySelector('#settings [data-close="settings"]').click());
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = path.join(shotDir, 'v140-online-classic-board.png');
    await page.screenshot({ path: shot });
    const diceShot = path.join(shotDir, 'v140-board-dice.png');
    await page.evaluate(() => {
      document.querySelector('#settings').classList.add('hidden');
      const cube = document.querySelector('#game .pod[data-seat="0"] .cube');
      if (cube) cube.style.transform = 'rotateX(0deg) rotateY(0deg)';
    });
    const box = await page.evaluate(() => {
      const board = document.querySelector('#board-wrap').getBoundingClientRect();
      const die = document.querySelector('#game .pod[data-seat="0"] .pdice').getBoundingClientRect();
      const left = Math.max(0, Math.min(board.left, die.left) - 8);
      const top = Math.max(0, Math.min(board.top, die.top) - 8);
      const right = Math.min(window.innerWidth, Math.max(board.right, die.right) + 8);
      const bottom = Math.min(window.innerHeight, Math.max(board.bottom, die.bottom) + 8);
      return { x: left, y: top, width: right - left, height: bottom - top };
    });
    await page.screenshot({ path: diceShot, clip: box });
    await page.evaluate(() => {
      window.__expired = 0;
      window.__cf.presentOnline({
        state: { players: [0, 2], pieces: [[-1, -1, -1, -1], null, [-1, -1, -1, -1], null], turn: 0, phase: 'roll', queue: [], rules: window.__cf.logic.DEFAULT_RULES, ranking: [], faces: [1, 1, 1, 1], turn_deadline: Date.now() - 1000 },
        mySeat: 0, deadline: Date.now() - 1000, onExpire: function () { window.__expired++; }, onRoll: function () {}, onMove: function () {}
      });
    });
    const expired = await page.evaluate(() => window.__expired);
    assert.equal(expired, 1, 'a past turn deadline fires once');
    assert.deepEqual(errors, []);
    console.log('Online Classic phone checks passed. shots', shot, diceShot);
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
