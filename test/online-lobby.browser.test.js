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
  let sharedInviteUrl = '';
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
      let resumeFixture = null;
      try { resumeFixture = JSON.parse(sessionStorage.getItem('crossfour.online.test-fixture') || 'null'); } catch (_) {}
      const state = window.__mockBackend = {
        clientCalls: [], authCalls: [], rpcCalls: [], channels: [], authListeners: [],
        removedChannels: 0, activeRoomId: null, failRpc: null, failAuth: null, joinResult: null, session: resumeFixture && resumeFixture.session || null,
        delayNextRead: null,
        actionResponses: {}, rollCount: 0,
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
          state.tables.room_invites.push({ room_id: id, invite_code: id === 'quick-room' ? 'Q7K2M9' : id === 'host-room' ? 'A7K2P9' : 'B6C4D8' });
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
                if (roomId !== 'host-room') ensureMember(roomId, 'user-two', 1, 'member', true);
                state.activeRoomId = roomId;
                data = { room_id: roomId, status: 'waiting' };
              } else if (name === 'join_room') {
                if (state.joinResult) {
                  data = state.joinResult;
                  state.joinResult = null;
                } else {
                  ensureRoom('invite-room', 'user-two', 'classic', 2);
                  ensureMember('invite-room', 'user-two', 0, 'host', true);
                  ensureMember('invite-room', 'user-one', 1, 'member', false);
                  state.activeRoomId = 'invite-room';
                  data = { room_id: 'invite-room', status: 'waiting' };
                }
              } else if (name === 'set_room_ready') {
                const member = state.tables.room_members.find(row => row.room_id === args.p_room_id && row.user_id === 'user-one');
                if (member) member.ready = args.p_ready;
                data = { ready: args.p_ready };
              } else if (name === 'start_room') {
                const room = state.tables.rooms.find(row => row.id === args.p_room_id);
                if (room) room.status = 'active';
                if (!state.tables.match_history.some(row => row.room_id === args.p_room_id)) {
                  state.tables.match_history.push({ id: 'history-' + args.p_room_id, room_id: args.p_room_id, mode: room ? room.mode : 'classic', status: 'started', winner_id: null, started_at: '2026-10-03T12:30:00.000Z', finished_at: null });
                }
                if (room && room.mode === 'ludo_chess') {
                  const match = { room_id: args.p_room_id, version: 0, state: window.LudoChess.initialState() };
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
                const nextState = window.LudoChess.applyMove(match.state, { from: args.p_from, to: args.p_to, promotion: args.p_promotion });
                match.version++;
                match.state = nextState;
                data = { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version: match.version, state: nextState };
                state.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
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
    await page.click('#btn-online');
    await page.waitForSelector('#online:not(.hidden)');
    await page.waitForFunction(() => window.__mockBackend.clientCalls.length === 1);
    assert.match(await page.$eval('#online-auth-panel', el => el.textContent), /sign in immediately; no confirmation link is required/i);
    assert.equal(await page.$eval('#online-email', el => el.value), '', 'email is not prefilled or hardcoded in the portal');
    assert.equal(await page.$eval('#online-signin', el => el.disabled), false, 'verified email/password auth enables sign-in');
    assert.equal(await page.$eval('#online-signup', el => el.disabled), false, 'enabled project signup enables account creation');
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
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-invite-code').value === 'A7K2P9');
    assert.match(await page.$eval('#online-invite-code', el => el.value), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/, 'newly created rooms display exactly six ambiguity-free invite characters');
    assert.deepEqual(await page.$eval('#online-join-code', el => [el.maxLength, el.placeholder]), [6, '6-character code'], 'manual join input advertises and enforces the six-character format');
    assert.equal(await page.$eval('#online-invite-feedback', el => el.getAttribute('role') === 'status' && el.getAttribute('aria-live') === 'polite'), true, 'invite feedback is announced accessibly');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'invite controls fit the mobile viewport without horizontal scrolling');
    await page.setViewport({ width: 320, height: 740, isMobile: true, hasTouch: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'invite actions also fit a narrow 320-pixel handset');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluate(() => {
      window.__inviteShareCalls = [];
      window.__inviteClipboardCalls = [];
      window.__resolveInviteShare = null;
      Object.defineProperty(navigator, 'share', { configurable: true, value(data) { window.__inviteShareCalls.push(data); return new Promise(resolve => { window.__resolveInviteShare = resolve; }); } });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText(text) { window.__inviteClipboardCalls.push(text); return Promise.resolve(); } } });
    });
    await page.click('#online-share-invite');
    await page.waitForFunction(() => document.querySelector('#online-share-invite').disabled);
    assert.equal(await page.evaluate(() => document.querySelector('#online-share-invite').getAttribute('aria-busy') === 'true' && document.querySelector('#online-copy-invite').disabled), true, 'invite actions expose an accessible busy state during native sharing');
    await page.evaluate(() => window.__resolveInviteShare());
    await page.waitForFunction(() => document.querySelector('#online-invite-feedback').textContent.includes('Invite shared.'));
    const shareCall = await page.evaluate(() => window.__inviteShareCalls[0]);
    sharedInviteUrl = shareCall.url;
    assert.equal(shareCall.title, 'Join my Online Ludo table', 'native share uses a clear invite title');
    assert.equal(sharedInviteUrl, origin + '/?room=A7K2P9', 'shared link continues to carry the six-character room invite code');
    await page.click('#online-copy-invite');
    await page.waitForFunction(() => document.querySelector('#online-invite-feedback').textContent.includes('Invite link copied.'));
    assert.deepEqual(await page.evaluate(() => window.__inviteClipboardCalls), [sharedInviteUrl], 'copy action writes the same direct room link');
    const inviteScreenshotPath = path.resolve(__dirname, '../../artifacts/online-room-invite-mobile.png');
    fs.mkdirSync(path.dirname(inviteScreenshotPath), { recursive: true });
    await page.$eval('#online-room-card', el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: inviteScreenshotPath });
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const member = { room_id: 'host-room', user_id: 'user-two', seat: 1, role: 'member', ready: true };
      state.tables.room_members.push(member);
      state.emit('room_members', { event: 'INSERT', new: member });
    });
    await page.waitForFunction(() => document.querySelector('#online-room-roster').textContent.includes('Bob'));
    const clipboardCallsBeforeCancel = await page.evaluate(() => window.__inviteClipboardCalls.length);
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value() { return Promise.reject(Object.assign(new Error('Share dismissed'), { name: 'AbortError' })); } }));
    await page.click('#online-share-invite');
    await page.waitForFunction(() => document.querySelector('#online-invite-feedback').textContent.includes('Share cancelled.'));
    assert.equal(await page.evaluate(() => window.__inviteClipboardCalls.length), clipboardCallsBeforeCancel, 'cancelling the native share sheet does not unexpectedly copy the link');
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
    await page.click('#online-share-invite');
    await page.waitForFunction(() => document.querySelector('#online-invite-feedback').textContent.includes('Invite link copied.'));
    assert.equal(await page.evaluate(() => window.__inviteClipboardCalls.at(-1)), sharedInviteUrl, 'unsupported native sharing falls back to clipboard copy');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText() { return Promise.reject(new Error('Clipboard denied')); } } });
      Object.defineProperty(document, 'execCommand', { configurable: true, value() { return false; } });
    });
    await page.click('#online-copy-invite');
    await page.waitForFunction(() => document.querySelector('#online-invite-feedback').textContent.includes('The invite code is selected'));
    assert.equal(await page.$eval('#online-invite-code', el => document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length), true, 'failed clipboard access selects the room code for manual copying');
    await page.click('#online-ready');
    await page.waitForFunction(() => document.querySelector('#online-ready').textContent === 'Mark not ready');
    await page.click('#online-start-room');
      await page.waitForFunction(() => document.querySelector('#online-room-status').textContent.includes('validated by the server'));
      await page.waitForFunction(() => document.querySelector('#online-history-list').textContent.includes('Classic · started'));
      await page.waitForFunction(() => !document.querySelector('#online-match-panel').classList.contains('hidden') && document.querySelector('#online-match-version').textContent === 'Version 0');
      await page.evaluate(() => { window.__mockBackend.failRpc = 'roll_match'; });
      await page.click('#online-roll');
      await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Retry uses the same action ID.'));
      const firstRollId = await page.evaluate(() => window.__mockBackend.rpcCalls.findLast(call => call.name === 'roll_match').args.p_action_id);
      await page.evaluate(() => { window.__mockBackend.failRpc = null; });
      await page.click('#online-match-retry');
      await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 1' && document.querySelector('#online-match-dice').textContent.includes('rolled 6'));
      await page.click('#online-roll');
      await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 2' && document.querySelector('#online-match-turn').textContent.includes('choose a legal token move'));
      await page.waitForSelector('#online-match-moves button');
      assert.match(await page.$eval('#online-match-moves button', el => el.textContent), /Use 6 to move token 1/, 'local rules engine supplies legal move choices for server dice');
      await page.click('#online-match-moves button');
      await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 3' && document.querySelector('#online-match-pieces').textContent.includes('T1 track 0'));
      const matchCalls = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => ['roll_match', 'move_match'].includes(call.name)));
      assert.equal(matchCalls[0].args.p_action_id, firstRollId, 'retry sends the same idempotency key after a dropped action');
      assert.equal(Object.hasOwn(matchCalls[0].args, 'p_die'), false, 'client cannot pass a dice face into the server roll RPC');
      assert.equal(Object.hasOwn(matchCalls[2].args, 'p_die'), false, 'move RPC receives only a server queue index, not a forged die face');
      await page.waitForFunction(() => document.querySelector('#online-match-turn').textContent.includes('Bobby Live · waiting for their turn'));
      assert.ok((await page.evaluate(() => window.__mockBackend.snapshot())).channels.some(channel => channel.tables.includes('match_states')), 'live match-state changes are subscribed and re-read after reconnect');
      await page.evaluate(() => window.__mockBackend.emit('match_history', { event: 'INSERT', new: { id: 'history-one', user_id: 'user-one' } }));

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
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-invite-code').value === 'B6C4D8');
    await page.waitForFunction(() => document.querySelector('#online-room-mode').textContent === 'Ludo Chess · 2 seats');
    await page.click('#online-ready');
    await page.waitForFunction(() => document.querySelector('#online-ready').textContent === 'Mark not ready');
    await page.click('#online-start-room');
    await page.waitForFunction(() => !document.querySelector('#online-chess-play').classList.contains('hidden') && document.querySelectorAll('#online-chess-board [data-square]').length === 64);
    assert.equal(await page.$eval('#online-chess-board [data-square="52"] .online-chess-piece', el => el.classList.contains('red-piece')), true, 'seat zero is rendered as Red Ludo-colored pieces');
    await page.click('#online-chess-board [data-square="52"]');
    await page.waitForSelector('#online-chess-board [data-square="36"].is-legal');
    await page.click('#online-chess-board [data-square="36"]');
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 1' && document.querySelector('#online-match-turn').textContent.includes('Blue · Bobby Live'));
    const chessCall = await page.evaluate(() => window.__mockBackend.rpcCalls.findLast(call => call.name === 'ludo_chess_move'));
    assert.equal(chessCall.args.p_from, 52, 'Chess RPC receives the selected source square');
    assert.equal(chessCall.args.p_to, 36, 'Chess RPC receives a locally legal destination square');
    assert.equal(chessCall.args.p_expected_version, 0, 'Chess action uses the observed authoritative state version');
    assert.equal(Object.hasOwn(chessCall.args, 'p_die'), false, 'Chess RPC does not accept any client-generated dice value');
    assert.ok((await page.evaluate(() => window.__mockBackend.snapshot())).channels.some(channel => channel.tables.includes('ludo_chess_matches')), 'Chess state is subscribed through Realtime');

    await page.click('#online-leave-room');
    await page.waitForFunction(() => document.querySelector('#online-room-card').classList.contains('hidden'));
    await page.select('#online-mode', 'classic');
    await page.evaluate(() => { window.__mockBackend.joinResult = { error: 'invite_unavailable' }; });
    await page.$eval('#online-join-code', el => { el.value = 'A0A0A0'; });
    await page.click('#online-join-room');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('That invite is invalid, expired, or unavailable.'));
    assert.match(await page.$eval('#online-status', el => el.textContent), /That invite is invalid, expired, or unavailable/, 'join failures use the same non-enumerating user message');
    await page.evaluate(() => { window.__mockBackend.joinResult = { error: 'join_rate_limited' }; });
    await page.$eval('#online-join-code', el => { el.value = ' a7k2p9 '; });
    await page.click('#online-join-room');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Too many join attempts.'));
    assert.match(await page.$eval('#online-status', el => el.textContent), /wait a few minutes/, 'rate-limited joins receive retry guidance');
    await page.$eval('#online-join-code', el => { el.value = ' a7k2p9 '; });
    await page.click('#online-join-room');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-invite-code').value === 'B6C4D8');
    assert.equal(await page.evaluate(() => window.__mockBackend.rpcCalls.findLast(call => call.name === 'join_room').args.p_invite_code), 'A7K2P9', 'valid six-character invite is normalized before the authenticated join RPC');

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

    await page.evaluate(() => {
      sessionStorage.setItem('crossfour.online.test-fixture', JSON.stringify({
        session: null,
        tables: {
          profiles: [{ id: 'user-one', handle: 'alice123', display_name: 'Alice' }, { id: 'user-two', handle: 'bob123', display_name: 'Bob' }],
          wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }], rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
        }
      }));
      sessionStorage.removeItem('crossfour.online.room');
      sessionStorage.removeItem('crossfour.online.pending-invite');
    });
    await page.goto(sharedInviteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => window.__mockBackend.clientCalls.length === 1 && !document.querySelector('#online-auth-panel').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => sessionStorage.getItem('crossfour.online.pending-invite')), 'A7K2P9', 'six-character guest invite link is retained while the visitor signs in');
    assert.equal(await page.evaluate(() => window.__mockBackend.rpcCalls.some(call => call.name === 'join_room')), false, 'opening a guest invite does not bypass account and room authorization');
    await page.$eval('#online-email', el => { el.value = 'guest@example.test'; });
    await page.$eval('#online-password', el => { el.value = 'synthetic-guest-password'; });
    await page.click('#online-signin');
    await page.waitForFunction(() => window.__mockBackend.rpcCalls.some(call => call.name === 'join_room' && call.args.p_invite_code === 'A7K2P9') && !document.querySelector('#online-room-card').classList.contains('hidden'));
    assert.equal(await page.$eval('#online-invite-code', el => el.value), 'B6C4D8', 'authenticated guest lands in the joined room through the existing validated six-character join flow');

    await page.evaluate(() => {
      sessionStorage.setItem('crossfour.online.test-fixture', JSON.stringify({
        session: null,
        tables: {
          profiles: [{ id: 'user-one', handle: 'alice123', display_name: 'Alice' }, { id: 'user-two', handle: 'bob123', display_name: 'Bob' }],
          wallets: [{ user_id: 'user-one', coins: 1250, diamonds: 7 }], rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
        }
      }));
      sessionStorage.removeItem('crossfour.online.room');
      sessionStorage.removeItem('crossfour.online.pending-invite');
    });
    const legacyInviteUrl = origin + '/?room=ABCDEF0123456789';
    await page.goto(legacyInviteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => window.__mockBackend.clientCalls.length === 1 && !document.querySelector('#online-auth-panel').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => sessionStorage.getItem('crossfour.online.pending-invite')), 'ABCDEF0123456789', 'a previously shared URL code is retained while its visitor signs in');
    assert.equal(await page.evaluate(() => window.__mockBackend.rpcCalls.some(call => call.name === 'join_room')), false, 'legacy URL invites do not bypass authentication');
    await page.$eval('#online-email', el => { el.value = 'legacy-guest@example.test'; });
    await page.$eval('#online-password', el => { el.value = 'synthetic-legacy-password'; });
    await page.click('#online-signin');
    await page.waitForFunction(() => window.__mockBackend.rpcCalls.some(call => call.name === 'join_room' && call.args.p_invite_code === 'ABCDEF0123456789') && !document.querySelector('#online-room-card').classList.contains('hidden'));

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
            room_invites: [{ room_id: roomId, invite_code: 'C2D8F4' }],
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
    assert.equal(await page.evaluate(() => sessionStorage.getItem('crossfour.online.room')), 'resume-ludo_chess', 'room recovery discovers an active Chess match when no room ID was persisted');
    assert.equal(await page.$eval('#online-room-connection', el => el.dataset.state), 'connected', 'discovered Chess room synchronizes its authoritative state');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      const channel = state.channels.find(item => item.name === 'crossfour-room-resume-ludo_chess' && !item.removed);
      channel.statusCallback('CHANNEL_ERROR');
    });
    await page.waitForFunction(() => document.querySelector('#online-room-connection').dataset.state === 'reconnecting');
    await page.evaluate(() => {
      const state = window.__mockBackend;
      state.tables.ludo_chess_matches[0].version = 5;
      const channel = state.channels.find(item => item.name === 'crossfour-room-resume-ludo_chess' && !item.removed);
      channel.statusCallback('SUBSCRIBED');
    });
    await page.waitForFunction(() => document.querySelector('#online-match-version').textContent === 'Version 5' && document.querySelector('#online-room-connection').dataset.state === 'connected');
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
    assert.deepEqual(errors, [], 'page has no uncaught JavaScript errors');
    console.log('Online Ludo deterministic browser test passed (mocked Auth, Classic/Chess refresh recovery and rejoin, active-room discovery, stale snapshots, auth changes, clean leave, mobile preview, and offline fallback).');
  } finally {
    await browser.close();
    if (localServer) await new Promise(resolve => localServer.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
