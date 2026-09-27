# Crossfour: Offline Ludo — Rules (v1.1)

The same rules are shown in the game (**Rules** on the home screen or in the match menu). The rules engine is
`www/js/logic.js` and every rule below is covered by `test/logic.test.js`.

These rules follow standard Ludo (Pachisi family): 4 tokens per player, 6 to leave base, a 52-square
shared track, a private 5-square home column and an exact roll to finish. Crossfour then adds the
"stacked sixes" roll system that popular modern Ludo apps use, as the default house rule.

## Basics

- 2–4 players (1 v 1 uses opposite corners). Each player has 4 tokens in their base.
- Each player rolls **their own die**, shown next to their name in their own corner of the board.
- A token leaves base only on a **6**, onto its own start square.
- Tokens move clockwise round the track, then up their own coloured home column to the centre.
- A token needs the **exact** number to reach home. A roll that would overshoot can't be used by that token.
- Landing on a single rival token **captures** it: it goes back to its base.
- **Safe squares** (house rule, on by default): the 4 start squares and the 4 star squares. Nobody is captured there, and tokens of different colours can share them.
- The first player to bring all 4 tokens home wins. The rest are ranked 2nd, 3rd and 4th (by finishing order, then by progress). A match vs the computer ends once every human has finished.

## Rolls — Star style (default)

1. Roll the die. A **6** gives another roll straight away. The rolls are kept as **dice chips** in your corner (for example **6, 6, 3**).
2. After the first roll that is not a 6, you spend the chips: tap a chip, then tap a token. Each chip moves one token by its value, in any order you like. If only one move is possible it is played for you (auto-move, can be switched off).
3. **Three 6s in a row forfeit the whole turn**: all chips of that turn are lost and no token moves.
4. **Bonus rolls:** capturing a rival token gives one more roll; bringing a token home gives one more roll.
5. Chips that no token can use are discarded ("No move possible").

## Rolls — Classic (house rule)

Every roll is moved before the next roll. A 6 still gives another roll after you move it, three 6s in a
row still forfeit the turn, and capture/home bonuses still apply.

## House rules (Settings → House rules)

| Rule | Default | Effect |
|---|---|---|
| Roll style | **Star style** | Star style (stack 6s) or Classic (move each 6 first) |
| Safe squares | On | Start + star squares are safe |
| Capture to enter home | Off | A player must capture at least one rival token before their tokens may enter the home column; until then they keep circling the board |
| Blocks | Off | Two tokens of the same colour on one track square form a block: rivals can't pass it, land on it or capture it |
| Bonus roll on capture | On | |
| Bonus roll on reaching home | On | |

House rules apply from the next new match.

## Undo dice roll

After you roll, the **Undo** button is live for about 2 seconds: tap it to take the roll back and roll
again (earlier chips of the same turn are kept). Each match gives **3 free undos**; after that an extra
undo is available only if **you** tap it and choose to watch an optional rewarded ad. Undo can be turned
off in Settings. Undo is only offered for human rolls.

## Turn timer (optional)

Off by default. When on, a human player has 20 seconds per decision (a ring drains round their avatar);
when it runs out, a sensible move is played for them.

## Mystery Tiles mode

A separate mode (1 v 1 or 3–4 players). Everything above still applies, plus 8 mystery tiles on the track:

- **?** tiles (4) spin the **Boost wheel** — always helpful.
- **!** tiles (4) spin the **Chaos wheel** — a mix of good and bad.

A tile triggers when your token **ends its move** on it. The wheel only lands on events that can actually
happen at that moment. A used tile recharges for two full rounds (it is dimmed meanwhile). Mystery tiles
are never on start or star squares.

**Boost wheel (?)**

| Event | Effect |
|---|---|
| Shield | This token can't be captured (or zapped/swapped) until the end of your next turn |
| Jump +3 | This token jumps 3 squares forward (can capture) |
| Extra roll | You get one more roll this turn |
| Double die | Your next roll counts double (2–12) |
| Pick a number | Your next roll: you choose any number 1–6 |
| Freeze | The nearest rival token up to 12 squares ahead can't move during its owner's next turn |

**Chaos wheel (!)**

| Event | Effect |
|---|---|
| Back 3 | This token slides 3 squares back |
| Swap | This token swaps places with the nearest rival token (not shielded, not in a block, not in a home column) |
| Zap | The nearest rival token within 3 squares goes back to base — not on a safe square, not shielded |
| Stuck | This token can't move during your next turn |
| Jump +6 | This token jumps 6 squares forward |
| Calm | Nothing happens |

There is **no entry fee, stake or bet** in Mystery Tiles (or anywhere in the game). Finishing any match
awards cosmetic coins and XP; coins only unlock board and dice skins and can't be bought or cashed out.

## Computer players

- **Easy:** mostly random, sometimes takes an obvious capture or finish.
- **Normal:** simple priorities: capture, finish, leave base, safety, progress.
- **Hard:** scores every move: captures (worth more the further the victim travelled), getting home,
  safe squares, avoiding squares rivals can hit next roll (counting stacked 6s), escaping threats,
  building/keeping blocks when blocks are on, and the value of mystery tiles and events.

In simulated 1 v 1 games (test suite) Hard beats Easy about 93% of the time and Normal about 87%.
