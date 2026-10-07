'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const migrationName = fs.readdirSync(migrationsDir).sort().find(name => /_online_grace_expiry_noop\.sql$/.test(name));
assert.ok(migrationName, 'a forward-only grace-expiry no-op migration exists');
assert.ok(migrationName > '20261005120000_online_classic_rules.sql', 'the replacement applies after the existing Classic timeout RPC');

const migration = fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8');
const definition = migration.match(/create or replace function public\.expire_grace\(p_room_id uuid\)([\s\S]*?)\$\$;/i);
assert.ok(definition, 'the migration replaces the existing expire_grace RPC');
const body = definition[1];
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log('  ok - ' + message);
}

check(/security definer set search_path = ''/i.test(definition[0]), 'the RPC retains its fixed-search-path security-definer boundary');
check(/if v_user is null[\s\S]*?if not exists\s*\(\s*select 1 from public\.room_members as rm[\s\S]*?rm\.user_id = v_user[\s\S]*?You are not a member of this room/i.test(body), 'only a signed-in member of the requested room may expire its reconnect window');
check(/from public\.rooms as r[\s\S]*?r\.status = 'active'[\s\S]*?for update[\s\S]*?from public\.match_states as ms[\s\S]*?for update/i.test(body), 'active room and authoritative state locks remain in the established order');
check(/disconnected_at is not null[\s\S]*?disconnected_at < now\(\) - interval '20 seconds'/i.test(body), 'the existing server-side 20-second expiry threshold is preserved');

const noExpiryGuard = body.search(/if v_expired_count = 0 then/i);
const stateWrite = body.search(/update public\.match_states/i);
const noExpiryEnd = noExpiryGuard >= 0 ? body.indexOf('end if;', noExpiryGuard) : -1;
const noExpiryReturn = noExpiryEnd >= 0 ? body.slice(noExpiryGuard, noExpiryEnd) : '';
check(/v_expired_count := v_expired_count \+ 1/i.test(body) && noExpiryGuard > body.search(/end loop;/i), 'the no-op decision follows the loop that counts actually expired seats');
check(noExpiryGuard >= 0 && stateWrite > noExpiryGuard, 'the no-op branch exits before any authoritative-state write');
check(/'expired', false/i.test(noExpiryReturn) && /'version', v_version/i.test(noExpiryReturn) && /'state', v_state/i.test(noExpiryReturn), 'early and duplicate calls return expired=false with the unchanged version and state');
check(!/update public\.(?:room_members|match_states|rooms|match_history)/i.test(noExpiryReturn), 'the no-op return path performs no member, room, history, or match-state write');
check(/set version = v_version \+ 1, state = v_state/i.test(body) && /'version', v_version \+ 1/i.test(body), 'a real expiry still advances the authoritative version exactly once');
check(/revoke all on function public\.expire_grace\(uuid\) from public, anon/i.test(migration) && /grant execute on function public\.expire_grace\(uuid\) to authenticated/i.test(migration), 'RPC execution remains nonpublic and available to authenticated participants');

console.log(`Online grace-expiry no-op regression passed (${checks} contract checks).`);
