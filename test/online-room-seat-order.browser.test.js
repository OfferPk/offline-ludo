'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'www');
const previewDir = path.join(repoRoot, 'docs', 'previews', 'online-room-seat-order');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/js/supabase-config.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(
          "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://seat-order-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_seat_order_test', emailPasswordEnabled: true });"
        );
        return;
      }
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

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const pageErrors = [];
  const externalRequests = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else {
        externalRequests.push(request.url());
        request.abort().catch(() => {});
      }
    });

    await page.evaluateOnNewDocument(() => {
      const userId = 'seat-order-host';
      const session = { user: { id: userId, email: 'host@example.test' } };
      sessionStorage.setItem('crossfour.online.room', 'seat-order-room');
      const state = window.__seatOrderTest = {
        authListeners: [],
        channels: [],
        tables: {
          profiles: [
            { id: userId, display_name: 'Amina', handle: 'amina' },
            { id: 'seat-order-player-1', display_name: 'Rafi', handle: 'rafi' },
            { id: 'seat-order-player-2', display_name: 'Sara', handle: 'sara' },
            { id: 'seat-order-player-3', display_name: 'Omar', handle: 'omar' }
          ],
          wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
          rooms: [{ id: 'seat-order-room', created_by: userId, mode: 'classic', capacity: 4, status: 'waiting', updated_at: '2026-10-07T00:00:00.000Z' }],
          // Deliberately scrambled: the service does not promise an implicit row order.
          room_members: [
            { room_id: 'seat-order-room', user_id: 'seat-order-player-2', seat: 2, role: 'player', ready: false },
            { room_id: 'seat-order-room', user_id: userId, seat: 0, role: 'host', ready: true },
            { room_id: 'seat-order-room', user_id: 'seat-order-player-3', seat: 3, role: 'player', ready: true },
            { room_id: 'seat-order-room', user_id: 'seat-order-player-1', seat: 1, role: 'player', ready: false }
          ],
          room_invites: [{ room_id: 'seat-order-room', invite_code: 'SEATORDER1234567' }],
          match_history: [], match_states: [], ludo_chess_matches: []
        }
      };
      function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
      function queryBuilder(table) {
        const filters = [];
        let maximum = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          const rows = (state.tables[table] || []).filter(matches).map(clone);
          const limited = maximum === null ? rows : rows.slice(0, maximum);
          return Promise.resolve({ data: single ? (limited[0] || null) : limited, error: null });
        }
        const builder = {
          select() { return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
          order() { return builder; },
          limit(value) { maximum = value; return builder; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        return builder;
      }
      function makeChannel(name) {
        const channel = {
          name, handlers: [], removed: false,
          on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
          subscribe(callback) {
            state.channels.push(channel);
            if (callback) callback('SUBSCRIBED');
            return channel;
          }
        };
        return channel;
      }
      state.emit = function (table, event) {
        state.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
          if (handler.filter && handler.filter.table === table) handler.callback(event);
        }));
      };
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session, error: null } }); },
              signOut() { return Promise.resolve({ error: null }); }
            },
            from: queryBuilder,
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
            rpc() { return Promise.resolve({ data: {}, error: null }); }
          };
        }
      };
    });

    await page.goto(local.url, { waitUntil: 'domcontentloaded' });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const card = document.querySelector('#online-room-card');
      return card && !card.classList.contains('hidden') && card.querySelectorAll('#online-room-roster li').length === 4;
    }, { timeout: 15000 });

    const expectedRows = [
      'Amina|Seat 1 · Ready · Host',
      'Rafi|Seat 2 · Not ready',
      'Sara|Seat 3 · Not ready',
      'Omar|Seat 4 · Ready'
    ];
    const readRows = () => page.$$eval('#online-room-roster li', rows => rows.map(row =>
      Array.from(row.children).map(node => node.textContent).join('|')));
    assert.deepEqual(await readRows(), expectedRows, 'the lobby roster is ordered by assigned seat, not backend row order');

    // Exercise another refresh with the same membership rows in a different order.
    await page.evaluate(() => {
      const table = window.__seatOrderTest.tables.room_members;
      table.reverse();
      window.__seatOrderTest.emit('room_members', { event: 'UPDATE', new: { room_id: 'seat-order-room' } });
    });
    await page.waitForFunction(() => document.querySelectorAll('#online-room-roster li').length === 4);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.deepEqual(await readRows(), expectedRows, 'realtime refreshes preserve a stable seat-based roster order');
    assert.deepEqual(externalRequests, [], 'the browser regression must not contact external services');
    assert.deepEqual(pageErrors, [], 'the Online lobby should load without uncaught browser errors');

    if (process.env.CAPTURE_PREVIEW === '1') {
      fs.mkdirSync(previewDir, { recursive: true });
      await page.$eval('#online-room-card', element => element.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: path.join(previewDir, 'mobile.png'), fullPage: true });
      await page.setViewport({ width: 1440, height: 1000, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.screenshot({ path: path.join(previewDir, 'desktop.png'), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the room card fits desktop width');
    }
    console.log('Online room-seat-order browser regression passed: scrambled membership rows display consistently by seat.');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
