'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return response.writeHead(403).end('Forbidden');
      fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end('Not found');
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

(async () => {
  const local = await startServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const pageErrors = [];
    const dialogMessages = [];
    let dialogAction = 'dismiss';
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', async dialog => {
      dialogMessages.push(dialog.message());
      if (dialogAction === 'accept') await dialog.accept();
      else await dialog.dismiss();
    });
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://resignation-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_resignation_test', emailPasswordEnabled: true });" }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      const roomId = 'chess-resignation-room';
      sessionStorage.setItem('crossfour.online.room', roomId);
      const state = window.__resignationTest = {
        roomId,
        rpcCalls: [],
        authListeners: [],
        channels: [],
        session: { user: { id: 'user-one', email: 'alice@example.test' } },
        tables: {
          profiles: [
            { id: 'user-one', handle: 'alice', display_name: 'Alice' },
            { id: 'user-two', handle: 'bob', display_name: 'Bob' }
          ],
          wallets: [{ user_id: 'user-one', coins: 0, diamonds: 0 }],
          rooms: [{ id: roomId, created_by: 'user-one', mode: 'ludo_chess', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
          room_members: [
            { room_id: roomId, user_id: 'user-one', seat: 0, role: 'host', ready: true },
            { room_id: roomId, user_id: 'user-two', seat: 1, role: 'member', ready: true }
          ],
          room_invites: [{ room_id: roomId, invite_code: 'CHESSTEST1234567' }],
          match_history: [], match_states: [], ludo_chess_matches: []
        }
      };
      function chessMatch() {
        if (!state.tables.ludo_chess_matches.length) {
          const match = window.LudoChess.initialState();
          match.phase = 'active';
          match.turn = 0;
          state.tables.ludo_chess_matches.push({ room_id: roomId, version: 0, state: match, draw_offer: null });
        }
        return state.tables.ludo_chess_matches[0];
      }
      function rowsFor(table) { return table === 'ludo_chess_matches' ? [chessMatch()] : (state.tables[table] || []); }
      function channel(name) {
        const item = { name, handlers: [], on(_type, filter, callback) { item.handlers.push({ filter, callback }); return item; }, subscribe(callback) { state.channels.push(item); if (callback) callback('SUBSCRIBED'); return item; } };
        return item;
      }
      state.emitChessUpdate = function () {
        const row = chessMatch();
        state.channels.filter(item => !item.removed).forEach(item => item.handlers.forEach(handler => {
          if (handler.filter.table === 'ludo_chess_matches') handler.callback({ event: 'UPDATE', new: row });
        }));
      };
      function query(table) {
        let filters = [];
        let limit = null;
        const builder = {
          select() { return builder; },
          eq(field, value) { filters.push(row => String(row[field]) === String(value)); return builder; },
          in(field, values) { filters.push(row => values.some(value => String(value) === String(row[field]))); return builder; },
          order() { return builder; },
          limit(value) { limit = value; return builder; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        function execute(single) {
          return Promise.resolve().then(() => {
            let rows = rowsFor(table).filter(row => filters.every(filter => filter(row)));
            if (limit !== null) rows = rows.slice(0, limit);
            const data = rows.map(row => JSON.parse(JSON.stringify(row)));
            return { data: single ? (data[0] || null) : data, error: null };
          }).then(resolve => resolve, reject => { throw reject; });
        }
        return builder;
      }
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
              signOut() { state.session = null; state.authListeners.forEach(callback => callback('SIGNED_OUT', null)); return Promise.resolve({ error: null }); }
            },
            from: query,
            rpc(name, args) {
              state.rpcCalls.push({ name, args });
              if (name === 'resign_ludo_chess') {
                const match = chessMatch();
                match.state = Object.assign({}, match.state, { phase: 'over', result: 'resignation', winner: 1 });
                match.version += 1;
                return Promise.resolve({ data: { version: match.version, state: match.state, draw_offer: null }, error: null });
              }
              return Promise.resolve({ data: {}, error: null });
            },
            channel,
            removeChannel(item) { item.removed = true; return Promise.resolve('ok'); }
          };
        }
      };
    });

    await page.goto(local.url, { waitUntil: 'load' });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-chess-resign');
      return button && !button.classList.contains('hidden') && !document.querySelector('#online-room-card').classList.contains('hidden');
    }, { timeout: 10000 });

    await page.click('#online-chess-resign');
    await page.waitForFunction(() => window.__resignationTest.rpcCalls.length === 0);
    assert.match(dialogMessages[0], /Resign this Online Chess game\?/);
    assert.match(dialogMessages[0], /opponent will win/i);
    assert.equal(await page.evaluate(() => window.__resignationTest.rpcCalls.filter(call => call.name === 'resign_ludo_chess').length), 0, 'dismissing the confirmation sends no resignation RPC');

    dialogAction = 'accept';
    await page.click('#online-chess-resign');
    await page.waitForFunction(() => window.__resignationTest.rpcCalls.some(call => call.name === 'resign_ludo_chess'), { timeout: 5000 });
    const resignation = await page.evaluate(() => window.__resignationTest.rpcCalls.filter(call => call.name === 'resign_ludo_chess'));
    assert.equal(dialogMessages.length, 2, 'both resignation attempts ask for confirmation');
    assert.equal(resignation.length, 1, 'accepting sends exactly one authoritative resignation request');
    assert.equal(resignation[0].args.p_room_id, 'chess-resignation-room');
    assert.ok(resignation[0].args.p_action_id, 'the confirmed action retains the server idempotency key');
    await page.waitForFunction(() => document.querySelector('#online-match-heading').textContent === 'Game complete', { timeout: 5000 });
    assert.ok(pageErrors.length === 0, 'page has no JavaScript errors: ' + pageErrors.join('; '));
    console.log('Online Chess resignation confirmation browser test passed (cancel sends nothing; confirm sends one server-validated action).');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
