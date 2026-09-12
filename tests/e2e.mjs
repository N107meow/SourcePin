import {unzip} from './helpers/zip.mjs';
import {pathToFileURL} from 'node:url';
import { confirmExport } from './helpers/export.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const base=process.env.SOURCEPIN_TEST_URL || 'http://127.0.0.1:4317';
// The suite navigates to a local server first. Without this check an unreachable
// server surfaces much later as chrome-error://chromewebdata/, which reads like a
// product failure instead of a missing `npm run dev`.
try{
  const probe=await fetch(base,{signal:AbortSignal.timeout(4000)});
  if(!probe.ok)throw new Error(`HTTP ${probe.status}`);
}catch(error){
  console.error(`Acceptance server is not reachable at ${base} (${error instanceof Error?error.message:String(error)}).`);
  console.error('Start it with `npm run dev` in another terminal, then run this suite again.');
  process.exit(1);
}
await mkdir('artifacts',{recursive:true});
const extension=resolve('dist/extension');
const context=await chromium.launchPersistentContext('',{
  headless:true,channel:'chromium',viewport:{width:1440,height:1000},
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--enable-unsafe-extension-debugging'],
  permissions:['clipboard-read','clipboard-write'],acceptDownloads:true
});

// Escape unwinds one layer per press now, so exit sequences press until the
// inspector is actually detached instead of assuming a fixed count.
async function escapeUntilClosed(page){
  const root=page.locator('[data-sourcepin-root]');
  for(let attempt=0;attempt<4;attempt++){
    if(await root.count()===0)return true;
    await page.keyboard.press('Escape');
    try{await root.waitFor({state:'detached',timeout:1200});return true;}catch{}
  }
  return await root.count()===0;
}
const results=[];
let testPage;
try{
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(await worker.evaluate(()=>chrome.action.onClicked.hasListeners()),true,'Extension action listener is ready');
  const page=await context.newPage();testPage=page;const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE_ERROR',e.message);});
  await page.goto(base);await page.bringToFront();
  console.log('Extension loaded',worker.url());
  const browserCdp=await context.browser().newBrowserCDPSession();
  const {targetInfos}=await browserCdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const targetInfo=targetInfos.find(info=>info.url===page.url());
  assert.ok(targetInfo,'Browser tab target exists for acceptance page');
  const id=new URL(worker.url()).host;
  await browserCdp.send('Extensions.triggerAction',{id,targetId:targetInfo.targetId});
  await page.locator('[data-sourcepin-root]').waitFor({timeout:6000});
  results.push('Actual extension default action injects content script with activeTab');
  const root=page.locator('[data-sourcepin-root]');
  const onboarding=root.locator('[data-action="onboarding-done"]');
  assert.equal(await onboarding.isVisible(),true);
  await root.locator('.settings-button').click();await root.locator('.mode-switch').click();await root.locator('.mode-switch').click();await root.locator('.settings-button').click();
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.onboardingDone),true);
  assert.equal(await escapeUntilClosed(page),true);
  await page.reload();await browserCdp.send('Extensions.triggerAction',{id,targetId:targetInfo.targetId});await root.waitFor();
  assert.equal(await onboarding.isVisible(),false);
  await page.screenshot({path:'artifacts/01-extension-lite.png'});
  await page.getByTestId('project-toggle').click();
  await page.waitForFunction(()=>{const r=document.querySelector('[data-sourcepin-root]')?.shadowRoot;return r?.querySelector('.screen-count').textContent==='1' && !r.querySelector('.robot').classList.contains('busy');});
  assert.equal(await page.getByTestId('project-toggle').getAttribute('aria-expanded'),'false');
  await page.keyboard.press('Meta+c');await page.screenshot({path:'artifacts/export-review.png'});await confirmExport(page);
  await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.copy').dataset.copied==='true');
  const lite=await page.evaluate(()=>navigator.clipboard.readText());assert.match(lite,/project-toggle/);
  await writeFile('artifacts/example-lite.md',lite);
  results.push('Selection does not click through; Cmd+C copies real clipboard');
  await page.screenshot({path:'artifacts/02-selected-copy.png'});
  // Switch mode using visible robot controls.
  await root.locator('.settings-button').click();await root.locator('.mode-switch').click();
  await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').dataset.mode==='pro');
  await page.getByTestId('workspace-card').click({position:{x:20,y:80}});
  await page.waitForFunction(()=>{const r=document.querySelector('[data-sourcepin-root]')?.shadowRoot;return r?.querySelector('.screen-count').textContent==='1' && !r.querySelector('.robot').classList.contains('busy');});
  await root.locator('.gear').click();
  await root.locator('[data-action="record"]').click();
  await page.getByTestId('project-toggle').click();assert.equal(await page.getByTestId('project-toggle').getAttribute('aria-expanded'),'true');
  await page.waitForTimeout(450);
  await root.locator('[data-action="record"]').click();
  await root.locator('[data-action="panel-close"]').filter({visible:true}).first().click();
  await page.keyboard.press('Meta+c');await confirmExport(page);
  const pro=await page.evaluate(()=>navigator.clipboard.readText());assert.match(pro,/workspace-card/);
  results.push('Pro passive recording preserves real page interaction');
  await root.locator('.screen').click();
  const preview=await root.locator('.preview').textContent();await writeFile('artifacts/example-pro-preview.md',preview);
  assert.ok(Buffer.byteLength(preview)<=15*1024);
  assert.match(preview,/Recording Summary/);assert.match(preview,/aria-expanded|class/);
  assert.doesNotMatch(preview,/SOURCEPIN_TEST_PASSWORD|SOURCEPIN_TEST_TOKEN/);
  await page.screenshot({path:'artifacts/03-pro-preview.png'});
  const proDownload=page.waitForEvent('download');await root.locator('.download').click();await confirmExport(page);
  const proFile=await proDownload;await proFile.saveAs('artifacts/example-pro.md');
  const full=await readFile('artifacts/example-pro.md','utf8');
  assert.match(full,/## State Machine/);assert.match(full,/aria-expanded|class/);
  assert.doesNotMatch(full,/SOURCEPIN_TEST_PASSWORD|SOURCEPIN_TEST_TOKEN/);
  results.push('Bounded Pro preview and full downloaded report preserve recorded transition evidence');
  assert.equal(await escapeUntilClosed(page),true);
  await browserCdp.send('Extensions.triggerAction',{id,targetId:targetInfo.targetId});
  await page.locator('[data-sourcepin-root]').waitFor({timeout:6000});
  assert.equal(await page.locator('[data-sourcepin-root] .robot').getAttribute('data-mode'),'pro');
  results.push('Escape cleanup, reactivation and stored settings work');

  await page.getByTestId('workspace-card').click({position:{x:5,y:50}});
  await page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
  await page.getByTestId('activity-card').click({position:{x:5,y:50},modifiers:['Shift']});
  await page.waitForFunction(()=>{const r=document.querySelector('[data-sourcepin-root]').shadowRoot;return r.querySelector('.screen-count').textContent==='2'&&!r.querySelector('.robot').classList.contains('busy');});
  await page.keyboard.press('Meta+c');await confirmExport(page);
  await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.copy').dataset.copied==='true');
  const multi=await page.evaluate(()=>navigator.clipboard.readText());assert.match(multi,/workspace-card/);assert.match(multi,/activity-card/);
  results.push('Shift multi-select copies both independently verified targets');

  await page.evaluate(()=>document.querySelector('.advanced').open=true);
  await page.getByTestId('shadow-button').click();
  await page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
  await page.keyboard.press('Meta+c');await confirmExport(page);
  await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.copy').dataset.copied==='true');
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/shadow-button/);
  const frameButton=page.frameLocator('iframe').getByTestId('frame-button');
  await frameButton.click();
  await page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
  await page.keyboard.press('Meta+c');await confirmExport(page);
  await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.copy').dataset.copied==='true');
  const frameText=await page.evaluate(()=>navigator.clipboard.readText());assert.match(frameText,/frame-button/);assert.match(frameText,/frame/);
  const actual=await frameButton.boundingBox();
  const highlight=await root.locator('.selection').boundingBox();
  assert.ok(Math.abs(actual.x-highlight.x)<2 && Math.abs(actual.y-highlight.y)<2,'iframe highlight has top viewport coordinates');
  results.push('Open Shadow DOM and same-origin iframe capture and highlight correctly');

  await page.locator('#copy-input').focus();await page.locator('#copy-input').evaluate(el=>el.select());
  await page.keyboard.press('Meta+c');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'这段文字应仍能正常复制');
  await page.locator('#editable').focus();
  await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#editable'));getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.keyboard.press('Meta+c');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'选中这段文字，测试原生复制。');
  await page.evaluate(()=>{getSelection().removeAllRanges();document.activeElement.blur();});
  results.push('Editable inputs and contenteditable preserve native copy');

  await page.getByTestId('privacy-target').click();
  await page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
  await root.locator('.screen').click();
  assert.doesNotMatch(await root.locator('.preview').textContent(),/SOURCEPIN_TEST_TOKEN|SOURCEPIN_TEST_PASSWORD/);
  // Closes the preview panel only; the tool stays alive for the next target.
  await page.keyboard.press('Escape');
  results.push('Full export excludes seeded sensitive attributes and form values');
  await page.getByTestId('privacy-target').click();
  await page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));

  await page.getByTestId('privacy-target').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  await root.locator('[data-action="capture-panel"]').click();
  const screenshotDownload=page.waitForEvent('download',{timeout:6000});
  await root.locator('[data-action="component-shot"]').click();await confirmExport(page);
  const png=await screenshotDownload;await png.saveAs('artifacts/04-component-capture.png');
  assert.match(png.suggestedFilename(),/\.png$/);
  const pngBytes=await readFile('artifacts/04-component-capture.png');
  const componentBox=await page.getByTestId('privacy-target').boundingBox();
  assert.ok(Math.abs(pngBytes.readUInt32BE(16)-Math.round(componentBox.width))<=1);
  assert.ok(Math.abs(pngBytes.readUInt32BE(20)-Math.round(componentBox.height))<=1,JSON.stringify({pngHeight:pngBytes.readUInt32BE(20),componentBox}));
  await root.waitFor({state:'visible'});
  results.push('Extension captures and downloads visible component PNG then restores UI');
  // Closes the capture panel only; picking continues.
  await page.keyboard.press('Escape');

  await page.getByTestId('privacy-target').click();
  await page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
  // Test the optional-download denial path deterministically: user gesture remains
  // in the real UI, only the unavailable optional permission is controlled.
  await worker.evaluate(()=>{chrome.permissions.request=async()=>false;});
  const markdownDownload=page.waitForEvent('download',{timeout:6000});
  await root.locator('.download').click();await confirmExport(page);
  const md=await markdownDownload;await md.saveAs('artifacts/example-downloaded.md');assert.match(md.suggestedFilename(),/\.md$/);
  results.push('Permission-denied Markdown fallback downloads a real file');
  await page.screenshot({path:'artifacts/05-advanced.png'});
  const bookmarkPage=await context.newPage();await bookmarkPage.goto(base);
  await bookmarkPage.waitForFunction(()=>document.querySelector('#bookmarklet').href.startsWith('javascript:'));
  await bookmarkPage.locator('#bookmarklet').click();
  const bookmarkRoot=bookmarkPage.locator('[data-sourcepin-root]');await bookmarkRoot.waitFor();
  assert.equal(await bookmarkRoot.locator('[data-panel="onboarding"]').isVisible(),false);
  await bookmarkPage.getByTestId('project-toggle').click();
  await bookmarkPage.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
  await bookmarkPage.keyboard.press('Meta+c');await confirmExport(bookmarkPage);
  await bookmarkPage.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.copy').dataset.copied==='true');
  assert.match(await bookmarkPage.evaluate(()=>navigator.clipboard.readText()),/project-toggle/);
  await bookmarkPage.keyboard.press('Escape');assert.equal(await bookmarkRoot.count(),1);
  assert.equal(await bookmarkRoot.locator('.screen-count').textContent(),'');
  assert.equal(await escapeUntilClosed(bookmarkPage),true);
  await bookmarkPage.close();
  results.push('Packaged javascript bookmarklet launches, captures, copies and cleans up');
  const another=await context.newPage();await another.route('https://onboarding.test/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Another origin</h1>'}));await another.goto('https://onboarding.test/');
  const otherTargets=await browserCdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  await browserCdp.send('Extensions.triggerAction',{id,targetId:otherTargets.targetInfos.find(t=>t.url===another.url()).targetId});
  await another.locator('[data-sourcepin-root]').waitFor();assert.equal(await another.locator('[data-panel="onboarding"]').isVisible(),false);await another.close();await page.bringToFront();
  results.push('Extension guidance is remembered on first display after dismissal, reload and another origin');

  // Real download from a deterministic long page, for both shipping adapters.
  const pageEvidence=[];
  for(const adapter of ['extension','bookmarklet']){
    const whole=await context.newPage();await whole.goto(`${base}/demo/page-capture.html`);
    whole.on('pageerror',e=>errors.push(e.message));
    if(adapter==='extension'){
      await worker.evaluate(()=>chrome.storage.local.set({settings:{mode:'lite',onboardingDone:true}}));
      const {targetInfos}=await browserCdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
      await browserCdp.send('Extensions.triggerAction',{id,targetId:targetInfos.find(info=>info.url===whole.url()).targetId});
    }else{
      const bookmark=await readFile('dist/sourcepin.bookmarklet.txt','utf8');
      await whole.evaluate(code=>{location.href=code},bookmark);
    }
    const root=whole.locator('[data-sourcepin-root]');await root.waitFor();
    const intro=root.locator('[data-action="onboarding-done"]');if(await intro.isVisible())await intro.click();
    assert.equal(await root.locator('.robot').getAttribute('data-mode'),'lite');
    await root.locator('[data-action="capture-panel"]').click();await root.locator('[data-action="whole-page"]').click();
    await whole.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));
    const downloaded=whole.waitForEvent('download');await root.locator('.download').click();await confirmExport(whole);
    const file=await downloaded,path=`artifacts/page-${adapter}.zip`;await file.saveAs(path);
    assert.match(file.suggestedFilename(),/\.zip$/);
    const zipBytes=await readFile(path),files=unzip(zipBytes);
    const directory=`artifacts/page-${adapter}`;await mkdir(directory,{recursive:true});
    for(const [name,bytes] of Object.entries(files))await writeFile(`${directory}/${name}`,bytes);
    const report=files['report.md'].toString();
    assert.match(report,/"captureKind": "page"/);assert.match(report,/## Cleaned HTML/);assert.match(report,/Row 1199/);
    assert.match(report,/shadowrootmode="open"/);assert.match(report,/Template public fixture/);assert.match(report,/position: absolute/);assert.match(report,/srcset=/);
    assert.doesNotMatch(report,/HIDDEN_FIXTURE_PRIVATE|PAYWALL_FIXTURE_PRIVATE|FRAME_FIXTURE_PRIVATE|FORM_FIXTURE_PRIVATE|TOKEN_FIXTURE_PRIVATE|TEMPLATE_FIXTURE_PRIVATE/);
    const meta=JSON.parse(report.split('## Meta\n')[1].split('```json\n')[1].split('\n```')[0]);
    const structure=JSON.parse(report.split('## Structure\n')[1].split('```json\n')[1].split('\n```')[0]);
    assert.ok(structure.nodes.length>3600);assert.ok(meta.documentHeight>10000);assert.equal(meta.images.total,1);
    const captured=JSON.parse(files['structure.json'])[0];
    assert.ok(captured.degradations.some(note=>/Structure byte budget|Node budget reached/.test(note)));
    const rawHtml=report.split('## Cleaned HTML\n')[1].split('```html\n')[1].split('\n```')[0];
    const rawCss=report.split('## Scoped CSS\n')[1].split('```css\n')[1].split('\n```')[0];
    const captureBytes=Buffer.byteLength(rawHtml+rawCss+JSON.stringify(captured.nodes));
    assert.ok(captureBytes<=meta.budgets.maxBytes);assert.ok(zipBytes.length<=16*1024*1024);assert.ok(files['page.html'].length<=8*1024*1024);
    assert.equal(structure.target.siblingCount,2);
    const sampled=captured.nodes.filter(node=>Object.keys(node.styles).length).length;
    const styleBytes=[...files['page.html'].toString().matchAll(/<style>([\s\S]*?)<\/style>/g)].reduce((sum,match)=>sum+Buffer.byteLength(match[1]),0);
    assert.ok(styleBytes<=35824,`Inline CSS ${styleBytes} exceeds baseline 35824`);
    const deepStyles=await whole.locator('[data-row="1199"] p').evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.color,s.display,s.padding]});
    const offline=await context.newPage();let requests=0;
    await offline.route(/^https?:/,route=>{requests++;return route.abort();});
    await offline.goto(pathToFileURL(resolve(directory,'page.html')).href);
    assert.equal(await offline.locator('h1').isVisible(),true);assert.equal(await offline.getByText('Row 1199',{exact:true}).isVisible(),true);
    assert.equal(await offline.getByText('Shadow public fixture',{exact:true}).isVisible(),true);
    assert.match(await offline.locator('template:not([shadowrootmode])').evaluate(el=>el.content.textContent),/Template public fixture/);
    await offline.waitForFunction(()=>document.querySelector('img').naturalWidth>0);
    assert.equal(await offline.locator('script').count(),0);assert.equal(requests,0);
    const coverage=await offline.evaluate(()=>{
      let nodes=0,covered=0;
      const visit=(root,inherited=[])=>{
        const selectors=[...inherited,...[...(root.styleSheets??[])].flatMap(sheet=>[...sheet.cssRules].filter(rule=>rule.selectorText && !rule.selectorText.includes('::')).map(rule=>rule.selectorText))];
        for(const el of root.querySelectorAll('*')){
          if([...el.classList].some(name=>/^sp-\d+$/.test(name))){nodes++;if(selectors.some(selector=>el.matches(selector)))covered++;}
          if(el.shadowRoot)visit(el.shadowRoot);
          if(el.localName==='template')visit(el.content,selectors);
        }
      };visit(document);return {nodes,covered,ratio:covered/nodes};
    });
    assert.ok(coverage.ratio>=.8);
    assert.deepEqual(await offline.locator('[data-row="1199"] p').evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.color,s.display,s.padding]}),deepStyles);
    await offline.screenshot({path:`artifacts/offline-${adapter}.png`});await offline.close();
    pageEvidence.push({adapter,sampled,styleBytes,coverage,deepStyles,nodes:structure.nodes.length,captureBytes,zipBytes:zipBytes.length,htmlBytes:files['page.html'].length,reportBytes:Buffer.byteLength(report),siblingCount:structure.target.siblingCount,externalRequests:requests,degradations:captured.degradations,meta});
    await root.locator('.screen').click();const previewBytes=Buffer.byteLength(await root.locator('.preview').textContent());assert.ok(previewBytes<=15*1024);pageEvidence.at(-1).previewBytes=previewBytes;await whole.screenshot({path:`artifacts/page-${adapter}.png`});
    await escapeUntilClosed(whole);await whole.close();
    results.push(`${adapter}: Lite whole-page ZIP opens offline with images and shadow/template, zero requests, explicit budget cutoff`);
  }
  await writeFile('artifacts/page-capture-results.json',JSON.stringify({timestamp:new Date().toISOString(),captures:pageEvidence},null,2));
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/e2e-results.json',JSON.stringify({timestamp:new Date().toISOString(),chromium:context.browser().version(),node:process.version,platform:process.platform,architecture:process.arch,results,errors},null,2));
  console.log(JSON.stringify({passed:results.length,results},null,2));
}catch(error){if(testPage && !testPage.isClosed()){await testPage.screenshot({path:'artifacts/e2e-failure.png'}).catch(()=>{});console.log('FAILURE_URL',testPage.url());}throw error;}finally{await context.close();}
