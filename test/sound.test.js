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
window.SFX.setEnabled(false);
window.SFX.crystal(2);
assert.strictEqual(oscillators, 4, 'muting suppresses later crystal feedback');
console.log('4 sound checks passed');
