import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

let browser, code;
test.before(async () => {
  code = (await build({
    stdin: { contents: "export * from './src/platform/favicon';", resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'Favicon',
  })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => browser?.close());

test('the bookmarklet paints its own square icon as the page favicon', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<head><title>No icon here</title></head><body><p>Host page</p></body>');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(() => {
      window.Favicon.installFavicon();
      const link = document.querySelector('link[rel~="icon"]');
      return { rel: link?.rel, type: link?.type, href: link?.href.slice(0, 22) };
    });
    assert.equal(result.rel, 'icon');
    assert.equal(result.type, 'image/png', 'a canvas PNG renders under a restrictive CSP');
    assert.equal(result.href, 'data:image/png;base64,');
  } finally { await page.close(); }
});

test('a host page that already declares an icon keeps one icon element', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<head><link rel="icon" href="data:image/gif;base64,R0lGODlhAQABAAAAACw="></head><body><p>Host page</p></body>');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(() => {
      window.Favicon.installFavicon();
      const links = [...document.querySelectorAll('link[rel~="icon"]')];
      return { count: links.length, type: links[0].type, scheme: links[0].href.slice(0, 15) };
    });
    assert.equal(result.count, 1, 'the existing link is reused, not duplicated');
    assert.equal(result.type, 'image/png');
    assert.equal(result.scheme, 'data:image/png;');
  } finally { await page.close(); }
});

test('the favicon decodes as a square PNG at every size it is asked for', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: code });
    const sizes = await page.evaluate(async () => {
      const out = [];
      for (const size of [16, 32, 48, 128]) {
        const href = window.Favicon.renderFavicon(size);
        const image = await new Promise(resolve => {
          const img = new Image();
          img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
          img.onerror = () => resolve(null);
          img.src = href;
        });
        out.push([size, image]);
      }
      return out;
    });
    for (const [size, decoded] of sizes) assert.deepEqual(decoded, [size, size], `${size}px decodes square`);
  } finally { await page.close(); }
});
