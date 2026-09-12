import type { Capture, CaptureKind, Platform, Rect, Recorder, Recording, ReviewMemory, Settings, UIState } from './types';
import { createUI } from './ui/inspector';
import { captureElement } from './core/capture';
import { validateLocators } from './core/locators';
import { createRecorder } from './core/recorder';
import { renderMarkdown } from './core/markdown';
import { createPagePackage, EXPORT_LIMITS } from './core/package';
import { scanPersonalInfo } from './core/review';
import { visibleChildren } from './core/dom';
import { normalizeSettings } from './platform/policy';

export interface Controller { destroy(): void; download(): void }

/** Translate same-origin frame coordinates to the top-level viewport. */
export function topRect(element: Element): Rect {
  const rect=element.getBoundingClientRect();
  let {x,y,width,height}=rect;
  let view=element.ownerDocument.defaultView;
  while(view && view!==window){
    let frame: Element | null=null;
    try { frame=view.frameElement; } catch { break; }
    if(!frame)break;
    const outer=frame.getBoundingClientRect();const node=frame as HTMLElement;
    const sx=outer.width/(node.offsetWidth || outer.width || 1),sy=outer.height/(node.offsetHeight || outer.height || 1);
    x=outer.x+(x+node.clientLeft)*sx;y=outer.y+(y+node.clientTop)*sy;width*=sx;height*=sy;
    view=frame.ownerDocument.defaultView;
  }
  return {x,y,width,height};
}

