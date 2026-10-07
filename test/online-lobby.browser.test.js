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
  let localServer = null;
  let url = process.argv[2];
  if (!url) { localServer = await startLocalServer(); url = localServer.url; }
  const origin = new URL(url).origin;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errors = [];
    const sdkRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://exggyvbsqhoasrqgzerf.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
        return;
      }
      if (/supabase-js/.test(request.url())) {
        sdkRequests.push(request.url());
        request.abort().catch(() => {});
        return;
      }
      if (requestUrl.origin === origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__mockClipboardText = text; } } });
      let resumeFixture = null;
      try { resumeFixture = JSON.parse(sessionStorage.getItem('crossfour.online.test-fixture') || 'null'); } catch (_) {}
      const state = window.__mockBackend = {
        clientCalls: [], authCalls: [], rpcCalls: [], channels: [], authListeners: [],
        removedChannels: 0, activeRoomId: null, failRpc: null, failAuth: null, session: resumeFixture && resumeFixture.session || null,
        delayNextRead: null, failNextHistoryRead: false,
        actionResponses: {}, chessActionResponses: {}, rollCount: 0, forceChessStale: false, dropChessResponseAfterCommit: false, dropNextDrawResponseAfterCommit: false,
        tables: resumeFixture && resumeFixture.tables || {
          profiles: [
            { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
            { id: 'user-two', handle: 'bob123', display_name: 'Bob' }
          ],
          wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
          rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
        }
      };
      function ensureRoom(id, owner, mode, capacity) {
        let room = state.tables.rooms.find(row => row.id === id);
        if (!room) {
          room = { id, created_by: owner, mode: mode || 'classic', capacity: capacity || 2, status: 'waiting', updated_at: '2026-10-03T12:00:00.000Z' };
          state.tables.rooms.push(room);
        }
        if (!state.tables.room_invites.some(row => row.room_id === id)) {
          state.tables.room_invites.push({ room_id: id, invite_code: id === 'quick-room' ? 'QUICKROOM1234567' : id === 'host-room' ? 'HOSTROOM12345678' : 'INVITEROOM123456' });
        }
        return room;
      }
      function ensureMember(roomId, userId, seat, role, ready) {
        let member = state.tables.room_members.find(row => row.room_id === roomId && row.user_id === userId);
        if (!member) {
          member = { room_id: roomId, user_id: userId, seat, role, ready: !!ready };
          state.tables.room_members.push(member);
        }
        return member;
      }
      state.emit = function (table, event) {
        state.channels.filter(channel => !channel.removed).forEach(channel => {
          channel.handlers.forEach(handler => {
            const filter = handler.filter || {};
            if (filter.table !== table) return;
            if (filter.event && filter.event !== '*' && event.event && filter.event !== event.event) return;
            if (filter.filter) {
              const match = /^([a-z_]+)=eq\.(.+)$/.exec(filter.filter);
              const row = event.new || event.old || {};
              if (match && String(row[match[1]]) !== match[2]) return;
            }
            handler.callback(event);
          });
        });
      };
      state.snapshot = function () {
        return {
          clientCalls: state.clientCalls,
          authCalls: state.authCalls,
          rpcCalls: state.rpcCalls,
          channels: state.channels.map(channel => ({ name: channel.name, removed: !!channel.removed, tables: channel.handlers.map(handler => handler.filter.table) })),
          removedChannels: state.removedChannels
        };
      };
      function queryBuilder(table) {
        let operation = 'select';
        let patch = null;
        let filters = [];
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
            if (table === 'match_history' && state.failNextHistoryRead) {
              state.failNextHistoryRead = false;
              return { data: null, error: { message: 'Simulated history read failure' } };
            }
            const rows = matchedRows.map(row => JSON.parse(JSON.stringify(row)));
            const limited = maxRows === null ? rows : rows.slice(0, maxRows);
            const result = { data: single ? (limited[0] || null) : limited, error: null };
            if (state.delayNextRead && state.delayNextRead.table === table) {
              const delayMs = state.delayNextRead.ms;
              state.delayNextRead = null;
              return new Promise(resolve => setTimeout(() => resolve(result), delayMs));
            }
            return result;
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
          name,
          handlers: [],
          statusCallback: null,
          on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
          subscribe(callback) {
            state.channels.push(channel);
            channel.statusCallback = callback || null;
            if (channel.statusCallback) channel.statusCallback('SUBSCRIBED');
            return channel;
          }
        };
        return channel;
      }
      window.supabase = {
        createClient(url, key, options) {
          state.clientCalls.push({ url, key, options });
          const client = {
            auth: {
              onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
              signInWithPassword(credentials) {
                state.authCalls.push({ method: 'signInWithPassword', email: credentials.email, passwordLength: credentials.password.length });
                if (state.failAuth === 'signInWithPassword') return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
                state.session = { user: { id: 'user-one', email: credentials.email } };
                state.authListeners.forEach(callback => callback('SIGNED_IN', state.session));
                return Promise.resolve({ data: { user: state.session.user, session: state.session }, error: null });
              },
              signUp(credentials) {
                state.authCalls.push({ method: 'signUp', email: credentials.email, passwordLength: credentials.password.length });
                if (state.failAuth === 'signUp') return Promise.resolve({ data: null, error: { message: 'Unable to create account' } });
                state.session = { user: { id: 'user-one', email: credentials.email } };
                state.authListeners.forEach(callback => callback('SIGNED_IN', state.session));
                return Promise.resolve({ data: { user: state.session.user, session: state.session }, error: null });
              },
              resetPasswordForEmail(email, options) {
                state.authCalls.push({ method: 'resetPasswordForEmail', email, redirectTo: options.redirectTo });
                if (state.failAuth === 'resetPasswordForEmail') return Promise.resolve({ data: null, error: { message: 'Email service unavailable' } });
                return Promise.resolve({ data: {}, error: null });
              },
              updateUser(values) {
                state.authCalls.push({ method: 'updateUser', passwordLength: values.password.length });
                if (state.failAuth === 'updateUser') return Promise.resolve({ data: null, error: { message: 'Recovery link expired' } });
                if (!state.session) state.session = { user: { id: 'user-one', email: 'alice@example.test' } };
                state.authListeners.forEach(callback => callback('USER_UPDATED', state.session));
                return Promise.resolve({ data: { user: state.session.user }, error: null });
              },
              signOut() {
                state.session = null;
                state.authListeners.forEach(callback => callback('SIGNED_OUT', null));
                return Promise.resolve({ error: null });
              }
            },
            from: queryBuilder,
            rpc(name, args) {
              state.rpcCalls.push({ name, args });
              if (state.failRpc === name) return Promise.resolve({ data: null, error: { message: 'The matching service is unavailable.' } });
              let data = {};
              if (name === 'quick_match') {
                const roomId = args.p_mode === 'ludo_chess' ? 'quick-chess-room' : 'quick-room';
                ensureRoom(roomId, 'user-two', args.p_mode, args.p_capacity);
                ensureMember(roomId, 'user-one', 1, 'member', false);
                ensureMember(roomId, 'user-two', 0, 'host', true);
                state.activeRoomId = roomId;
                data = { room_id: roomId, status: 'waiting' };
              } else if (name === 'create_room') {
                const roomId = args.p_mode === 'ludo_chess' ? 'chess-room' : 'host-room';
                ensureRoom(roomId, 'user-one', args.p_mode, args.p_capacity);
                ensureMember(roomId, 'user-one', 0, 'host', false);
                ensureMember(roomId, 'user-two', 1, 'member', true);
                state.activeRoomId = roomId;
                data = { room_id: roomId, status: 'waiting' };
              } else if (name === 'join_room') {
                ensureRoom('invite-room', 'user-two', 'classic', 2);
                ensureMember('invite-room', 'user-two', 0, 'host', true);
                ensureMember('invite-room', 'user-one', 1, 'member', false);
                state.activeRoomId = 'invite-room';
                data = { room_id: 'invite-room', status: 'waiting' };
              } else if (name === 'set_room_ready') {
                const member = state.tables.room_members.find(row => row.room_id === args.p_room_id && row.user_id === 'user-one');
                if (member) member.ready = args.p_ready;
                data = { ready: args.p_ready };
              } else if (name === 'start_room') {
                const room = state.tables.rooms.find(row => row.id === args.p_room_id);
                if (room) room.status = 'active';
                if (!state.tables.match_history.some(row => row.room_id === args.p_room_id)) {
                  state.tables.match_history.push({ id: 'history-' + args.p_room_id, room_id: args.p_room_id, mode: room ? room.mode : 'classic', status: 'active', winner_id: null, started_at: '2026-10-03T12:30:00.000Z', finished_at: null });
                }
                if (room && room.mode === 'ludo_chess') {
                  const match = { room_id: args.p_room_id, version: 0, state: window.LudoChess.initialState(), draw_offer: null };
                  state.tables.ludo_chess_matches = state.tables.ludo_chess_matches.filter(row => row.room_id !== args.p_room_id);
                  state.tables.ludo_chess_matches.push(match);
                  state.emit('ludo_chess_matches', { event: 'INSERT', new: match });
                } else {
                  const match = {
                    room_id: args.p_room_id, version: 0,
                    state: { protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1], pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null], rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true }, turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], turn_count: 0, last_roll: null, last_action: null }
                  };
                  state.tables.match_states = state.tables.match_states.filter(row => row.room_id !== args.p_room_id);
                  state.tables.match_states.push(match);
                  state.emit('match_states', { event: 'INSERT', new: match });
                }
                data = { started: true };
              } else if (name === 'roll_match') {
                const match = state.tables.match_states.find(row => row.room_id === args.p_room_id);
                if (state.actionResponses[args.p_action_id]) {
                  data = Object.assign({}, state.actionResponses[args.p_action_id], { duplicate: true });
                } else {
                  const face = state.rollCount++ === 0 ? 6 : 3;
                  const nextState = Object.assign({}, match.state, {
                    last_roll: { seat: match.state.turn, face },
                    last_action: { type: 'roll', seat: match.state.turn, face },
                    queue: match.state.queue.concat([face]),
                    phase: face === 6 ? 'roll' : 'move',
                    sixes: face === 6 ? match.state.sixes + 1 : match.state.sixes
                  });
                  match.version++;
                  match.state = nextState;
                  data = { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version: match.version, state: nextState };
                  state.actionResponses[args.p_action_id] = data;
                  state.emit('match_states', { event: 'UPDATE', new: match });
                }
              } else if (name === 'move_match') {
                const match = state.tables.match_states.find(row => row.room_id === args.p_room_id);
                const nextState = JSON.parse(JSON.stringify(match.state));
                const die = nextState.queue[args.p_queue_index];
                nextState.pieces[nextState.turn][args.p_piece] = 0;
                nextState.queue = [];
                nextState.turn = 1;
                nextState.phase = 'roll';
                nextState.sixes = 0;
                nextState.last_action = { type: 'move', seat: 0, piece: args.p_piece, die, from: -1, to: 0, captures: [], finish: false };
                match.version++;
                match.state = nextState;
                data = { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version: match.version, state: nextState };
                state.emit('match_states', { event: 'UPDATE', new: match });
              } else if (name === 'ludo_chess_move') {
                const match = state.tables.ludo_chess_matches.find(row => row.room_id === args.p_room_id);
                const request = { type: 'chess_move', expected_version: args.p_expected_version, from: args.p_from, to: args.p_to, promotion: args.p_promotion };
                const actorId = state.session && state.session.user && state.session.user.id;
                const prior = state.chessActionResponses[args.p_action_id];
                if (prior) {
                  if (prior.actorId !== actorId || JSON.stringify(prior.request) !== JSON.stringify(request)) {
                    return Promise.resolve({ data: null, error: { message: 'Action ID was reused for a different request', code: '23505' } });
                  }
                  data = Object.assign({}, prior.response, { duplicate: true });
                  return Promise.resolve({ data, error: null });
                }
                if (state.forceChessStale || Number(args.p_expected_version) !== Number(match.version)) {
                  if (state.forceChessStale) {
                    state.forceChessStale = false;
                    match.version++;
                    state.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
                  }
                  return Promise.resolve({ data: null, error: { message: 'Match state is stale; refresh and try again', code: '40001' } });
                }
                let nextState;
                try { nextState = window.LudoChess.applyMove(match.state, { from: args.p_from, to: args.p_to, promotion: args.p_promotion }); }
                catch (error) { return Promise.resolve({ data: null, error: { message: error.message, code: '22023' } }); }
                match.version++;
                match.state = nextState;
                match.draw_offer = null;
                data = { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version: match.version, state: nextState };
                state.chessActionResponses[args.p_action_id] = { actorId, request, response: data };
                state.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
                if (state.dropChessResponseAfterCommit) {
                  state.dropChessResponseAfterCommit = false;
                  return Promise.resolve({ data: null, error: { message: 'The response was lost after the server applied the move' } });
                }
              } else if (name === 'offer_ludo_chess_draw' || name === 'respond_ludo_chess_draw') {
                const match = state.tables.ludo_chess_matches.find(row => row.room_id === args.p_room_id);
                const room = state.tables.rooms.find(row => row.id === args.p_room_id);
                const actorId = state.session && state.session.user && state.session.user.id;
                const member = state.tables.room_members.find(row => row.room_id === args.p_room_id && row.user_id === actorId);
                const isOffer = name === 'offer_ludo_chess_draw';
                const request = isOffer
                  ? { type: 'chess_draw_offer', expected_version: args.p_expected_version }
                  : { type: 'chess_draw_response', expected_version: args.p_expected_version, response: args.p_response };
                const prior = state.chessActionResponses[args.p_action_id];
                if (prior) {
                  if (prior.actorId !== actorId || JSON.stringify(prior.request) !== JSON.stringify(request)) {
                    return Promise.resolve({ data: null, error: { message: 'Action ID was reused for a different request', code: '23505' } });
                  }
                  return Promise.resolve({ data: Object.assign({}, prior.response, { duplicate: true }), error: null });
                }
                if (!member) return Promise.resolve({ data: null, error: { message: 'You are not a member of this room', code: '42501' } });
                if (Number(args.p_expected_version) !== Number(match.version)) return Promise.resolve({ data: null, error: { message: 'Match state is stale; refresh and try again', code: '40001' } });
                if (!room || room.status !== 'active' || match.state.phase !== 'active') return Promise.resolve({ data: null, error: { message: 'Chess game is not active', code: '55000' } });
                if (isOffer) {
                  if (match.draw_offer) return Promise.resolve({ data: null, error: { message: 'A draw offer is already pending', code: '55000' } });
                  match.draw_offer = { offered_by: Number(member.seat), position_version: Number(match.version) };
                } else {
                  const offer = match.draw_offer;
                  if (!offer) return Promise.resolve({ data: null, error: { message: 'There is no pending draw offer', code: '55000' } });
                  if (args.p_response === 'withdraw' && Number(member.seat) !== Number(offer.offered_by)) return Promise.resolve({ data: null, error: { message: 'Only the player who offered the draw can withdraw it', code: '42501' } });
                  if (['accept', 'decline'].includes(args.p_response) && Number(member.seat) === Number(offer.offered_by)) return Promise.resolve({ data: null, error: { message: 'Only the other player can respond to this draw offer', code: '42501' } });
                  if (!['accept', 'decline', 'withdraw'].includes(args.p_response)) return Promise.resolve({ data: null, error: { message: 'Match action is invalid', code: '22023' } });
                  if (Number(offer.position_version) !== Number(match.version) - 1) return Promise.resolve({ data: null, error: { message: 'Draw offer is stale; refresh and try again', code: '40001' } });
                  if (args.p_response === 'accept') {
                    match.state = Object.assign({}, match.state, { phase: 'over', result: 'draw_agreement', winner: null });
                    room.status = 'completed';
                    const history = state.tables.match_history.find(row => row.room_id === args.p_room_id);
                    if (history) Object.assign(history, { status: 'completed', winner_id: null, result: { version: Number(match.version) + 1, state: match.state }, finished_at: '2026-10-05T00:00:00.000Z' });
                  }
                  match.draw_offer = null;
                }
                match.version++;
                data = { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version: match.version, state: match.state, draw_offer: match.draw_offer };
                state.chessActionResponses[args.p_action_id] = { actorId, request, response: data };
                state.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
                if (state.dropNextDrawResponseAfterCommit) {
                  state.dropNextDrawResponseAfterCommit = false;
                  return Promise.resolve({ data: null, error: { message: 'The draw response was lost after the server applied the action' } });
                }
              } else if (name === 'leave_room') {
                state.tables.room_members = state.tables.room_members.filter(row => !(row.room_id === args.p_room_id && row.user_id === 'user-one'));
                state.activeRoomId = null;
                data = { left: true };
              }
              return Promise.resolve({ data, error: null });
            },
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; state.removedChannels++; return Promise.resolve('ok'); }
          };
          return client;
        }
      };
    });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#home:not(.hidden)');
    assert.deepEqual(sdkRequests, [], 'offline-first startup does not download the Supabase SDK');
    assert.equal(await page.$eval('#online', el => el.classList.contains('hidden')), true, 'online screen stays hidden at startup');
    for (const [width, height] of [[320, 568], [320, 844], [360, 844], [390, 844]]) {
      await page.setViewport({ width, height, isMobile: true, hasTouch: true });
      const entry = await page.$eval('#btn-online-chess', button => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const title = document.getElementById(button.getAttribute('aria-labelledby'));
        const description = document.getElementById(button.getAttribute('aria-describedby'));
        return {
          tag: button.tagName, type: button.type, title: title && title.textContent.trim(),
          description: description && description.textContent.trim(),
          visible: getComputedStyle(button).display !== 'none' && getComputedStyle(button).visibility === 'visible' && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight,
          hitTarget: hit === button || button.contains(hit), width: rect.width, height: rect.height,
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      });
      const label = width + '×' + height;
      assert.equal(entry.tag + ':' + entry.type, 'BUTTON:button', label + ': Chess entry uses a native button');
      assert.equal(entry.title, 'Ludo Chess', label + ': first-screen card has a clear accessible Chess name');
      assert.match(entry.description, /Online Rooms.*2 players/i, label + ': card describes the online two-player route');
      assert.equal(entry.visible, true, label + ': Chess entry is visible above the fold');
      assert.equal(entry.hitTarget, true, label + ': the center of the card is a working tap target');
      assert.ok(entry.height >= 44, label + ': home card meets the 44px mobile target height');
      assert.equal(entry.overflow, false, label + ': the home screen has no horizontal overflow');
    }
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.click('#btn-online-chess');
    await page.waitForSelector('#online:not(.hidden)');
    await page.waitForFunction(() => window.__mockBackend.clientCalls.length === 1);
    assert.equal(await page.$eval('#online-mode', el => el.value), 'ludo_chess', 'the Chess home entry opens the existing online lobby with Ludo Chess selected');
    assert.equal(await page.$eval('#online-capacity', el => el.value + ':' + el.disabled), '2:true', 'the Chess entry preserves the online mode two-seat requirement');
    assert.match(await page.$eval('#online-auth-panel', el => el.textContent), /sign in immediately; no confirmation link is required/i);
    assert.equal(await page.$eval('#online-email', el => el.value), '', 'email is not prefilled or hardcoded in the portal');
    assert.equal(await page.$eval('#online-signin', el => el.disabled), false, 'verified email/password auth enables sign-in');
    assert.equal(await page.$eval('#online-signup', el => el.disabled), false, 'enabled project signup enables account creation');
    await page.select('#online-mode', 'classic');
    const clientConfig = await page.evaluate(() => window.__mockBackend.clientCalls[0]);
    assert.equal(clientConfig.url, 'https://exggyvbsqhoasrqgzerf.supabase.co', 'client is constructed for the dedicated Online Ludo project');
    assert.equal(clientConfig.options.auth.flowType, 'pkce', 'browser auth uses PKCE');
    await page.$eval('#online-email', el => { el.value = 'alice@example.test'; });
    await page.$eval('#online-password', el => { el.value = 'not-a-real-password'; });
    await page.evaluate(() => { window.__mockBackend.failAuth = 'signInWithPassword'; });
    await page.click('#online-signin');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Sign-in failed: Invalid login credentials'));
    assert.equal(await page.$eval('#online-password', el => el.value), '', 'password field is cleared after a sign-in attempt');
    await page.evaluate(() => { window.__mockBackend.failAuth = null; });
    await page.$eval('#online-password', el => { el.value = 'synthetic-test-password'; });
    await page.click('#online-signin');
    assert.deepEqual(sdkRequests, [], 'mocked Supabase client prevents external SDK or project traffic in this deterministic test');

    await page.waitForFunction(() => document.querySelector('#online-account-panel').classList.contains('hidden') === false && document.querySelector('#online-profile-name').value === 'Alice');
    const signInCall = await page.evaluate(() => window.__mockBackend.authCalls.find(call => call.method === 'signInWithPassword'));
    assert.equal(signInCall.email, 'alice@example.test', 'typed email is passed to Supabase Auth');
    assert.equal(Object.hasOwn(signInCall, 'password'), false, 'auth mock records no password value');
    assert.equal(await page.$eval('#online-wallet-coins', el => el.textContent), '1,250', 'cloud coin balance loads from the wallet row');
    assert.equal(await page.$eval('#online-wallet-diamonds', el => el.textContent), '7', 'cloud diamond balance loads from the wallet row');
    assert.match(await page.$eval('#online-profile-handle', el => el.textContent), /@alice123/, 'cloud profile handle loads');
    await page.waitForFunction(() => window.__mockBackend.channels.some(channel => channel.name.startsWith('crossfour-wallet-')) && window.__mockBackend.channels.some(channel => channel.name.startsWith('crossfour-profile-')) && window.__mockBackend.channels.some(channel => channel.name.startsWith('crossfour-history-')));

    await page.$eval('#online-profile-name', el => { el.value = 'Alice Online'; });
    await page.click('#online-profile-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#online-profile-name').value === 'Alice Online');
    assert.equal(await page.evaluate(() => window.__mockBackend.tables.profiles.find(row => row.id === 'user-one').display_name), 'Alice Online', 'profile edit persists through the Supabase client path');

    await page.evaluate(() => {
      const state = window.__mockBackend;
      const wallet = state.tables.wallets[0];
      wallet.coins = 2500;
      wallet.diamonds = 12;
      state.emit('wallets', { event: 'UPDATE', old: { user_id: 'user-one' }, new: wallet });
    });
    await page.waitForFunction(() => document.querySelector('#online-wallet-coins').textContent === '2,500' && document.querySelector('#online-wallet-diamonds').textContent === '12');

    await page.click('#online-quick-match');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-room-mode').textContent === 'Classic · 2 seats');
    assert.match(await page.$eval('#online-room-roster', el => el.textContent), /Alice Online[\s\S]*Bob/, 'matchmaking loads a room roster with cloud names');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const bob = state.tables.profiles.find(row => row.id === 'user-two');
      bob.display_name = 'Bobby Live';
      state.emit('profiles', { event: 'UPDATE', old: { id: 'user-two' }, new: bob });
    });
    await page.waitForFunction(() => document.querySelector('#online-room-roster').textContent.includes('Bobby Live'));
    await page.click('#online-ready');
    await page.waitForFunction(() => document.querySelector('#online-ready').textContent === 'Mark not ready');
    assert.ok((await page.evaluate(() => window.__mockBackend.snapshot())).channels.some(channel => channel.tables.includes('room_members')), 'room roster/status changes subscribe through Realtime');

    await page.click('#online-leave-room');
    await page.waitForFunction(() => document.querySelector('#online-room-card').classList.contains('hidden'));
    await page.click('#online-create-room');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-invite-code').value === 'HOSTROOM12345678');
    await page.click('#online-ready');
    await page.waitForFunction(() => document.querySelector('#online-ready').textContent === 'Mark not ready');
    await page.click('#online-start-room');
      await page.waitForFunction(() => document.querySelector('#online-room-status').textContent.includes('validated by the server'));
      await page.waitForFunction(() => document.querySelector('#online-history-list').textContent.includes('Classic · active'));
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.failNextHistoryRead = true;
      state.emit('match_history', { event: 'UPDATE', new: state.tables.match_history[0] });
    });
    await page.waitForFunction(() => !document.querySelector('#online-history-feedback').classList.contains('hidden') && !document.querySelector('#online-history-retry').disabled);
    assert.match(await page.$eval('#online-history-feedback-message', el => el.textContent), /could not be refreshed/i, 'history failures are explained beside the history list');
    assert.equal(await page.$$eval('#online-history-list li', items => items.length), 1, 'a failed refresh preserves the last successful history rows');
    const previousGameVisibility = await page.$eval('#game', el => el.style.visibility);
    await page.$eval('#game', el => { el.style.visibility = 'hidden'; });
    if (process.env.PREVIEW_DIR) {
      fs.mkdirSync(process.env.PREVIEW_DIR, { recursive: true });
      await page.setViewport({ width: 1440, height: 900, isMobile: true, hasTouch: true });
      const desktopHistoryCard = await page.$('[aria-labelledby="online-history-heading"]');
      await desktopHistoryCard.screenshot({ path: path.join(process.env.PREVIEW_DIR, 'online-history-retry-desktop.png') });
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      const mobileHistoryCard = await page.$('[aria-labelledby="online-history-heading"]');
      await mobileHistoryCard.screenshot({ path: path.join(process.env.PREVIEW_DIR, 'online-history-retry-mobile.png') });
    }
    await page.evaluate(() => { window.__mockBackend.delayNextRead = { table: 'match_history', ms: 120 }; });
    await page.click('#online-history-retry');
    await page.waitForFunction(() => !document.querySelector('#online-history-feedback').classList.contains('hidden') && document.querySelector('#online-history-retry').disabled && document.querySelector('#online-history-feedback-message').textContent.includes('Refreshing'));
    await page.waitForFunction(() => document.querySelector('#online-history-feedback').classList.contains('hidden') && document.querySelector('#online-history-list').textContent.includes('Classic · active'));
    assert.equal(await page.$eval('#online-status', el => el.textContent), 'Match history refreshed.', 'manual retry clears the prior global error status');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.delayNextRead = { table: 'match_history', ms: 180 };
      state.emit('match_history', { event: 'UPDATE', new: state.tables.match_history[0] });
      setTimeout(() => {
        const row = state.tables.match_history[0];
        row.status = 'completed';
        state.emit('match_history', { event: 'UPDATE', new: row });
      }, 10);
    });
    await page.waitForFunction(() => document.querySelector('#online-history-list').textContent.includes('Classic · completed'));
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.match(await page.$eval('#online-history-list', el => el.textContent), /Classic · completed/, 'a slower stale response cannot overwrite a newer history refresh');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.tables.match_history[0].status = 'active';
      state.emit('match_history', { event: 'UPDATE', new: state.tables.match_history[0] });
    });
    await page.waitForFunction(() => document.querySelector('#online-history-list').textContent.includes('Classic · active'));
    await page.$eval('#game', (el, visibility) => { el.style.visibility = visibility; }, previousGameVisibility);
    if (process.env.ONLINE_HISTORY_RETRY_ONLY === '1') {
      assert.deepEqual(errors, [], 'history retry does not cause browser runtime errors');
      console.log('Online history retry browser checks passed.');
      return;
    }
      await page.waitForFunction(() => !document.querySelector('#online-match-panel').classList.contains('hidden') && document.querySelector('#online-match-version').textContent === 'Version 0');
      await page.waitForFunction(() => !document.querySelector('#game').classList.contains('hidden') && document.querySelector('#board') && document.querySelector('#online-match-pieces').classList.contains('hidden'));
      await page.evaluate(() => { window.__mockBackend.failRpc = 'roll_match'; });
      await page.evaluate(() => document.querySelector('#game .pod[data-seat="0"] .pdice').click());
      await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Retry uses the same action ID.'));
      const firstRollId = await page.evaluate(() => window.__mockBackend.rpcCalls.findLast(call => call.name === 'roll_match').args.p_action_id);
      await page.evaluate(() => { window.__mockBackend.failRpc = null; });
      await page.click('#online-match-retry');
      await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 1' && document.querySelector('#online-match-dice').textContent.includes('rolled 6'));
      await page.evaluate(() => document.querySelector('#game .pod[data-seat="0"] .pdice').click());
      await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 2' && document.querySelector('#online-match-turn').textContent.includes('choose a legal token move'));
      await page.waitForFunction(() => { const g = window.__cf.game; return g && g.online && g.st.phase === 'move' && g.st.moves.some(m => m.piece === 0); });
      await page.evaluate(() => document.querySelector('#pieces .pc[data-seat="0"][data-piece="0"]').click());
      await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 3' && window.__cf.game && window.__cf.game.st.pieces[0][0] === 0);
      const matchCalls = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => ['roll_match', 'move_match'].includes(call.name)));
      assert.equal(matchCalls[0].args.p_action_id, firstRollId, 'retry sends the same idempotency key after a dropped action');
      assert.equal(Object.hasOwn(matchCalls[0].args, 'p_die'), false, 'client cannot pass a dice face into the server roll RPC');
      assert.equal(Object.hasOwn(matchCalls[2].args, 'p_die'), false, 'move RPC receives only a server queue index, not a forged die face');
      await page.waitForFunction(() => document.querySelector('#online-match-turn').textContent.includes('Bobby Live · waiting for their turn'));
      assert.ok((await page.evaluate(() => window.__mockBackend.snapshot())).channels.some(channel => channel.tables.includes('match_states')), 'live match-state changes are subscribed and re-read after reconnect');
      await page.evaluate(() => window.__mockBackend.emit('match_history', { event: 'INSERT', new: { id: 'history-one', user_id: 'user-one' } }));

    await page.evaluate(() => document.querySelector('#btn-home').click());
    await page.click('#online-leave-room');
    await page.waitForFunction(() => document.querySelector('#online-room-card').classList.contains('hidden'));
    await page.$eval('#online-capacity', el => { el.value = '3'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.select('#online-mode', 'ludo_chess');
    assert.equal(await page.$eval('#online-capacity', el => el.value + ':' + el.disabled), '2:true', 'Chess mode forces and locks a two-player table');
    assert.match(await page.$eval('#online-mode-note', el => el.textContent), /exactly two players/i, 'the mode explanation states the two-seat rule');
    await page.select('#online-mode', 'classic');
    assert.equal(await page.$eval('#online-capacity', el => el.value + ':' + el.disabled), '3:false', 'switching back to Classic restores the selected capacity');
    await page.select('#online-mode', 'ludo_chess');
    await page.click('#online-create-room');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-invite-code').value === 'INVITEROOM123456');
    await page.waitForFunction(() => document.querySelector('#online-room-mode').textContent === 'Ludo Chess · 2 seats');
    await page.click('#online-ready');
    await page.waitForFunction(() => document.querySelector('#online-ready').textContent === 'Mark not ready');
    await page.click('#online-start-room');
    await page.waitForFunction(() => !document.querySelector('#online-chess-play').classList.contains('hidden') && document.querySelectorAll('#online-chess-board [data-square]').length === 64);
    assert.equal(await page.$eval('#online-chess-screen', el => !el.classList.contains('hidden') && el.getAttribute('aria-hidden') === 'false'), true, 'an active Chess room opens the dedicated accessible play screen');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'online-chess-screen-title', 'opening the play screen moves focus to its visible title');
    assert.match(await page.$eval('#online-chess-screen-title', el => getComputedStyle(el).outlineStyle), /solid/, 'the focused screen title has a visible focus indicator');
    assert.equal(await page.$eval('#online-match-panel', el => el.parentElement.id), 'online-chess-screen', 'the Chess match panel is moved into the focused screen without duplicating state');
    assert.equal(await page.$eval('#online-chess-red-clock', el => el.textContent.trim()), 'Untimed', 'the UI does not invent a clock absent from server match state');
    assert.equal(await page.$eval('#online-chess-resign', el => !el.classList.contains('hidden')), true, 'the active player sees the existing resignation control');
    assert.equal(await page.$eval('#online-chess-screen-title', el => el.textContent), 'Ludo Chess', 'the play screen has a clear accessible title');
    const boardSemantics = await page.evaluate(() => {
      const board = document.querySelector('#online-chess-board');
      return { role: board.getAttribute('role'), rowCount: board.getAttribute('aria-rowcount'), colCount: board.getAttribute('aria-colcount'), describedBy: board.getAttribute('aria-describedby'), rows: [...board.children].map(row => ({ role: row.getAttribute('role'), index: row.getAttribute('aria-rowindex'), cells: row.children.length })), firstSquareRole: board.querySelector('[data-square="0"]').getAttribute('role'), firstSquareName: board.querySelector('[data-square="0"]').getAttribute('aria-label'), firstSquareDisabled: board.querySelector('[data-square="0"]').getAttribute('aria-disabled'), firstSquareSelected: board.querySelector('[data-square="0"]').getAttribute('aria-selected') };
    });
    assert.equal(boardSemantics.role + ':' + boardSemantics.rowCount + ':' + boardSemantics.colCount, 'grid:8:8', 'the board exposes an 8-by-8 ARIA grid');
    assert.equal(boardSemantics.rows.length, 8, 'the Chess grid has eight explicit accessible rows');
    assert.ok(boardSemantics.rows.every((row, index) => row.role === 'row' && row.index === String(index + 1) && row.cells === 8), 'each grid row exposes its index and eight squares');
    assert.equal(boardSemantics.firstSquareRole, 'gridcell', 'each square exposes the gridcell role');
    assert.match(boardSemantics.firstSquareName, /(?:Red|Blue) rook on a8/, 'each square has a spoken piece and coordinate name');
    assert.equal(boardSemantics.firstSquareDisabled, 'false', 'the active player can act on their own turn');
    assert.equal(boardSemantics.firstSquareSelected, 'false', 'square selection state is exposed to assistive technology');
    assert.match(await page.$eval('#online-chess-board-instructions', el => el.textContent), /arrow keys[\s\S]*Enter or Space/i, 'keyboard instructions describe board navigation and activation');
    const liveSemantics = await page.evaluate(() => ['online-chess-status', 'online-chess-announcement', 'online-room-connection'].map(id => { const el = document.getElementById(id); return [el.getAttribute('role'), el.getAttribute('aria-live'), el.getAttribute('aria-atomic')]; }));
    assert.ok(liveSemantics.every(parts => parts[0] === 'status' && parts[1] === 'polite' && parts[2] === 'true'), 'turn, move-result, and connection updates use polite atomic status announcements');
    assert.match(await page.$eval('#online-chess-status', el => el.textContent), /Alice.*your move/, 'the current turn is announced with the player name');
    assert.equal(await page.$$eval('#online-chess-board [data-square][tabindex="0"]', cells => cells.length), 1, 'the chess grid uses a single roving keyboard tab stop');
    await page.focus('#online-chess-board [data-square="52"]');
    assert.equal(await page.$eval('#online-chess-board [data-square="52"]', el => el.tabIndex), 0, 'the focused square becomes the roving tab stop');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.square), '53', 'arrow keys move keyboard focus across board squares');
    assert.equal(await page.$eval('#online-chess-board [data-square="53"]', el => el.tabIndex), 0, 'arrow navigation moves the single tab stop with focus');
    assert.equal(await page.$eval('#online-chess-board [data-square="52"]', el => el.tabIndex), -1, 'the previous square leaves the tab sequence');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'online-chess-offer-draw', 'Tab exits the grid to the first visible draw-offer control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.square), '53', 'Shift+Tab re-enters the grid at its current roving tab stop');
    const mobileBoard = await page.evaluate(() => ({ board: document.querySelector('#online-chess-board').getBoundingClientRect().width, viewport: innerWidth, square: document.querySelector('#online-chess-board [data-square]').getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(mobileBoard.overflow, false, 'the Chess screen has no horizontal overflow on a phone viewport');
    assert.ok(mobileBoard.board <= mobileBoard.viewport && mobileBoard.square >= 35, 'the mobile board fits the screen with practical touch targets');
    const touchTargets = await page.evaluate(() => ['#online-chess-back', '#online-leave-room', '#online-chess-offer-draw', '#online-chess-resign'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, width: r.width, height: r.height }; }));
    assert.ok(touchTargets.every(target => target.width >= 24 && target.height >= 44), 'room navigation and gameplay actions have WCAG-sized mobile tap targets: ' + JSON.stringify(touchTargets));
    const contrast = await page.evaluate(() => {
      function rgb(value) { return value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255); }
      function luminance(value) { const channels = rgb(value).map(channel => channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4)); return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]; }
      function ratio(foreground, background) { const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); }
      const light = document.querySelector('#online-chess-board [data-square="52"]');
      const dark = document.querySelector('#online-chess-board [data-square="56"]');
      const lightCoordinate = document.querySelector('#online-chess-board [data-square="0"]');
      return {
        lightCoordinate: ratio(getComputedStyle(lightCoordinate.querySelector('.square-coord')).color, getComputedStyle(lightCoordinate).backgroundColor),
        darkCoordinate: ratio(getComputedStyle(dark.querySelector('.square-coord')).color, getComputedStyle(dark).backgroundColor),
        lightPieceEdge: ratio(getComputedStyle(light.querySelector('.online-chess-piece')).webkitTextStrokeColor, getComputedStyle(light).backgroundColor),
        darkPieceEdge: ratio(getComputedStyle(dark.querySelector('.online-chess-piece')).webkitTextStrokeColor, getComputedStyle(dark).backgroundColor),
        focus: { outline: getComputedStyle(document.activeElement).outlineColor, shadow: getComputedStyle(document.activeElement).boxShadow }
      };
    });
    assert.ok(contrast.lightCoordinate >= 4.5 && contrast.darkCoordinate >= 4.5, 'board coordinates meet 4.5:1 text contrast on both square tones');
    assert.ok(contrast.lightPieceEdge >= 3 && contrast.darkPieceEdge >= 3, 'piece outlines meet 3:1 non-text contrast on both square tones');
    assert.match(contrast.focus.outline, /255, 245, 223/, 'focused squares use a high-contrast light outline');
    assert.match(contrast.focus.shadow, /inset/, 'focused squares also use a contrasting inner outline');
    await page.setViewport({ width: 320, height: 780, isMobile: true, hasTouch: true });
    const compactBoard = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, square: document.querySelector('#online-chess-board [data-square]').getBoundingClientRect().width }));
    assert.equal(compactBoard.overflow, false, 'the board remains within a narrow 320px phone viewport');
    assert.ok(compactBoard.square >= 24, 'even the narrow phone layout retains accessible square tap targets');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    assert.equal(await page.$eval('#online-chess-board [data-square="52"] .online-chess-piece', el => el.classList.contains('red-piece')), true, 'seat zero is rendered as Red Ludo-colored pieces');
    await page.click('#online-chess-board [data-square="52"]');
    await page.waitForSelector('#online-chess-board [data-square="36"].is-legal');
    await page.click('#online-chess-board [data-square="36"]');
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 1' && document.querySelector('#online-match-turn').textContent.includes('Blue · Bobby Live'));
    assert.match(await page.$eval('#online-chess-announcement', el => el.textContent), /Red · Alice(?: Online)? moved from e2 to e4\. Blue · Bobby Live to move\./, 'an accepted move result is announced with its coordinates and the next player');
    assert.deepEqual(await page.$eval('#online-chess-board [data-square="52"]', el => ({ disabled: el.disabled, ariaDisabled: el.getAttribute('aria-disabled') })), { disabled: false, ariaDisabled: 'true' }, 'opponent-turn squares are announced disabled but remain focusable');
    await page.focus('#online-chess-board [data-square="52"]');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.square), '53', 'arrow navigation remains available while waiting for the opponent');
    const waitingRpcCount = await page.evaluate(() => window.__mockBackend.rpcCalls.length);
    await page.click('#online-chess-board [data-square="53"]');
    assert.equal(await page.evaluate(() => window.__mockBackend.rpcCalls.length), waitingRpcCount, 'aria-disabled board squares cannot submit an out-of-turn action');
    assert.match(await page.$eval('#online-chess-move-list', el => el.textContent), /1\.\s*e4/, 'the move list shows SAN reconstructed from server position history');
    assert.match(await page.$eval('#online-chess-history-notation', el => el.textContent), /standard algebraic notation/i, 'the move-list format is explicitly identified as SAN');
    assert.equal(await page.$eval('#online-chess-copy-pgn', el => el.disabled), false, 'PGN export is enabled only after the complete initial-to-current history verifies');
    await page.click('#online-chess-copy-pgn');
    await page.waitForFunction(() => document.querySelector('#online-chess-pgn-status').textContent === 'PGN copied to clipboard.');
    const firstPgn = await page.evaluate(() => window.__mockClipboardText);
    assert.match(firstPgn, /\[Event "Ludo Chess"\][\s\S]*\[Result "\*"\][\s\S]*1\. e4 \*/, 'copy action exports the verified SAN game as PGN without inventing a result');
    assert.equal(await page.$eval('#online-chess-board [data-square="52"]', el => el.classList.contains('last-from')), true, 'the board marks the origin square of the latest move');
    assert.equal(await page.$eval('#online-chess-board [data-square="36"]', el => el.classList.contains('last-to')), true, 'the board marks the destination square of the latest move');
    const chessCall = await page.evaluate(() => window.__mockBackend.rpcCalls.findLast(call => call.name === 'ludo_chess_move'));
    assert.equal(chessCall.args.p_from, 52, 'Chess RPC receives the selected source square');
    assert.equal(chessCall.args.p_to, 36, 'Chess RPC receives a locally legal destination square');
    assert.equal(chessCall.args.p_expected_version, 0, 'Chess action uses the observed authoritative state version');
    assert.equal(Object.hasOwn(chessCall.args, 'p_die'), false, 'Chess RPC does not accept any client-generated dice value');
    assert.ok((await page.evaluate(() => window.__mockBackend.snapshot())).channels.some(channel => channel.tables.includes('ludo_chess_matches')), 'Chess state is subscribed through Realtime');

    async function seedPromotionPosition(color) {
      const version = await page.evaluate(color => {
        const backend = window.__mockBackend;
        const match = backend.tables.ludo_chess_matches.find(row => row.room_id === backend.activeRoomId);
        backend.tables.room_members.filter(member => member.room_id === match.room_id).forEach(member => { member.seat = member.user_id === 'user-one' ? color : 1 - color; });
        const position = window.LudoChess.initialState();
        const board = Array(64).fill('.');
        board[60] = 'K'; board[4] = 'k';
        if (color === 0) board[8] = 'P'; else board[55] = 'p';
        position.board = board.join(''); position.turn = color; position.phase = 'active'; position.castling = ''; position.en_passant = -1;
        position.halfmove = 0; position.fullmove = 1; position.last_move = null; position.winner = null; position.result = null; position.check = false;
        position.position_history = [window.LudoChess.positionKey(position)];
        match.version++; match.state = position;
        backend.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
        return match.version;
      }, color);
      await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + value, {}, version);
      await page.waitForFunction(value => document.querySelector('#online-chess-status').textContent.includes((value === 0 ? 'Red' : 'Blue') + ' · Alice Online · your move'), {}, color);
      return version;
    }

    for (const choice of ['q', 'r', 'b', 'n']) {
      const version = await seedPromotionPosition(0);
      await page.click('#online-chess-board [data-square="8"]');
      await page.waitForSelector('#online-chess-board [data-square="0"].is-legal');
      await page.$eval('#online-chess-board [data-square="0"]', el => el.scrollIntoView({ block: 'center', inline: 'center' }));
      const destinationHit = await page.evaluate(() => {
        const cell = document.querySelector('#online-chess-board [data-square="0"]'), rect = cell.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const header = document.querySelector('.online-chess-header'), headerRect = header.getBoundingClientRect();
        return { reachable: hit === cell || cell.contains(hit), headerPosition: getComputedStyle(header).position };
      });
      assert.equal(destinationHit.reachable, true, 'the top-rank promotion destination is not covered by screen chrome on mobile');
      assert.equal(destinationHit.headerPosition, 'relative', 'the play-screen header scrolls with content instead of overlaying board cells');
      await page.click('#online-chess-board [data-square="0"]');
      const chooser = await page.waitForFunction(() => {
        const group = document.querySelector('#online-chess-promotion');
        return !group.classList.contains('hidden') ? group : false;
      }, { timeout: 10000 });
      assert.ok(await chooser.evaluate(el => el.getAttribute('role') === 'group' && el.getAttribute('aria-label') === 'Choose a promotion piece'), 'the visible mobile promotion chooser is a named accessible group');
      const choices = await page.$$eval('#online-chess-promotion [data-promotion]', buttons => buttons.map(button => ({ piece: button.dataset.promotion, name: button.getAttribute('aria-label'), height: button.getBoundingClientRect().height, disabled: button.disabled })));
      assert.deepEqual(choices.map(button => [button.piece, button.name]), [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']], 'the chooser offers accessible Queen, Rook, Bishop, and Knight options');
      assert.ok(choices.every(button => button.height >= 44 && !button.disabled), 'each promotion choice has a 44px touch target while synchronized');
      if (choice === 'q') await page.evaluate(() => { window.__mockBackend.dropChessResponseAfterCommit = true; });
      await page.click('#online-chess-promotion [data-promotion="' + choice + '"]');
      if (choice === 'q') {
        await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Retry uses the same action ID.'));
        const firstAttempt = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'ludo_chess_move').at(-1).args);
        assert.equal(firstAttempt.p_promotion, choice, 'the Queen choice reaches the authoritative move RPC unchanged');
        await page.click('#online-match-retry');
        await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('The server confirmed this was already applied.'));
        const retried = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'ludo_chess_move').slice(-2).map(call => call.args));
        assert.deepEqual(retried[1], retried[0], 'a retry after a lost response reuses the same promotion, version, and action ID');
      } else {
        await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + (value + 1), {}, version);
      }
      const result = await page.evaluate(() => {
        const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches.find(row => row.room_id === backend.activeRoomId);
        const call = backend.rpcCalls.filter(item => item.name === 'ludo_chess_move').at(-1);
        return { piece: match.state.board[0], version: match.version, args: call.args };
      });
      assert.equal(result.piece, choice.toUpperCase(), 'the server-returned Red board contains the selected ' + choice.toUpperCase());
      assert.equal(result.version, version + 1, 'duplicate promotion retries advance the authoritative state only once');
      assert.deepEqual([result.args.p_from, result.args.p_to, result.args.p_promotion, result.args.p_expected_version], [8, 0, choice, version], 'the exact Red source, destination, choice, and observed version are sent');
    }

    const staleVersion = await seedPromotionPosition(0);
    await page.click('#online-chess-board [data-square="8"]');
    await page.waitForSelector('#online-chess-board [data-square="0"].is-legal');
    await page.click('#online-chess-board [data-square="0"]');
    await page.evaluate(() => { window.__mockBackend.forceChessStale = true; });
    await page.click('#online-chess-promotion [data-promotion="b"]');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Refresh the state and try again.'));
    await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + (value + 1), {}, staleVersion);
    const staleState = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches.find(row => row.room_id === backend.activeRoomId);
      const call = backend.rpcCalls.filter(item => item.name === 'ludo_chess_move').at(-1);
      return { board: match.state.board, action: sessionStorage.getItem('crossfour.online.pending-match-action'), args: call.args };
    });
    assert.equal(staleState.board[8], 'P', 'a stale promotion request leaves the pawn and server board unchanged');
    assert.equal(staleState.board[0], '.', 'stale choices never alter the authoritative destination square');
    assert.equal(staleState.action, null, 'the client clears a rejected stale action instead of retrying it indefinitely');
    assert.equal(staleState.args.p_promotion, 'b', 'the stale request still carries its explicit Bishop choice for server validation');

    const blueVersion = await seedPromotionPosition(1);
    const blueOrientation = await page.evaluate(() => ({
      label: document.querySelector('#online-chess-board').getAttribute('aria-label'),
      top: [...document.querySelector('#online-chess-board').children[0].children].map(square => Number(square.dataset.square)),
      bottom: [...document.querySelector('#online-chess-board').children[7].children].map(square => Number(square.dataset.square)),
      blue: document.querySelector('#online-chess-board [data-square="55"] .online-chess-piece').classList.contains('blue-piece'),
      redKing: document.querySelector('#online-chess-board [data-square="60"] .online-chess-piece').classList.contains('red-piece'),
      blueRole: document.querySelector('#online-chess-blue-role').textContent
    }));
    assert.match(blueOrientation.label, /Red side at bottom/);
    assert.deepEqual(blueOrientation.top, [0, 1, 2, 3, 4, 5, 6, 7], 'Blue sees the same standard rank-8-at-top board orientation');
    assert.deepEqual(blueOrientation.bottom, [56, 57, 58, 59, 60, 61, 62, 63], 'Blue sees the Red home rank at the bottom of the board');
    assert.equal(blueOrientation.blue, true, 'the Blue pawn remains correctly colored on h2');
    assert.equal(blueOrientation.redKing, true, 'the Red king remains correctly colored at the bottom');
    assert.match(blueOrientation.blueRole, /Blue pieces · you/);
    await page.click('#online-chess-board [data-square="55"]');
    await page.waitForSelector('#online-chess-board [data-square="63"].is-legal');
    await page.click('#online-chess-board [data-square="63"]');
    await page.waitForFunction(() => !document.querySelector('#online-chess-promotion').classList.contains('hidden'));
    await page.click('#online-chess-promotion [data-promotion="n"]');
    await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + (value + 1), {}, blueVersion);
    const blueResult = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches.find(row => row.room_id === backend.activeRoomId);
      const call = backend.rpcCalls.filter(item => item.name === 'ludo_chess_move').at(-1);
      return { piece: match.state.board[63], args: call.args };
    });
    assert.equal(blueResult.piece, 'n', 'the Blue Knight underpromotion is applied with lowercase Blue piece notation');
    assert.deepEqual([blueResult.args.p_from, blueResult.args.p_to, blueResult.args.p_promotion, blueResult.args.p_expected_version], [55, 63, 'n', blueVersion], 'the Blue Knight underpromotion reaches the RPC with correct board coordinates and version');

    const drawSetupVersion = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches.find(row => row.room_id === backend.activeRoomId);
      match.state = window.LudoChess.initialState();
      match.draw_offer = null;
      match.version++;
      backend.tables.room_members.forEach(member => { member.seat = member.user_id === 'user-one' ? 0 : 1; });
      const room = backend.tables.rooms.find(row => row.id === match.room_id);
      room.status = 'active';
      backend.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
      return match.version;
    });
    await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + value && !document.querySelector('#online-chess-offer-draw').classList.contains('hidden'), {}, drawSetupVersion);
    const balancesBeforeDrawActions = await page.evaluate(() => window.__mockBackend.tables.wallets.map(wallet => [wallet.user_id, wallet.coins]));

    const staleOfferVersion = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches.find(row => row.room_id === backend.activeRoomId);
      const version = match.version;
      match.version++;
      return version;
    });
    const offerButtonState = await page.evaluate(() => {
      const backend = window.__mockBackend, button = document.querySelector('#online-chess-offer-draw'), match = backend.tables.ludo_chess_matches[0];
      const rect = button.getBoundingClientRect();
      return { className: button.className, disabled: button.disabled, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, phase: match.state.phase, roomStatus: backend.tables.rooms.find(row => row.id === match.room_id).status, offer: match.draw_offer };
    });
    assert.equal(offerButtonState.className.includes('hidden'), false, 'offer control is shown for the active match: ' + JSON.stringify(offerButtonState));
    await page.click('#online-chess-offer-draw');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Match state is stale; refresh and try again'));
    await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + (value + 1), {}, staleOfferVersion);
    const staleOffer = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches.find(row => row.room_id === backend.activeRoomId);
      return { offer: match.draw_offer, args: backend.rpcCalls.filter(call => call.name === 'offer_ludo_chess_draw').at(-1).args };
    });
    assert.equal(staleOffer.offer, null, 'a stale draw offer request is rejected without creating an offer');
    assert.equal(staleOffer.args.p_expected_version, staleOfferVersion, 'the stale offer sends only the version the client actually observed');

    const versionBeforeRetryableOffer = await page.evaluate(() => {
      window.__mockBackend.dropNextDrawResponseAfterCommit = true;
      return window.__mockBackend.tables.ludo_chess_matches[0].version;
    });
    await page.click('#online-chess-offer-draw');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Retry uses the same action ID.'));
    const offerBeforeRetry = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'offer_ludo_chess_draw').at(-1).args);
    await page.click('#online-match-retry');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('The server confirmed this was already applied.'));
    const retriedOffer = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches[0];
      return { calls: backend.rpcCalls.filter(call => call.name === 'offer_ludo_chess_draw').slice(-2).map(call => call.args), version: match.version, offer: match.draw_offer };
    });
    assert.deepEqual(retriedOffer.calls[1], offerBeforeRetry, 'a lost offer response retries the identical version, action ID, and payload');
    assert.equal(retriedOffer.version, versionBeforeRetryableOffer + 1, 'an idempotent offer retry advances the match only once');
    assert.match(await page.$eval('#online-chess-draw-status', el => el.textContent), /Your draw offer is pending/i, 'the offerer sees a clear pending-offer state');
    assert.equal(retriedOffer.offer.offered_by, 0, 'the server-bound pending offer records the offerer seat, not a board move');
    await page.click('#online-chess-withdraw-draw');
    await page.waitForFunction(() => document.querySelector('#online-chess-offer-draw').classList.contains('hidden') === false && document.querySelector('#online-chess-withdraw-draw').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.__mockBackend.tables.ludo_chess_matches[0].draw_offer), null, 'withdrawing cancels only the pending offer');

    async function seedOpponentDrawOffer() {
      const version = await page.evaluate(() => {
        const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches[0];
        match.draw_offer = { offered_by: 1, position_version: match.version };
        match.version++;
        backend.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
        return match.version;
      });
      await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + value, {}, version);
      return version;
    }
    await seedOpponentDrawOffer();
    assert.match(await page.$eval('#online-chess-draw-status', el => el.textContent), /Blue .* offered a draw/i, 'the opponent offer is identified in an accessible live status');
    assert.equal(await page.$eval('#online-chess-accept-draw', el => !el.classList.contains('hidden')), true, 'only the recipient is shown the accept action');
    assert.equal(await page.$eval('#online-chess-withdraw-draw', el => !el.classList.contains('hidden')), false, 'the recipient cannot withdraw another player’s offer');
    const versionBeforeDecline = await page.evaluate(() => window.__mockBackend.tables.ludo_chess_matches[0].version);
    await page.click('#online-chess-decline-draw');
    await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + (value + 1), {}, versionBeforeDecline);
    const declined = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches[0];
      return { offer: match.draw_offer, state: match.state, history: backend.tables.match_history[0] };
    });
    assert.equal(declined.offer, null, 'declining clears the pending offer');
    assert.equal(declined.state.phase, 'active', 'declining leaves the Chess game active');
    assert.equal(declined.history.status, 'active', 'declining does not finish or rewrite match history');

    await seedOpponentDrawOffer();
    const versionBeforeMove = await page.evaluate(() => window.__mockBackend.tables.ludo_chess_matches[0].version);
    await page.click('#online-chess-board [data-square="52"]');
    await page.waitForSelector('#online-chess-board [data-square="36"].is-legal');
    await page.click('#online-chess-board [data-square="36"]');
    await page.waitForFunction(value => document.querySelector('#online-match-version').textContent === 'Version ' + (value + 1) && document.querySelector('#online-chess-accept-draw').classList.contains('hidden'), {}, versionBeforeMove);
    assert.equal(await page.evaluate(() => window.__mockBackend.tables.ludo_chess_matches[0].draw_offer), null, 'a completed move automatically clears an unanswered offer');
    assert.match(await page.$eval('#online-chess-announcement', el => el.textContent), /moved from e2 to e4/i, 'the offer-clearing move remains the announced legal game action');

    await seedOpponentDrawOffer();
    await page.click('#online-chess-accept-draw');
    await page.waitForFunction(() => document.querySelector('#online-match-turn').textContent.includes('Draw · by agreement'));
    const agreedDraw = await page.evaluate(() => {
      const backend = window.__mockBackend, match = backend.tables.ludo_chess_matches[0];
      const room = backend.tables.rooms.find(row => row.id === match.room_id);
      const history = backend.tables.match_history.find(row => row.room_id === match.room_id);
      return { state: match.state, offer: match.draw_offer, room: room.status, history };
    });
    assert.equal(agreedDraw.state.phase, 'over', 'accepting an offer ends the game');
    assert.equal(agreedDraw.state.result, 'draw_agreement', 'the authoritative game result identifies an agreed draw');
    assert.equal(agreedDraw.state.winner, null, 'an agreed draw has no winner');
    assert.equal(agreedDraw.offer, null, 'the accepted offer is cleared');
    assert.equal(agreedDraw.room, 'completed', 'acceptance completes the room');
    assert.equal(agreedDraw.history.status, 'completed', 'acceptance completes match history');
    assert.equal(agreedDraw.history.winner_id, null, 'draw history records no winner');
    assert.equal(agreedDraw.history.result.state.result, 'draw_agreement', 'history stores the same agreed-draw state');
    assert.equal(await page.$eval('#online-chess-result', el => el.textContent.includes('Draw · by agreement')), true, 'the final result is explained in the Chess screen');
    assert.deepEqual(await page.evaluate(() => window.__mockBackend.tables.wallets.map(wallet => [wallet.user_id, wallet.coins])), balancesBeforeDrawActions, 'draw offers and acceptance do not change any wallet balance');

    await page.click('#online-leave-room');
    await page.waitForFunction(() => document.querySelector('#online-room-card').classList.contains('hidden'));
    await page.select('#online-mode', 'classic');
    await page.$eval('#online-join-code', el => { el.value = ' invite-room-code '; });
    await page.click('#online-join-room');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-invite-code').value === 'INVITEROOM123456');
    assert.equal(await page.evaluate(() => window.__mockBackend.rpcCalls.findLast(call => call.name === 'join_room').args.p_invite_code), 'INVITE-ROOM-CODE', 'join-by-code normalizes invite codes before calling the RPC');

    await page.evaluate(() => { window.__mockBackend.failRpc = 'quick_match'; });
    await page.click('#online-quick-match');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Matchmaking failed: The matching service is unavailable.'));
    await page.evaluate(() => { window.__mockBackend.failRpc = null; });

    await page.click('#online-signout');
    await page.waitForFunction(() => document.querySelector('#online-account-panel').classList.contains('hidden') && !document.querySelector('#online-auth-panel').classList.contains('hidden'));
    assert.ok((await page.evaluate(() => window.__mockBackend.snapshot())).removedChannels > 0, 'sign-out removes user-scoped Realtime channels');
    await page.$eval('#online-email', el => { el.value = 'new-player@example.test'; });
    await page.$eval('#online-password', el => { el.value = 'synthetic-signup-password'; });
    await page.evaluate(() => { window.__mockBackend.failAuth = 'signUp'; });
    await page.click('#online-signup');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Account creation failed: Unable to create account'));
    await page.evaluate(() => { window.__mockBackend.failAuth = null; });
    await page.$eval('#online-password', el => { el.value = 'synthetic-signup-password'; });
    await page.click('#online-signup');
    await page.waitForFunction(() => !document.querySelector('#online-account-panel').classList.contains('hidden') && document.querySelector('#online-status').textContent.includes('Account created and signed in.'));
    assert.equal(await page.$eval('#online-password', el => el.value), '', 'password field is cleared after account creation');
    const signupCall = await page.evaluate(() => window.__mockBackend.authCalls.find(call => call.method === 'signUp'));
    assert.equal(signupCall.redirectTo, undefined, 'signup does not request a confirmation-email redirect');
    assert.equal(Object.hasOwn(signupCall, 'password'), false, 'signup mock records no password value');
    assert.equal(await page.evaluate(() => window.__mockBackend.session.user.email), 'new-player@example.test', 'mocked signup returns an immediate signed-in session');
    assert.deepEqual(sdkRequests, [], 'mocked signup sends no email, OTP, or live Auth API request');
    await page.click('#online-signout');
    await page.waitForFunction(() => document.querySelector('#online-account-panel').classList.contains('hidden') && !document.querySelector('#online-auth-panel').classList.contains('hidden'));
    await page.evaluate(() => { window.__mockBackend.failAuth = 'resetPasswordForEmail'; });
    await page.click('#online-reset-request');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Password reset could not be requested: Email service unavailable'));
    await page.evaluate(() => { window.__mockBackend.failAuth = null; });
    await page.click('#online-reset-request');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('If an account exists for that address, a reset link will be sent'));
    const resetCall = await page.evaluate(() => window.__mockBackend.authCalls.find(call => call.method === 'resetPasswordForEmail'));
    assert.equal(resetCall.redirectTo, origin + '/', 'password reset returns to the current approved page');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.session = { user: { id: 'user-one', email: 'alice@example.test' } };
      state.authListeners.forEach(callback => callback('PASSWORD_RECOVERY', state.session));
    });
    await page.waitForFunction(() => !document.querySelector('#online-recovery-panel').classList.contains('hidden'));
    await page.$eval('#online-new-password', el => { el.value = 'synthetic-recovery-password'; });
    await page.evaluate(() => { window.__mockBackend.failAuth = 'updateUser'; });
    await page.click('#online-recovery-submit');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Password could not be updated: Recovery link expired'));
    await page.evaluate(() => { window.__mockBackend.failAuth = null; });
    await page.$eval('#online-new-password', el => { el.value = 'synthetic-recovery-password'; });
    await page.click('#online-recovery-submit');
    await page.waitForFunction(() => !document.querySelector('#online-account-panel').classList.contains('hidden') && document.querySelector('#online-status').textContent.includes('Password updated. You are signed in.'));
    const updateCall = await page.evaluate(() => window.__mockBackend.authCalls.find(call => call.method === 'updateUser'));
    assert.equal(Object.hasOwn(updateCall, 'password'), false, 'recovery mock records no password value');
    await page.click('#online-signout');
    await page.waitForFunction(() => document.querySelector('#online-account-panel').classList.contains('hidden'));

    async function seedAndReload(mode, storeRoomId) {
      await page.evaluate(({ mode, storeRoomId }) => {
        const roomId = 'resume-' + mode;
        const classicState = {
          protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1],
          pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null],
          rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
          turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], turn_count: 0, last_roll: null, last_action: null
        };
        const row = { id: roomId, created_by: 'user-one', mode, capacity: 2, status: 'active', updated_at: '2026-10-04T12:00:00.000Z' };
        const fixture = {
          session: { user: { id: 'user-one', email: 'alice@example.test' } },
          tables: {
            profiles: [
              { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
              { id: 'user-two', handle: 'bob123', display_name: 'Bob' }
            ],
            wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }],
            rooms: [row],
            room_members: [
              { room_id: roomId, user_id: 'user-one', seat: 0, role: 'host', ready: true },
              { room_id: roomId, user_id: 'user-two', seat: 1, role: 'player', ready: true }
            ],
            room_invites: [{ room_id: roomId, invite_code: 'RESUMEROOM1234567' }],
            match_history: [{ id: 'history-' + roomId, room_id: roomId, mode, status: 'active', winner_id: null, started_at: '2026-10-04T12:00:00.000Z', finished_at: null }],
            match_states: mode === 'classic' ? [{ room_id: roomId, version: 7, state: classicState }] : [],
            ludo_chess_matches: mode === 'ludo_chess' ? [{ room_id: roomId, version: 4, state: window.LudoChess.initialState() }] : []
          }
        };
        sessionStorage.setItem('crossfour.online.test-fixture', JSON.stringify(fixture));
        if (storeRoomId) sessionStorage.setItem('crossfour.online.room', roomId);
        else sessionStorage.removeItem('crossfour.online.room');
      }, { mode, storeRoomId });
      await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
      await page.click('#btn-online');
      await page.waitForFunction(() => window.__mockBackend && window.__mockBackend.clientCalls.length === 1);
      await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden'));
    }

    await seedAndReload('classic', true);
    await page.waitForFunction(() => document.querySelector('#online-room-mode').textContent === 'Classic · 2 seats' && document.querySelector('#online-match-version').textContent === 'Version 7');
    assert.equal(await page.$eval('#online-room-connection', el => el.dataset.state), 'connected', 'refresh resumes the stored Classic room from authoritative version 7');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('crossfour.online.room')), 'resume-classic', 'refresh keeps the authenticated active room selected');
    const screenshotPath = path.resolve(__dirname, '../../artifacts/online-reconnect-mobile.png');
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.$eval('#online-match-panel', el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: screenshotPath });

    await page.evaluate(() => {
      const state = window.__mockBackend;
      const channel = state.channels.find(item => item.name === 'crossfour-room-resume-classic' && !item.removed);
      channel.statusCallback('CHANNEL_ERROR');
    });
    await page.waitForFunction(() => document.querySelector('#online-room-connection').dataset.state === 'reconnecting');
    assert.equal(await page.$eval('#online-roll', el => el.disabled), true, 'Classic actions pause while the realtime room is reconnecting');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const match = state.tables.match_states[0];
      match.version = 8;
      match.state = Object.assign({}, match.state, { turn: 1, turn_count: 1 });
      const channel = state.channels.find(item => item.name === 'crossfour-room-resume-classic' && !item.removed);
      channel.statusCallback('SUBSCRIBED');
    });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 8' && document.querySelector('#online-room-connection').dataset.state === 'connected');
    assert.match(await page.$eval('#online-status', el => el.textContent), /Room reconnected\. Latest server state restored\./, 'transient channel rejoin reports successful server resynchronization');

    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(await page.evaluate(() => window.__mockBackend.channels.filter(channel => channel.name === 'crossfour-room-resume-classic' && !channel.removed).length), 1, 'focus, visibility, and online events reuse one room subscription');
    assert.equal(await page.evaluate(() => window.__mockBackend.channels.find(channel => channel.name === 'crossfour-room-resume-classic' && !channel.removed).handlers.length), 4, 'recovery reuses one set of room listeners without duplication');

    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.delayNextRead = { table: 'match_states', ms: 220 };
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(() => window.__mockBackend.delayNextRead === null);
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const match = state.tables.match_states[0];
      match.version = 9;
      match.state = Object.assign({}, match.state, { turn: 0, turn_count: 2 });
      state.emit('match_states', { event: 'UPDATE', new: match });
    });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 9');
    await new Promise(resolve => setTimeout(resolve, 260));
    assert.equal(await page.$eval('#online-match-version', el => el.textContent), 'Version 9', 'a delayed stale Classic snapshot cannot downgrade a newer synchronized version');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.tables.rooms[0].status = 'completed';
      state.emit('rooms', { event: 'UPDATE', new: state.tables.rooms[0] });
    });
    await page.waitForFunction(() => document.querySelector('#online-room-connection').dataset.state === 'ended');
    assert.match(await page.$eval('#online-room-connection', el => el.textContent), /Room ended/, 'terminal room state is clearly displayed');

    await seedAndReload('ludo_chess', false);
    await page.waitForFunction(() => document.querySelector('#online-room-mode').textContent === 'Ludo Chess · 2 seats' && document.querySelector('#online-match-version').textContent === 'Version 4');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('crossfour.online.room')), 'resume-ludo_chess', 'room recovery discovers an active Chess room when no room ID was persisted');
    assert.equal(await page.$eval('#online-room-connection', el => el.dataset.state), 'connected', 'discovered Chess room synchronizes its authoritative state');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const match = state.tables.ludo_chess_matches[0];
      let position = match.state;
      position = window.LudoChess.applyMove(position, { from: 52, to: 36, promotion: null });
      position = window.LudoChess.applyMove(position, { from: 11, to: 27, promotion: null });
      position = window.LudoChess.applyMove(position, { from: 36, to: 27, promotion: null });
      match.version = 5;
      match.state = position;
      state.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
    });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 5' && document.querySelector('#online-chess-move-list').textContent.includes('exd5'));
    assert.match(await page.$eval('#online-chess-announcement', el => el.textContent), /moved from e4 to d5 and captured a piece/, 'an authoritative opponent-state update announces the captured move');
    assert.match(await page.$eval('#online-chess-move-list', el => el.textContent), /1\.\s*e4[\s\S]*d5[\s\S]*2\.\s*exd5/, 'history reconstructs numbered SAN and captures from synchronized position snapshots');
    assert.equal(await page.$eval('#online-chess-red-captured', el => el.getAttribute('aria-label')), '1 captured pieces', 'capture tray counts the exact captured piece from match history');
    await page.click('#online-chess-copy-pgn');
    await page.waitForFunction(() => document.querySelector('#online-chess-pgn-status').textContent === 'PGN copied to clipboard.');
    assert.match(await page.evaluate(() => window.__mockClipboardText), /1\. e4 d5 2\. exd5 \*/, 'PGN copy preserves fullmove numbers and capture SAN');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const match = state.tables.ludo_chess_matches[0];
      match.state.position_history = match.state.position_history.slice(1);
      match.version++;
      state.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
    });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 6' && document.querySelector('#online-chess-history-notation').textContent.includes('incomplete'));
    assert.equal(await page.$eval('#online-chess-copy-pgn', el => el.disabled), true, 'PGN export is disabled when the server history is truncated');
    assert.match(await page.$eval('#online-chess-pgn-status', el => el.textContent), /complete server move history is unavailable/i, 'the UI explains the missing complete server history');
    assert.match(await page.$eval('#online-chess-move-list', el => el.textContent), /d7–d5[\s\S]*e4×d5/, 'a partial history retains only verified coordinate moves instead of manufacturing SAN or PGN');
    const previewDir = path.resolve(__dirname, '../../artifacts/ludo-chess-play');
    fs.mkdirSync(previewDir, { recursive: true });
    await page.screenshot({ path: path.join(previewDir, 'mobile.png') });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => innerWidth >= 901 && getComputedStyle(document.querySelector('.online-chess-stage')).gridTemplateColumns.trim().split(/\s+/).length === 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the Chess screen has no horizontal overflow on desktop');
    await page.screenshot({ path: path.join(previewDir, 'desktop.png') });
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.click('#online-chess-back');
    await page.waitForFunction(() => document.querySelector('#online-chess-screen').classList.contains('hidden') && !document.querySelector('#online-chess-resume').classList.contains('hidden'));
    assert.equal(await page.$eval('#online-match-panel', el => el.parentElement.id), 'online-room-card', 'Room details returns the same live panel to the lobby without leaving the game');
    await page.click('#online-chess-resume');
    await page.waitForFunction(() => !document.querySelector('#online-chess-screen').classList.contains('hidden'));
    assert.equal(await page.$eval('#online-match-panel', el => el.parentElement.id), 'online-chess-screen', 'the same match can be resumed from the lobby');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const channel = state.channels.find(item => item.name === 'crossfour-room-resume-ludo_chess' && !item.removed);
      channel.statusCallback('CHANNEL_ERROR');
    });
    await page.waitForFunction(() => document.querySelector('#online-room-connection').dataset.state === 'reconnecting');
    assert.match(await page.$eval('#online-room-connection', el => el.textContent), /Reconnecting/);
    assert.equal(await page.$eval('#online-room-connection', el => el.getAttribute('aria-live') + ':' + el.getAttribute('aria-atomic')), 'polite:true', 'reconnection changes are exposed as complete polite live updates');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.tables.ludo_chess_matches[0].version = 6;
      const channel = state.channels.find(item => item.name === 'crossfour-room-resume-ludo_chess' && !item.removed);
      channel.statusCallback('SUBSCRIBED');
    });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 6' && document.querySelector('#online-room-connection').dataset.state === 'connected');
    assert.match(await page.$eval('#online-room-connection', el => el.textContent), /Connected/);
    assert.equal(await page.evaluate(() => window.__mockBackend.channels.filter(channel => channel.name === 'crossfour-room-resume-ludo_chess' && !channel.removed).length), 1, 'Chess reconnect rejoins the same single room channel');

    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.session = { user: { id: 'user-three', email: 'new@example.test' } };
      state.authListeners.forEach(callback => callback('SIGNED_IN', state.session));
    });
    await page.waitForFunction(() => document.querySelector('#online-room-card').classList.contains('hidden') && sessionStorage.getItem('crossfour.online.room') === null);
    assert.equal(await page.evaluate(() => window.__mockBackend.channels.filter(channel => channel.name === 'crossfour-room-resume-ludo_chess' && !channel.removed).length), 0, 'changing auth identity removes the prior account room subscription and selection');

    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.session = { user: { id: 'user-one', email: 'alice@example.test' } };
      state.authListeners.forEach(callback => callback('SIGNED_IN', state.session));
    });
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-room-mode').textContent === 'Ludo Chess · 2 seats');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.tables.rooms[0].status = 'completed';
      state.emit('rooms', { event: 'UPDATE', new: state.tables.rooms[0] });
    });
    await page.waitForFunction(() => document.querySelector('#online-room-connection').dataset.state === 'ended');
    await page.click('#online-leave-room');
    await page.waitForFunction(() => document.querySelector('#online-room-card').classList.contains('hidden') && sessionStorage.getItem('crossfour.online.room') === null);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(await page.evaluate(() => window.__mockBackend.channels.filter(channel => channel.name === 'crossfour-room-resume-ludo_chess' && !channel.removed).length), 0, 'clean leave clears the persisted room and does not reattach on focus');

    await page.click('#online-back');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    assert.equal(await page.$eval('#btn-online', el => !!el), true, 'offline game setup remains reachable after online sign-out');
    await page.click('#btn-setup-back');
    await page.waitForSelector('#home:not(.hidden)');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const discoveryPreviewDir = path.resolve(__dirname, '../../artifacts/ludo-chess-discovery-preview');
    fs.mkdirSync(discoveryPreviewDir, { recursive: true });
    await page.screenshot({ path: path.join(discoveryPreviewDir, 'mobile-home-ludo-chess.png') });
    await page.click('#btn-online-chess');
    await page.waitForFunction(() => !document.querySelector('#online').classList.contains('hidden') && document.querySelector('#online-mode').value === 'ludo_chess');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.tables.rooms = state.tables.rooms.filter(row => row.id !== 'chess-room');
      state.tables.room_members = state.tables.room_members.filter(row => row.room_id !== 'chess-room');
      state.tables.room_invites = state.tables.room_invites.filter(row => row.room_id !== 'chess-room');
      state.tables.ludo_chess_matches = state.tables.ludo_chess_matches.filter(row => row.room_id !== 'chess-room');
    });
    await page.click('#online-create-room');
    await page.waitForFunction(() => document.querySelector('#online-room-mode').textContent === 'Ludo Chess · 2 seats' && document.querySelector('#online-room-status').textContent.includes('Waiting'));
    await page.click('#online-ready');
    await page.waitForFunction(() => document.querySelector('#online-ready').textContent === 'Mark not ready');
    await page.click('#online-start-room');
    await page.waitForFunction(() => !document.querySelector('#online-chess-screen').classList.contains('hidden') && document.querySelectorAll('#online-chess-board [data-square]').length === 64);
    for (const [width, height, squareIndex] of [[320, 568, 52], [320, 844, 53], [360, 844, 54], [390, 844, 55]]) {
      await page.setViewport({ width, height, isMobile: true, hasTouch: true });
      await page.evaluate(compactHeight => {
        const screen = document.querySelector('#online-chess-screen');
        screen.scrollTop = 0;
        if (compactHeight < 700) document.querySelector('#online-chess-board').scrollIntoView({ block: 'center' });
      }, height);
      const geometry = await page.evaluate(index => {
        const screen = document.querySelector('#online-chess-screen');
        const header = document.querySelector('.online-chess-header');
        const board = document.querySelector('#online-chess-board');
        const frame = board.closest('.online-chess-board-frame');
        const square = board.querySelector('[data-square="' + index + '"]');
        const b = board.getBoundingClientRect(), f = frame.getBoundingClientRect(), s = square.getBoundingClientRect(), h = header.getBoundingClientRect();
        const hit = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
        return {
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          screenWidth: screen.getBoundingClientRect().width, board: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height },
          frameCenter: f.left + f.width / 2, square: { width: s.width, height: s.height },
          rows: [...board.children].map(row => row.children.length), headerBottom: h.bottom,
          hitSquare: !!hit && hit.closest('[data-square]') === square,
          visible: !board.closest('#online-chess-screen').classList.contains('hidden') && b.width > 0 && b.top >= h.bottom && b.bottom <= innerHeight
        };
      }, squareIndex);
      assert.equal(geometry.documentWidth <= width, true, width + 'px: Chess play screen has no horizontal overflow');
      assert.ok(geometry.board.left >= 0 && geometry.board.right <= width, width + 'px: centered board fits inside the phone viewport');
      assert.ok(Math.abs(geometry.board.width - geometry.board.height) <= 1, width + 'px: chess surface remains square');
      assert.ok(Math.abs((geometry.board.left + geometry.board.width / 2) - geometry.frameCenter) <= 2, width + 'px: 8×8 board is centered in its frame');
      assert.deepEqual(geometry.rows, Array(8).fill(8), width + 'px: rendered play surface has exactly 8 rows × 8 columns');
      assert.ok(geometry.square.width >= 24 && geometry.square.height >= 24, width + 'px: each square retains a practical touch target');
      assert.equal(geometry.hitSquare, true, width + 'px: a touch at the square center resolves to the intended board cell');
      assert.equal(geometry.visible, true, width + 'px: board is visible below the flowing header without overlay');
      await page.touchscreen.tap(geometry.board.left + geometry.board.width * ((squareIndex % 8) + .5) / 8, geometry.board.top + geometry.board.height * (Math.floor(squareIndex / 8) + .5) / 8);
      await page.waitForFunction(index => document.querySelector('#online-chess-board [data-square="' + index + '"]').getAttribute('aria-selected') === 'true', {}, squareIndex);
    }
    await page.screenshot({ path: path.join(discoveryPreviewDir, 'mobile-ludo-chess.png') });
    assert.deepEqual(errors, [], 'page has no uncaught JavaScript errors');
    console.log('Online Ludo deterministic browser test passed (mocked Auth, Classic/Chess refresh recovery and rejoin, active-room discovery, stale snapshots, auth changes, clean leave, mobile preview, and offline fallback).');
  } finally {
    await browser.close();
    if (localServer) await new Promise(resolve => localServer.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
