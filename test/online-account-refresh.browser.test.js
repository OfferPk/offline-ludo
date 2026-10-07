'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
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
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://account-refresh-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_account_refresh_test', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (requestUrl.origin === localOrigin) {
        request.continue().catch(() => {});
      } else {
        if (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') externalRequests.push(request.url());
        request.abort().catch(() => {});
      }
    });

    await page.evaluateOnNewDocument(() => {
      const state = window.__accountRefreshRace = {
        channels: [],
        authListeners: [],
        readCounts: { profiles: 0, wallets: 0 },
        responsePlans: { profiles: [], wallets: [] },
        tables: {
          profiles: [{ id: 'user-one', handle: 'amina', display_name: 'Initial profile' }],
          wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
          rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
        }
      };
      function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
      function queryBuilder(table) {
        const filters = [];
        let operation = 'select';
        let patch = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          if (operation === 'update') {
            (state.tables[table] || []).filter(matches).forEach(row => Object.assign(row, patch));
            return Promise.resolve({ data: null, error: null });
          }
          if ((table === 'profiles' || table === 'wallets') && state.readCounts[table] !== undefined) {
            state.readCounts[table] += 1;
            const plan = state.responsePlans[table].shift();
            if (plan) {
              const plannedData = clone(plan.data);
              return new Promise(resolve => setTimeout(() => resolve({ data: plannedData, error: null }), plan.delay));
            }
          }
          const rows = (state.tables[table] || []).filter(matches).map(clone);
          return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null });
        }
        const builder = {
          select() { operation = 'select'; return builder; },
          update(values) { operation = 'update'; patch = values; return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
          order() { return builder; },
          limit() { return builder; },
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
            if (callback) setTimeout(() => callback('SUBSCRIBED'), 0);
            return channel;
          }
        };
        return channel;
      }
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session: { user: { id: 'user-one', email: 'amina@example.test' } } }, error: null }); },
              signOut() { return Promise.resolve({ error: null }); }
            },
            from: queryBuilder,
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
            rpc() { return Promise.resolve({ data: {}, error: null }); }
          };
        }
      };
      state.emit = function (table, event) {
        state.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
          if (handler.filter && handler.filter.table === table) handler.callback(event);
        }));
      };
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => document.querySelector('#online-profile-name').value === 'Initial profile'
      && document.querySelector('#online-wallet-coins').textContent === '1,250', { timeout: 15000 });
    await page.waitForFunction(() => window.__accountRefreshRace.channels.some(channel =>
      !channel.removed && channel.handlers.some(handler => handler.filter && handler.filter.table === 'profiles')),
      { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 80));

    const before = await page.evaluate(() => ({
      profiles: window.__accountRefreshRace.readCounts.profiles,
      wallets: window.__accountRefreshRace.readCounts.wallets
    }));
    await page.evaluate(() => {
      const mock = window.__accountRefreshRace;
      mock.responsePlans.profiles = [
        { delay: 140, data: { id: 'user-one', handle: 'amina', display_name: 'Stale profile snapshot' } },
        { delay: 12, data: { id: 'user-one', handle: 'amina', display_name: 'Fresh profile snapshot' } }
      ];
      mock.responsePlans.wallets = [
        { delay: 140, data: { user_id: 'user-one', coins: 10, diamonds: 1 } },
        { delay: 12, data: { user_id: 'user-one', coins: 20, diamonds: 2 } }
      ];
      mock.emit('profiles', { event: 'UPDATE', new: { id: 'user-one' } });
      mock.emit('profiles', { event: 'UPDATE', new: { id: 'user-one' } });
    });
    await page.waitForFunction(counts => window.__accountRefreshRace.readCounts.profiles >= counts.profiles + 2
      && window.__accountRefreshRace.readCounts.wallets >= counts.wallets + 2, { timeout: 5000 }, before);
    await page.waitForFunction(() => document.querySelector('#online-profile-name').value === 'Fresh profile snapshot'
      && document.querySelector('#online-wallet-coins').textContent === '20', { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 220));

    assert.equal(await page.$eval('#online-profile-name', field => field.value), 'Fresh profile snapshot',
      'a slower earlier profile response cannot overwrite the newest profile');
    assert.equal(await page.$eval('#online-wallet-coins', node => node.textContent), '20',
      'a slower earlier wallet response cannot overwrite the newest balance');
    assert.equal(await page.$eval('#online-wallet-diamonds', node => node.textContent), '2',
      'the profile and wallet remain one coherent refresh snapshot');
    assert.deepEqual(pageErrors, [], 'concurrent account refreshes have no uncaught browser errors');
    assert.deepEqual(externalRequests, [], 'the regression is fully mocked and makes no external requests');
    console.log('Online account-refresh browser regression passed: late profile/wallet responses are ignored after a newer refresh.');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
