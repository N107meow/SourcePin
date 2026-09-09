import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('picker selects without invoking page, copies only on command, respects editable focus and cleans up', async()=>{
  const result=await build({stdin:{contents:`import {startInspector} from './src/controller';import asset from './src/assets/robot.svg';window.startTest=()=>startInspector({kind:'demo',loadSettings:async()=>({mode:'lite',language:'zh',maxNodes:300,maxDepth:6,onboardingDone:true}),saveSettings:async()=>{},copy:async(text)=>{window.copied=text},download:async()=>''},asset,()=>{window.closedInspector=true});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',loader:{'.svg':'dataurl'}});
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<button data-testid="chosen" onclick="window.clicked=true">Select this</button><input id="edit" value="private-value">');
    await page.addScriptTag({content:result.outputFiles[0].text});
    await page.evaluate(()=>window.startTest());
    await page.getByTestId('chosen').click();
    await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]')?.shadowRoot?.textContent?.includes('button'));
    assert.equal(await page.evaluate(()=>window.clicked),undefined);
    assert.equal(await page.evaluate(()=>window.copied),undefined);
    await page.keyboard.press('Control+c');
    await page.waitForFunction(()=>!!window.copied);
    assert.match(await page.evaluate(()=>window.copied),/chosen/);
    await page.evaluate(()=>{window.copied='unchanged';document.querySelector('#edit').focus();});
    await page.keyboard.press('Control+c');
    assert.equal(await page.evaluate(()=>window.copied),'unchanged');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-sourcepin-root]').count(),1);
    assert.equal(await page.locator('.screen-count').textContent(),'');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-sourcepin-root]').count(),0);
    assert.equal(await page.evaluate(()=>window.closedInspector),true);
    await page.getByTestId('chosen').click();
    assert.equal(await page.evaluate(()=>window.clicked),true);
  } finally { await browser.close(); }
});

async function controllerFixture(mode='pro', framework='undefined') {
  const result=await build({stdin:{contents:`import {startInspector} from './src/controller';import asset from './src/assets/robot.svg';window.startTest=()=>startInspector({kind:'demo',loadSettings:async()=>({mode:'${mode}',language:'zh',maxNodes:1000,maxDepth:6,onboardingDone:true}),saveSettings:async()=>{},copy:async(text)=>{window.copied=text},download:async(text)=>{window.downloaded=text;return 'saved'},framework:${framework}},asset);`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',loader:{'.svg':'dataurl'}});
  return result.outputFiles[0].text;
}
const settled=page=>page.waitForFunction(()=>!document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').classList.contains('busy'));

test('repick cancels an in-flight capture and ignores its late result',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();await page.setContent('<button data-testid="slow">Slow</button>');
    await page.addScriptTag({content:await controllerFixture('lite','async()=>new Promise(resolve=>{window.finishFramework=resolve})')});
    await page.evaluate(()=>window.startTest());await page.getByTestId('slow').click();
    await page.waitForFunction(()=>!!window.finishFramework);
    await page.locator('[data-action="settings-panel"]').click();await page.locator('[data-action="repick"]').click();
    assert.equal(await page.locator('.robot').evaluate(el=>el.classList.contains('busy')),false);
    await page.evaluate(()=>window.finishFramework(undefined));await page.waitForTimeout(50);
    assert.equal(await page.locator('.screen-count').textContent(),'');
  }finally{await browser.close();}
});

test('multi-select retains all roots within a combined 600-node budget',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();await page.setContent('<style>section{padding:20px;min-height:50px}span{display:none}</style>'+Array.from({length:3},(_,i)=>`<section data-testid="root-${i}">Root ${i}${i===0?'<span>node</span>'.repeat(620):''}</section>`).join(''));
    await page.addScriptTag({content:await controllerFixture()});await page.evaluate(()=>window.startTest());
    for(let i=0;i<3;i++){await page.getByTestId(`root-${i}`).click({position:{x:10,y:10},modifiers:i?['Shift']:[]});await settled(page);}
    await page.locator('.download').click();await page.waitForFunction(()=>!!window.downloaded);
    const md=await page.evaluate(()=>window.downloaded);const html=md.split('## Cleaned HTML\n')[1].split('## Scoped CSS\n')[0];
    assert.equal((html.match(/class="sp-/g)||[]).length,600);
    for(let i=0;i<3;i++)assert.match(html,new RegExp(`root-${i}`));
  }finally{await browser.close();}
});

test('Shift multi-selection remains copyable after browser range selection',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();await page.setContent('<p data-testid="first">First paragraph</p><p data-testid="second">Second paragraph</p>');
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    await page.getByTestId('first').click();await settled(page);
    await page.getByTestId('second').click({modifiers:['Shift']});await settled(page);
    await page.keyboard.press('Control+c');await page.waitForTimeout(50);
    assert.match((await page.evaluate(()=>window.copied))||'',/first/);
    assert.match((await page.evaluate(()=>window.copied))||'',/second/);
  }finally{await browser.close();}
});

test('hover highlight clears when pointer enters inspector controls',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<p data-testid="hover">Hover target</p>');
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    await page.getByTestId('hover').hover();await page.waitForTimeout(30);
    assert.equal(await page.locator('.highlight').isVisible(),true);
    await page.locator('.gear').hover();await page.waitForTimeout(30);
    assert.equal(await page.locator('.highlight').isVisible(),false);
  }finally{await browser.close();}
});


test('Escape cancels selection and panels, ignores repeat, and rearms after selecting again',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<button data-testid="escape">Choose</button>');
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    await page.getByTestId('escape').click();await settled(page);
    await page.locator('[data-action="settings-panel"]').click();
    await page.keyboard.down('Escape');await page.keyboard.down('Escape');await page.keyboard.up('Escape');
    assert.equal(await page.locator('.screen-count').textContent(),'');
    assert.equal(await page.locator('[data-panel="settings"]').isVisible(),false);
    assert.equal(await page.locator('[data-sourcepin-root]').count(),1);
    await page.getByTestId('escape').click();await settled(page);
    await page.keyboard.press('Escape');assert.equal(await page.locator('[data-sourcepin-root]').count(),1);
    await page.keyboard.press('Escape');assert.equal(await page.locator('[data-sourcepin-root]').count(),0);
  }finally{await browser.close();}
});
