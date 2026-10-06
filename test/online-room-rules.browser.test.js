'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(process.env.PREVIEW_DIR || '/workspace/artifacts/online-classic-room-rules');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
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
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

function makeFixture(mode, lockedRules) {
  const roomId = mode === 'ludo_chess' ? 'rules-chess-room' : 'rules-classic-room';
  const room = { id: roomId, created_by: 'user-one', mode, capacity: 2, status: 'waiting', updated_at: '2026-10-07T00:00:00.000Z' };
  if (typeof lockedRules !== 'undefined') room.locked_rules = lockedRules;
  return {
    roomId,
    session: { user: { id: 'user-one', email: 'alice@example.test' } },
    failLockedRules: false,
    tables: {
      profiles: [{ id: 'user-one', handle: 'alice123', display_name: 'Alice' }, { id: 'user-two', handle: 'bob123', display_name: 'Bob' }],
      wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
      rooms: [room],
      room_members: [{ room_id: roomId, user_id: 'user-one', seat: 0, role: 'host', ready: false }],
      room_invites: [{ room_id: roomId, invite_code: 'ROOMRULES1234567' }],
      match_history: [], match_states: [], ludo_chess_matches: []
    }
  };
}

async function openFixture(browser, serverUrl, fixture, width, height) {
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument((data) => {
    sessionStorage.setItem('crossfour.online.room', data.roomId);
    data.rpcCalls = [];
    window.__roomRulesFixture = data;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    function queryBuilder(table) {
      let selected = '*';
      const filters = [];
      let maximum = null;
      function matches(row) {
        return filters.every(filter => filter.type === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(value) === String(row[filter.field])));
      }
      function execute(single) {
        if (table === 'rooms' && data.failLockedRules && selected.split(',').includes('locked_rules')) {
          return { data: null, error: { code: 'PGRST204', message: "Could not find the 'locked_rules' column of 'rooms' in the schema cache" } };
        }
        let rows = (data.tables[table] || []).filter(matches).map(clone);
        if (maximum !== null) rows = rows.slice(0, maximum);
        return { data: single ? (rows[0] || null) : rows, error: null };
      }
      const builder = {
        select(fields) { selected = fields || '*'; return builder; },
        eq(field, value) { filters.push({ type: 'eq', field, value }); return builder; },
        in(field, values) { filters.push({ type: 'in', field, values }); return builder; },
        order() { return builder; },
        limit(value) { maximum = value; return builder; },
        maybeSingle() { return Promise.resolve(execute(true)); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); }
      };
      return builder;
    }
    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session: data.session }, error: null }); }
          },
          from: queryBuilder,
          channel(name) {
            const channel = { name, on() { return channel; }, subscribe(callback) { if (callback) callback('SUBSCRIBED'); return channel; } };
            return channel;
          },
          removeChannel() { return Promise.resolve('ok'); },
          rpc(name, args) {
            data.rpcCalls.push({ name, args });
            return Promise.resolve({ data: null, error: { message: 'Unexpected RPC in room-rules test: ' + name } });
          }
        };
      }
    };
  }, fixture);
  const origin = new URL(serverUrl).origin;
  await page.setRequestInterception(true);
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
      request.respond({
        status: 200,
        contentType: 'text/javascript',
        body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
      }).catch(() => {});
    } else if (requestUrl.origin === origin) request.continue().catch(() => {});
    else request.abort().catch(() => {});
  });
  await page.goto(serverUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.click('#btn-online');
  await page.waitForFunction(() => {
    const card = document.querySelector('#online-room-card');
    return card && !card.classList.contains('hidden') && document.querySelector('#online-room-mode').textContent;
  }, { timeout: 15000 });
  return { page, errors };
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    fs.mkdirSync(previewDir, { recursive: true });

    const rules = { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: true, bonusOnCapture: false, bonusOnHome: true, arrows: true, noCapture: false };
    const classic = await openFixture(browser, local.url, makeFixture('classic', rules), 390, 844);
    const page = classic.page;
    await page.waitForFunction(() => !document.querySelector('#online-room-rules').classList.contains('hidden') && document.querySelectorAll('#online-room-rules-list > div').length === 8, { timeout: 15000 });
    const summary = await page.$$eval('#online-room-rules-list > div', rows => rows.map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
    assert.deepEqual(summary, [
      ['Roll style', 'Star · 6s stack'],
      ['Safe squares', 'On'],
      ['Capture to enter home', 'Off'],
      ['Blocks', 'On'],
      ['Bonus on capture', 'Off'],
      ['Bonus on reaching home', 'On'],
      ['Arrow tiles', 'On'],
      ['Captures', 'Allowed']
    ], 'the host-locked rules are translated into clear labels and exact values');
    assert.match(await page.$eval('#online-room-rules-note', el => el.textContent), /before marking Ready/);
    assert.equal(await page.evaluate(() => {
      const rulesPanel = document.querySelector('#online-room-rules');
      const ready = document.querySelector('#online-ready');
      return !!(rulesPanel.compareDocumentPosition(ready) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true, 'players can review house rules before the Ready control');

    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      const cardDimensions = await page.$eval('#online-room-card', el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
      assert.ok(dimensions.document <= width, width + 'px: room rules introduce no horizontal page overflow');
      assert.ok(cardDimensions.scrollWidth <= cardDimensions.width + 1, width + 'px: room rules fit inside the lobby card');
    }
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.$eval('#online-room-card', el => el.scrollIntoView({ block: 'center' }));
    await (await page.$('#online-room-card')).screenshot({ path: path.join(previewDir, 'online-classic-room-rules-mobile.png') });
    const desktop = await openFixture(browser, local.url, makeFixture('classic', rules), 1280, 900);
    await desktop.page.waitForFunction(() => !document.querySelector('#online-room-rules').classList.contains('hidden') && document.querySelectorAll('#online-room-rules-list > div').length === 8, { timeout: 15000 });
    await (await desktop.page.$('#online-room-card')).screenshot({ path: path.join(previewDir, 'online-classic-room-rules-desktop.png') });
    assert.deepEqual(desktop.errors, [], 'the desktop Classic room flow has no uncaught browser errors');
    assert.equal(await page.evaluate(() => window.__roomRulesFixture.rpcCalls.length), 0, 'the Online summary issues no write RPCs');
    assert.deepEqual(classic.errors, [], 'the Classic room flow has no uncaught browser errors');

    const offline = await browser.newPage();
    offline.setDefaultTimeout(12000);
    await offline.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const offlineErrors = [];
    offline.on('pageerror', error => offlineErrors.push(error.message));
    const localOrigin = new URL(local.url).origin;
    await offline.setRequestInterception(true);
    offline.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await offline.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await offline.click('#btn-vs-ai');
    await offline.waitForSelector('#setup:not(.hidden)');
    assert.deepEqual(offlineErrors, [], 'offline setup remains available and has no uncaught browser errors');

    const legacyFixture = makeFixture('classic', undefined);
    legacyFixture.failLockedRules = true;
    const legacy = await openFixture(browser, local.url, legacyFixture, 390, 844);
    await legacy.page.waitForFunction(() => !document.querySelector('#online-room-rules').classList.contains('hidden'), { timeout: 10000 });
    assert.match(await legacy.page.$eval('#online-room-rules-note', el => el.textContent), /unavailable on this server version/);
    assert.equal(await legacy.page.$eval('#online-room-status', el => el.textContent.includes('Waiting for players')), true, 'a backend without the optional column still restores the room');
    assert.deepEqual(legacy.errors, [], 'legacy-schema fallback produces no uncaught browser errors');
    const chess = await openFixture(browser, local.url, makeFixture('ludo_chess', null), 390, 844);
    assert.equal(await chess.page.$eval('#online-room-rules', el => el.classList.contains('hidden')), true, 'Ludo Chess does not show irrelevant Classic house-rule fields');
    assert.deepEqual(chess.errors, [], 'the Chess room flow has no uncaught browser errors');
    console.log('Online Classic room-rules browser regression passed (exact values, before-Ready placement, legacy server fallback, Chess exclusion, responsive widths, offline entry).');
    console.log('Previews: ' + path.join(previewDir, 'online-classic-room-rules-mobile.png') + ' | ' + path.join(previewDir, 'online-classic-room-rules-desktop.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
