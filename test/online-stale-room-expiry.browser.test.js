'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};
function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
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
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://exggyvbsqhoasrqgzerf.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (/supabase-js/.test(request.url())) {
        request.abort().catch(() => {});
      } else if (url.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      const user = { id: 'expiry-test-user', email: 'player@example.test' };
      const state = window.__staleRoomCleanup = {
        calls: [], events: [], channels: [], failCleanupCount: 0,
        session: { user }, resolveQuickMatch: null, rejectQuickMatch: null
      };
      function queryBuilder(table) {
        const filters = [];
        const api = {
          select() { return api; },
          eq(field, value) { filters.push({ field, value }); return api; },
          in() { return api; },
          order() { return api; },
          limit() { return api; },
          maybeSingle() {
            state.events.push('read:' + table);
            const row = table === 'profiles'
              ? { id: user.id, handle: 'expiry_user', display_name: 'Expiry User' }
              : table === 'wallets' ? { user_id: user.id, coins: 0, diamonds: 0 } : null;
            return Promise.resolve({ data: row, error: null });
          },
          then(resolve, reject) {
            state.events.push('read:' + table);
            const rows = table === 'profiles'
              ? [{ id: user.id, handle: 'expiry_user', display_name: 'Expiry User' }]
              : table === 'wallets' ? [{ user_id: user.id, coins: 0, diamonds: 0 }]
                : table === 'match_history' || table === 'room_members' ? [] : [];
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          }
        };
        return api;
      }
      function channel(name) {
        const instance = {
          name,
          on() { return instance; },
          subscribe(callback) {
            state.channels.push(instance);
            if (callback) callback('SUBSCRIBED');
            return instance;
          }
        };
        return instance;
      }
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
              signOut() { state.session = null; return Promise.resolve({ error: null }); }
            },
            from: queryBuilder,
            channel,
            removeChannel() {},
            rpc(name) {
              state.calls.push(name);
              state.events.push('rpc:' + name);
              if (name === 'expire_stale_waiting_rooms') {
                if (state.failCleanupCount > 0) {
                  state.failCleanupCount--;
                  return Promise.resolve({ data: null, error: { message: 'maintenance unavailable' } });
                }
                return Promise.resolve({ data: 3, error: null });
              }
              if (name === 'quick_match') {
                return new Promise((resolve, reject) => {
                  state.resolveQuickMatch = resolve;
                  state.rejectQuickMatch = reject;
                });
              }
              return Promise.resolve({ data: {}, error: null });
            }
          };
        }
      };
    });

    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const state = window.__staleRoomCleanup;
      if (!state) return false;
      const cleanupAt = state.events.indexOf('rpc:expire_stale_waiting_rooms');
      const discoveryAt = state.events.indexOf('read:room_members');
      return cleanupAt >= 0 && discoveryAt > cleanupAt;
    }, { timeout: 10000 });
    assert.equal(await page.$eval('#online-room-card', el => el.classList.contains('hidden')), true, 'a cleanup with no restored active room leaves the room card hidden');

    await page.evaluate(() => { window.__staleRoomCleanup.failCleanupCount = 1; });
    const previousCallCount = await page.evaluate(() => window.__staleRoomCleanup.calls.length);
    await page.click('#online-quick-match');
    await page.waitForFunction(previous => window.__staleRoomCleanup.calls.length > previous && window.__staleRoomCleanup.calls.includes('quick_match'), {}, previousCallCount, { timeout: 10000 });
    const calls = await page.evaluate(previous => window.__staleRoomCleanup.calls.slice(previous), previousCallCount);
    assert.deepEqual(calls, ['expire_stale_waiting_rooms', 'quick_match'], 'Quick Match attempts cleanup first and proceeds when maintenance is temporarily unavailable');
    await page.evaluate(() => window.__staleRoomCleanup.rejectQuickMatch(new Error('intentional test completion')));
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Matchmaking failed: intentional test completion'));
    assert.deepEqual(errors, [], 'the cleanup and matchmaking flows have no uncaught browser errors');
    console.log('Online stale waiting-room browser regression passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
