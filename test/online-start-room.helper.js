'use strict';

const assert = require('node:assert/strict');

module.exports = async function verifyStartRoomGuard(page) {
  await page.evaluate(() => { window.__mockBackend.failRpc = 'start_room'; });
  await page.click('#online-start-room');
  await page.waitForFunction(() => {
    const button = document.querySelector('#online-start-room');
    return button.textContent === 'Start table' && !button.hasAttribute('aria-busy') && document.querySelector('#online-status').textContent.includes('Table could not be started:');
  });

  await page.evaluate(() => {
    window.__mockBackend.failRpc = null;
    window.__mockBackend.deferNextStartRpc = true;
  });
  const previousStartCalls = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'start_room').length);
  await page.click('#online-start-room');
  await page.waitForFunction(() => {
    const button = document.querySelector('#online-start-room');
    return button.textContent === 'Starting…' && button.getAttribute('aria-busy') === 'true';
  });
  await page.evaluate(() => document.querySelector('#online-start-room').click());
  const duringStartCalls = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'start_room').length);
  assert.equal(duringStartCalls, previousStartCalls + 1, 'a rapid second click cannot submit another start_room request');

  await page.evaluate(() => {
    const release = window.__mockBackend.releaseStartRoomRpc;
    if (typeof release !== 'function') throw new Error('the deferred Start RPC was not captured');
    release();
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('#online-start-room');
    return button.textContent === 'Start table' && !button.hasAttribute('aria-busy') && document.querySelector('#online-room-status').textContent.includes('predates the current online gameplay update');
  });
};
