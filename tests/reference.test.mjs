import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('runnable Reference Impl keeps closing-style text inside CSS',async()=>{
  const built=await build({stdin:{contents:`import {captureElement} from './src/core/capture';import {renderMarkdown} from './src/core/markdown';window.exportTest=async()=>renderMarkdown([await captureElement(document.querySelector('#target'),{mode:'pro',maxNodes:10,maxDepth:2})]);`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<div id="target">Reference</div>');
    const payload='</style><img src=x onerror=window.referenceExecuted=true>';
    await page.evaluate(payload=>{const style=document.createElement('style');style.textContent=`#target::before {content: ${JSON.stringify(payload)}}`;document.head.append(style);},payload);
    await page.addScriptTag({content:built.outputFiles[0].text});
    const markdown=await page.evaluate(()=>window.exportTest());
    const reference=markdown.split('## Reference Impl\n')[1].split('## Degradations\n')[0].match(/```html\n([\s\S]*?)\n```/)[1];
    await page.setContent(reference);await page.waitForTimeout(100);
    assert.equal(await page.locator('img').count(),0);
    assert.equal(await page.evaluate(()=>window.referenceExecuted),undefined);
    assert.equal(await page.locator('#target').evaluate(el=>getComputedStyle(el,'::before').content),JSON.stringify(payload));
  }finally{await browser.close();}
});
