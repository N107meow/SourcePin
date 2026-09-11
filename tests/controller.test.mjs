import { confirmExport } from './helpers/export.mjs';
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
    await page.keyboard.press('Control+c');await confirmExport(page);
    await page.waitForFunction(()=>!!window.copied);
    assert.match(await page.evaluate(()=>window.copied),/chosen/);
    await page.evaluate(()=>{window.copied='unchanged';document.querySelector('#edit').focus();});
    await page.keyboard.press('Control+c');
    assert.equal(await page.evaluate(()=>window.copied),'unchanged');
    // Press until the tool actually leaves; Chromium can coalesce synthesized
    // keys, and the tour panel can absorb one press before the exit arms.
    for(let attempt=0;attempt<4;attempt++){
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
      if(await page.locator('[data-sourcepin-root]').count()===0)break;
    }
    assert.equal(await page.locator('[data-sourcepin-root]').count(),0);
    assert.equal(await page.evaluate(()=>window.closedInspector),true);
    await page.getByTestId('chosen').click();
    assert.equal(await page.evaluate(()=>window.clicked),true);
  } finally { await browser.close(); }
});

async function controllerFixture(mode='pro', framework='undefined', screenshot=false) {
  const result=await build({stdin:{contents:`import {startInspector} from './src/controller';import asset from './src/assets/robot.svg';window.startTest=()=>startInspector({kind:'demo',loadSettings:async()=>({mode:'${mode}',language:'zh',maxNodes:1000,maxDepth:6,onboardingDone:true}),saveSettings:async()=>{},copy:async(text)=>{window.copied=text},download:async(text)=>{window.downloaded=typeof text==='string'?text:await text.text();return 'saved'},${screenshot?"screenshot:async()=>'已保存截图',":''}framework:${framework}},asset);`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',loader:{'.svg':'dataurl'}});
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
    const page=await browser.newPage();await page.setContent('<style>section{padding:20px;min-height:50px}span{display:inline}</style>'+Array.from({length:3},(_,i)=>`<section data-testid="root-${i}">Root ${i}${i===0?'<span>node</span>'.repeat(620):''}</section>`).join(''));
    await page.addScriptTag({content:await controllerFixture()});await page.evaluate(()=>window.startTest());
    for(let i=0;i<3;i++){await page.getByTestId(`root-${i}`).click({position:{x:10,y:10},modifiers:i?['Shift']:[]});await settled(page);}
    await page.locator('.download').click();await confirmExport(page);await page.waitForFunction(()=>!!window.downloaded);
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
    await page.keyboard.press('Control+c');await confirmExport(page);await page.waitForTimeout(50);
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


test('Escape unwinds one layer at a time: panel, selection, exit',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<button data-testid="escape">Choose</button>');
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    await page.getByTestId('escape').click();await settled(page);
    const count=()=>page.locator('sourcepin-inspector .screen-count').textContent();
    const toast=()=>page.locator('sourcepin-inspector .toast').textContent();
    // Chromium coalesces bursts of synthesized keys and can swallow one, so a
    // press is confirmed by the toast changing and by a settled layer after it.
    const press=async(want)=>{
      for(let attempt=0;attempt<4;attempt++){
        const before=await toast();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(60);
        try{
          await page.waitForFunction(([text,previous])=>{
            const node=document.querySelector('[data-sourcepin-root]')?.shadowRoot?.querySelector('.toast');
            return !!node && node.textContent!==previous && node.textContent.includes(text);
          },[want,before],{timeout:400});
          await page.waitForTimeout(50);
          return;
        }catch{/* Nothing advanced; press again. */}
      }
      throw new Error(`Escape layer did not report: ${want}`);
    };
    assert.equal(await count(),'1');
    await page.locator('[data-action="settings-panel"]').click();
    assert.equal(await page.locator('[data-panel="settings"]').isVisible(),true);
    // Layer 1: the dialog closes by itself and the selection survives.
    await press('面板');
    assert.equal(await page.locator('[data-panel="settings"]').isVisible(),false);
    assert.equal(await count(),'1');
    assert.equal(await page.locator('[data-sourcepin-root]').count(),1);
    assert.match(await toast(),/面板|保留/);
    // Layer 2: with nothing open, Escape clears the selection and stays alive.
    await press('已取消选择');
    assert.equal(await count(),'');
    assert.equal(await page.locator('[data-sourcepin-root]').count(),1);
    // Layer 3: the armed press exits.
    await press('再按 Esc 退出');
    for(let attempt=0;attempt<3 && await page.locator('[data-sourcepin-root]').count()>0;attempt++){
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    }
    assert.equal(await page.locator('[data-sourcepin-root]').count(),0);
  }finally{await browser.close();}
});

test('Escape on the export review cancels the export and keeps the selection',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<p data-testid="review-escape">Email a@example.com</p>');
    await page.addScriptTag({content:await controllerFixture('pro')});await page.evaluate(()=>window.startTest());
    await page.getByTestId('review-escape').click();await settled(page);
    await page.locator('.copy').click();
    assert.equal(await page.locator('[data-panel="review"]').isVisible(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-panel="review"]').isVisible(),false);
    // The export is cancelled, but the picked target is still there to retry.
    assert.equal(await page.evaluate(()=>window.copied),undefined);
    assert.equal(await page.locator('[data-sourcepin-root]').count(),1);
    assert.equal(await page.locator('sourcepin-inspector .screen-count').textContent(),'1');
    await page.locator('.copy').click();await confirmExport(page);await page.waitForFunction(()=>!!window.copied);
    assert.match(await page.evaluate(()=>window.copied),/review-escape/);
  }finally{await browser.close();}
});

test('recording reaches Pro and starts in the same gesture from Lite',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<section data-testid="lite-record"><button data-testid="lite-record-child">Act</button></section>');
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    await page.getByTestId('lite-record-child').click({position:{x:5,y:5}});await settled(page);
    await page.locator('[data-action="settings-panel"]').click();
    const record=page.getByRole('button',{name:'切换到 Pro 并开始录制'});
    assert.equal(await record.isVisible(),true);
    await record.click();
    await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.robot').dataset.mode==='pro');
    await settled(page);
    assert.equal(await page.locator('sourcepin-inspector .mode-badge').textContent(),'PRO');
    assert.match(await page.locator('sourcepin-inspector .screen-status').textContent(),/录制中/);
    assert.equal(await page.getByRole('button',{name:'停止录制'}).isVisible(),true);
  }finally{await browser.close();}
});

