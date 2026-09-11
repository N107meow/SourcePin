import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
let browser,bookmark,preview;
before(async()=>{
 const options={bundle:true,write:false,format:'iife',loader:{'.svg':'dataurl'}};
 bookmark=(await build({...options,entryPoints:['src/bookmarklet.ts']})).outputFiles[0].text;
 preview=(await build({...options,stdin:{contents:"import {startInspector} from './src/controller';import {createBrowserPlatform} from './src/platform/browser';import asset from './src/assets/robot.svg';window.startPreview=()=>startInspector(createBrowserPlatform('demo'),asset);",resolveDir:process.cwd()}})).outputFiles[0].text;
 browser=await chromium.launch({headless:true});
});
after(async()=>browser?.close());
async function fixture(){const context=await browser.newContext();const page=await context.newPage();await page.route('https://**/*',r=>r.fulfill({contentType:'text/html',body:'<button id="target">Choose</button>'}));return page;}
const guide=page=>page.locator('[data-panel="onboarding"]');

test('bookmarklet never repeats installation guidance across pages or origins',async()=>{
 const page=await fixture();
 for(const url of ['https://one.test/','https://one.test/next','https://two.test/']){
  await page.goto(url);await page.evaluate(code=>(0,eval)(code),bookmark);await page.locator('[data-sourcepin-root]').waitFor();assert.equal(await guide(page).isVisible(),false);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.evaluate(code=>(0,eval)(code),bookmark);await page.locator('[data-sourcepin-root]').waitFor();assert.equal(await guide(page).isVisible(),false);
 }await page.close();
});
test('preview guidance is remembered on first display, including dismissal before Start, reload and a new tab',async()=>{
 const page=await fixture();await page.goto('https://preview.test');await page.addScriptTag({content:preview});await page.evaluate(()=>window.startPreview());assert.equal(await guide(page).isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await guide(page).isVisible(),false);
 await page.locator('#target').click();assert.equal(await guide(page).isVisible(),false);
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.evaluate(()=>window.startPreview());assert.equal(await guide(page).isVisible(),false);
 await page.reload();await page.addScriptTag({content:preview});await page.evaluate(()=>window.startPreview());assert.equal(await guide(page).isVisible(),false);
 assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),['sourcepin:onboarding-seen']);
 const next=await page.context().newPage();await next.route('**/*',r=>r.fulfill({contentType:'text/html',body:'Preview'}));await next.goto('https://preview.test/again');await next.addScriptTag({content:preview});await next.evaluate(()=>window.startPreview());assert.equal(await guide(next).isVisible(),false);await page.close();await next.close();
});
test('blocked preview storage still remembers guidance across activations in the current page',async()=>{
 const page=await fixture();await page.goto('https://blocked.test');await page.evaluate(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}});});await page.addScriptTag({content:preview});await page.evaluate(()=>window.startPreview());assert.equal(await guide(page).isVisible(),true);await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.evaluate(()=>window.startPreview());assert.equal(await guide(page).isVisible(),false);await page.close();
});
