import type { Capture, CaptureKind, Platform, Rect, Recorder, Recording, Settings, UIState } from './types';
import { createUI } from './ui/inspector';
import { captureElement } from './core/capture';
import { validateLocators } from './core/locators';
import { createRecorder } from './core/recorder';
import { renderMarkdown } from './core/markdown';
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
  let escapeArmed=false;
  const documents=new Map<Document,()=>void>();
  const recordings=()=>recorder?.snapshot() || recorded;
  const markdown=(summary=false)=>renderMarkdown([...captures,...viewports],{summary,language:settings.language,recording:recordings(),savedFilename});
  const valid=()=>captures.length>0 && selected.every((el,i)=>el.isConnected && validateLocators(el,captures[i]?.locators || []).some(l=>l.verified));
  const state=(): UIState=>({mode:settings.mode,status,count:selected.length,summary:captures.length ? `${describe(selected[0])}\n${captures[0].target.text.slice(0,70)}`:'',copied,busy,recording:!!recorder,matched:valid(),markdown:captures.length?markdown():'',settings});
  const ui=createUI({
    copy:()=>void copy(),download:()=>void download(),close:()=>destroy(),
    repick:()=>resetSelection(),
    settings:(next)=>{
      const previous=settings;settings=normalizeSettings(next);void platform.saveSettings(settings).catch(()=>ui.toast('设置保存失败，本次会话仍然有效'));
      if(settings.mode!==previous.mode || settings.maxDepth!==previous.maxDepth || settings.maxNodes!==previous.maxNodes || settings.includeHidden!==previous.includeHidden){
        recorder?.dispose();recorder=undefined;recorded=undefined;viewports=[];if(selected.length)void captureSelected();
      }
      copied=false;update();
    },
    record:()=>toggleRecording(),screenshot:(component)=>void screenshot(component),
    wholePage:()=>{recorder?.dispose();recorder=undefined;recorded=undefined;selected=[document.body || document.documentElement];captureKind='page';picking=false;hover=null;ui.highlight(null);ui.toast('整页采集：独立 DOM/样式预算，默认排除隐藏内容');void captureSelected();},
    addViewport:()=>{if(captures.length){viewports.push(...captures);if(viewports.length>20)viewports.splice(0,viewports.length-20);void captureSelected(true);}}
  },state(),assetUrl);
  const update=()=>{if(alive)ui.update(state());};

  function resetSelection(){
    recorder?.dispose();recorder=undefined;recorded=undefined;
    operation?.abort();busy=false;picking=true;escapeArmed=false;hover=null;
    captureKind='element';selected=[];captures=[];viewports=[];copied=false;savedFilename=undefined;revision++;
    status='指向元素，点击选中';ui.highlight(null);ui.selections([]);update();
  }

  async function captureSelected(keepViewports=false) {
    escapeArmed=false;
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
  async function copy() {
    if(!ensureFresh())return;
    const version=revision;
    try {await platform.copy(markdown(true));if(alive && revision===version){copied=true;status='提示词已复制';update();ui.toast('已复制，粘贴给你的 AI Agent');}}
    catch(error){copied=false;update();ui.toast(error instanceof Error?error.message:'复制失败，请下载 Markdown');}
  }
  async function download() {
    if(!ensureFresh())return;
    const filename=`sourcepin-${settings.mode}-${new Date().toISOString().replace(/[:.]/g,'-')}.md`;
    try {const result=await platform.download(markdown(),filename);ui.toast(result);/* A dialog submission is not proof that a file was saved. */}
    catch(error){ui.toast(error instanceof Error?error.message:'保存已取消或失败');}
  }
  async function screenshot(component: boolean){
    if(!platform.screenshot){ui.toast('截图需要 Chrome 扩展版；当前可复制或下载 Markdown');return;}
    if(component && !ensureFresh())return;
    ui.hide(true);
    try {
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      ui.toast(await platform.screenshot(component?topRect(selected[0]):undefined));
    }catch(error){ui.toast(error instanceof Error?error.message:'截图失败');}
    finally{if(alive)ui.hide(false);}
  }
  function toggleRecording(){
    if(recorder){recorded=recorder.stop();recorder=undefined;picking=false;status=`已记录 ${recorded.states.length} 个状态`;copied=false;revision++;update();return;}
    if(settings.mode!=='pro'){ui.toast('切换到 Pro 后可录制交互状态');return;}
    if(!ensureFresh())return;
    picking=false;recorded=undefined;
    recorder=createRecorder(selected[0],()=>{copied=false;revision++;update();});
    status='录制中 · 请正常操作网页，完成后停止';update();
  }
  function elementFrom(event: Event): Element | null {
    if(ui.contains(event))return null;
    // Cross-frame Element instances do not satisfy top-window instanceof.
    return event.composedPath().find(item=>item && typeof item==='object' && (item as Node).nodeType===1) as Element || null;
  }
  function onMove(event: Event){
    if(!picking)return;
    const target=elementFrom(event);if(!target){hover=null;ui.highlight(null);return;}
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
  function drawHover(){
      if(!picking || !hover?.isConnected || !alive){ui.highlight(null);return;}
      const r=topRect(hover), parent=hover.parentElement;
      const layout=parent ? hover.ownerDocument.defaultView!.getComputedStyle(parent).display:'';
      ui.highlight(r,`${describe(hover)} · ${Math.round(r.width)} × ${Math.round(r.height)}${layout==='grid' || layout==='flex' ? ` · ${layout} ${visibleChildren(parent!).indexOf(hover)+1}/${visibleChildren(parent!).length}`:''}`,false);
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
    if(mouse.shiftKey){selected=selected.includes(target)?selected.filter(el=>el!==target):[...selected,target].slice(0,10);}
    else selected=[target];
    hover=null;ui.highlight(null);ui.selections(selected.map(topRect));
    if(selected.length)void captureSelected();else{operation?.abort();captures=[];busy=false;copied=false;status='指向元素，点击选中';update();}
  }
  function onKey(event: Event){
    const key=event as KeyboardEvent;
    if(key.key==='Escape'){
      key.preventDefault();key.stopImmediatePropagation();if(key.repeat)return;
      if(escapeArmed){destroy();return;}
      resetSelection();while(ui.closePanel()){}escapeArmed=true;
      ui.toast(settings.language==='en'?'Selection cleared · Esc again to close':'已取消选择 · 再按 Esc 退出');return;
    }
    if(key.repeat || editable(key) || selectedText((event.currentTarget as Document)))return;
    if(!(key.metaKey || key.ctrlKey) || key.altKey)return;
    if(key.key.toLowerCase()==='c' && selected.length){
      key.preventDefault();key.stopImmediatePropagation();void copy();if(key.shiftKey)void screenshot(true);
    }else if(key.shiftKey && key.key.toLowerCase()==='m' && selected.length){key.preventDefault();key.stopImmediatePropagation();void download();}
  }
  function attach(doc: Document){
    if(documents.has(doc))return;
    doc.addEventListener('pointermove',onMove,true);doc.addEventListener('click',onClick,true);doc.addEventListener('keydown',onKey,true);
    const mutation=new MutationObserver((records)=>{
      if(!selected.length || !alive)return;
      const changed=records.some(r=>!(r.target instanceof Element && (r.target===ui.host || ui.host.contains(r.target))) && r.attributeName!=='data-sourcepin-probe' && selected.some(el=>el===r.target || el.contains(r.target)));
      if(changed || selected.some(el=>!el.isConnected)){
        copied=false;revision++;if(!recorder)status='页面已变化 · 复制前将回查定位';update();
      }
    });
    mutation.observe(doc,{subtree:true,childList:true,attributes:true,characterData:true});
    documents.set(doc,()=>{doc.removeEventListener('pointermove',onMove,true);doc.removeEventListener('click',onClick,true);doc.removeEventListener('keydown',onKey,true);mutation.disconnect();});
  }
  function scanFrames(doc: Document){
    attach(doc);
    for(const iframe of doc.querySelectorAll('iframe')){try{if(iframe.contentDocument)scanFrames(iframe.contentDocument);}catch{ /* Explicit inaccessible frame captured by core. */ }}
  }
  scanFrames(document);
  const timer=window.setInterval(()=>{
    if(!alive)return;
    for(const [doc,cleanup] of documents){if(doc!==document && !doc.defaultView?.frameElement?.isConnected){cleanup();documents.delete(doc);}}
    scanFrames(document);
  },250);
  function destroy(){
    if(!alive)return;alive=false;operation?.abort();recorder?.dispose();recorder=undefined;
    clearInterval(timer);cancelAnimationFrame(raf);for(const cleanup of documents.values())cleanup();documents.clear();
    captures=[];viewports=[];selected=[];recorded=undefined;ui.destroy();onDispose?.();
  }
  return {destroy,download:()=>void download()};
}
