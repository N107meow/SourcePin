import { safeFilename, validateDownload } from '../platform/policy';

async function activate(tab?: chrome.tabs.Tab) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
  } catch {
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.action.setTitle({tabId:tab.id,title:'此页面不允许注入。请在普通 HTTP/HTTPS 网页使用 SourcePin。'});
  }
}
chrome.action.onClicked.addListener(activate);
chrome.commands.onCommand.addListener(async(command, tab)=>{
  if(!tab?.id) [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id) return;
  if(command==='download-markdown') {
    try {await chrome.tabs.sendMessage(tab.id,{type:'download-command'});} catch {await activate(tab);}
  }
});

// The MAIN-world reader is self-contained and never receives extension APIs.
function readFramework(marker: string) {
  function find(root: Document | ShadowRoot): Element | null {
    const found=root.querySelector(`[data-sourcepin-probe="${marker}"]`); if(found) return found;
    for(const element of root.querySelectorAll('*')) {
      if(element.shadowRoot){const inner=find(element.shadowRoot);if(inner)return inner;}
      if(element.tagName==='IFRAME'){try{const doc=(element as HTMLIFrameElement).contentDocument;if(doc){const inner=find(doc);if(inner)return inner;}}catch{ /* cross-origin boundary */ }}
    }
    return null;
  }
  const el=find(document) as (Element & Record<string,any>) | null;
  if(!el) return undefined;
  const props: Record<string,string>={}; const components: string[]=[];
  let framework='';let source: string | undefined;
  const safeProps=(raw: any)=>{
    if(!raw || typeof raw!=='object')return;
    for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(raw)).slice(0,100)){
      const v=descriptor.value;
      if(/^(data-(testid|test|id)|aria-(label|expanded|selected|hidden)|role|type|name)$/.test(key) && (typeof v==='string' || typeof v==='boolean' || typeof v==='number') && String(v).length<160 && !/(token|secret|bearer|password)/i.test(String(v)))props[key]=String(v);
    }
  };
  const fiberKey=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
  if(fiberKey){
    framework='React';let fiber=el[fiberKey]; const seen=new Set();
    for(let n=0;fiber && n<30 && !seen.has(fiber);n++,fiber=fiber.return){
      seen.add(fiber);const type=fiber.type;const name=typeof type==='function' ? type.displayName || type.name : type?.displayName;
      if(typeof name==='string' && name && !components.includes(name)) components.unshift(name.slice(0,100));
      if(n===0)safeProps(fiber.memoizedProps);
      const debug=fiber._debugSource;
      if(!source && typeof debug?.fileName==='string' && typeof debug?.lineNumber==='number')source=`${debug.fileName}:${debug.lineNumber}`;
    }
  } else if(el.__vueParentComponent){
    framework='Vue';let component=el.__vueParentComponent;const seen=new Set();
    for(let n=0;component && n<30 && !seen.has(component);n++,component=component.parent){
      seen.add(component);const name=component.type?.name || component.type?.__name;
      if(typeof name==='string')components.unshift(name.slice(0,100));
      if(n===0)safeProps(component.props);
    }
  }
  return framework ? {framework,components,props,source}:undefined;
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !sender.tab?.id || !message || typeof message!=='object') return false;
  const tabId=sender.tab.id;
  (async()=>{
    if(message.type==='screenshot'){
      const tab=await chrome.tabs.get(tabId);
      if(!tab.active)throw new Error('请保持目标标签页处于前台再截图。');
      return await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
    }
    if(message.type==='download'){
      if(!validateDownload(message))throw new Error('导出数据无效或超过 5 MB，请缩小捕获范围。');
      let granted=await chrome.permissions.contains({permissions:['downloads']});
      if(!granted){try{granted=await chrome.permissions.request({permissions:['downloads']});}catch{return {fallback:true};}}
      if(!granted)return {fallback:true};
      await chrome.downloads.download({url:`data:text/markdown;charset=utf-8,${encodeURIComponent(message.text)}`,filename:safeFilename(message.filename),saveAs:true});
      return {fallback:false};
    }
    if(message.type==='framework' && typeof message.marker==='string' && /^sp-[0-9a-f-]{36}$/.test(message.marker)){
      const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:readFramework,args:[message.marker]});
      return result[0]?.result;
    }
    throw new Error('不支持的 SourcePin 操作');
  })().then(value=>respond({ok:true,value}),error=>respond({ok:false,error:String(error?.message || error)}));
  return true;
});
