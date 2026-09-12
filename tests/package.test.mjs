import {unzip} from './helpers/zip.mjs';
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
let browser,code;
before(async()=>{code=(await build({stdin:{contents:"export {captureElement} from './src/core/capture';export * from './src/core/package';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Bundle'})).outputFiles[0].text;browser=await chromium.launch({headless:true});});
after(async()=>browser?.close());

test('page ZIP marks every image in place, downloads none, and opens offline with shadow/template',async()=>{
 const page=await browser.newPage();const requests=[];
 await page.route('**/*',async route=>{requests.push(route.request().url());if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<main style="padding:10px"><h1>Offline heading</h1><img src="/ok.svg" width="40" height="20" srcset="/ok.svg 1x"><img src="/bad.png"><div id="shadow"></div><template><b>Template content</b></template><input value="do-not-export"><button onclick="alert(1)" data-token="credential">Safe</button></main>'});return route.abort();});
 await page.goto('https://fixture.test/page');await page.evaluate(()=>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<span>Shadow content</span>');await page.addScriptTag({content:code});
 requests.length=0; // the live page may load its own images; only the export must not.
 const bytes=await page.evaluate(async()=>{const capture=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});window.capture=capture;return [...new Uint8Array(await (await Bundle.createPagePackage([capture])).arrayBuffer())];});
 assert.equal(Buffer.from(bytes).readUInt16LE(12),0x21); // DOS date 1980-01-01
 const files=unzip(bytes);assert.deepEqual(Object.keys(files),['page.html','structure.json','assets.json','report.md']);
 const html=files['page.html'].toString(),report=files['report.md'].toString();assert.match(html,/^<!doctype html>/i);assert.match(html,/<base href="https:\/\/fixture.test\/page">/);
 // Every image position keeps a marker; no image bytes and no image request exist.
 assert.match(html,/data:image\/svg\+xml;base64,/);
 assert.doesNotMatch(html,/srcset=/,'srcset is dropped so the marker is the only image source');
 assert.match(report,/Images marked, not exported: 2 reference/i);
 assert.match(JSON.parse(files['structure.json'])[0].nodes.map(node=>node.attributes.srcset||'').join(''),/ok\.svg 1x/,'structure.json keeps the declared candidates');assert.match(report,/no image bytes are downloaded/i);
 const manifest=JSON.parse(files['assets.json']);assert.equal(manifest.mode,'marked-not-fetched');
 assert.deepEqual(manifest.assets.map(asset=>[asset.url,asset.status]),[['https://fixture.test/ok.svg','marked'],['https://fixture.test/bad.png','marked']]);
 assert.ok(manifest.assets.every(asset=>asset.bytes===0&&/image bytes are not exported/.test(asset.reason)));
 assert.match(report,/\[page.html\]\(\.\/page.html\)/);assert.doesNotMatch(html,/do-not-export|credential|onclick|<script/i);
 // decodeURIComponent-independent check: the offline page decodes each marker.
 const offline=await browser.newPage();let external=0;await offline.route('https://**/*',r=>{external++;return r.abort();});await offline.setContent(html);await offline.waitForTimeout(100);
 assert.equal(await offline.locator('h1').isVisible(),true);assert.equal(await offline.getByText('Shadow content').isVisible(),true);
 assert.deepEqual(await offline.locator('img').evaluateAll(images=>images.map(image=>[image.naturalWidth,image.naturalHeight])),[[40,20],[80,40]],'markers decode at the declared size');
 assert.equal(await offline.locator('img').first().evaluate(el=>el.currentSrc.startsWith('data:image/svg+xml')),true);
 assert.equal(await offline.locator('template:not([shadowrootmode])').evaluate(el=>el.content.textContent),'Template content');assert.equal(external,0);
 assert.equal(requests.filter(url=>/\.(svg|png)$/.test(url)).length,0,'no image was fetched');
 assert.ok(bytes.length<=16*1024*1024);await page.close();await offline.close();
});
test('hard ZIP/file limits refuse instead of emitting partial files; download bounds and cancellation are declared',async()=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<p>Budget</p>'}));await page.goto('https://fixture.test');await page.addScriptTag({content:code});
 const result=await page.evaluate(async()=>{const capture=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});const errors=[];for(const options of [{maxZipBytes:100},{maxHtmlBytes:100},{maxReportBytes:100}])try{await Bundle.createPagePackage([capture],options);}catch(e){errors.push(e.message);}const abort=new AbortController();abort.abort();try{await Bundle.createPagePackage([capture],{signal:abort.signal});}catch(e){errors.push(e.name);}return errors;});
 assert.equal(result.length,4);assert.match(result[0],/ZIP/);assert.match(result[1],/HTML/);assert.match(result[2],/Markdown/);assert.equal(result[3],'AbortError');await page.close();
});

test('no image reference is ever fetched, and the audit keeps only sanitized locations',async()=>{
 const page=await browser.newPage();const requests=[];
 await page.context().addCookies([{name:'session',value:'COOKIE_PRIVATE',url:'https://fixture.test'}]);
 await page.route('**/*',route=>{
  if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<p>Marked</p>'});
  requests.push(route.request().url());
  return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'});
 });
 await page.goto('https://fixture.test');await page.addScriptTag({content:code});
 const artifacts=await page.evaluate(async()=>{
  const base=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});const output=[];
  const bodies=[
   '<body><img src="/one.svg" width="10" height="10"><img src="/two.svg" width="20" height="10"></body>',
   '<body><img src="/big.svg" width="30" height="30"></body>',
   '<body><img src="https://other.test/cors.svg" width="12" height="12"></body>',
   '<body><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="8" height="8"></body>',
   '<body><img src="javascript:alert(1)" width="9" height="9"><img src="/token.png?token=PRIVATE_URL" width="11" height="11"></body>',
  ];
  for(const html of bodies){
   const zip=await Bundle.createPagePackage([{...base,html}],{});
   output.push([...new Uint8Array(await zip.arrayBuffer())]);
  }return output;
 });
 const files=artifacts.map(bytes=>unzip(bytes));
 const audit=files.map(files=>files['assets.json'].toString());
 assert.match(audit[0],/https:\/\/fixture\.test\/one\.svg/);assert.match(audit[0],/https:\/\/fixture\.test\/two\.svg/);
 assert.equal(JSON.parse(audit[1]).assets.length,1);
 assert.match(audit[2],/https:\/\/other\.test\/cors\.svg/);
 assert.equal(JSON.parse(audit[3]).assets.length,0,'a data: URL is not listed as a location');
 assert.equal(JSON.parse(audit[4]).assets.length,1,'only the http location is listed');
 assert.doesNotMatch(audit[4],/javascript|PRIVATE_URL/);
 assert.match(audit[4],/token=%5Bredacted%5D/);
 for(const entry of files)assert.match(entry['page.html'].toString(),/data:image\/svg\+xml;base64,/,'marker stands in at every position');
 assert.deepEqual(requests,[],'no image was requested, so no cookie or referrer could be sent');
 await page.close();
});
test('CDN srcset candidates are recorded as locations without any request',async()=>{
 const page=await browser.newPage();const requests=[];
 await page.route('**/*',route=>{
  if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<p>CDN fixture</p>'});
  requests.push(route.request().url());return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'});
 });
 try{
  await page.goto('https://fixture.test/page');await page.addScriptTag({content:code});
  requests.length=0;
  const bytes=await page.evaluate(async()=>{
   const holder=document.createElement('template');
   holder.innerHTML='<img width="128" height="96" srcset="/cdn-cgi/image/width=128,quality=85,format=auto,fit=scale-down/https://cloud.example.com/a.webp 128w, /cdn-cgi/image/width=256,quality=85,format=auto,fit=scale-down/https://cloud.example.com/a.webp 256w">';
   document.body.append(holder);
   const capture=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});
   return [...new Uint8Array(await (await Bundle.createPagePackage([capture])).arrayBuffer())];
  });
  const files=unzip(bytes),html=files['page.html'].toString();
  // Both comma-bearing CDN candidates survive as single locations.
  const audit=JSON.parse(files['assets.json']).assets.map(asset=>asset.url);
  assert.equal(audit.length,2);
  assert.ok(audit.every(url=>url.startsWith('https://fixture.test/cdn-cgi/image/width=')));
  assert.ok(audit.every(url=>/quality=85,format=auto,fit=scale-down/.test(url)),'the CDN URL comma is not a candidate separator');
  assert.doesNotMatch(audit.join(' '),/https:\/\/fixture\.test\/(?:quality|format|fit)=/);
  assert.doesNotMatch(html,/srcset=|cloud\.example\.com/,'the offline page carries no live image source');
  assert.deepEqual(requests,[],'no candidate was fetched');
  // structure.json keeps the full declared candidate list, including descriptors.
  const srcset=JSON.parse(files['structure.json'])[0].nodes.map(node=>node.attributes.srcset||'').join('');
  assert.match(srcset,/cdn-cgi\/image\/width=128/);assert.match(srcset,/cdn-cgi\/image\/width=256/);assert.match(srcset,/128w/);
 }finally{await page.close();}
});

