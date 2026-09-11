import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

let browser;
let source;

before(async () => {
  const result = await build({
    stdin: {
      contents: `
        export { generateLocators, validateLocators } from './src/core/locators.ts';
        export { captureElement, sampleStyles } from './src/core/capture.ts';
        export { safeAttributes } from './src/core/privacy.ts';
      `,
      resolveDir: process.cwd(),
      sourcefile: 'core-test-entry.ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'SourcePinCore',
    platform: 'browser',
    write: false,
  });
  source = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
});

after(async () => browser?.close());

async function fixture(html) {
  const page = await browser.newPage();
  await page.route('https://fixture.test/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://fixture.test/');
  await page.addScriptTag({ content: source });
  return page;
}

test('a unique business anchor still identifies the target after reordering', async () => {
  const page = await fixture(`<main><button data-testid="checkout:primary">Pay now</button><button>Cancel</button></main>`);
  try {
    const result = await page.evaluate(() => {
      const target = document.querySelector('[data-testid]');
      const locators = SourcePinCore.generateLocators(target);
      target.parentElement.prepend(target.parentElement.lastElementChild);
      return SourcePinCore.validateLocators(target, locators);
    });
    const anchor = result.find((locator) => locator.kind === 'css' && locator.value.includes('data-testid'));
    assert.deepEqual({ verified: anchor?.verified, matches: anchor?.matches, stability: anchor?.stability }, { verified: true, matches: 1, stability: 'stable' });
  } finally { await page.close(); }
});

test('duplicate IDs and removed nodes never validate as exact', async () => {
  const page = await fixture(`<div id="same"></div><div id="same"></div>`);
  try {
    const result = await page.evaluate(() => {
      const target = document.querySelector('#same');
      const initial = SourcePinCore.generateLocators(target).find((locator) => locator.value === '#same');
      target.remove();
      return { initial, removed: SourcePinCore.validateLocators(target, [initial])[0] };
    });
    assert.equal(result.initial.verified, false);
    assert.equal(result.initial.matches, 2);
    assert.deepEqual({ verified: result.removed.verified, matches: result.removed.matches }, { verified: false, matches: 0 });
  } finally { await page.close(); }
});

test('CSS and XPath locators escape quotes and selector punctuation', async () => {
  const page = await fixture(`<button data-testid="say&quot;it's:ready]">Go</button>`);
  try {
    const locators = await page.evaluate(() => SourcePinCore.generateLocators(document.querySelector('button')));
    assert.equal(locators.find((locator) => locator.kind === 'css' && locator.value.includes('data-testid'))?.verified, true);
    assert.equal(locators.find((locator) => locator.kind === 'xpath' && locator.stability === 'stable')?.verified, true);
  } finally { await page.close(); }
});

test('capture shares one bounded node set across sanitized HTML and CSS', async () => {
  const page = await fixture(`<base href="https://example.test/"><section id="card" data-token="top-secret" onclick="steal()"><input value="private form value" aria-label="Password"><a href="/pay?token=secret&item=book">Pay</a><script>window.secret = 'script secret'</script><div class="child"><span>Visible copy</span></div></section>`);
  try {
    const capture = await page.evaluate(() => SourcePinCore.captureElement(document.querySelector('#card'), { mode: 'pro', maxNodes: 4, maxDepth: 5 }));
    assert.equal(capture.nodes.length, 4);
    assert.equal((capture.html.match(/class="[^"]*sp-/g) ?? []).length, capture.nodes.length);
    assert.equal((capture.css.match(/\.sp-[\w-]+\{/g) ?? []).length, capture.nodes.length);
    assert.doesNotMatch(JSON.stringify(capture), /top-secret|private form value|script secret|onclick=/);
    assert.match(capture.html, /token=%5Bredacted%5D/);
    assert.ok(capture.degradations.some((item) => item.includes('Node budget')));
  } finally { await page.close(); }
});

test('capture reports open shadow reach and supports cancellation', async () => {
  const page = await fixture(`<div id="host"></div>`);
  try {
    const result = await page.evaluate(async () => {
      const host = document.querySelector('#host');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<button data-qa="inside">Inside</button>';
      const target = root.querySelector('button');
      const capture = await SourcePinCore.captureElement(target, { mode: 'lite' });
      const controller = new AbortController();
      controller.abort();
      let cancellation = '';
      try { await SourcePinCore.captureElement(target, { mode: 'pro', signal: controller.signal }); }
      catch (error) { cancellation = error.name; }
      return { reach: capture.meta.reach, locator: capture.locators.find((item) => item.value.includes('data-qa')), cancellation };
    });
    assert.ok(result.reach.some((part) => part.includes('open shadow host div#host')));
    assert.equal(result.locator.verified, true);
    assert.equal(result.cancellation, 'AbortError');
  } finally { await page.close(); }
});

test('business anchors include opaque IDs and never leak sensitive labels', async () => {
  const page = await fixture(`<button data-id="order_A7f92Zq8" data-conv-id="thread-42"><script>secret script</script><input value="secret input">Safe label</button>`);
  try {
    const locators = await page.evaluate(() => SourcePinCore.generateLocators(document.querySelector('button')));
    assert.equal(locators.find((item) => item.value.includes('data-id'))?.verified, true);
    assert.equal(locators.find((item) => item.value.includes('data-conv-id'))?.verified, true);
    assert.doesNotMatch(JSON.stringify(locators), /secret script|secret input/);
  } finally { await page.close(); }
});

test('capture sanitizes source URLs and preserves mixed direct text order', async () => {
  const page = await fixture(`<base href="https://example.test/"><button id="mixed" style="background:url('/x?token=css-secret')">Save <span>now</span>!</button>`);
  try {
    const capture = await page.evaluate(async () => {
      history.replaceState({}, '', 'https://fixture.test/page?token=url-secret&ok=1');
      return SourcePinCore.captureElement(document.querySelector('#mixed'), { mode: 'pro' });
    });
    assert.doesNotMatch(JSON.stringify(capture), /url-secret|css-secret/);
    assert.match(capture.meta.url, /token=%5Bredacted%5D/);
    assert.match(capture.html, />Save <span[^>]*>now<\/span>!<\/button>/);
  } finally { await page.close(); }
});

test('capture excludes executable content and every SourcePin-owned subtree', async () => {
  const page = await fixture(`<section id="root"><style>.leak{background:url('https://x.test/?token=style-secret')}</style><object data="https://x.test/object"></object><embed src="https://x.test/embed"><svg><foreignObject><div>foreign secret</div></foreignObject></svg><iframe srcdoc="<script>srcdoc secret</script>"></iframe><img srcset="https://x.test/a 1x"><div data-sourcepin-root><p>owned secret</p></div><div data-sourcepin-ui>ui secret</div><sourcepin-inspector>inspector secret</sourcepin-inspector><button onfocus="steal()" style="color:red"><input value="input secret">Visible</button></section>`);
  try {
    const capture = await page.evaluate(() => SourcePinCore.captureElement(document.querySelector('#root'), { mode: 'pro' }));
    assert.doesNotMatch(JSON.stringify(capture), /style-secret|foreign secret|srcdoc secret|owned secret|ui secret|inspector secret|input secret|<style|<object|<embed|foreignObject/i);
    assert.doesNotMatch(capture.html, /onfocus|srcdoc/i);
    assert.ok(capture.degradations.some(note=>note.includes('onfocus: 1') && note.includes('srcdoc: 1')));
    assert.match(capture.html, />Visible<\/button>/);
  } finally { await page.close(); }
});

test('node budget omits descendant markup and text without dropping direct mixed text', async () => {
  const page = await fixture(`<button id="mixed">Save <span>now</span>!<em>omitted secret</em></button>`);
  try {
    const capture = await page.evaluate(() => SourcePinCore.captureElement(document.querySelector('#mixed'), { mode: 'pro', maxNodes: 2 }));
    assert.equal(capture.nodes.length, 2);
    assert.match(capture.html, />Save <span[^>]*>now<\/span>!<\/button>/);
    assert.doesNotMatch(capture.html, /omitted secret|<em/);
    assert.ok(capture.degradations.some((item) => item.includes('Node budget')));
  } finally { await page.close(); }
});

test('serialized direct text uses the global budget and omits form-control defaults', async () => {
  const page = await fixture(`<section id="text"><textarea>textarea secret</textarea><select><option>option secret</option></select><p>${'x'.repeat(200)}<span>middle</span>${'y'.repeat(80)}</p></section>`);
  try {
    const capture = await page.evaluate(() => SourcePinCore.captureElement(document.querySelector('#text'), { mode: 'pro' }));
    assert.doesNotMatch(capture.html, /textarea secret|option secret/);
    const paragraph = capture.html.match(/<p[^>]*>(.*?)<\/p>/)?.[1] ?? '';
    const directText = paragraph.replace(/<span[^>]*>.*?<\/span>/, '');
    assert.equal(directText.length, 280);
    assert.match(paragraph, new RegExp(`^${'x'.repeat(200)}<span[^>]*>middle</span>${'y'.repeat(80)}$`));
  } finally { await page.close(); }
});

test('sensitive ancestor identities never enter locator candidates', async () => {
  const page = await fixture(`<main data-id="secret-token-123" id="auth-secret" class="session-token" name="password"><button><span id="target">Safe</span></button></main>`);
  try {
    const locators = await page.evaluate(() => SourcePinCore.generateLocators(document.querySelector('#target')));
    assert.doesNotMatch(JSON.stringify(locators), /secret-token-123|auth-secret|session-token|password|redacted/i);
  } finally { await page.close(); }
});

test('same-origin iframe and shadow targets use their own realm for capture and validation', async () => {
  const page = await fixture(`<iframe id="frame" srcdoc="<div id='host'></div>"></iframe>`);
  try {
    const result = await page.evaluate(async () => {
      const frame = document.querySelector('#frame');
      const frameDocument = frame.contentDocument;
      const host = frameDocument.querySelector('#host');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<button data-id="order_A7f92Zq8">Inside</button>';
      const target = shadow.querySelector('button');
      const capture = await SourcePinCore.captureElement(target, { mode: 'pro' });
      return { reach: capture.meta.reach, locators: capture.locators, html: capture.html };
    });
    assert.ok(result.reach.some((part) => part.includes('same-origin frame iframe#frame')));
    assert.ok(result.reach.some((part) => part.includes('open shadow host div#host')));
    assert.equal(result.locators.find((item) => item.value.includes('data-id'))?.verified, true);
    assert.match(result.html, /Inside/);
  } finally { await page.close(); }
});

test('CSSOM, pseudo styles, and animation values are bounded and URL-sanitized', async () => {
  const page = await fixture(`<style>@keyframes pulse{from{background-image:url('/a?token=keyframe-secret')}to{opacity:.5}}#animated::before{content:'x';background-image:url('/p?token=pseudo-secret')}#animated{animation:pulse 1s}</style><div id="animated">A</div>`);
  try {
    const capture = await page.evaluate(() => SourcePinCore.captureElement(document.querySelector('#animated'), { mode: 'pro' }));
    assert.match(capture.css, /matched CSSOM/);
    assert.match(capture.css, /::before/);
    assert.ok(capture.animations.length > 0);
    assert.doesNotMatch(JSON.stringify(capture), /keyframe-secret|pseudo-secret/);
    assert.match(JSON.stringify(capture), /%5Bredacted%5D/);
  } finally { await page.close(); }
});

test('hash-like classes are unstable and locator labels omit sensitive descendant text', async () => {
  const page = await fixture(`<button class="css-a1b2c3d4"><span>Safe</span><input value="private input"><script>private script</script></button>`);
  try {
    const locators = await page.evaluate(() => SourcePinCore.generateLocators(document.querySelector('button')));
    assert.equal(locators.find((item) => item.value.includes('css-a1b2c3d4'))?.stability, 'unstable');
    assert.doesNotMatch(JSON.stringify(locators), /private input|private script/);
  } finally { await page.close(); }
});

test('Element-kind Lite captures only the target while Pro reports depth truncation', async () => {
  const page = await fixture(`<main><section><div><span>deep</span></div></section></main>`);
  try {
    const result = await page.evaluate(async () => ({
      lite: await SourcePinCore.captureElement(document.querySelector('main'), { mode: 'lite' }),
      pro: await SourcePinCore.captureElement(document.querySelector('main'), { mode: 'pro', maxDepth: 1 }),
    }));
    assert.equal(result.lite.nodes.length, 1);
    assert.equal(result.lite.html, '');
    assert.equal(result.lite.css, '');
    assert.ok(result.pro.degradations.some((item) => item.includes('Depth budget')));
  } finally { await page.close(); }
});

test('capture metadata and reach paths omit sensitive ancestor and host identities',async()=>{
  const page=await fixture('<main id="secret-token-parent"><div id="secret-token-host"></div><button id="secret-token-target">Visible</button></main>');
  try{
    const results=await page.evaluate(async()=>{
      const button=document.querySelector('button');
      const normal=await SourcePinCore.captureElement(button,{mode:'pro'});
      const shadow=document.querySelector('div').attachShadow({mode:'open'});shadow.innerHTML='<button>Shadow</button>';
      return [normal,await SourcePinCore.captureElement(shadow.querySelector('button'),{mode:'lite'})];
    });
    assert.doesNotMatch(JSON.stringify(results),/secret-token-(parent|host|target)/);
  }finally{await page.close();}
});

test('ordinary card identities stay usable while credential-like values are omitted',async()=>{
  const page=await fixture('<section id="workspace-card" class="activity-card" data-testid="workspace-card" data-id="secret-token-123">Card</section>');
  try{
    const capture=await page.evaluate(()=>SourcePinCore.captureElement(document.querySelector('section'),{mode:'pro'}));
    assert.equal(capture.target.attributes.id,'workspace-card');
    assert.equal(capture.target.attributes.class,'activity-card');
    assert.ok(capture.locators.some(l=>l.value==='[data-testid="workspace-card"]' && l.verified));
    assert.doesNotMatch(JSON.stringify(capture),/secret-token-123/);
  }finally{await page.close();}
});

test('inline positioning and responsive images survive privacy sanitization',async()=>{
  const page=await fixture(`<div id="fill" style="position:absolute;height:100%;width:100%;background:url('/a?token=css-private');--api-key:super-private"></div><img src="/fallback" srcset="/small?token=image-private 1x, /large?size=2 2x" sizes="100vw">`);
  try{
    const attrs=await page.evaluate(()=>[SourcePinCore.safeAttributes(document.querySelector('#fill')).attributes,SourcePinCore.safeAttributes(document.querySelector('img')).attributes]);
    assert.match(attrs[0].style,/position:\s*absolute/);assert.match(attrs[0].style,/height:\s*100%/);
    assert.match(attrs[1].srcset,/1x.*2x/);assert.equal(attrs[1].sizes,'100vw');
    assert.doesNotMatch(JSON.stringify(attrs),/css-private|image-private|super-private|--api-key/);
  }finally{await page.close();}
});

test('tool nodes do not change sibling metadata or same-tag structural locators',async()=>{
  const page=await fixture('<section><div></div><div></div></section>');
  try{
    const result=await page.evaluate(async()=>{
      const section=document.querySelector('section'),target=section.lastElementChild;
      const tool=document.createElement('div');tool.setAttribute('data-sourcepin-custom','');section.prepend(tool);
      const host=document.createElement('sourcepin-inspector');document.documentElement.append(host);
      return {capture:await SourcePinCore.captureElement(document.body,{mode:'lite'}),locators:SourcePinCore.generateLocators(target)};
    });
    assert.equal(result.capture.target.siblingCount,2);assert.equal(result.capture.target.childIndex,1);
    const structural=result.locators.find(l=>l.kind==='css' && l.value.includes('section'));
    assert.equal(structural.verified,true);assert.match(structural.value,/2/);
  }finally{await page.close();}
});

test('Lite page capture preserves a long structure independently from sampled styles and exposes page measurements',async()=>{
  const page=await fixture('<main>'+Array.from({length:1100},(_,i)=>`<article><p>Item ${i}</p></article>`).join('')+'</main><img src="/test-image">');
  try{
    const result=await page.evaluate(()=>SourcePinCore.captureElement(document.body,{mode:'lite',kind:'page',maxStyleNodes:5}));
    assert.equal(result.meta.captureKind,'page');assert.ok(result.nodes.length>2000);assert.match(result.html,/Item 1099/);
    assert.match(result.css,/\.sp-/);assert.ok(result.nodes.filter(n=>Object.keys(n.styles).length).length<=5);
    assert.ok(result.meta.documentHeight>700);assert.ok(result.meta.documentElementRect.height>0);assert.deepEqual(result.meta.htmlRect,result.meta.documentElementRect);
    assert.equal(result.meta.images.total,1);assert.equal(typeof result.meta.images.complete,'number');
    assert.ok(result.degradations.some(s=>/computed.*sampl/i.test(s)));
  }finally{await page.close();}
});

test('page serialization keeps templates, declarative shadow and long text, excludes hidden and executable content',async()=>{
  const page=await fixture('<main><div id="host"></div><template><article>inert public<script>template-private</script><input value="template-form-private"></article></template><p>'+('Long public text '.repeat(100))+'</p><div hidden>hidden-private</div><div style="display:none">paywall-private</div><iframe srcdoc="frame-private"></iframe><svg><image href="/art?token=svg-private"></image><circle r="4"></circle></svg></main>');
  try{
    const result=await page.evaluate(async()=>{
      document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<span style="position:absolute">shadow public</span><script>shadow-private</script><div hidden>shadow-hidden-private</div>';
      return SourcePinCore.captureElement(document.body,{mode:'lite',kind:'page'});
    });
    assert.match(result.html,/<template shadowrootmode="open">/);assert.match(result.html,/shadow public/);assert.match(result.html,/<template[^>]*>.*inert public/s);
    assert.ok(result.html.includes('Long public text '.repeat(100)));assert.doesNotMatch(JSON.stringify(result),/hidden-private|paywall-private|frame-private|template-private|template-form-private|shadow-private|svg-private/);
    assert.match(result.html,/<image[^>]*\/><circle/);
    assert.ok(result.degradations.some(s=>/hidden.*3|3.*hidden/i.test(s)));assert.ok(result.degradations.some(s=>/iframe.*not.*captur/i.test(s)));
    assert.equal(result.capabilities.iframes.status,'absent');assert.equal(result.capabilities.shadowDom.status,'present');
  }finally{await page.close();}
});

test('global UTF-8 byte and structural budgets declare truncation and retain balanced markup',async()=>{
  const page=await fixture('<section><p>'+('汉🙂<&'.repeat(20000))+'</p><b>After long text</b></section>');
  try{
    const result=await page.evaluate(async()=>{
      const target=document.querySelector('section');
      return {limited:await SourcePinCore.captureElement(target,{mode:'lite',kind:'page',maxBytes:16384,maxStyleNodes:1}),depth:await SourcePinCore.captureElement(target,{mode:'lite',kind:'page',maxDepth:0}),nodes:await SourcePinCore.captureElement(target,{mode:'lite',kind:'page',maxNodes:2})};
    });
    assert.ok(Buffer.byteLength(result.limited.html+result.limited.css+JSON.stringify(result.limited.nodes))<=16384);
    assert.match(result.limited.html,/<!-- text truncated -->/);assert.match(result.limited.html,/<b[^>]*>.*<\/b><\/section>$/s);assert.doesNotMatch(result.limited.html,/\uFFFD/);
    assert.ok(result.limited.degradations.some(s=>/byte.*text|text.*byte/i.test(s)));
    assert.ok(result.depth.degradations.some(s=>/Depth budget/.test(s)));assert.equal(result.nodes.nodes.length,2);assert.ok(result.nodes.degradations.some(s=>/Node budget/.test(s)));
  }finally{await page.close();}
});

test('hidden capture is explicit and marked while default target and locator text remain safe',async()=>{
  const page=await fixture('<button>Public<span style="display:none">restricted-copy</span></button>');
  try{
    const result=await page.evaluate(async()=>({safe:await SourcePinCore.captureElement(document.querySelector('button'),{mode:'pro'}),optin:await SourcePinCore.captureElement(document.querySelector('button'),{mode:'pro',includeHidden:true})}));
    assert.doesNotMatch(JSON.stringify(result.safe),/restricted-copy/);assert.match(result.optin.html,/data-sourcepin-hidden="true"[^>]*>restricted-copy/);
    assert.ok(result.optin.degradations.some(s=>/hidden.*included|included.*hidden/i.test(s)));
  }finally{await page.close();}
});

test('budget-limited pages and stylesheet sampling explicitly report every boundary',async()=>{
  const page=await fixture('<style>'+Array.from({length:2005},(_,i)=>`.rule-${i}{color:red}`).join('')+'</style><main>'+Array.from({length:500},(_,i)=>`<div data-index="${i}">public content</div>`).join('')+'</main>');
  try{
    const captures=await page.evaluate(async()=>{
      const results=[];for(const maxBytes of [4096,16384,65536])results.push(await SourcePinCore.captureElement(document.body,{mode:'lite',kind:'page',maxBytes}));return results;
    });
    for(const capture of captures){
      assert.ok(Buffer.byteLength(capture.html+capture.css+JSON.stringify(capture.nodes))<=capture.meta.budgets.maxBytes);
      assert.ok(capture.degradations.some(note=>/byte budget/.test(note)));
      assert.ok(capture.degradations.some(note=>/CSSOM.*limit|stylesheet.*limit/i.test(note)));
      if(capture.capabilities.css.status==='absent')assert.match(capture.capabilities.css.reason,/No CSS.*budget/);
    }
  }finally{await page.close();}
});

test('template URLs and CSSOM declarations cannot bypass privacy filtering',async()=>{
  const page=await fixture('<style>#secret-token-identity{--api-key:CSS_CREDENTIAL_PRIVATE;position:absolute}</style><div id="secret-token-identity">Public</div><template><img src="/art?token=TEMPLATE_URL_PRIVATE" style="background:url(/bg?token=TEMPLATE_STYLE_PRIVATE)"></template>');
  try{
    const capture=await page.evaluate(()=>SourcePinCore.captureElement(document.body,{mode:'lite',kind:'page'}));
    assert.doesNotMatch(JSON.stringify(capture),/secret-token-identity|CSS_CREDENTIAL_PRIVATE|TEMPLATE_URL_PRIVATE|TEMPLATE_STYLE_PRIVATE/);
    assert.match(capture.html,/position:|<template/);assert.match(capture.html,/token=%5Bredacted%5D/);
  }finally{await page.close();}
});

test('attribute audit returns removed names without retaining sensitive values and records provenance',async()=>{
  const page=await fixture('<button onclick="bad()" data-token="AUDIT_SECRET" value="PRIVATE_VALUE" title="Public">Text</button>');
  try{
    const result=await page.evaluate(async()=>({audit:SourcePinCore.safeAttributes(document.querySelector('button')),capture:await SourcePinCore.captureElement(document.querySelector('button'),{mode:'pro'})}));
    assert.deepEqual(result.audit.attributes,{title:'Public'});
    assert.deepEqual(result.audit.removed.sort(),['data-token','onclick','value']);
    assert.doesNotMatch(JSON.stringify(result),/AUDIT_SECRET|PRIVATE_VALUE/);
    assert.match(result.capture.degradations.join('\n'),/data-token.*1/);
    assert.equal(result.capture.meta.toolVersion,'0.1.0');assert.match(result.capture.meta.rights,/不授予任何使用权/);
  }finally{await page.close();}
});

test('ancestor opacity is annotated separately and sampled styles are interned without expanding CSSOM work',async()=>{
 const page=await fixture('<style>'+Array.from({length:1500},(_,i)=>`.unused-${i}{color:red}`).join('')+'</style><main style="opacity:0"><span class="same">Same</span><span class="same">Same</span></main>');
 try{
 const result=await page.evaluate(async()=>{const target=document.querySelector('main span');const capture=await SourcePinCore.captureElement(document.querySelector('main'),{mode:'pro'});const child=await SourcePinCore.captureElement(target,{mode:'pro'});return {child,capture,shared:capture.nodes[1].styles===capture.nodes[2].styles};});
 assert.equal(result.child.target.visible,true);assert.equal(result.child.target.ancestorOpacityZero,true);assert.equal(result.capture.target.visible,false);assert.equal(result.shared,true);assert.match(result.capture.css,/\.sp-1,\.sp-2\{/);assert.match(result.capture.degradations.join('\n'),/visited 1500 rules, 0 candidate matches/);assert.match(result.capture.degradations.join('\n'),/500 nodes or 8 ms/);
 }finally{await page.close();}
});

test('page style signatures cover repeated deep nodes without exposing private signature inputs', async()=>{
 const page=await fixture('<style>article{padding:8px;color:rgb(20,60,40)}h2{font-size:24px}p{font-size:16px}</style><main>'+Array.from({length:500},(_,i)=>`<article data-row="${i}"><h2>Heading ${i}</h2><p>Text ${i}</p></article>`).join('')+'<div class="secret-PRIVATE_CLASS" style="--token:PRIVATE_STYLE;color:red">Public</div><div class="secret-OTHER_CLASS" style="--token:OTHER_STYLE;color:red">Public 2</div></main>');
 try{
  const capture=await page.evaluate(()=>SourcePinCore.captureElement(document.body,{kind:'page',mode:'lite'}));
  const sampled=capture.nodes.filter(n=>Object.keys(n.styles).length);
  const keys=new Set(sampled.map(n=>n.styleKey));
  const covered=capture.nodes.filter(n=>n.styleKey && keys.has(n.styleKey));
  assert.ok(covered.length/capture.nodes.length>=.8);
  assert.ok(sampled.length<30);
  assert.equal(new Set(capture.nodes.map(n=>n.key)).size,capture.nodes.length);
  assert.ok(capture.nodes.every(n=>/^sp-s-\d+$/.test(n.styleKey)));
  assert.equal(capture.nodes.at(-1).styleKey,capture.nodes.at(-2).styleKey);
  assert.doesNotMatch(JSON.stringify(capture),/PRIVATE_CLASS|PRIVATE_STYLE|OTHER_CLASS|OTHER_STYLE/);
  assert.match(capture.degradations.join('\n'),/representative.*approximation/i);
  assert.match(capture.capabilities.computedStyles.reason,/covered.*uncovered/i);
  const original=await page.locator('[data-row="499"] p').evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.color,s.display,s.padding]});
  await page.setContent(`<style>${capture.css}</style>${capture.html}`);
  assert.deepEqual(await page.locator('[data-row="499"] p').evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.color,s.display,s.padding]}),original);
 }finally{await page.close();}
});

