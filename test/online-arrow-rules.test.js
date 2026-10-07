'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../www/js/logic.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrationPath = 'supabase/migrations/20261006103000_online_classic_arrow_parity.sql';
const migration = read(migrationPath);
function functionSource(name) {
  const start = migration.indexOf('create or replace function ' + name + '(');
  assert.ok(start >= 0, name + ' replacement exists in the new migration');
  const end = migration.indexOf('\n$$;', start);
  assert.ok(end > start, name + ' function body is complete');
  return migration.slice(start, end + 4);
}
const land = functionSource('private.online_ludo_land');
const move = functionSource('public.move_match');
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log('  ok - ' + message);
}

console.log('online-arrow-rules.test.js');
ok(/returns integer language plpgsql immutable set search_path = ''/i.test(land), 'the server landing helper keeps its immutable, fixed-search-path boundary');
const dieLoop = land.indexOf('for v_step in 1..p_die loop');
const ordinaryLoopEnd = land.indexOf('end loop;', dieLoop);
const arrowCheck = land.indexOf('if v_arrows and v_pos between 0 and 51', ordinaryLoopEnd);
ok(dieLoop >= 0 && ordinaryLoopEnd > dieLoop && arrowCheck > ordinaryLoopEnd, 'server checks for an arrow only after the full die path, so passing over one is ordinary movement');
ok(/for v_step in 1\.\.4 loop[\s\S]*?v_jump := v_extra;[\s\S]*?return v_jump;/i.test(land), 'an exact arrow landing attempts one complete four-square jump');
ok(/if v_extra is null or private\.online_ludo_blocked\([\s\S]*?return v_pos;/i.test(land), 'a blocked or incomplete arrow jump leaves the token on the arrow instead of rejecting the ordinary move');

ok(/v_land := v_position;[\s\S]*?for v_step in 1\.\.v_die loop[\s\S]*?v_land := private\.online_ludo_step/i.test(move), 'the action RPC reconstructs the ordinary die landing before deciding whether a jump occurred');
ok(/v_destination <> v_land[\s\S]*?private\.online_ludo_rule\(v_state, 'arrows', false\)[\s\S]*?array\[4, 17, 30, 43\]/i.test(move), 'the move RPC only builds a jump capture path for an enabled arrow reached by an exact landing');
ok(/array_append\(v_capture_positions, v_land\)[\s\S]*?for v_step in 1\.\.4 loop[\s\S]*?array_append\(v_capture_positions, v_capture_position\)/i.test(move), 'a successful jump capture path includes the arrow square and all four jump squares');
ok(/foreach v_capture_position in array v_capture_positions loop[\s\S]*?v_safe and v_target_abs = any \(array\[0, 8, 13, 21, 26, 34, 39, 47\]\)/i.test(move), 'the authoritative move captures along that path while retaining safe-square protection');
ok(/if not v_nocap then[\s\S]*?foreach v_capture_position in array v_capture_positions loop/i.test(move), 'the no-capture house rule still suppresses every arrow-path capture');
ok(/security definer set search_path = ''/i.test(move) && /grant execute on function public\.move_match\(uuid, bigint, uuid, integer, integer\) to authenticated/i.test(migration), 'the replacement move RPC remains authenticated-only with a fixed search path');

const seats = Array.from({ length: 4 }, () => ({ type: 'human' }));
function fixture() {
  const state = L.newGame(seats, { arrows: true }, 7, 'classic');
  state.pieces.forEach((pieces, seat) => { if (pieces) state.pieces[seat] = pieces.map(() => -1); });
  return state;
}
let state = fixture();
state.pieces[0][0] = 1;
let expected = L.moveFor(state, 0, 0, 3);
ok(expected && expected.to === 8 && expected.arrowJump && expected.path.slice(-5).join(',') === '4,5,6,7,8', 'the shared rules reference confirms exact landing on arrow 4 jumps once to square 8');
state = fixture();
state.pieces[0][0] = 1;
expected = L.moveFor(state, 0, 0, 5);
ok(expected && expected.to === 6 && !expected.arrowJump, 'the shared rules reference confirms a die path passing over arrow 4 ends normally on square 6');
state = fixture();
state.pieces[0][0] = 1;
state.pieces[1][0] = 44; // absolute square 5
state.pieces[1][1] = 45; // absolute square 6
state.pieces[1][2] = 46; // absolute square 7
expected = L.moveFor(state, 0, 0, 3);
ok(expected && expected.to === 8 && expected.captures.length === 3, 'the shared rules reference confirms all three traversed danger squares are capturable during the jump');
state = L.newGame(seats, { arrows: true, blocks: true }, 7, 'classic');
state.pieces.forEach((pieces, seat) => { if (pieces) state.pieces[seat] = pieces.map(() => -1); });
state.pieces[0][0] = 1;
state.pieces[1][0] = 44; // absolute square 5
state.pieces[1][1] = 44; // opponent block on the jump path
expected = L.moveFor(state, 0, 0, 3);
ok(expected && expected.to === 4 && !expected.arrowJump, 'the shared rules reference confirms a blocked jump falls back to the arrow landing');

console.log('\nOnline arrow parity checks passed (' + checks + ' checks).');
