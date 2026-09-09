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
  await page.route('https://fixture.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
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
    assert.doesNotMatch(JSON.stringify(capture), /style-secret|foreign secret|srcdoc secret|owned secret|ui secret|inspector secret|input secret|onfocus|srcdoc|srcset|<style|<object|<embed|foreignObject/i);
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

test('serialized direct text is bounded per node and omits form-control defaults', async () => {
  const page = await fixture(`<section id="text"><textarea>textarea secret</textarea><select><option>option secret</option></select><p>${'x'.repeat(200)}<span>middle</span>${'y'.repeat(80)}</p></section>`);
  try {
    const capture = await page.evaluate(() => SourcePinCore.captureElement(document.querySelector('#text'), { mode: 'pro' }));
    assert.doesNotMatch(capture.html, /textarea secret|option secret/);
    const paragraph = capture.html.match(/<p[^>]*>(.*?)<\/p>/)?.[1] ?? '';
    const directText = paragraph.replace(/<span[^>]*>.*?<\/span>/, '');
    assert.equal(directText.length, 120);
    assert.match(paragraph, new RegExp(`^${'x'.repeat(120)}<span[^>]*>middle</span>$`));
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

test('Lite captures only the target while Pro reports depth truncation', async () => {
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
