'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

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
        request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://history-refresh-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_history_refresh_test', emailPasswordEnabled: true });" }).catch(() => {});
      } else if (requestUrl.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });

    await page.evaluateOnNewDocument(() => {
      const userId = 'history-host';
      const roomId = 'active-classic-history-room';
      const initialState = {
        protocol: 1, mode: 'classic', players: [0, 1, 2],
        pieces: [[56, 57, 57, 57], [-1, -1, -1, -1], [-1, -1, -1, -1], null],
        turn: 0, phase: 'roll', queue: [], ranking: [], turn_count: 31,
        rules: { rollStyle: 'classic', safeSquares: false, captureToEnter: true, blocks: true, bonusOnCapture: false, bonusOnHome: true, arrows: true, noCapture: true },
        capd: [false, false, false, false]
      };
      const tables = {
        profiles: [
          { id: userId, display_name: 'Amina', handle: 'amina' },
          { id: 'history-rival-1', display_name: 'Bilal', handle: 'bilal' },
          { id: 'history-rival-2', display_name: 'Sara', handle: 'sara' }
        ],
        wallets: [{ user_id: userId, coins: 1250, diamonds: 7 }],
        rooms: [{ id: roomId, created_by: userId, mode: 'classic', capacity: 3, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }],
        room_members: [
          { room_id: roomId, user_id: userId, seat: 0, role: 'host', ready: true },
          { room_id: roomId, user_id: 'history-rival-1', seat: 1, role: 'player', ready: true },
          { room_id: roomId, user_id: 'history-rival-2', seat: 2, role: 'player', ready: true }
        ],
        room_invites: [{ room_id: roomId, inviter_id: userId, invite_code: 'HISTORY123456789' }],
        match_history: [{ id: 'active-history-row', room_id: roomId, mode: 'classic', status: 'active', winner_id: null, started_at: '2026-10-07T00:00:00.000Z', finished_at: null }],
        match_states: [{ room_id: roomId, version: 18, state: initialState, updated_at: '2026-10-07T00:00:00.000Z' }],
        ludo_chess_matches: []
      };
      const mock = window.__historyRefreshEfficiencyTest = { tables, roomId, userId, historyReads: 0, channels: [] };
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
      mock.advanceTurn = function () {
        const record = tables.match_states[0];
        record.version += 1;
        record.state = Object.assign({}, record.state, { turn: record.version % 3, turn_count: record.state.turn_count + 1 });
        mock.emit('match_states', { event: 'UPDATE', new: record });
        return record.version;
      };
      mock.completeMatch = function () {
        const room = tables.rooms[0];
        const record = tables.match_states[0];
        room.status = 'completed';
        record.version += 1;
        record.state = Object.assign({}, record.state, { phase: 'over', ranking: [0, 1, 2] });
        mock.emit('rooms', { event: 'UPDATE', new: room });
        mock.emit('match_states', { event: 'UPDATE', new: record });
      };
      mock.completeHistory = function () {
        const row = tables.match_history[0];
        row.status = 'completed';
        row.winner_id = userId;
        row.finished_at = '2026-10-07T00:31:00.000Z';
        mock.emit('match_history', { event: 'UPDATE', new: row });
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
          if (table === 'match_history') mock.historyReads += 1;
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
              getSession() { return Promise.resolve({ data: { session: { user: { id: userId, email: 'amina@example.test' } } }, error: null }); }
            },
            from: queryBuilder,
            channel: makeChannel,
            removeChannel(channel) { if (channel) channel.removed = true; return Promise.resolve('ok'); },
            rpc() { return Promise.resolve({ data: {}, error: null }); }
          };
        }
      };
      sessionStorage.setItem('crossfour.online.room', roomId);
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => window.__historyRefreshEfficiencyTest.historyReads > 0
      && document.querySelector('#online-room-heading').textContent.includes('Your room')
      && document.querySelector('#online-match-version').textContent === 'Version 18', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 100));

    const historyReadsBeforeTurns = await page.evaluate(() => window.__historyRefreshEfficiencyTest.historyReads);
    for (let turn = 0; turn < 4; turn += 1) {
      const version = await page.evaluate(() => window.__historyRefreshEfficiencyTest.advanceTurn());
      await page.waitForFunction(expectedVersion => document.querySelector('#online-match-version').textContent === 'Version ' + expectedVersion, { timeout: 5000 }, version);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    const historyReadsAfterTurns = await page.evaluate(() => window.__historyRefreshEfficiencyTest.historyReads);
    assert.equal(historyReadsAfterTurns, historyReadsBeforeTurns, 'ordinary Classic state/turn updates do not refetch match history');

    await page.evaluate(() => window.__historyRefreshEfficiencyTest.completeMatch());
    await page.waitForFunction(reads => window.__historyRefreshEfficiencyTest.historyReads > reads
      && document.querySelector('#online-match-heading').textContent === 'Match complete', { timeout: 5000 }, historyReadsAfterTurns);
    const historyReadsAfterMatch = await page.evaluate(() => window.__historyRefreshEfficiencyTest.historyReads);
    await page.evaluate(() => window.__historyRefreshEfficiencyTest.completeHistory());
    await page.waitForFunction(reads => window.__historyRefreshEfficiencyTest.historyReads > reads
      && document.querySelector('#online-history-list').textContent.includes('Classic · completed'), { timeout: 5000 }, historyReadsAfterMatch);
    assert.deepEqual(pageErrors, [], 'room refresh throttling and history realtime updates have no uncaught browser errors');
    console.log('Online history efficiency browser checks passed: ordinary room updates skip history reads while realtime history changes refresh the list.');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
