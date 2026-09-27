/*
 * ============================================================
 *  AdMob CONFIGURATION  -  the ONE place to change ad unit IDs
 * ============================================================
 * These are Google's official TEST IDs. They always serve test ads and are
 * safe while developing. Before publishing to Google Play:
 *   1. Create an app + 3 ad units (banner, interstitial, rewarded) at https://apps.admob.com
 *   2. Replace APP_ID / BANNER_ID / INTERSTITIAL_ID / REWARDED_ID below
 *   3. Replace the App ID in android/app/src/main/AndroidManifest.xml
 *      (<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" .../>)
 *   4. Set IS_TESTING to false
 * Never click your own live ads.
 */
window.ADS_CONFIG = {
  APP_ID: 'ca-app-pub-3940256099942544~3347511713', // must match AndroidManifest.xml
  BANNER_ID: 'ca-app-pub-3940256099942544/6300978111',
  INTERSTITIAL_ID: 'ca-app-pub-3940256099942544/1033173712',
  REWARDED_ID: 'ca-app-pub-3940256099942544/5224354917',
  IS_TESTING: true,

  // Interstitial pacing (enforced by js/adgate.js, unit-tested in test/adgate.test.js)
  INTERSTITIAL_MIN_SESSIONS: 2,           // never in the first session (first app launch) ...
  INTERSTITIAL_MIN_MATCHES: 5,            // ... never before 5 completed matches ...
  INTERSTITIAL_MIN_PLAY_MS: 3 * 60000,    // ... AND at least 3 minutes of total play
  INTERSTITIAL_EVERY_N_MATCHES: 2,        // then at most one every 2 completed matches
  INTERSTITIAL_MIN_INTERVAL_MS: 120000    // and at most one per 120 s (after a match only)
};
