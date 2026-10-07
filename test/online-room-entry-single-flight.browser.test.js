'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-room-entry-single-flight');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end('Forbidden'); return; }
      fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404).end('Not found'); return; }
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function installClientMock(page) {
  await page.evaluateOnNewDocument(() => {
    const userId = 'entry-test-user';
    const tables = {
      profiles: [{ id: userId, display_name: 'Amina', handle: 'amina' }],
      wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
      rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
    };
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    const mock = window.__mockEntryBackend = { userId, tables, channels: [], rpcCalls: [], failFirstCreate: true, releaseFirstCreate: null, failLegacyFallback: true, releaseLegacyFallback: null };

    function queryBuilder(table) {
      const filters = [];
      let maxRows = null;
      function matches(row) {
        return filters.every(filter => filter.kind === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(value) === String(row[filter.field])));
      }
      function execute(single) {
        const rows = (tables[table] || []).filter(matches);
        const limited = maxRows === null ? rows : rows.slice(0, maxRows);
        const data = limited.map(clone);
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
        name, handlers: [],
        on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
        subscribe(callback) { mock.channels.push(channel); if (callback) setTimeout(() => callback('SUBSCRIBED'), 0); return channel; }
      };
      return channel;
    }

    function addWaitingRoom(roomId) {
      tables.rooms.push({ id: roomId, created_by: userId, mode: 'classic', capacity: 2, status: 'waiting', updated_at: '2026-10-07T00:00:00.000Z' });
      tables.room_members.push({ room_id: roomId, user_id: userId, seat: 0, role: 'host', ready: false });
      tables.room_invites.push({ room_id: roomId, inviter_id: userId, invite_code: 'ROOMENTRY1234567' });
    }

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
          rpc(name, args) {
            mock.rpcCalls.push({ name, args });
            if (name === 'create_room' && mock.failFirstCreate) {
              mock.failFirstCreate = false;
              return new Promise(resolve => { mock.releaseFirstCreate = () => resolve({ data: null, error: { message: 'Could not find the function public.create_room for p_rules.' } }); });
            }
            if (name === 'create_room' && !args.p_rules && mock.failLegacyFallback) {
              mock.failLegacyFallback = false;
              return new Promise(resolve => { mock.releaseLegacyFallback = () => resolve({ data: null, error: { message: 'The legacy room service is temporarily unavailable.' } }); });
            }
            if (name === 'quick_match') {
              const roomId = 'entry-guard-retry-room';
              addWaitingRoom(roomId);
              return Promise.resolve({ data: { room_id: roomId, status: 'waiting' }, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Unexpected mocked RPC: ' + name } });
          }
        };
      }
    };
  });
}

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  const externalRequests = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://entry-guard-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_entry_test', emailPasswordEnabled: true });" }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });
    await installClientMock(page);
    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online-room-panel').classList.contains('hidden')
      && !document.querySelector('#online-create-room').disabled
      && !document.querySelector('#online-quick-match').disabled, { timeout: 15000 });

    await page.evaluate(() => {
      document.querySelector('#online-create-room').click();
      document.querySelector('#online-quick-match').click();
      document.querySelector('#online-create-room').click();
    });
    const pending = await page.evaluate(() => ({
      calls: window.__mockEntryBackend.rpcCalls.map(call => call.name),
      firstCallHasRules: !!window.__mockEntryBackend.rpcCalls[0].args.p_rules,
      createDisabled: document.querySelector('#online-create-room').disabled,
      quickDisabled: document.querySelector('#online-quick-match').disabled,
      createBusy: document.querySelector('#online-create-room').getAttribute('aria-busy'),
      quickBusy: document.querySelector('#online-quick-match').getAttribute('aria-busy'),
      createText: document.querySelector('#online-create-room').textContent,
      quickText: document.querySelector('#online-quick-match').textContent,
      status: document.querySelector('#online-status').textContent
    }));
    assert.deepEqual(pending.calls, ['create_room'], 'same-task double-clicks and a cross-action quick-match click issue exactly one room-entry RPC');
    assert.equal(pending.firstCallHasRules, true, 'the initial request preserves the selected locked rules');
    assert.equal(pending.createDisabled, true, 'create button is disabled while its request is pending');
    assert.equal(pending.quickDisabled, true, 'quick-match button is disabled while a room-entry request is pending');
    assert.equal(pending.createBusy, 'true', 'create button exposes its pending state to assistive technology');
    assert.equal(pending.quickBusy, 'true', 'quick-match button exposes its pending state to assistive technology');
    assert.equal(pending.createText, 'Creating room…', 'the selected action has visible progress feedback');
    assert.equal(pending.quickText, 'Find a table', 'the other action keeps its original label while disabled');
    assert.match(pending.status, /creating an invite room/i, 'the live status announces the pending action');

    await fs.promises.mkdir(previewDir, { recursive: true });
    const onlineScreen = await page.$('#online');
    await onlineScreen.screenshot({ path: path.join(previewDir, 'mobile-pending.png') });

    await page.evaluate(() => window.__mockEntryBackend.releaseFirstCreate());
    await page.waitForFunction(() => window.__mockEntryBackend.rpcCalls.length === 2, { timeout: 8000 });
    const fallbackPending = await page.evaluate(() => ({
      names: window.__mockEntryBackend.rpcCalls.map(call => call.name),
      fallbackHasRules: Object.prototype.hasOwnProperty.call(window.__mockEntryBackend.rpcCalls[1].args, 'p_rules'),
      createDisabled: document.querySelector('#online-create-room').disabled,
      quickDisabled: document.querySelector('#online-quick-match').disabled,
      createBusy: document.querySelector('#online-create-room').getAttribute('aria-busy')
    }));
    assert.deepEqual(fallbackPending.names, ['create_room', 'create_room'], 'the compatibility fallback remains the sole follow-up request');
    assert.equal(fallbackPending.fallbackHasRules, false, 'the legacy retry omits the unsupported rules argument');
    assert.equal(fallbackPending.createDisabled, true, 'the guard remains active during compatibility fallback');
    assert.equal(fallbackPending.quickDisabled, true, 'cross-action entry stays blocked during compatibility fallback');
    assert.equal(fallbackPending.createBusy, 'true', 'the accessible pending state spans both server signatures');

    await page.evaluate(() => window.__mockEntryBackend.releaseLegacyFallback());
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Room could not be created')
      && !document.querySelector('#online-create-room').disabled
      && !document.querySelector('#online-quick-match').disabled
      && !document.querySelector('#online-create-room').hasAttribute('aria-busy')
      && !document.querySelector('#online-quick-match').hasAttribute('aria-busy'), { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__mockEntryBackend.rpcCalls.length), 2, 'the failed compatibility fallback does not spawn any additional duplicate request');

    await page.click('#online-quick-match');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden')
      && document.querySelector('#online-invite-code').value === 'ROOMENTRY1234567'
      && !document.querySelector('#online-quick-match').hasAttribute('aria-busy'), { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => window.__mockEntryBackend.rpcCalls.map(call => call.name)), ['create_room', 'create_room', 'quick_match'], 'after a failed compatibility fallback, a later retry works exactly once');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('crossfour.online.room')), 'entry-guard-retry-room', 'the successful retry attaches the new room');
    assert.deepEqual(pageErrors, [], 'the mocked Online room-entry flow has no uncaught browser errors');
    assert.deepEqual(externalRequests, [], 'the regression makes no Supabase or other external network requests');
    console.log('Online room-entry single-flight browser test passed: duplicate create/quick-match input is suppressed, failure releases the guard, and retry succeeds.');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
