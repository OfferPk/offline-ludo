'use strict';

const assert = require('node:assert/strict');

module.exports = async function verifyReadyToggleGuard(page) {
  await page.evaluate(() => { window.__mockBackend.deferNextReadyRpc = true; });
  const previousReadyCalls = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'set_room_ready').length);

  await page.click('#online-ready');
  await page.waitForFunction(() => {
    const button = document.querySelector('#online-ready');
    return button.disabled && button.getAttribute('aria-busy') === 'true';
  });
  await page.evaluate(() => document.querySelector('#online-ready').click());
  const duringReadyCalls = await page.evaluate(() => window.__mockBackend.rpcCalls.filter(call => call.name === 'set_room_ready').length);
  assert.equal(duringReadyCalls, previousReadyCalls + 1, 'a repeated click cannot submit a second Ready request while the first is pending');

  await page.evaluate(() => {
    const release = window.__mockBackend.releaseReadyRpc;
    if (typeof release !== 'function') throw new Error('the deferred Ready RPC was not captured');
    release();
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('#online-ready');
    return button.textContent === 'Mark not ready' && !button.disabled && !button.hasAttribute('aria-busy');
  });

  await page.evaluate(() => { window.__mockBackend.failRpc = 'set_room_ready'; });
  await page.click('#online-ready');
  await page.waitForFunction(() => {
    const button = document.querySelector('#online-ready');
    return !button.disabled && !button.hasAttribute('aria-busy') && document.querySelector('#online-status').textContent.includes('Ready status could not be changed:');
  });
  await page.evaluate(() => { window.__mockBackend.failRpc = null; });
};
