'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261003213000_online_backend.sql');
const app = read('www/js/online.js');
const config = read('www/js/supabase-config.js');
const html = read('www/index.html');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const privacy = read('PRIVACY.md');
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log('  ok -', message);
}

ok(!/pg_catalog\.(?:coalesce|nullif|greatest|least)\s*\(/i.test(migration), 'PostgreSQL special forms are not incorrectly schema-qualified');
const tables = ['profiles', 'wallets', 'currency_ledger', 'rooms', 'room_members', 'room_invites', 'match_history'];
for (const table of tables) {
  ok(new RegExp('create table if not exists public\\.' + table + '\\b', 'i').test(migration), table + ' table is in the migration');
  ok(new RegExp('alter table public\\.' + table + ' enable row level security', 'i').test(migration), table + ' has RLS enabled');
}
ok(/revoke all on public\.profiles,[\s\S]*?from anon, authenticated/i.test(migration), 'client table DML is revoked before narrow grants');
ok(/grant update \(display_name\) on public\.profiles to authenticated/i.test(migration), 'authenticated users can update only their display name');
ok(/create policy "Users can read their own wallet"[\s\S]*?auth\.uid\(\)[\s\S]*?user_id/i.test(migration), 'wallet reads are owner-scoped');
ok(/create or replace function public\.post_currency_transaction[\s\S]*?security definer[\s\S]*?set search_path = ''/i.test(migration), 'currency changes run inside a fixed-search-path security-definer function');
ok(/revoke all on function public\.post_currency_transaction\(uuid, text, bigint, text, text\) from public, anon, authenticated/i.test(migration), 'currency transaction function is unavailable to app clients');
ok(/grant execute on function public\.post_currency_transaction\(uuid, text, bigint, text, text\) to service_role/i.test(migration), 'currency function is service-role-only');
ok(/grant execute on function public\.finalize_match\(uuid, uuid, jsonb\) to service_role/i.test(migration), 'match finalization is server-only');
ok(/unique \(user_id, event_key\)/i.test(migration) && /for update/i.test(migration), 'currency mutations have an idempotency key and wallet row lock');
ok(/status = 'waiting'[\s\S]*?for update[\s\S]*?skip locked/i.test(migration), 'matchmaking claims a waiting room under a row lock');
ok(/create policy "Room members can read their room"[\s\S]*?private\.is_room_member/i.test(migration), 'room reads require room membership');
ok(/alter publication supabase_realtime add table/i.test(migration), 'lobby tables are conditionally added to Realtime publication');
ok(!/sb_secret_[A-Za-z0-9_-]{12,}/i.test(config + app) && !/(?:service_role|serviceKey)[_-]?key\s*[:=]\s*['"][^'"]+['"]/i.test(config + app), 'browser files contain no embedded service-role/secret key');
ok(/YOUR_PROJECT_REF\.supabase\.co/.test(config) && /YOUR_SUPABASE_PUBLISHABLE_KEY/.test(config), 'checked-in Supabase config contains placeholders only');
ok(!/cdn\.jsdelivr\.net\/npm\/@supabase/.test(html) && /document\.createElement\('script'\)/.test(app), 'Supabase SDK is absent from startup markup and loads lazily');
ok(/signInWithOAuth/.test(app) && /provider: provider/.test(app), 'social OAuth uses Supabase Auth, not embedded custom credentials');
ok(/postgres_changes/.test(app) && /table: 'room_members'/.test(app), 'lobby subscribes to participant roster changes');
ok(/table: 'wallets', filter: 'user_id=eq\.' \+ currentUser\.id/.test(app) && /'match_history', 'wallets'/.test(migration), 'cloud balance updates use an owner-filtered realtime subscription');
ok(/online-lobby\.browser\.test\.js/.test(read('package.json')), 'browser smoke test is discoverable from npm scripts');
ok(/com\.offerpk\.offlineludo/.test(manifest) && /auth-callback/.test(manifest), 'Android registers the configured OAuth deep link');
ok(/board and turn-by-turn online gameplay are not enabled/.test(html), 'online UI discloses that gameplay synchronization is not available');
ok(/offline coins are not automatically copied into an online wallet/i.test(privacy), 'privacy notice explains that offline balances are not migrated');
console.log('\nOnline backend static validation passed (' + checks + ' checks).');
