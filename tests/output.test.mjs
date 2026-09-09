import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const outdir = new URL('../.test-output/', import.meta.url);
let markdown;
let browser;

before(async () => {
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [new URL('../src/core/markdown.ts', import.meta.url).pathname],
    outdir: outdir.pathname,
    bundle: true,
    format: 'esm',
    platform: 'browser',
  });
  await build({
    entryPoints: [new URL('../src/core/recorder.ts', import.meta.url).pathname],
    outfile: `${outdir.pathname}recorder.js`,
    bundle: true,
    format: 'iife',
    globalName: 'SourcePinRecorder',
    platform: 'browser',
  });
  markdown = await import(`${pathToFileURL(`${outdir.pathname}markdown.js`)}?v=${Date.now()}`);
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await rm(outdir, { recursive: true, force: true });
});

function capture(overrides = {}) {
  return {
    id: 'cap-1', timestamp: '2026-09-09T00:00:00.000Z', mode: 'pro',
    meta: { url: 'https://example.test/path?token=redacted', title: 'Example', viewport: { width: 1280, height: 720 }, dpr: 2, scroll: { x: 0, y: 10 }, reach: ['document'] },
    target: { tag: 'button', text: 'Save', attributes: { class: 'primary' }, ancestors: ['main'], childIndex: 0, typeIndex: 0, siblingCount: 1, rect: { x: 10, y: 20, width: 100, height: 40 }, visible: true, inViewport: true },
    locators: [{ kind: 'css', value: '[data-testid="save"]', stability: 'stable', matches: 1, verified: true }],
    nodes: [{ key: 'sp-1', depth: 0, tag: 'button', attributes: { class: 'primary' }, text: 'Save', styles: { color: 'rgb(0, 0, 0)' }, rect: { x: 10, y: 20, width: 100, height: 40 }, pseudo: {} }],
    html: '<button class="sp-1">Save</button>', css: '.sp-1 { color: rgb(0, 0, 0); }',
    tokens: { colors: ['#000000'] }, assets: [], animations: [],
    degradations: ['Source file and line are unavailable on this rendered page.'],
    ...overrides,
  };
}

const sections = ['Meta', 'Locators', 'Structure', 'Cleaned HTML', 'Scoped CSS', 'Pseudo Elements', 'Design Tokens', 'Geometry', 'Assets', 'Animations', 'A11y', 'Component', 'Interaction States', 'State Machine', 'Animation Spec', 'Behavior Contract', 'Reference Impl', 'Degradations'];

