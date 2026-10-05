# Crossfour: Offline Ludo — Rules (v1.4)

The same rules are shown in the game (**Rules** on the home screen or in the match menu). The rules engine is
`www/js/logic.js` and every rule below is covered by `test/logic.test.js`, `test/lucky.test.js` and `test/modes13.test.js`.

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

## Tokens

Each of a seat's four tokens is numbered **1–4** on the token body so you can tell them apart. Tokens also
carry a soft firefly-style (jugnu) glow that slowly pulses — cosmetic only.

## Decision countdown (offline)

Offline vs AI and Pass & Play human seats get a **4-second** move countdown (4…3…2…1). If you do not
act, Crossfour auto-plays the best move: prefer a capture with either stacked die, else open from the
yard with a 6 when possible, else the hard AI heuristic. Online Classic keeps its own 45 s server clock.

When you have stacked rolls (e.g. 6 and 4) and tap a token that can use more than one of them, a
premium die-number picker appears on that token so you can choose which number to apply. Only legal
options for that token are shown.

## Turn timer (optional)

Off by default. When on, a human player has 20 seconds per decision (a ring drains round their avatar);
when it runs out, a sensible move is played for them. The 4-second offline countdown above still applies.

## Online Classic

Online Classic uses the same canvas board as a local game. The text token list is not the board.

The host's house rules (the Settings toggles: roll style, safe squares, capture to enter home, blocks, bonus on capture, bonus on reaching home, arrow tiles, no captures) are stored when the room is created. Everyone in that room plays those rules. They do not change mid-match.

A token leaves base only on a 6, needs the exact roll to enter home, and captures on an unsafe square unless no-capture is locked on. Star style stacks 6s; three 6s forfeit the turn. A capture or a token reaching home can give an extra roll when those toggles are on.

Each turn shows a 45 second timer. If it runs out, the turn passes. A dropped player has 20 seconds to rejoin the same seat. Nobody is replaced by the computer. If the seat is not back in time it is dropped, and the match is abandoned when fewer than two players remain.

Rooms, quick match and invites stay. Mystery Tiles, Lucky Chaos and Ludo Chess rules are unchanged. Ludo Chess still has its own board.

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

## Lucky Chaos Ludo mode (new in v1.2)

A third mode, added at the player's request under the name **Lucky Chaos Ludo**. It keeps normal Ludo
(Star-style rolls and your house rules: 6 to leave base, exact roll home, captures, safe squares) and adds
luck you can steer. 1 v 1 or 3–4 players, vs computer (Easy / Normal / Hard) or pass & play.
Tap **How to play** in the mode setup (or **Rules → Lucky** in the game) for the short version.

### Special tiles (12, always in the same places)

| Tile | Where | What it does |
|---|---|---|
| **?** Boost tile (4) | 4 squares after each start square | Spin the **Boost wheel** |
| **!** Chaos tile (4) | 10 squares after each start square | Spin the **Chaos wheel** |
| **!!** Danger tile (4), labelled **High Risk / High Reward** | 6 squares after each start square (yellow/black stripes) | 50/50: Boost **or** Chaos wheel, with **stronger** results |

A tile triggers only when a token **ends its move exactly** on it. It then rests for **2 rounds**
(dimmed, with a small number showing the rounds left). The wheels only land on results that can
actually happen at that moment.

### Boost wheel (?)

| Result | Effect | On a Danger tile |
|---|---|---|
| Shield | This token can't be captured and ignores Chaos effects until the end of your next turn | – |
| Jump +3 | This token jumps 3 squares (can capture) | **Jump +5** |
| Double Roll | **Stored power**: use before a roll to make it count double | – |
| Extra Roll | One more roll this turn | **2 extra rolls** |
| Lucky 6 | **Stored power**: use instead of rolling to get a 6 (never counts toward three 6s) | – |
| Safe Escape | **Stored power**: your most threatened token dashes to the next safe square (up to 8 ahead) | – |

### Chaos wheel (!)

