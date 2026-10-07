'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const policies = [
  path.join(root, 'PRIVACY.md'),
  path.join(root, 'www', 'privacy.html')
];
const requiredDisclosure = [
  'Online Ludo Chess rooms also store the shared chess-board position and server-validated moves and game-state changes.',
  'Those match details are visible to authenticated participants in that room.'
];

for (const file of policies) {
  const policy = fs.readFileSync(file, 'utf8');
  assert.match(policy, /Last updated: October 7, 2026/, `${path.basename(file)} has the current revision date`);
  for (const sentence of requiredDisclosure) {
    assert.ok(policy.includes(sentence), `${path.basename(file)} includes: ${sentence}`);
  }
}

console.log('privacy-chess-disclosure.test.js: both privacy notices disclose Online Chess match state and participant visibility.');
