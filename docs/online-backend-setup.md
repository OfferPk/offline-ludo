# Online Ludo backend setup and current scope

## Verified project

The dedicated Supabase project is named **Online Ludo**, is active in `ap-southeast-1`, and has reference `exggyvbsqhoasrqgzerf`. Its project URL and public publishable key are configured in `www/js/supabase-config.js`; no service-role or secret key is included in the frontend. Billing was not changed, and neither of the two older Supabase projects was modified.

Four additive migrations are applied to this project only:

- `20261003182237_online_backend.sql` — the seven-table schema, RLS policies, room RPCs, server-only wallet/match functions, and initial Realtime publication entries. Supabase records version `20261003182237` with migration name `20261003213000_online_backend`.
- `20261003183133_profiles_realtime.sql` — adds member-visible profile rows to the Realtime publication for live profile and roster refresh.
- `20261004100500_online_authoritative_match.sql` — adds the member-readable/read-only `match_states` row, RLS-protected private idempotency ledger, Classic state initialization on room start, server-generated dice and validated move RPCs, optimistic versions, and Realtime publication for match state.
- `20261004135600_ludo_chess.sql` — adds the `ludo_chess` room mode, exact-two-player validation, an RLS-protected `ludo_chess_matches` table, server-side standard-chess legality/state-transition helpers, idempotent move/draw/resign RPCs, match-history handling, and Realtime publication. The matching version and name are recorded in `supabase_migrations.schema_migrations`.

The two invite-related migrations in PR #9 (`20261004224500_short_room_invite_codes.sql` and `20261004230000_room_join_rate_limits.sql`) are branch-only and have **not** been applied to the live project.

Post-apply metadata checks confirmed Chess match state is readable only to authenticated room participants, clients have no direct write access, `anon` has no access, and Chess transitions are exposed through authenticated security-definer RPCs rather than direct state mutation. The new functions validate room membership, assigned seat/turn, expected version, legal move and promotion, and an action-ID/payload-bound retry. The migration does not change email/password Auth settings, Classic Ludo rules, local saves, wallet operations, or production frontend hosting.

## Email/password authentication

Supabase Auth email/password signup is enabled and email confirmation is disabled (`mailer_autoconfirm` is on). Signup immediately returns a signed-in session. Email/password is the only sign-in method supported by this portal.

The portal accepts an email address and password typed by the user. It uses Supabase Auth's `signInWithPassword`, `signUp`, `resetPasswordForEmail`, and `updateUser` flows. With auto-confirm enabled, `signUp` immediately establishes a signed-in session and does not request a confirmation link. Password-reset return URLs are passed to Supabase Auth; the app clears password fields after submission and does not write passwords to local game saves or source/config files. The account email is not prefilled or hardcoded.

The live Auth URL configuration is:

- **Site URL:** `https://offerpk.github.io/offline-ludo/`
- `https://offerpk.github.io/offline-ludo/` and `https://offerpk.github.io/offline-ludo/**`
- `http://localhost:8080/` and `http://localhost:8080/**`
- `com.offerpk.offlineludo://auth-callback` for Android password-reset deep links

Gmail SMTP remains configured for Supabase Auth (`smtp.gmail.com:587`) for password-reset mail; the sender account and App Password are not stored in this repository. Reset-email delivery has not been live-tested. Signup confirmation is disabled, so new accounts do not need or receive a confirmation link/OTP. Current Auth email limits are 2 messages per hour and a 60-second per-user resend interval. No test email/OTP was sent. The user enters their own password in the portal; no password is needed in source control or chat. See the [official SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp) for the provider configuration model.

## What the online client supports

After email/password sign-in, the client can read the user's cloud profile and server-owned coin/diamond balances. Profile, wallet, room roster/readiness, match-state and participant-visible match-history changes use RLS-protected Realtime subscriptions. The lobby supports quick matchmaking, invite rooms, join-by-code, server-assigned seats, ready status, host start, leave, and sign-out flows. New room invites use six uppercase characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; the server generates them from cryptographic randomness, enforces uniqueness, and retries collisions. Invite links continue to use the `?room=CODE` URL flow. Existing links remain usable only until their original 24-hour expiration, and joining still requires authentication plus server-side waiting-room, capacity, and seat checks. The PR #9 join-rate-limit migration limits guesses to five per authenticated account and 20 per observed IP in a five-minute window; the IP bucket uses Supabase's documented first `x-forwarded-for` address when available, while per-account limiting always applies. Invalid, expired, full, and closed-room results share one generic response. **Online Classic Ludo and Ludo Chess are playable modes**: Classic retains server-generated dice and its existing Classic rules; Chess is restricted to two players and follows standard chess rules, including check/checkmate, stalemate, castling, en passant, promotion, resignation, and supported draw claims. Chess pieces use distinct red/blue Ludo-token styling. The browser computes legal-move hints, but the database independently validates and applies every Chess transition. Both modes use optimistic versions and the client refreshes after focus, visibility/network recovery, or Realtime reconnect; a pending request can be retried with the same action ID. Mystery Tiles and Lucky Chaos remain offline modes.

These online account and match functions remain separate from offline play. Existing local game modes, house rules, saves, offline coins, and local progression stay on the device and are not copied to cloud wallets. The Android application ID and deep-link scheme remain `com.offerpk.offlineludo` to preserve installation/update and email-auth return compatibility; local save keys are unchanged. No online rewards or currency mutations were added.

**What is not included yet:** a manual two-device/two-browser Realtime play session, disconnect grace periods or automatic turn timers, anti-cheat telemetry beyond database validation, Mystery/Lucky online mechanics, or online rewards/currency changes. Gmail SMTP password-reset delivery has not been live-tested. No merge or production frontend deployment was performed as part of this change.

## Verification boundary

`npm test`, the mocked signed-in lobby/Chess browser flow, responsive home-card browser tests, and responsive setup-layout tests passed. The live SQL integration checks exercised authenticated Chess create/join/ready/start, alternating legal moves, action-ID idempotency, illegal-move rejection, castling, en passant, underpromotion, and a draw claim. Synthetic Auth rows, rooms, and matches used for those checks were created inside explicit database transactions and rolled back; no test user or match was retained. The browser integration uses a mocked Auth/Supabase client and sends no email. A separate live two-device synchronization session was not run. Do not treat local coins and cloud balances as interchangeable.

The PR #9 invite-code and join-rate-limit migrations are covered by local static contract checks; they have not been applied to a live database or exercised through a live abuse test.
