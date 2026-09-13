import type { Platform, Rect } from '../types';
import { normalizeSettings } from '../platform/policy';
import { saveBlob } from '../platform/browser';

async function request<T>(message: object): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '扩展连接已断开，请重新唤起 SourcePin');
  return response.value as T;
}

export function createExtensionPlatform(): Platform {
  return {
    kind:'extension',
    async loadSettings(){ const data=await chrome.storage.local.get('settings'); return normalizeSettings(data.settings); },
    async saveSettings(settings){ await chrome.storage.local.set({settings:normalizeSettings(settings)}); },
    async copy(text){
      if(!navigator.clipboard?.writeText) throw new Error('当前页面无法写入剪贴板，请下载 Markdown 或在 HTTPS 页面使用。');
      await navigator.clipboard.writeText(text);
    },
    async download(text,filename){
      if(text instanceof Blob){saveBlob(text,filename);return '已发起 ZIP 下载，保存位置由浏览器设置决定';}
      const result=await request<{fallback:boolean}>({type:'download',text,filename});
      if(result.fallback){ saveBlob(new Blob([text],{type:'text/markdown;charset=utf-8'}),filename); return '已发起下载，保存位置由浏览器设置决定'; }
      return '已提交系统保存对话框';
    },
    async screenshot(rect?: Rect){
      const raw=await request<string>({type:'screenshot'});
      const bitmap=await createImageBitmap(await (await fetch(raw)).blob());
      const sx=bitmap.width/window.innerWidth, sy=bitmap.height/window.innerHeight;
      const region=rect || {x:0,y:0,width:window.innerWidth,height:window.innerHeight};
      const left=Math.max(0,region.x),top=Math.max(0,region.y);
      const width=Math.min(window.innerWidth,region.x+region.width)-left;
      const height=Math.min(window.innerHeight,region.y+region.height)-top;
      if(width<=0 || height<=0){ bitmap.close(); throw new Error('目标不在可见区域，请滚动到目标后重试。'); }
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(width*sx)); canvas.height=Math.max(1,Math.round(height*sy));
      const ctx=canvas.getContext('2d'); if(!ctx) {bitmap.close();throw new Error('截图裁剪不可用');}
      ctx.drawImage(bitmap,left*sx,top*sy,width*sx,height*sy,0,0,canvas.width,canvas.height); bitmap.close();
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('截图编码失败')),'image/png'));
      saveBlob(blob,`sourcepin-${rect?'component':'viewport'}-${Date.now()}.png`);
      return '截图已发起下载（仅包含当前可见区域）';
    },
    async framework(element){
      const marker=`sp-${crypto.randomUUID()}`;
      element.setAttribute('data-sourcepin-probe',marker);
      try { return await request({type:'framework',marker}); }
      finally { element.removeAttribute('data-sourcepin-probe'); }
    }
  };
}
