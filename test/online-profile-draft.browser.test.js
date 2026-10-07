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
      if (pathname === '/js/supabase-config.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(
          "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://profile-draft-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_profile_draft_test', emailPasswordEnabled: true });"
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
      const userId = 'profile-draft-user';
      const session = { user: { id: userId, email: 'player@example.test' } };
      const state = window.__profileDraftTest = {
        session,
        channels: [],
        authListeners: [],
        tables: {
          profiles: [{ id: userId, handle: 'player', display_name: 'Saved Name' }],
          wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
          rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
        }
      };
      function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
      function queryBuilder(table) {
        let operation = 'select';
        let patch = null;
        const filters = [];
        function matches(row) {
          return filters.every(filter => String(row[filter.field]) === String(filter.value));
        }
        function execute(single) {
          const rows = (state.tables[table] || []).filter(matches);
          if (operation === 'update') {
            rows.forEach(row => Object.assign(row, patch));
            return Promise.resolve({ data: null, error: null });
          }
          const copies = rows.map(clone);
          return Promise.resolve({ data: single ? (copies[0] || null) : copies, error: null });
        }
        const builder = {
          select() { operation = 'select'; return builder; },
          update(values) { operation = 'update'; patch = values; return builder; },
          eq(field, value) { filters.push({ field, value }); return builder; },
          in() { return builder; },
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
    await page.waitForFunction(() => document.querySelector('#online-profile-name').value === 'Saved Name'
      && document.querySelector('#online-wallet-coins').textContent === '1,250', { timeout: 15000 });
    await page.waitForFunction(() => window.__profileDraftTest.channels.some(channel =>
      !channel.removed && channel.handlers.some(handler => handler.filter && handler.filter.table === 'wallets')),
      { timeout: 5000 });

    await page.$eval('#online-profile-name', field => {
      field.value = 'Unsent profile draft';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => window.__profileDraftTest.authListeners[0]('TOKEN_REFRESHED', window.__profileDraftTest.session));
    assert.equal(await page.$eval('#online-profile-name', field => field.value), 'Unsent profile draft',
      'a same-account auth refresh must not clear the name being edited');

    await page.evaluate(() => {
      const state = window.__profileDraftTest;
      state.tables.wallets[0].coins = 1300;
      state.emit('wallets', { event: 'UPDATE', new: state.tables.wallets[0] });
    });
    await page.waitForFunction(() => document.querySelector('#online-wallet-coins').textContent === '1,300', { timeout: 5000 });
    assert.equal(await page.$eval('#online-profile-name', field => field.value), 'Unsent profile draft',
      'a wallet-triggered background refresh must not overwrite a dirty profile field');

    await page.$eval('#online-profile-name', field => {
      field.value = '  Updated Name  ';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('#online-profile-form', form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector('#online-profile-name').value === 'Updated Name'
      && window.__profileDraftTest.tables.profiles[0].display_name === 'Updated Name', { timeout: 5000 });

    await page.evaluate(() => {
      const state = window.__profileDraftTest;
      state.tables.profiles[0].display_name = 'Name from another session';
      state.emit('profiles', { event: 'UPDATE', new: state.tables.profiles[0] });
    });
    await page.waitForFunction(() => document.querySelector('#online-profile-name').value === 'Name from another session', { timeout: 5000 });

    await page.evaluate(() => {
      const state = window.__profileDraftTest;
      state.tables.profiles.push({ id: 'profile-draft-user-two', handle: 'second', display_name: 'Second Account' });
      state.tables.wallets.push({ user_id: 'profile-draft-user-two', coins: 10, diamonds: 1 });
      state.session = { user: { id: 'profile-draft-user-two', email: 'second@example.test' } };
      state.authListeners[0]('SIGNED_IN', state.session);
    });
    await page.waitForFunction(() => document.querySelector('#online-profile-name').value === 'Second Account', { timeout: 5000 });

    assert.deepEqual(pageErrors, [], 'profile draft preservation produces no uncaught browser errors');
    assert.deepEqual(externalRequests, [], 'the regression uses mocked services and makes no external requests');
    console.log('Online profile-draft browser regression passed: drafts survive auth and wallet refreshes, saved values still reconcile.');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
