import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('rapid activation cannot let a cancelled startup erase the newer controller',async()=>{
  const built=await build({entryPoints:['src/content.ts'],bundle:true,write:false,format:'iife',loader:{'.svg':'dataurl'}});
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();await page.setContent('<p>Lifecycle fixture</p>');
    await page.evaluate(()=>{window.settingsResolvers=[];window.chrome={storage:{local:{get:()=>new Promise(r=>window.settingsResolvers.push(r))}},runtime:{onMessage:{addListener(){},removeListener(){}}}};});
    await page.evaluate(code=>{eval(code);eval(code);eval(code);window.newPending=window.__sourcepin;},built.outputFiles[0].text);
    await page.evaluate(()=>window.settingsResolvers[0]({settings:{onboardingDone:true}}));
    assert.equal(await page.evaluate(()=>window.__sourcepin===window.newPending),true);
    await page.evaluate(()=>window.settingsResolvers[1]({settings:{onboardingDone:true}}));
    assert.equal(await page.locator('[data-sourcepin-root]').count(),1);
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-sourcepin-root]').count(),0);
    assert.equal(await page.evaluate(()=>window.__sourcepin),undefined);
  }finally{await browser.close();}
});