test('a full multi-selection reports the tenth-target limit instead of dropping silently',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent(Array.from({length:12},(_,i)=>`<section data-testid="pick-${i}"><button>Pick ${i}</button></section>`).join(''));
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    for(let i=0;i<10;i++){await page.getByTestId(`pick-${i}`).click({position:{x:5,y:5},modifiers:i?['Shift']:[]});await settled(page);}
    assert.equal(await page.locator('sourcepin-inspector .screen-count').textContent(),'10');
    await page.getByTestId('pick-10').click({position:{x:5,y:5},modifiers:['Shift']});
    assert.match(await page.locator('sourcepin-inspector .toast').textContent(),/最多选择 10 个目标/);
    assert.equal(await page.locator('sourcepin-inspector .screen-count').textContent(),'10');
    // Below the ceiling the same gesture still adds a target and redraws outlines.
    await page.getByTestId('pick-0').click({position:{x:5,y:5},modifiers:['Shift']});await settled(page);
    assert.equal(await page.locator('sourcepin-inspector .screen-count').textContent(),'9');
    await page.getByTestId('pick-10').click({position:{x:5,y:5},modifiers:['Shift']});await settled(page);
    assert.equal(await page.locator('sourcepin-inspector .screen-count').textContent(),'10');
    await page.waitForTimeout(60);
    assert.equal(await page.locator('sourcepin-inspector .selection').count(),10);
  }finally{await browser.close();}
});

