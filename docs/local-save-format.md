# Local save format and recovery

Crossfour saves all gameplay and profile data on the device. The storage code is isolated in `www/js/save-store.js`; it does not make network requests and exposes no account, synchronization, or network-play behavior. A future remote feature would need a separate, explicit product decision and would not be implied by this storage boundary.

## Current format

The primary key is `crossfour.save.v3`. Its JSON value is a validated snapshot envelope:

```json
{
  "schemaVersion": 3,
  "savedAt": 1700000000000,
  "payload": {
    "coins": 0,
    "xp": 0,
    "settings": {},
    "stats": {},
    "game": null
  }
}
```

The `payload` is the app's local save model: cosmetics and progression, setup and house rules, preferences, local ad-pacing state, and—when a match is active—the complete LudoLogic state including its serializable RNG state. The boundary receives and returns plain serializable objects, keeping storage mechanics separate from game rules.

Before replacing the primary key, the store writes the last validated snapshot to `crossfour.save.checkpoint.v3`. If the primary is corrupt or fails validation, a valid checkpoint is used and the app explains that recent moves may be missing. The app warns when a write fails; it does not silently claim that the latest move was saved. A future/unknown schema is treated read-only rather than overwritten by an older client.

## Migrations

- `crossfour.save.v2`: the existing flat v2 save is normalized into the current model. Valid active-match state, RNG, profile/progression, settings, house rules, statistics, and ad pacing are retained. The old key is left in place after migration.
- `crossfour.save.v1`: compatible profile/progression, cosmetics, settings, statistics, ad pacing, and legacy house-rule choices are retained. The old match format is not resumed because it is not compatible with the current LudoLogic state schema. The old key is left in place.

Legacy values are normalized against current defaults, while invalid current-format snapshots are rejected as candidates so recovery can try the checkpoint or another legacy save. After the in-app confirmation, Reset progress replaces the primary snapshot and clears its checkpoint plus v1/v2 legacy keys so erased progress cannot be resurrected; the existing ad-pacing state remains intact. Clearing the app's device data removes all local data, including ad pacing.

## Verification

`node test/save-store.test.js` checks migration, validation, corruption, failed writes, checkpoint recovery, future-version safety, and deterministic RNG continuation. `test/browser.test.js` additionally exercises v1/v2 migration, a simulated storage quota failure and warning, and a real phone-size browser reload/resume flow.
