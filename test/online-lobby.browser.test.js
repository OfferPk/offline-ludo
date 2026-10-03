'use strict';
const assert = require('node:assert/strict');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const url = process.argv[2] || 'http://localhost:8781/';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    const sdkRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/supabase-js/.test(request.url())) sdkRequests.push(request.url()); });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#home:not(.hidden)');
    assert.deepEqual(sdkRequests, [], 'offline-first startup does not fetch the Supabase SDK');
    assert.equal(await page.$eval('#online', el => el.classList.contains('hidden')), true, 'online screen stays hidden at startup');
    await page.click('#btn-online');
    await page.waitForSelector('#online:not(.hidden)');
    assert.deepEqual(sdkRequests, [], 'unconfigured online screen makes no Supabase request');
    const state = await page.$eval('#online-status', el => el.textContent);
    assert.match(state, /not configured|project/i, 'unconfigured UI explains that no project is active');
    assert.equal(await page.$eval('#online-google', el => el.disabled), true, 'Google sign-in is disabled without project configuration');
    assert.equal(await page.$eval('#online-facebook', el => el.disabled), true, 'Facebook sign-in is disabled without project configuration');
    await page.click('#online-back');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    assert.equal(await page.$eval('#btn-online', el => !!el), true, 'offline game setup remains reachable after opening the online lobby');
    assert.deepEqual(errors, [], 'page has no uncaught JavaScript errors');
    console.log('Online lobby browser smoke test passed (9 checks).');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
