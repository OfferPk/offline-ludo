'use strict';

const assert = require('node:assert/strict');
const { init } = require('../www/js/online-history-filter.js');

class ClassList {
  constructor(...initial) { this.values = new Set(initial); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.values.has(value) : !!force;
    if (shouldAdd) this.values.add(value);
    else this.values.delete(value);
    return shouldAdd;
  }
}

class Button {
  constructor(filter) {
    this.dataset = { historyFilter: filter };
    this.attributes = {};
    this.listeners = {};
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  click() { this.listeners.click(); }
}

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; FakeMutationObserver.instance = this; }
  observe(target, options) { this.target = target; this.options = options; }
  disconnect() { this.disconnected = true; }
  flush() { this.callback([{ type: 'childList', target: this.target }]); }
}

const buttons = ['all', 'classic', 'ludo_chess'].map(mode => new Button(mode));
const list = { children: [] };
const group = { classList: new ClassList('hidden'), querySelectorAll: () => buttons };
const status = { textContent: '', classList: new ClassList('hidden') };
const document = {
  defaultView: { MutationObserver: FakeMutationObserver },
  getElementById(id) {
    return { 'online-history-list': list, 'online-history-filters': group, 'online-history-filter-status': status }[id] || null;
  }
};
const row = mode => ({ dataset: { historyMode: mode }, hidden: false });
list.children.push(row('classic'), row('ludo_chess'), row('classic'));

const controller = init(document);
assert.ok(controller, 'the filter controller initializes when the history UI exists');
assert.equal(FakeMutationObserver.instance.target, list, 'newly loaded history rows are observed');
assert.deepEqual(list.children.map(item => item.hidden), [false, false, false]);
assert.equal(group.classList.contains('hidden'), false);
assert.equal(status.textContent, 'Showing all 3 tables.');
assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');

buttons[1].click();
assert.equal(controller.getActiveFilter(), 'classic');
assert.deepEqual(list.children.map(item => item.hidden), [false, true, false]);
assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
assert.equal(status.textContent, 'Showing 2 of 3 tables.');

buttons[2].click();
assert.deepEqual(list.children.map(item => item.hidden), [true, false, true]);
assert.equal(status.textContent, 'Showing 1 of 3 tables.');

list.children.push(row('ludo_chess'));
FakeMutationObserver.instance.flush();
assert.deepEqual(list.children.map(item => item.hidden), [true, false, true, false], 'rows appended by a later history page obey the active filter');
assert.equal(status.textContent, 'Showing 2 of 4 tables.');

list.children.splice(0, list.children.length, row('classic'));
FakeMutationObserver.instance.flush();
buttons[2].click();
assert.equal(list.children[0].hidden, true);
assert.equal(status.textContent, 'No Ludo Chess tables in the loaded history.');

list.children.splice(0, list.children.length);
FakeMutationObserver.instance.flush();
assert.equal(controller.getActiveFilter(), 'all', 'clearing history resets the filter');
assert.equal(group.classList.contains('hidden'), true, 'empty histories do not show irrelevant filters');
assert.equal(status.classList.contains('hidden'), true);
assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
controller.disconnect();
assert.equal(FakeMutationObserver.instance.disconnected, true);

console.log('Online match-history filter unit checks passed.');
