// Chrome reports every injection failure through the same channel, so the tool
// used to blame the page for all of them: a heavy ordinary page that lost one
// race was told "此页面不允许注入。请在普通 HTTP/HTTPS 网页使用 SourcePin。",
// which was simply untrue. These helpers keep the toolbar message honest.

/** Chrome's own wording for pages that genuinely cannot be scripted. */
const BLOCKED = /cannot be scripted|cannot access contents|extensions gallery|chrome:\/\/|the extensions gallery|not allowed to|blocked/i;

export const RESTRICTED_HINT = '此页面不允许注入（浏览器内置页、扩展商店页或受保护页面）。';

/** Trims an error into something a toolbar tooltip can show without wrapping. */
export function failureReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.replace(/^Error:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 120) || '未知错误';
}

/**
 * The tooltip after a failed injection: name the real reason, and only claim the
 * page is protected when Chrome actually said so.
 */
export function injectionFailureTitle(error: unknown): string {
  const reason = failureReason(error);
  return BLOCKED.test(reason) ? `${RESTRICTED_HINT}原因：${reason}` : `注入失败：${reason}。可再点一次图标重试。`;
}
