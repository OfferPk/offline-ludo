const assert = require('assert');
const PathAnimation = require('../www/js/path-animation.js');

class FakeElement {
  constructor() {
    this.style = { transition: 'transform 120ms ease', transform: '' };
    const names = new Set();
    this.classList = {
      add(name) { names.add(name); },
      remove(name) { names.delete(name); },
      contains(name) { return names.has(name); }
    };
  }
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }
function fakeFrames() {
  let id = 0, queue = [];
  return {
    requestAnimationFrame(fn) { const item = { id: ++id, fn }; queue.push(item); return item.id; },
    cancelAnimationFrame(frameId) { queue = queue.filter(item => item.id !== frameId); },
    tick(time) { const item = queue.shift(); assert.ok(item, 'a frame was queued'); item.fn(time); },
    get pending() { return queue.length; }
  };
}

console.log('path-animation.test.js');
test('multi-step hops are eased in legal path order and end at the exact path endpoint', () => {
  const el = new FakeElement(), frames = fakeFrames(), steps = [], endpoints = [];
  let completes = 0;
  PathAnimation.animate({
    el, start: { x: 0, y: 0 }, points: [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 0 }],
    duration: 100, arcHeight: 6, requestAnimationFrame: frames.requestAnimationFrame.bind(frames),
    cancelAnimationFrame: frames.cancelAnimationFrame.bind(frames),
    onStep(i) { steps.push(i); endpoints.push(el.style.transform); }, onComplete() { completes++; }
  });
  assert.ok(el.classList.contains('hop'));
  frames.tick(0); frames.tick(50);
  assert.match(el.style.transform, /scale\(1\.045,0\.945\)/, 'mid-hop has modest stretch/squash');
  frames.tick(100); frames.tick(100); frames.tick(150); frames.tick(200); frames.tick(200); frames.tick(250); frames.tick(300);
  assert.deepStrictEqual(steps, [0, 1, 2]);
  assert.deepStrictEqual(endpoints, [
    'translate(10.00px,20.00px) scale(1.000,1.000)',
    'translate(20.00px,20.00px) scale(1.000,1.000)',
    'translate(30.00px,0.00px) scale(1.000,1.000)'
  ]);
  assert.strictEqual(completes, 1);
  assert.strictEqual(el.style.transform, endpoints[2]);
  assert.strictEqual(el.style.transition, 'transform 120ms ease');
  assert.ok(!el.classList.contains('hop'));
  assert.strictEqual(frames.pending, 0);
});

test('interruption cancels scheduled frames, clears hop styles, and does not double-complete', () => {
  const el = new FakeElement(), frames = fakeFrames(); let completes = 0, cancels = 0;
  const cancel = PathAnimation.animate({
    el, start: { x: 1, y: 2 }, points: [{ x: 3, y: 4 }, { x: 5, y: 6 }], duration: 100,
    requestAnimationFrame: frames.requestAnimationFrame.bind(frames), cancelAnimationFrame: frames.cancelAnimationFrame.bind(frames),
    onComplete() { completes++; }, onCancel() { cancels++; }
  });
  const staleFrame = frames.pending && 1;
  assert.ok(staleFrame && el.classList.contains('hop'));
  cancel(); cancel();
  assert.strictEqual(frames.pending, 0);
  assert.strictEqual(cancels, 1);
  assert.strictEqual(completes, 0);
  assert.strictEqual(el.style.transition, 'transform 120ms ease');
  assert.ok(!el.classList.contains('hop'));
});

test('animation-frame failure snaps to the legal endpoint and releases exactly once', () => {
  const el = new FakeElement(); let errors = 0, completes = 0;
  PathAnimation.animate({
    el, start: { x: 0, y: 0 }, points: [{ x: 4, y: 5 }, { x: 12, y: 9 }], duration: 100,
    requestAnimationFrame() { throw new Error('frame unavailable'); },
    onError() { errors++; }, onComplete() { completes++; }
  });
  assert.strictEqual(errors, 1);
  assert.strictEqual(completes, 1);
  assert.strictEqual(el.style.transform, 'translate(12.00px,9.00px) scale(1.000,1.000)');
  assert.strictEqual(el.style.transition, 'transform 120ms ease');
  assert.ok(!el.classList.contains('hop'));
});

test('reduced motion places each path step immediately without requesting frames', () => {
  const el = new FakeElement(), steps = []; let completes = 0;
  PathAnimation.animate({
    el, start: { x: 0, y: 0 }, points: [{ x: 4, y: 0 }, { x: 8, y: 3 }], reducedMotion: true,
    requestAnimationFrame() { throw new Error('reduced motion must not animate'); },
    onStep(i) { steps.push(i); }, onComplete() { completes++; }
  });
  assert.deepStrictEqual(steps, [0, 1]);
  assert.strictEqual(completes, 1);
  assert.strictEqual(el.style.transform, 'translate(8.00px,3.00px) scale(1.000,1.000)');
  assert.strictEqual(el.style.transition, 'transform 120ms ease');
  assert.ok(!el.classList.contains('hop'));
});

console.log(passed + ' path animation checks passed');
