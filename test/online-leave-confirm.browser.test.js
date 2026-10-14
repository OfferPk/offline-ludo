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
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
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
  const url = process.argv[2] || (localServer = await startLocalServer()).url;
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
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (/supabase-js/.test(request.url())) {
        request.abort().catch(() => {});
      } else if (requestUrl.origin === origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      const state = window.__mockBackend = {
        session: { user: { id: 'user-one', email: 'alice@example.test' } },
        rpcCalls: [], authListeners: [], channels: [],
        tables: {
          profiles: [
            { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
            { id: 'user-two', handle: 'bob123', display_name: 'Bob' }
          ],
          wallets: [{ user_id: 'user-one', coins: 0, diamonds: 0 }],
          rooms: [{ id: 'active-room', created_by: 'user-two', mode: 'classic', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
          room_members: [
            { room_id: 'active-room', user_id: 'user-one', seat: 0, role: 'player', ready: true },
            { room_id: 'active-room', user_id: 'user-two', seat: 1, role: 'host', ready: true }
          ],
          room_invites: [{ room_id: 'active-room', invite_code: 'ACTIVE1234567890' }],
          match_history: [{ id: 'history-active', room_id: 'active-room', mode: 'classic', status: 'active', winner_id: null, started_at: '2026-10-07T00:00:00.000Z', finished_at: null }],
          match_states: [{
            room_id: 'active-room', version: 0,
            state: {
              protocol: 1, mode: 'classic', roll_style: 'star', players: [0, 1],
              pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], null, null],
              rules: { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true },
              turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [], turn_count: 0,
              last_roll: null, last_action: null
            }
          }],
          ludo_chess_matches: []
        }
      };
      function queryBuilder(table) {
        let operation = 'select';
        let patch = null;
        const filters = [];
        let rowLimit = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          const rows = (state.tables[table] || []).filter(matches);
          if (operation === 'update') {
            rows.forEach(row => Object.assign(row, patch));
            return Promise.resolve({ data: null, error: null });
          }
          const limited = rowLimit === null ? rows : rows.slice(0, rowLimit);
          return Promise.resolve({ data: single ? (limited[0] || null) : limited, error: null });
        }
        const builder = {
          select() { operation = 'select'; return builder; },
          update(values) { operation = 'update'; patch = values; return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
          order() { return builder; },
          limit(value) { rowLimit = value; return builder; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        return builder;
      }
      function makeChannel(name) {
        const channel = {
          name,
          handlers: [],
          on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
          subscribe(callback) {
            state.channels.push(channel);
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
              onAuthStateChange(callback) {
                state.authListeners.push(callback);
                return { data: { subscription: { unsubscribe() {} } } };
              },
              getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
              signOut() { state.session = null; return Promise.resolve({ error: null }); }
            },
            from: queryBuilder,
            rpc(name, args) {
              state.rpcCalls.push({ name, args });
              if (name !== 'leave_room') return Promise.resolve({ data: null, error: { message: 'Unexpected RPC in focused test: ' + name } });
              const room = state.tables.rooms.find(row => row.id === args.p_room_id);
              if (room) room.status = 'cancelled';
              state.tables.room_members = state.tables.room_members.filter(row => !(row.room_id === args.p_room_id && row.user_id === 'user-one'));
              return Promise.resolve({ data: true, error: null });
            },
            channel: makeChannel,
            removeChannel(channel) {
              if (channel) channel.removed = true;
              return Promise.resolve('ok');
            }
          };
        }
      };
    });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online-room-card').classList.contains('hidden') && document.querySelector('#online-room-connection').dataset.state === 'connected');
    await page.waitForFunction(() => window.__mockBackend.channels.length >= 4);
    await page.evaluate(() => document.querySelector('#btn-home').click());
    await page.waitForSelector('#game.hidden');
    await page.click('#online-leave-room');
    await page.waitForSelector('#confirm:not(.hidden)');
    const prompt = await page.evaluate(() => ({
      title: document.querySelector('#confirm-title').textContent,
      description: document.querySelector('#confirm-text').textContent,
      stay: document.querySelector('#confirm-no').textContent,
      leave: document.querySelector('#confirm-yes').textContent,
      danger: document.querySelector('#confirm-yes').classList.contains('danger'),
      modal: document.querySelector('#confirm').getAttribute('aria-modal'),
      focus: document.activeElement.id,
      rpcCount: window.__mockBackend.rpcCalls.filter(call => call.name === 'leave_room').length
    }));
    assert.equal(prompt.title, 'Leave active match?', 'active match departure explains its consequence before any request');
    assert.match(prompt.description, /ends this match for everyone.*marks it abandoned.*not be able to resume/i, 'the prompt explains that leaving ends and abandons the match');
    assert.equal(prompt.stay, 'Stay in room', 'the safe cancellation action is explicit');
    assert.equal(prompt.leave, 'Leave match', 'the destructive action is explicitly labeled');
    assert.equal(prompt.danger, true, 'the leave action uses the danger treatment');
    assert.equal(prompt.modal, 'true', 'the existing dialog remains modal to assistive technology');
    assert.equal(prompt.focus, 'confirm-no', 'focus starts on the safe cancellation action');
    assert.equal(prompt.rpcCount, 0, 'opening the prompt makes no room-leave request');
    const previewDir = path.resolve(__dirname, '../../artifacts/online-ludo-leave-confirm-preview');
    fs.mkdirSync(previewDir, { recursive: true });
    const previewPath = path.join(previewDir, 'active-match-leave-confirm-mobile.png');
    await new Promise(resolve => setTimeout(resolve, 300));
    await page.screenshot({ path: previewPath });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'confirm-yes', 'keyboard focus advances to the leave action');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'confirm-no', 'keyboard focus wraps inside the modal');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#confirm.hidden');
    assert.equal(await page.$eval('#online-room-card', element => !element.classList.contains('hidden')), true, 'Escape keeps the player in the active room');
    assert.equal(await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'leave_room').length), 0, 'cancelling the prompt sends no leave request');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'online-leave-room', 'cancellation restores focus to the leave control');
    await page.click('#online-leave-room');
    await page.waitForSelector('#confirm:not(.hidden)');
    await page.click('#confirm-yes');
    await page.waitForSelector('#online-room-card.hidden');
    const finalState = await page.evaluate(() => ({
      leaveCalls: window.__mockBackend.rpcCalls.filter(call => call.name === 'leave_room'),
      dialogHidden: document.querySelector('#confirm').classList.contains('hidden'),
      titleRestored: document.querySelector('#confirm-title').textContent === 'Start a new match?'
    }));
    assert.equal(finalState.leaveCalls.length, 1, 'one leave RPC follows explicit confirmation');
    assert.equal(finalState.leaveCalls[0].args.p_room_id, 'active-room', 'confirmation applies only to the room the player reviewed');
    assert.equal(finalState.dialogHidden, true, 'the confirmation closes after approval');
    assert.equal(finalState.titleRestored, true, 'the shared confirmation overlay is reset for offline-game prompts');
    await page.click('#online-back');
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    assert.deepEqual(errors, [], 'the mocked Online flow has no uncaught JavaScript errors');
    assert.ok(fs.statSync(previewPath).size > 0, 'the mobile confirmation preview was captured');
    console.log('Active Online Ludo leave-confirmation browser test passed (mocked account/room; cancel, keyboard focus, explicit approval, and offline fallback).');
    console.log('Preview:', previewPath);
  } finally {
    await browser.close();
    if (localServer) await new Promise(resolve => localServer.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