test('a page of heavy images exports small because no image bytes are embedded',async()=>{
 const page=await browser.newPage();
 // Decodable 1 MiB images: the old inline path turned this into a multi-megabyte file.
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#369"/><!--'+'x'.repeat(1024*1024)+'--></svg>';
 await page.route('**/*',route=>{
  if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<p>Heavy fixture</p>'});
  if(route.request().url().includes('/heavy-img/'))return route.fulfill({contentType:'image/svg+xml',body:svg});
  return route.continue();
 });
 try{
  await page.goto('https://fixture.test/page');
  await page.setContent('<body>'+Array.from({length:6},(_,i)=>`<img src="/heavy-img/${i}.svg" width="600" height="400">`).join('')+'</body>');
  await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth>0),null,{timeout:15000});
  await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
   const capture=await Bundle.captureElement(document.body,{kind:'page',mode:'lite'});
   return {zip:[...new Uint8Array(await (await Bundle.createPagePackage([capture])).arrayBuffer())]};
  });
  const files=unzip(result.zip),html=files['page.html'].toString();
  // Six 1 MiB images used to be inlined; the file now stays tiny and still decodes.
  assert.ok(Buffer.byteLength(html)<64*1024,`page.html ${Buffer.byteLength(html)}`);
  assert.ok(result.zip.length<128*1024,`zip ${result.zip.length}`);
  assert.equal(JSON.parse(files['assets.json']).assets.length,6);
  const offline=await browser.newPage();let external=0;
  await offline.route('https://**/*',r=>{external++;return r.abort();});
  await offline.setContent(html);await offline.waitForTimeout(100);
  assert.deepEqual(await offline.locator('img').evaluateAll(images=>images.map(image=>[image.naturalWidth,image.naturalHeight])),Array.from({length:6},()=>[600,400]));
  assert.equal(external,0);
  await offline.close();
 }finally{await page.close();}
});