function editable(event: KeyboardEvent): boolean {
  return event.composedPath().some(item=>(item as Node)?.nodeType===1 && ((item as Element).matches('input,textarea,select') || (item as HTMLElement).isContentEditable));
}
function selectedText(doc: Document): boolean { return Boolean(doc.getSelection()?.toString()); }
function describe(el: Element){ return `${el.localName}${el.id ? `#${el.id}` : el.classList.length ? '.'+[...el.classList].slice(0,2).join('.') : ''}`.slice(0,90); }

export async function startInspector(platform: Platform, assetUrl: string, onDispose?: () => void): Promise<Controller> {
  let settings: Settings;
  try { settings=normalizeSettings(await platform.loadSettings()); } catch {settings=normalizeSettings({});}
  let selected: Element[]=[];let captures: Capture[]=[];let viewports: Capture[]=[];
  let captureKind: CaptureKind='element';
  let recorder: Recorder | undefined;let recorded: Recording | undefined;
  let busy=false,copied=false,alive=true,picking=true,hover: Element | null=null;
  let status='指向元素，点击选中';let savedFilename: string | undefined;
  let operation: AbortController | undefined;let revision=0;let raf=0;
  let escapeArmed=false;let exporting:AbortController | undefined;let hintHoverStart=0;let hintUsed=false;let hintShowing=false;let acceptedRevision:number|undefined;let lastReview: ReviewMemory | null=null;
  // The multi-select hint is offered once per engagement and stays long enough to
  // be read: flipping a boolean on a single paint replaced the label before the
  // user could see it, and a second paint could remove it even sooner.
  const HINT_MS=1600;
  /** Cancel, Escape and closing the tool never produce this state, so a refused
   * first export cannot turn itself into an accepted one. A later change to the
   * page or selection drops it: the accepted statement described that snapshot,
   * not the current one. */
  const reviewValid=()=>acceptedRevision===revision;
  const documents=new Map<Document,()=>void>();
  const recordings=()=>recorder?.snapshot() || recorded;
  const markdown=(summary=false)=>renderMarkdown([...captures,...viewports],{summary,language:settings.language,recording:recordings(),savedFilename});
  const valid=()=>captures.length>0 && selected.every((el,i)=>el.isConnected && validateLocators(el,captures[i]?.locators || []).some(l=>l.verified));
  const state=(): UIState=>({mode:settings.mode,status,count:selected.length,summary:captures.length ? `${describe(selected[0])}\n${captures[0].target.text.slice(0,70)}`:'',copied,busy,recording:!!recorder,matched:valid(),markdown:captures.length?preview():'',settings,capabilities:{screenshot:!!platform.screenshot},confirmed:reviewValid(),notice:reviewValid()?lastReview:null});
  function applySettings(next: Settings){
    const previous=settings;settings=normalizeSettings(next);void platform.saveSettings(settings).catch(()=>ui.toast('设置保存失败，本次会话仍然有效'));
    if(settings.mode!==previous.mode || settings.maxDepth!==previous.maxDepth || settings.maxNodes!==previous.maxNodes || settings.includeHidden!==previous.includeHidden){
      recorder?.dispose();recorder=undefined;recorded=undefined;viewports=[];if(selected.length)void captureSelected();
    }
    copied=false;update();
  }
  const ui=createUI({
    copy:()=>void copy(),download:()=>void download(),close:()=>destroy(),
    repick:()=>resetSelection(),
    settings:(next)=>applySettings(next),
    record:()=>toggleRecording(),screenshot:(component)=>void screenshot(component),
    wholePage:()=>{recorder?.dispose();recorder=undefined;recorded=undefined;selected=[document.body || document.documentElement];captureKind='page';picking=false;hover=null;ui.highlight(null);ui.toast('整页采集：独立 DOM/样式预算，默认排除隐藏内容');void captureSelected();},
    addViewport:()=>{if(!captures.length){ui.toast(settings.language==='en'?'Select an element before adding a viewport':'先选择一个元素，再追加视口');return;}viewports.push(...captures);if(viewports.length>20)viewports.splice(0,viewports.length-20);void captureSelected(true);}
  },state(),assetUrl);
  const update=()=>{if(alive)ui.update(state());};
  /** A change to the page or selection invalidates the accepted statement, so
   * the record is dropped with it instead of describing a snapshot that no
   * longer exists. */
  const updateReview=()=>{if(!reviewValid()){acceptedRevision=undefined;lastReview=null;}update();};
  // Count the first display, even when the user dismisses without pressing Start.
  if(!settings.onboardingDone){
    settings={...settings,onboardingDone:true};
    update();
    void platform.saveSettings(settings).catch(()=>ui.toast('引导记录未能保存，本次使用不会再次显示'));
  }

  function preview(){try{return markdown(true);}catch(error){return error instanceof Error?error.message:String(error);}}
  function resetSelection(){
    exporting?.abort();while(ui.closePanel()){}
    recorder?.dispose();recorder=undefined;recorded=undefined;
    operation?.abort();busy=false;picking=true;hover=null;
    captureKind='element';selected=[];captures=[];viewports=[];copied=false;savedFilename=undefined;revision++;
    status='指向元素，点击选中';ui.highlight(null);ui.selections([]);updateReview();
  }

  async function captureSelected(keepViewports=false) {
    // The Escape unwind is cleared only by destroying the tool or by picking a
    // new target, never by a recapture inside the same selection.
    trackGeometry();
    operation?.abort();const current=new AbortController();operation=current;
    const targets=[...selected];busy=true;copied=false;savedFilename=undefined;status='正在捕获组件上下文…';revision++;
    if(!keepViewports)viewports=[];
    update();
    try {
      const next: Capture[]=[];let remaining=600;
      for(const [index,el] of targets.entries()){
        // Reserve a root node for each remaining selection.
        const budget=Math.min(settings.maxNodes,remaining-(targets.length-index-1));
        const snapshot=await captureElement(el,{mode:settings.mode,kind:captureKind,...(captureKind==='element'?{maxNodes:budget,maxDepth:settings.maxDepth}:{}),includeHidden:settings.includeHidden,signal:current.signal});
        remaining-=snapshot.nodes.length;
        snapshot.degradations=snapshot.degradations.filter(note=>!note.startsWith('framework: absent'));
        let frameworkReason='Framework metadata is unavailable without a platform adapter.';
        if(platform.framework){
          try{snapshot.framework=await platform.framework(el);frameworkReason=snapshot.framework?'Platform adapter returned framework metadata.':'Platform adapter found no framework metadata on this target.';}
          catch{frameworkReason='Platform framework adapter failed; DOM capture remains available.';}
        }
        snapshot.capabilities.framework={status:snapshot.framework?'present':'absent',reason:frameworkReason};
        if(!snapshot.framework)snapshot.degradations.push(`framework: absent — ${frameworkReason}`);
        next.push(snapshot);
      }
      if(current.signal.aborted || !alive)return;
      captures=next;status=valid()?`已选中 ${selected.length} 个 · 定位回查通过`:'已捕获 · 定位需要复核';
    } catch(error){if(!current.signal.aborted){status='捕获未完成';ui.toast(error instanceof Error?error.message:String(error));}}
    finally {if(!current.signal.aborted && alive){busy=false;update();}}
  }
  function ensureFresh(): boolean {
    if(busy || !captures.length){ui.toast(busy?'正在捕获，请稍候':'先点击选择一个网页元素');return false;}
    for(let i=0;i<selected.length;i++)captures[i].locators=validateLocators(selected[i],captures[i].locators);
    if(!valid()){copied=false;status='目标已变化，请重新选择';update();ui.toast(status);return false;}
    return true;
  }
  async function exportAction(action:string, run:(signal:AbortSignal)=>Promise<void>, screenshot=false, downloadsImages=false){
    if(exporting){ui.toast('请先完成或取消当前导出');return;}
    const job=new AbortController();exporting=job;
    const version=revision;
    const payload=JSON.stringify({captures:[...captures,...viewports],recording:recordings()});
    try{
      const counts=scanPersonalInfo(payload);
      // One full review per activation, for copy, download and screenshot
      // alike. Later exports skip the dialog only when the snapshot is clean;
      // any personal-information hit still forces the complete review, and the
      // privacy, third-party and rights notices stay readable on the console
      // screen and inside the preview instead.
      const findings=counts.email+counts.phone+counts.identity+counts.address;
      const needsReview=!reviewValid() || findings>0;
      // Only an accepted review is remembered, and only for the revision it
      // described. Showing the dialog, cancelling it or closing the tool leaves
      // no confirmed state behind.
      const accepted=needsReview ? await ui.review({action,counts,screenshot,downloadsImages}) : true;
      if(needsReview && accepted && version===revision && alive){
        acceptedRevision=version;
        lastReview={action,counts,screenshot,downloadsImages,at:new Date().toISOString()};
      }
      update();
      if(!accepted || job.signal.aborted || !alive)return;
      if(version!==revision){ui.toast('确认期间页面或选择已变化，请重新采集后导出');return;}
      await run(job.signal);
    }catch(error){if(!job.signal.aborted && alive)ui.toast(error instanceof Error?error.message:'导出未完成');}
    finally{if(exporting===job)exporting=undefined;}
  }
  async function copy(withScreenshot=false) {
    if(!ensureFresh())return;
    const text=markdown(true),version=revision;
    await exportAction(withScreenshot?'复制摘要并截图':'复制摘要',async signal=>{
      await platform.copy(text);
      if(alive && revision===version){copied=true;status='提示词已复制';update();ui.toast('已复制，粘贴给你的 AI Agent');}
      if(withScreenshot){if(platform.screenshot)await saveScreenshot(true,signal);else ui.toast('摘要已复制；截图需要 Chrome 扩展版');}
    },withScreenshot);
  }
  async function download() {
    if(!ensureFresh())return;
    const snapshots=[...captures,...viewports],page=snapshots.some(capture=>capture.meta.captureKind==='page');
    const recording=recordings();
    const filename=`sourcepin-${settings.mode}-${new Date().toISOString().replace(/[:.]/g,'-')}.${page?'zip':'md'}`;
    await exportAction(page?'下载离线 ZIP':'下载 Markdown',async signal=>{
      const output=page?await createPagePackage(snapshots,{signal,language:settings.language,recording}):renderMarkdown(snapshots,{language:settings.language,recording});
      if(typeof output==='string' && new TextEncoder().encode(output).length>EXPORT_LIMITS.maxReportBytes)throw new Error('Markdown 超过 4 MiB，请减少选择范围或视口数量；未导出文件。');
      signal.throwIfAborted();if(!alive)return;
      ui.toast(await platform.download(output,filename));
    },false,page);
  }
  async function screenshot(component: boolean){
    if(!platform.screenshot){ui.toast('截图需要 Chrome 扩展版；当前可复制或下载 Markdown');return;}
    if(component && !ensureFresh())return;
    await exportAction('保存截图',signal=>saveScreenshot(component,signal),true);
  }
  async function saveScreenshot(component:boolean,signal:AbortSignal){
    ui.hide(true);
    try {
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      signal.throwIfAborted();
      ui.toast(await platform.screenshot!(component?topRect(selected[0]):undefined));
    }finally{if(alive)ui.hide(false);}
  }
  async function beginRecording(){
    if(!ensureFresh())return;
    picking=false;recorded=undefined;
    recorder=createRecorder(selected[0],()=>{copied=false;revision++;updateReview();});
    status='录制中 · 请正常操作网页，完成后停止';update();
  }
  async function toggleRecording(){
    if(recorder){recorded=recorder.stop();recorder=undefined;picking=false;status=`已记录 ${recorded.states.length} 个状态`;copied=false;revision++;updateReview();return;}
    // Lite has no recording. Switch first through the normal settings path, so
    // the existing recapture runs, then start recording in the same gesture
    // instead of only reporting that Pro would be required.
    if(settings.mode!=='pro'){
      applySettings({...settings,mode:'pro'});
      await captureSelected();
    }
    await beginRecording();
  }
  function elementFrom(event: Event): Element | null {
    if(ui.contains(event))return null;
    // Cross-frame Element instances do not satisfy top-window instanceof.
    return event.composedPath().find(item=>item && typeof item==='object' && (item as Node).nodeType===1) as Element || null;
  }
  function onMove(event: Event){
    if(!picking)return;
    const target=elementFrom(event);
    // Leaving the page area ends the current offer. A new hover may offer the
    // hint again once, but only after the previous offer has expired.
    if(!target){hover=null;hintHoverStart=0;hintShowing=false;ui.highlight(null);return;}
    if(target!==hover&&performance.now()-hintHoverStart>=HINT_MS)hintUsed=false;
    hover=target;
    trackGeometry();
  }
  // Keep viewport overlays aligned with scrolling, animated layout and nested
  // scrollers (including scroll events that do not escape a shadow root).
  // Only geometry runs per paint; capture and Markdown stay event-driven.
  function trackGeometry(){
    if(raf || !alive)return;
    raf=requestAnimationFrame(()=>{
      raf=0;if(!alive)return;
      drawHover();
      ui.selections(selected.filter(el=>el.isConnected).map(topRect));
      if(selected.some(el=>el.isConnected) || (picking && hover?.isConnected))trackGeometry();
    });
  }
  /** Draws the hover overlay. The multi-select hint is offered once per hover:
   * the window starts on the first paint that carries it, and holding the pointer
   * still keeps it readable instead of letting the next paint wipe it out. */
  function drawHover(): void {
      if(!picking || !hover?.isConnected || !alive){hintHoverStart=0;hintShowing=false;ui.highlight(null);return;}
      const r=topRect(hover), parent=hover.parentElement;
      const layout=parent ? hover.ownerDocument.defaultView!.getComputedStyle(parent).display:'';
      // Multi-pick exists only in the README. One offer per hover, in the label
      // the pointer is already reading, and it stays for the whole offer: ending
      // it on the next paint spent the hint before anyone could read it. The
      // offer begins when a hover starts, is taken once, and is released only
      // after it has run for HINT_MS, or when the pointer leaves.
      const now=performance.now();
      if(!hintHoverStart)hintHoverStart=now;
      const withinWindow=now-hintHoverStart<HINT_MS && selected.length<10;
      const hint=withinWindow && (hintShowing || !hintUsed);
      if(!withinWindow){hintShowing=false;hintUsed=false;}
      else if(!hintShowing){hintShowing=true;hintUsed=true;}
      const suffix=hint ? (settings.language==='en' ? ' · Shift+click to multi-select' : ' · Shift 点击可多选') : '';
      ui.highlight(r,`${describe(hover)} · ${Math.round(r.width)} × ${Math.round(r.height)}${layout==='grid' || layout==='flex' ? ` · ${layout} ${visibleChildren(parent!).indexOf(hover)+1}/${visibleChildren(parent!).length}`:''}${suffix}`,false,undefined,hint);
  }
  function onClick(event: Event){
    if(!picking || !event.isTrusted || ui.contains(event))return;
    const target=elementFrom(event);if(!target)return;
    const mouse=event as MouseEvent;if(mouse.button!==0)return;
    event.preventDefault();event.stopImmediatePropagation();
    // A Shift-click can create a native range before the click handler runs.
    // That range belongs to this multi-pick gesture, not a text-copy gesture.
    if(mouse.shiftKey)target.ownerDocument.getSelection()?.removeAllRanges();
    recorder?.dispose();recorder=undefined;recorded=undefined;
    if(captureKind==='page')selected=[];captureKind='element';
    if(mouse.shiftKey){
      const clipped=!selected.includes(target) && selected.length>=10;
      selected=selected.includes(target)?selected.filter(el=>el!==target):[...selected,target].slice(0,10);
      // Report the boundary instead of dropping the extra target silently.
      if(clipped)ui.toast(settings.language==='en'?'Up to 10 targets per capture':'最多选择 10 个目标，已保留前 10 个');
    }
    else selected=[target];
    // A fresh pick restarts the two-press Escape unwind.
    escapeArmed=false;hintHoverStart=0;hintUsed=false;hintShowing=false;
    hover=null;ui.highlight(null);ui.selections(selected.map(topRect));
    if(selected.length)void captureSelected();else{operation?.abort();captures=[];busy=false;copied=false;status='指向元素，点击选中';update();}
  }
  function onKey(event: Event){
    const key=event as KeyboardEvent;
    if(key.key==='Escape'){
      key.preventDefault();key.stopImmediatePropagation();if(key.repeat)return;
      // Layered unwind: a first press only closes what is open on top of the
      // selection, so dismissing a dialog never discards the picked targets.
      if(escapeArmed){destroy();return;}
      if(ui.closePanel()){
        ui.toast(settings.language==='en'?'Panel closed · selection kept':'已关闭面板 · 选择保留');return;
      }
      if(selected.length){
        resetSelection();
        ui.toast(settings.language==='en'?'Selection cleared · Esc again to close':'已取消选择 · 再按 Esc 退出');return;
      }
      escapeArmed=true;
      ui.toast(settings.language==='en'?'Esc again to close':'再按 Esc 退出');return;
    }
    if(key.repeat || editable(key) || selectedText((event.currentTarget as Document)))return;
    if(!(key.metaKey || key.ctrlKey) || key.altKey)return;
    if(key.key.toLowerCase()==='c' && selected.length){
      key.preventDefault();key.stopImmediatePropagation();void copy(key.shiftKey);
    }else if(key.shiftKey && key.key.toLowerCase()==='m' && selected.length){key.preventDefault();key.stopImmediatePropagation();void download();}
  }
  function attach(doc: Document){
    if(documents.has(doc))return;
    doc.addEventListener('pointermove',onMove,true);doc.addEventListener('click',onClick,true);doc.addEventListener('keydown',onKey,true);
    const mutation=new MutationObserver((records)=>{
      if(!selected.length || !alive)return;
      const changed=records.some(r=>!(r.target instanceof Element && (r.target===ui.host || ui.host.contains(r.target))) && r.attributeName!=='data-sourcepin-probe' && selected.some(el=>el===r.target || el.contains(r.target)));
      if(changed || selected.some(el=>!el.isConnected)){
        copied=false;revision++;if(!recorder)status='页面已变化 · 复制前将回查定位';updateReview();
      }
    });
    mutation.observe(doc,{subtree:true,childList:true,attributes:true,characterData:true});
    documents.set(doc,()=>{doc.removeEventListener('pointermove',onMove,true);doc.removeEventListener('click',onClick,true);doc.removeEventListener('keydown',onKey,true);mutation.disconnect();});
  }
  /** Open shadow roots hide frames from document.querySelectorAll, and a click
   * inside a frame never bubbles to the top document, so a composed tree has to
   * be walked for both. attach() de-duplicates documents, so re-scanning cannot
   * stack a second set of listeners on the same frame. */
  const framesIn=(root: ParentNode): HTMLIFrameElement[]=>{
    const frames=[...root.querySelectorAll('iframe')];
    for(const element of root.querySelectorAll('*')){
      const shadow=element.shadowRoot;
      if(shadow)frames.push(...framesIn(shadow));
    }
    return frames;
  };
  function scanFrames(doc: Document){
    attach(doc);
    for(const iframe of framesIn(doc)){try{if(iframe.contentDocument)scanFrames(iframe.contentDocument);}catch{ /* Explicit inaccessible frame captured by core. */ }}
  }
  scanFrames(document);
  const timer=window.setInterval(()=>{
    if(!alive)return;
    for(const [doc,cleanup] of documents){if(doc!==document && !doc.defaultView?.frameElement?.isConnected){cleanup();documents.delete(doc);}}
    scanFrames(document);
  },250);
  function destroy(){
    if(!alive)return;alive=false;exporting?.abort();operation?.abort();recorder?.dispose();recorder=undefined;
    clearInterval(timer);cancelAnimationFrame(raf);for(const cleanup of documents.values())cleanup();documents.clear();
    captures=[];viewports=[];selected=[];recorded=undefined;ui.destroy();onDispose?.();
  }
  return {destroy,download:()=>void download()};
}