| Result | Effect | On a Danger tile |
|---|---|---|
| Bomb | Every other token within 2 squares (**yours too**) slides back 3. Never to base; safe squares, start squares, shields and Kings are immune | **Big Bomb**: radius 3 |
| Swap | **Your choice**: swap with the nearest rival token up to 12 squares ahead, or stay | – |
| Zap | The nearest rival within 3 squares goes back to base; a token 40+ squares along only slides back 6 | – |
| Freeze | The nearest rival token up to 12 squares ahead can't move on its owner's next turn | – |
| Back 3 | This token slides back 3 (never behind its start square) | **Back 5** |
| Wild Jump | A random 1–6 is drawn; **your choice**: jump that far or stay | – |

### Lucky Streak, Revenge, Lucky Charge and the Mega Wheel

- **Lucky Streak** (flame ×1–×3 under your name): +1 for each tile spin. A higher streak gives a chance
  (15% per level) of a second spin where the better result is kept. It resets when one of your tokens is captured.
- **Revenge Charge**: when one of your tokens is captured you get a Revenge Charge (shown under your name).
  Your next tile spin shows **two different results and you pick one**.
- **Lucky Charge** (5 pips): +1 per tile spin, +1 more on a Danger tile or when far behind, and never more
  than +2 from one spin (tiles charge at most once per turn); +1 for every capture. A ×3 streak no longer
  adds charge (it already improves the wheel). At **5/5** tap **MEGA** next to your die before a roll to
  spin the **Mega Wheel**. The meter then empties.

| Mega Wheel | Effect |
|---|---|
| Rocket | Your best token blasts up to 8 squares forward (can capture) |
| Free Token | A token leaves your base onto your start square |
| Royal Guard | All your tokens on the track get a Shield until the end of your next turn |
| Double Turn | Two extra rolls this turn |
| Storm | Rival tokens up to 6 squares behind your tokens slide back 3 (safe squares/shields/Kings immune) |
| Crown | Your most advanced token becomes King for 3 turns |

### King token

A token that captures **2 rival tokens** becomes **King** (gold crown) for **3 of its owner's turns** or until
it is captured or gets home. A King moves **+1 square** when that fits (and still lands exactly) and is
**immune to Chaos effects** (Bomb, Swap, Zap, Freeze, Storm). It can still be captured by a normal landing:
capturing a King adds **+2** Lucky Charge on top of the normal capture (3 in total from empty), not an instant Mega.

### Stored powers

