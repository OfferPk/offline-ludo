'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-invite-link-retry');
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

async function installMock(page) {
  await page.evaluateOnNewDocument(() => {
    const userId = 'invite-retry-user';
    const session = { user: { id: userId, email: 'player@example.test' } };
    const tables = {
      profiles: [{ id: userId, display_name: 'Amina', handle: 'amina' }],
      wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
      rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
    };
    const mock = window.__inviteRetryMock = { userId, session, tables, authListeners: [], channels: [], joinCalls: [] };
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
        const rows = (tables[table] || []).filter(matches);
        const limited = maximum === null ? rows : rows.slice(0, maximum);
        const data = limited.map(clone);
        return Promise.resolve({ data: single ? (data[0] || null) : data, error: null });
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
    function makeChannel(name) {
      const channel = {
        name, handlers: [], removed: false,
        on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
        subscribe(callback) {
          mock.channels.push(channel);
          if (callback) setTimeout(() => callback('SUBSCRIBED'), 0);
          return channel;
        }
      };
      return channel;
    }
    function addJoinedRoom() {
      const roomId = 'joined-invite-room';
      tables.rooms.push({ id: roomId, created_by: 'invite-host', mode: 'classic', capacity: 2, status: 'waiting', updated_at: '2026-10-07T00:00:00.000Z' });
      tables.room_members.push(
        { room_id: roomId, user_id: 'invite-host', seat: 0, role: 'host', ready: true },
        { room_id: roomId, user_id: userId, seat: 1, role: 'player', ready: false }
      );
      tables.room_invites.push({ room_id: roomId, invite_code: 'A7K2P9' });
      return roomId;
    }
    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange(callback) { mock.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session, error: null } }); }
          },
          from: queryBuilder,
          channel: makeChannel,
          removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
          rpc(name, args) {
            if (name !== 'join_room') return Promise.resolve({ data: null, error: { message: 'Unexpected mocked RPC: ' + name } });
            mock.joinCalls.push({ name, args: clone(args) });
            if (mock.joinCalls.length === 1) return Promise.resolve({ data: null, error: { message: 'Temporary room service failure.' } });
            if (args.p_invite_code !== 'A7K2P9') return Promise.resolve({ data: null, error: { message: 'Unknown invite code.' } });
            return Promise.resolve({ data: { room_id: addJoinedRoom(), status: 'waiting' }, error: null });
          }
        };
      }
    };
  });
}

async function main() {
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
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://invite-retry-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_invite_retry_test', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (requestUrl.origin === localOrigin) {
        request.continue().catch(() => {});
      } else {
        if (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') externalRequests.push(request.url());
        request.abort().catch(() => {});
      }
    });
    await installMock(page);
    await page.goto(local.url + '?room=A7K2P9', { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => window.__inviteRetryMock.joinCalls.length === 1
      && document.querySelector('#online-status').textContent.includes('Could not join room:'), { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('#online-room-panel').classList.contains('hidden'), { timeout: 5000 });

    const failedJoin = await page.evaluate(() => ({
      callCount: window.__inviteRetryMock.joinCalls.length,
      sentCode: window.__inviteRetryMock.joinCalls[0].args.p_invite_code,
      fieldCode: document.querySelector('#online-join-code').value,
      storedCode: sessionStorage.getItem('crossfour.online.pending-invite'),
      queryCode: new URLSearchParams(location.search).get('room'),
      status: document.querySelector('#online-status').textContent
    }));
    assert.equal(failedJoin.callCount, 1, 'a deep link makes one automatic join attempt');
    assert.equal(failedJoin.sentCode, 'A7K2P9', 'the automatic attempt normalizes the invite code');
    assert.equal(failedJoin.fieldCode, 'A7K2P9', 'the failed invite stays visible in the manual join field');
    assert.equal(failedJoin.storedCode, 'A7K2P9', 'the failed invite remains available in session storage');
    assert.equal(failedJoin.queryCode, 'A7K2P9', 'the URL retains the invite until a room is joined');
    assert.match(failedJoin.status, /Temporary room service failure/);

    await fs.promises.mkdir(previewDir, { recursive: true });
    await page.$eval('#online-room-panel', element => element.scrollIntoView({ block: 'center' }));
    const panel = await page.$('#online-room-panel');
    const preview = path.join(previewDir, 'mobile.png');
    await panel.screenshot({ path: preview });

    await page.evaluate(() => {
      const mock = window.__inviteRetryMock;
      mock.authListeners.forEach(listener => listener('USER_UPDATED', mock.session));
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.__inviteRetryMock.joinCalls.length), 1,
      'repeated account-session notifications do not silently retry a failed invite');

    await page.click('#online-join-room');
    await page.waitForFunction(() => window.__inviteRetryMock.joinCalls.length === 2
      && !document.querySelector('#online-room-card').classList.contains('hidden')
      && document.querySelector('#online-invite-code').value === 'A7K2P9'
      && sessionStorage.getItem('crossfour.online.pending-invite') === null
      && location.search === '', { timeout: 10000 });
    const completed = await page.evaluate(() => ({
      calls: window.__inviteRetryMock.joinCalls.map(call => call.args.p_invite_code),
      storedCode: sessionStorage.getItem('crossfour.online.pending-invite'),
      query: location.search,
      roomCode: document.querySelector('#online-invite-code').value
    }));
    assert.deepEqual(completed.calls, ['A7K2P9', 'A7K2P9'], 'manual retry resubmits the retained invite exactly once');
    assert.equal(completed.storedCode, null, 'a successful join clears the pending invite');
    assert.equal(completed.query, '', 'a successful join removes the room code from the address bar');
    assert.equal(completed.roomCode, 'A7K2P9', 'the joined room is attached normally');
    assert.deepEqual(pageErrors, [], 'invite recovery has no uncaught browser errors');
    assert.deepEqual(externalRequests, [], 'the browser regression uses only local assets and a mocked backend');
    console.log('Online invite-link retry browser test passed. Mobile preview:', preview);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
