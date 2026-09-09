import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';

// Build explicitly: this suite also verifies the distributable Pages artifact.
test('Pages subpath installation exposes a self-contained bookmark that works on another site',{timeout:15000},async()=>{
  execFileSync(process.execPath,['scripts/build.mjs']);
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://install.test/SourcePin/**',async route=>{
      const path=new URL(route.request().url()).pathname.endsWith('robot.svg')?'robot.svg':'index.html';
      await route.fulfill({contentType:path.endsWith('svg')?'image/svg+xml':'text/html',body:await readFile(`dist/site/${path}`)});
    });
    await page.goto('https://install.test/SourcePin/');
    assert.equal(await page.locator('.showcase img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
    const bookmark=await page.locator('#bookmarklet').getAttribute('href');
    assert.ok(bookmark.startsWith('javascript:'));assert.equal(await page.locator('#bookmark-code').inputValue(),bookmark);
    assert.equal(await page.locator('#bookmarklet').getAttribute('draggable'),'true');
    // Verify the native link drag source. Renderer drop targets sanitize JS
    // URLs; the browser bookmark bar is a separate, explicitly allowed path.
    await page.evaluate(()=>{document.querySelector('#bookmarklet').addEventListener('dragstart',e=>window.draggedBookmark=e.dataTransfer.getData('text/uri-list'));const zone=document.createElement('div');zone.id='test-drop';zone.textContent='Drop target';zone.style.cssText='position:fixed;right:8px;top:8px;width:120px;height:80px;background:white;z-index:9999';zone.addEventListener('dragover',e=>e.preventDefault());zone.addEventListener('drop',e=>e.preventDefault());document.body.append(zone);});
    await page.locator('#bookmarklet').dragTo(page.locator('#test-drop'));
    assert.equal((await page.evaluate(()=>window.draggedBookmark))?.trim(),bookmark);
    await page.locator('#test-drop').evaluate(el=>el.remove());
    assert.ok(!decodeURIComponent(bookmark).includes('127.0.0.1:4317'));
    await page.locator('#try-sourcepin').click();await page.locator('[data-sourcepin-root]').waitFor();
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    // The stored URL is replayed by the browser on a different origin. No host
    // page, local dev server or remote loader is needed after installing it.
    await page.route('https://target.test/**',route=>route.fulfill({contentType:'text/html',body:'<button data-testid="target">Target site</button>'}));
    await page.goto('https://target.test/');
    await page.evaluate(url=>{location.href=url;},bookmark);
    await page.locator('[data-sourcepin-root]').waitFor();
    await page.locator('[data-action="onboarding-done"]').click();await page.getByTestId('target').click();
    await page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
    await page.keyboard.press('Control+c');await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.copy').dataset.copied==='true');
    assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Target site/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
