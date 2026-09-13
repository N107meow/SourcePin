import type { Platform, Settings } from '../types';
import { normalizeSettings, safeFilename } from './policy';

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href=url; link.download=safeFilename(filename);
  link.dataset.sourcepinUi='true';
  link.style.display='none'; document.documentElement.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30_000);
}
const ONBOARDING_KEY = 'sourcepin:onboarding-seen';
// Only the installation preview persists this boolean; no page content or
// capture preferences are stored on the host site. Bookmarks skip the tour.
const previewMemory = globalThis as typeof globalThis & { __sourcepinGuideSeen?: boolean };
function previewSeen(): boolean {
  if (previewMemory.__sourcepinGuideSeen) return true;
  try { return localStorage.getItem(ONBOARDING_KEY) === 'true'; } catch { return false; }
}
export function createBrowserPlatform(kind: 'bookmarklet' | 'demo'): Platform {
  let settings = normalizeSettings({onboardingDone:kind==='bookmarklet' || previewSeen()});
  return {
    kind,
    async loadSettings(){ return settings; },
    async saveSettings(value: Settings){
      settings=normalizeSettings(value);
      if(kind==='demo' && settings.onboardingDone){
        previewMemory.__sourcepinGuideSeen=true;
        try { localStorage.setItem(ONBOARDING_KEY,'true'); } catch { /* Keep the current-page memory when storage is blocked. */ }
      }
    },
    async copy(text){
      if (!navigator.clipboard?.writeText) throw new Error('当前页面不支持剪贴板写入，请使用 HTTPS 页面或下载 Markdown。');
      await navigator.clipboard.writeText(text);
    },
    async download(text,filename){ saveBlob(text instanceof Blob?text:new Blob([text],{type:'text/markdown;charset=utf-8'}),filename); return '已发起下载，保存位置由浏览器设置决定'; }
  };
}
