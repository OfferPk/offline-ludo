'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
const migrationName = migrations.find(file => /_guest_chess_bot_takeover\.sql$/.test(file));
assert.ok(migrationName, 'an additive guest Chess computer-seat migration exists');
const sql = read('supabase/migrations/' + migrationName);
const client = read('www/js/online.js');
const html = read('www/index.html');
const config = read('www/js/supabase-config.js');
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log('  ok -', message);
}
function bodyOf(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, 'function exists: ' + signature);
  const end = source.indexOf('$$;', start);
  assert.notEqual(end, -1, 'function body ends: ' + signature);
  return source.slice(start, end);
}

const seatTable = sql.slice(sql.indexOf('create table if not exists public.ludo_chess_bot_seats'), sql.indexOf('create index if not exists ludo_chess_bot_seats_room_idx'));
ok(/room_id uuid primary key/i.test(seatTable) && /seat = 1/i.test(seatTable) && /unique \(room_id, seat\)/i.test(seatTable), 'the computer seat has a unique room/seat key and a server-defined seat number');
ok(!/user_id|auth\.users|profile|wallet/i.test(seatTable), 'the computer is not represented by an Auth identity, member, profile, or wallet');
ok(/enable row level security/i.test(sql) && /on public\.ludo_chess_bot_seats for select to authenticated/i.test(sql) && /private\.is_room_member\(room_id\)/i.test(sql), 'computer-seat metadata is readable only by room members');
ok(/revoke all on public\.ludo_chess_bot_seats from public, anon, authenticated/i.test(sql) && /grant select on public\.ludo_chess_bot_seats to authenticated/i.test(sql), 'clients cannot insert, update, or delete the server-owned computer seat');

