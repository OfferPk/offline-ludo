'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(migrationsDir).sort();
const migrationName = migrations.find(name => /_serialize_quick_match\.sql$/.test(name));
assert.ok(migrationName, 'quick-match serialization migration exists');
assert.ok(migrationName > '20261004135600_ludo_chess.sql', 'serialization migration applies after the current quick_match definition');
const sql = fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8');
const start = sql.indexOf('create or replace function public.quick_match(');
const end = sql.indexOf('$$;', start);
assert.ok(start >= 0 && end > start, 'migration replaces the authoritative quick_match RPC');
const body = sql.slice(start, end);
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log('  ok -', message);
}

const lockAt = body.indexOf('pg_catalog.pg_advisory_xact_lock(');
const ownRoomLookupAt = body.indexOf('own_member.user_id = v_user');
const waitingRoomClaimAt = body.indexOf('for update skip locked');
ok(/security definer[\s\S]*?set search_path = ''/i.test(body), 'quick_match retains its fixed-search-path security-definer boundary');
ok(/hashtextextended\('online_quick_match:' \|\| p_mode \|\| ':' \|\| p_capacity::text, 0\)/i.test(body), 'the transaction lock key is stable and scoped to the requested mode/capacity bucket');
ok(lockAt >= 0 && ownRoomLookupAt > lockAt && waitingRoomClaimAt > lockAt, 'the xact lock is acquired before existing-membership lookup and FOR UPDATE SKIP LOCKED selection');
ok(/pg_advisory_xact_lock/i.test(body) && !/pg_advisory_lock\s*\(/i.test(body), 'the lock releases automatically with the RPC transaction rather than leaking a session lock');
ok(/p_mode not in \('classic','mystery','lucky','ludo_chess'\)/i.test(body) && /p_mode = 'ludo_chess' and p_capacity <> 2/i.test(body), 'existing mode and two-seat Chess validation is preserved');
ok(/join public\.room_members as own_member on own_member\.room_id = r\.id and own_member\.user_id = v_user[\s\S]*?where r\.status in \('waiting','active'\)[\s\S]*?r\.mode = p_mode and r\.capacity = p_capacity/i.test(body), 'a retry for a user already in a same-bucket room returns that room');
ok(/r\.status = 'waiting'[\s\S]*?pg_catalog\.count\(\*\)[\s\S]*?for update skip locked/i.test(body) && /insert into public\.room_members/i.test(body), 'a free waiting-room seat remains selected and assigned server-side');
ok(/if v_room_id is null then\s+return public\.create_room\(p_mode, p_capacity\)/i.test(body), 'the existing no-room fallback still creates a room');
ok(/revoke all on function public\.quick_match\(text, integer\) from public, anon[\s\S]*?grant execute on function public\.quick_match\(text, integer\) to authenticated/i.test(sql), 'only authenticated clients retain quick_match execution access');

console.log('\nQuick-match concurrency regression checks passed (' + checks + ' checks).');
