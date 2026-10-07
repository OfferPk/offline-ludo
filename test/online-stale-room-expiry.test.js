'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrationsDir = path.join(root, 'supabase/migrations');
const migrationName = fs.readdirSync(migrationsDir).find(name => /_expire_stale_waiting_rooms\.sql$/.test(name));
assert.ok(migrationName, 'stale waiting-room cleanup migration exists');
assert.ok(migrationName > '20261005120000_online_classic_rules.sql', 'cleanup migration applies after the current room schema and matchmaking rules');
const sql = read('supabase/migrations/' + migrationName);
const online = read('www/js/online.js');
const packageJson = JSON.parse(read('package.json'));
const functionStart = sql.indexOf('create or replace function public.expire_stale_waiting_rooms(');
const functionEnd = sql.indexOf('$$;', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'migration defines the public cleanup RPC');
const body = sql.slice(functionStart, functionEnd);
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log('  ok -', message);
}

ok(/returns integer[\s\S]*?language plpgsql[\s\S]*?security definer[\s\S]*?set search_path = ''/i.test(body), 'cleanup uses a fixed-search-path security-definer RPC with a bounded result count');
ok(/v_user uuid := auth\.uid\(\)[\s\S]*?if v_user is null[\s\S]*?errcode = '28000'/i.test(body), 'only authenticated callers can trigger cleanup');
ok(/r\.status = 'waiting'[\s\S]*?r\.created_at <= v_now - interval '24 hours'/i.test(body), 'only waiting rooms past the 24-hour lifetime are eligible');
ok(/order by r\.created_at, r\.id[\s\S]*?limit 500[\s\S]*?for update skip locked/i.test(body), 'oldest eligible rooms are processed in bounded, concurrency-safe batches');
ok(/update public\.rooms as r[\s\S]*?set status = 'cancelled'[\s\S]*?finished_at = v_now[\s\S]*?updated_at = v_now[\s\S]*?where r\.id = stale\.id[\s\S]*?r\.status = 'waiting'/i.test(body), 'the RPC atomically cancels only still-waiting rooms and records final timestamps');
ok(/get diagnostics v_expired = row_count[\s\S]*?return v_expired/i.test(body), 'the cleanup returns the number of rows actually closed');
ok(/rooms_waiting_stale_cleanup_idx[\s\S]*?on public\.rooms \(created_at, id\)[\s\S]*?where status = 'waiting'/i.test(sql), 'the partial index supports the stale-waiting-room scan without indexing active games');
ok(!/delete from public\.room_members|update public\.match_history|update public\.wallets|update public\.match_states/i.test(sql), 'cleanup preserves membership and does not alter match, history, or currency state');
ok(/revoke all on function public\.expire_stale_waiting_rooms\(\) from public, anon[\s\S]*?grant execute on function public\.expire_stale_waiting_rooms\(\) to authenticated/i.test(sql), 'RPC execute access is restricted to authenticated callers');

const cleanupStart = online.indexOf('function cleanupStaleWaitingRooms()');
const callStart = online.indexOf('function callRpc(name, args)', cleanupStart);
assert.ok(cleanupStart >= 0 && callStart > cleanupStart, 'client defines a dedicated cleanup helper');
const cleanup = online.slice(cleanupStart, callStart);
ok(/invokeRpc\('expire_stale_waiting_rooms', \{\}\)/.test(cleanup) && /catch\(function \(\) \{ return 0; \}\)/.test(cleanup), 'cleanup failure is best-effort and cannot block normal matchmaking or recovery');
const callEnd = online.indexOf('\n  function openOnline()', callStart);
const callBody = online.slice(callStart, callEnd);
ok(/name === 'quick_match'[\s\S]*?cleanupStaleWaitingRooms\(\)[\s\S]*?invokeRpc\(name, args\)/.test(callBody), 'Quick Match waits for the cleanup attempt before invoking its server RPC');
const sessionStart = online.indexOf('function startUserSession()');
const sessionEnd = online.indexOf('function applyAuthSession(', sessionStart);
const sessionBody = online.slice(sessionStart, sessionEnd);
ok(/cleanupStaleWaitingRooms\(\)[\s\S]*?restoreActiveRoom\(\)/.test(sessionBody), 'session recovery cleans expired waiting rooms before restoring a saved room');
ok(packageJson.scripts.test.includes('test/online-stale-room-expiry.test.js'), 'the static cleanup regression is part of npm test');
ok(packageJson.scripts['test:online-stale-room-expiry'] === 'node test/online-stale-room-expiry.browser.test.js', 'the isolated mocked-browser regression has a dedicated npm script');

console.log('\nOnline stale waiting-room cleanup regression passed (' + checks + ' checks).');
