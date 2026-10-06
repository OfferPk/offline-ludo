const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261006105500_note_disconnect_grace_idempotency.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const definition = migration.match(/create or replace function public\.note_disconnect\(p_room_id uuid\)([\s\S]*?)\$\$;/i);
assert.ok(definition, 'the focused migration replaces the existing note_disconnect RPC');
const body = definition[1];
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log('  ok - ' + message);
}

check(/security definer set search_path = ''/i.test(definition[0]), 'the replacement retains a fixed-search-path security-definer boundary');
check(/select rm\.seat into v_seat[\s\S]*?from public\.room_members as rm[\s\S]*?where rm\.room_id = p_room_id and rm\.user_id = v_user/i.test(body), 'only a current room member can mark their own disconnect');
const roomLock = body.search(/from public\.rooms as r where r\.id = p_room_id and r\.status = 'active' for update/i);
const stateLock = body.search(/from public\.match_states as ms where ms\.room_id = p_room_id for update/i);
const memberLock = body.search(/select rm\.seat, rm\.disconnected_at[\s\S]*?from public\.room_members as rm[\s\S]*?for update/i);
const duplicateGuard = body.search(/if v_disconnected_at is not null then/i);
const firstWrite = body.search(/update public\.room_members\s+set disconnected_at = v_disconnected_at/i);
check(roomLock >= 0 && stateLock > roomLock && memberLock > stateLock, 'room, authoritative state, and membership rows are re-read under a consistent lock order');
check(duplicateGuard > memberLock && firstWrite > duplicateGuard, 'the locked existing disconnect timestamp is checked before the first timestamp write');
const duplicateBlock = body.slice(duplicateGuard, firstWrite);
check(/'duplicate', true/i.test(duplicateBlock), 'a repeated request is explicitly identified as an idempotent duplicate');
check(/'version', v_version/i.test(duplicateBlock) && /'state', v_state/i.test(duplicateBlock), 'a duplicate returns the current state and version without advancing the match');
check(!/update public\.(?:room_members|match_states)/i.test(duplicateBlock), 'the duplicate path does not mutate the grace timestamp or authoritative state');
check(/v_disconnected_at := pg_catalog\.clock_timestamp\(\)/i.test(body) && /date_part\('epoch', v_disconnected_at\)/i.test(body), 'the first disconnect uses one server timestamp for persistence and the grace deadline');
check(/revoke all on function public\.note_disconnect\(uuid\) from public, anon/i.test(migration) && /grant execute on function public\.note_disconnect\(uuid\) to authenticated/i.test(migration), 'RPC execution remains nonpublic and limited to authenticated callers');

console.log(`Online disconnect-grace idempotency regression passed (${checks} contract checks).`);
