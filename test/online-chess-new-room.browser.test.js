'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-chess-new-room');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404).end('Not found'); return; }
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://new-room-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_new_room_test', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      const roomId = 'finished-chess-room';
      const userId = 'red-user';
      const board = 'rnbqkbnr' + 'pppppppp' + '.'.repeat(32) + 'PPPPPPPP' + 'RNBQKBNR';
      const chessState = {
        protocol: 1, mode: 'ludo_chess', board, turn: 0, phase: 'active', castling: 'KQkq',
        en_passant: -1, halfmove: 0, fullmove: 18, position_history: [board + '|0|KQkq|-1'],
        last_move: { from: 52, to: 36 }, check: false, winner: null, result: null
      };
      const tables = {
        profiles: [
          { id: 'red-user', display_name: 'Red Player', handle: 'redplayer' },
          { id: 'blue-user', display_name: 'Blue Player', handle: 'blueplayer' }
        ],
        wallets: [{ user_id: userId, coins: 25, diamonds: 0 }],
        rooms: [{ id: roomId, created_by: userId, mode: 'ludo_chess', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
        room_members: [
          { room_id: roomId, user_id: 'red-user', seat: 0, role: 'host', ready: true },
          { room_id: roomId, user_id: 'blue-user', seat: 1, role: 'player', ready: true }
        ],
        room_invites: [{ room_id: roomId, inviter_id: userId, invite_code: 'OLDCHESS12345678' }],
        match_history: [{ id: 'history-finished', room_id: roomId, mode: 'ludo_chess', status: 'completed', winner_id: 'red-user', started_at: '2026-10-07T00:00:00.000Z', finished_at: '2026-10-07T00:12:00.000Z' }],
        match_states: [],
        ludo_chess_matches: [{ room_id: roomId, version: 8, state: chessState, draw_offer: null, updated_at: '2026-10-07T00:12:00.000Z' }]
      };
      const mock = window.__newChessRoomTest = { tables, rpcCalls: [], channels: [], pendingCreate: null };
      function clone(value) { return JSON.parse(JSON.stringify(value)); }
      function queryBuilder(table) {
        const filters = [];
        let maxRows = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          let result = (tables[table] || []).filter(matches);
          if (maxRows !== null) result = result.slice(0, maxRows);
          const data = clone(result);
          return Promise.resolve({ data: single ? (data[0] || null) : data, error: null });
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
        const item = {
          name,
          handlers: [],
          on(_type, filter, callback) { item.handlers.push({ filter, callback }); return item; },
          subscribe(callback) { mock.channels.push(item); if (callback) setTimeout(() => callback('SUBSCRIBED'), 0); return item; }
        };
        return item;
      }
      mock.finishGame = function () {
        tables.rooms[0].status = 'completed';
        const match = tables.ludo_chess_matches[0];
        match.version += 1;
        match.state = Object.assign({}, match.state, { phase: 'over', result: 'checkmate', winner: 0, turn: 1, check: true });
        mock.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
          const table = handler.filter && handler.filter.table;
          if (table === 'rooms') handler.callback({ event: 'UPDATE', new: tables.rooms[0] });
          if (table === 'ludo_chess_matches') handler.callback({ event: 'UPDATE', new: match });
        }));
      };
      mock.rejectCreate = function () {
        const pending = mock.pendingCreate;
        if (pending) { mock.pendingCreate = null; pending.reject({ message: 'Temporary room service failure' }); }
      };
      mock.completeCreate = function () {
        const pending = mock.pendingCreate;
        if (!pending) return;
        mock.pendingCreate = null;
        const room = { id: 'new-chess-room', created_by: userId, mode: 'ludo_chess', capacity: 2, status: 'waiting', updated_at: '2026-10-07T00:20:00.000Z' };
        tables.rooms.push(room);
        tables.room_members.push({ room_id: room.id, user_id: userId, seat: 0, role: 'host', ready: true });
        tables.room_invites.push({ room_id: room.id, inviter_id: userId, invite_code: 'NEWCHESS12345678' });
        pending.resolve({ data: { room_id: room.id, invite_code: 'NEWCHESS12345678', status: 'waiting' }, error: null });
      };
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session: { user: { id: userId, email: 'red@example.test' } } }, error: null }); }
            },
            from: queryBuilder,
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
            rpc(name, args) {
              mock.rpcCalls.push({ name, args: clone(args) });
              if (name !== 'create_room') return Promise.resolve({ data: {}, error: null });
              return new Promise((resolve, reject) => { mock.pendingCreate = { resolve, reject }; });
            }
          };
        }
      };
      sessionStorage.setItem('crossfour.online.room', roomId);
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const screen = document.querySelector('#online-chess-screen');
      return screen && !screen.classList.contains('hidden') && document.querySelector('#online-chess-board [data-square]');
    }, { timeout: 15000 });
    assert.equal(await page.$eval('#online-chess-new-room', button => button.classList.contains('hidden')), true, 'the new-room action stays hidden during an active game');

    await page.evaluate(() => {
      if (window.CamelCelebration) window.CamelCelebration.play = function () {};
      window.__newChessRoomTest.finishGame();
    });
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-chess-new-room');
      return button && !button.classList.contains('hidden') && !button.disabled && document.querySelector('#online-chess-next-game-note').textContent.includes('fresh two-player invite room');
    }, { timeout: 10000 });
    assert.match(await page.$eval('#online-chess-result', element => element.textContent), /Checkmate.*wins/);
    await fs.promises.mkdir(previewDir, { recursive: true });
    await page.$eval('#online-chess-screen', element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: path.join(previewDir, 'online-chess-new-room-mobile.png') });
    await page.setViewport({ width: 1440, height: 960, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.$eval('#online-chess-screen', element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(previewDir, 'online-chess-new-room-desktop.png') });
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.$eval('#online-chess-screen', element => { element.scrollTop = element.scrollHeight; });

    await page.click('#online-chess-new-room');
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-chess-new-room');
      return button && button.disabled && button.textContent.includes('Creating');
    }, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__newChessRoomTest.rpcCalls.filter(call => call.name === 'create_room').length), 1, 'one click starts one room creation request');
    assert.deepEqual(await page.evaluate(() => window.__newChessRoomTest.rpcCalls[0].args), { p_mode: 'ludo_chess', p_capacity: 2 }, 'the request is constrained to a fresh two-player Chess room');
    await page.evaluate(() => window.__newChessRoomTest.rejectCreate());
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-chess-new-room');
      return button && !button.disabled && document.querySelector('#online-status').textContent.includes('Temporary room service failure');
    }, { timeout: 5000 });

    await page.click('#online-chess-new-room');
    await page.waitForFunction(() => document.querySelector('#online-chess-new-room').disabled, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__newChessRoomTest.rpcCalls.filter(call => call.name === 'create_room').length), 2, 'a failed request can be retried without duplicating the original');
    await page.evaluate(() => window.__newChessRoomTest.completeCreate());
    await page.waitForFunction(() => {
      const status = document.querySelector('#online-status').textContent;
      const code = document.querySelector('#online-invite-code').value;
      const room = document.querySelector('#online-room-card');
      return status.includes('Copy the invite link to share it') && code === 'NEWCHESS12345678' && room && !room.classList.contains('hidden');
    }, { timeout: 10000 });
    assert.equal(await page.$eval('#online-room-status', element => element.textContent.includes('Waiting for players')), true, 'the completed-game action opens the fresh waiting room');
    assert.equal(await page.evaluate(() => window.__newChessRoomTest.tables.match_history.length), 1, 'the previous match-history record remains unchanged');
    assert.equal(await page.evaluate(() => window.__newChessRoomTest.tables.wallets[0].coins), 25, 'cloud currency is not changed by creating the new room');
    assert.deepEqual(errors, [], 'the browser flow has no JavaScript errors');

    console.log('Online Chess new-room browser checks passed; responsive previews:', previewDir);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exit(1); });
