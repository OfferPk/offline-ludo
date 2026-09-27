/*
 * Crossfour rules engine v2: pure Ludo logic (no DOM), shared by the game and the Node tests.
 *
 * Seats (clockwise): 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
 * A token's position p:
 *   -1      in base
 *   0..50   on the shared 52-square track (0 = its own start square)
 *   51      the square just behind its start (only used while circling: "capture to enter home" rule)
 *   52..56  its own home column
 *   57      home (finished)
 * Absolute track square of a token on the track = (p + 13 * seat) % 52.
 *
 * Roll styles:
 *   'star'    (default) a 6 gives another roll straight away; rolls stack in a queue (e.g. 6, 6, 3)
 *             and are spent after the first non-6, one value per token move, in any order.
 *   'classic' every roll is moved before the next one; a 6 gives another roll after moving.
 * Both: three 6s in a row forfeit the whole turn (the unused queue is lost), a capture and a token
 * reaching home each give a bonus roll (toggles), 6 to leave base, exact roll to reach home.
 *
 * Modes: 'classic' and 'mystery' (Mystery Tiles: ? and ! tiles on the track spin a wheel of events).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TRACK = 52, LAST_TRACK = 50, CIRCLE = 51, COL0 = 52, HOME = 57, PIECES = 4;
  var START_SQUARES = [0, 13, 26, 39];
  var STAR_SQUARES = [8, 21, 34, 47];
  var DEFAULT_RULES = { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true };
  var LEVELS = ['easy', 'medium', 'hard'];
  var MODES = ['classic', 'mystery'];
  var MAX_SIXES = 3;

  // Mystery Tiles: fixed tiles on the track (absolute squares, never a start or star square)
  var BOOST_TILES = [4, 17, 30, 43];   // "?" tiles: Boost wheel (always helpful)
  var CHAOS_TILES = [10, 23, 36, 49];  // "!" tiles: Chaos wheel (half good, half bad)
  var WHEELS = {
    boost: ['shield', 'jump3', 'extra', 'double', 'choose', 'freeze'],
    chaos: ['back3', 'swap', 'zap', 'frozen', 'jump6', 'calm']
  };
  var EVENT_INFO = {
    shield: { name: 'Shield', text: 'This token cannot be captured until the end of your next turn.', good: true },
    jump3: { name: 'Jump +3', text: 'This token jumps 3 squares forward.', good: true },
    extra: { name: 'Extra roll', text: 'You get one more roll this turn.', good: true },
    double: { name: 'Double die', text: 'Your next roll counts double.', good: true },
    choose: { name: 'Pick a number', text: 'Your next roll: choose any number from 1 to 6.', good: true },
    freeze: { name: 'Freeze', text: 'The nearest rival token ahead is frozen for its next turn.', good: true },
    back3: { name: 'Back 3', text: 'This token slides 3 squares back.', good: false },
    swap: { name: 'Swap', text: 'This token swaps places with the nearest rival token.', good: null },
    zap: { name: 'Zap', text: 'The nearest rival within 3 squares goes back to base (not on a safe square).', good: true },
    frozen: { name: 'Stuck', text: 'This token cannot move during your next turn.', good: false },
    jump6: { name: 'Jump +6', text: 'This token jumps 6 squares forward.', good: true },
    calm: { name: 'Calm', text: 'Nothing happens.', good: null }
  };

  // ---------- RNG (mulberry32 with serialisable state) ----------
  function rngNext(state) {
    state.rng = (state.rng + 0x6D2B79F5) >>> 0;
    var t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rollDie(state) { return 1 + Math.floor(rngNext(state) * 6); }

  // ---------- geometry (15 x 15 grid; [row, col]) ----------
  function rot(rc, times) { var r = rc[0], c = rc[1]; for (var k = 0; k < ((times % 4) + 4) % 4; k++) { var t = r; r = c; c = 14 - t; } return [r, c]; }
  var SEG = [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8]];
  var TRACK_CELLS = [];
  for (var q = 0; q < 4; q++) for (var j = 0; j < SEG.length; j++) TRACK_CELLS.push(rot(SEG[j], q));
  var HOME_COLS = [], BASE_SPOTS = [], HOME_SPOTS = [];
  for (var s = 0; s < 4; s++) {
    var col = []; for (var k = 1; k <= 5; k++) col.push(rot([7, k], s)); HOME_COLS.push(col);
    BASE_SPOTS.push([[1.9, 1.9], [1.9, 3.1], [3.1, 1.9], [3.1, 3.1]].map(function (p) { return rot(p, s); }));
    HOME_SPOTS.push([[6.55, 6.1], [7.45, 6.1], [6.1, 6.55], [7.9, 6.55]].map(function (p) { return rot(p, s); }));
  }
  /** Board cell ([row, col], may be fractional) for a token of `seat` at position p (token index i for base/home spots). */
  function cellOf(seat, p, i) {
    if (p < 0) return BASE_SPOTS[seat][i || 0];
    if (p <= CIRCLE) return TRACK_CELLS[(p + 13 * seat) % TRACK];
    if (p < HOME) return HOME_COLS[seat][p - COL0];
    return HOME_SPOTS[seat][i || 0];
  }
  function onTrack(p) { return p >= 0 && p <= CIRCLE; }
  function absOf(seat, p) { return (p + 13 * seat) % TRACK; }
  function posFromAbs(seat, a) { return ((a - 13 * seat) % TRACK + TRACK) % TRACK; }
  function isSafeAbs(a) { return START_SQUARES.indexOf(a) >= 0 || STAR_SQUARES.indexOf(a) >= 0; }
  /** Progress score used for ranking and AI (base 0 ... home 58). */
  function advance(p) { if (p < 0) return 0; if (p <= LAST_TRACK) return p + 1; if (p === CIRCLE) return 0.5; if (p < HOME) return p; return 58; }

  // ---------- setup ----------
  function normRules(rules) {
    var r = {};
    Object.keys(DEFAULT_RULES).forEach(function (k) {
      var v = rules && rules[k] != null ? rules[k] : DEFAULT_RULES[k];
      r[k] = k === 'rollStyle' ? (v === 'classic' ? 'classic' : 'star') : !!v;
    });
    return r;
  }
  /**
   * seats: array of 4 entries, each null (empty seat) or { type: 'human' | 'ai', level?: 'easy'|'medium'|'hard' }.
   * Needs at least 2 players. mode: 'classic' | 'mystery'.
   */
  function newGame(seats, rules, seed, mode) {
    var players = [];
    for (var i = 0; i < 4; i++) if (seats[i]) players.push(i);
    if (players.length < 2) throw new Error('need at least 2 players');
    var md = MODES.indexOf(mode) >= 0 ? mode : 'classic';
    var st = {
      v: 2,
      mode: md,
      seats: seats.map(function (x) { return x ? { type: x.type === 'ai' ? 'ai' : 'human', level: LEVELS.indexOf(x.level) >= 0 ? x.level : 'medium' } : null; }),
      players: players,
      pieces: seats.map(function (x) { return x ? [-1, -1, -1, -1] : null; }),
      rules: normRules(rules),
      turn: players[0],
      phase: 'roll',        // 'roll' | 'move' | 'over'
      queue: [],            // die values waiting to be moved
      sixes: 0,             // consecutive 6s this turn
      rollAgain: false,     // classic style: roll again after moving a 6
      bonus: 0,             // bonus rolls earned (capture / home / event), taken after the queue
      moves: [],
      faces: [1, 1, 1, 1],  // last raw die face per seat (for the per-player dice)
      ranking: [],          // seats in finishing order
      capd: [false, false, false, false], // has captured at least once (capture-to-enter rule)
      boost: [null, null, null, null],    // 'double' | 'choose' for the seat's next roll
      effects: [],          // { type: 'shield' | 'freeze', seat, piece, at }
      tiles: md === 'mystery' ? BOOST_TILES.map(function (a) { return { abs: a, kind: 'boost', until: 0 }; }).concat(CHAOS_TILES.map(function (a) { return { abs: a, kind: 'chaos', until: 0 }; })) : [],
      stats: seats.map(function (x) { return x ? { captures: 0, captured: 0, sixes: 0, home: 0, rolls: 0, events: 0 } : null; }),
      rolls: 0, turnCount: 0,
      rng: (seed >>> 0) || 1,
      last: null
    };
    return st;
  }

  function canEnter(st, seat) { return !st.rules.captureToEnter || st.capd[seat]; }
  function hasEffect(st, type, seat, piece) { for (var i = 0; i < st.effects.length; i++) { var e = st.effects[i]; if (e.type === type && e.seat === seat && e.piece === piece) return true; } return false; }
  function isShielded(st, seat, piece) { return hasEffect(st, 'shield', seat, piece); }
  function isFrozen(st, seat, piece) { return hasEffect(st, 'freeze', seat, piece); }
  function clearEffects(st, seat, piece) { st.effects = st.effects.filter(function (e) { return !(e.seat === seat && e.piece === piece); }); }

  function tokensAt(st, abs, exceptSeat) {
    var out = [];
    for (var s = 0; s < 4; s++) {
      if (!st.pieces[s] || s === exceptSeat) continue;
      for (var i = 0; i < PIECES; i++) { var p = st.pieces[s][i]; if (onTrack(p) && absOf(s, p) === abs) out.push({ seat: s, piece: i }); }
    }
    return out;
  }
  function countOwnAt(st, seat, abs) { var n = 0; for (var i = 0; i < PIECES; i++) { var p = st.pieces[seat][i]; if (onTrack(p) && absOf(seat, p) === abs) n++; } return n; }
  /** Is there a block of another seat on track square abs (blocks rule on, 2+ tokens of one colour)? */
  function opponentBlockAt(st, seat, abs) {
    if (!st.rules.blocks) return false;
    for (var o = 0; o < 4; o++) if (st.pieces[o] && o !== seat && countOwnAt(st, o, abs) >= 2) return true;
    return false;
  }
  function inBlock(st, seat, piece) {
    var p = st.pieces[seat][piece];
    return st.rules.blocks && onTrack(p) && countOwnAt(st, seat, absOf(seat, p)) >= 2;
  }
  /** Tokens that would be captured by `seat` landing on track square abs. */
  function capturesAt(st, seat, abs) {
    if (st.rules.safeSquares && isSafeAbs(abs)) return [];
    return tokensAt(st, abs, seat).filter(function (t) { return !isShielded(st, t.seat, t.piece); });
  }

  function stepFwd(p, enter) {
    if (p < 0 || p >= HOME) return null;
    if (p < LAST_TRACK) return p + 1;
    if (p === LAST_TRACK) return enter ? COL0 : CIRCLE;
    if (p === CIRCLE) return 0;
    return p + 1;
  }
  /** Squares visited moving `n` forward from p (null if it would overshoot home). */
  function pathOf(p, n, enter) {
    var out = [], c = p;
    for (var k = 0; k < n; k++) { c = stepFwd(c, enter); if (c === null) return null; out.push(c); }
    return out;
  }

  /** Legal move for token `piece` of `seat` with die value v (or null). */
  function moveFor(st, seat, piece, v) {
    var p = st.pieces[seat][piece], path, to;
    if (p === HOME || isFrozen(st, seat, piece)) return null;
    if (p < 0) { if (v !== 6) return null; path = [0]; }
    else { path = pathOf(p, v, canEnter(st, seat)); if (!path) return null; } // exact roll needed to reach home
    to = path[path.length - 1];
    for (var k = 0; k < path.length; k++) if (onTrack(path[k]) && opponentBlockAt(st, seat, absOf(seat, path[k]))) return null; // blocks can't be passed or landed on
    var caps = onTrack(to) ? capturesAt(st, seat, absOf(seat, to)) : [];
    var tile = tileAt(st, to, seat);
    return { seat: seat, piece: piece, v: v, from: p, to: to, path: path, captures: caps, leave: p < 0, finish: to === HOME,
      entersHomeColumn: p <= CIRCLE && to >= COL0 && to < HOME, tile: tile ? tile.kind : null };
  }
  /** Legal moves for `seat` with die value v. */
  function legalMoves(st, seat, v) {
    var out = [];
    if (!st.pieces[seat]) return out;
    for (var i = 0; i < PIECES; i++) { var m = moveFor(st, seat, i, v); if (m) out.push(m); }
    return out;
  }
  /** All legal moves for the current player, one per (distinct queue value, token). */
  function queueMoves(st) {
    var seen = {}, out = [];
    st.queue.forEach(function (v) { if (seen[v]) return; seen[v] = 1; out = out.concat(legalMoves(st, st.turn, v)); });
    return out;
  }
  function tileAt(st, p, seat) {
    if (st.mode !== 'mystery' || !onTrack(p)) return null;
    var a = absOf(seat, p);
    for (var i = 0; i < st.tiles.length; i++) if (st.tiles[i].abs === a && st.turnCount >= st.tiles[i].until) return st.tiles[i];
    return null;
  }

  function activeLeft(st) { return st.players.filter(function (s) { return st.ranking.indexOf(s) < 0; }); }
  function hasHuman(st) { return st.players.some(function (s) { return st.seats[s].type === 'human'; }); }
  function progressOf(st, s) { return st.pieces[s].reduce(function (a, p) { return a + advance(p); }, 0); }

  /** Is the match over? Ends when one player is left, or when every human has finished (the rest are ranked by progress). */
  function checkOver(st) {
    var left = activeLeft(st);
    var humansLeft = left.filter(function (s) { return st.seats[s].type === 'human'; }).length;
    if (left.length <= 1 || (hasHuman(st) && humansLeft === 0)) {
      left.sort(function (a, b) { return progressOf(st, b) - progressOf(st, a); }).forEach(function (s) { st.ranking.push(s); });
      st.phase = 'over'; st.moves = []; st.queue = [];
      return true;
    }
    return false;
  }

  function nextTurn(st) {
    var out = st.turn;
    // shields / freezes last until the end of the owner's next turn
    st.effects = st.effects.filter(function (e) { return !(e.seat === out && st.turnCount > e.at); });
    st.sixes = 0; st.queue = []; st.moves = []; st.bonus = 0; st.rollAgain = false; st.turnCount++;
    if (checkOver(st)) return;
    var idx = st.players.indexOf(out);
    for (var k = 1; k <= st.players.length; k++) {
      var s = st.players[(idx + k) % st.players.length];
      if (st.ranking.indexOf(s) < 0) { st.turn = s; break; }
    }
    st.phase = 'roll';
  }
  /** Queue spent (or unusable): roll again for a classic 6, then bonus rolls, else the turn passes. */
  function afterQueue(st) {
    st.queue = []; st.moves = [];
    if (st.rollAgain) { st.rollAgain = false; st.phase = 'roll'; return 'again'; }
    if (st.bonus > 0) { st.bonus--; st.sixes = 0; st.phase = 'roll'; return 'bonus'; }
    nextTurn(st);
    return 'pass';
  }
  function resolveQueue(st) {
    st.moves = queueMoves(st);
    if (st.moves.length) { st.phase = 'move'; return 'move'; }
    return afterQueue(st);
  }

  /** Does the current player have to pick the value of the next roll (Pick a number event)? */
  function mustChoose(st) { return st.phase === 'roll' && st.boost[st.turn] === 'choose'; }

  /**
   * Roll the die for the current player (value optional, for tests / replays / the Pick-a-number event).
   * Returns { raw, value, forfeit, again, next } where next is 'roll' | 'move' | 'again' | 'bonus' | 'pass'.
   */
  function roll(st, value) {
    if (st.phase !== 'roll') throw new Error('not in roll phase');
    var seat = st.turn, boost = st.boost[seat];
    if (boost === 'choose' && !value) value = chooseDieValue(st, seat, 'hard');
    var raw = value || rollDie(st), v = raw;
    if (boost === 'double') v = raw * 2;
    st.boost[seat] = null;
    st.faces[seat] = raw; st.rolls++; st.stats[seat].rolls++;
    if (raw === 6) { st.stats[seat].sixes++; st.sixes++; }
    var res = { seat: seat, raw: raw, value: v, doubled: boost === 'double', chosen: boost === 'choose', forfeit: false, again: false, next: null };
    if (raw === 6 && st.sixes >= MAX_SIXES) {
      st.last = { type: 'forfeit', seat: seat, lost: st.queue.slice() };
      res.forfeit = true; res.lost = st.queue.slice();
      nextTurn(st); res.next = 'pass';
      return res;
    }
    st.queue.push(v);
    if (st.rules.rollStyle === 'star') {
      if (raw === 6) { res.again = true; res.next = 'roll'; st.last = { type: 'six', seat: seat }; return res; }
      res.next = resolveQueue(st);
    } else {
      st.rollAgain = raw === 6;
      res.again = raw === 6;
      res.next = resolveQueue(st);
    }
    if (res.next !== 'move') st.last = { type: 'nomove', seat: seat, value: v };
    return res;
  }

  function removeQueueValue(st, v) { var i = st.queue.indexOf(v); if (i >= 0) st.queue.splice(i, 1); }
  function sendHome(st, byseat, t) {
    st.pieces[t.seat][t.piece] = -1; clearEffects(st, t.seat, t.piece);
    if (byseat != null) { st.stats[byseat].captures++; st.stats[t.seat].captured++; st.capd[byseat] = true; }
  }

  // ---------- Mystery Tiles events ----------
  function nearestRival(st, seat, abs, maxD, dir, filter) {
    var best = null, bd = Infinity;
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat || st.ranking.indexOf(o) >= 0) continue;
      for (var i = 0; i < PIECES; i++) {
        var p = st.pieces[o][i]; if (!onTrack(p)) continue;
        var a = absOf(o, p), fwd = (a - abs + TRACK) % TRACK, back = (abs - a + TRACK) % TRACK;
        var d = dir > 0 ? fwd : dir < 0 ? back : Math.min(fwd, back);
        if (d === 0 || d > maxD) continue;
        var t = { seat: o, piece: i, abs: a, d: d };
        if (filter && !filter(t)) continue;
        if (d < bd || (d === bd && fwd < (best ? (best.abs - abs + TRACK) % TRACK : Infinity))) { bd = d; best = t; }
      }
    }
    return best;
  }
  function eventTarget(st, ev, seat, piece) {
    var p = st.pieces[seat][piece], abs = absOf(seat, p);
    if (ev === 'freeze') return nearestRival(st, seat, abs, 12, 1, function (t) { return !isFrozen(st, t.seat, t.piece); });
    if (ev === 'zap') return nearestRival(st, seat, abs, 3, 0, function (t) { return !(st.rules.safeSquares && isSafeAbs(t.abs)) && !isShielded(st, t.seat, t.piece) && !inBlock(st, t.seat, t.piece); });
    if (ev === 'swap') return nearestRival(st, seat, abs, 26, 0, function (t) {
      return !isShielded(st, t.seat, t.piece) && !inBlock(st, t.seat, t.piece) && posFromAbs(seat, t.abs) <= LAST_TRACK && posFromAbs(t.seat, abs) <= LAST_TRACK && st.pieces[t.seat][t.piece] <= LAST_TRACK;
    });
    return null;
  }
  function jumpDest(st, seat, piece, n) {
    var p = st.pieces[seat][piece], path = [], c = p, enter = canEnter(st, seat);
    for (var k = 0; k < n; k++) { var nx = stepFwd(c, enter); if (nx === null) break; path.push(nx); c = nx; }
    while (path.length && onTrack(path[path.length - 1]) && opponentBlockAt(st, seat, absOf(seat, path[path.length - 1]))) path.pop();
    return path;
  }
  function eventValid(st, ev, seat, piece) {
    if (ev === 'freeze' || ev === 'zap' || ev === 'swap') return !!eventTarget(st, ev, seat, piece);
    if (ev === 'jump3') return jumpDest(st, seat, piece, 3).length > 0;
    if (ev === 'jump6') return jumpDest(st, seat, piece, 6).length > 0;
    if (ev === 'back3') return st.pieces[seat][piece] > 0;
    if (ev === 'shield') return !isShielded(st, seat, piece);
    return true;
  }
  /**
   * Spin the wheel of `tile` for token (seat, piece) and apply the event (ev may be forced for tests).
   * Returns { tile, kind, event, wheel, index, target, from, to, path, captures, finish }.
   */
  function applyEvent(st, tile, seat, piece, forced) {
    var wheel = WHEELS[tile.kind];
    var valid = wheel.filter(function (e) { return eventValid(st, e, seat, piece); });
    var ev = forced && valid.indexOf(forced) >= 0 ? forced : valid[Math.floor(rngNext(st) * valid.length)];
    tile.until = st.turnCount + 2 * activeLeft(st).length; // tile recharges after two full rounds
    st.stats[seat].events++;
    var p = st.pieces[seat][piece];
    var out = { tile: tile.abs, kind: tile.kind, event: ev, wheel: wheel, index: wheel.indexOf(ev), seat: seat, piece: piece, from: p, to: p, path: [], captures: [], finish: false, target: null };
    var t;
    switch (ev) {
      case 'shield': st.effects.push({ type: 'shield', seat: seat, piece: piece, at: st.turnCount }); break;
      case 'extra': st.bonus++; break;
      case 'double': st.boost[seat] = 'double'; break;
      case 'choose': st.boost[seat] = 'choose'; break;
      case 'frozen': st.effects.push({ type: 'freeze', seat: seat, piece: piece, at: st.turnCount }); break;
      case 'freeze':
        t = eventTarget(st, 'freeze', seat, piece); out.target = { seat: t.seat, piece: t.piece };
        st.effects.push({ type: 'freeze', seat: t.seat, piece: t.piece, at: st.turnCount }); break;
      case 'zap':
        t = eventTarget(st, 'zap', seat, piece); out.target = { seat: t.seat, piece: t.piece, from: st.pieces[t.seat][t.piece] };
        sendHome(st, seat, t); break;
      case 'swap':
        t = eventTarget(st, 'swap', seat, piece);
        var myAbs = absOf(seat, p);
        out.target = { seat: t.seat, piece: t.piece, from: st.pieces[t.seat][t.piece], to: posFromAbs(t.seat, myAbs) };
        st.pieces[seat][piece] = posFromAbs(seat, t.abs); st.pieces[t.seat][t.piece] = out.target.to;
        out.to = st.pieces[seat][piece]; break;
      case 'back3':
        var b = p === CIRCLE ? LAST_TRACK - 2 : Math.max(0, p - 3), bp = [];
        for (var c = p; c !== b;) { c = c === CIRCLE ? LAST_TRACK : c - 1; bp.push(c); }
        st.pieces[seat][piece] = b; out.to = b; out.path = bp; break;
      case 'jump3': case 'jump6':
        var path = jumpDest(st, seat, piece, ev === 'jump3' ? 3 : 6), to = path[path.length - 1];
        st.pieces[seat][piece] = to; out.to = to; out.path = path;
        if (onTrack(to)) { out.captures = capturesAt(st, seat, absOf(seat, to)); out.captures.forEach(function (x) { sendHome(st, seat, x); }); if (out.captures.length && st.rules.bonusOnCapture) st.bonus++; }
        if (to === HOME) { out.finish = true; st.stats[seat].home++; clearEffects(st, seat, piece); if (st.rules.bonusOnHome) st.bonus++; }
        break;
      default: break; // calm
    }
    return out;
  }

  /**
   * Move token `piece` of the current player using queue value v (optional when only one value fits).
   * Returns { seat, piece, v, from, to, path, captures, finish, event, finishedPlayer, over, next }.
   */
  function move(st, piece, v, forcedEvent) {
    if (st.phase !== 'move') throw new Error('not in move phase');
    var m = null;
    for (var i = 0; i < st.moves.length; i++) { var c = st.moves[i]; if (c.piece === piece && (v == null || c.v === v)) { if (!m || (v == null && c.v > m.v)) m = c; } }
    if (!m) throw new Error('illegal move');
    var seat = st.turn;
    st.pieces[seat][piece] = m.to;
    removeQueueValue(st, m.v);
    m.captures.forEach(function (t) { sendHome(st, seat, t); });
    if (m.captures.length && st.rules.bonusOnCapture) st.bonus++;
    if (m.finish) { st.stats[seat].home++; clearEffects(st, seat, piece); if (st.rules.bonusOnHome) st.bonus++; }
    var res = { seat: seat, piece: piece, v: m.v, from: m.from, to: m.to, path: m.path, captures: m.captures, finish: m.finish, event: null, finishedPlayer: false, over: false, next: null };
    var tile = !m.finish ? tileAt(st, m.to, seat) : null;
    if (tile) res.event = applyEvent(st, tile, seat, piece, forcedEvent);
    st.last = { type: 'move', seat: seat, piece: piece, from: m.from, to: st.pieces[seat][piece], captures: m.captures.length, finish: m.finish, event: res.event ? res.event.event : null };
    if (st.pieces[seat].every(function (p) { return p === HOME; })) {
      st.ranking.push(seat); res.finishedPlayer = true;
      nextTurn(st); res.next = 'pass';
    } else {
      st.moves = st.queue.length ? queueMoves(st) : [];
      if (st.moves.length) { st.phase = 'move'; res.next = 'move'; }
      else res.next = afterQueue(st);
    }
    res.over = st.phase === 'over';
    return res;
  }

  // ---------- AI ----------
  /** How dangerous is track square abs for `seat` (weighted count of rival tokens that could land there next)? */
  function threatsTo(st, seat, abs) {
    if (st.rules.safeSquares && isSafeAbs(abs)) return 0;
    var n = 0, star = st.rules.rollStyle === 'star';
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat || st.ranking.indexOf(o) >= 0) continue;
      for (var i = 0; i < PIECES; i++) {
        var p = st.pieces[o][i];
        if (isFrozen(st, o, i)) continue;
        if (p >= 0 && p <= LAST_TRACK) {
          var d = (abs - absOf(o, p) + TRACK) % TRACK;
          if (p + d > LAST_TRACK && canEnter(st, o)) continue;
          if (d >= 1 && d <= 6) n += 1; else if (star && d >= 7 && d <= 12) n += 0.25;
        } else if (p < 0 && abs === absOf(o, 0)) n += 0.4; // could come out with a 6
      }
    }
    return n;
  }
  function tileValue(st, m, level) {
    if (!m.tile) return 0;
    if (m.tile === 'boost') return level === 'hard' ? 26 : 16;
    return level === 'hard' ? 9 - m.to * 0.15 : 3; // chaos: small upside, risky for advanced tokens
  }
  function evalHard(st, m) {
    var seat = m.seat, sc = 0, star = st.rules.rollStyle === 'star';
    if (m.finish) sc += 120;
    m.captures.forEach(function (c) { sc += 95 + advance(st.pieces[c.seat][c.piece]) * 1.2; });
    if (m.captures.length && st.rules.captureToEnter && !st.capd[seat]) sc += 40;
    if (m.leave) sc += 55 + 5 * st.pieces[seat].filter(function (p) { return p < 0; }).length;
    if (m.entersHomeColumn) sc += 45;
    var shielded = isShielded(st, seat, m.piece);
    var fromThreat = onTrack(m.from) && !shielded && !inBlock(st, seat, m.piece) ? threatsTo(st, seat, absOf(seat, m.from)) : 0;
    if (onTrack(m.to)) {
      var a = absOf(seat, m.to);
      if (st.rules.safeSquares && isSafeAbs(a)) sc += 30;
      // danger check on the board after the move (captured tokens are gone)
      var saved = m.captures.map(function (c) { var v = st.pieces[c.seat][c.piece]; st.pieces[c.seat][c.piece] = -1; return v; });
      var old = st.pieces[seat][m.piece]; st.pieces[seat][m.piece] = m.to;
      var formsBlock = st.rules.blocks && countOwnAt(st, seat, a) >= 2;
      var t = shielded || formsBlock ? 0 : threatsTo(st, seat, a);
      // chase value: rival tokens 1..6 ahead that we could hit next roll
      var chase = 0;
      for (var o = 0; o < 4; o++) { if (!st.pieces[o] || o === seat) continue; for (var i = 0; i < PIECES; i++) { var p = st.pieces[o][i]; if (!onTrack(p)) continue; var d = (absOf(o, p) - a + TRACK) % TRACK; if (d >= 1 && d <= 6 && !(st.rules.safeSquares && isSafeAbs(absOf(o, p))) && m.to + d <= LAST_TRACK) chase++; } }
      st.pieces[seat][m.piece] = old;
      m.captures.forEach(function (c, k) { st.pieces[c.seat][c.piece] = saved[k]; });
      if (t > 0) sc -= (40 + m.to * 0.9) * Math.min(t, 2.5);
      if (formsBlock && !isSafeAbs(a)) {
        sc += 18;
        // the partner token already there was exposed: the block now protects it too
        var pt = threatsTo(st, seat, a); if (pt > 0) sc += (25 + m.to * 0.7) * Math.min(pt, 2);
      }
      sc += Math.min(chase, 2) * 6;
      if (m.to === CIRCLE) sc -= 30;
    }
    if (fromThreat > 0 && m.from >= 0) sc += (25 + m.from * 0.7) * Math.min(fromThreat, 2); // escape danger
    if (onTrack(m.from) && st.rules.safeSquares && isSafeAbs(absOf(seat, m.from)) && onTrack(m.to) && !m.captures.length) sc -= 8; // leaving shelter
    if (inBlock(st, seat, m.piece) && !m.captures.length) sc -= 10; // breaking a block
    sc += tileValue(st, m, 'hard');
    // star style: keep a 6 for leaving base if that is still useful later in the queue
    if (star && m.v === 6 && !m.leave && st.pieces[seat].some(function (p) { return p < 0; }) && st.queue.filter(function (x) { return x === 6; }).length === 1) sc -= 25;
    sc += (advance(m.to) - advance(m.from)) * 0.4 + advance(m.from) * 0.05;
    return sc;
  }
  function evalMedium(st, m) {
    var sc = 0;
    if (m.captures.length) sc += 60;
    if (m.finish) sc += 50;
    if (m.leave) sc += 40;
    if (m.entersHomeColumn) sc += 25;
    if (onTrack(m.to) && st.rules.safeSquares && isSafeAbs(absOf(m.seat, m.to))) sc += 10;
    sc += tileValue(st, m, 'medium');
    sc += (advance(m.to) - advance(m.from)) * 0.5;
    return sc;
  }
  function scoreMove(st, m, level) { return level === 'hard' ? evalHard(st, m) : evalMedium(st, m); }
  /** Pick a move { piece, v } for the current AI player. */
  function chooseMove(st, level, rnd) {
    var moves = st.moves;
    if (!moves.length) return null;
    var r = rnd || function () { return rngNext(st); };
    if (moves.length === 1) return { piece: moves[0].piece, v: moves[0].v };
    var pick;
    if (level === 'easy') {
      var obvious = moves.filter(function (m) { return m.captures.length || m.finish; });
      pick = obvious.length && r() < 0.5 ? obvious[Math.floor(r() * obvious.length)] : moves[Math.floor(r() * moves.length)];
      return { piece: pick.piece, v: pick.v };
    }
    var best = null, bs = -Infinity;
    moves.forEach(function (m) { var v = scoreMove(st, m, level) + r() * (level === 'hard' ? 0.01 : 6); if (v > bs) { bs = v; best = m; } });
    return { piece: best.piece, v: best.v };
  }
  /** Pick-a-number event: which value (1..6) should the AI take? */
  function chooseDieValue(st, seat, level) {
    if (level === 'easy') return 6;
    var bestV = 6, bs = -Infinity;
    for (var v = 1; v <= 6; v++) {
      var ms = legalMoves(st, seat, v), sc = ms.length ? -Infinity : -200;
      ms.forEach(function (m) { sc = Math.max(sc, scoreMove(st, m, level === 'hard' ? 'hard' : 'medium')); });
      if (v === 6 && st.sixes < 2) sc += 22; // a 6 also rolls again
      if (sc > bs) { bs = sc; bestV = v; }
    }
    return bestV;
  }

  /** Moves whose outcome is identical (same token path) collapse to one choice, e.g. for auto-move. */
  function distinctMoves(moves) {
    var seen = {}, out = [];
    moves.forEach(function (m) { var k = m.from + '>' + m.to + '>' + m.v; if (!seen[k]) { seen[k] = 1; out.push(m); } });
    // same value on two tokens at the same square is the same outcome
    return out.filter(function (m, i) { return !out.some(function (o, j) { return j < i && o.from === m.from && o.to === m.to; }); });
  }

  /** Coins for the best-placed human (cosmetic currency only). */
  function coinsFor(place, nPlayers, aiLevels, mode) {
    var base = [0, 40, 20, 12, 6][place] || 0;
    if (nPlayers === 2 && place === 2) base = 10;
    var bonus = (aiLevels || []).indexOf('hard') >= 0 ? 10 : (aiLevels || []).indexOf('medium') >= 0 ? 5 : 0;
    return base + (place === 1 ? bonus : 0) + (mode === 'mystery' && place === 1 ? 5 : 0);
  }
  /** Experience points (cosmetic level on the home screen). */
  function xpFor(place, nPlayers) { return place === 1 ? 40 + 10 * nPlayers : Math.max(10, 30 - place * 5); }
  function levelFromXp(xp) { var lv = 1, need = 100, x = xp; while (x >= need) { x -= need; lv++; need = 100 + (lv - 1) * 25; } return { level: lv, into: x, need: need }; }

  /** Plays a whole game with AI for every seat (used by the tests). */
  function simulate(seats, rules, seed, maxRolls, mode) {
    var st = newGame(seats, rules, seed, mode), cap = maxRolls || 30000;
    while (st.phase !== 'over' && st.rolls < cap) {
      var lv = st.seats[st.turn].level;
      if (st.phase === 'roll') roll(st, mustChoose(st) ? chooseDieValue(st, st.turn, lv) : undefined);
      else { var c = chooseMove(st, lv); move(st, c.piece, c.v); }
    }
    return st;
  }

  function clone(st) { return JSON.parse(JSON.stringify(st)); }

  return {
    TRACK: TRACK, LAST_TRACK: LAST_TRACK, CIRCLE: CIRCLE, COL0: COL0, HOME: HOME, START_SQUARES: START_SQUARES, STAR_SQUARES: STAR_SQUARES,
    DEFAULT_RULES: DEFAULT_RULES, LEVELS: LEVELS, MODES: MODES, BOOST_TILES: BOOST_TILES, CHAOS_TILES: CHAOS_TILES, WHEELS: WHEELS, EVENT_INFO: EVENT_INFO,
    TRACK_CELLS: TRACK_CELLS, HOME_COLS: HOME_COLS, BASE_SPOTS: BASE_SPOTS, HOME_SPOTS: HOME_SPOTS, rot: rot,
    cellOf: cellOf, absOf: absOf, posFromAbs: posFromAbs, onTrack: onTrack, isSafeAbs: isSafeAbs, advance: advance, rngNext: rngNext, rollDie: rollDie,
    normRules: normRules, newGame: newGame, legalMoves: legalMoves, queueMoves: queueMoves, moveFor: moveFor, pathOf: pathOf, roll: roll, move: move, mustChoose: mustChoose,
    nextTurn: nextTurn, activeLeft: activeLeft, progressOf: progressOf, canEnter: canEnter, isShielded: isShielded, isFrozen: isFrozen, opponentBlockAt: opponentBlockAt,
    tileAt: tileAt, applyEvent: applyEvent, eventValid: eventValid, eventTarget: eventTarget,
    threatsTo: threatsTo, evalHard: evalHard, chooseMove: chooseMove, chooseDieValue: chooseDieValue, distinctMoves: distinctMoves,
    coinsFor: coinsFor, xpFor: xpFor, levelFromXp: levelFromXp, simulate: simulate, clone: clone
  };
});
