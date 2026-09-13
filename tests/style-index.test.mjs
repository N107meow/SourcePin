import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
test('CSSOM index keeps matches for compound, grouped, complex and escaped selectors',async()=>{
 const code=(await build({entryPoints:['src/core/style-index.ts'],bundle:true,write:false,format:'iife',globalName:'Index'})).outputFiles[0].text;
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.setContent('<main><p id="one" class="a b">A</p><p class="c">B</p><span class="a:b">C</span></main>');await page.addScriptTag({content:code});
 const results=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('*')],index=Index.createStyleIndex(nodes);return ['p.a.b','#one','p, span','main > p','p:not(.c)','.a\\:b','*','P'].map(selector=>({selector,expected:nodes.filter(el=>el.matches(selector)).map(el=>el.outerHTML),actual:index(selector).filter(el=>el.matches(selector)).map(el=>el.outerHTML)}));});for(const r of results)assert.deepEqual(r.actual.sort(),r.expected.sort(),r.selector);
 }finally{await browser.close();}
});
