'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

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
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });" }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await page.evaluateOnNewDocument(() => {
      const roomId = 'turn-expiry-room';
      const userId = 'user-one';
      const state = {
        protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1],
        pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null],
        rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
        turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], turn_count: 2,
        last_roll: null, last_action: null, turn_deadline: Date.now() - 500
      };
      const tables = {
        profiles: [
          { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
          { id: 'user-two', handle: 'bob123', display_name: 'Bob' }
        ],
        wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
        rooms: [{ id: roomId, created_by: userId, mode: 'classic', capacity: 2, status: 'active', updated_at: new Date().toISOString() }],
        room_members: [
          { room_id: roomId, user_id: 'user-one', seat: 0, role: 'host', ready: true },
          { room_id: roomId, user_id: 'user-two', seat: 1, role: 'player', ready: true }
        ],
        room_invites: [{ room_id: roomId, invite_code: 'TURNEXPIRY123456' }],
        match_history: [{ id: 'history-' + roomId, room_id: roomId, mode: 'classic', status: 'active', started_at: new Date().toISOString(), finished_at: null }],
        match_states: [{ room_id: roomId, version: 0, state }],
        ludo_chess_matches: []
      };
      const mock = window.__turnExpiryMock = { roomId, tables, calls: [], channels: [], session: { user: { id: userId, email: 'alice@example.test' } } };
      function clone(value) { return JSON.parse(JSON.stringify(value)); }
      function emit(table, change) {
        mock.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
          if (handler.filter.table !== table) return;
          const row = change.new || change.old || {};
          const match = /^([a-z_]+)=eq\.(.+)$/.exec(handler.filter.filter || '');
          if (match && String(row[match[1]]) !== match[2]) return;
          handler.callback(change);
        }));
      }
      function queryBuilder(table) {
        const filters = [];
        let maxRows = null;
        function rows() {
          let found = (tables[table] || []).filter(row => filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field]))));
          if (maxRows !== null) found = found.slice(0, maxRows);
          return clone(found);
        }
        const builder = {
          select() { return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
          order() { return builder; },
          limit(value) { maxRows = value; return builder; },
          maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
          then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); }
        };
        return builder;
      }
      function makeChannel(name) {
        const channel = {
          name, handlers: [], removed: false, statusCallback: null,
          on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
          subscribe(callback) {
            mock.channels.push(channel);
            channel.statusCallback = callback || null;
            if (channel.statusCallback && name === 'crossfour-room-' + roomId) {
              channel.statusCallback('CHANNEL_ERROR');
              window.setTimeout(() => {
                if (channel.removed || !channel.statusCallback) return;
                mock.connectedAt = Date.now();
                channel.statusCallback('SUBSCRIBED');
              }, 1100);
            } else if (channel.statusCallback) channel.statusCallback('SUBSCRIBED');
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
            rpc(name, args) {
              mock.calls.push({ name, args: clone(args), at: Date.now() });
              if (name !== 'expire_turn') return Promise.resolve({ data: {}, error: null });
              const match = tables.match_states.find(row => row.room_id === args.p_room_id);
              if (mock.calls.filter(call => call.name === 'expire_turn').length === 1) {
                return Promise.resolve({ data: null, error: { message: 'Network request failed', code: 'NETWORK_ERROR' } });
              }
              if (mock.calls.filter(call => call.name === 'expire_turn').length === 2) {
                return Promise.resolve({ data: { room_id: roomId, expired: false, version: match.version, state: clone(match.state) }, error: null });
              }
              const nextState = Object.assign({}, match.state, {
                turn: 1,
                phase: 'roll',
                queue: [],
                sixes: 0,
                turn_count: match.state.turn_count + 1,
                turn_deadline: Date.now() + 45000,
                last_action: { type: 'timeout' }
              });
              match.version += 1;
              match.state = nextState;
              emit('match_states', { event: 'UPDATE', new: clone(match) });
              return Promise.resolve({ data: { room_id: roomId, expired: true, version: match.version, state: clone(nextState) }, error: null });
            },
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); }
          };
        }
      };
      sessionStorage.setItem('crossfour.online.room', roomId);
    });

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => window.__turnExpiryMock && window.__turnExpiryMock.calls.filter(call => call.name === 'expire_turn').length >= 3, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 1', { timeout: 10000 });
    const result = await page.evaluate(() => {
      const mock = window.__turnExpiryMock;
      const match = mock.tables.match_states.find(row => row.room_id === mock.roomId);
      return {
        calls: mock.calls.filter(call => call.name === 'expire_turn'),
        connectedAt: mock.connectedAt,
        version: match.version,
        turn: match.state.turn,
        lastAction: match.state.last_action,
        deadline: match.state.turn_deadline,
        renderedVersion: document.querySelector('#online-match-version').textContent
      };
    });
    assert.equal(result.calls.length, 3, 'one transient network failure and one early server no-op both retry until expiry succeeds');
    assert.ok(result.calls.every(call => call.args.p_room_id === 'turn-expiry-room'), 'all retries stay scoped to the original active room');
    assert.ok(result.connectedAt > 0 && result.calls[0].at >= result.connectedAt, 'no timeout RPC is sent until the room has reconnected');
    assert.equal(result.version, 1, 'the server timeout advances the authoritative version once');
    assert.equal(result.turn, 1, 'the server timeout passes the turn to the next player');
    assert.equal(result.lastAction.type, 'timeout', 'the authoritative state records the timeout action');
    assert.match(result.renderedVersion, /Version 1/, 'the client refreshes to the authoritative post-timeout state');
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(await page.evaluate(() => window.__turnExpiryMock.calls.filter(call => call.name === 'expire_turn').length), 3, 'a completed timeout is not retried again for the next turn');
    assert.deepEqual(errors, [], 'turn-expiry retries produce no uncaught browser errors');
    console.log('Online turn-expiry browser regression passed (disconnect recovery, transient failure, early server no-op, successful single state transition).');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
