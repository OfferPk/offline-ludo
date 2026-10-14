'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'www');
const outputDir = path.resolve(root, '..', 'artifacts', 'offline-ludo-online-chess-resignation');
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
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return res.writeHead(403).end('Forbidden');
      fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end('Not found');
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
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://exggyvbsqhoasrqgzerf.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });" }).catch(() => {});
      } else if (/supabase-js/.test(request.url())) {
        request.abort().catch(() => {});
      } else if (url.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      const roomId = 'resign-room';
      const userId = 'red-player';
      const board = 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
      const chessState = {
        protocol: 1, mode: 'ludo_chess', board, turn: 1, phase: 'active', castling: 'KQkq', en_passant: -1,
        halfmove: 0, fullmove: 1, position_history: [board + '|1|KQkq|-1'], last_move: null, winner: null, result: null, check: false
      };
      const room = { id: roomId, created_by: 'blue-player', mode: 'ludo_chess', capacity: 2, status: 'active', updated_at: '2026-10-04T12:00:00.000Z' };
      const match = { room_id: roomId, version: 0, state: chessState, updated_at: '2026-10-04T12:00:00.000Z' };
      const history = { id: 'history-resign-room', room_id: roomId, mode: 'ludo_chess', status: 'active', winner_id: null, started_at: '2026-10-04T12:00:00.000Z', finished_at: null };
      const state = window.__mockResign = {
        calls: [], session: { user: { id: userId, email: 'red@example.test' } },
        tables: {
          profiles: [
            { id: userId, handle: 'red-player', display_name: 'Red Player' },
            { id: 'blue-player', handle: 'blue-player', display_name: 'Blue Player' }
          ],
          wallets: [{ user_id: userId, coins: 120, diamonds: 0 }],
          rooms: [room],
          room_members: [
            { room_id: roomId, user_id: userId, seat: 0, role: 'player', ready: true },
            { room_id: roomId, user_id: 'blue-player', seat: 1, role: 'host', ready: true }
          ],
          room_invites: [{ room_id: roomId, invite_code: 'RESIGN1234567890' }],
          match_history: [history], match_states: [], ludo_chess_matches: [match]
        }, channels: []
      };
      sessionStorage.setItem('crossfour.online.room', roomId);
      function builder(table) {
        const filters = [];
        let maximum = null;
        function matches(row) {
          return filters.every(filter => filter.type === 'eq'
            ? String(row[filter.key]) === String(filter.value)
            : filter.values.some(value => String(row[filter.key]) === String(value)));
        }
        function execute(single) {
          let rows = (state.tables[table] || []).filter(matches).slice();
          if (maximum != null) rows = rows.slice(0, maximum);
          return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null });
        }
        const api = {
          select() { return api; },
          eq(key, value) { filters.push({ type: 'eq', key, value }); return api; },
          in(key, values) { filters.push({ type: 'in', key, values }); return api; },
          order() { return api; },
          limit(value) { maximum = value; return api; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        return api;
      }
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
              getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
              signOut() { return Promise.resolve({ error: null }); }
            },
            from: builder,
            channel(name) {
              const channel = { name, on() { return channel; }, subscribe(callback) { state.channels.push(channel); if (callback) callback('SUBSCRIBED'); return channel; } };
              return channel;
            },
            removeChannel() {},
            rpc(name, args) {
              state.calls.push({ name, args });
              if (name !== 'resign_ludo_chess') return Promise.resolve({ data: null, error: { message: 'Unexpected RPC: ' + name } });
              const row = state.tables.ludo_chess_matches[0];
              const nextState = Object.assign({}, row.state, { phase: 'over', result: 'resignation', winner: 1 });
              row.version += 1; row.state = nextState;
              state.tables.rooms[0].status = 'completed';
              state.tables.match_history[0].status = 'completed';
              state.tables.match_history[0].winner_id = 'blue-player';
              state.tables.match_history[0].finished_at = '2026-10-04T12:01:00.000Z';
              const response = { room_id: args.p_room_id, action_id: args.p_action_id, duplicate: false, version: row.version, state: nextState };
              return Promise.resolve({ data: response, error: null });
            }
          };
        }
      };
    });

    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-chess-resign');
      return button && !button.classList.contains('hidden') && !button.disabled &&
        document.querySelectorAll('#online-chess-board [data-square]').length === 64 &&
        document.querySelector('#online-room-connection').dataset.state === 'connected';
    }, { timeout: 15000 });
    assert.match(await page.$eval('#online-chess-status', el => el.textContent), /Blue .*waiting for their move/i, 'the fixture places Blue to move while Red is the signed-in player');
    const available = await page.$eval('#online-chess-resign', button => ({ hidden: button.classList.contains('hidden'), disabled: button.disabled, text: button.textContent.trim() }));
    assert.deepEqual(available, { hidden: false, disabled: false, text: 'Resign' }, 'Red can resign while it is Blue\'s turn');

    fs.mkdirSync(outputDir, { recursive: true });
    await page.$eval('#online-match-panel', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: path.join(outputDir, 'online-chess-resignation-mobile.png'), fullPage: false });
    await page.setViewport({ width: 1440, height: 1000, isMobile: false, hasTouch: false });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-chess-resign');
      return button && !button.classList.contains('hidden') && !button.disabled &&
        document.querySelectorAll('#online-chess-board [data-square]').length === 64 &&
        document.querySelector('#online-room-connection').dataset.state === 'connected';
    }, { timeout: 15000 });
    await page.$eval('#online-match-panel', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: path.join(outputDir, 'online-chess-resignation-desktop.png'), fullPage: false });

    await page.click('#online-chess-resign');
    await page.waitForFunction(() => document.querySelector('#online-chess-result').textContent.includes('Resignation') && document.querySelector('#online-match-version').textContent === 'Version 1', { timeout: 10000 });
    assert.equal(await page.$eval('#online-chess-resign', button => button.classList.contains('hidden')), true, 'the resign control disappears after the match ends');
    const rpc = await page.evaluate(() => window.__mockResign.calls.findLast(call => call.name === 'resign_ludo_chess'));
    assert.equal(rpc.args.p_expected_version, 0, 'resignation uses the synchronized server version');
    assert.equal(await page.evaluate(() => window.__mockResign.tables.match_history[0].status), 'completed', 'the authoritative mock records the match result');
    assert.deepEqual(errors, [], 'the mobile and desktop flows have no uncaught JavaScript errors');
    console.log('Out-of-turn Ludo Chess resignation browser regression passed.');
    console.log('Mobile preview: ' + path.join(outputDir, 'online-chess-resignation-mobile.png'));
    console.log('Desktop preview: ' + path.join(outputDir, 'online-chess-resignation-desktop.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
