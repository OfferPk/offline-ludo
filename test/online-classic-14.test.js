'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const rulesMigration = '20261005120000_online_classic_rules.sql';
const migration = read('supabase/migrations/' + rulesMigration);
const start = migration.lastIndexOf('create or replace function public.move_match(');
const end = migration.indexOf('$$;', start);
const move = migration.slice(start, end);
const html = read('www/index.html');
const game = read('www/js/game.js');
const logic = read('www/js/logic.js');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log('  ok -', message); }

ok(fs.existsSync(path.join(root, 'supabase/migrations', rulesMigration)), 'the original v1.4.0 migration remains present and independently testable');
ok(/v_all_home boolean := false/.test(move), 'v_all_home starts false');
ok(!/v_all_home boolean := true/.test(move), 'v_all_home is not initialised true');
const dest = move.indexOf('if v_destination = 57 then');
const assign = move.indexOf('v_all_home := true');
const branch = move.indexOf('if v_all_home then');
ok(dest >= 0 && dest < assign && assign < branch, 'only a home landing can take the finished-player branch');
ok(move.indexOf('online_ludo_finish_queue') > branch, 'a non-home move still reaches finish_queue');

ok(/locked_rules/.test(migration) && /insert into public\.rooms \(created_by, mode, capacity, locked_rules\)/.test(migration), 'house rules are written once when the room is created');
ok(!/set locked_rules/.test(migration), 'no statement updates locked rules after insert');
ok(/drop function if exists public\.create_room\(text, integer\)/.test(migration), 'the two-argument create_room overload is replaced so rules cannot be skipped');

ok(/interval '20 seconds'/.test(migration) && /function public\.rejoin_match/.test(migration) && /function public\.note_disconnect/.test(migration), 'reconnect grace is 20 seconds and rejoin uses the same seat');
ok(/function public\.expire_grace/.test(migration) && /abandoned/.test(migration) && !/type',\s*'ai'/.test(migration), 'after the grace window the seat is dropped, not replaced by a computer');
ok(/function public\.expire_turn/.test(migration) && /turn_deadline/.test(migration) && /\+ 45000/.test(migration), 'turn timer is 45 seconds and expiry is checked on the server');
ok(/Turn timer expired/.test(migration), 'a late roll or move is rejected once the timer has expired');

ok(/ARROW_SQUARES = \[4, 17, 30, 43\]/.test(logic), 'arrows sit on board number 4, not the old squares');
ok(!/\[2, 7, 15, 20, 28, 33, 41, 46\]/.test(logic), 'the old arrow squares are gone from the rules engine');
ok(/settings: \{ sound: true, haptics: true, auto: true, fast: false, undo: true/.test(game), 'undo stays on by default');
ok(/if \(!save\.settings\.undo\) return;/.test(game), 'turning undo off blocks the undo action, including the ad undo');
ok(/id="howto-card"/.test(html) && /<th>Rule<\/th><th>Kaise<\/th>/.test(html), 'home screen has the Rule / Kaise table');
ok(html.indexOf('id="btn-howto-home"') > html.indexOf('id="howto-card"') && html.indexOf('id="btn-howto-home"') < html.indexOf('id="howto-panel"') && /howto-panel hidden/.test(html), 'How to play is inside the Ludo card and opens Rule | Kaise');
ok(/Online Classic/.test(html) && /One-way tiles/.test(html) && /Arrow start/.test(html) && /Arrow jump/.test(html) && /Friendly/.test(html), 'the table covers online Classic, arrows and Friendly');
console.log('\nOnline Classic v1.4.0 checks passed (' + checks + ' checks).');
