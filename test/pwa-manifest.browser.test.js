'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const basePath = '/offline-ludo/';
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(basePath)) {
        response.writeHead(404).end('Not found');
        return;
      }

      const relative = pathname.slice(basePath.length) || 'index.html';
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      fs.readFile(file, (error, data) => {
        if (error) {
          response.writeHead(404).end('Not found');
          return;
        }
        response.writeHead(200, {
          'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: 'http://localhost:' + server.address().port + basePath
      });
    });
  });
}

(async () => {
  const local = await startLocalServer();
  let browser = null;
  let page = null;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();
    await page.setRequestInterception(true);
    const origin = new URL(local.url).origin;
    page.on('request', request => {
      if (new URL(request.url()).origin === origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });

    await page.goto(local.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return { missingLink: true };
      const manifestUrl = new URL(link.href);
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error('Manifest request failed: ' + response.status);
      const manifest = await response.json();
      const icons = await Promise.all(manifest.icons.map(async icon => {
        const url = new URL(icon.src, manifestUrl);
        const iconResponse = await fetch(url);
        if (!iconResponse.ok) throw new Error('Icon request failed: ' + url.pathname);
        const bitmap = await createImageBitmap(await iconResponse.blob());
        return { url: url.href, width: bitmap.width, height: bitmap.height, type: icon.type, sizes: icon.sizes };
      }));
      return {
        manifestUrl: manifestUrl.href,
        title: manifest.name,
        shortName: manifest.short_name,
        id: new URL(manifest.id, manifestUrl).pathname,
        startUrl: new URL(manifest.start_url, manifestUrl).pathname,
        scope: new URL(manifest.scope, manifestUrl).pathname,
        display: manifest.display,
        themeColor: manifest.theme_color,
        documentThemeColor: document.querySelector('meta[name="theme-color"]')?.content,
        icons
      };
    });

    assert.notEqual(result.missingLink, true, 'the document declares its web app manifest');
    assert.equal(new URL(result.manifestUrl).pathname, basePath + 'manifest.webmanifest');
    assert.equal(result.title, 'Online Ludo');
    assert.equal(result.shortName, 'Ludo');
    assert.equal(result.id, basePath, 'the app identity resolves within the hosted project path');
    assert.equal(result.startUrl, basePath, 'launch stays within the hosted project path');
    assert.equal(result.scope, basePath, 'navigation scope stays within the hosted project path');
    assert.equal(result.display, 'standalone');
    assert.equal(result.themeColor, result.documentThemeColor, 'browser chrome uses the existing app theme');
    assert.deepEqual(result.icons.map(icon => [icon.width, icon.height, icon.type]), [
      [192, 192, 'image/png'],
      [512, 512, 'image/png']
    ]);
    assert.deepEqual(result.icons.map(icon => icon.sizes), ['192x192', '512x512']);
    assert.ok(result.icons.every(icon => new URL(icon.url).pathname.startsWith(basePath)),
      'all install icons resolve within the project subpath');

    console.log('PWA manifest browser regression passed: standalone metadata, GitHub Pages subpath URLs, theme parity, and both correctly sized icons.');
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
