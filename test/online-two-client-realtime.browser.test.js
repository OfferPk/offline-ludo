'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const roomId = 'two-client-classic-room';

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

function installClientMock(page, userId) {
  return page.evaluateOnNewDocument(config => {
    const currentUserId = config.userId;
    const sharedRoomId = config.roomId;
    const initialState = {
      protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1],
      pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null],
      rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
      turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], turn_count: 0,
      last_roll: null, last_action: null
    };
    const tables = {
      profiles: [
        { id: 'client-one', display_name: 'Amina', handle: 'amina' },
        { id: 'client-two', display_name: 'Bilal', handle: 'bilal' }
      ],
      wallets: [{ user_id: currentUserId, coins: 1250, diamonds: 7 }],
      rooms: [{ id: sharedRoomId, created_by: 'client-one', mode: 'classic', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
      room_members: [
        { room_id: sharedRoomId, user_id: 'client-one', seat: 0, role: 'host', ready: true },
        { room_id: sharedRoomId, user_id: 'client-two', seat: 1, role: 'player', ready: true }
      ],
      room_invites: [{ room_id: sharedRoomId, inviter_id: 'client-one', invite_code: 'TWOCLIENT1234567' }],
      match_history: [{ id: 'history-two-client', room_id: sharedRoomId, mode: 'classic', status: 'active', winner_id: null, started_at: '2026-10-07T00:00:00.000Z', finished_at: null }],
      match_states: [{ room_id: sharedRoomId, version: 0, state: initialState, updated_at: '2026-10-07T00:00:00.000Z' }],
      ludo_chess_matches: []
    };
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    const mock = window.__twoClientMock = { userId: currentUserId, roomId: sharedRoomId, tables, channels: [], rpcCalls: [], remoteEvents: 0, rollCount: 0 };
    mock.emit = function (table, event) {
      mock.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
        const filter = handler.filter || {};
        if (filter.table !== table) return;
        if (filter.event && filter.event !== '*' && event.event && filter.event !== event.event) return;
        if (filter.filter) {
          const match = /^([a-z_]+)=eq\.(.+)$/.exec(filter.filter);
          const row = event.new || event.old || {};
          if (match && String(row[match[1]]) !== match[2]) return;
        }
        handler.callback(event);
      }));
    };
    const bus = new BroadcastChannel('crossfour-two-client-' + sharedRoomId);
    bus.onmessage = function (message) {
      const payload = message.data || {};
      if (payload.sender === currentUserId || payload.roomId !== sharedRoomId || payload.table !== 'match_states') return;
      const record = payload.event && payload.event.new;
      if (!record) return;
      const index = tables.match_states.findIndex(row => row.room_id === record.room_id);
      if (index < 0) tables.match_states.push(clone(record));
      else tables.match_states[index] = clone(record);
      mock.remoteEvents += 1;
      mock.emit('match_states', payload.event);
    };

    function queryBuilder(table) {
      const filters = [];
      let maxRows = null;
      function matches(row) {
        return filters.every(filter => filter.kind === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(value) === String(row[filter.field])));
      }
      function execute(single) {
        const rows = (tables[table] || []).filter(matches);
        const limited = maxRows === null ? rows : rows.slice(0, maxRows);
        const data = limited.map(clone);
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
      const channel = {
        name, handlers: [],
        on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
        subscribe(callback) {
          mock.channels.push(channel);
          if (callback) setTimeout(() => callback('SUBSCRIBED'), 0);
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
            getSession() { return Promise.resolve({ data: { session: { user: { id: currentUserId, email: currentUserId + '@example.test' } } }, error: null }); }
          },
          from: queryBuilder,
          channel: makeChannel,
          removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
          rpc(name, args) {
            mock.rpcCalls.push({ name, args });
            if (name !== 'roll_match') return Promise.resolve({ data: null, error: { message: 'Unexpected RPC: ' + name } });
            const member = tables.room_members.find(row => row.room_id === args.p_room_id && row.user_id === currentUserId);
            const record = tables.match_states.find(row => row.room_id === args.p_room_id);
            if (!member || !record || Number(args.p_expected_version) !== Number(record.version) || Number(record.state.turn) !== Number(member.seat)) {
              return Promise.resolve({ data: null, error: { message: 'Stale or unauthorized mock action', code: '40001' } });
            }
            const previous = clone(record);
            const face = mock.rollCount++ === 0 ? 6 : 3;
            const nextState = Object.assign({}, record.state, {
              last_roll: { seat: record.state.turn, face },
              last_action: { type: 'roll', seat: record.state.turn, face },
              queue: record.state.queue.concat([face]),
              phase: face === 6 ? 'roll' : 'move',
              sixes: face === 6 ? (record.state.sixes || 0) + 1 : 0
            });
            record.version += 1;
            record.state = nextState;
            const result = { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version: record.version, state: clone(nextState) };
            const event = { event: 'UPDATE', old: previous, new: clone(record) };
            mock.emit('match_states', event);
            bus.postMessage({ sender: currentUserId, roomId: sharedRoomId, table: 'match_states', event });
            return Promise.resolve({ data: result, error: null });
          }
        };
      }
    };
    sessionStorage.setItem('crossfour.online.room', sharedRoomId);
  }, { userId, roomId });
}

