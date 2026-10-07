'use strict';

const assert = require('node:assert/strict');
const { MAX_NAME_LENGTH, getFeedback, init } = require('../www/js/online-profile-name-feedback.js');

class FakeElement {
  constructor(value) {
    this.value = value || '';
    this.textContent = '';
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  dispatch(name) { if (this.listeners[name]) this.listeners[name](); }
}

assert.equal(MAX_NAME_LENGTH, 32);
assert.deepEqual(getFeedback(' \t\n '), {
  count: 0,
  valid: false,
  message: '0 of 32 characters. Enter a name after trimming.'
}, 'whitespace-only names are blank after trimming');
assert.deepEqual(getFeedback('  Amina  '), {
  count: 5,
  valid: true,
  message: '5 of 32 characters.'
}, 'leading/trailing whitespace is excluded from the count');
assert.equal(getFeedback('A'.repeat(32)).valid, true, 'the current maximum is accepted');
assert.deepEqual(getFeedback('A'.repeat(33)), {
  count: 33,
  valid: false,
  message: '33 of 32 characters. Shorten the name to 32 or fewer.'
}, 'values above the current validation limit are called out');

const input = new FakeElement('  Alice  ');
const feedback = new FakeElement();
const document = {
  getElementById(id) {
    return { 'online-profile-name': input, 'online-profile-name-feedback': feedback }[id] || null;
  }
};
const controller = init(document);
assert.ok(controller, 'the helper initializes when both field and feedback exist');
assert.equal(feedback.textContent, '5 of 32 characters.', 'initial field content is reflected');
assert.equal(feedback.getAttribute('data-valid'), 'true');

input.value = '   ';
input.dispatch('input');
assert.equal(feedback.textContent, '0 of 32 characters. Enter a name after trimming.', 'typing whitespace shows the trimmed-empty state');
assert.equal(feedback.getAttribute('data-valid'), 'false');

const loaded = controller.setValue('  Online Player  ');
assert.equal(input.value, '  Online Player  ', 'loaded profile text is preserved in the input');
assert.equal(loaded.count, 13, 'programmatic profile loading refreshes the count');
assert.equal(feedback.textContent, '13 of 32 characters.');
const cleared = controller.setValue('');
assert.equal(cleared.valid, false, 'clearing an account makes the blank state invalid');
assert.equal(feedback.textContent, '0 of 32 characters. Enter a name after trimming.', 'account reset clears stale counter feedback');
assert.equal(init({ getElementById: () => null }), null, 'the helper safely no-ops if its markup is absent');

console.log('Online profile-name feedback unit tests passed.');
