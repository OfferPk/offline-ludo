'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
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
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errors = [];
    const sdkRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (/supabase-js/.test(request.url())) {
        sdkRequests.push(request.url());
        request.abort().catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      const start = Date.now();
      const matchState = {
        protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1],
        pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null],
        rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
        turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], turn_count: 0,
        last_roll: null, last_action: null, capd: [false, false, false, false], turn_deadline: start + 60000
      };
      const state = window.__mockBackend = {
        session: { user: { id: 'user-one', email: 'alice@example.test' } },
        tables: {
          profiles: [
            { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
            { id: 'user-two', handle: 'bob123', display_name: 'Bob' }
          ],
          wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
          rooms: [{ id: 'active-room', created_by: 'user-two', mode: 'classic', capacity: 2, status: 'active', updated_at: new Date(start).toISOString() }],
          room_members: [
            { room_id: 'active-room', user_id: 'user-one', seat: 0, role: 'player', ready: true },
            { room_id: 'active-room', user_id: 'user-two', seat: 1, role: 'host', ready: true }
          ],
          room_invites: [{ room_id: 'active-room', invite_code: 'ACTIVE1234567890' }],
          match_history: [{ id: 'history-active', room_id: 'active-room', mode: 'classic', status: 'active', winner_id: null, started_at: new Date(start).toISOString(), finished_at: null }],
          match_states: [{ room_id: 'active-room', version: 0, state: matchState }],
          ludo_chess_matches: []
        },
        authListeners: [], channels: [], rpcCalls: []
      };
      function matches(row, filters) {
        return filters.every(filter => filter.kind === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(row[filter.field]) === String(value)));
      }
      function queryBuilder(table) {
        let filters = [];
        let maxRows = null;
        function execute(single) {
          const rows = (state.tables[table] || []).filter(row => matches(row, filters)).map(row => JSON.parse(JSON.stringify(row)));
          const result = maxRows === null ? rows : rows.slice(0, maxRows);
          return Promise.resolve({ data: single ? (result[0] || null) : result, error: null });
        }
        const builder = {
          select() { return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values: Array.from(values || []) }); return builder; },
          order() { return builder; },
          limit(value) { maxRows = value; return builder; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        return builder;
      }
      function makeChannel(name) {
        const channel = {
          name, handlers: [], removed: false,
          on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
          subscribe(callback) { state.channels.push(channel); if (callback) callback('SUBSCRIBED'); return channel; }
        };
        return channel;
      }
      state.emit = function (table, event) {
        state.channels.filter(channel => !channel.removed).forEach(channel => {
          channel.handlers.forEach(handler => {
            const filter = handler.filter || {};
            if (filter.table !== table) return;
            if (filter.event && filter.event !== '*' && event.event && filter.event !== event.event) return;
            if (filter.filter) {
              const match = /^([a-z_]+)=eq\.(.+)$/.exec(filter.filter);
              const row = event.new || event.old || {};
              if (match && String(row[match[1]]) !== match[2]) return;
            }
            handler.callback(event);
          });
        });
      };
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
              signOut() { state.session = null; return Promise.resolve({ error: null }); }
            },
            from: queryBuilder,
            rpc(name, args) { state.rpcCalls.push({ name, args }); return Promise.resolve({ data: null, error: { message: 'Unexpected RPC in navigation-only test: ' + name } }); },
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); }
          };
        }
      };
    });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-room-connection').dataset.state === 'connected');
    await page.waitForFunction(() => !document.querySelector('#game').classList.contains('hidden') && window.__cf && window.__cf.game && window.__cf.game.online);
    assert.equal(await page.$eval('#btn-home', element => element.getAttribute('aria-label')), 'Room details', 'the Classic board navigation control is named for its destination');
    assert.equal(await page.$eval('#online-classic-resume-actions', element => element.classList.contains('hidden')), true, 'the resume action is not shown while the board is already open');

    await page.click('#btn-home');
    await page.waitForFunction(() => document.querySelector('#game').classList.contains('hidden') && !document.querySelector('#online-classic-resume-actions').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'online-classic-resume', 'focus moves to the return-to-board action when room details open');

    await page.evaluate(() => {
      const backend = window.__mockBackend;
      const row = backend.tables.match_states[0];
      const old = JSON.parse(JSON.stringify(row));
      row.version = 1;
      row.state = Object.assign({}, row.state, { turn: 1, phase: 'roll', turn_count: 1, turn_deadline: Date.now() + 45000 });
      backend.emit('match_states', { event: 'UPDATE', old, new: row });
    });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 1');
    assert.equal(await page.$eval('#game', element => element.classList.contains('hidden')), true, 'a realtime match update does not unexpectedly reopen the board');
    assert.equal(await page.evaluate(() => window.__cf.game.st.turn), 1, 'hidden board state and countdown hooks follow the latest server snapshot');

    if (process.env.PREVIEW_DIR) {
      await fs.promises.mkdir(process.env.PREVIEW_DIR, { recursive: true });
      await page.evaluate(() => document.querySelector('#online-classic-resume').scrollIntoView({ block: 'center' }));
      const mobilePreview = path.join(process.env.PREVIEW_DIR, 'online-classic-room-mobile.png');
      await page.screenshot({ path: mobilePreview, fullPage: true });
      await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.evaluate(() => document.querySelector('#online-classic-resume').scrollIntoView({ block: 'center' }));
      const desktopPreview = path.join(process.env.PREVIEW_DIR, 'online-classic-room-desktop.png');
      await page.screenshot({ path: desktopPreview, fullPage: true });
      assert.ok((await fs.promises.stat(mobilePreview)).size > 0 && (await fs.promises.stat(desktopPreview)).size > 0, 'mobile and desktop lobby previews are captured');
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    }

    await page.evaluate(() => document.querySelector('#online-classic-resume').scrollIntoView({ block: 'center' }));
    await page.click('#online-classic-resume');
    await page.waitForFunction(() => !document.querySelector('#game').classList.contains('hidden') && window.__cf.game && window.__cf.game.online && window.__cf.game.st.turn === 1);
    assert.equal(await page.evaluate(() => window.__cf.game.st.turn), 1, 'returning opens the latest server turn, not the stale snapshot');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-home', 'focus returns to the board navigation control after resume');
    assert.deepEqual(errors, [], 'the mocked Online room flow has no uncaught JavaScript errors');
    assert.deepEqual(sdkRequests, [], 'the test makes no external Supabase SDK requests');
    assert.deepEqual(await page.evaluate(() => window.__mockBackend.rpcCalls), [], 'the navigation test performs no room actions');
    console.log('Online Classic board navigation browser test passed (dismiss, realtime update while hidden, and resume on the latest server state).');
    if (process.env.PREVIEW_DIR) console.log('Preview directory:', path.resolve(process.env.PREVIEW_DIR));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