const create = bodyOf(sql, 'create or replace function public.create_guest_ludo_chess_room');
ok(/auth\.uid\(\)/i.test(create) && /private\.is_current_user_anonymous\(\)/i.test(create), 'guest room creation requires a current anonymous Auth identity');
ok(/pg_advisory_xact_lock/i.test(create) && /guest_chess_room_requests/i.test(create) && /action_id = p_action_id/i.test(create), 'guest room creation is serialized per identity and idempotent by action ID');
ok(/insert into public\.room_members[\s\S]*?values \(v_room_id, v_user, 0/i.test(create) && /insert into public\.ludo_chess_bot_seats[\s\S]*?values \(v_room_id, 1/i.test(create), 'the guest owns seat 0 while the server owns seat 1 without a fake member');
ok(/insert into public\.ludo_chess_matches[\s\S]*?values \(v_room_id, 0, v_initial\)/i.test(create) && /insert into public\.match_history/i.test(create), 'guest Chess starts with a server-owned initial position and match record');
ok(!/public\.(?:profiles|wallets|currency_ledger)|referral/i.test(create), 'guest-room creation never provisions or mutates profile, wallet, currency, or referral data');

const botMove = bodyOf(sql, 'create or replace function private.ludo_chess_random_legal_move');
ok(/private\.ludo_chess_legal\(/i.test(botMove) && /extensions\.gen_random_bytes\(4\)/i.test(botMove), 'computer moves are randomly selected from server-validated legal moves using server-side entropy');
ok(/p_state jsonb/i.test(botMove) && !/p_from|p_to|p_promotion/i.test(botMove), 'the bot selector accepts no client-supplied move or bot identity');

const move = bodyOf(sql, 'create or replace function public.ludo_chess_move');
const roomLock = move.indexOf('from public.rooms as r where r.id = p_room_id for update');
const matchLock = move.indexOf('from public.ludo_chess_matches as m where m.room_id = p_room_id for update');
ok(roomLock >= 0 && matchLock > roomLock, 'the move RPC serializes on the room and match rows in a stable lock order');
ok(/p_expected_version <> v_version/i.test(move) && /p_action_id/i.test(move) && /v_existing\.actor_id <> v_user/i.test(move), 'human actions retain stale-version and action-ID/actor idempotency checks');
ok(/private\.ludo_chess_random_legal_move\(v_state\)/i.test(move) && /private\.ludo_chess_apply\(v_state, \(v_bot_move->>'from'\)/i.test(move), 'a computer reply is selected and applied by the server in the same player-move transaction');
ok(/v_new_version := v_version \+ 2/i.test(move) && /insert into private\.online_match_actions/i.test(move), 'the bot reply advances authoritative versioning and commits with the caller action ledger');

const takeover = bodyOf(sql, 'create or replace function public.takeover_ludo_chess_bot_room');
const takeoverRoomLock = takeover.indexOf('from public.rooms as r where r.id = p_room_id for update');
const takeoverMatchLock = takeover.indexOf('from public.ludo_chess_matches as m where m.room_id = p_room_id for update');
ok(takeoverRoomLock >= 0 && takeoverMatchLock > takeoverRoomLock, 'takeover uses the same room-then-match serialization order as move submission');
ok(/p_expected_version <> v_version/i.test(takeover) && /v_existing\.actor_id <> v_user/i.test(takeover) && /v_existing\.request <> v_request/i.test(takeover), 'takeover is version-checked and action-ID retries cannot be replayed by another actor or payload');
ok(/exists \(select 1 from public\.room_members as own[^;]*raise exception 'You are already a member/i.test(takeover), 'takeover refuses duplicate membership instead of impersonating an existing player');
ok(/for update/i.test(takeover) && /delete from public\.ludo_chess_bot_seats/i.test(takeover) && /insert into public\.room_members[\s\S]*?v_bot_seat/i.test(takeover), 'takeover atomically removes the server bot marker and admits one human to its unique seat');
ok(/v_new_version := v_version \+ 1/i.test(takeover) && /draw_offer = null/i.test(takeover) && /insert into private\.online_match_actions/i.test(takeover), 'takeover versions the committed state, clears any computer-era draw offer, and records idempotency');
ok(/find_ludo_chess_bot_room[\s\S]*?returns jsonb/i.test(sql) && /'room_id', v_room_id, 'version', v_version/i.test(sql), 'match discovery exposes only a candidate room ID/version before a protected takeover');
ok(/revoke all on function public\.takeover_ludo_chess_bot_room\(uuid, bigint, uuid\) from public, anon/i.test(sql) && /grant execute on function public\.takeover_ludo_chess_bot_room\(uuid, bigint, uuid\) to authenticated/i.test(sql), 'takeover requires the authenticated role and cannot be called by unauthenticated clients');

ok(/anonymousChessEnabled: false/.test(config), 'the online guest feature is disabled by default until Auth and migrations are explicitly configured');
ok(/signInAnonymously\(\)/.test(client) && /anonymousChessEnabled\(\)/.test(client), 'anonymous sign-in is invoked only behind the explicit feature gate');
ok(/if \(!client \|\| !currentUser \|\| isAnonymousUser\(\)\)/.test(client) && /if \(!isAnonymousUser\(\)\) \{\s*refreshAccount\(\);\s*subscribeWallet\(\);\s*subscribeProfile\(\);/s.test(client), 'anonymous sessions skip profile/wallet reads and subscriptions');
ok(/Play Online as Guest vs Computer/.test(html) && /Join an open guest Chess game/.test(html) && /No email, profile, wallet, coins, or referral access/.test(html), 'the gated UI clearly discloses guest restrictions and provides a separate human-seat entry');
ok(/anonymousChessEnabled: false/i.test(read('docs/online-backend-setup.md')) && /Takeover locks the room and Chess-state rows/i.test(read('docs/online-backend-setup.md')), 'setup guidance requires explicit feature configuration and documents transactional takeover locking');

console.log('\nGuest server Chess checks passed (' + checks + ' checks).');
