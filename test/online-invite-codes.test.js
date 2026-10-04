'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrationsDir = path.join(root, 'supabase/migrations');
const migrationName = fs.readdirSync(migrationsDir).find(name => /_short_room_invite_codes\.sql$/.test(name));
assert.ok(migrationName, 'six-character invite migration exists');
const sql = read('supabase/migrations/' + migrationName);
const rateMigrationName = fs.readdirSync(migrationsDir).find(name => /_room_join_rate_limits\.sql$/.test(name));
assert.ok(rateMigrationName, 'room-join rate-limit migration exists');
assert.ok(rateMigrationName > migrationName, 'rate-limit migration applies after the six-character invite migration');
const rateSql = read('supabase/migrations/' + rateMigrationName);
const html = read('www/index.html');
const browserTest = read('test/online-lobby.browser.test.js');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log('  ok -', message);
}
function section(start, end) {
  const from = sql.indexOf(start);
  assert.notEqual(from, -1, 'SQL section starts at ' + start);
  const to = sql.indexOf(end, from + start.length);
  assert.notEqual(to, -1, 'SQL section ends at ' + end);
  return sql.slice(from, to);
}

ok(alphabet.length === 32 && new Set(alphabet).size === 32 && !/[01IO]/.test(alphabet), 'the exact 32-symbol uppercase alphabet omits easily confused characters');
ok(/check \(invite_code ~ '\^\[ABCDEFGHJKLMNPQRSTUVWXYZ23456789\]\{6\}\$'\)/i.test(sql), 'the database allows exactly six characters from the advertised alphabet');
ok(/extensions\.gen_random_bytes\(6\)/i.test(sql) && /get_byte\(v_random, v_index\) % 32/i.test(sql), 'codes are generated server-side from unbiased cryptographic random bytes');
const createRoom = section('create or replace function public.create_room(', 'create or replace function public.join_room(');
ok(/security definer[\s\S]*?set search_path = ''/i.test(createRoom), 'room creation keeps its fixed-search-path security-definer boundary');
ok(/on conflict \(invite_code\) do nothing[\s\S]*?returning invite_code into v_inserted_code/i.test(createRoom) && /v_attempts >= 20/i.test(createRoom), 'a real unique-index collision is retried safely with a bounded failure path');
ok(/unique/i.test(read('supabase/migrations/20261003182237_online_backend.sql').match(/invite_code text[^\n]+/i)?.[0] || ''), 'room invite codes retain the database uniqueness constraint');
const joinRoom = section('create or replace function public.join_room(', '$$;');
ok(/auth\.uid\(\)[\s\S]*?Sign in is required/i.test(joinRoom), 'joining still requires an authenticated user');
ok(/v_code !~ '\^\(\[ABCDEFGHJKLMNPQRSTUVWXYZ23456789\]\{6\}\|\[A-F0-9\]\{16\}\)\$'/i.test(joinRoom), 'server-side validation permits only six-character codes or exact legacy URL tokens');
ok(/room_invites as i[\s\S]*?i\.expires_at > now\(\)/i.test(joinRoom) && /room_invite_legacy_codes as legacy[\s\S]*?legacy\.expires_at > now\(\)/i.test(joinRoom), 'new and legacy URL invites honor their original expiry');
ok(/for update of r/i.test(joinRoom) && /v_room\.status <> 'waiting'/i.test(joinRoom) && /v_count >= v_room\.capacity/i.test(joinRoom), 'join retains the locked room-status and capacity checks');
ok(/generate_series\(0, v_room\.capacity - 1\)[\s\S]*?insert into public\.room_members/i.test(joinRoom), 'the server continues to assign an available seat rather than trusting the client');
ok(/room_invite_legacy_codes[\s\S]*?select i\.invite_code, i\.room_id, i\.expires_at[\s\S]*?where i\.expires_at > now\(\)/i.test(sql), 'previously shared URL codes remain valid only through their existing expiration');
ok(/id="online-join-code" maxlength="6"[^>]*placeholder="6-character code"/i.test(html) && /id="online-invite-code"[^>]*maxlength="6"/i.test(html), 'join and display controls are constrained to six-character codes');
ok(/A7K2P9/.test(browserTest) && /\?room=A7K2P9/.test(browserTest) && /valid six-character invite/i.test(browserTest), 'browser coverage exercises six-character display, URL sharing, and valid joining');
const fixtureCodes = ['Q7K2M9', 'A7K2P9', 'B6C4D8', 'C2D8F4'];
ok(fixtureCodes.every(code => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code) && browserTest.includes(code)) && /ABCDEF0123456789/.test(browserTest), 'new browser fixtures use six characters and the legacy URL flow remains covered separately');

const rateJoinStart = rateSql.indexOf('create or replace function public.join_room(');
assert.notEqual(rateJoinStart, -1, 'rate-limit migration replaces the public join RPC');
const rateJoin = rateSql.slice(rateJoinStart);
ok(/create table if not exists private\.room_join_rate_limits[\s\S]*enable row level security[\s\S]*revoke all on table private\.room_join_rate_limits from public, anon, authenticated/i.test(rateSql), 'attempt counters are private, RLS-enabled, and inaccessible to client roles');
ok(/current_setting\('request\.headers', true\)[\s\S]*x-forwarded-for[\s\S]*extensions\.digest\(v_client_ip::text, 'sha256'\)/i.test(rateSql), 'the optional IP bucket uses the documented PostgREST request header and stores only a digest');
ok(/p_user is distinct from auth\.uid\(\)[\s\S]*'user:' \|\| p_user::text/i.test(rateSql), 'the per-account limiter binds its key to the authenticated user');
ok(/v_user_count <= 5 and \(v_ip_count is null or v_ip_count <= 20\)/i.test(rateSql), 'the RPC enforces separate five-per-account and twenty-per-IP attempt caps');
ok(/private\.consume_room_join_attempt\(v_user\)[\s\S]*v_code !~[\s\S]*select r\.\*/i.test(rateJoin), 'every authenticated attempt is counted before code validation and room lookup');
ok((rateJoin.match(/'error', 'invite_unavailable'/g) || []).length === 4 && !/Invite not found or expired|room is full|no longer accepting players/i.test(rateJoin), 'invalid, expired, full, and closed-room failures do not reveal code or room state');
ok(/v_room\.status <> 'waiting'[\s\S]*v_count >= v_room\.capacity[\s\S]*generate_series\(0, v_room\.capacity - 1\)[\s\S]*insert into public\.room_members/i.test(rateJoin), 'server-side waiting, capacity, and server-assigned seat checks remain in the join RPC');
ok(/revoke all on function public\.join_room\(text\) from public, anon[\s\S]*grant execute on function public\.join_room\(text\) to authenticated/i.test(rateSql), 'only authenticated clients retain execute access to room joining');
const joinClient = read('www/js/online.js');
ok(/result\.error === 'join_rate_limited'[\s\S]*result\.error\)[\s\S]*invalid, expired, or unavailable/i.test(joinClient), 'the client displays retry guidance and one generic invite-failure message');

console.log('\nSix-character invite-code migration and regression checks passed (' + checks + ' checks).');
