# Online Ludo backend setup and current scope

## Verified project

The dedicated Supabase project is named **Online Ludo**, is active in `ap-southeast-1`, and has reference `exggyvbsqhoasrqgzerf`. Its project URL and public publishable key are configured in `www/js/supabase-config.js`; no service-role or secret key is included in the frontend. Billing was not changed, and neither of the two older Supabase projects was modified.

Two additive migrations are applied to this project only:

- `20261003182237_online_backend.sql` — the seven-table schema, RLS policies, room RPCs, server-only wallet/match functions, and initial Realtime publication entries. Supabase records version `20261003182237` with migration name `20261003213000_online_backend`.
- `20261003183133_profiles_realtime.sql` — adds member-visible profile rows to the Realtime publication for live profile and roster refresh.

The live checks confirmed that `profiles`, `wallets`, `currency_ledger`, `rooms`, `room_members`, `room_invites` and `match_history` exist with RLS enabled. `anon` has no table privileges; `authenticated` can read through table policies and can update only `profiles.display_name`. Lobby RPCs are available to authenticated users, while `post_currency_transaction` and `finalize_match` are executable only by `service_role`. No client-side coin or diamond mint/spend path is enabled.

## Email/password authentication

Supabase Auth's email/password provider is enabled and public signup is allowed. Email confirmation is required (`mailer_autoconfirm` is off). Google and Facebook providers remain disabled and are not part of this portal flow.

The portal accepts an email address and password typed by the user. It uses Supabase Auth's `signInWithPassword`, `signUp`, `resetPasswordForEmail`, and `updateUser` flows. Signup-confirmation and password-reset return URLs are passed to Supabase Auth; the app clears password fields after submission and does not write passwords to local game saves or source/config files. The account email is not prefilled or hardcoded.

The live Auth URL configuration is:

- **Site URL:** `https://offerpk.github.io/offline-ludo/`
- `https://offerpk.github.io/offline-ludo/` and `https://offerpk.github.io/offline-ludo/**`
- `http://localhost:8080/` and `http://localhost:8080/**`
- `com.offerpk.offlineludo://auth-callback` for Android email-confirmation/password-reset deep links

No custom SMTP host, account, or password is configured. Consequently, successful email confirmation and password-reset delivery has not been verified; if messages do not arrive, a custom SMTP sender must be configured in Supabase Auth. Do not turn off confirmation merely to avoid configuring email delivery. The user enters their own password in the portal; no password is needed in source control or chat.

## What the online client supports

After email/password sign-in, the client can read the user's cloud profile and server-owned coin/diamond balances. Profile, wallet, room roster/readiness, and participant-visible match-history changes use RLS-protected Realtime subscriptions. The lobby supports quick matchmaking, invite rooms, join-by-code, ready status, host start, leave, and sign-out flows. Errors are shown in the screen status area.

These online account/lobby functions remain separate from offline play. Existing local game modes, saves, offline coins, and local progression stay on the device and are not copied to cloud wallets. The Android application ID and deep-link scheme remain `com.offerpk.offlineludo` to preserve installation/update and email-auth return compatibility; local save keys are unchanged.

**This is still a lobby, not synchronized online Ludo gameplay.** The backend does not run authoritative dice rolls or moves, replicate board state or turns, verify winners, or award/spend online currency. A trusted match runtime and a defined reward/economy policy are future work. Do not treat local coins and cloud balances as interchangeable.

## Verification boundary

The deployed schema, RLS, table grants, RPC grants, migration history, Auth email-provider/signup flags, Site URL, and redirect allowlist were checked on the target project. Unit tests and a deterministic browser test exercise the email/password UI, errors, confirmation/reset paths, mocked profiles/wallets/Realtime/matchmaking, sign-out, and offline fallback without creating real accounts or rooms. A real account sign-in was not performed; the user enters their own credentials in the portal. Email-confirmation and password-reset delivery still depend on SMTP readiness.
