'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'www');
const previewDir = path.join(root, 'docs', 'previews', 'online-classic-result-share');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return response.writeHead(403).end('Forbidden');
      fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end('Not found');
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

function browserFixture() {
  const roomId = 'finished-classic-room';
  const userId = 'user-one';
  const state = {
    protocol: 1, mode: 'classic', players: [0, 1], pieces: [[57, 57, 57, 57], [57, 57, 57, 57], null, null],
    rules: { rollStyle: 'star', safeSquares: true }, turn: 1, phase: 'over', queue: [],
    ranking: [0, 1], abandoned: [], turn_count: 18, last_roll: null, last_action: null
  };
  const tables = {
    profiles: [
      { id: userId, display_name: 'Amina', handle: 'amina' },
      { id: 'user-two', display_name: 'Bilal', handle: 'bilal' }
    ],
    wallets: [{ user_id: userId, coins: 12, diamonds: 0 }],
    rooms: [{ id: roomId, created_by: userId, mode: 'classic', capacity: 2, status: 'completed', updated_at: '2026-10-07T00:00:00.000Z' }],
    room_members: [
      { room_id: roomId, user_id: userId, seat: 0, role: 'host', ready: true },
      { room_id: roomId, user_id: 'user-two', seat: 1, role: 'player', ready: true }
    ],
    room_invites: [{ room_id: roomId, inviter_id: userId, invite_code: 'DONE123456789012' }],
    match_history: [{ id: 'history-one', room_id: roomId, mode: 'classic', status: 'completed', winner_id: userId, started_at: '2026-10-07T00:00:00.000Z', finished_at: '2026-10-07T00:18:00.000Z' }],
    match_states: [{ room_id: roomId, version: 18, state, updated_at: '2026-10-07T00:18:00.000Z' }],
    ludo_chess_matches: []
  };

  window.__resultShareTest = { tables, channels: [], rpcCalls: [], shareCalls: [], clipboard: [] };
  const mock = window.__resultShareTest;
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function matches(row, filters) {
    return filters.every(filter => filter.kind === 'eq'
      ? String(row[filter.field]) === String(filter.value)
      : filter.values.some(value => String(value) === String(row[filter.field])));
  }
  function queryBuilder(table) {
    const filters = [];
    let maxRows = null;
    let orderBy = null;
    function execute(single) {
      let result = (tables[table] || []).filter(row => matches(row, filters));
      if (orderBy) result = result.slice().sort((a, b) => String(a[orderBy.field] || '').localeCompare(String(b[orderBy.field] || '')) * (orderBy.ascending ? 1 : -1));
      if (maxRows !== null) result = result.slice(0, maxRows);
      const data = clone(result);
      return Promise.resolve({ data: single ? (data[0] || null) : data, error: null });
    }
    const builder = {
      select() { return builder; },
      eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
      in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
      order(field, options) { orderBy = { field, ascending: !!(options && options.ascending) }; return builder; },
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
      subscribe(callback) { mock.channels.push(channel); if (callback) setTimeout(() => callback('SUBSCRIBED'), 0); return channel; }
    };
    return channel;
  }
  mock.emit = function (table, event) {
    mock.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
      if (handler.filter && handler.filter.table === table) handler.callback(event || { event: 'UPDATE', new: tables[table][0] });
    }));
  };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { mock.clipboard.push(text); }
  } });
  sessionStorage.setItem('crossfour.online.room', roomId);
  window.supabase = {
    createClient() {
      return {
        auth: {
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          getSession() { return Promise.resolve({ data: { session: { user: { id: userId, email: 'amina@example.test' } } }, error: null }); }
        },
        from: queryBuilder,
        channel: makeChannel,
        removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
        rpc(name, args) { mock.rpcCalls.push({ name, args: clone(args) }); return Promise.resolve({ data: {}, error: null }); }
      };
    }
  };
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://result-share-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_result_share_test', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await page.evaluateOnNewDocument(browserFixture);
    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const panel = document.querySelector('#online-match-panel');
      const button = document.querySelector('#online-classic-result-share-button');
      return panel && !panel.classList.contains('hidden') && button && !button.closest('.online-classic-result-share-actions').classList.contains('hidden');
    }, { timeout: 15000 });
    await page.click('#btn-home');
    await page.waitForFunction(() => document.querySelector('#game').classList.contains('hidden') && !document.querySelector('#online').classList.contains('hidden'));
    const initial = await page.evaluate(() => ({
      summary: document.querySelector('#online-match-turn').textContent,
      role: document.querySelector('#online-classic-result-share-button').getAttribute('aria-label'),
      height: document.querySelector('#online-classic-result-share-button').getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth
    }));
    assert.match(initial.summary, /Match complete/);
    assert.equal(initial.role, 'Share the completed Online Classic result');
    assert.ok(initial.height >= 44, 'the result-sharing action has a mobile-friendly touch target');
    assert.equal(initial.overflow, false, 'the completed room fits a narrow mobile viewport');
    fs.mkdirSync(previewDir, { recursive: true });
    await page.$eval('#online-match-panel', element => element.scrollIntoView({ block: 'center' }));
    await (await page.$('#online-match-panel')).screenshot({ path: path.join(previewDir, 'online-classic-result-share-mobile.png') });
    await page.setViewport({ width: 1440, height: 960, isMobile: false, deviceScaleFactor: 1 });
    await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online-classic-result-share-actions').classList.contains('hidden'));
    await page.click('#btn-home');
    await page.waitForFunction(() => document.querySelector('#game').classList.contains('hidden') && !document.querySelector('#online').classList.contains('hidden'));
    await page.$eval('#online-match-panel', element => element.scrollIntoView({ block: 'center' }));
    await (await page.$('#online-match-panel')).screenshot({ path: path.join(previewDir, 'online-classic-result-share-desktop.png') });

    await page.evaluate(() => Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async payload => {
        window.__resultShareTest.shareCalls.push(payload);
        window.__resultShareTest.shareWasActive = navigator.userActivation && navigator.userActivation.isActive;
      }
    }));
    await page.click('#online-classic-result-share-button');
    await page.waitForFunction(() => document.querySelector('#online-classic-result-share-status').textContent === 'Result shared.');
    const nativePayload = await page.evaluate(() => window.__resultShareTest.shareCalls[0]);
    assert.equal(nativePayload.title, 'Online Classic Ludo result');
    assert.equal(nativePayload.text, 'Online Classic Ludo — final result\n1st — Amina\n2nd — Bilal');
    assert.equal(await page.evaluate(() => window.__resultShareTest.shareWasActive), true, 'the native share call retains the tap’s transient user activation');
    assert.deepEqual(await page.evaluate(() => window.__resultShareTest.clipboard), [], 'native sharing does not copy or publish a second time');

    await page.evaluate(() => Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { throw new DOMException('Dismissed', 'AbortError'); }
    }));
    const clipboardBeforeCancel = await page.evaluate(() => window.__resultShareTest.clipboard.length);
    await page.click('#online-classic-result-share-button');
    await page.waitForFunction(() => document.querySelector('#online-classic-result-share-status').textContent === 'Share cancelled.');
    assert.equal(await page.evaluate(() => window.__resultShareTest.clipboard.length), clipboardBeforeCancel, 'cancelling the share sheet does not copy unexpectedly');

    await page.evaluate(() => Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { throw new Error('Share is unavailable'); }
    }));
    await page.click('#online-classic-result-share-button');
    await page.waitForFunction(() => document.querySelector('#online-classic-result-share-status').textContent === 'Result copied to clipboard.');
    assert.equal((await page.evaluate(() => window.__resultShareTest.clipboard)).at(-1), nativePayload.text, 'a failed share sheet falls back to the clipboard');

    await page.evaluate(() => {
      delete navigator.share;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard unavailable'); } } });
    });
    await page.click('#online-classic-result-share-button');
    await page.waitForFunction(() => !document.querySelector('#online-classic-result-share-text').classList.contains('hidden'));
    const manualFallback = await page.evaluate(() => ({
      value: document.querySelector('#online-classic-result-share-text').value,
      selected: document.activeElement.id === 'online-classic-result-share-text' && document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd > 0,
      selectionMode: getComputedStyle(document.querySelector('#online-classic-result-share-text')).userSelect,
      status: document.querySelector('#online-classic-result-share-status').textContent
    }));
    assert.equal(manualFallback.value, nativePayload.text);
    assert.equal(manualFallback.selected, true, 'when both share and clipboard are unavailable, the summary is focused and selected for manual copying');
    assert.equal(manualFallback.selectionMode, 'text', 'the manual-copy field overrides the app-wide unselectable text style');
    assert.match(manualFallback.status, /select and copy/i);

    await page.evaluate(() => {
      const fixture = window.__resultShareTest;
      fixture.tables.match_states[0].state = Object.assign({}, fixture.tables.match_states[0].state, { phase: 'roll', ranking: [] });
      fixture.emit('match_states');
    });
    await page.waitForFunction(() => document.querySelector('#online-classic-result-share-actions').classList.contains('hidden'));
    assert.deepEqual(await page.evaluate(() => window.__resultShareTest.rpcCalls), [], 'sharing the local summary makes no room, currency, or match RPC calls');
    assert.deepEqual(errors, [], 'the Online result-sharing interaction has no uncaught browser errors');
    console.log('Online Classic result-share browser checks passed. Previews:', previewDir);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
