// v1.6.0: the 3 squares ahead of each arrow (the squares the +4 jump passes through) are painted permanent red.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../www/js/logic.js');

// 1. geometry: 4 arrows x 3 cells, strictly between the arrow and the jump stop
assert.deepEqual(L.ARROW_SQUARES, [4, 17, 30, 43], 'arrow squares unchanged');
assert.equal(L.ARROW_JUMP, 4, 'jump length unchanged');
assert.equal(L.ARROW_DANGER, 3);
assert.deepEqual(L.ARROW_DANGER_SQUARES, [5, 6, 7, 18, 19, 20, 31, 32, 33, 44, 45, 46]);
L.ARROW_SQUARES.forEach(function (a, i) {
  const cells = L.ARROW_DANGER_SQUARES.slice(i * 3, i * 3 + 3);
  assert.deepEqual(cells, [a + 1, a + 2, a + 3], 'arrow ' + a + ' danger cells');
  cells.forEach(function (d) {
    assert.ok(L.START_SQUARES.indexOf(d) < 0 && L.STAR_SQUARES.indexOf(d) < 0 && L.ARROW_SQUARES.indexOf(d) < 0, d + ' is a plain track cell');
  });
  assert.ok(L.STAR_SQUARES.indexOf(a + L.ARROW_JUMP) >= 0, 'jump stop ' + (a + 4) + ' is the star');
});
console.log('  ok - 4 arrows x 3 danger cells = ' + L.ARROW_DANGER_SQUARES.join(','));

// 2. the danger cells are exactly the squares every seat's jump traverses, and rivals there are captured
const seats = [{ type: 'human' }, { type: 'human' }, { type: 'human' }, { type: 'human' }];
let checked = 0;
for (let seat = 0; seat < 4; seat++) {
  L.ARROW_SQUARES.forEach(function (a) {
    const pa = L.posFromAbs ? L.posFromAbs(seat, a) : ((a - 13 * seat) % 52 + 52) % 52;
    if (pa < 3 || pa > 46) return; // need a 3-roll approach that stays on the main track
    const st = L.newGame(seats, {}, 7, 'arrow');
    assert.ok(L.arrowsOn(st));
    for (let s = 0; s < 4; s++) st.pieces[s] = st.pieces[s].map(function () { return -1; });
    st.pieces[seat][0] = pa - 3;
    const victim = (seat + 1) % 4;
    const dangerAbs = [a + 1, a + 2, a + 3];
    dangerAbs.forEach(function (d, k) { st.pieces[victim][k] = ((d - 13 * victim) % 52 + 52) % 52; });
    const mv = L.moveFor(st, seat, 0, 3);
    assert.ok(mv && mv.arrowJump, 'seat ' + seat + ' jumps from arrow ' + a);
    const jumpAbs = mv.path.slice(3, 6).map(function (p) { return (p + 13 * seat) % 52; });
    assert.deepEqual(jumpAbs, dangerAbs, 'seat ' + seat + ' arrow ' + a + ': jump passes through the red cells');
    assert.equal((mv.to + 13 * seat) % 52, (a + 4) % 52, 'stops on arrow+4');
    assert.equal(mv.captures.filter(function (t) { return t.seat === victim; }).length, 3, 'all 3 rivals on the red cells are captured');
    checked++;
  });
}
assert.ok(checked >= 12, 'checked ' + checked + ' seat/arrow combos');
console.log('  ok - jump path == red cells for ' + checked + ' seat/arrow combos; rivals there captured');

// 3. passing over an arrow is still normal (no jump), so red is a marker only
{
  const st = L.newGame(seats, {}, 7, 'arrow');
  for (let s = 0; s < 4; s++) st.pieces[s] = st.pieces[s].map(function () { return -1; });
  st.pieces[0][0] = 1;
  const mv = L.moveFor(st, 0, 0, 5);
  assert.ok(mv && !mv.arrowJump && mv.to === 6, 'passing over arrow 4 lands normally on a red cell');
  console.log('  ok - passing over an arrow onto a red cell is a normal move');
}

// 4. renderer: red only painted when arrows are on, on the shared track loop
const game = fs.readFileSync(path.join(__dirname, '..', 'www/js/game.js'), 'utf8');
assert.match(game, /rules && rules\.arrows && L\.ARROW_DANGER_SQUARES/, 'danger paint gated on rules.arrows');
assert.match(game, /DANGER_FILL = '#d23a30'/, 'permanent red fill');
console.log('arrow-danger checks passed');
