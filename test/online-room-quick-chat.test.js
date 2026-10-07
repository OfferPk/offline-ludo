'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20261007090000_online_room_quick_chat.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const online = fs.readFileSync(path.join(root, 'www', 'js', 'online.js'), 'utf8');
const game = fs.readFileSync(path.join(root, 'www', 'js', 'game.js'), 'utf8');

let checkCount = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checkCount++;
  console.log('  ok -', message);
}

const fixedChoices = [
  'Good luck!', 'Nice move!', 'Oops!', 'So close!', 'Well played!', "Let's go!", 'Not again…', 'Your turn!',
  ':smile', ':laugh', ':wow', ':sad', ':angry', ':cool', ':think', ':love'
];
const asSqlLiteral = value => "'" + value.replace(/'/g, "''") + "'";
const asJsLiteral = value => value.includes("'") ? JSON.stringify(value) : "'" + value + "'";
for (const choice of fixedChoices) {
  const literal = asSqlLiteral(choice);
  check(migration.split(literal).length - 1 >= 2, `database table and RPC allow the fixed choice ${choice}`);
  check(online.includes(asJsLiteral(choice)), `Online client recognizes the fixed choice ${choice}`);
}

check(/create table public\.room_chat_messages[\s\S]*?enable row level security/i.test(migration), 'chat rows are stored in a dedicated RLS-enabled table');
check(/create policy online_room_chat_members_read[\s\S]*?for select to authenticated[\s\S]*?public\.room_members[\s\S]*?rm\.user_id = \(select auth\.uid\(\)\)/i.test(migration), 'only authenticated room members can read room messages');
check(/revoke all on table public\.room_chat_messages from public, anon, authenticated/i.test(migration), 'clients cannot insert or modify chat rows directly');
check(/grant select on table public\.room_chat_messages to authenticated/i.test(migration), 'authenticated members can receive RLS-filtered Realtime rows');
check(/create or replace function public\.send_room_chat\(p_room_id uuid, p_message text\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i.test(migration), 'the send RPC uses a fixed-search-path security-definer boundary');
check(/from public\.rooms as r[\s\S]*?for share/i.test(migration) && /v_mode <> 'classic'[\s\S]*?v_status <> 'active'/i.test(migration), 'the RPC only writes messages to active Classic rooms');
check(/perform 1[\s\S]*?from public\.room_members as rm[\s\S]*?rm\.room_id = p_room_id[\s\S]*?rm\.user_id = v_user_id[\s\S]*?for share/i.test(migration), 'the RPC locks the sender membership while authorizing a message');
check(/private\.online_room_chat_rate_limits[\s\S]*?for update/i.test(migration), 'per-member rate-limit rows are serialized before sending');
check(/interval '2 seconds'/i.test(migration), 'the server enforces a two-second per-member cooldown');
check(/revoke all on function public\.send_room_chat\(uuid, text\) from public, anon/i.test(migration) && /grant execute on function public\.send_room_chat\(uuid, text\) to authenticated/i.test(migration), 'only signed-in clients can invoke the send RPC');
check(/alter publication supabase_realtime add table public\.room_chat_messages/i.test(migration), 'room chat inserts are included in Supabase Realtime');
check(/client\.rpc\('send_room_chat',[\s\S]*?p_room_id:[\s\S]*?p_message:/i.test(online), 'the Online client sends choices through the server RPC');
check(/table: 'room_chat_messages',[\s\S]*?receiveRoomChat/i.test(online), 'the room channel receives only room-filtered chat inserts');
check(/roomChatSeen\[messageId\]/i.test(online), 'RPC and Realtime echoes are deduplicated');
check(/window\.__cf\.showOnlineChatMessage\(Number\(member\.seat\), row\.message\)/i.test(online), 'incoming messages are mapped to the verified member seat');
check(/function validOnlineChatItem[\s\S]*?PHRASES\.indexOf\(item\)[\s\S]*?ART\.EMOTES/i.test(game), 'the game only displays known phrases and generated emotes');
check(/if \(G\.online\)[\s\S]*?onlineChatSender\(b\.dataset\.say\)/i.test(game), 'Online clicks use the network sender while offline chat remains local');
check(/role="status" aria-live="polite" aria-atomic="true"/i.test(game), 'temporary player bubbles announce chat accessibly');

console.log(`Online room Quick Chat contract checks passed (${checkCount} checks).`);
