/*
 * Crossfour rules engine: pure Ludo logic (no DOM), shared by the game and the Node tests.
 *
 * Seats (clockwise): 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
 * A piece's progress p:  -1 = in base,  0..50 = on the shared 52-square track (0 = its start square),
 *                        51..55 = its own home column,  56 = home (finished).
 * Absolute track square of a piece on the track = (p + 13 * seat) % 52.
 * Safe squares (when the rule is on): the four start squares (0, 13, 26, 39) and the four stars (8, 21, 34, 47).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TRACK = 52, LAST_TRACK = 50, HOME = 56, PIECES = 4;
  var START_SQUARES = [0, 13, 26, 39];
  var STAR_SQUARES = [8, 21, 34, 47];
  var DEFAULT_RULES = { safeSquares: true, extraOnSix: true, extraOnCapture: true };
  var LEVELS = ['easy', 'medium', 'hard'];
  var MAX_SIXES = 3;

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
  function rot(rc, times) { var r = rc[0], c = rc[1]; for (var k = 0; k < times; k++) { var t = r; r = c; c = 14 - t; } return [r, c]; }
  var SEG = [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8]];
  var TRACK_CELLS = [];
  for (var q = 0; q < 4; q++) for (var j = 0; j < SEG.length; j++) TRACK_CELLS.push(rot(SEG[j], q));
  var HOME_COLS = [], BASE_SPOTS = [], HOME_SPOTS = [];
  for (var s = 0; s < 4; s++) {
    var col = []; for (var k = 1; k <= 5; k++) col.push(rot([7, k], s)); HOME_COLS.push(col);
    BASE_SPOTS.push([[1.9, 1.9], [1.9, 3.1], [3.1, 1.9], [3.1, 3.1]].map(function (p) { return rot(p, s); }));
    HOME_SPOTS.push([[6.55, 6.1], [7.45, 6.1], [6.1, 6.55], [7.9, 6.55]].map(function (p) { return rot(p, s); }));
  }
  /** Board cell ([row, col], may be fractional) for a piece of `seat` at progress p (piece index i for base/home spots). */
  function cellOf(seat, p, i) {
    if (p < 0) return BASE_SPOTS[seat][i || 0];
    if (p <= LAST_TRACK) return TRACK_CELLS[(p + 13 * seat) % TRACK];
    if (p < HOME) return HOME_COLS[seat][p - 51];
    return HOME_SPOTS[seat][i || 0];
  }
  function absOf(seat, p) { return (p + 13 * seat) % TRACK; }
  function isSafeAbs(a) { return START_SQUARES.indexOf(a) >= 0 || STAR_SQUARES.indexOf(a) >= 0; }

  // ---------- setup ----------
  /**
   * seats: array of 4 entries, each null (empty seat) or { type: 'human' | 'ai', level?: 'easy'|'medium'|'hard', name? }.
   * Needs at least 2 players.
   */
  function newGame(seats, rules, seed) {
    var players = [];
    for (var i = 0; i < 4; i++) if (seats[i]) players.push(i);
    if (players.length < 2) throw new Error('need at least 2 players');
    var r = {}; Object.keys(DEFAULT_RULES).forEach(function (k) { r[k] = rules && rules[k] != null ? !!rules[k] : DEFAULT_RULES[k]; });
    var st = {
      seats: seats.map(function (x) { return x ? { type: x.type === 'ai' ? 'ai' : 'human', level: LEVELS.indexOf(x.level) >= 0 ? x.level : 'medium', name: x.name || null } : null; }),
      players: players,
      pieces: seats.map(function (x) { return x ? [-1, -1, -1, -1] : null; }),
      rules: r,
      turn: players[0],
      phase: 'roll',        // 'roll' | 'move' | 'over'
      dice: 0, sixes: 0,
      moves: [],
      ranking: [],          // seats in finishing order
      stats: seats.map(function (x) { return x ? { captures: 0, captured: 0, sixes: 0, home: 0, rolls: 0 } : null; }),
      rolls: 0, turnCount: 0,
      rng: (seed >>> 0) || 1,
      last: null            // last event, for the UI
    };
    return st;
  }

  function occupantsAt(st, abs, exceptSeat) {
    var out = [];
    for (var s = 0; s < 4; s++) {
      if (!st.pieces[s] || s === exceptSeat) continue;
      for (var i = 0; i < PIECES; i++) { var p = st.pieces[s][i]; if (p >= 0 && p <= LAST_TRACK && absOf(s, p) === abs) out.push({ seat: s, piece: i }); }
    }
    return out;
  }

  /** Legal moves for `seat` with die value `roll`. */
  function legalMoves(st, seat, roll) {
    var out = [], pcs = st.pieces[seat];
    if (!pcs) return out;
    for (var i = 0; i < PIECES; i++) {
      var p = pcs[i], to;
      if (p === HOME) continue;
      if (p < 0) { if (roll !== 6) continue; to = 0; }
      else { to = p + roll; if (to > HOME) continue; } // exact roll needed to reach home
      var caps = [];
      if (to <= LAST_TRACK) {
        var a = absOf(seat, to);
        if (!(st.rules.safeSquares && isSafeAbs(a))) caps = occupantsAt(st, a, seat);
      }
      out.push({ seat: seat, piece: i, from: p, to: to, captures: caps, leave: p < 0, finish: to === HOME, entersHomeColumn: p <= LAST_TRACK && to > LAST_TRACK && to < HOME });
    }
    return out;
  }

  function activeLeft(st) { return st.players.filter(function (s) { return st.ranking.indexOf(s) < 0; }); }
  function hasHuman(st) { return st.players.some(function (s) { return st.seats[s].type === 'human'; }); }
  function progressOf(st, s) { return st.pieces[s].reduce(function (a, p) { return a + (p < 0 ? 0 : p + 1); }, 0); }

  /** Is the match over? Ends when one player is left, or when every human has finished. */
  function checkOver(st) {
    var left = activeLeft(st);
    var humansLeft = left.filter(function (s) { return st.seats[s].type === 'human'; }).length;
    if (left.length <= 1 || (hasHuman(st) && humansLeft === 0)) {
      left.sort(function (a, b) { return progressOf(st, b) - progressOf(st, a); }).forEach(function (s) { st.ranking.push(s); });
      st.phase = 'over'; st.moves = [];
      return true;
    }
    return false;
  }

  function nextTurn(st) {
    st.sixes = 0; st.dice = 0; st.moves = []; st.turnCount++;
    if (checkOver(st)) return;
    var idx = st.players.indexOf(st.turn);
    for (var k = 1; k <= st.players.length; k++) {
      var s = st.players[(idx + k) % st.players.length];
      if (st.ranking.indexOf(s) < 0) { st.turn = s; break; }
    }
    st.phase = 'roll';
  }

  /**
   * Roll the die for the current player (value optional, for tests / replays).
   * Returns { value, moves, forfeit, passed }. With no legal move the turn passes
   * (a 6 still earns the extra roll when that rule is on); a third 6 in a row forfeits the turn.
   */
  function roll(st, value) {
    if (st.phase !== 'roll') throw new Error('not in roll phase');
    var v = value || rollDie(st), seat = st.turn;
    st.dice = v; st.rolls++; st.stats[seat].rolls++;
    if (v === 6) st.stats[seat].sixes++;
    if (v === 6 && st.rules.extraOnSix) {
      st.sixes++;
      if (st.sixes >= MAX_SIXES) {
        st.last = { type: 'forfeit', seat: seat };
        nextTurn(st);
        return { value: v, moves: [], forfeit: true, passed: true };
      }
    }
    var moves = legalMoves(st, seat, v);
    if (!moves.length) {
      st.last = { type: 'nomove', seat: seat, value: v };
      if (v === 6 && st.rules.extraOnSix) { st.phase = 'roll'; st.dice = v; return { value: v, moves: [], forfeit: false, passed: false }; }
      nextTurn(st);
      return { value: v, moves: [], forfeit: false, passed: true };
    }
    st.moves = moves; st.phase = 'move';
    return { value: v, moves: moves, forfeit: false, passed: false };
  }

  /** Apply the move of `piece` for the current player. Returns the move with { extraTurn, finishedPlayer, over }. */
  function move(st, piece) {
    if (st.phase !== 'move') throw new Error('not in move phase');
    var m = null;
    for (var i = 0; i < st.moves.length; i++) if (st.moves[i].piece === piece) { m = st.moves[i]; break; }
    if (!m) throw new Error('illegal move');
    var seat = st.turn;
    st.pieces[seat][piece] = m.to;
    m.captures.forEach(function (c) { st.pieces[c.seat][c.piece] = -1; st.stats[seat].captures++; st.stats[c.seat].captured++; });
    if (m.finish) st.stats[seat].home++;
    var res = { seat: seat, piece: piece, from: m.from, to: m.to, captures: m.captures, finish: m.finish, extraTurn: false, finishedPlayer: false, over: false };
    if (st.pieces[seat].every(function (p) { return p === HOME; })) { st.ranking.push(seat); res.finishedPlayer = true; }
    var extra = !res.finishedPlayer && ((st.dice === 6 && st.rules.extraOnSix) || (m.captures.length > 0 && st.rules.extraOnCapture));
    st.last = { type: 'move', seat: seat, piece: piece, from: m.from, to: m.to, captures: m.captures.length, finish: m.finish };
    if (extra) {
      if (!(st.dice === 6 && st.rules.extraOnSix)) st.sixes = 0; // bonus from a capture starts a fresh chain
      st.phase = 'roll'; st.moves = []; st.dice = 0;
      if (checkOver(st)) res.over = true; else res.extraTurn = true;
    } else {
      nextTurn(st);
      res.over = st.phase === 'over';
    }
    return res;
  }

  // ---------- AI ----------
  /** How many opponent pieces could land on track square `abs` with their next roll (1..6)? */
  function threatsTo(st, seat, abs) {
    if (st.rules.safeSquares && isSafeAbs(abs)) return 0;
    var n = 0;
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat || st.ranking.indexOf(o) >= 0) continue;
      for (var i = 0; i < PIECES; i++) {
        var p = st.pieces[o][i];
        if (p >= 0 && p <= LAST_TRACK) {
          var d = (abs - absOf(o, p) + TRACK) % TRACK;
          if (d >= 1 && d <= 6 && p + d <= LAST_TRACK) n++;
        } else if (p < 0 && abs === absOf(o, 0) && !st.rules.safeSquares) n += 0.5; // could come out with a 6
      }
    }
    return n;
  }

  function evalHard(st, m) {
    var seat = m.seat, sc = 0;
    if (m.finish) sc += 120;
    m.captures.forEach(function (c) { sc += 90 + st.pieces[c.seat][c.piece] * 1.2; });
    if (m.leave) sc += 55 + 5 * st.pieces[seat].filter(function (p) { return p < 0; }).length;
    if (m.entersHomeColumn) sc += 45;
    var fromThreat = m.from >= 0 && m.from <= LAST_TRACK ? threatsTo(st, seat, absOf(seat, m.from)) : 0;
    if (m.to <= LAST_TRACK) {
      var a = absOf(seat, m.to);
      if (st.rules.safeSquares && isSafeAbs(a)) sc += 30;
      // simulate the board after the move for the danger check (captured pieces are gone)
      var saved = m.captures.map(function (c) { var v = st.pieces[c.seat][c.piece]; st.pieces[c.seat][c.piece] = -1; return v; });
      var old = st.pieces[seat][m.piece]; st.pieces[seat][m.piece] = m.to;
      var t = threatsTo(st, seat, a);
      st.pieces[seat][m.piece] = old;
      m.captures.forEach(function (c, k) { st.pieces[c.seat][c.piece] = saved[k]; });
      if (t > 0) sc -= (40 + m.to * 0.9) * Math.min(t, 2);
      // chasing: an opponent 1..6 squares ahead is a capture chance next turn
    }
    if (fromThreat > 0 && m.from >= 0) sc += (25 + m.from * 0.7) * Math.min(fromThreat, 2); // escaping danger
    if (m.from >= 0 && m.from <= LAST_TRACK && st.rules.safeSquares && isSafeAbs(absOf(seat, m.from)) && m.to <= LAST_TRACK && !m.captures.length) sc -= 8; // leaving shelter
    sc += (m.to - Math.max(m.from, 0)) * 0.4 + Math.max(m.from, 0) * 0.05;
    return sc;
  }
  function evalMedium(st, m) {
    var sc = 0;
    if (m.captures.length) sc += 60;
    if (m.finish) sc += 50;
    if (m.leave) sc += 40;
    if (m.entersHomeColumn) sc += 25;
    if (m.to <= LAST_TRACK && st.rules.safeSquares && isSafeAbs(absOf(m.seat, m.to))) sc += 10;
    sc += (m.to - Math.max(m.from, 0)) * 0.5;
    return sc;
  }
  /** Pick a move (the piece index) for the current AI player. */
  function chooseMove(st, level, rnd) {
    var moves = st.moves;
    if (!moves.length) return -1;
    var r = rnd || function () { return rngNext(st); };
    if (moves.length === 1) return moves[0].piece;
    if (level === 'easy') {
      // mostly random; takes an obvious capture or finish half the time
      var obvious = moves.filter(function (m) { return m.captures.length || m.finish; });
      if (obvious.length && r() < 0.5) return obvious[Math.floor(r() * obvious.length)].piece;
      return moves[Math.floor(r() * moves.length)].piece;
    }
    var f = level === 'hard' ? evalHard : evalMedium, best = null, bs = -Infinity;
    moves.forEach(function (m) { var v = f(st, m) + r() * (level === 'hard' ? 0.01 : 6); if (v > bs) { bs = v; best = m; } });
    return best.piece;
  }

  /** Moves whose outcome is identical (same from/to) collapse to one choice, e.g. for auto-move. */
  function distinctMoves(moves) {
    var seen = {}, out = [];
    moves.forEach(function (m) { var k = m.from + '>' + m.to; if (!seen[k]) { seen[k] = 1; out.push(m); } });
    return out;
  }

  /** Coins for the best-placed human (cosmetic currency only). */
  function coinsFor(place, nPlayers, aiLevels) {
    var base = [0, 40, 20, 12, 6][place] || 0;
    if (nPlayers === 2 && place === 2) base = 10;
    var bonus = (aiLevels || []).indexOf('hard') >= 0 ? 10 : (aiLevels || []).indexOf('medium') >= 0 ? 5 : 0;
    return base + (place === 1 ? bonus : 0);
  }

  /** Plays a whole game with AI for every seat (used by the tests). */
  function simulate(seats, rules, seed, maxRolls) {
    var st = newGame(seats, rules, seed), cap = maxRolls || 20000;
    while (st.phase !== 'over' && st.rolls < cap) {
      if (st.phase === 'roll') roll(st);
      else move(st, chooseMove(st, st.seats[st.turn].level));
    }
    return st;
  }

  function clone(st) { return JSON.parse(JSON.stringify(st)); }

  return {
    TRACK: TRACK, LAST_TRACK: LAST_TRACK, HOME: HOME, START_SQUARES: START_SQUARES, STAR_SQUARES: STAR_SQUARES, DEFAULT_RULES: DEFAULT_RULES, LEVELS: LEVELS,
    TRACK_CELLS: TRACK_CELLS, HOME_COLS: HOME_COLS, BASE_SPOTS: BASE_SPOTS, HOME_SPOTS: HOME_SPOTS,
    cellOf: cellOf, absOf: absOf, isSafeAbs: isSafeAbs, rngNext: rngNext, rollDie: rollDie,
    newGame: newGame, legalMoves: legalMoves, roll: roll, move: move, nextTurn: nextTurn, activeLeft: activeLeft, progressOf: progressOf,
    threatsTo: threatsTo, evalHard: evalHard, chooseMove: chooseMove, distinctMoves: distinctMoves, coinsFor: coinsFor, simulate: simulate, clone: clone
  };
});
