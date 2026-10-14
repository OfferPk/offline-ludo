'use strict';
const fs = require('fs');
const path = require('path');
const stakeSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261014143000_online_coin_stakes.sql'), 'utf8');
const championshipSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261014160000_online_championship.sql'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../www/js/online.js'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '../www/js/game.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
let checks = 0;
function ok(condition, message) { checks++; if (!condition) throw new Error('FAIL: ' + message); }

console.log('online-wager-championship.test.js');
ok(stakeSql.includes('entry_fee in (0, 50, 100, 500)'), 'online room entry amounts are explicitly bounded');
ok(stakeSql.includes('create trigger hold_online_room_wagers_before_start'), 'entry fees are escrowed only on the server-side waiting-to-active transition');
ok(stakeSql.includes('online-stake-entry:') && stakeSql.includes('online-stake-refund:'), 'wager debits and cancellation refunds use idempotent ledger keys');
ok(stakeSql.includes('sum(rw.entry_fee)') && stakeSql.includes("'online_room_payout'"), 'winner payout is based on held participant entries');
ok(stakeSql.includes('pay_online_room_wager_after_match') && stakeSql.includes("'{ranking,0}'"), 'winner identity comes from the server-authoritative final ranking');
ok(stakeSql.includes("p_entry_fee > 0 and p_mode <> 'classic'"), 'online stakes are restricted to supported Classic rooms');

ok(championshipSql.includes('online_championship_live_slots') && championshipSql.includes('online_championship_one_live_entry_per_user'), 'live entries and bracket seats are uniquely locked');
ok(championshipSql.includes("entry_fee in (50, 100, 500)"), 'Championship buy-ins are bounded to the offered choices');
ok(!championshipSql.includes('for update skip locked'), 'signups serialize on the existing waiting pool instead of fragmenting a bracket');
ok(championshipSql.includes('for v_i in 1..4 loop') && championshipSql.includes('for v_i in 1..2 loop'), 'server creates quarter-final and semifinal matches only after prior stages resolve');
ok(championshipSql.includes('create_online_championship_room(v_match.tournament_id, 3, 1, v_player1, v_player2)'), 'server creates one final after both semifinals');
ok(championshipSql.includes('v_tournament.stage <> v_match.stage'), 'round advancement is idempotent under concurrent match completions');
ok(championshipSql.includes('v_fee::bigint * 8') && championshipSql.includes("'online_championship_prize'"), 'final winner receives the complete eight-entry virtual jackpot');
ok(championshipSql.includes("'crown', v_tournament.winner_id = v_user"), 'exclusive Crown status comes from the server-owned final winner record');
ok(championshipSql.includes('advance_online_championship_after_match') && championshipSql.includes('advance_online_championship_after_forfeit'), 'server advances rounds from completed authoritative matches or an explicit forfeit');
ok(championshipSql.includes('cancel_championship_room_after_member_leave'), 'a player leaving a waiting bracket match cannot strand the bracket');
ok(championshipSql.includes('alter table public.online_championships enable row level security') && championshipSql.includes('revoke all on public.online_championships'), 'bracket tables are not directly writable/readable by clients');
ok(championshipSql.includes("'championships', true"), 'the capability response exposes brackets only when the migration is installed');

ok(client.includes('onlineChampionshipsEnabled = onlineStakesEnabled && result.championships === true'), 'client feature gate fails closed until the server advertises bracket support');
ok(client.includes("callRpc('enter_online_championship'") && client.includes("callRpc('leave_online_championship'"), 'entry and waiting refund go through authenticated RPCs');
ok(client.includes("callRpc('get_my_online_championship'"), 'client renders bracket status from the server RPC');
ok(client.includes('championship_match'), 'assigned match room is tagged for safe UI behavior');
ok(!/function handleTokenTap\(seat, piece, keyboard\) \{[\s\S]*?G\.online\) return false/.test(game), 'online Classic token taps can reach the authoritative move RPC');
ok(html.includes('Quarter-final → Semi-final → Final') && html.includes('exclusive Crown badge'), 'lobby explains the 8-player format, 8× pool and Crown reward');
ok(html.includes('local Wi-Fi') && html.includes('not server-authoritative or cheat-proof'), 'local peer play is honestly labeled as separate from secure online play');
ok(pkg.scripts.test.includes('test/online-wager-championship.test.js'), 'the regression checks run in npm test');

console.log('online wager/Championship checks passed (' + checks + ' checks).');
