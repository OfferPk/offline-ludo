# Privacy Policy – Online Ludo

_Last updated: October 7, 2026_

Online Ludo ("the app") is developed by **OfferPk**. This policy explains what information is handled when you use the app on Android or play the web version.

## Information we collect

Offline play does not require an account or a network connection. Your local match, settings, offline coins, unlocked cosmetics and recovery checkpoint remain on your device and are not uploaded by the offline save system. Existing offline coins are not automatically copied into an online wallet.

The optional online account and match service uses email/password authentication through Supabase Auth. When you sign in or create an account, the email address and password you enter are sent to Supabase Auth for authentication; the app does not hardcode the address or save the raw password in local game data. The app can then store an online display name and generated player handle, server-side coin and diamond balances, room membership/readiness, invite-room records, match-history status and (for Online Classic rooms) shared token positions, server-generated dice outcomes and validated moves. Online Ludo Chess rooms also store the shared chess-board position and server-validated moves and game-state changes. Those match details are visible to authenticated participants in that room. Balances and currency transaction history are restricted to the account owner. Email confirmation is disabled, so new email/password accounts are confirmed and signed in immediately without a confirmation link or OTP. Gmail SMTP remains configured for password-reset emails, but reset delivery has not yet been live-tested. Supabase Auth currently limits email to 2 messages per hour and a 60-second per-user resend interval. Mystery and Lucky Chaos remain offline-only in this slice. The app has no client-callable way to create or spend online currency. Do not treat local coins and online balances as interchangeable.

When online sign-in is used, account and match data is transmitted to the Supabase-hosted backend selected for the project. Supabase processes connection data such as IP address as part of providing the service and applies its own privacy and security terms: <https://supabase.com/privacy>. You can continue to play offline without signing in. No analytics service is added by online play.

Coins and diamonds are virtual, non-purchasable and non-transferable in this implementation; they cannot be bought, sold, bet, wagered or exchanged for money. The local quick-chat phrases and emoji remain on-device and are not sent to other players.

## Advertising (Google AdMob)

The Android app shows ads using **Google AdMob** (Google Mobile Ads SDK), a service provided by Google LLC. To serve and measure ads (including personalized ads, where you have consented), and for analytics and fraud prevention, the SDK automatically collects and shares with Google:

- your device's **IP address**, which may be used to estimate the general (approximate) location of the device,
- **device and account identifiers** such as the Android advertising ID and app set ID,
- **product interaction** information (for example app launches, taps and ad/video views), and
- **diagnostic** information (for example app launch time, hang rate and energy usage).

This data is encrypted in transit and is processed by Google under Google's own policies, not by us:

- Google Privacy Policy: <https://policies.google.com/privacy>
- How Google uses information from sites or apps that use its services: <https://policies.google.com/technologies/partner-sites>
- Google Mobile Ads SDK data disclosure: <https://developers.google.com/admob/android/privacy/play-data-disclosure>

Users in the EEA, UK and Switzerland (and other regions where it is required) are asked for consent through Google's **User Messaging Platform (UMP)** consent message before personalized ads are shown. You can change your choice at any time from **Settings → Ad privacy options** in the app (shown where applicable). You can also reset or delete your advertising ID, or opt out of personalized ads, in **Android Settings → Google → Ads** (or **Settings → Privacy → Ads** on newer devices).

The web version at offerpk.github.io does not show ads. The optional Supabase Auth client stores a sign-in session in browser/app storage when you sign in. Password fields are cleared after submission and passwords are not written to local game saves; without signing in, the online feature is not used.

## Haptics

The app may use your device's vibration motor for light haptic feedback (Android `VIBRATE` permission). No data is collected for this, and you can turn it off in Settings.

## Children

The app is a general-audience board game intended for users aged 13 and over and is **not directed at children under 13**. We do not knowingly collect personal information from children.

## Security

Online account data is protected by database row-level access controls. Currency balances cannot be changed directly by the app client; trusted server-side operations are required for transactions. Never share your password or an email-confirmation/password-reset link with another player.

## Changes

We may update this policy from time to time. Changes will be posted on this page with a new "Last updated" date.

## Contact

Questions about this policy? Open an issue at <https://github.com/OfferPk/offline-ludo/issues>.