test('the multi-select hint appears once in the hover label and never repeats',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<p data-testid="hint">Hint target</p>');
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    const label=page.locator('sourcepin-inspector .highlight-label');
    await page.getByTestId('hint').hover();
    await page.waitForFunction(()=>document.querySelector('[data-sourcepin-root]').shadowRoot.querySelector('.highlight').dataset.hint==='true');
    assert.match(await label.textContent(),/Shift 点击可多选/);
    await page.mouse.move(4,4);await page.waitForTimeout(30);
    await page.getByTestId('hint').hover();
    await page.waitForTimeout(60);
    assert.doesNotMatch(await label.textContent(),/Shift 点击可多选/);
  }finally{await browser.close();}
});

test('selection follows page, nested, shadow and frame scrolling every paint without replacing outlines',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<style>body{height:2400px}#nested{height:180px;overflow:auto}button{margin-top:100px}</style><div id="nested"><button id="target">Scroll target</button><div style="height:1000px"></div></div><div id="shadow"></div><iframe id="frame" srcdoc="<button id=framed style=margin-top:100px>Frame target</button><div style=height:2000px></div>"></iframe>');
    await page.evaluate(()=>{document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<div id="scroller" style="height:140px;overflow:auto"><button id="shadowed">Shadow target</button><div style="height:1000px"></div></div>';});
    await page.addScriptTag({content:await controllerFixture('lite')});await page.evaluate(()=>window.startTest());
    for(const kind of ['page','nested','shadow','frame']){
      await page.evaluate(()=>scrollTo(0,0));
      const target=kind==='frame'?page.frameLocator('#frame').locator('#framed'):page.locator(kind==='shadow'?'#shadowed':'#target');
      await target.click();await settled(page);
      const errors=await page.evaluate(async kind=>{
        const root=document.querySelector('sourcepin-inspector').shadowRoot;
        const node=root.querySelector('.selection');
        const frame=document.querySelector('#frame');
        const target=kind==='frame'?frame.contentDocument.querySelector('#framed'):kind==='shadow'?document.querySelector('#shadow').shadowRoot.querySelector('#shadowed'):document.querySelector('#target');
        const errors=[];
        for(let i=0;i<6;i++){
          if(kind==='page')scrollBy(0,9);
          else if(kind==='nested')document.querySelector('#nested').scrollTop+=9;
          else if(kind==='shadow')document.querySelector('#shadow').shadowRoot.querySelector('#scroller').scrollTop+=9;
          else frame.contentWindow.scrollBy(0,9);
          await new Promise(resolve=>requestAnimationFrame(resolve));
          const actual=root.querySelector('.selection'), rect=target.getBoundingClientRect(),outline=actual.getBoundingClientRect();
          const offset=kind==='frame'?frame.getBoundingClientRect().top+frame.clientTop:0;
          if(Math.abs(outline.top-rect.top-offset)>.5)errors.push({frame:i,delta:outline.top-rect.top-offset});
          if(actual!==node)errors.push('outline replaced');
        }
        return errors;
      },kind);
      assert.deepEqual(errors,[],kind);
    }
    // One press clears the outlines; with the new layering an open panel can
    // absorb the first press, so the exit is confirmed rather than assumed.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    assert.equal(await page.locator('.selection').count(),0);
    for(let attempt=0;attempt<4 && await page.locator('sourcepin-inspector').count()>0;attempt++){
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    }
    assert.equal(await page.locator('sourcepin-inspector').count(),0);
  }finally{await browser.close();}
});

