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
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
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
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: 'http://127.0.0.1:' + server.address().port + '/'
    }));
  });
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      const session = { user: { id: 'user-one', email: 'alice@example.test' } };
      const tables = {
        profiles: [
          { id: 'user-one', handle: 'alice_1', display_name: 'Alice' },
          { id: 'user-two', handle: 'bob_lee', display_name: 'Bob Lee' },
          { id: 'user-three', handle: 'carol_7', display_name: '' }
        ],
        wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
        room_members: [
          { room_id: 'room-duo', user_id: 'user-one', seat: 0 },
          { room_id: 'room-duo', user_id: 'user-two', seat: 1 },
          { room_id: 'room-four', user_id: 'user-three', seat: 0 },
          { room_id: 'room-four', user_id: 'user-one', seat: 1 },
          { room_id: 'room-four', user_id: 'user-two', seat: 2 },
          { room_id: 'room-four', user_id: 'user-four', seat: 3 },
          { room_id: 'room-missing', user_id: 'user-one', seat: 0 }
        ],
        match_history: [
          { id: 'history-duo', room_id: 'room-duo', mode: 'classic', status: 'completed', winner_id: 'user-one', started_at: '2026-10-06T08:00:00.000Z', finished_at: '2026-10-06T08:16:00.000Z' },
          { id: 'history-four', room_id: 'room-four', mode: 'classic', status: 'completed', winner_id: 'user-two', started_at: '2026-10-05T08:00:00.000Z', finished_at: '2026-10-05T08:20:00.000Z' },
          { id: 'history-missing', room_id: 'room-missing', mode: 'classic', status: 'active', winner_id: null, started_at: '2026-10-04T08:00:00.000Z', finished_at: null }
        ]
      };
      const state = window.__historyOpponentTest = { tables, queries: [] };
      const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
      function queryBuilder(table) {
        let filters = [];
        let ordering = null;
        let maxRows = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          state.queries.push({ table, filters: clone(filters) });
          let rows = (tables[table] || []).filter(matches).map(clone);
          if (ordering) rows.sort((a, b) => {
            const comparison = String(a[ordering.field] || '').localeCompare(String(b[ordering.field] || ''));
            return ordering.ascending ? comparison : -comparison;
          });
          if (maxRows !== null) rows = rows.slice(0, maxRows);
          return { data: single ? (rows[0] || null) : rows, error: null };
        }
        const builder = {
          select() { return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values: Array.from(values || []) }); return builder; },
          order(field, options) { ordering = { field, ascending: !!(options && options.ascending) }; return builder; },
          limit(value) { maxRows = value; return builder; },
          maybeSingle() { return Promise.resolve(execute(true)); },
          then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); }
        };
        return builder;
      }
      function channel(name) {
        const item = { name, on() { return item; }, subscribe(callback) { if (callback) callback('SUBSCRIBED'); return item; } };
        return item;
      }
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session }, error: null }); },
              signOut() { return Promise.resolve({ error: null }); }
            },
            from: queryBuilder,
            channel,
            removeChannel() { return Promise.resolve('ok'); },
            rpc() { return Promise.reject(new Error('Unexpected RPC in history test')); }
          };
        }
      };
    });
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForSelector('#online:not(.hidden)');
    await page.waitForFunction(() => document.querySelectorAll('#online-history-list li').length === 3, { timeout: 10000 });

    const rows = await page.$$eval('#online-history-list li', items => items.map(item => ({
      title: item.querySelector('b').textContent,
      players: item.querySelector('.online-history-players').textContent
    })));
    assert.deepEqual(rows, [
      { title: 'Classic · completed', players: 'vs Bob Lee (@bob_lee)' },
      { title: 'Classic · completed', players: 'With @carol_7 · Bob Lee (@bob_lee) · Player (seat 4)' },
      { title: 'Classic · active', players: 'Opponent details unavailable' }
    ], 'history identifies the opponent or other players, with safe fallbacks for missing profile data');

    const lookups = await page.evaluate(() => window.__historyOpponentTest.queries);
    const historyLookups = lookups.filter(query => query.table === 'match_history');
    const rosterLookups = lookups.filter(query => query.table === 'room_members' && query.filters.some(filter => filter.kind === 'in' && filter.field === 'room_id'));
    const profileLookups = lookups.filter(query => query.table === 'profiles' && query.filters.some(filter => filter.kind === 'in' && filter.field === 'id'));
    assert.ok(historyLookups.length > 0, 'match history was read for the signed-in account');
    assert.equal(rosterLookups.length, historyLookups.length, 'each history refresh batches all visible table rosters into one query');
    assert.equal(profileLookups.length, historyLookups.length, 'each history refresh batches opponent profiles into one query');
    profileLookups.forEach(query => assert.deepEqual(query.filters[0].values.slice().sort(), ['user-four', 'user-three', 'user-two'], 'the profile batch excludes the current user'));

    const previewDir = process.env.PREVIEW_DIR;
    if (previewDir) {
      await fs.promises.mkdir(previewDir, { recursive: true });
      let historyCard = await page.$('.online-card[aria-labelledby="online-history-heading"]');
      await historyCard.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await historyCard.screenshot({ path: path.join(previewDir, 'online-history-opponents-mobile.png') });
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.click('#btn-online');
      await page.waitForFunction(() => document.querySelectorAll('#online-history-list li').length === 3, { timeout: 10000 });
      historyCard = await page.$('.online-card[aria-labelledby="online-history-heading"]');
      await historyCard.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await historyCard.screenshot({ path: path.join(previewDir, 'online-history-opponents-desktop.png') });
      assert.ok((await fs.promises.stat(path.join(previewDir, 'online-history-opponents-mobile.png'))).size > 0);
      assert.ok((await fs.promises.stat(path.join(previewDir, 'online-history-opponents-desktop.png'))).size > 0);
    }

    await page.evaluate(() => document.getElementById('online-back').click());
    await page.waitForSelector('#home:not(.hidden)');
    await page.evaluate(() => document.getElementById('btn-vs-ai').click());
    await page.waitForSelector('#setup:not(.hidden)');
    assert.deepEqual(pageErrors, [], 'history rendering has no uncaught browser errors');
    console.log('Online history opponent browser tests passed (duel, multi-player, missing-data fallback, batched queries, offline entry).');
    if (previewDir) console.log('Preview directory: ' + path.resolve(previewDir));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
