'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewPath = path.resolve(__dirname, '..', 'docs', 'previews', 'online-room-status-announcement', 'mobile.png');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon'
};

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
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const pageErrors = [];
    const externalRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://room-status-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_room_status_test', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (requestUrl.origin === localOrigin) {
        request.continue().catch(() => {});
      } else {
        externalRequests.push(request.url());
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      const userId = 'room-status-user';
      const session = { user: { id: userId, email: 'player@example.test' } };
      sessionStorage.setItem('crossfour.online.room', 'room-status-room');
      const tables = {
        profiles: [{ id: userId, display_name: 'Amina', handle: 'amina' }],
        wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
        rooms: [{ id: 'room-status-room', created_by: userId, mode: 'classic', capacity: 2, status: 'waiting', updated_at: '2026-10-07T00:00:00.000Z' }],
        room_members: [{ room_id: 'room-status-room', user_id: userId, seat: 0, role: 'host', ready: false }],
        room_invites: [{ room_id: 'room-status-room', invite_code: 'ROOMSTATUS123456' }],
        match_history: [], match_states: [], ludo_chess_matches: []
      };
      const state = window.__roomStatusTest = { tables, channels: [], roomReads: 0, authListeners: [] };
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
          return Promise.resolve().then(() => {
            const rows = (tables[table] || []).filter(matches).map(clone);
            const limited = maximum === null ? rows : rows.slice(0, maximum);
            return { data: single ? (limited[0] || null) : limited, error: null };
          });
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
      function channel(name) {
        const result = {
          name,
          handlers: [],
          statusCallback: null,
          on(_type, filter, callback) { result.handlers.push({ filter, callback }); return result; },
          subscribe(callback) {
            result.statusCallback = callback || null;
            state.channels.push(result);
            if (result.statusCallback) result.statusCallback('SUBSCRIBED');
            return result;
          }
        };
        return result;
      }
      state.emit = function (table, event) {
        state.channels.filter(item => !item.removed).forEach(item => item.handlers.forEach(handler => {
          const filter = handler.filter || {};
          if (filter.table !== table) return;
          if (filter.filter) {
            const match = /^([a-z_]+)=eq\.(.+)$/.exec(filter.filter);
            const row = event.new || event.old || {};
            if (match && String(row[match[1]]) !== match[2]) return;
          }
          handler.callback(event);
        }));
      };
      state.setRoomChannelStatus = function (status) {
        const room = state.channels.find(item => item.name === 'crossfour-room-room-status-room');
        if (room && room.statusCallback) room.statusCallback(status);
      };
      const client = {
        auth: {
          onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
          getSession() { return Promise.resolve({ data: { session }, error: null }); }
        },
        from(table) {
          if (table === 'rooms') state.roomReads++;
          return queryBuilder(table);
        },
        rpc() { return Promise.resolve({ data: {}, error: null }); },
        channel,
        removeChannel(item) { if (item) item.removed = true; return Promise.resolve('ok'); }
      };
      window.supabase = { createClient() { return client; } };
    });

    await page.goto(local.url, { waitUntil: 'domcontentloaded' });
    await page.click('#btn-online');
    await page.waitForFunction(() => document.querySelector('#online-room-connection')?.dataset.state === 'connected', { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 100));

    if (process.env.CAPTURE_PREVIEW === '1') {
      await page.$eval('#online-room-connection', element => element.scrollIntoView({ block: 'center' }));
      fs.mkdirSync(path.dirname(previewPath), { recursive: true });
      await page.screenshot({ path: previewPath });
    }

    await page.evaluate(() => {
      const target = document.querySelector('#online-room-connection');
      window.__connectionMutations = 0;
      const observer = new MutationObserver(records => { window.__connectionMutations += records.length; });
      observer.observe(target, { childList: true, characterData: true, subtree: true });
    });
    const initialRoomReads = await page.evaluate(() => window.__roomStatusTest.roomReads);
    await page.evaluate(() => window.__roomStatusTest.emit('rooms', { event: 'UPDATE', new: { id: 'room-status-room' } }));
    await page.waitForFunction(previous => window.__roomStatusTest.roomReads > previous, { timeout: 5000 }, initialRoomReads);
    await new Promise(resolve => setTimeout(resolve, 60));
    const duplicateAnnouncements = await page.evaluate(() => window.__connectionMutations);
    assert.equal(duplicateAnnouncements, 0, 'a routine room refresh should not rewrite the unchanged connected live-region message');

    await page.evaluate(() => window.__roomStatusTest.setRoomChannelStatus('TIMED_OUT'));
    await page.waitForFunction(() => document.querySelector('#online-room-connection')?.dataset.state === 'reconnecting', { timeout: 5000 });
    const reconnectingText = await page.$eval('#online-room-connection', element => element.textContent);
    assert.match(reconnectingText, /Reconnecting/);

    await page.evaluate(() => window.__roomStatusTest.setRoomChannelStatus('SUBSCRIBED'));
    await page.waitForFunction(() => document.querySelector('#online-room-connection')?.dataset.state === 'connected', { timeout: 5000 });
    const connectedText = await page.$eval('#online-room-connection', element => element.textContent);
    assert.match(connectedText, /Connected/);
    assert.deepEqual(externalRequests, [], 'the browser test must not contact external services');
    assert.deepEqual(pageErrors, [], 'the Online lobby should load without runtime errors');
    console.log('Online room-status announcement regression passed: unchanged live-region text stays quiet, while reconnect transitions remain visible.');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
