'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-invite-availability');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
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
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (url.origin === new URL(local.url).origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });

    await page.evaluateOnNewDocument(() => {
      const roomId = 'invite-state-room';
      const userId = 'invite-state-user';
      sessionStorage.setItem('crossfour.online.room', roomId);
      const state = window.__mockBackend = {
        session: { user: { id: userId, email: 'player@example.test' } },
        rpcCalls: [], channels: [], copiedUrl: '',
        tables: {
          profiles: [
            { id: userId, handle: 'playerone', display_name: 'Player One' },
            { id: 'invite-state-opponent', handle: 'opponent', display_name: 'Opponent' }
          ],
          wallets: [{ user_id: userId, coins: 1200, diamonds: 5 }],
          rooms: [{ id: roomId, created_by: userId, mode: 'classic', capacity: 2, status: 'waiting', updated_at: '2026-10-07T00:00:00.000Z' }],
          room_members: [
            { room_id: roomId, user_id: userId, seat: 0, role: 'host', ready: true },
            { room_id: roomId, user_id: 'invite-state-opponent', seat: 1, role: 'member', ready: true }
          ],
          room_invites: [{ room_id: roomId, invite_code: 'WAITINGROOM123456' }],
          match_history: [],
          match_states: [{ room_id: roomId, version: 0, state: {
            protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1], pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null],
            rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
            turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], turn_count: 0, last_roll: null, last_action: null
          } }],
          ludo_chess_matches: []
        }
      };

      state.emit = function (table, event) {
        state.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
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

      function queryBuilder(table) {
        const filters = [];
        let maxRows = null;
        function execute(single) {
          const rows = (state.tables[table] || []).filter(row => filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field]))));
          const data = rows.slice(0, maxRows === null ? rows.length : maxRows).map(row => JSON.parse(JSON.stringify(row)));
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
        return {
          name,
          handlers: [],
          removed: false,
          on(_type, filter, callback) { this.handlers.push({ filter, callback }); return this; },
          subscribe(callback) {
            state.channels.push(this);
            if (callback) setTimeout(() => callback('SUBSCRIBED'), 0);
            return this;
          }
        };
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
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
            rpc(name, args) { state.rpcCalls.push({ name, args }); return Promise.resolve({ data: {}, error: null }); }
          };
        }
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText(text) { state.copiedUrl = text; return Promise.resolve(); } }
      });
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const room = document.querySelector('#online-room-card');
      return room && !room.classList.contains('hidden') && document.querySelector('#online-room-connection').dataset.state === 'connected';
    });

    assert.equal(await page.$eval('#online-copy-invite', button => button.disabled), false, 'waiting rooms keep invite sharing enabled');
    assert.equal(await page.$eval('#online-invite-closed', notice => notice.classList.contains('hidden')), true, 'waiting rooms do not show the closed-invite notice');
    await page.click('#online-copy-invite');
    await page.waitForFunction(() => window.__mockBackend.copiedUrl.length > 0);
    const copiedWaitingLink = await page.evaluate(() => window.__mockBackend.copiedUrl);
    assert.match(copiedWaitingLink, /\?room=WAITINGROOM123456$/, 'a waiting-room link still copies successfully');

    async function setRoomStatus(status, expectedCopy) {
      await page.evaluate(nextStatus => {
        const state = window.__mockBackend;
        const room = state.tables.rooms[0];
        room.status = nextStatus;
        state.emit('rooms', { event: 'UPDATE', new: room });
      }, status);
      await page.waitForFunction((nextStatus, copyText) => {
        const roomStatus = document.querySelector('#online-room-status').textContent;
        const notice = document.querySelector('#online-invite-closed');
        return notice && !notice.classList.contains('hidden') && notice.textContent === copyText &&
          document.querySelector('#online-copy-invite').disabled && roomStatus.length > 0;
      }, {}, status, expectedCopy);
      assert.equal(await page.$eval('#online-copy-invite', button => button.getAttribute('aria-describedby')), 'online-invite-closed', status + ' invite control references its accessible explanation');
    }

    await setRoomStatus('active', 'This table has started. New players cannot join, so invite links are disabled.');
    const activeButton = await page.$('#online-copy-invite');
    await activeButton.evaluate(button => button.scrollIntoView({ block: 'center' }));
    await page.$eval('#online-room-card', element => element.scrollIntoView({ block: 'center' }));
    await fs.promises.mkdir(previewDir, { recursive: true });
    await page.addStyleTag({ content: '#game { display: none !important; }' });
    await page.$eval('#online-room-card', element => element.scrollIntoView({ block: 'center' }));
    await page.$('#online-room-card').then(element => element.screenshot({ path: path.join(previewDir, 'active-room-mobile.png') }));
    await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.$eval('#online-room-card', element => element.scrollIntoView({ block: 'center' }));
    await page.$('#online-room-card').then(element => element.screenshot({ path: path.join(previewDir, 'active-room-desktop.png') }));

    await page.evaluate(() => document.querySelector('#online-copy-invite').click());
    assert.equal(await page.evaluate(() => window.__mockBackend.copiedUrl), copiedWaitingLink, 'the disabled active-room control cannot copy a stale invite');
    assert.deepEqual(await page.evaluate(() => window.__mockBackend.rpcCalls), [], 'the mocked UI test makes no room-join or live server calls');

    await setRoomStatus('completed', 'This table is closed. New players cannot join, so invite links are disabled.');
    await setRoomStatus('cancelled', 'This table is closed. New players cannot join, so invite links are disabled.');
    assert.deepEqual(pageErrors, [], 'the Online room flow renders without browser errors');
    console.log('Online invite availability browser test passed (waiting, active, completed, cancelled).');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