Double Roll, Lucky 6 and Safe Escape are stored in your pod: **at most 2**, never two of the same (the wheel
skips a power you can't store). Tap one before a roll; one power per roll.

### Choices and fairness

- Swap, Wild Jump and Revenge open a **3-second decision window**. If time runs out the best option (marked
  "best") is picked for you. Computer players decide instantly.
- Nothing decides the winner by itself: tokens in the home lane are never touched, Bombs and Storms only push
  back 3 (never to base), Zap on a token 40+ squares along only slides it back 6, safe squares/shields/Kings are
  protected and Back 3 never goes behind the start square.
- **Comeback**: a player well behind the leader (15%+ / 30%+ of total progress) gets a slightly higher chance of
  a better wheel result, and at 30%+ an extra charge per tile spin (capped).

### Balance (simulated, test suite)

From `npm test` (1000 simulated games per setting, computer vs computer):

| | Lucky Chaos | Star (classic mode) |
|---|---|---|
| 1 v 1 Hard beats Easy | 89.8% | 91.9% |
| 1 v 1 Hard beats Normal | 70.9% | – |
| 1 v 1 Normal beats Easy | 82.2% | – |
| 4 players: one Hard vs three Easy wins (fair share 25%) | 77.7% | 78.5% |
| 4 players: one Hard vs three Normal / one Normal vs three Easy | 42.9% / 65.1% | – |
| Average 1 v 1 game | 152 rolls / 111 turns | 174 rolls / 137 turns |
| Average 4-player game | 445 rolls / 313 turns | 557 rolls / 427 turns |
| Leader at 50% progress still wins (1 v 1 / 4 players) | 67.0% / 56.7% | 65.7% / 58.1% |

About 7.0 Mega spins and 1.9 Kings per 1 v 1 game (22.5 and 9.6 in 4-player games), after capping one tile at +2 charge and making a King capture +2 rather than a full meter. Every simulated game
(1000 each with 2, 3 and 4 players, all levels and house-rule sets) finished with a winner.

There is **no entry fee, stake or bet** in Lucky Chaos Ludo (or anywhere in the game). The wheels only
change the board; they never award or cost coins. Finishing a match awards cosmetic coins and XP only.

## Quick, Team, Arrow and Friendly (new in v1.3)

Classic, Mystery Tiles and Lucky Chaos Ludo are unchanged. These modes use the same board and the same core rules
(6 to leave base, exact roll to reach home, safe squares unless you turn them off).

**Quick Ludo.** Two tokens per player instead of four, on the same 52-square track. 1 v 1 or more, vs computer or
pass & play. In 300 simulated 1 v 1 games the average was about 86 rolls (a 4-token 1 v 1 is about 170).

**Team Ludo (2v2).** All four corners play. Partners sit opposite: Coral with Saffron (team A), Jade with Cobalt
(team B). A team wins when **both** partners have every token home, and both partners share that win. You cannot
capture your partner, and a partner's block does not stop you. Pass & play, or you with a computer partner against
two computers, or four computers. An opponent who finishes their own tokens first does not win the match.

**Arrow Ludo.** Each player starts with **one token already on their start square**, so they can move on any roll without waiting for a 6 for that starter token (other tokens still need a 6 to leave base). Amber one-way arrows on board number 4 of each side (absolute squares 4, 17, 30 and 43 — one per side, symmetric). The **3 squares right after each arrow** (absolute 5–7, 18–20, 31–33 and 44–46) are painted **permanent red** as a danger zone: they are the squares an arrow jump passes through, so a rival token parked there can be captured by a jump. The colour is only a marker; it does not change any rule.

When a token’s move **ends exactly on** an arrow, it immediately **jumps exactly 4 squares forward** along the track and **stops** on that destination. Opponent tokens on the squares of that jump — and on the stop, if it is not a safe square — are **captured**. **Passing over** an arrow mid-move (for example rolling 5 or 6 when the arrow is only 4 ahead) is normal Ludo movement: no jump. The jump does **not** chain. If the jump cannot complete (would overshoot home, or a block is in the way), the token stays on the arrow. Safe squares (starts and stars) still protect as usual. The home column has no arrows. The same arrows are a house rule ("Arrow tiles") and use this jump when turned on for other modes.

**Friendly.** Captures are off: landing on a rival does nothing. It is a pure race home. The same switch is the
house rule "No captures". The app stays **13+** even in this mode.

Two extra board themes, **Midnight** (dark) and **Classic Wood**, are free. Coins stay cosmetic: there is no
coin shop for these themes and no purchases. The win screen shows how many token moves were played and how long
the match took. The selected token is highlighted, and the squares of the last move stay lit until the next move.
Haptics on the dice landing and on a capture follow the Haptics setting, which is on by default.

## Computer players

- **Easy:** mostly random, sometimes takes an obvious capture or finish.
- **Normal:** simple priorities: capture, finish, leave base, safety, progress.
- **Hard:** scores every move: captures (worth more the further the victim travelled), getting home,
  safe squares, avoiding squares rivals can hit next roll (counting stacked 6s), escaping threats,
  building/keeping blocks when blocks are on, and the value of mystery tiles and events.
- In **Lucky Chaos Ludo** Normal and Hard also value Boost/Chaos/Danger tiles, hunt Kings (a Mega charge),
  try to crown their own King, spin the Mega Wheel when it is full, use stored powers at sensible moments
  (Safe Escape when threatened, Lucky 6 with tokens in base, Double Roll mid-board) and pick the best option
  in choices. Easy uses them more randomly.

In simulated 1 v 1 games (test suite) Hard beats Easy about 93% of the time and Normal about 87%.
