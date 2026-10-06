'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = process.env.PREVIEW_DIR || path.join(require('node:os').tmpdir(), 'online-classic-accessible-controls');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

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

function installMock(page, phase, origin) {
  return page.evaluateOnNewDocument(testPhase => {
    const match = {
      room_id: 'accessible-room', version: 4,
      state: {
        protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1],
        pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null],
        rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
        turn: 0, phase: testPhase, queue: testPhase === 'move' ? [6] : [], sixes: 0, bonus: 0,
        ranking: [], turn_count: 2, last_roll: testPhase === 'move' ? { seat: 0, face: 6 } : null, last_action: null
      }
    };
    const tables = {
      profiles: [{ id: 'user-one', handle: 'alice123', display_name: 'Alice' }, { id: 'user-two', handle: 'bob123', display_name: 'Bob' }],
      wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
      rooms: [{ id: 'accessible-room', created_by: 'user-one', mode: 'classic', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
      room_members: [{ room_id: 'accessible-room', user_id: 'user-one', seat: 0, role: 'host', ready: true }, { room_id: 'accessible-room', user_id: 'user-two', seat: 1, role: 'member', ready: true }],
      room_invites: [{ room_id: 'accessible-room', invite_code: 'ACCESSIBLE123456' }],
      match_history: [], match_states: [match], ludo_chess_matches: []
    };
    const backend = window.__onlineClassicTest = { tables, rpcCalls: [], channels: [] };
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    function queryBuilder(table) {
      let filters = [], maxRows = null, patch = null, operation = 'select';
      const matches = row => filters.every(filter => filter.type === 'eq'
        ? String(row[filter.key]) === String(filter.value)
        : filter.values.some(value => String(value) === String(row[filter.key])));
      function execute(single) {
        const rows = (backend.tables[table] || []).filter(matches);
        if (operation === 'update') { rows.forEach(row => Object.assign(row, patch)); return { data: null, error: null }; }
        const data = rows.slice(0, maxRows == null ? rows.length : maxRows).map(clone);
        return { data: single ? (data[0] || null) : data, error: null };
      }
      const builder = {
        select() { operation = 'select'; return builder; },
        update(values) { operation = 'update'; patch = values; return builder; },
        eq(key, value) { filters.push({ type: 'eq', key, value }); return builder; },
        in(key, values) { filters.push({ type: 'in', key, values }); return builder; },
        order() { return builder; },
        limit(value) { maxRows = value; return builder; },
        maybeSingle() { return Promise.resolve(execute(true)); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); }
      };
      return builder;
    }
    window.supabase = {
      createClient() {
        const session = { user: { id: 'user-one', email: 'alice@example.test' } };
        return {
          auth: {
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session }, error: null }); },
            signOut() { return Promise.resolve({ error: null }); }
          },
          from: queryBuilder,
          rpc(name, args) {
            backend.rpcCalls.push({ name, args });
            return Promise.resolve({ data: { version: 5, state: match.state }, error: null });
          },
          channel(name) {
            const channel = { name, status: 'SUBSCRIBED', on() { return channel; }, subscribe(callback) { backend.channels.push(channel); if (callback) callback('SUBSCRIBED'); return channel; } };
            return channel;
          },
          removeChannel() { return Promise.resolve('ok'); }
        };
      }
    };
  }, phase);
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    for (const testCase of [{ phase: 'roll', width: 390, height: 844 }, { phase: 'move', width: 1280, height: 900 }]) {
      const page = await browser.newPage();
      const origin = new URL(local.url).origin;
      await page.setViewport({ width: testCase.width, height: testCase.height, isMobile: testCase.width < 500, hasTouch: testCase.width < 500 });
      page.on('pageerror', error => errors.push(error.message));
      await installMock(page, testCase.phase, origin);
      await page.setRequestInterception(true);
      page.on('request', request => {
        const requestUrl = new URL(request.url());
        if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
          request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });" }).catch(() => {});
        } else if (requestUrl.origin === origin) request.continue().catch(() => {});
        else request.abort().catch(() => {});
      });
      await page.goto(local.url, { waitUntil: 'networkidle0' });
      await page.click('#btn-online');
      await page.waitForFunction(() => {
        const controls = document.querySelector('#online-classic-accessible-controls');
        return controls && !controls.classList.contains('hidden') && !document.querySelector('#game').classList.contains('hidden');
      }, { timeout: 15000 });
      const status = await page.$eval('#online-classic-accessible-status', el => el.textContent);
      assert.match(status, /Your turn/);
      await page.screenshot({ path: path.join(previewDir, testCase.width < 500 ? 'online-classic-accessible-controls-mobile.png' : 'online-classic-accessible-controls-desktop.png'), fullPage: true });
      if (testCase.phase === 'roll') {
        assert.deepEqual(await page.$$eval('#online-classic-accessible-actions button', buttons => buttons.map(button => button.textContent)), ['Roll server die']);
        await page.click('#online-classic-accessible-actions button');
        await page.waitForFunction(() => window.__onlineClassicTest.rpcCalls.some(call => call.name === 'roll_match'));
        const action = await page.evaluate(() => window.__onlineClassicTest.rpcCalls.find(call => call.name === 'roll_match'));
        assert.equal(action.args.p_room_id, 'accessible-room');
      } else {
        const labels = await page.$$eval('#online-classic-accessible-actions button', buttons => buttons.map(button => button.getAttribute('aria-label')));
        assert.deepEqual(labels, ['Move token 1 by 6', 'Move token 2 by 6', 'Move token 3 by 6', 'Move token 4 by 6']);
        await page.click('#online-classic-accessible-actions button');
        await page.waitForFunction(() => window.__onlineClassicTest.rpcCalls.some(call => call.name === 'move_match'));
        const action = await page.evaluate(() => window.__onlineClassicTest.rpcCalls.find(call => call.name === 'move_match'));
        assert.equal(action.args.p_piece, 0);
        assert.equal(action.args.p_queue_index, 0);
      }
      await page.close();
    }
    assert.deepEqual(errors, [], 'page has no uncaught JavaScript errors');
    console.log('Online Classic accessible controls browser tests passed. Preview: ' + previewDir);
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
