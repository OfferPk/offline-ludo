'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../www/js/online-classic-turn-cue.js');

let cues = 0;
const cue = create(() => { cues++; });
const state = (turn, phase = 'roll') => ({ turn, phase });

assert.equal(cue.update('room-one', 0, state(0), 0), false, 'initial local turn is silent');
assert.equal(cue.update('room-one', 1, state(1), 0), false, 'opponent turn is silent');
assert.equal(cue.update('room-one', 2, state(0), 0), true, 'opponent-to-local turn transition plays a cue');
assert.equal(cues, 1);
assert.equal(cue.update('room-one', 2, state(0), 0), false, 'duplicate version does not replay the cue');
assert.equal(cue.update('room-one', 1, state(1), 0), false, 'stale version is ignored');
assert.equal(cue.update('room-one', 3, state(0, 'move'), 0), false, 'an extra move during the same turn stays quiet');
assert.equal(cue.update('room-one', 4, state(1), 0), false, 'the next opponent turn stays quiet');
assert.equal(cue.update('room-one', 5, state(0), 0), true, 'a later local turn gets one cue');
assert.equal(cues, 2);
assert.equal(cue.update('room-one', 6, state(1), 0), false);
assert.equal(cue.update('room-one', 7, state(0, 'over'), 0), false, 'completed match cannot cue');
assert.equal(cue.update('room-one', 8, state(0), 0), false, 'a completed-to-active state does not look like a turn start');
assert.equal(cue.update('room-two', 0, state(0), 0), false, 'a new room local turn is a silent baseline');
assert.equal(cue.update('room-two', 1, state(1), null), false, 'missing membership resets the baseline');
assert.equal(cue.update('room-two', 2, state(0), 0), false, 'membership recovery does not replay a missed cue');
assert.equal(cues, 2);

const throwingCue = create(() => { throw new Error('audio unavailable'); });
assert.equal(throwingCue.update('room-three', 1, state(1), 0), false);
assert.doesNotThrow(() => throwingCue.update('room-three', 2, state(0), 0), 'audio failure cannot interrupt match rendering');
assert.equal(throwingCue.update('room-three', 3, state(0), 0), false, 'failed audio is not retried on an unchanged turn');

let oscillators = 0;
function FakeAudioContext() {
  this.currentTime = 1;
  this.state = 'running';
  this.destination = {};
  this.createGain = () => ({ gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
  this.createOscillator = () => {
    oscillators++;
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  };
}
const audioWindow = { AudioContext: FakeAudioContext };
vm.runInNewContext(fs.readFileSync(require.resolve('../www/js/sound.js'), 'utf8'), { window: audioWindow, Math });
const soundCue = create(() => audioWindow.SFX.turn());
assert.equal(soundCue.update('room-audio', 1, state(1), 0), false, 'audio cue starts from a silent opponent-turn baseline');
audioWindow.SFX.setEnabled(false);
assert.equal(soundCue.update('room-audio', 2, state(0), 0), true, 'muting does not suppress turn-state tracking');
assert.equal(oscillators, 0, 'muted Online Classic cues do not create audio nodes');
assert.equal(soundCue.update('room-audio', 3, state(1), 0), false, 'opponent turn remains silent');
audioWindow.SFX.setEnabled(true);
assert.equal(soundCue.update('room-audio', 4, state(0), 0), true, 'enabled sound plays on the next local turn');
assert.equal(oscillators, 4, 'the existing soft turn chime is used');
audioWindow.SFX.setEnabled(false);
assert.equal(soundCue.update('room-audio', 5, state(1), 0), false);
assert.equal(soundCue.update('room-audio', 6, state(0), 0), true, 'muted turn is still consumed exactly once');
assert.equal(oscillators, 4, 'muted follow-up cues remain silent');

console.log('29 Online Classic turn-cue checks passed');
