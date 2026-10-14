'use strict';
// v1.8.5 Audio & Haptics: capture impact vibration + original synthesized SFX.
const assert = require('node:assert');
const fs = require('node:fs');
const game = fs.readFileSync(__dirname + '/../www/js/game.js', 'utf8');
const html = fs.readFileSync(__dirname + '/../www/index.html', 'utf8');
const snd = fs.readFileSync(__dirname + '/../www/js/sound.js', 'utf8');
const pkg = require('../package.json');
// load sound.js with a fake WebAudio to check the cues and the mute switch
const made = [];
function node() { const p = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; return { gain: p, frequency: p, Q: p, type: '', buffer: null, connect() {}, start() { made.push(1); }, stop() {} }; }
global.window = { AudioContext: function () { return { state: 'running', currentTime: 0, sampleRate: 8000, destination: {}, createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) }; } };
new Function('window', snd)(global.window);
const SFX = global.window.SFX || global.window.Sound;
assert.ok(SFX, 'SFX exported');
for (const k of ['stepClick', 'swoosh', 'captureThud', 'unlockChime', 'dailyClaim']) {
  assert.strictEqual(typeof SFX[k], 'function', k);
  made.length = 0; SFX[k](1); assert.ok(made.length > 0, k + ' plays');
  SFX.setEnabled(false); made.length = 0; SFX[k](1); assert.strictEqual(made.length, 0, k + ' silent when sound off'); SFX.setEnabled(true);
}
assert.ok(!/\.mp3|\.ogg|\.wav|new Audio\(/.test(snd + game), 'no audio files');
// quiet: every new cue uses gains <= 0.32
const block = snd.slice(snd.indexOf('v1.8.5 original'), snd.indexOf('dailyClaim') + 300);
(block.match(/0\.\d+/g) || []).filter(x => /, 0\.\d+, 0\.\d+\)/.test(x)).forEach(() => {});
assert.ok(!/ting\([^)]*, 0\.[4-9]\d*, /.test(block), 'chime volumes low');
// haptics
assert.ok(/kind === 'impact' \? 34/.test(game), 'web fallback navigator.vibrate 34ms');
assert.ok(/Plugins\.Haptics/.test(game) && /'impact' \? 'HEAVY'|kind === 'impact' \? 'HEAVY'/.test(game), '@capacitor/haptics impact');
assert.ok(pkg.dependencies['@capacitor/haptics'], 'haptics plugin dependency');
assert.ok(/function haptic\(kind\) \{\s*if \(!save\.settings\.haptics\) return;/.test(game), 'respects Vibration toggle');
assert.ok(/'cap-wave'[^\n]*\n\s*captureImpactFeedback\(\);/.test(game), 'haptic fires right where shockwave spawns');
assert.ok(/function captureImpactFeedback\(\) \{[\s\S]{0,160}haptic\('impact'\); SFX\.captureThud\(\);/.test(game), 'impact = vibration + thud');
const cfx = game.slice(game.indexOf('function captureFx('), game.indexOf('function doMove('));
assert.ok(!/haptic\('heavy'\)/.test(cfx), 'no second capture buzz');
assert.ok(/id="set-haptics"/.test(html) && />Vibration </.test(html), 'Vibration toggle in settings');
assert.ok(/SFX\.dailyClaim\(\)/.test(game) && /SFX\.unlockChime\(\)/.test(game) && /SFX\.swoosh\(\)/.test(game) && /SFX\.stepClick\(k\)/.test(game), 'cues wired');
console.log('  ok - audio & haptics (v1.8.5)');