test('capture style cache is per invocation and separates normal and pseudo styles',async()=>{
 const page=await fixture('<style>p::before{content:"Marker";color:red}</style><main><p>Text</p></main>');
 try{
  const result=await page.evaluate(async()=>{
   const original=window.getComputedStyle.bind(window),reads=new Map();
   window.getComputedStyle=(el,pseudo)=>{if(el.localName==='p'){const key=pseudo||'normal';reads.set(key,(reads.get(key)||0)+1)}return original(el,pseudo)};
   const first=await SourcePinCore.captureElement(document.body,{kind:'page',mode:'lite'});
   const counts=Object.fromEntries(reads);document.querySelector('p').style.color='rgb(1, 2, 3)';
   const second=await SourcePinCore.captureElement(document.body,{kind:'page',mode:'lite'});
   return {counts,first:first.nodes.find(n=>n.tag==='p'),second:second.nodes.find(n=>n.tag==='p')};
  });
  assert.equal(result.counts.normal,1);assert.equal(result.counts['::before'],1);assert.equal(result.counts['::after'],1);
  assert.equal(result.first.pseudo['::before'].color,'rgb(255, 0, 0)');
  assert.equal(result.second.styles.color,'rgb(1, 2, 3)');
 }finally{await page.close();}
});

test('srcset preserves CDN URL commas while sanitizing every candidate and rejecting bad descriptors',async()=>{
 const page=await fixture('<p>Srcset</p>');
 try{
  const result=await page.evaluate(()=>{
   const img=document.createElement('img');
   img.setAttribute('srcset','/cdn-cgi/image/width=128,quality=85,format=auto,fit=scale-down/https://cloud.example.com/a.webp 128w, /cdn-cgi/image/width=256,quality=85,format=auto,fit=scale-down/https://cloud.example.com/a.webp 256w');
   const cdn=SourcePinCore.safeAttributes(img).attributes.srcset;
   img.setAttribute('srcset','javascript:alert(1) 1x, data:text/html,<svg/onload=alert(1)> 2x, /safe.png?token=PRIVATE_URL 3x, /invalid.png 1x 2x, /bad.png calc(1, 2), /plain.png, /last.png 4x');
   return {cdn,safe:SourcePinCore.safeAttributes(img).attributes.srcset};
  });
  assert.equal((result.cdn.match(/https:\/\/fixture.test\//g)||[]).length,2);
  assert.equal((result.cdn.match(/cdn-cgi\/image\/width=/g)||[]).length,2);
  assert.doesNotMatch(result.cdn,/https:\/\/fixture.test\/(?:quality|format|fit)=/);
  assert.doesNotMatch(result.safe,/javascript|data:text|PRIVATE_URL|invalid.png|bad.png/);
  assert.match(result.safe,/token=%5Bredacted%5D 3x/);
  assert.match(result.safe,/plain.png, https:\/\/fixture.test\/last.png 4x/);
 }finally{await page.close();}
});

test('shared signatures in separate shadow roots preserve CSS and stay within the capture byte ceiling',async()=>{
 const page=await fixture('<main></main>');
 try{
  const result=await page.evaluate(async()=>{
   for(let i=0;i<80;i++){const host=document.createElement('widget-box');document.querySelector('main').append(host);host.attachShadow({mode:'open'}).innerHTML='<span style="padding:8px;color:rgb(20,60,40)">Shadow text</span>';}
   return SourcePinCore.captureElement(document.body,{kind:'page',mode:'lite',maxBytes:131072});
  });
  assert.ok(Buffer.byteLength(result.html+result.css+JSON.stringify(result.nodes))<=131072);
  assert.match(result.degradations.join('\n'),/byte budget/);
  const offline=await browser.newPage();
  await offline.setContent(`<style>${result.css}</style>${result.html}`);
  // setContent parses declarative shadow DOM; every exported root receives shared rules.
  const styles=await offline.locator('widget-box span').evaluateAll(nodes=>nodes.map(el=>[getComputedStyle(el).padding,getComputedStyle(el).color]));
  assert.ok(styles.length>1);assert.ok(styles.every(([padding,color])=>padding==='8px'&&color==='rgb(20, 60, 40)'));await offline.close();
 }finally{await page.close();}
});
