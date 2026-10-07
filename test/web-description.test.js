'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const descriptions = [...html.matchAll(/<meta\s+name="description"\s+content="([^"]*)"\s*>/gi)];

assert.equal(descriptions.length, 1, 'the landing page has exactly one description');
const description = descriptions[0][1];
assert.match(description, /play ludo offline/i, 'the description mentions offline play');
assert.match(description, /sign in for online rooms/i, 'the description reflects enabled online sign-in');
assert.match(description, /matchmaking and invites/i, 'the description summarizes current online access');
assert.match(description, /local saves and progress stay on this device/i,
  'the description preserves the local-save boundary');
assert.ok(description.length <= 160, 'the description remains concise for search snippets');
assert.doesNotMatch(description, /sign-in is not yet enabled|sync are not available/i,
  'the description does not claim current online features are unavailable');

console.log('web-description.test.js: landing-page metadata accurately describes current online access and local saves.');
