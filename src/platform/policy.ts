import { DEFAULT_SETTINGS, type Settings } from '../types';

export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const bound = (n: unknown, fallback: number, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(max,Math.max(min,Math.floor(n))) : fallback;
  return { mode:r.mode === 'pro' ? 'pro':'lite', language:r.language === 'en' ? 'en':'zh',
    maxNodes:bound(r.maxNodes,DEFAULT_SETTINGS.maxNodes,20,1000), maxDepth:bound(r.maxDepth,6,1,12), onboardingDone:r.onboardingDone === true, includeHidden:r.includeHidden === true };
}
export function safeFilename(name: string): string {
  return (name.split(/[\\/]/).pop() ?? 'sourcepin.md').replace(/[\x00-\x1f<>:"|?*]/g,'').slice(0,120) || 'sourcepin.md';
}
export function validateDownload(value: unknown): value is { text:string; filename:string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string,unknown>;
  return typeof v.text === 'string' && v.text.length <= 5_000_000 && typeof v.filename === 'string' && /\.md$/i.test(v.filename);
}
