import {unzip} from './helpers/zip.mjs';
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
let browser,code;
before(async()=>{code=(await build({stdin:{contents:"export {captureElement} from './src/core/capture';export * from './src/core/package';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Bundle'})).outputFiles[0].text;browser=await chromium.launch({headless:true});});
after(async()=>browser?.close());

test('page ZIP opens offline with inline images, shadow/template and explicit failed resources',async()=>{
 const page=await browser.newPage();const requests=[];
 await page.route('**/*',async route=>{requests.push(route.request().url());if(route.request().url().endsWith('/ok.svg'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'});if(route.request().url().endsWith('/bad.png'))return route.fulfill({status:404,body:''});return route.fulfill({contentType:'text/html',body:'<main style="padding:10px"><h1>Offline heading</h1><img src="/ok.svg" srcset="/ok.svg 1x"><img src="/bad.png"><div id="shadow"></div><template><b>Template content</b></template><input value="do-not-export"><button onclick="alert(1)" data-token="credential">Safe</button></main>'});});
 await page.goto('https://fixture.test/page');await page.evaluate(()=>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<span>Shadow content</span>');await page.addScriptTag({content:code});
 const bytes=await page.evaluate(async()=>{const capture=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});window.capture=capture;return [...new Uint8Array(await (await Bundle.createPagePackage([capture])).arrayBuffer())];});
 assert.equal(Buffer.from(bytes).readUInt16LE(12),0x21); // DOS date 1980-01-01
 const files=unzip(bytes);assert.deepEqual(Object.keys(files),['page.html','structure.json','assets.json','report.md']);
 const html=files['page.html'].toString(),report=files['report.md'].toString();assert.match(html,/^<!doctype html>/i);assert.match(html,/<base href="https:\/\/fixture.test\/page">/);assert.match(html,/data:image\/svg\+xml;base64/);assert.match(html,/srcset=/);assert.match(report,/\[page.html\]\(\.\/page.html\)/);assert.match(report,/Resource.*failed/i);assert.doesNotMatch(html,/do-not-export|credential|onclick|<script/i);
 const offline=await browser.newPage();let external=0;await offline.route('https://**/*',r=>{external++;return r.abort();});await offline.setContent(html);await offline.waitForTimeout(100);
 assert.equal(await offline.locator('h1').isVisible(),true);assert.equal(await offline.getByText('Shadow content').isVisible(),true);assert.equal(await offline.locator('img').first().evaluate(el=>el.naturalWidth),40);assert.equal(await offline.locator('template:not([shadowrootmode])').evaluate(el=>el.content.textContent),'Template content');assert.equal(external,0);
 assert.ok(bytes.length<=16*1024*1024);assert.match(files['assets.json'].toString(),/404/);await page.close();await offline.close();
});
test('hard ZIP/file limits refuse instead of emitting partial files; download bounds and cancellation are declared',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<p>Budget</p>'}));await page.goto('https://fixture.test');await page.addScriptTag({content:code});
 const result=await page.evaluate(async()=>{const capture=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});const errors=[];for(const options of [{maxZipBytes:100},{maxHtmlBytes:100},{maxReportBytes:100}])try{await Bundle.createPagePackage([capture],options);}catch(e){errors.push(e.message);}const abort=new AbortController();abort.abort();try{await Bundle.createPagePackage([capture],{signal:abort.signal});}catch(e){errors.push(e.name);}return errors;});
 assert.equal(result.length,4);assert.match(result[0],/ZIP/);assert.match(result[1],/HTML/);assert.match(result[2],/Markdown/);assert.equal(result[3],'AbortError');await page.close();
});

test('resource count, streaming bytes, time and CORS failures are auditable; fetching omits credentials',async()=>{
 const page=await browser.newPage();const reads=[];
 await page.context().addCookies([{name:'session',value:'COOKIE_PRIVATE',url:'https://fixture.test'}]);
 await page.route('**/*',async route=>{
  if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<p>Limits</p>'});
  reads.push(route.request().headers());
  if(route.request().url().endsWith('/cors.svg'))return route.abort('accessdenied');
  if(route.request().url().endsWith('/slow.svg')){await new Promise(r=>setTimeout(r,100));return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}).catch(()=>{});}
  return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg">'+(' '.repeat(300))+'</svg>'});
 });
 await page.goto('https://fixture.test');await page.addScriptTag({content:code});
 const artifacts=await page.evaluate(async()=>{
  const base=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});const output=[];
  for(const [html,options] of [['<body><img src="/one.svg"><img src="/two.svg"></body>',{maxAssets:1}],['<body><img src="/big.svg"></body>',{maxAssetBytes:100}],['<body><img src="/slow.svg"></body>',{timeoutMs:10}],['<body><img src="https://other.test/cors.svg"></body>',{}]]){
   const zip=await Bundle.createPagePackage([{...base,html}],options);output.push([...new Uint8Array(await zip.arrayBuffer())]);
  }return output;
 });
 const reasons=artifacts.map(bytes=>unzip(bytes)['assets.json'].toString());
 assert.match(reasons[0],/resource count limit 1/);assert.match(reasons[1],/byte limit/);assert.match(reasons[2],/abort|timeout|time limit/i);assert.match(reasons[3],/failed/i);
 assert.equal(reads.length,4);assert.ok(reads.every(headers=>!headers.cookie && !headers.referer));
 await page.close();
});

test('CDN srcset exports exactly two real resources with identical HTML and structure candidates',async()=>{
 const page=await browser.newPage();const reads=[];
 await page.route('**/*',route=>{
  if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<p>CDN fixture</p>'});
  reads.push(route.request().url());return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'});
 });
 try{
  await page.goto('https://fixture.test/page');await page.addScriptTag({content:code});
  const bytes=await page.evaluate(async()=>{
   const holder=document.createElement('template');
   holder.innerHTML='<img srcset="/cdn-cgi/image/width=128,quality=85,format=auto,fit=scale-down/https://cloud.example.com/a.webp 128w, /cdn-cgi/image/width=256,quality=85,format=auto,fit=scale-down/https://cloud.example.com/a.webp 256w">';
   document.body.append(holder);
   const capture=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});
   return [...new Uint8Array(await (await Bundle.createPagePackage([capture])).arrayBuffer())];
  });
  const files=unzip(bytes),nodes=JSON.parse(files['structure.json'])[0].nodes;
  const srcset=await page.evaluate(html=>{const t=document.createElement('template');t.innerHTML=html;return t.content.querySelector('template').content.querySelector('img').getAttribute('srcset')},files['page.html'].toString());
  assert.equal(srcset,nodes.find(n=>n.tag==='img').attributes.srcset);
  assert.equal((srcset.match(/data:image\/svg\+xml;base64,/g)||[]).length,2);
  assert.equal(reads.length,2);
  assert.ok(reads.every(url=>url.startsWith('https://fixture.test/cdn-cgi/image/width=')));
  assert.equal(JSON.parse(files['assets.json']).assets.length,2);
 }finally{await page.close();}
});
