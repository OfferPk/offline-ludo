'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
const isolationName = migrations.find(file => /_guest_auth_identity_isolation\.sql$/.test(file));
assert.ok(isolationName, 'an additive guest Auth identity isolation migration exists');
const isolation = read('supabase/migrations/' + isolationName);
const backendName = migrations.find(file => /_online_backend\.sql$/.test(file));
assert.ok(backendName, 'the existing account backend migration exists');
const backend = read('supabase/migrations/' + backendName);
const guestClient = read('www/js/guest-chess.js');
const onlineClient = read('www/js/online.js');
const guestBrowser = read('test/guest-chess.browser.test.js');
const setup = read('docs/online-backend-setup.md');
let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks++;
  console.log('  ok -', message);
}
function bodyOf(sql, signature) {
  const start = sql.indexOf(signature);
  assert.notEqual(start, -1, 'function exists: ' + signature);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, 'function body ends: ' + signature);
  return sql.slice(start, end);
}

const helper = bodyOf(isolation, 'create or replace function private.is_current_user_anonymous()');
ok(/security definer[\s\S]*?set search_path = ''[\s\S]*?u\.is_anonymous[\s\S]*?auth\.uid\(\)/i.test(helper), 'the private identity check reads only the current Auth user under a fixed search path');
ok(/revoke all on function private\.is_current_user_anonymous\(\) from public, anon/i.test(isolation) && /grant execute on function private\.is_current_user_anonymous\(\) to authenticated/i.test(isolation), 'the Auth identity helper is unavailable to public/anon and callable only by authenticated sessions');

const trigger = bodyOf(isolation, 'create or replace function private.handle_new_auth_user()');
const anonymousGuard = trigger.indexOf('if coalesce(new.is_anonymous, false) then return new; end if;');
const profileInsert = trigger.indexOf('insert into public.profiles');
const walletInsert = trigger.indexOf('insert into public.wallets');
ok(anonymousGuard >= 0 && anonymousGuard < profileInsert && anonymousGuard < walletInsert, 'anonymous Auth users return before profile or wallet provisioning');
ok(/v_display_name :=[\s\S]*?new\.raw_user_meta_data[\s\S]*?v_handle :=[\s\S]*?new\.id/i.test(trigger), 'email/password profile naming remains unchanged for non-anonymous Auth users');
ok(/revoke all on function private\.handle_new_auth_user\(\) from public, anon, authenticated/i.test(isolation), 'the replacement signup trigger remains non-callable by client roles');

ok(/drop policy if exists "Users can read their own and room participants profiles"[\s\S]*?create policy "Users can read their own and room participants profiles"[\s\S]*?not \(select private\.is_current_user_anonymous\(\)\)/i.test(isolation), 'anonymous identities cannot read their own or other room participants’ profile rows');
ok(/drop policy if exists "Users can update their own display name"[\s\S]*?create policy "Users can update their own display name"[\s\S]*?not \(select private\.is_current_user_anonymous\(\)\)/i.test(isolation), 'anonymous identities cannot update profile fields');
ok(/drop policy if exists "Users can read their own wallet"[\s\S]*?create policy "Users can read their own wallet"[\s\S]*?not \(select private\.is_current_user_anonymous\(\)\)/i.test(isolation), 'anonymous identities cannot read wallet rows, including pre-existing rows');
ok(/drop policy if exists "Users can read their own currency ledger"[\s\S]*?create policy "Users can read their own currency ledger"[\s\S]*?not \(select private\.is_current_user_anonymous\(\)\)/i.test(isolation), 'anonymous identities cannot read currency-ledger rows');
ok(!/grant\s+(?:insert|update|delete|all)\s+on\s+public\.(?:profiles|wallets|currency_ledger)/i.test(isolation), 'the additive isolation migration grants no direct profile, wallet, or ledger writes');
ok(/revoke all on function public\.post_currency_transaction\(uuid, text, bigint, text, text\) from public, anon, authenticated/i.test(backend) && /grant execute on function public\.post_currency_transaction\(uuid, text, bigint, text, text\) to service_role/i.test(backend), 'currency and referral-reason ledger mutations remain service-role-only');
ok(!/create\s+(?:or replace\s+)?function\s+public\.[a-z0-9_]*referral|create\s+table\s+(?:if not exists\s+)?public\.[a-z0-9_]*referral/i.test(migrations.map(file => read('supabase/migrations/' + file)).join('\n')), 'no client-callable referral schema or RPC is introduced');
ok(!/create\s+(?:or replace\s+)?function\s+public\./i.test(isolation) && !/grant\s+execute\s+on\s+function\s+public\./i.test(isolation), 'the isolation migration introduces no client room, reward, or referral RPCs');

ok(!/window\.supabase|signInAnonymously|client\.auth|\.auth\.(?:signIn|signUp|updateUser)|\.from\(['"](?:profiles|wallets|currency_ledger)['"]\)/i.test(guestClient), 'the guest-versus-computer client has no Auth or cloud data calls');
ok(/typeof window\.supabase/.test(guestBrowser) && /externalRequests/.test(guestBrowser), 'the browser regression asserts that guest play initializes no Supabase client and makes no external requests');
ok(/signInWithPassword\(/.test(onlineClient) && /auth\.signUp\(/.test(onlineClient) && /resetPasswordForEmail\(/.test(onlineClient), 'email/password sign-in, signup, and reset remain available in the account portal');
ok(/online-signup[\s\S]*?toggle\('hidden', chessMode\)/.test(onlineClient), 'email signup is hidden only while Chess is selected, not globally removed');
ok(/keep Supabase anonymous sign-in disabled/i.test(setup) && /server-only seat marker/i.test(setup) && /profile[\s\S]*wallet/i.test(setup), 'setup guidance keeps the online guest feature gated and documents the server-seat identity isolation');

console.log('\nGuest Auth isolation static checks passed (' + checks + ' checks).');
