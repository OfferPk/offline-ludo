const assert = require('assert');
const DiceGesture = require('../www/js/dice-gesture.js');

class FakeButton {
  constructor() { this.disabled = false; this.listeners = {}; this.captured = []; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(x => x !== fn); }
  setPointerCapture(id) { this.captured.push(id); }
  emit(type, values = {}) {
    const event = Object.assign({
      type, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: 20, clientY: 20, timeStamp: 100, detail: 0,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; }
    }, values);
    (this.listeners[type] || []).slice().forEach(fn => fn(event));
    return event;
  }
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

console.log('dice-gesture.test.js');
test('a swipe triggers exactly one roll and suppresses its compatibility click', () => {
  const button = new FakeButton(); let rolls = 0, taps = 0;
  const unbind = DiceGesture.bind(button, () => taps++, () => rolls++);
  button.emit('pointerdown', { clientX: 20, clientY: 20, timeStamp: 100 });
  const end = button.emit('pointerup', { clientX: 54, clientY: 25, timeStamp: 180 });
  const compat = button.emit('click', { clientX: 54, clientY: 25, timeStamp: 181, detail: 1 });
  assert.strictEqual(rolls, 1);
  assert.strictEqual(taps, 0);
  assert.strictEqual(button.captured[0], 1);
  assert.ok(end.prevented && compat.prevented && compat.stopped);
  unbind();
});

test('a short quick flick is accepted, but a stationary tap remains a tap', () => {
  const button = new FakeButton(); let rolls = 0, taps = 0;
  const unbind = DiceGesture.bind(button, () => taps++, () => rolls++);
  button.emit('pointerdown', { clientX: 20, clientY: 20, timeStamp: 100 });
  button.emit('pointerup', { clientX: 36, clientY: 20, timeStamp: 120 });
  assert.strictEqual(rolls, 1);
  button.emit('click', { clientX: 20, clientY: 20, timeStamp: 200, detail: 0 });
  assert.strictEqual(taps, 1, 'keyboard/programmatic click fallback is not swallowed');
  button.emit('pointerdown', { clientX: 20, clientY: 20, timeStamp: 300 });
  button.emit('pointerup', { clientX: 22, clientY: 22, timeStamp: 380 });
  button.emit('click', { clientX: 22, clientY: 22, timeStamp: 381, detail: 1 });
  assert.strictEqual(rolls, 1);
  assert.strictEqual(taps, 2, 'ordinary pointer tap reaches the button handler');
  unbind();
});

test('lost pointer capture cancels only the matching in-flight gesture', () => {
  const button = new FakeButton(); let rolls = 0, taps = 0;
  const unbind = DiceGesture.bind(button, () => taps++, () => rolls++);
  button.emit('pointerdown', { clientX: 20, clientY: 20, pointerId: 7, timeStamp: 100 });
  button.emit('lostpointercapture', { pointerId: 8 });
  button.emit('pointerup', { clientX: 60, clientY: 20, pointerId: 7, timeStamp: 180 });
  assert.strictEqual(rolls, 1, 'a different pointer losing capture does not cancel the active swipe');

  button.emit('pointerdown', { clientX: 20, clientY: 20, pointerId: 9, timeStamp: 300 });
  button.emit('lostpointercapture', { pointerId: 9 });
  button.emit('pointerup', { clientX: 60, clientY: 20, pointerId: 9, timeStamp: 380 });
  button.emit('click', { clientX: 60, clientY: 20, pointerId: 9, timeStamp: 381, detail: 1 });
  assert.strictEqual(rolls, 1, 'the interrupted pointer cannot trigger a stale swipe');
  assert.strictEqual(taps, 1, 'the ordinary click fallback remains available after interruption');
  unbind();
});

test('cancelled, secondary, and disabled gestures never roll', () => {
  const button = new FakeButton(); let rolls = 0, taps = 0;
  const unbind = DiceGesture.bind(button, () => taps++, () => rolls++);
  button.emit('pointerdown', { clientX: 20, clientY: 20, pointerId: 2, timeStamp: 100 });
  button.emit('pointercancel', { pointerId: 2 });
  button.emit('pointerup', { clientX: 70, clientY: 20, pointerId: 2, timeStamp: 180 });
  button.emit('pointerdown', { clientX: 20, clientY: 20, pointerId: 3, isPrimary: false, timeStamp: 200 });
  button.emit('pointerup', { clientX: 70, clientY: 20, pointerId: 3, timeStamp: 260 });
  button.disabled = true;
  button.emit('pointerdown', { clientX: 20, clientY: 20, pointerId: 4, timeStamp: 300 });
  button.emit('pointerup', { clientX: 70, clientY: 20, pointerId: 4, timeStamp: 360 });
  assert.strictEqual(rolls, 0);
  assert.strictEqual(taps, 0);
  unbind();
});

console.log(passed + ' dice gesture checks passed');
