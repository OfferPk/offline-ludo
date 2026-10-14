# Save-write audit (v1.8.8)

Goal: make sure the #109 stale-tab guard can only block real conflicts (another tab or window changed the save), never a legitimate save from this page.

Findings:
- There is exactly one `SaveStore.create(...)` (in `game.js`). Every write to `crossfour.save.v3` and its checkpoint goes through `persist()` → `saveStore.save()`, `saveStore.reset()` or `saveStore.importSnapshot()` (backup restore, #49). Each of these updates the guard's last-seen value after it writes.
- The only other `localStorage` writes are the tutorial flag (`crossfour.tutorial.v1`) and its removal on reset. These are separate keys, and the guard ignores them.
- Online code only uses `sessionStorage` (room / invite state), which is separate from the save.
- No module writes the save keys directly (Daily, Vault/skins, evolution, progression rewards, Championship and wager all mutate `save` and call `persist()`).
- Found and fixed: a bad merge while porting #118 had duplicated the whole `<script>` block in `index.html`, so every script, including `game.js`, loaded twice. The audit test now fails if any script is listed twice.

Enforced by `test/save-write-audit.test.js` (in `npm test`).