test('whole-page action in Lite exports markup, reports adapter results and keeps page kind on recapture',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<main>'+Array.from({length:1100},(_,i)=>`<div>Page item ${i}</div>`).join('')+'<div hidden>hidden-private</div></main>');
    await page.addScriptTag({content:await controllerFixture('lite',"async()=>({framework:'React',components:['Page'],props:{}})")});await page.evaluate(()=>window.startTest());
    await page.locator('[data-action="capture-panel"]').click();await page.locator('[data-action="whole-page"]').click();await settled(page);
    await page.locator('.download').click();await confirmExport(page);await page.waitForFunction(()=>!!window.downloaded);
    const md=await page.evaluate(()=>window.downloaded);
    assert.match(md,/## Cleaned HTML/);assert.match(md,/Page item 1099/);assert.match(md,/"captureKind": "page"/);assert.doesNotMatch(md,/hidden-private|without a platform adapter/);
    assert.match(md,/framework: present/);assert.match(md,/## Capabilities/);
    await page.locator('[data-action="settings-panel"]').click();await page.locator('[name="includeHidden"]').check();await settled(page);
    await page.locator('.download').click();await confirmExport(page);await page.waitForFunction(()=>window.downloaded.includes('data-sourcepin-hidden'));
    assert.match(await page.evaluate(()=>window.downloaded),/"captureKind": "page"/);
    await page.keyboard.press('Escape');await page.getByText('Page item 0',{exact:true}).click();await settled(page);
    await page.locator('.download').click();await confirmExport(page);await page.waitForFunction(()=>window.downloaded.includes('"captureKind": "element"'));
    assert.doesNotMatch(await page.evaluate(()=>window.downloaded),/## Cleaned HTML/);
  }finally{await browser.close();}
});

test('export review reports local counts and data flow, cancellation and changed snapshots have no side effects',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<p data-testid="review">Email a@example.com Phone 13800138000</p>');await page.addScriptTag({content:await controllerFixture('pro')});await page.evaluate(()=>window.startTest());await page.getByTestId('review').click();await settled(page);
  await page.locator('.copy').click();
  assert.match(await page.locator('.review-counts').textContent(),/邮箱 1.*手机号 1/);assert.match(await page.locator('.review-flow').textContent(),/LLM.*第三方/);assert.match(await page.locator('.review-privacy').textContent(),/截图.*OCR/);assert.equal(await page.evaluate(()=>window.copied),undefined);
  await page.locator('[data-action="export-cancel"].panel-action').click();assert.equal(await page.evaluate(()=>window.copied),undefined);
  await page.locator('.download').click();await page.evaluate(()=>document.querySelector('[data-testid="review"]').textContent+=' changed');await page.waitForTimeout(30);await confirmExport(page);assert.equal(await page.evaluate(()=>window.downloaded),undefined);assert.match(await page.locator('.toast').textContent(),/变化/);
  await page.getByTestId('review').click();await settled(page);await page.locator('.copy').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.copied),undefined);
  await page.getByTestId('review').click();await settled(page);await page.locator('.copy').click();await confirmExport(page);await page.waitForFunction(()=>!!window.copied);
 }finally{await browser.close();}
});

test('preview remains bounded for a capture whose full report exceeds 4 MiB; copy still uses the summary',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<button data-testid="huge-preview">Large context</button>');
  await page.addScriptTag({content:await controllerFixture('pro',"async()=>({framework:'Fixture',components:[],props:{fixture:'x'.repeat(5*1024*1024)}})")});
  await page.evaluate(()=>window.startTest());await page.getByTestId('huge-preview').click();await settled(page);
  await page.locator('.screen').click();
  const preview=await page.locator('.preview').textContent();
  assert.match(preview,/## Targets/);assert.match(preview,/huge-preview/);
  assert.ok(Buffer.byteLength(preview)<=15*1024);
  assert.doesNotMatch(preview,/exceeds|捕获未完成|Error/);
  await page.locator('.copy').click();await confirmExport(page);await page.waitForFunction(()=>!!window.copied);
  assert.equal(await page.evaluate(()=>window.copied),preview);
 }finally{await browser.close();}
});
