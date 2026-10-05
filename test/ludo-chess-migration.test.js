'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
const name = migrations.find(file => /_ludo_chess\.sql$/.test(file));
assert.ok(name, 'Ludo Chess migration exists');
const sql = read('supabase/migrations/' + name);
const online = read('www/js/online.js');
const html = read('www/index.html');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log('  ok -', message); }

ok(/create table if not exists public\.ludo_chess_matches/i.test(sql) && /alter table public\.ludo_chess_matches enable row level security/i.test(sql), 'Chess state has a dedicated table with RLS enabled');
ok(/Room members can read Ludo Chess matches[\s\S]*?room_members[\s\S]*?auth\.uid\(\)/i.test(sql), 'only authenticated room participants can read Chess match state');
ok(/revoke all on public\.ludo_chess_matches from anon, authenticated[\s\S]*?grant select on public\.ludo_chess_matches to authenticated/i.test(sql), 'clients have read-only Chess table access');
ok(/alter table public\.rooms[\s\S]*?ludo_chess[\s\S]*?alter table public\.match_history[\s\S]*?ludo_chess/i.test(sql), 'room and match history constraints include the new mode');
ok(/Ludo Chess requires exactly two seats/i.test(sql) && /v_room\.capacity <> 2 or v_count <> 2/i.test(sql), 'room creation and start enforce exactly two players');
ok(/create or replace function public\.start_room/i.test(sql) && /insert into public\.ludo_chess_matches/i.test(sql), 'the existing ready/host flow initializes a separate Chess state row');
for (const fn of ['ludo_chess_move', 'claim_ludo_chess_draw', 'resign_ludo_chess']) {
  ok(new RegExp('create or replace function public\\.' + fn + '\\(', 'i').test(sql), fn + ' is a dedicated RPC');
  ok(new RegExp('grant execute on function public\\.' + fn + '\\(', 'i').test(sql), fn + ' is available to authenticated players');
}
const moveStart = sql.indexOf('create or replace function public.ludo_chess_move(');
const moveEnd = sql.indexOf('$$;', moveStart);
const moveBody = sql.slice(moveStart, moveEnd);
ok(moveBody.indexOf('public.rooms as r') < moveBody.indexOf('public.ludo_chess_matches as m') && moveBody.indexOf('public.ludo_chess_matches as m') < moveBody.indexOf('private.online_match_actions as a'), 'move RPC locks room and state before idempotency lookup');
ok(/auth\.uid\(\)[\s\S]*?You are not a member of this room[\s\S]*?v_state->>'turn'[\s\S]*?v_seat/i.test(moveBody), 'move RPC verifies authentication, room membership, and the assigned turn');
ok(/p_expected_version <> v_version[\s\S]*?private\.ludo_chess_legal/i.test(moveBody), 'move RPC rejects stale versions and independently validates legal moves');
ok(/primary key \(room_id, action_id\)/i.test(read('supabase/migrations/20261004100500_online_authoritative_match.sql')) && /v_existing\.actor_id <> v_user or v_existing\.request <> v_request/i.test(moveBody), 'Chess actions reuse actor- and payload-bound idempotency');
ok(/en.passant/i.test(sql) && /castling/i.test(sql) && /p_promotion/i.test(sql) && /checkmate/i.test(sql) && /stalemate/i.test(sql), 'server rules cover en passant, castling, promotion, checkmate, and stalemate');
ok(/draw_seventy_five_moves/i.test(sql) && /draw_fivefold_repetition/i.test(sql) && /draw_insufficient_material/i.test(sql) && /claimable/i.test(sql), 'server recognizes automatic and claimable standard draw conditions');
ok(/alter publication supabase_realtime add table public\.ludo_chess_matches/i.test(sql), 'Chess state is added to Realtime publication');
ok(/table: 'ludo_chess_matches'/i.test(online) && /ludo_chess_move/i.test(online), 'the signed-in client subscribes to and acts on the Chess match table');
ok(/value="ludo_chess"/i.test(html) && /online-chess-board/i.test(html), 'online lobby offers Chess and has a dedicated playable board');
ok(!/ludo_chess|LudoChess/.test(read('www/js/logic.js') + read('www/js/save-store.js')), 'Classic Ludo engine and local save format are not changed by Chess');
console.log('\nLudo Chess database and integration static tests passed (' + checks + ' checks).');
