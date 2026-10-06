'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'www');
const previewDir = path.join(root, 'docs', 'previews', 'online-history-pagination');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
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

async function openHistoryPage(browser, url, origin, viewport) {
  const page = await browser.newPage();
  const errors = [];
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: viewport.isMobile, hasTouch: viewport.isMobile });
  await page.setRequestInterception(true);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
      request.respond({
        status: 200,
        contentType: 'text/javascript',
        body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
      }).catch(() => {});
    } else if (requestUrl.origin === origin) {
      request.continue().catch(() => {});
    } else {
      request.abort().catch(() => {});
    }
  });
  await page.evaluateOnNewDocument(() => {
    const userId = 'user-one';
    const baseTime = Date.UTC(2026, 9, 7, 0, 0, 0);
    const history = Array.from({ length: 23 }, (_, index) => ({
      id: 'history-' + index,
      mode: index % 2 === 0 ? 'classic' : 'ludo_chess',
      status: 'completed',
      winner_id: index % 3 === 0 ? userId : 'other-user',
      started_at: new Date(baseTime - index * 3600000).toISOString(),
      finished_at: new Date(baseTime - index * 3600000 + 900000).toISOString()
    }));
    const tables = {
      profiles: [{ id: userId, handle: 'alice123', display_name: 'Alice' }],
      wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
      rooms: [], room_members: [], room_invites: [], match_states: [], ludo_chess_matches: [],
      match_history: history
    };
    const mock = window.__mockBackend = { tables, historyRanges: [], failNextHistoryPage: false, channels: [], session: { user: { id: userId, email: 'alice@example.test' } } };
    function queryBuilder(table) {
      const filters = [];
      let ordering = null;
      let range = null;
      let limit = null;
      function execute(single) {
        let rows = (tables[table] || []).filter(row => filters.every(filter => filter.kind === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(value) === String(row[filter.field]))));
        if (ordering) {
          rows = rows.slice().sort((a, b) => {
            const comparison = String(a[ordering.field] || '').localeCompare(String(b[ordering.field] || ''));
            return ordering.ascending ? comparison : -comparison;
          });
        }
        if (range) {
          if (table === 'match_history') {
            mock.historyRanges.push([range.from, range.to]);
            if (range.from > 0 && mock.failNextHistoryPage) {
              mock.failNextHistoryPage = false;
              return Promise.resolve({ data: null, error: { message: 'Simulated page load failure' } });
            }
          }
          rows = rows.slice(range.from, range.to + 1);
        } else if (limit !== null) rows = rows.slice(0, limit);
        rows = JSON.parse(JSON.stringify(rows));
        return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null });
      }
      const builder = {
        select() { return builder; },
        eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
        in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
        order(field, options) { ordering = { field, ascending: !!(options && options.ascending) }; return builder; },
        range(from, to) { range = { from, to }; return builder; },
        limit(value) { limit = value; return builder; },
        maybeSingle() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); }
      };
      return builder;
    }
    function makeChannel(name) {
      const channel = {
        name,
        on() { return channel; },
        subscribe(callback) { mock.channels.push(channel); if (callback) callback('SUBSCRIBED'); return channel; }
      };
      return channel;
    }
    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session: mock.session }, error: null }); },
            signOut() { mock.session = null; return Promise.resolve({ error: null }); }
          },
          from: queryBuilder,
          rpc() { return Promise.resolve({ data: {}, error: null }); },
          channel: makeChannel,
          removeChannel() { return Promise.resolve('ok'); }
        };
      }
    };
  });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.click('#btn-online');
  await page.waitForFunction(() =>
    !document.querySelector('#online').classList.contains('hidden') &&
    document.querySelectorAll('#online-history-list li').length === 10
  , { timeout: 15000 });
  return { page, errors };
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    const mobile = await openHistoryPage(browser, local.url, new URL(local.url).origin, { width: 390, height: 844, isMobile: true });
    const page = mobile.page;
    const initial = await page.evaluate(() => ({
      titles: Array.from(document.querySelectorAll('#online-history-list li b')).map(element => element.textContent),
      emptyHidden: document.querySelector('#online-history-empty').classList.contains('hidden'),
      buttonHidden: document.querySelector('#online-history-load-more').classList.contains('hidden'),
      status: document.querySelector('#online-history-more-status').textContent
    }));
    assert.equal(initial.titles.length, 10, 'the first page displays ten records');
    assert.equal(initial.titles[0], 'Classic · completed', 'the newest record appears first');
    assert.equal(initial.titles[1], 'Ludo Chess · completed', 'newest-first order is preserved across modes');
    assert.equal(initial.emptyHidden, true, 'the empty-history prompt disappears when records exist');
    assert.equal(initial.buttonHidden, false, 'the load-more control appears when an older page exists');
    assert.equal(initial.status, 'Showing 10 recent tables.', 'the page status is announced politely');

    const mobileCard = await page.$('.online-card[aria-labelledby="online-history-heading"]');
    await mobileCard.screenshot({ path: path.join(previewDir, 'mobile.png') });

    await page.evaluate(() => { window.__mockBackend.failNextHistoryPage = true; });
    await page.click('#online-history-load-more');
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-history-load-more');
      return !button.disabled && button.getAttribute('aria-busy') === 'false' && document.querySelectorAll('#online-history-list li').length === 10;
    });
    const retryState = await page.$eval('#online-history-load-more', button => ({ hidden: button.classList.contains('hidden'), text: button.textContent }));
    assert.deepEqual(retryState, { hidden: false, text: 'Load more tables' }, 'a failed page load leaves a usable retry control');

    await page.click('#online-history-load-more');
    await page.waitForFunction(() => document.querySelectorAll('#online-history-list li').length === 20);
    assert.equal(await page.$eval('#online-history-more-status', element => element.textContent), 'Showing 20 recent tables.', 'one click appends the next ten records');
    await page.click('#online-history-load-more');
    await page.waitForFunction(() => document.querySelectorAll('#online-history-list li').length === 23 && document.querySelector('#online-history-load-more').classList.contains('hidden'));
    assert.equal(await page.$eval('#online-history-more-status', element => element.textContent), 'All 23 tables loaded.', 'the control hides when there are no older records');
    const offsets = await page.evaluate(() => window.__mockBackend.historyRanges);
    assert.ok(offsets.some(range => range[0] === 10 && range[1] === 20), 'the first Load more request fetches only the next page');
    assert.ok(offsets.some(range => range[0] === 20 && range[1] === 30), 'the second Load more request advances to the next page');

    await page.setViewport({ width: 320, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow mobile history has no horizontal overflow');
    assert.deepEqual(mobile.errors, [], 'mobile history rendering produces no uncaught browser errors');
    await page.click('#online-back');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    assert.ok(await page.$('#btn-online'), 'the Online history screen preserves the offline game entry');

    const desktop = await openHistoryPage(browser, local.url, new URL(local.url).origin, { width: 1440, height: 960, isMobile: false });
    const desktopCard = await desktop.page.$('.online-card[aria-labelledby="online-history-heading"]');
    await desktopCard.screenshot({ path: path.join(previewDir, 'desktop.png') });
    assert.ok(await desktop.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop history has no horizontal overflow');
    assert.deepEqual(desktop.errors, [], 'desktop history rendering produces no uncaught browser errors');

    console.log('Online match-history pagination browser test passed (10-row pages, retry, newest-first order, 23-row history, mobile/desktop layout, offline entry).');
    console.log('Previews: ' + path.join(previewDir, 'mobile.png') + ' ; ' + path.join(previewDir, 'desktop.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
