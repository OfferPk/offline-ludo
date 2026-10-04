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
console.log('\nSix-character invite-code migration and regression checks passed (' + checks + ' checks).');
