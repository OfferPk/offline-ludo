'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return res.writeHead(403).end();
      fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}
function guestState() {
  return {
    protocol: 1, mode: 'ludo_chess',
    board: 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR',
    turn: 0, phase: 'active', castling: 'KQkq', en_passant: -1, halfmove: 0, fullmove: 1,
    position_history: [], last_move: null, winner: null, result: null, check: false
  };
}
(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  try {
    async function makePage({ enabled, user, tables, storedRoomId, viewport }) {
      const page = await browser.newPage();
      await page.setViewport(viewport || { width: 390, height: 844, isMobile: true, hasTouch: true });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.endsWith('/js/supabase-config.js')) {
          request.respond({ status: 200, contentType: 'text/javascript', body: `window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_mock_for_guest_browser', emailPasswordEnabled: true, anonymousChessEnabled: ${enabled} });` }).catch(() => {});
        } else if (/supabase-js/.test(request.url())) request.abort().catch(() => {});
        else if (url.origin === new URL(local.url).origin) request.continue().catch(() => {});
        else request.abort().catch(() => {});
      });
      await page.evaluateOnNewDocument((fixture) => {
        if (fixture.storedRoomId) sessionStorage.setItem('crossfour.online.room', fixture.storedRoomId);
        const state = window.__guestOnlineMock = {
          authCalls: [], rpcCalls: [], queryCalls: [], channels: [], listeners: [],
          session: fixture.user ? { user: fixture.user, access_token: 'mock', token_type: 'bearer' } : null,
          tables: fixture.tables || { profiles: [], wallets: [], rooms: [], room_members: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: [], ludo_chess_bot_seats: [] }
        };
        function matches(row, filters) {
          return Object.keys(filters).every(key => filters[key].type === 'in' ? filters[key].value.includes(row[key]) : row[key] === filters[key].value);
        }
        function builder(table) {
          const filters = {};
          const query = {
            select() { return this; },
            eq(key, value) { filters[key] = { type: 'eq', value }; return this; },
            in(key, value) { filters[key] = { type: 'in', value }; return this; },
            order() { return this; },
            limit() { return this; },
            update() { return this; },
            maybeSingle() { return Promise.resolve({ data: (state.tables[table] || []).filter(row => matches(row, filters))[0] || null, error: null }); },
            then(resolve, reject) { return Promise.resolve({ data: (state.tables[table] || []).filter(row => matches(row, filters)), error: null }).then(resolve, reject); }
          };
          return query;
        }
        function applyMockBotMove(match, args) {
          if (Number(args.p_expected_version) !== Number(match.version)) return { error: { message: 'Match state is stale; refresh and try again', code: '40001' } };
          let next = window.LudoChess.applyMove(match.state, { from: Number(args.p_from), to: Number(args.p_to), promotion: args.p_promotion || null });
          let version = Number(match.version) + 1;
          const bot = state.tables.ludo_chess_bot_seats.find(row => row.room_id === args.p_room_id && Number(row.seat) === Number(next.turn));
          if (bot && next.phase === 'active') {
            let move = null;
            for (let from = 0; from < 64 && !move; from++) {
              if (window.LudoChess.colorOf(next.board[from]) !== Number(next.turn)) continue;
              const choices = window.LudoChess.legalMoves(next, from);
              if (choices.length) move = Object.assign({ from }, choices[0]);
            }
            if (!move) throw new Error('Mock server bot had no legal move');
            next = window.LudoChess.applyMove(next, { from: move.from, to: move.to, promotion: move.promotion || null });
            version++;
          }
          match.version = version;
          match.state = next;
          return { data: { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version, state: next } };
        }
        function rpc(name, args) {
          state.rpcCalls.push({ name, args });
          if (name === 'create_guest_ludo_chess_room') {
            const existing = state.tables.rooms.find(room => room.created_by === 'guest-user' && room.status === 'active');
            if (existing) return Promise.resolve({ data: { room_id: existing.id, status: existing.status, duplicate: true } });
            const room = { id: 'guest-room', created_by: 'guest-user', mode: 'ludo_chess', capacity: 2, status: 'active', updated_at: '2026-10-05T00:00:00.000Z' };
            const match = { room_id: room.id, version: 0, state: window.LudoChess.initialState(), draw_offer: null };
            state.tables.rooms = [room];
            state.tables.room_members = [{ room_id: room.id, user_id: 'guest-user', seat: 0, role: 'host', ready: true }];
            state.tables.ludo_chess_bot_seats = [{ room_id: room.id, seat: 1, bot_kind: 'random_legal' }];
            state.tables.ludo_chess_matches = [match];
            state.tables.match_history = [{ id: 'history-guest-room', room_id: room.id, mode: 'ludo_chess', status: 'active', started_at: '2026-10-05T00:00:00.000Z' }];
            return Promise.resolve({ data: { room_id: room.id, status: 'active', version: 0, state: match.state } });
          }
          if (name === 'ludo_chess_move') {
            const match = state.tables.ludo_chess_matches.find(row => row.room_id === args.p_room_id);
            try { return Promise.resolve(applyMockBotMove(match, args)); }
            catch (error) { return Promise.resolve({ error: { message: error.message, code: '22023' } }); }
          }
          if (name === 'find_ludo_chess_bot_room') {
            const bot = state.tables.ludo_chess_bot_seats[0];
            const match = bot && state.tables.ludo_chess_matches.find(row => row.room_id === bot.room_id);
            return Promise.resolve({ data: bot && match ? { room_id: bot.room_id, version: match.version } : { room_id: null, version: null } });
          }
          if (name === 'takeover_ludo_chess_bot_room') {
            const botIndex = state.tables.ludo_chess_bot_seats.findIndex(row => row.room_id === args.p_room_id);
            if (botIndex < 0) return Promise.resolve({ error: { message: 'The computer seat has already been taken', code: '55000' } });
            const match = state.tables.ludo_chess_matches.find(row => row.room_id === args.p_room_id);
            if (Number(args.p_expected_version) !== Number(match.version)) return Promise.resolve({ error: { message: 'Match state is stale; refresh and try again', code: '40001' } });
            const bot = state.tables.ludo_chess_bot_seats.splice(botIndex, 1)[0];
            state.tables.room_members.push({ room_id: args.p_room_id, user_id: state.session.user.id, seat: Number(bot.seat), role: 'player', ready: true });
            match.version++;
            return Promise.resolve({ data: { room_id: args.p_room_id, seat: Number(bot.seat), version: match.version, state: match.state } });
          }
          if (name === 'leave_room') return Promise.resolve({ data: true });
          return Promise.resolve({ data: {} });
        }
        const client = {
          auth: {
            onAuthStateChange(callback) { state.listeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
            signInAnonymously() {
              state.authCalls.push('signInAnonymously');
              const user = { id: 'guest-user', is_anonymous: true };
              state.session = { user, access_token: 'mock-guest', token_type: 'bearer' };
              state.listeners.forEach(callback => callback('SIGNED_IN', state.session));
              return Promise.resolve({ data: { user, session: state.session }, error: null });
            },
            signOut() {
              state.authCalls.push('signOut'); state.session = null;
              state.listeners.forEach(callback => callback('SIGNED_OUT', null));
              return Promise.resolve({ data: {}, error: null });
            },
            signInWithPassword() { return Promise.resolve({ data: { session: null }, error: null }); },
            signUp() { return Promise.resolve({ data: { session: null }, error: null }); },
            resetPasswordForEmail() { return Promise.resolve({ data: {}, error: null }); }
          },
          from(table) { state.queryCalls.push(table); return builder(table); },
          rpc,
          channel(name) {
            const channel = { name, on() { return this; }, subscribe(callback) { state.channels.push(this); if (callback) setTimeout(() => callback('SUBSCRIBED'), 0); return this; } };
            return channel;
          },
          removeChannel() { return Promise.resolve('ok'); }
        };
        window.supabase = { createClient() { return client; } };
      }, { user, tables, storedRoomId });
      await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector('#home:not(.hidden)');
      return page;
    }

    const disabledPage = await makePage({ enabled: false });
    await disabledPage.click('#btn-guest-chess');
    await disabledPage.click('#guest-chess-online');
    assert.equal(await disabledPage.$eval('#online-guest-online-option', el => el.classList.contains('hidden')), true, 'the online guest option is hidden when the default gate is false');
    assert.deepEqual(await disabledPage.evaluate(() => window.__guestOnlineMock.authCalls), [], 'the disabled route never starts anonymous sign-in');
    await disabledPage.close();

    const guestPage = await makePage({ enabled: true });
    await guestPage.click('#btn-guest-chess');
    await guestPage.click('#guest-chess-online');
    await guestPage.waitForFunction(() => !document.querySelector('#online-guest-online-option').classList.contains('hidden'));
    await guestPage.click('#online-play-online-guest');
    await guestPage.waitForFunction(() => window.__guestOnlineMock.rpcCalls.some(call => call.name === 'create_guest_ludo_chess_room'), { timeout: 8000 }).catch(async error => {
      console.error('Guest-start diagnostics:', await guestPage.evaluate(() => ({ status: document.querySelector('#online-status').textContent, authCalls: window.__guestOnlineMock.authCalls, rpcCalls: window.__guestOnlineMock.rpcCalls, currentUser: window.__guestOnlineMock.session && window.__guestOnlineMock.session.user })), errors);
      throw error;
    });
    await guestPage.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden'), { timeout: 8000 }).catch(async error => {
      console.error('Guest-room diagnostics:', await guestPage.evaluate(() => ({ status: document.querySelector('#online-status').textContent, rpcCalls: window.__guestOnlineMock.rpcCalls, queryCalls: window.__guestOnlineMock.queryCalls, roomText: document.querySelector('#online-room-status').textContent, connection: document.querySelector('#online-room-connection').textContent })), errors);
      throw error;
    });
    assert.deepEqual(await guestPage.evaluate(() => window.__guestOnlineMock.authCalls.filter(call => call === 'signInAnonymously')), ['signInAnonymously'], 'the opt-in flow creates an anonymous Auth session');
    assert.equal(await guestPage.$eval('#online-account-panel', el => el.classList.contains('hidden')), true, 'anonymous users never see the account/profile/wallet panel');
    assert.match(await guestPage.$eval('#online-room-roster', el => el.textContent), /Computer.*open to a human/i, 'the computer is shown as a virtual open seat');
    assert.equal(await guestPage.$eval('#online-guest-room-controls', el => el.classList.contains('hidden')), false, 'the anonymous guest receives guest-only room controls');
    assert.deepEqual(await guestPage.evaluate(() => window.__guestOnlineMock.queryCalls.filter(table => ['profiles', 'wallets', 'currency_ledger'].includes(table))), [], 'anonymous browser flow makes no profile, wallet, or ledger queries');
    if (process.env.GUEST_PREVIEW_DIR) {
      fs.mkdirSync(process.env.GUEST_PREVIEW_DIR, { recursive: true });
      await guestPage.screenshot({ path: path.join(process.env.GUEST_PREVIEW_DIR, 'guest-online-mobile.png'), fullPage: true });
    }

    let desktopPage;
    if (process.env.GUEST_PREVIEW_DIR) {
      const desktopTables = await guestPage.evaluate(() => JSON.parse(JSON.stringify(window.__guestOnlineMock.tables)));
      desktopPage = await makePage({ enabled: true, user: { id: 'guest-user', is_anonymous: true }, tables: desktopTables, storedRoomId: 'guest-room', viewport: { width: 1440, height: 960, isMobile: false, hasTouch: false } });
      await desktopPage.click('#btn-online');
      await desktopPage.waitForFunction(() => !document.querySelector('#online-chess-screen').classList.contains('hidden'));
      assert.equal(await desktopPage.$eval('#online', el => !el.classList.contains('hidden')), true, 'desktop reconnect opens the active online Chess room');
      await desktopPage.screenshot({ path: path.join(process.env.GUEST_PREVIEW_DIR, 'guest-online-desktop.png'), fullPage: true });
      await desktopPage.close();
      desktopPage = null;
    }

    await guestPage.click('#online-chess-board [data-square="52"]');
    await guestPage.click('#online-chess-board [data-square="36"]');
    await guestPage.waitForFunction(() => {
      const match = window.__guestOnlineMock.tables.ludo_chess_matches[0];
      return match && Number(match.version) === 2 && Number(match.state.turn) === 0;
    });
    const guestMoveCalls = await guestPage.evaluate(() => window.__guestOnlineMock.rpcCalls.filter(call => call.name === 'ludo_chess_move').length);
    assert.equal(guestMoveCalls, 1, 'one guest move RPC contains the server-generated reply; the client never submits a bot action');
    assert.equal(await guestPage.evaluate(() => window.__guestOnlineMock.tables.ludo_chess_bot_seats.length), 1, 'the server computer seat remains after its reply');

    const takeoverTables = await guestPage.evaluate(() => JSON.parse(JSON.stringify(window.__guestOnlineMock.tables)));
    const reconnectPage = await makePage({ enabled: true, user: { id: 'guest-user', is_anonymous: true }, tables: takeoverTables, storedRoomId: 'guest-room' });
    await reconnectPage.click('#btn-online');
    await reconnectPage.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden'));
    assert.match(await reconnectPage.$eval('#online-room-roster', el => el.textContent), /Computer.*open to a human/i, 'reconnect restores the server computer seat from the authoritative room state');
    assert.deepEqual(await reconnectPage.evaluate(() => window.__guestOnlineMock.queryCalls.filter(table => ['profiles', 'wallets', 'currency_ledger'].includes(table))), [], 'reconnected anonymous sessions still make no account-data queries');

    takeoverTables.profiles = [{ id: 'human-user', handle: 'human123', display_name: 'Human' }];
    takeoverTables.wallets = [{ user_id: 'human-user', coins: 0, diamonds: 0 }];
    const humanPage = await makePage({ enabled: true, user: { id: 'human-user', is_anonymous: false, email: 'human@example.invalid' }, tables: takeoverTables });
    await humanPage.click('#btn-online');
    await humanPage.waitForSelector('#online:not(.hidden)');
    await humanPage.select('#online-mode', 'ludo_chess');
    await humanPage.waitForFunction(() => !document.querySelector('#online-guest-takeover-control').classList.contains('hidden'));
    await humanPage.click('#online-join-guest-chess');
    await humanPage.waitForFunction(() => window.__guestOnlineMock.rpcCalls.some(call => call.name === 'takeover_ludo_chess_bot_room'));
    await humanPage.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden'));
    assert.equal(await humanPage.$eval('#online', el => !el.classList.contains('hidden')), true, 'the online route remains visible after takeover');
    assert.equal(await humanPage.$eval('#online-chess-screen', el => !el.classList.contains('hidden')), true, 'a Chess takeover opens the playable room screen');
    assert.equal(await humanPage.evaluate(() => window.__guestOnlineMock.tables.ludo_chess_bot_seats.length), 0, 'successful takeover atomically removes the server bot marker');
    assert.equal(await humanPage.evaluate(() => window.__guestOnlineMock.tables.room_members.length), 2, 'the joining human becomes a real room member in the former bot seat');
    assert.equal(await humanPage.evaluate(() => window.__guestOnlineMock.tables.ludo_chess_matches[0].version), 3, 'takeover versions the unchanged committed board state');
    assert.match(await humanPage.$eval('#online-room-roster', el => el.textContent), /Human/, 'the human opponent appears in the refreshed roster');
    const anonymousTakeoverTables = JSON.parse(JSON.stringify(takeoverTables));
    anonymousTakeoverTables.rooms[0].id = 'guest-room-anonymous-claim';
    anonymousTakeoverTables.room_members.forEach(member => { member.room_id = 'guest-room-anonymous-claim'; });
    anonymousTakeoverTables.ludo_chess_matches.forEach(match => { match.room_id = 'guest-room-anonymous-claim'; });
    anonymousTakeoverTables.ludo_chess_bot_seats.forEach(seat => { seat.room_id = 'guest-room-anonymous-claim'; });
    const anonymousPage = await makePage({ enabled: true, user: { id: 'anonymous-joiner', is_anonymous: true }, tables: anonymousTakeoverTables });
    await anonymousPage.click('#btn-online');
    await anonymousPage.waitForSelector('#online:not(.hidden)');
    await anonymousPage.select('#online-mode', 'ludo_chess');
    await anonymousPage.waitForFunction(() => !document.querySelector('#online-guest-takeover-control').classList.contains('hidden'));
    await anonymousPage.click('#online-join-guest-chess');
    await anonymousPage.waitForFunction(() => window.__guestOnlineMock.rpcCalls.some(call => call.name === 'takeover_ludo_chess_bot_room'));
    await anonymousPage.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden'));
    assert.equal(await anonymousPage.evaluate(() => window.__guestOnlineMock.tables.room_members.length), 2, 'a second anonymous Auth identity can take the human seat');
    assert.deepEqual(await anonymousPage.evaluate(() => window.__guestOnlineMock.queryCalls.filter(table => ['profiles', 'wallets', 'currency_ledger'].includes(table))), [], 'anonymous takeover does not read profile, wallet, or ledger data');

    assert.deepEqual(errors, [], 'no browser runtime errors occurred in the guest or takeover flows');
    console.log('Guest online browser checks passed: feature gate, anonymous isolation, server reply, and human takeover.');
    await guestPage.close();
    await reconnectPage.close();
    await humanPage.close();
    await anonymousPage.close();
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
