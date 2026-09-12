import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('bundled bookmarklet switches the body red under connect-src none and restores Lite green',async()=>{
 const built=await build({entryPoints:['src/bookmarklet.ts'],bundle:true,write:false,format:'iife',loader:{'.svg':'dataurl'}});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.route('https://theme.test/**',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"connect-src 'none'"},body:'<main><h1>Theme fixture</h1><button>Choose this</button></main>'}));
  await page.goto('https://theme.test/');await page.evaluate(code=>(0,eval)(code),built.outputFiles[0].text);
  await page.locator('[data-sourcepin-root]').waitFor();
  assert.equal(await page.locator('[data-panel="onboarding"]').isVisible(),false);
  await page.locator('.settings-button').click();await page.locator('.mode-switch').click();
  assert.equal(await page.locator('.robot').getAttribute('data-mode'),'pro');
  const bodyFill=()=>page.locator('.asset-pro').evaluate(asset=>{const body=asset.querySelector('[id="Vector"]');return body?getComputedStyle(body).fill:null;});
  assert.equal(await bodyFill(),'rgb(255, 0, 63)','Pro body must be red even when the page blocks fetch');
  assert.equal(await page.locator('.asset-lite').isVisible(),false);
  assert.equal(await page.locator('.asset-pro [id="Vector_2"]').getAttribute('fill'),'#E60038');
  assert.equal(await page.locator('.asset-pro [id="Vector_3"]').getAttribute('fill'),'#FFD1D9');
  await page.locator('.mode-switch').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
  await page.screenshot({path:'artifacts/pro-theme-csp.png'});
  await page.locator('.mode-switch').click();
  assert.equal(await page.locator('.asset-lite [id="Vector"]').evaluate(el=>getComputedStyle(el).fill),'rgb(89, 172, 157)');
  assert.equal(await page.locator('.asset-pro').isVisible(),false);
 }finally{await browser.close();}
});
