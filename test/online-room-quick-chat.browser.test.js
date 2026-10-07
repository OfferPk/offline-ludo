'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-room-quick-chat');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return response.writeHead(403).end('Forbidden');
      fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end('Not found');
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function installMockBackend(page, localOrigin) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/js/supabase-config.js')) {
      request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_local_quick_chat_browser_test', emailPasswordEnabled: true });" }).catch(() => {});
    } else if (/supabase-js/.test(request.url())) {
      request.abort().catch(() => {});
    } else if (url.origin === localOrigin) {
      request.continue().catch(() => {});
    } else {
      request.abort().catch(() => {});
    }
  });

  await page.evaluateOnNewDocument(() => {
    const state = window.__mockBackend = {
      session: { user: { id: 'user-host', email: 'host@example.test' } },
      authListeners: [], channels: [], rpcCalls: [], nextChatId: 1,
      tables: {
        profiles: [
          { id: 'user-host', handle: 'host123', display_name: 'Host' },
          { id: 'user-guest', handle: 'guest123', display_name: 'Guest' }
        ],
        wallets: [{ user_id: 'user-host', coins: 100, diamonds: 2 }],
        rooms: [{ id: 'room-chat-test', created_by: 'user-host', mode: 'classic', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
        room_members: [
          { room_id: 'room-chat-test', user_id: 'user-host', seat: 0, role: 'host', ready: true },
          { room_id: 'room-chat-test', user_id: 'user-guest', seat: 2, role: 'member', ready: true }
        ],
        room_invites: [],
        match_history: [],
        match_states: [{
          room_id: 'room-chat-test', version: 1, updated_at: '2026-10-07T00:00:00.000Z',
          state: {
            protocol: 1, mode: 'classic', players: [0, 2],
            pieces: [[-1, -1, -1, -1], null, [-1, -1, -1, -1], null],
            turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [],
            rules: {}, capd: [false, false, false, false], faces: [1, 1, 1, 1],
            turn_count: 0, turn_deadline: Date.now() + 45000
          }
        }],
        ludo_chess_matches: []
      }
    };

    function queryBuilder(table) {
      const filters = [];
      let maxRows = null;
      function execute(single) {
        const rows = (state.tables[table] || []).filter(row => filters.every(filter => filter.kind === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(value) === String(row[filter.field]))));
        const limited = maxRows === null ? rows : rows.slice(0, maxRows);
        const data = limited.map(row => JSON.parse(JSON.stringify(row)));
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
        name,
        handlers: [],
        on(type, filter, callback) { channel.handlers.push({ type, filter, callback }); return channel; },
        subscribe(callback) { state.channels.push(channel); if (callback) callback('SUBSCRIBED'); return channel; }
      };
      return channel;
    }

    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange(callback) { state.authListeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); },
            signOut() { state.session = null; state.authListeners.forEach(callback => callback('SIGNED_OUT', null)); return Promise.resolve({ error: null }); }
          },
          from: queryBuilder,
          channel: makeChannel,
          removeChannel(channel) { if (channel) channel.removed = true; },
          rpc(name, args) {
            if (name === 'send_room_chat') {
              state.rpcCalls.push({ name, args });
              if (state.rpcCalls.length > 1) return Promise.resolve({ data: null, error: { message: 'Please wait a moment before sending another Quick Chat message.' } });
              const row = { id: state.nextChatId++, room_id: args.p_room_id, user_id: state.session.user.id, message: args.p_message, created_at: new Date().toISOString() };
              return Promise.resolve({ data: row, error: null });
            }
            if (name === 'rejoin_match') return Promise.resolve({ data: { ok: true }, error: null });
            return Promise.resolve({ data: {}, error: null });
          }
        };
      }
    };
  });
  return errors;
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errors = await installMockBackend(page, new URL(local.url).origin);
    await page.goto(local.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-online');
    await page.waitForFunction(() => window.__cf && window.__cf.game && window.__cf.game.online && document.querySelector('#game:not(.hidden) #board'), { timeout: 30000 });

    await page.click('#btn-chat');
    await page.click('#chat-phrases [data-say="Good luck!"]');
    await page.waitForFunction(() => document.querySelector('.pod[data-seat="0"] .bubble.on')?.textContent === 'Good luck!');
    const sent = await page.evaluate(() => window.__mockBackend.rpcCalls[0]);
    assert.deepEqual(sent, { name: 'send_room_chat', args: { p_room_id: 'room-chat-test', p_message: 'Good luck!' } }, 'the current player sends a fixed phrase through the room RPC');

    const peerRow = { id: 9001, room_id: 'room-chat-test', user_id: 'user-guest', message: 'Well played!', created_at: new Date().toISOString() };
    const deliverPeerRow = async row => page.evaluate(message => {
      const channel = window.__mockBackend.channels.find(candidate => candidate.name === 'crossfour-room-room-chat-test');
      const handler = channel && channel.handlers.find(entry => entry.type === 'postgres_changes' && entry.filter.table === 'room_chat_messages');
      if (!handler) throw new Error('room chat Realtime subscription is missing');
      handler.callback({ eventType: 'INSERT', new: message });
    }, row);
    await deliverPeerRow(peerRow);
    await page.waitForFunction(() => document.querySelector('.pod[data-seat="2"] .bubble.on')?.textContent === 'Well played!');
    await deliverPeerRow(Object.assign({}, peerRow, { message: 'Oops!' }));
    await new Promise(resolve => setTimeout(resolve, 50));
    const deduped = await page.$eval('.pod[data-seat="2"] .bubble', element => element.textContent);
    assert.equal(deduped, 'Well played!', 'a Realtime echo with the same message id is rendered only once');

    await page.click('#btn-chat');
    await page.click('#chat-phrases [data-say="Oops!"]');
    await page.waitForFunction(() => document.getElementById('online-status').textContent.includes('wait a moment'));
    const callsAfterThrottle = await page.evaluate(() => window.__mockBackend.rpcCalls.length);
    assert.equal(callsAfterThrottle, 2, 'the UI attempts the fixed message and surfaces server cooldown feedback');
    assert.deepEqual(errors, [], 'the Online quick-chat browser flow has no uncaught errors');

    fs.mkdirSync(previewDir, { recursive: true });
    for (const viewport of [
      { name: 'mobile', width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      { name: 'desktop', width: 1280, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
    ]) {
      const preview = await browser.newPage();
      await preview.setViewport(viewport);
      await preview.goto(local.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await preview.waitForSelector('#home:not(.hidden)');
      await preview.evaluate(() => {
        const logic = window.__cf.logic;
        const deadline = Date.now() + 45000;
        window.__cf.presentOnline({
          state: {
            protocol: 1, mode: 'classic', players: [0, 2],
            pieces: [[-1, -1, -1, -1], null, [-1, -1, -1, -1], null],
            turn: 0, phase: 'roll', queue: [], sixes: 0, bonus: 0, ranking: [],
            rules: Object.assign({}, logic.DEFAULT_RULES), capd: [false, false, false, false],
            faces: [1, 1, 1, 1], turn_count: 0, turn_deadline: deadline
          },
          mySeat: 0,
          names: { 0: 'Host', 2: 'Guest' },
          deadline,
          onRoll: function () {}, onMove: function () {}, onExpire: function () {}
        });
        window.__cf.showOnlineChatMessage(2, 'Nice move!');
      });
      await preview.waitForSelector('#game:not(.hidden) #board');
      assert.equal(await preview.$eval('.pod[data-seat="2"] .bubble', element => element.textContent), 'Nice move!', `${viewport.name}: opponent quick-chat bubble is visible`);
      await preview.screenshot({ path: path.join(previewDir, viewport.name + '.png'), fullPage: true });
      await preview.close();
    }
    console.log('Online room Quick Chat browser checks passed. Previews:', previewDir);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
