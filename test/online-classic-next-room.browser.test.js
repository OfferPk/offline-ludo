'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(process.env.PREVIEW_DIR || path.join(__dirname, '..', 'docs', 'previews', 'online-classic-next-room'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

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

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://classic-next-room-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_classic_next_room_test', emailPasswordEnabled: true });" }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });

    await page.evaluateOnNewDocument(() => {
      const userId = 'classic-host';
      const originalRoomId = 'completed-classic-room';
      const lockedRules = {
        rollStyle: 'classic', safeSquares: false, captureToEnter: true, blocks: true,
        bonusOnCapture: false, bonusOnHome: true, arrows: true, noCapture: true
      };
      const matchState = {
        protocol: 1, mode: 'classic', players: [0, 1, 2],
        pieces: [[56, 57, 57, 57], [-1, -1, -1, -1], [-1, -1, -1, -1], null],
        turn: 0, phase: 'roll', queue: [], ranking: [], turn_count: 31,
        rules: Object.assign({}, lockedRules), capd: [false, false, false, false]
      };
      const tables = {
        profiles: [
          { id: userId, display_name: 'Amina', handle: 'amina' },
          { id: 'classic-rival-1', display_name: 'Bilal', handle: 'bilal' },
          { id: 'classic-rival-2', display_name: 'Sara', handle: 'sara' }
        ],
        wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
        rooms: [{ id: originalRoomId, created_by: userId, mode: 'classic', capacity: 3, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
        room_members: [
          { room_id: originalRoomId, user_id: userId, seat: 0, role: 'host', ready: true },
          { room_id: originalRoomId, user_id: 'classic-rival-1', seat: 1, role: 'player', ready: true },
          { room_id: originalRoomId, user_id: 'classic-rival-2', seat: 2, role: 'player', ready: true }
        ],
        room_invites: [{ room_id: originalRoomId, inviter_id: userId, invite_code: 'OLDCLASSIC123456' }],
        match_history: [{ id: 'finished-match', room_id: originalRoomId, mode: 'classic', status: 'completed', winner_id: userId, started_at: '2026-10-07T00:00:00.000Z', finished_at: '2026-10-07T00:31:00.000Z' }],
        match_states: [{ room_id: originalRoomId, version: 18, state: matchState, updated_at: '2026-10-07T00:31:00.000Z' }],
        ludo_chess_matches: []
      };
      const mock = window.__classicNextRoomTest = {
        tables, originalRoomId, userId, lockedRules, rpcCalls: [], channels: [], pendingCreate: null,
        createReplies: [
          { kind: 'error', message: 'Temporary room service failure' },
          { kind: 'pending' }
        ],
        finishGame() {
          const room = tables.rooms.find(row => row.id === originalRoomId);
          room.status = 'completed';
          const record = tables.match_states.find(row => row.room_id === originalRoomId);
          record.version += 1;
          record.state = Object.assign({}, record.state, { phase: 'over', ranking: [0, 1, 2], turn_count: 31 });
          mock.emit('rooms', { event: 'UPDATE', new: room });
          mock.emit('match_states', { event: 'UPDATE', new: record });
        },
        emit(table, event) {
          mock.channels.filter(channel => !channel.removed).forEach(channel => channel.handlers.forEach(handler => {
            const filter = handler.filter || {};
            if (filter.table !== table) return;
            if (filter.event && filter.event !== '*' && event.event && filter.event !== event.event) return;
            if (filter.filter) {
              const match = /^([a-z_]+)=eq\\.(.+)$/.exec(filter.filter);
              const row = event.new || event.old || {};
              if (match && String(row[match[1]]) !== match[2]) return;
            }
            handler.callback(event);
          }));
        },
        completeCreate() {
          const pending = mock.pendingCreate;
          if (!pending) return;
          mock.pendingCreate = null;
          const roomId = 'new-classic-room';
          tables.rooms.push({ id: roomId, created_by: userId, mode: 'classic', capacity: pending.args.p_capacity, status: 'waiting', updated_at: '2026-10-07T00:40:00.000Z' });
          tables.room_members.push({ room_id: roomId, user_id: userId, seat: 0, role: 'host', ready: true });
          tables.room_invites.push({ room_id: roomId, inviter_id: userId, invite_code: 'NEWCLASSIC123456' });
          pending.resolve({ data: { room_id: roomId, invite_code: 'NEWCLASSIC123456', status: 'waiting' }, error: null });
        }
      };
      function clone(value) { return JSON.parse(JSON.stringify(value)); }
      function queryBuilder(table) {
        const filters = [];
        let maxRows = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          let rows = (tables[table] || []).filter(matches);
          if (maxRows !== null) rows = rows.slice(0, maxRows);
          const data = rows.map(clone);
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
              getSession() { return Promise.resolve({ data: { session: { user: { id: userId, email: 'amina@example.test' } } }, error: null }); }
            },
            from: queryBuilder,
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
            rpc(name, args) {
              mock.rpcCalls.push({ name, args: clone(args) });
              if (name !== 'create_room') return Promise.resolve({ data: {}, error: null });
              const reply = mock.createReplies.shift() || { kind: 'pending' };
              if (reply.kind === 'error') return Promise.resolve({ data: null, error: { message: reply.message } });
              return new Promise(resolve => { mock.pendingCreate = { args: clone(args), resolve }; });
            }
          };
        }
      };
      sessionStorage.setItem('crossfour.online.room', originalRoomId);
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-classic-next-room');
      return button && document.querySelector('#online-room-heading').textContent.includes('Your room');
    }, { timeout: 15000 });
    assert.equal(await page.$eval('#online-classic-next-room', button => button.classList.contains('hidden')), true, 'the next-room action stays hidden while Classic is active');
    const offlineSaveBefore = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));

    await page.evaluate(() => window.__classicNextRoomTest.finishGame());
    await page.waitForFunction(() => {
      const button = document.querySelector('#online-classic-next-room');
      return button && !button.classList.contains('hidden') && !button.disabled
        && document.querySelector('#online-match-heading').textContent === 'Match complete';
    }, { timeout: 10000 });

    await fs.promises.mkdir(previewDir, { recursive: true });
    await page.addStyleTag({ content: '#game { display: none !important; } #online { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; overflow-y: auto !important; } #online-match-panel { min-height: 220px !important; overflow: visible !important; }' });
    const panel = await page.$('#online-match-panel');
    await panel.screenshot({ path: path.join(previewDir, 'mobile.png') });

    await page.$eval('#online-classic-next-room', button => { button.click(); button.click(); });
    await page.waitForFunction(() => window.__classicNextRoomTest.rpcCalls.length === 1
      && document.querySelector('#online-status').textContent.includes('Temporary room service failure')
      && !document.querySelector('#online-classic-next-room').disabled, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.__classicNextRoomTest.rpcCalls[0]), {
      name: 'create_room',
      args: { p_mode: 'classic', p_capacity: 3, p_rules: {
        rollStyle: 'classic', safeSquares: false, captureToEnter: true, blocks: true,
        bonusOnCapture: false, bonusOnHome: true, arrows: true, noCapture: true
      } }
    }, 'the first request reuses the finished match mode, seat count, and authoritative house rules');

    await page.$eval('#online-classic-next-room', button => button.click());
    await page.waitForFunction(() => window.__classicNextRoomTest.rpcCalls.length === 2
      && document.querySelector('#online-classic-next-room').disabled, { timeout: 5000 });
    const requests = await page.evaluate(() => window.__classicNextRoomTest.rpcCalls);
    assert.deepEqual(requests[1].args, { p_mode: 'classic', p_capacity: 3, p_rules: {
      rollStyle: 'classic', safeSquares: false, captureToEnter: true, blocks: true,
      bonusOnCapture: false, bonusOnHome: true, arrows: true, noCapture: true
    } }, 'the current rules signature is attempted first');

    await page.evaluate(() => window.__classicNextRoomTest.completeCreate());
    await page.waitForFunction(() => {
      const room = document.querySelector('#online-room-card');
      return room && !room.classList.contains('hidden')
        && document.querySelector('#online-invite-code').value === 'NEWCLASSIC123456'
        && document.querySelector('#online-room-status').textContent.includes('Waiting for players');
    }, { timeout: 10000 });
    assert.match(await page.$eval('#online-room-mode', node => node.textContent), /Classic · 3 seats/);
    assert.equal(await page.$eval('#online-classic-next-room', button => button.classList.contains('hidden')), true, 'the completed-match action disappears after switching to the new waiting room');
    assert.equal(await page.evaluate(() => window.__classicNextRoomTest.tables.match_history.length), 1, 'the completed match-history record remains untouched');
    assert.deepEqual(await page.evaluate(() => window.__classicNextRoomTest.tables.wallets[0]), { user_id: 'classic-host', coins: 1250, diamonds: 7 }, 'creating an invite room does not modify cloud currency');
    assert.equal(await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))), offlineSaveBefore, 'the existing offline save/preferences remain unchanged');
    assert.match(await page.$eval('#online-status', node => node.textContent), /completed result remains in match history/);

    await page.$eval('#online-back', button => button.click());
    await page.$eval('#btn-vs-ai', button => button.click());
    await page.waitForSelector('#setup:not(.hidden)', { timeout: 5000 });
    assert.deepEqual(pageErrors, [], 'the post-match room flow has no uncaught browser errors');
    console.log('Online Classic next-room browser checks passed: completion gate, duplicate-request guard, retryable failure, locked rules/seat preservation, history, currency, and offline save access.');
    console.log('Responsive previews:', previewDir);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