async function openClient(context, url, userId, pageErrors, externalRequests) {
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', error => pageErrors.push(userId + ': ' + error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
      request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://two-client-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_two_client_test', emailPasswordEnabled: true });" }).catch(() => {});
    } else if (requestUrl.origin === new URL(url).origin) {
      request.continue().catch(() => {});
    } else {
      externalRequests.push(request.url());
      request.abort().catch(() => {});
    }
  });
  await installClientMock(page, userId);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.click('#btn-online');
  await page.waitForFunction(() => !document.querySelector('#online').classList.contains('hidden')
    && !document.querySelector('#online-room-card').classList.contains('hidden')
    && document.querySelector('#online-match-version').textContent === 'Version 0', { timeout: 15000 });
  await page.waitForFunction(() => window.__twoClientMock.channels.some(channel => channel.handlers.some(handler => handler.filter.table === 'match_states')),
    { timeout: 5000 });
  return page;
}

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  const externalRequests = [];
  const context = await browser.createBrowserContext();
  try {
    const pageA = await openClient(context, local.url, 'client-one', pageErrors, externalRequests);
    const pageB = await openClient(context, local.url, 'client-two', pageErrors, externalRequests);
    assert.match(await pageA.$eval('#online-room-roster', el => el.textContent), /Amina[\s\S]*Bilal/, 'client A sees both roster members');
    assert.match(await pageB.$eval('#online-room-roster', el => el.textContent), /Amina[\s\S]*Bilal/, 'client B sees both roster members');

    await pageA.evaluate(() => document.querySelector('#game .pod[data-seat="0"] .pdice').click());
    await pageA.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 1'
      && window.__twoClientMock.rpcCalls.some(call => call.name === 'roll_match'), { timeout: 10000 });
    await pageB.waitForFunction(() => window.__twoClientMock.remoteEvents === 1
      && document.querySelector('#online-match-version').textContent === 'Version 1'
      && document.querySelector('#online-match-dice').textContent.includes('rolled 6'), { timeout: 10000 });

    const remoteState = await pageB.evaluate(() => ({
      userId: window.__twoClientMock.userId,
      version: window.__twoClientMock.tables.match_states[0].version,
      turn: window.__cf.game.st.turn,
      phase: window.__cf.game.st.phase,
      rpcCount: window.__twoClientMock.rpcCalls.length,
      turnLabel: document.querySelector('#online-match-turn').textContent,
      diceLabel: document.querySelector('#online-match-dice').textContent
    }));
    assert.equal(remoteState.userId, 'client-two', 'the receiving page has an independent authenticated identity');
    assert.equal(remoteState.version, 1, 'the receiving client applies the new server version from Realtime');
    assert.equal(remoteState.turn, 0, 'the receiving board reflects the server-owned active seat');
    assert.equal(remoteState.phase, 'roll', 'the receiving board reflects the server-owned roll phase');
    assert.equal(remoteState.rpcCount, 0, 'the non-active client did not submit an action');
    assert.match(remoteState.turnLabel, /Amina.*waiting for their turn/i, 'the second client is shown who controls the turn');
    assert.match(remoteState.diceLabel, /rolled 6/i, 'the second client sees the server-generated die result');
    assert.deepEqual(pageErrors, [], 'both independent browser clients have no uncaught errors');
    assert.deepEqual(externalRequests, [], 'the deterministic test sends no requests to Supabase or other external services');
    console.log('Online two-client realtime browser test passed: client A rolls; client B receives the authoritative version, turn, and server die through the mocked Realtime channel.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
