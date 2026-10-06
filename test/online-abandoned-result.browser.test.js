'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-abandoned-result');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, rel);
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
  const { server, url } = await startLocalServer();
  const origin = new URL(url).origin;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    const errors = [];
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
      const roomId = 'abandoned-room';
      const userId = 'user-one';
      const state = {
        protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1],
        pieces: [[0, -1, -1, -1], [-1, -1, -1, -1], null, null],
        rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
        turn: 1, phase: 'over', queue: [], sixes: 0, bonus: 0,
        ranking: [], abandoned: [0], result: 'abandoned', turn_count: 4,
        last_roll: null, last_action: { type: 'timeout' }, turn_deadline: null
      };
      const tables = {
        profiles: [
          { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
          { id: 'user-two', handle: 'bob123', display_name: 'Bob' }
        ],
        wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
        rooms: [{ id: roomId, created_by: userId, mode: 'classic', capacity: 2, status: 'completed', updated_at: '2026-10-06T12:00:00.000Z' }],
        room_members: [
          { room_id: roomId, user_id: 'user-one', seat: 0, role: 'host', ready: true },
          { room_id: roomId, user_id: 'user-two', seat: 1, role: 'player', ready: true }
        ],
        room_invites: [{ room_id: roomId, invite_code: 'ABANDONEDROOM1234' }],
        match_history: [{ id: 'history-abandoned', room_id: roomId, mode: 'classic', status: 'completed', result: { result: 'abandoned' }, started_at: '2026-10-06T11:00:00.000Z', finished_at: '2026-10-06T12:00:00.000Z' }],
        match_states: [{ room_id: roomId, version: 12, state }],
        ludo_chess_matches: []
      };
      const mock = window.__mockBackend = { tables, channels: [], session: { user: { id: userId, email: 'alice@example.test' } } };
      function queryBuilder(table) {
        const filters = [];
        let limit = null;
        function selectedRows() {
          let rows = (tables[table] || []).filter(row => filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field]))));
          if (limit !== null) rows = rows.slice(0, limit);
          return JSON.parse(JSON.stringify(rows));
        }
        const builder = {
          select() { return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
          order() { return builder; },
          limit(value) { limit = value; return builder; },
          maybeSingle() { return Promise.resolve({ data: selectedRows()[0] || null, error: null }); },
          then(resolve, reject) { return Promise.resolve({ data: selectedRows(), error: null }).then(resolve, reject); }
        };
        return builder;
      }
      function makeChannel(name) {
        const channel = {
          name, handlers: [], removed: false,
          on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
          subscribe(callback) {
            mock.channels.push(channel);
            if (callback) callback('SUBSCRIBED');
            return channel;
          }
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
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); }
          };
        }
      };
      sessionStorage.setItem('crossfour.online.room', roomId);
    });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden'));
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 12' && document.querySelector('#online-room-connection').dataset.state === 'ended');

    const outcome = await page.evaluate(() => ({
      boardBannerHidden: document.querySelector('#turn-banner').classList.contains('hidden'),
      boardStatus: document.querySelector('#online-grace-text').textContent,
      boardStatusVisible: !document.querySelector('#online-grace').classList.contains('hidden'),
      heading: document.querySelector('#online-match-heading').textContent,
      status: document.querySelector('#online-match-turn').textContent,
      version: document.querySelector('#online-match-version').textContent,
      roomState: document.querySelector('#online-room-connection').textContent,
      onlineHidden: document.querySelector('#online').classList.contains('hidden'),
      homeHidden: document.querySelector('#home').classList.contains('hidden')
    }));
    assert.equal(outcome.onlineHidden, false, 'the online room screen is active for the regression');
    assert.equal(outcome.homeHidden, true, 'the home screen is not obscuring the result screen');
    assert.equal(outcome.boardBannerHidden, true, 'an overlapping generic board header is suppressed for the abandoned result');
    assert.equal(outcome.boardStatusVisible, true, 'the board-level terminal explanation remains visible above the game overlay');
    assert.equal(outcome.boardStatus, 'Match abandoned after reconnect grace expired. No winner was recorded.', 'the board status explains the authoritative abandoned result without inventing a winner');
    assert.equal(outcome.heading, 'Match abandoned', 'terminal abandoned result is named explicitly');
    assert.equal(outcome.status, 'Match abandoned after reconnect grace expired. No winner was recorded.', 'abandoned match does not imply a winner or show a dash placeholder');
    assert.equal(outcome.version, 'Version 12', 'the outcome is rendered from the authoritative server version');
    assert.match(outcome.roomState, /Room ended/, 'the room remains visibly terminal');

    fs.mkdirSync(previewDir, { recursive: true });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    if (await page.$eval('#online', element => element.classList.contains('hidden'))) await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online').classList.contains('hidden') && document.querySelector('#online-match-version').textContent === 'Version 12');
    await page.$eval('.online-body', element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => {
      const rect = document.querySelector('#online-match-panel').getBoundingClientRect();
      return rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
    });
    await page.screenshot({ path: path.join(previewDir, 'mobile.png'), fullPage: false });
    const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.equal(mobileWidth > 390, false, 'mobile abandoned-result preview has no horizontal overflow');

    await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    if (await page.$eval('#online', element => element.classList.contains('hidden'))) await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online').classList.contains('hidden') && document.querySelector('#online-match-version').textContent === 'Version 12');
    await page.$eval('.online-body', element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => {
      const rect = document.querySelector('#online-match-panel').getBoundingClientRect();
      return rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
    });
    await page.screenshot({ path: path.join(previewDir, 'desktop.png'), fullPage: false });
    const desktopWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.equal(desktopWidth > 1440, false, 'desktop abandoned-result preview has no horizontal overflow');
    assert.deepEqual(errors, [], 'mocked abandoned-result rendering has no uncaught browser errors');

    console.log('Online abandoned-result browser regression passed (authoritative terminal outcome, mobile 390×844, desktop 1440×960).');
    console.log('Previews: ' + path.join(previewDir, 'mobile.png') + ' ; ' + path.join(previewDir, 'desktop.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
