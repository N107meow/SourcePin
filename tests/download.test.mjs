import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

test('browser Markdown download passes through active picker without selecting the export link',async()=>{
  const built=await build({stdin:{contents:`import {startInspector} from './src/controller';import {createBrowserPlatform} from './src/platform/browser';import asset from './src/assets/robot.svg';const p=createBrowserPlatform('demo');p.loadSettings=async()=>({mode:'lite',language:'zh',maxNodes:300,maxDepth:6,onboardingDone:true});window.startTest=()=>startInspector(p,asset);`,resolveDir:process.cwd()},bundle:true,write:false,loader:{'.svg':'dataurl'}});
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({acceptDownloads:true});
    await page.setContent('<button data-testid="download-target">Export me</button>');
    await page.addScriptTag({content:built.outputFiles[0].text});await page.evaluate(()=>window.startTest());
    await page.getByTestId('download-target').click();
    await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.screen-status').textContent.includes('回查通过'));
    const received=page.waitForEvent('download',{timeout:3000});
    await page.locator('[data-sourcepin-root] .download').click();
    const download=await received;const text=await readFile(await download.path(),'utf8');
    assert.match(text,/download-target/);assert.match(download.suggestedFilename(),/\.md$/);
    assert.match(await page.locator('[data-sourcepin-root] .screen-summary').textContent(),/button/);
  }finally{await browser.close();}
});
