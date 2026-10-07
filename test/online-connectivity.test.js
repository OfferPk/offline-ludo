'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'online-connectivity.js'), 'utf8');

function createHarness(initiallyOnline) {
  class Element {
    constructor() {
      this.id = '';
      this.textContent = '';
      this.dataset = {};
      this.attributes = {};
      this.classNames = new Set();
      this.classList = {
        add: name => this.classNames.add(name),
        remove: name => this.classNames.delete(name),
        contains: name => this.classNames.has(name),
        toggle: (name, force) => {
          const shouldAdd = force === undefined ? !this.classNames.has(name) : !!force;
          if (shouldAdd) this.classNames.add(name);
          else this.classNames.delete(name);
          return shouldAdd;
        }
      };
      this.parentNode = null;
    }
    get className() { return [...this.classNames].join(' '); }
    set className(value) { this.classNames = new Set(String(value).split(/\s+/).filter(Boolean)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
  }

  const anchor = new Element();
  anchor.id = 'online-status';
  const children = [anchor];
  const parent = {
    insertBefore(node, reference) {
      const index = children.indexOf(reference);
      assert.notEqual(index, -1, 'notice is inserted next to the Online status line');
      children.splice(index, 0, node);
      node.parentNode = this;
    }
  };
  anchor.parentNode = parent;
  const screen = new Element();
  screen.id = 'online';
  const elements = new Map([['online', screen], ['online-status', anchor]]);
  const windowListeners = {};
  const documentListeners = {};
  const timers = new Map();
  let nextTimerId = 1;
  const document = {
    hidden: false,
    getElementById: id => elements.get(id) || children.find(child => child.id === id) || null,
    createElement: () => new Element(),
    addEventListener: (name, listener) => { documentListeners[name] = listener; }
  };
  const window = {
    addEventListener: (name, listener) => { windowListeners[name] = listener; },
    setTimeout: (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  };
  const navigator = { onLine: initiallyOnline };
  vm.runInNewContext(source, { window, document, navigator });
  return {
    anchor, children, document, documentListeners, navigator, timers, windowListeners,
    get notice() { return children.find(child => child.id === 'online-connectivity-status'); },
    runTimer(id) {
      const timer = timers.get(id);
      assert.ok(timer, 'timer is pending');
      timers.delete(id);
      timer.callback();
    }
  };
}

const offline = createHarness(false);
assert.equal(offline.children[0], offline.notice, 'notice appears before the existing Online status');
assert.equal(offline.notice.attributes.role, 'status');
assert.equal(offline.notice.attributes['aria-live'], 'polite');
assert.equal(offline.notice.attributes['aria-atomic'], 'true');
assert.equal(offline.notice.dataset.state, 'offline');
assert.equal(offline.notice.classList.contains('hidden'), false);
assert.match(offline.notice.textContent, /online sign-in and rooms/i);
assert.match(offline.notice.textContent, /local games and saves remain available/i);

offline.navigator.onLine = true;
offline.windowListeners.online();
assert.equal(offline.notice.dataset.state, 'restored');
assert.match(offline.notice.textContent, /network access is back/i);
const firstTimerId = [...offline.timers.keys()][0];
assert.equal(offline.timers.get(firstTimerId).delay, 5000);
offline.runTimer(firstTimerId);
assert.equal(offline.notice.classList.contains('hidden'), true, 'restored notice clears after five seconds');
assert.equal(offline.notice.textContent, '');

offline.navigator.onLine = false;
offline.windowListeners.offline();
assert.equal(offline.notice.dataset.state, 'offline');
assert.equal(offline.notice.classList.contains('hidden'), false);
offline.navigator.onLine = true;
offline.document.hidden = false;
offline.documentListeners.visibilitychange();
assert.equal(offline.notice.dataset.state, 'restored', 'visibility recovery reconciles a missed online event');
assert.equal(offline.children.filter(child => child.id === 'online-connectivity-status').length, 1, 'connectivity updates reuse one notice');

const online = createHarness(true);
assert.equal(online.notice.classList.contains('hidden'), true, 'online startup keeps the notice hidden');
assert.equal(online.notice.textContent, '');
console.log('Online connectivity notice tests passed.');