test('Pro export contains the complete 18-section reproduction package', () => {
  const output = markdown.renderMarkdown([capture()]);
  assert.deepEqual([...output.matchAll(/^## (.+)$/gm)].map((match) => match[1]), sections);
});

test('Lite export is a concise element snapshot', () => {
  const output = markdown.renderMarkdown([capture({ mode: 'lite' })]);
  assert.deepEqual([...output.matchAll(/^## (.+)$/gm)].map((match) => match[1]), ['Meta', 'Target', 'Locators', 'Reach Path', 'Context', 'Geometry', 'Framework', 'Degradations']);
  assert.doesNotMatch(output, /^## Cleaned HTML$/m);
});

test('captured backticks remain data and every code fence closes', () => {
  const output = markdown.renderMarkdown([capture({ html: '<pre>````danger</pre>', css: '.x::after { content: "```"; }' })]);
  const fences = output.match(/^`{3,}[^\n]*$/gm) ?? [];
  assert.equal(fences.length % 2, 0);
  assert.match(output, /````danger/);
  assert.match(output, /content: "```"/);
});

test('summary stays within the 15 KB UTF-8 budget without breaking fences', () => {
  const huge = '汉🙂'.repeat(20_000);
  const output = markdown.renderMarkdown([capture({ html: `<div>${huge}</div>`, css: `.x { content: "${huge}"; }` })], { summary: true, language: 'en' });
  assert.ok(new TextEncoder().encode(output).byteLength <= 15 * 1024);
  assert.equal((output.match(/^`{3,}[^\n]*$/gm) ?? []).length % 2, 0);
  assert.match(output, /omitted|省略/i);
});

test('large Pro summary preserves target and locator before bounded structure', () => {
  const hugeNodes = Array.from({ length: 300 }, (_, index) => ({ ...capture().nodes[0], key: `sp-${index}`, depth: index % 7, text: `node-${index}-${'汉🙂'.repeat(100)}` }));
  const output = markdown.renderMarkdown([capture({ nodes: hugeNodes, html: 'x'.repeat(100_000), css: 'y'.repeat(100_000) })], { summary: true, language: 'en' });
  assert.ok(new TextEncoder().encode(output).byteLength <= 15 * 1024);
  assert.match(output, /Save/);
  assert.match(output, /\[data-testid=\\"save\\"\]/);
  assert.match(output, /sp-0/);
  assert.doesNotMatch(output, /sp-299/);
});

test('export only names a saved file when the caller confirms one', () => {
  assert.doesNotMatch(markdown.renderMarkdown([capture()]), /saved|已保存|\.md\b/i);
  assert.match(markdown.renderMarkdown([capture()], { savedFilename: 'sourcepin-export.md' }), /sourcepin-export\.md/);
});

test('empty and canvas exports describe unavailable source and 3D details honestly', () => {
  assert.match(markdown.renderMarkdown([]), /No capture|没有采集/i);
  const output = markdown.renderMarkdown([capture({ target: { ...capture().target, tag: 'canvas' }, html: '<canvas class="sp-1"></canvas>' })]);
  assert.match(output, /source.*unavailable|源码.*不可得/i);
  assert.match(output, /3D.*(?:not inspected|未探测)/i);
});

test('recorder observes hover, focus and mutations, then stops cleanly', async () => {
  const page = await browser.newPage();
  await page.setContent('<style>#target { color: rgb(0, 0, 0); transition: color 20ms } #target:hover { color: rgb(255, 0, 0) } #target:active { opacity: .5 }</style><button id="target">Record</button><input id="other">');
  await page.addScriptTag({ path: `${outdir.pathname}recorder.js` });
  await page.evaluate(() => { window.recorder = SourcePinRecorder.createRecorder(document.querySelector('#target')); });
  await page.evaluate(() => {
    const target = document.querySelector('#target');
    target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
  });
  await page.waitForTimeout(60);
  assert.equal((await page.evaluate(() => window.recorder.snapshot())).states.some((state) => state.condition.startsWith('hover:settled')), false);
  await page.hover('#target');
  await page.waitForTimeout(60);
  await page.focus('#target');
  await page.mouse.down();
  await page.mouse.up();
  await page.evaluate(() => document.querySelector('#target').setAttribute('aria-expanded', 'true'));
  await page.waitForTimeout(60);
  const recording = await page.evaluate(() => window.recorder.stop());
  assert.ok(recording.states.some((state) => state.condition.startsWith('hover @')));
  assert.ok(recording.states.some((state) => state.condition.startsWith('hover:settled @')));
  assert.ok(recording.states.some((state) => state.condition.startsWith('focus @')));
  assert.ok(recording.states.some((state) => state.condition.startsWith('active @')));
  assert.ok(recording.transitions.some((transition) => transition.styleDelta.color === 'rgb(255, 0, 0)'));
  assert.ok(recording.transitions.some((transition) => transition.event === 'mutation'));
  const count = recording.states.length;
  await page.evaluate(() => document.querySelector('#target').classList.add('after-stop'));
  await page.waitForTimeout(20);
  assert.equal((await page.evaluate(() => window.recorder.snapshot().states.length)), count);
});

test('recorder reports a detached target and cancels pending samples', async () => {
  const page = await browser.newPage();
  await page.setContent('<button id="target" style="transition: opacity 1s">Detach</button>');
  await page.addScriptTag({ path: `${outdir.pathname}recorder.js` });
  const recording = await page.evaluate(async () => {
    const target = document.querySelector('#target');
    const recorder = SourcePinRecorder.createRecorder(target);
    target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    target.remove();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return recorder.snapshot();
  });
  assert.ok(recording.degradations.some((message) => /detached/i.test(message)));
  assert.equal(recording.states.some((state) => state.condition.endsWith(':settled')), false);
});

test('recorder leaves pre-start hover unobserved and cancels active after release outside', async () => {
  const page = await browser.newPage();
  await page.setContent('<style>#target { transition: opacity 80ms } #target:active { opacity: .2 }</style><button id="target">Press</button><div id="outside">Outside</div>');
  await page.addScriptTag({ path: `${outdir.pathname}recorder.js` });
  await page.hover('#target');
  await page.evaluate(() => { window.recorder = SourcePinRecorder.createRecorder(document.querySelector('#target')); });
  const initial = await page.evaluate(() => window.recorder.snapshot());
  assert.match(initial.states[0].condition, /^base @ viewport \d+x\d+; observed initial$/);
  assert.ok(initial.degradations.some((message) => message === 'Initial hover state was unobserved.'));
  await page.mouse.down();
  await page.hover('#outside');
  await page.mouse.up();
  await page.waitForTimeout(140);
  const recording = await page.evaluate(() => window.recorder.stop());
  assert.ok(recording.states.some((state) => state.condition.startsWith('released @')));
  assert.equal(recording.states.some((state) => state.condition.startsWith('active:settled')), false);
});

test('recorder initial hover reflects the real pointer rather than the element center', async () => {
  const page = await browser.newPage();
  await page.setContent('<button id="target" style="position:fixed;left:200px;top:200px;width:100px;height:40px">Target</button><div id="outside" style="position:fixed;left:0;top:0;width:100px;height:100px">Outside</div>');
  await page.addScriptTag({ path: `${outdir.pathname}recorder.js` });
  await page.mouse.move(20, 20);
  const initial = await page.evaluate(() => {
    const recorder = SourcePinRecorder.createRecorder(document.querySelector('#target'));
    return recorder.stop().states[0];
  });
  assert.match(initial.condition, /^base @ viewport \d+x\d+; observed initial$/);
});

test('recorder releases only a pointer gesture that started on the target', async () => {
  const page = await browser.newPage();
  await page.setContent('<button id="target">Target</button><div id="outside">Outside</div>');
  await page.addScriptTag({ path: `${outdir.pathname}recorder.js` });
  const result = await page.evaluate(() => {
    const target = document.querySelector('#target');
    const outside = document.querySelector('#outside');
    const recorder = SourcePinRecorder.createRecorder(target);
    outside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
    const afterUnrelated = recorder.snapshot().states.filter((state) => state.condition.startsWith('released')).length;
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    outside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8 }));
    const afterWrongPointer = recorder.snapshot().states.filter((state) => state.condition.startsWith('released')).length;
    outside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    const recording = recorder.stop();
    return { afterUnrelated, afterWrongPointer, released: recording.states.filter((state) => state.condition.startsWith('released')).length };
  });
  assert.deepEqual(result, { afterUnrelated: 0, afterWrongPointer: 0, released: 1 });
});

test('mutation details contain bounded old/new values and exclude tool UI and secret text', async () => {
  const page = await browser.newPage();
  await page.setContent('<main id="target"><span class="old">public</span></main>');
  await page.addScriptTag({ path: `${outdir.pathname}recorder.js` });
  const recording = await page.evaluate(async () => {
    const target = document.querySelector('#target');
    const recorder = SourcePinRecorder.createRecorder(target);
    const span = target.querySelector('span');
    span.className = 'new';
    span.setAttribute('aria-expanded', 'true');
    span.firstChild.data = 'password=super-secret';
    const tool = document.createElement('div');
    tool.dataset.sourcepinUi = 'true';
    target.append(tool);
    tool.className = 'noise';
    await new Promise((resolve) => setTimeout(resolve, 20));
    return recorder.stop();
  });
  const mutation = recording.transitions.find((transition) => transition.event === 'mutation');
  assert.ok(mutation);
  assert.match(mutation.changes.join('\n'), /span\.new.*class.*old.*new/i);
  assert.match(mutation.changes.join('\n'), /aria-expanded.*null.*true/i);
  assert.doesNotMatch(mutation.changes.join('\n'), /super-secret|noise|sourcepin/i);
  assert.match(mutation.target, /span/);
});

test('long transitions are reported as timeout rather than settled', async () => {
  const page = await browser.newPage();
  await page.setContent('<style>#target { opacity: 1; transition: opacity 3s } #target:hover { opacity: .2 }</style><button id="target">Slow</button>');
  await page.addScriptTag({ path: `${outdir.pathname}recorder.js` });
  await page.evaluate(() => { window.recorder = SourcePinRecorder.createRecorder(document.querySelector('#target')); });
  await page.hover('#target');
  await page.waitForTimeout(1250);
  const recording = await page.evaluate(() => window.recorder.stop());
  assert.ok(recording.states.some((state) => state.condition.startsWith('hover:timeout')));
  assert.equal(recording.states.some((state) => state.condition.startsWith('hover:settled')), false);
  assert.ok(recording.degradations.some((message) => /timeout/i.test(message)));
});
