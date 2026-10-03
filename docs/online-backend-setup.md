# Online backend setup and current scope

## Current status

This branch contains an unconfigured Supabase schema/client integration. The approved new project could not be created because the `Shahdara Fiber Net` organization currently has two active free projects, its project limit. The existing projects were not changed. The frontend therefore keeps a placeholder URL and publishable key in `www/js/supabase-config.js`; no migration has been applied and no login or backend flow has been live-tested.

The current scope is accounts, profiles, private cloud balances (read on sign-in and refreshed through an owner-filtered Realtime channel), invite/quick-match rooms, participant readiness, realtime lobby roster/status and a match-history row when a host starts a table. It does **not** synchronize the Ludo board, dice, moves or turns, and it does not produce verified winners or playable online matches. The lobby says this in the UI. Offline matches, local saves and local coins remain unchanged.

## Project and database

Once organization project capacity is available, create the new project named **Offline Ludo** in `Shahdara Fiber Net`, region `ap-south-1`, at the previously confirmed `$0/month` quote. Do not modify the two existing projects. Then replace only the URL and **publishable** key in `www/js/supabase-config.js`; never put a `service_role` or secret key in frontend code.

Apply `supabase/migrations/20261003213000_online_backend.sql` to the new project, then verify that all seven tables have RLS enabled, the authenticated role has only the required reads/profile-name update and RPC permissions, and the service-only currency/match functions remain unavailable to `anon` and `authenticated`. The `post_currency_transaction` function is atomic, non-negative and idempotent, but there is intentionally no client-callable currency operation. A trusted server must validate the game result and invoke privileged functions before any online reward or spend flow can exist.

## Auth URLs and credentials

The project's exact Supabase provider callback cannot be known until the new project has a project reference. Google and Facebook each use the callback shown in Supabase Authentication → Providers, with this documented form:

`https://<new-project-ref>.supabase.co/auth/v1/callback`

Add the production app return URL below to Supabase Auth → URL Configuration (site URL/allow list):

- `https://offerpk.github.io/offline-ludo/`
- `https://offerpk.github.io/offline-ludo/**` (for path-based redirects)
- `http://localhost:8080/` and `http://localhost:8080/**` for local testing
- `com.offerpk.offlineludo://auth-callback` for Android OAuth return

The Android scheme/host is already registered in `AndroidManifest.xml`; Capacitor App and Browser plugins handle the system-browser OAuth return. The browser bundle uses the same web redirect base, and the online page preserves an invite code through login.

Required provider-held credentials (enter them in the provider/Supabase dashboards or a secure credential form, not a source file or ordinary chat):

- **Google:** OAuth Web Client ID and client secret; authorize `https://offerpk.github.io` and `http://localhost:8080` as JavaScript origins; add the Supabase callback above as an Authorized redirect URI. Enable Google in Supabase Auth and request `openid`, `email` and `profile`.
- **Facebook:** Meta App ID and App Secret; enable Facebook Login and the `public_profile` and `email` permissions; add the same Supabase callback URI to Valid OAuth Redirect URIs; enable Facebook in Supabase Auth. Facebook test users need the appropriate app role while the app is in development mode.

Google provider setup: [Supabase Google OAuth guide](https://supabase.com/docs/guides/auth/social-login/auth-google). Facebook provider setup: [Supabase Facebook OAuth guide](https://supabase.com/docs/guides/auth/social-login/auth-facebook). Redirect allow-list behavior: [Supabase redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls). Android return handling follows [Supabase native deep-link guidance](https://supabase.com/docs/guides/auth/native-mobile-deep-linking).

## Security boundary and unfinished gameplay work

The client can read only its own wallet/ledger, update only its own display name, and call validated room-lobby RPCs. It cannot insert/update wallets, post ledger entries, directly change room membership/readiness/status or finalize results. Room records and realtime events are member-scoped by RLS. The 16-character invite token is only readable by current room members and is exchanged through the join RPC.

To ship actual online competition, add a trusted match runtime that runs the Ludo rules authoritatively (or verifies a deterministic move/event history), streams accepted state to participants, finalizes match results and only then posts any configured coin/diamond transaction. Decide the economy/rewards before adding a trusted award path; this branch does not invent rates. The existing client-side offline coin balance must not be uploaded as an initial cloud balance because it is user-editable local state.
