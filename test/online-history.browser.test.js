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
      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relativePath);
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
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      const session = { user: { id: 'user-one', email: 'alice@example.test' } };
      const tables = {
        profiles: [{ id: 'user-one', handle: 'alice123', display_name: 'Alice' }],
        wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
        room_members: [],
        match_history: [
          { id: 'win', mode: 'classic', status: 'completed', winner_id: 'user-one', started_at: '2026-10-06T08:00:00.000Z', finished_at: '2026-10-06T08:16:00.000Z' },
          { id: 'loss', mode: 'classic', status: 'completed', winner_id: 'user-two', started_at: '2026-10-05T08:00:00.000Z', finished_at: '2026-10-05T08:20:00.000Z' },
          { id: 'draw', mode: 'ludo_chess', status: 'completed', winner_id: null, started_at: '2026-10-04T08:00:00.000Z', finished_at: '2026-10-04T08:45:00.000Z' },
          { id: 'active', mode: 'classic', status: 'active', winner_id: null, started_at: '2026-10-07T02:55:00.000Z', finished_at: null }
        ]
      };
      function queryBuilder(table) {
        let filters = [];
        let maxRows = null;
        let ordering = null;
        function matches(row) {
          return filters.every(filter => String(row[filter.field]) === String(filter.value));
        }
        function execute(single) {
          let rows = (tables[table] || []).filter(matches).map(row => Object.assign({}, row));
          if (ordering) rows.sort((a, b) => {
            const comparison = String(a[ordering.field] || '').localeCompare(String(b[ordering.field] || ''));
            return ordering.ascending ? comparison : -comparison;
          });
          if (maxRows !== null) rows = rows.slice(0, maxRows);
          return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null });
        }
        const builder = {
          select() { return builder; },
          eq(field, value) { filters.push({ field, value }); return builder; },
          order(field, options) { ordering = { field, ascending: !!(options && options.ascending) }; return builder; },
          limit(value) { maxRows = value; return builder; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        return builder;
      }
      window.supabase = {
        createClient() {
          const client = {
            auth: {
              onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session }, error: null }); },
              signOut() { return Promise.resolve({ error: null }); }
            },
            from: queryBuilder,
            channel(name) {
              return {
                name,
                on() { return this; },
                subscribe(callback) { if (callback) callback('SUBSCRIBED'); return this; }
              };
            },
            removeChannel() { return Promise.resolve('ok'); },
            rpc() { return Promise.reject(new Error('Unexpected RPC in history test')); }
          };
          return client;
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
    await page.waitForFunction(() => document.querySelectorAll('#online-history-list li').length === 4, { timeout: 10000 });

    const rows = await page.$$eval('#online-history-list li', items => items.map(item => ({
      title: item.querySelector('b').textContent,
      outcome: item.querySelector('.online-history-outcome').textContent,
      tone: item.querySelector('.online-history-outcome').dataset.outcome,
      detail: item.querySelector('small').textContent
    })));
    assert.deepEqual(rows.map(row => [row.title, row.outcome, row.tone]), [
      ['Classic · Active', 'In progress', 'live'],
      ['Classic · Completed', 'You won', 'win'],
      ['Classic · Completed', 'Another player won', 'loss'],
      ['Ludo Chess · Completed', 'No winner recorded', 'neutral']
    ], 'history distinguishes wins, losses, no-winner completions, and active matches');
    assert.match(rows[1].detail, /^Started .+ · Finished .+$/, 'completed matches show both start and finish times');
    assert.match(rows[0].detail, /^Started .+$/, 'active matches show their start time without inventing a finish time');
    assert.equal(await page.$eval('#online-history-empty', el => el.classList.contains('hidden')), true, 'the empty-history message is hidden when rows are available');

    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        card: document.querySelector('.online-card[aria-labelledby="online-history-heading"]'),
        cardWidth: document.querySelector('.online-card[aria-labelledby="online-history-heading"]').scrollWidth,
        clientWidth: document.querySelector('.online-card[aria-labelledby="online-history-heading"]').clientWidth
      }));
      assert.ok(layout.document <= width, width + 'px: history introduces no horizontal page overflow');
      assert.ok(layout.cardWidth <= layout.clientWidth + 1, width + 'px: outcome and date content fit within the history card');
    }

    const previewDir = path.resolve(process.env.PREVIEW_DIR || path.join(__dirname, '../../artifacts/online-history'));
    fs.mkdirSync(previewDir, { recursive: true });
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const historyCard = await page.$('.online-card[aria-labelledby="online-history-heading"]');
    await historyCard.screenshot({ path: path.join(previewDir, 'online-match-history-mobile.png') });

    await page.click('#online-back');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    assert.equal(await page.$eval('#btn-online', el => !!el), true, 'the Online history view does not disturb the offline game entry');
    assert.deepEqual(pageErrors, [], 'history rendering produces no uncaught browser errors');
    console.log('Online match-history browser test passed (outcomes, timestamps, narrow-phone layout, offline entry).');
    console.log('Preview: ' + path.join(previewDir, 'online-match-history-mobile.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
