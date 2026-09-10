import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

let browser;
let bundle;
let robotAsset;

test.before(async () => {
  const result = await build({
    entryPoints: ['src/ui/inspector.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'SourcePinUI',
    write: false,
  });
  bundle = result.outputFiles[0].text;
  robotAsset = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await readFile('src/assets/robot.svg', 'utf8'))}`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => browser?.close());

async function fixture(viewport = { width: 900, height: 700 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.setContent('<style>button{all:unset!important}</style><main>page</main>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(assetUrl => {
    window.calls = [];
    window.ui = SourcePinUI.createUI({
      copy: () => calls.push(['copy']),
      download: () => calls.push(['download']),
      close: () => calls.push(['close']),
      repick: () => calls.push(['repick']),
      settings: value => calls.push(['settings', value]),
      record: () => calls.push(['record']),
      screenshot: component => calls.push(['screenshot', component]),
      wholePage: () => calls.push(['wholePage']),
      addViewport: () => calls.push(['addViewport']),
    }, {
      mode: 'lite', status: '选择一个元素', count: 0, summary: '', copied: false,
      busy: false, recording: false, matched: false, markdown: '# Capture',
      settings: { mode: 'lite', language: 'zh', maxNodes: 300, maxDepth: 6, onboardingDone: true },
    }, assetUrl);
  }, robotAsset);
  return page;
}

test('isolates controls in shadow DOM and routes primary actions', async () => {
  const page = await fixture();
  assert.equal(await page.locator('sourcepin-inspector').count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('sourcepin-inspector').querySelectorAll('button').length), 0);
  await page.getByRole('button', { name: '复制 Markdown' }).click();
  await page.getByRole('button', { name: '下载 Markdown' }).click();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '重新选择元素' }).click();
  assert.deepEqual(await page.evaluate(() => calls), [['copy'], ['download'], ['repick']]);
});

test('mode, settings, recording, preview and capture controls use exact callbacks', async () => {
  const page = await fixture();
  await page.getByRole('button', { name: '选择 Lite 或 Pro 模式' }).click();
  const modeSwitch = page.getByRole('switch', { name: '切换 Lite 或 Pro 模式' });
  await expectVisible(modeSwitch);
  await modeSwitch.click();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.locator('sourcepin-inspector select[name="language"]').selectOption('en');
  await page.locator('sourcepin-inspector input[name="maxNodes"]').fill('450');
  await page.locator('sourcepin-inspector input[name="maxDepth"]').fill('8');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Open capture' }).click();
  await page.getByRole('button', { name: 'Capture component' }).click();
  await page.getByRole('button', { name: 'Capture viewport' }).click();
  await page.getByRole('button', { name: 'Capture whole-page DOM' }).click();
  await page.getByRole('button', { name: 'Preview capture' }).press('Enter');
  const calls = await page.evaluate(() => window.calls);
  assert.deepEqual(calls[0], ['settings', { mode: 'pro', language: 'zh', maxNodes: 300, maxDepth: 6, onboardingDone: true }]);
  const settingsCalls = calls.filter(([name]) => name === 'settings');
  assert.deepEqual(settingsCalls.at(-1), ['settings', { mode: 'lite', language: 'en', maxNodes: 450, maxDepth: 8, onboardingDone: true }]);
  assert.deepEqual(calls.filter(([name]) => name !== 'settings'), [['record'], ['screenshot', true], ['screenshot', false], ['wholePage']]);
  assert.equal(await page.locator('sourcepin-inspector').evaluate(host => !host.shadowRoot.querySelector('[data-panel="preview"]').hidden), true);
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'Preview capture' }).dblclick();
  assert.equal(await page.locator('sourcepin-inspector [data-panel="preview"]').isVisible(), true);
});

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.isVisible(), true);
}

test('screen content, match state and localized labels follow the visible state', async () => {
  const page = await fixture();
  const screen = page.locator('sourcepin-inspector .screen');
  await expectVisible(page.getByRole('button', { name: '预览捕获内容' }));
  assert.equal(await screen.textContent(), '');

  await page.evaluate(() => ui.update({ mode: 'lite', status: '已选择', count: 1, summary: 'button · 提交', copied: false,
    busy: false, recording: false, matched: true, markdown: '# Capture',
    settings: { mode: 'lite', language: 'zh', maxNodes: 300, maxDepth: 6, onboardingDone: true } }));
  assert.match(await screen.textContent(), /定位准确/);
  assert.match(await screen.textContent(), /button · 提交/);

  await page.evaluate(() => ui.update({ mode: 'lite', status: 'Selected', count: 3, summary: 'x'.repeat(81), copied: false,
    busy: false, recording: false, matched: false, markdown: '# Capture',
    settings: { mode: 'lite', language: 'en', maxNodes: 300, maxDepth: 6, onboardingDone: true } }));
  assert.equal((await screen.textContent()).trim(), '3');
  assert.equal(await page.getByRole('button', { name: 'Open settings' }).isVisible(), true);
});

test('onboarding shows actual defaults and closes as soon as the user starts', async () => {
  const page = await fixture();
  await page.evaluate(() => ui.update({ mode: 'lite', status: '选择一个元素', count: 0, summary: '', copied: false,
    busy: false, recording: false, matched: false, markdown: '',
    settings: { mode: 'lite', language: 'zh', maxNodes: 300, maxDepth: 6, onboardingDone: false } }));
  const onboarding = page.locator('sourcepin-inspector [data-panel="onboarding"]');
  await expectVisible(onboarding);
  assert.match(await onboarding.textContent(), /Lite 模式、中文输出并手动开始状态录制/);
  assert.equal(await onboarding.locator('input[type="checkbox"]').count(), 0);
  await page.getByRole('button', { name: '开始选择' }).click();
  assert.equal(await onboarding.isHidden(), true);
  assert.deepEqual((await page.evaluate(() => calls)).at(-1), ['settings', { mode: 'lite', language: 'zh', maxNodes: 300, maxDepth: 6, onboardingDone: true }]);
});

test('dragging keeps the robot and open panels inside wide and narrow viewports', async () => {
  for (const viewport of [{ width: 900, height: 700 }, { width: 320, height: 420 }]) {
    const page = await fixture(viewport);
    await page.getByRole('button', { name: '打开设置' }).click();
    const handle = page.getByRole('button', { name: '拖动 SourcePin' });
    for (const point of [{ x: 1, y: 1 }, { x: viewport.width - 1, y: 1 }, { x: 1, y: viewport.height - 1 }, { x: viewport.width - 1, y: viewport.height - 1 }]) {
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(point.x, point.y, { steps: 3 });
      await page.mouse.up();
      const bounds = await page.locator('sourcepin-inspector').evaluate(host => {
        const robot = host.shadowRoot.querySelector('.stage').getBoundingClientRect();
        const panel = host.shadowRoot.querySelector('[data-panel="settings"]').getBoundingClientRect();
        return { robot: [robot.left, robot.top, robot.right, robot.bottom], panel: [panel.left, panel.top, panel.right, panel.bottom] };
      });
      for (const rect of [bounds.robot, bounds.panel]) {
        assert.ok(rect[0] >= 0 && rect[1] >= 0 && rect[2] <= viewport.width && rect[3] <= viewport.height, `${viewport.width}x${viewport.height}: ${rect}`);
      }
    }
    await page.close();
  }
});

test('update, overlays, containment, viewport constraints and lifecycle are stateful', async () => {
  const page = await fixture({ width: 320, height: 420 });
  const result = await page.evaluate(() => {
    ui.update({ mode: 'pro', status: '已复制', count: 2, summary: 'button · Submit', copied: true,
      busy: false, recording: true, matched: true, markdown: 'full output',
      settings: { mode: 'pro', language: 'zh', maxNodes: 300, maxDepth: 6, onboardingDone: true } });
    ui.highlight({ x: 20, y: 30, width: 100, height: 24 }, 'button 100×24', true, '#ff0060');
    ui.selections([{ x: 5, y: 40, width: 30, height: 20 }, { x: 50, y: 40, width: 30, height: 20 }]);
    ui.toast('Copied');
    const hostRect = ui.host.getBoundingClientRect();
    const highlightRect = ui.host.shadowRoot.querySelector('.highlight').getBoundingClientRect();
    let inside = false;
    ui.host.shadowRoot.querySelector('.screen').addEventListener('sourcepin-probe', event => { inside = ui.contains(event); });
    ui.host.shadowRoot.querySelector('.screen').dispatchEvent(new Event('sourcepin-probe', { bubbles: true, composed: true }));
    const externalEvent = new Event('click', { composed: true });
    document.body.dispatchEvent(externalEvent);
    return {
      mode: ui.host.shadowRoot.querySelector('.robot').dataset.mode,
      copied: ui.host.shadowRoot.querySelector('[data-action="copy"]').dataset.copied,
      summary: ui.host.shadowRoot.querySelector('.screen-summary').textContent,
      rects: ui.host.shadowRoot.querySelectorAll('.selection').length,
      highlight: ui.host.shadowRoot.querySelector('.highlight').hidden,
      toast: ui.host.shadowRoot.querySelector('.toast').textContent,
      bounded: hostRect.left >= 0 && hostRect.top >= 0 && hostRect.right <= innerWidth && hostRect.bottom <= innerHeight,
      highlightPosition: [highlightRect.x, highlightRect.y],
      external: ui.contains(externalEvent), inside,
    };
  });
  assert.deepEqual(result, { mode: 'pro', copied: 'true', summary: 'button · Submit', rects: 2, highlight: false, toast: 'Copied', bounded: true, highlightPosition: [20, 30], external: false, inside: true });
  if (process.env.SOURCEPIN_UI_SCREENSHOT) await page.screenshot({ path: process.env.SOURCEPIN_UI_SCREENSHOT });
  await page.evaluate(() => ui.destroy());
  assert.equal(await page.locator('sourcepin-inspector').count(), 0);
});

test('reference switch stays below the robot at exact track, thumb and label sizes',async()=>{
  const page=await fixture();
  await page.locator('.gear').click();
  const result=await page.locator('.mode-switch').evaluate(el=>{
    const s=getComputedStyle(el),thumb=getComputedStyle(el,'::after');const root=el.getRootNode();
    const label=root.querySelector('.mode-label');const art=root.querySelector('.asset');
    return {visible:el.checkVisibility(),size:[el.offsetWidth,el.offsetHeight],border:s.boxShadow.match(/([\d.]+)px inset$/)?.[1],thumb:[thumb.width,thumb.height,thumb.borderTopWidth],font:getComputedStyle(label).fontSize,below:el.getBoundingClientRect().top>=art.getBoundingClientRect().bottom,labelBelow:label.getBoundingClientRect().top>=el.getBoundingClientRect().bottom};
  });
  assert.deepEqual(result,{visible:true,size:[44,22],border:'2.5',thumb:['15px','15px','2px'],font:'9px',below:true,labelBelow:true});
  await page.close();
});

test('press animates the visible vector button and respects reduced motion',async()=>{
  const page=await fixture();
  await page.waitForFunction(()=>document.querySelector('sourcepin-inspector').shadowRoot.querySelector('.asset-lite')?.tagName.toLowerCase()==='svg');
  const circle=page.locator('.asset-lite [id="Vector_9"]');
  const button=page.locator('.copy');const box=await button.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.waitForTimeout(100);
  assert.notEqual(await circle.evaluate(el=>getComputedStyle(el).transform),'none');
  await page.mouse.up();await page.waitForTimeout(400);
  assert.equal(await circle.evaluate(el=>getComputedStyle(el).transform),'none');
  await page.emulateMedia({reducedMotion:'reduce'});await button.click();
  assert.equal(await circle.evaluate(el=>el.getAnimations().length),0);
  await page.close();
});

test('only the active vector theme is visible so the body shadow is drawn once',async()=>{
  const page=await fixture();await page.locator('svg.asset-lite').waitFor();
  assert.equal(await page.locator('.asset-lite').isVisible(),true);
  assert.equal(await page.locator('.asset-pro').isVisible(),false);
  assert.equal(await page.locator('.asset-lite [id="Vector"]').getAttribute('fill'),'#59AC9D');
  await page.evaluate(()=>ui.update({mode:'pro',status:'',count:0,summary:'',copied:false,busy:false,recording:false,matched:false,markdown:'',settings:{mode:'pro',language:'zh',maxNodes:300,maxDepth:6,onboardingDone:true}}));
  assert.equal(await page.locator('.asset-lite').isVisible(),false);
  assert.equal(await page.locator('.asset-pro').isVisible(),true);
  await page.close();
});

test('Lite and Pro use the same single-pass shadow opacity',async()=>{
  const page=await fixture();await page.locator('svg.asset-lite').waitFor();
  const pixel=async()=>{
    const png=await page.screenshot({clip:await page.locator('.stage').boundingBox()});
    return page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const c=canvas.getContext('2d');c.drawImage(img,0,0);return [...c.getImageData(394,312,1,1).data];},'data:image/png;base64,'+png.toString('base64'));
  };
  const lite=await pixel();
  await page.evaluate(()=>ui.update({mode:'pro',status:'',count:0,summary:'',copied:false,busy:false,recording:false,matched:false,markdown:'',settings:{mode:'pro',language:'zh',maxNodes:300,maxDepth:6,onboardingDone:true}}));
  const pro=await pixel();assert.deepEqual(pro,lite);assert.ok(lite[0]>170&&lite[0]<220);
  await page.close();
});

test('gear alone toggles the mode picker and preview matches the console above it',async()=>{
  const page=await fixture();
  assert.equal(await page.locator('.mode-picker').isVisible(),false);
  await page.locator('.settings-button').click();
  assert.equal(await page.locator('.mode-picker').isVisible(),false);
  await page.locator('.gear').click();assert.equal(await page.locator('.mode-picker').isVisible(),true);
  await page.locator('.settings-button').click();assert.equal(await page.locator('.mode-picker').isVisible(),true);
  await page.locator('.gear').click();assert.equal(await page.locator('.mode-picker').isVisible(),false);
  await page.locator('.screen').click();
  const panel=page.locator('[data-panel="preview"]');await expectVisible(panel);
  const bounds=await panel.boundingBox(),asset=await page.locator('.asset-lite').boundingBox();
  assert.equal(bounds.width,asset.width);assert.equal(bounds.height,asset.height);
  assert.equal(bounds.x,asset.x);assert.equal(bounds.y+bounds.height+8,asset.y);
  await page.setViewportSize({width:320,height:420});
  await page.waitForTimeout(40);
  const small=await panel.boundingBox(),smallAsset=await page.locator('.asset-lite').boundingBox();
  assert.ok(small.x>=8 && small.y>=8 && small.x+small.width<=312);
  assert.ok(small.y+small.height+8<=smallAsset.y+.5);
});
