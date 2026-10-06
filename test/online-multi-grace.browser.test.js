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
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
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
  const localServer = await startLocalServer();
  const origin = new URL(localServer.url).origin;
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
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
        return;
      }
      if (/supabase-js/.test(request.url())) {
        request.abort().catch(() => {});
        return;
      }
      if (requestUrl.origin === origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await page.evaluateOnNewDocument(() => {
      const now = Date.now();
      const roomId = 'multi-grace-room';
      const firstDisconnect = new Date(now - 15000).toISOString(); // window ends in about five seconds
      const secondDisconnect = new Date(now - 8000).toISOString(); // window ends later, in about twelve seconds
      const secondDeadline = Date.parse(secondDisconnect) + 20000;
      const state = window.__multiGraceBackend = {
        session: { user: { id: 'user-one', email: 'alice@example.test' } },
        rpcCalls: [], channels: [], authListeners: [], removedChannels: 0,
        tables: {
          profiles: [
            { id: 'user-one', handle: 'alice', display_name: 'Alice' },
            { id: 'user-two', handle: 'bob', display_name: 'Bob' },
            { id: 'user-three', handle: 'carol', display_name: 'Carol' }
          ],
          wallets: [{ user_id: 'user-one', coins: 100, diamonds: 0 }],
          rooms: [{ id: roomId, created_by: 'user-one', mode: 'classic', capacity: 3, status: 'active', updated_at: new Date(now).toISOString() }],
          room_members: [
            { room_id: roomId, user_id: 'user-one', seat: 0, role: 'host', ready: true, disconnected_at: null },
            { room_id: roomId, user_id: 'user-two', seat: 1, role: 'player', ready: true, disconnected_at: firstDisconnect },
            { room_id: roomId, user_id: 'user-three', seat: 2, role: 'player', ready: true, disconnected_at: secondDisconnect }
          ],
          room_invites: [{ room_id: roomId, invite_code: 'GRACE1' }],
          match_history: [{ id: 'history-' + roomId, room_id: roomId, mode: 'classic', status: 'active', winner_id: null, started_at: new Date(now - 60000).toISOString(), finished_at: null }],
          match_states: [{
            room_id: roomId,
            version: 1,
            state: {
              protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1, 2],
              pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], null],
              rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
              turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], abandoned: [],
              turn_count: 0, turn_deadline: now + 45000, grace: { seat: 2, until: secondDeadline }, last_roll: null, last_action: null
            }
          }],
          ludo_chess_matches: []
        }
      };
      try { sessionStorage.setItem('crossfour.online.room', roomId); } catch (_) {}

      state.emit = function (table, event) {
        state.channels.filter(channel => !channel.removed).forEach(channel => {
          channel.handlers.forEach(handler => {
            if (handler.filter.table !== table) return;
            const row = event.new || event.old || {};
            const filter = handler.filter.filter;
            if (filter) {
              const match = /^([a-z_]+)=eq\.(.+)$/.exec(filter);
              if (match && String(row[match[1]]) !== match[2]) return;
            }
            handler.callback(event);
          });
        });
      };
      function queryBuilder(table) {
        let operation = 'select';
        let patch = null;
        const filters = [];
        let maxRows = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          return Promise.resolve().then(() => {
            const matchedRows = (state.tables[table] || []).filter(matches);
            if (operation === 'update') {
              matchedRows.forEach(row => Object.assign(row, patch));
              return { data: null, error: null };
            }
            const rows = matchedRows.map(row => JSON.parse(JSON.stringify(row)));
            const limited = maxRows === null ? rows : rows.slice(0, maxRows);
            return { data: single ? (limited[0] || null) : limited, error: null };
          });
        }
        const builder = {
          select() { operation = 'select'; return builder; },
          update(values) { operation = 'update'; patch = values; return builder; },
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
      const client = {
        auth: {
          onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
          getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); }
        },
        from: queryBuilder,
        channel: makeChannel,
        removeChannel(channel) { channel.removed = true; state.removedChannels++; return Promise.resolve('ok'); },
        rpc(name, args) {
          const call = { name, args, at: Date.now(), expiredSeats: [] };
          state.rpcCalls.push(call);
          if (name !== 'expire_grace') return Promise.resolve({ data: null, error: { message: 'Unexpected RPC: ' + name } });
          const room = state.tables.rooms.find(row => row.id === args.p_room_id);
          const match = state.tables.match_states.find(row => row.room_id === args.p_room_id);
          const expired = state.tables.room_members.filter(member => member.room_id === args.p_room_id && member.disconnected_at && Date.parse(member.disconnected_at) < Date.now() - 20000);
          call.expiredSeats = expired.map(member => Number(member.seat));
          expired.forEach(member => {
            member.disconnected_at = null;
            state.emit('room_members', { event: 'UPDATE', new: member });
          });
          const nextState = JSON.parse(JSON.stringify(match.state));
          const abandoned = new Set(nextState.abandoned || []);
          expired.forEach(member => abandoned.add(Number(member.seat)));
          nextState.abandoned = Array.from(abandoned).sort((a, b) => a - b);
          const active = nextState.players.filter(seat => !nextState.ranking.includes(seat) && !nextState.abandoned.includes(seat));
          if (active.length < 2) {
            nextState.phase = 'over';
            nextState.result = 'abandoned';
            nextState.turn_deadline = null;
            room.status = 'completed';
            const history = state.tables.match_history.find(row => row.room_id === args.p_room_id);
            if (history) { history.status = 'completed'; history.finished_at = new Date().toISOString(); }
          } else if (nextState.abandoned.includes(nextState.turn)) {
            nextState.turn = active[0];
            nextState.phase = 'roll';
            nextState.queue = [];
            nextState.turn_count++;
          }
          match.version++;
          match.state = nextState;
          state.emit('match_states', { event: 'UPDATE', new: match });
          if (room.status === 'completed') state.emit('rooms', { event: 'UPDATE', new: room });
          return Promise.resolve({ data: { room_id: args.p_room_id, version: match.version, state: nextState }, error: null });
        }
      };
      window.supabase = { createClient() { return client; } };
    });

    await page.goto(localServer.url, { waitUntil: 'networkidle2' });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const panel = document.querySelector('#online-match-panel');
      return panel && !panel.classList.contains('hidden') && document.querySelector('#online-match-version').textContent === 'Version 1';
    }, { timeout: 15000 });

    await page.waitForFunction(() => window.__multiGraceBackend.rpcCalls.some(call => call.name === 'expire_grace'), { timeout: 15000 });
    const firstExpiry = await page.evaluate(() => {
      const backend = window.__multiGraceBackend;
      const calls = backend.rpcCalls.filter(call => call.name === 'expire_grace');
      const members = backend.tables.room_members;
      const match = backend.tables.match_states[0];
      return {
        callCount: calls.length,
        callAt: calls[0].at,
        secondDeadline: Date.parse(members.find(member => member.seat === 2).disconnected_at) + 20000,
        expiredSeats: calls[0].expiredSeats,
        firstStillDisconnected: !!members.find(member => member.seat === 1).disconnected_at,
        secondStillDisconnected: !!members.find(member => member.seat === 2).disconnected_at,
        abandoned: match.state.abandoned,
        graceSeat: match.state.grace && match.state.grace.seat,
        roomStatus: backend.tables.rooms[0].status
      };
    });
    assert.equal(firstExpiry.callCount, 1, 'the earliest reconnect window is processed first');
    assert.ok(firstExpiry.callAt < firstExpiry.secondDeadline, 'the earlier seat expires before the later seat deadline');
    assert.deepEqual(firstExpiry.expiredSeats, [1], 'expiring the earlier seat does not expire a later seat prematurely');
    assert.equal(firstExpiry.firstStillDisconnected, false, 'the first disconnected member is cleared at their own deadline');
    assert.equal(firstExpiry.secondStillDisconnected, true, 'the later disconnected member retains their independent grace window');
    assert.deepEqual(firstExpiry.abandoned, [1], 'the earlier expired seat is marked abandoned');
    assert.equal(firstExpiry.graceSeat, 2, 'the newer state.grace entry remains intact while the earlier seat expires');
    assert.equal(firstExpiry.roomStatus, 'active', 'the room continues while two players remain active');

    await page.waitForFunction(() => window.__multiGraceBackend.rpcCalls.filter(call => call.name === 'expire_grace').length >= 2, { timeout: 20000 });
    const finalState = await page.evaluate(() => {
      const backend = window.__multiGraceBackend;
      const calls = backend.rpcCalls.filter(call => call.name === 'expire_grace');
      const match = backend.tables.match_states[0];
      return {
        calls: calls.map(call => ({ at: call.at, expiredSeats: call.expiredSeats })),
        members: backend.tables.room_members.map(member => ({ seat: member.seat, disconnected: !!member.disconnected_at })),
        abandoned: match.state.abandoned,
        phase: match.state.phase,
        roomStatus: backend.tables.rooms[0].status
      };
    });
    assert.equal(finalState.calls.length, 2, 'each independent disconnect deadline invokes expiry once');
    assert.deepEqual(finalState.calls.map(call => call.expiredSeats), [[1], [2]], 'each expiry processes only the seats whose own grace deadlines have passed');
    assert.ok(finalState.calls[0].at < finalState.calls[1].at, 'the older disconnect expires before the newer one');
    assert.ok(finalState.members.every(member => !member.disconnected), 'both expired roster timestamps are cleared');
    assert.deepEqual(finalState.abandoned, [1, 2], 'both disconnected seats are eventually marked abandoned');
    assert.equal(finalState.phase, 'over', 'the server ends the match when fewer than two active players remain');
    assert.equal(finalState.roomStatus, 'completed', 'the room is completed after the final remaining seat is alone');
    assert.deepEqual(errors, [], 'the browser flow has no uncaught JavaScript errors');
    console.log('Online multi-seat reconnect expiry browser regression passed (individual deadlines, no masked seat, correct abandonment).');
  } finally {
    await browser.close();
    await new Promise(resolve => localServer.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
