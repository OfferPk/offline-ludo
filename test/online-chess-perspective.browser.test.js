'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || '/tmp/online-chess-perspective';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const initialBoard = 'rnbqkbnr' + 'pppppppp' + '.'.repeat(32) + 'PPPPPPPP' + 'RNBQKBNR';

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
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    async function openAsSeat(seat, viewport) {
      const page = await browser.newPage();
      await page.setViewport(viewport);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.evaluateOnNewDocument((board, initialSeat) => {
        const userId = initialSeat === 1 ? 'blue-user' : 'red-user';
        const state = {
          protocol: 1, mode: 'ludo_chess', board, turn: 1, phase: 'active', castling: 'KQkq', en_passant: -1,
          halfmove: 0, fullmove: 1, position_history: [board + '|1|KQkq|-1'], last_move: null, winner: null, result: null, check: false
        };
        const rows = {
          profiles: [
            { id: 'red-user', handle: 'redplayer', display_name: 'Red Player' },
            { id: 'blue-user', handle: 'blueplayer', display_name: 'Blue Player' }
          ],
          wallets: [{ user_id: 'red-user', coins: 0, diamonds: 0 }, { user_id: 'blue-user', coins: 0, diamonds: 0 }],
          rooms: [{ id: 'perspective-room', created_by: 'red-user', mode: 'ludo_chess', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
          room_members: [
            { room_id: 'perspective-room', user_id: 'red-user', seat: 0, role: 'host', ready: true },
            { room_id: 'perspective-room', user_id: 'blue-user', seat: 1, role: 'player', ready: true }
          ],
          room_invites: [{ room_id: 'perspective-room', inviter_id: 'red-user', invite_code: '0123456789ABCDEF' }],
          match_history: [], match_states: [],
          ludo_chess_matches: [{ room_id: 'perspective-room', version: 1, state, draw_offer: null, updated_at: '2026-10-07T00:00:00.000Z' }]
        };
        const mock = window.__onlinePerspectiveMock = { calls: [], tables: rows };
        function queryBuilder(table) {
          const filters = [];
          let maxRows = null;
          function matches(row) {
            return filters.every(filter => filter.kind === 'eq'
              ? String(row[filter.field]) === String(filter.value)
              : filter.values.some(value => String(value) === String(row[filter.field])));
          }
          function execute(single) {
            const result = (rows[table] || []).filter(matches);
            const limited = maxRows === null ? result : result.slice(0, maxRows);
            return Promise.resolve({ data: single ? (limited[0] || null) : limited.map(row => JSON.parse(JSON.stringify(row))), error: null });
          }
          const builder = {
            select() { return builder; },
            eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
            in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
            order() { return builder; },
            limit(value) { maxRows = value; return builder; },
            maybeSingle() { return execute(true); },
            then(resolve, reject) { return execute(false).then(resolve, reject); }
          };
          return builder;
        }
        function makeChannel(name) {
          return {
            name,
            on() { return this; },
            subscribe(callback) { if (callback) setTimeout(() => callback('SUBSCRIBED'), 0); return this; }
          };
        }
        window.supabase = {
          createClient() {
            return {
              auth: {
                onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
                getSession() { return Promise.resolve({ data: { session: { user: { id: userId, email: userId + '@example.test' } } }, error: null }); }
              },
              from: queryBuilder,
              channel: makeChannel,
              removeChannel() { return Promise.resolve('ok'); },
              rpc(name, args) { mock.calls.push({ name, args }); return Promise.resolve({ data: null, error: { code: 'MOCK', message: 'The preview does not submit server actions.' } }); }
            };
          }
        };
      }, initialBoard, seat);
      await page.goto(local.url + '?seat=' + seat, { waitUntil: 'load', timeout: 30000 });
      await page.click('#btn-online');
      await page.waitForFunction(() => {
        const screen = document.getElementById('online-chess-screen');
        const board = document.querySelector('#online-chess-board [data-square]');
        return screen && !screen.classList.contains('hidden') && board;
      }, { timeout: 15000 });
      return { page, errors };
    }

    const blue = await openAsSeat(1, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const blueView = await blue.page.evaluate(() => {
      const board = document.getElementById('online-chess-board');
      const rows = [...board.querySelectorAll('.online-chess-row')];
      const first = rows[0].firstElementChild;
      const bottomLeft = rows[7].firstElementChild;
      const pawn = board.querySelector('[data-square="8"]');
      return {
        label: board.getAttribute('aria-label'),
        topLeftSquare: Number(first.dataset.square),
        bottomRightSquare: Number(rows[7].lastElementChild.dataset.square),
        topLeftName: first.getAttribute('aria-label'),
        topLeftRank: first.querySelector('.rank-coord').textContent,
        bottomLeftRank: bottomLeft.querySelector('.rank-coord').textContent,
        bottomLeftFile: bottomLeft.querySelector('.file-coord').textContent,
        bluePawnRow: rows.indexOf(pawn.parentElement),
        bluePawnColumn: [...pawn.parentElement.children].indexOf(pawn),
        topRowBluePieces: [...rows[0].children].filter(cell => cell.querySelector('.blue-piece')).length,
        bottomRowBluePieces: [...rows[7].children].filter(cell => cell.querySelector('.blue-piece')).length
      };
    });
    assert.equal(blueView.label, 'Ludo Chess board, Blue side at bottom');
    assert.equal(blueView.topLeftSquare, 63, 'Blue sees h1 at the top-left');
    assert.equal(blueView.bottomRightSquare, 0, 'Blue sees a8 at the bottom-right');
    assert.match(blueView.topLeftName, /Red rook on h1/);
    assert.deepEqual([blueView.topLeftRank, blueView.bottomLeftRank, blueView.bottomLeftFile], ['1', '8', 'h'], 'rank and file coordinates rotate with the board');
    assert.deepEqual([blueView.bluePawnRow, blueView.bluePawnColumn], [6, 7], 'Blue pawn a7 is displayed from Blue’s side');
    assert.equal(blueView.topRowBluePieces, 0);
    assert.equal(blueView.bottomRowBluePieces, 8, 'Blue pieces sit on the bottom row');

    await blue.page.focus('#online-chess-board [data-square="8"]');
    await blue.page.keyboard.press('ArrowLeft');
    assert.equal(await blue.page.evaluate(() => document.activeElement.dataset.square), '9', 'Blue arrow-left follows the visible row');
    await blue.page.keyboard.press('ArrowRight');
    assert.equal(await blue.page.evaluate(() => document.activeElement.dataset.square), '8', 'Blue arrow-right returns to the source square');
    await blue.page.keyboard.press('ArrowUp');
    assert.equal(await blue.page.evaluate(() => document.activeElement.dataset.square), '16', 'Blue arrow-up follows the visible column');
    await blue.page.keyboard.press('ArrowDown');
    assert.equal(await blue.page.evaluate(() => document.activeElement.dataset.square), '8', 'Blue arrow-down returns to the source square');

    await blue.page.click('#online-chess-board [data-square="8"]');
    await blue.page.waitForSelector('#online-chess-board [data-square="24"].is-legal');
    await blue.page.click('#online-chess-board [data-square="24"]');
    await blue.page.waitForFunction(() => window.__onlinePerspectiveMock.calls.some(call => call.name === 'ludo_chess_move'));
    const submittedMove = await blue.page.evaluate(() => window.__onlinePerspectiveMock.calls.find(call => call.name === 'ludo_chess_move').args);
    assert.equal(submittedMove.p_from, 8, 'Blue move uses the original server source square');
    assert.equal(submittedMove.p_to, 24, 'Blue move uses the original server destination square');
    await fs.promises.mkdir(shotDir, { recursive: true });
    await blue.page.screenshot({ path: path.join(shotDir, 'online-chess-blue-mobile.png'), fullPage: true });
    assert.deepEqual(blue.errors, [], 'Blue board has no browser errors');
    await blue.page.close();

    const blueDesktop = await openAsSeat(1, { width: 1440, height: 960, deviceScaleFactor: 1 });
    assert.equal(await blueDesktop.page.$eval('#online-chess-board', board => board.getAttribute('aria-label')), 'Ludo Chess board, Blue side at bottom');
    await blueDesktop.page.screenshot({ path: path.join(shotDir, 'online-chess-blue-desktop.png'), fullPage: true });
    assert.deepEqual(blueDesktop.errors, [], 'Blue desktop board has no browser errors');
    await blueDesktop.page.close();

    const red = await openAsSeat(0, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const redView = await red.page.evaluate(() => {
      const board = document.getElementById('online-chess-board');
      const rows = [...board.querySelectorAll('.online-chess-row')];
      return {
        label: board.getAttribute('aria-label'),
        topLeftSquare: Number(rows[0].firstElementChild.dataset.square),
        bottomRightSquare: Number(rows[7].lastElementChild.dataset.square),
        bottomRowRedPieces: [...rows[7].children].filter(cell => cell.querySelector('.red-piece')).length
      };
    });
    assert.equal(redView.label, 'Ludo Chess board, Red side at bottom');
    assert.equal(redView.topLeftSquare, 0, 'Red keeps the original a8-first orientation');
    assert.equal(redView.bottomRightSquare, 63, 'Red keeps h1 at the bottom-right');
    assert.equal(redView.bottomRowRedPieces, 8, 'Red pieces remain on the bottom row');
    assert.deepEqual(red.errors, [], 'Red board has no browser errors');
    await red.page.close();

    console.log('Online Chess perspective browser checks passed. Preview images:', shotDir);
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
