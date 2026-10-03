# Online Ludo backend setup and current scope

## Verified project

The dedicated Supabase project is named **Online Ludo**, is active in `ap-southeast-1`, and has reference `exggyvbsqhoasrqgzerf`. Its project URL and public publishable key are configured in `www/js/supabase-config.js`; no service-role or secret key is included in the frontend. Billing was not changed, and neither of the two older Supabase projects was modified.

Three additive migrations are applied to this project only:

- `20261003182237_online_backend.sql` — the seven-table schema, RLS policies, room RPCs, server-only wallet/match functions, and initial Realtime publication entries. Supabase records version `20261003182237` with migration name `20261003213000_online_backend`.
- `20261003183133_profiles_realtime.sql` — adds member-visible profile rows to the Realtime publication for live profile and roster refresh.
- `20261004100500_online_authoritative_match.sql` — adds the member-readable/read-only `match_states` row, RLS-protected private idempotency ledger, Classic state initialization on room start, server-generated dice and validated move RPCs, optimistic versions, and Realtime publication for match state.

Post-apply metadata checks confirmed `match_states` has RLS and a member-only SELECT policy, authenticated clients have no direct writes, `anon` has no access, and the private idempotency ledger has RLS with no client grants. The `roll_match` and `move_match` functions exist as security-definer functions with an empty fixed search path; execute is granted to `authenticated` but not `anon`. The match table is in `supabase_realtime`, and migration version `20261004100500` is recorded. The SQL functions validate membership, assigned seat, phase, expected version, queued die and legal token movement, generate dice server-side, store action IDs for exact retries, and reject new stale versions. These grants and policies were verified from live metadata; no authenticated player sessions or two-client runtime actions were run because no live users were created. Existing currency mutations and match rewards remain service-role-only; no client coin/diamond mint/spend path is enabled.

## Email/password authentication

Supabase Auth email/password signup is enabled and email confirmation is disabled (`mailer_autoconfirm` is on). Signup immediately returns a signed-in session. Email/password is the only sign-in method supported by this portal.

The portal accepts an email address and password typed by the user. It uses Supabase Auth's `signInWithPassword`, `signUp`, `resetPasswordForEmail`, and `updateUser` flows. With auto-confirm enabled, `signUp` immediately establishes a signed-in session and does not request a confirmation link. Password-reset return URLs are passed to Supabase Auth; the app clears password fields after submission and does not write passwords to local game saves or source/config files. The account email is not prefilled or hardcoded.

The live Auth URL configuration is:

- **Site URL:** `https://offerpk.github.io/offline-ludo/`
- `https://offerpk.github.io/offline-ludo/` and `https://offerpk.github.io/offline-ludo/**`
- `http://localhost:8080/` and `http://localhost:8080/**`
- `com.offerpk.offlineludo://auth-callback` for Android password-reset deep links

Gmail SMTP remains configured for Supabase Auth (`smtp.gmail.com:587`) for password-reset mail; the sender account and App Password are not stored in this repository. Reset-email delivery has not been live-tested. Signup confirmation is disabled, so new accounts do not need or receive a confirmation link/OTP. Current Auth email limits are 2 messages per hour and a 60-second per-user resend interval. No test email/OTP was sent and no live test account was created. The user enters their own password in the portal; no password is needed in source control or chat. See the [official SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp) for the provider configuration model.

## What the online client supports

After email/password sign-in, the client can read the user's cloud profile and server-owned coin/diamond balances. Profile, wallet, room roster/readiness, match-state and participant-visible match-history changes use RLS-protected Realtime subscriptions. The lobby supports quick matchmaking, invite rooms, join-by-code, server-assigned seats, ready status, host start, leave, and sign-out flows. The applied migration changes Classic room start to initialize state from occupied seats. The gameplay slice follows the existing default Star-style rules: server dice, 6-to-leave-base, stacked 6s and triple-six forfeiture, legal queue selection, safe start/star squares, captures, exact home entry and capture/home bonus rolls. State is optimistic-versioned and the UI re-fetches after focus, visibility/network recovery and Realtime reconnect; a pending request can be retried with the same action ID. The browser reuses `www/js/logic.js` for legal-move hints, while the database independently validates each transition. Realtime publication and database metadata are verified; actual two-session synchronization has not been runtime-tested.

These online account and match functions remain separate from offline play. Online gameplay is currently **Classic only**; Mystery Tiles and Lucky Chaos remain available offline. Existing local game modes, house rules, saves, offline coins, and local progression stay on the device and are not copied to cloud wallets. The Android application ID and deep-link scheme remain `com.offerpk.offlineludo` to preserve installation/update and email-auth return compatibility; local save keys are unchanged.

**What is not included yet:** authenticated two-client runtime testing, a full graphical game-board integration, Mystery/Lucky online mechanics, disconnect grace periods or automatic turn timers, anti-cheat telemetry beyond database validation, and any rewards or online currency changes. The compact Online Classic panel shows authoritative token positions and offers server-validated actions; local rules provide move hints only. No merge or production deployment was performed as part of this change. Do not treat local coins and cloud balances as interchangeable.

## Verification boundary

The target project identity, applied migration history, RLS, table privileges, function grants/search paths, and Realtime publication are verified through the Management API. The local unit and deterministic browser suites use a fully mocked Auth/Supabase client, block external project traffic, and cover immediate signup sessions, existing-user sign-in, error handling, room/lobby behavior, server dice/move controls, idempotent retry UX, Realtime refresh, and offline fallback; they send no email and create no live user. Do not create test users or send OTPs for this slice. Live RPC authorization and two-client action tests requiring authenticated room members remain unrun. Gmail SMTP remains configured for password resets, whose delivery has not been live-tested.
