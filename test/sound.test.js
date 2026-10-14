const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let oscillators = 0;
const peaks = [];
function FakeAudioContext() {
  this.currentTime = 1;
  this.state = 'running';
  this.destination = {};
  this.createGain = () => ({
    gain: {
      value: 0,
      setValueAtTime() {},
      exponentialRampToValueAtTime(value) { peaks.push(value); }
    },
    connect() {}
  });
  this.createOscillator = () => {
    oscillators++;
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  };
}
const window = { AudioContext: FakeAudioContext };
vm.runInNewContext(fs.readFileSync(require.resolve('../www/js/sound.js'), 'utf8'), { window, Math });

window.SFX.setEnabled(false);
window.SFX.crystal(0);
assert.strictEqual(oscillators, 0, 'muted crystal feedback does not create audio nodes');
window.SFX.setEnabled(true);
window.SFX.crystal(1);
assert.strictEqual(oscillators, 4, 'enabled crystal feedback uses four soft partials');
assert(Math.max(...peaks) < 0.03, 'each crystal partial stays quiet');

const room = { mode: 'ludo_chess', roster: [{ user_id: 'red-player', seat: 0 }, { user_id: 'blue-player', seat: 1 }] };
const previousBoard = '.'.repeat(64);
const nextBoard = 'P' + '.'.repeat(63);
function state(board, turn, last_move, phase = 'active') { return { board, turn, last_move, phase }; }
function play(previous, next, gameRoom = room, userId = 'red-player') {
  return window.SFX.incomingChessMove(previous, next, gameRoom, userId);
}
assert.equal(play(null, state(nextBoard, 0, { from: 52, to: 36 })), false, 'initial state has no previous position to announce');
assert.equal(play(state(previousBoard, 0, null), state(nextBoard, 1, { from: 52, to: 36 })), false, 'the local player’s own move stays silent');
assert.equal(play(state(previousBoard, 1, null), state(previousBoard, 0, { from: 12, to: 28 })), false, 'draw-offer and other non-move version updates stay silent');
assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 1, { from: 12, to: 28 })), false, 'a board update without a turn change is not treated as a move');
assert.equal(play(state(previousBoard, 2, null), state(nextBoard, 0, { from: 12, to: 28 })), false, 'malformed turn values are ignored');
assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 0, { from: 12, to: 28 }), { mode: 'classic', roster: room.roster }), false, 'Classic Ludo updates do not use the Chess cue');
assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 0, { from: 12, to: 28 }), { mode: 'ludo_chess', roster: room.roster }, 'unknown-player'), false, 'spectators or missing local seats stay silent');
assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 0, { from: 12, to: 28 }), room, null), false, 'unsigned users cannot receive room move cues');
assert.equal(oscillators, 4, 'ineligible updates do not create sound nodes');

assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 0, { from: 12, to: 28 })), true, 'an opponent move that gives the local player the turn is announced');
assert.equal(oscillators, 6, 'a normal opponent move uses a gentle two-note cue');
assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 0, { from: 12, to: 28, capture: true })), true, 'opponent captures are announced');
assert.equal(oscillators, 8, 'a capture receives its own two-note cue');

window.SFX.setEnabled(false);
assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 0, { from: 12, to: 28 })), true, 'a valid opponent move is still recognized when sounds are muted');
assert.equal(oscillators, 8, 'the existing sound-effects preference suppresses the cue');
window.SFX.setEnabled(true);
assert.equal(play(state(previousBoard, 1, null), state(nextBoard, 0, { from: 12, to: 28, en_passant: true }, 'over')), true, 'the final move of a completed match is still announced');
assert.equal(oscillators, 10, 'a final capture remains audible when effects are enabled');

const onlineSource = fs.readFileSync(require.resolve('../www/js/online.js'), 'utf8');
const announcementStart = onlineSource.indexOf('function chessStateAnnouncement(');
const announcementEnd = onlineSource.indexOf('\n  function chessMoveHistory', announcementStart);
assert.ok(announcementStart >= 0 && announcementEnd > announcementStart, 'the existing version-gated Chess announcement function remains present');
assert.match(onlineSource.slice(announcementStart, announcementEnd), /SFX\.incomingChessMove\(previousState, state, room, currentUser && currentUser\.id\)/, 'incoming move cues run from the existing Chess state-announcement path');

window.SFX.setEnabled(false);
window.SFX.crystal(2);
assert.strictEqual(oscillators, 10, 'muting suppresses later crystal feedback');
console.log('23 sound and Online Chess move-cue checks passed');
