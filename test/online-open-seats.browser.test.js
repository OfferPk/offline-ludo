'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-open-seats');
const previewPath = path.join(previewDir, 'online-open-seats-mobile.png');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.resolve(webRoot, relative);
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

async function configureMockPage(page, localOrigin) {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/js/supabase-config.js')) {
      request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });" }).catch(() => {});
    } else if (/supabase-js/.test(request.url())) {
      request.abort().catch(() => {});
    } else if (url.origin === localOrigin) {
      request.continue().catch(() => {});
    } else {
      request.abort().catch(() => {});
    }
  });

  await page.evaluateOnNewDocument(() => {
    const state = window.__mockBackend = {
      session: { user: { id: 'user-one', email: 'alice@example.test' } },
      authListeners: [], channels: [],
      tables: {
        profiles: [
          { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
          { id: 'user-two', handle: 'bob123', display_name: 'Bob' }
        ],
        wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
        rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
      }
    };

    function queryBuilder(table) {
      const filters = [];
      let maxRows = null;
      function execute(single) {
        const rows = (state.tables[table] || []).filter(row => filters.every(filter => filter.kind === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(value) === String(row[filter.field]))));
        const limited = maxRows === null ? rows : rows.slice(0, maxRows);
        const data = limited.map(row => JSON.parse(JSON.stringify(row)));
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
      const channel = {
        name,
        handlers: [],
        on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
        subscribe(callback) { state.channels.push(channel); if (callback) callback('SUBSCRIBED'); return channel; }
      };
      return channel;
    }

    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
            signOut() { state.session = null; state.authListeners.forEach(callback => callback('SIGNED_OUT', null)); return Promise.resolve({ error: null }); }
          },
          from: queryBuilder,
          channel: makeChannel,
          removeChannel(channel) { if (channel) channel.removed = true; },
          rpc(name, args) {
            if (name !== 'create_room') return Promise.resolve({ data: {}, error: null });
            state.tables.rooms = [{ id: 'waiting-room', created_by: 'user-one', mode: args.p_mode, capacity: args.p_capacity, status: 'waiting', updated_at: '2026-10-07T00:00:00.000Z' }];
            state.tables.room_members = [
              { room_id: 'waiting-room', user_id: 'user-two', seat: 2, role: 'member', ready: true },
              { room_id: 'waiting-room', user_id: 'user-one', seat: 0, role: 'host', ready: true }
            ];
            state.tables.room_invites = [{ room_id: 'waiting-room', invite_code: 'TESTROOM12345678' }];
            return Promise.resolve({ data: { room_id: 'waiting-room', status: 'waiting' }, error: null });
          }
        };
      }
    };
  });
  return pageErrors;
}

async function assertRoster(page) {
  const rows = await page.$$eval('#online-room-roster li', items => items.map(item => ({
    name: item.querySelector('b').textContent,
    detail: item.querySelector('small').textContent,
    open: item.classList.contains('is-open'),
    label: item.getAttribute('aria-label')
  })));
  assert.deepEqual(rows, [
    { name: 'Alice', detail: 'Seat 1 · Ready · Host', open: false, label: null },
    { name: 'Open seat', detail: 'Seat 2 · invite a player', open: true, label: 'Seat 2 is open. Invite another player.' },
    { name: 'Bob', detail: 'Seat 3 · Ready', open: false, label: null },
    { name: 'Open seat', detail: 'Seat 4 · invite a player', open: true, label: 'Seat 4 is open. Invite another player.' }
  ], 'waiting roster is seat-ordered and explicitly identifies each vacant seat');
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const localOrigin = new URL(local.url).origin;
    const pageErrors = await configureMockPage(page, localOrigin);
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online').classList.contains('hidden') && !document.querySelector('#online-room-panel').classList.contains('hidden'));
    await page.select('#online-capacity', '4');
    await page.click('#online-create-room');
    await page.waitForFunction(() => {
      const room = document.querySelector('#online-room-card');
      return !document.querySelector('#online').classList.contains('hidden') && room && !room.classList.contains('hidden') && document.querySelectorAll('#online-room-roster li').length === 4;
    });
    await assertRoster(page);

    fs.mkdirSync(previewDir, { recursive: true });
    await page.$eval('#online-room-card', element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: previewPath });

    await page.click('#online-back');
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    assert.deepEqual(pageErrors, [], 'lobby rendering and offline entry have no uncaught browser errors');
    console.log('Online open-seat browser checks passed; offline entry remains available.');
    console.log('Preview:', previewPath);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
