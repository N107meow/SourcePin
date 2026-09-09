const SENSITIVE_NAME = /(?:pass(?:word)?|secret|token|auth|session|cookie|csrf|credit|card|cvv|cvc|api[-_]?key|private[-_]?key)/i;
// Field names such as "card" are sensitive; ordinary identity values such as
// "workspace-card" are not credentials and must remain usable as locators.
const SENSITIVE_VALUE = /(?:pass(?:word)?|secret|token|bearer|csrf|api[-_]?key|private[-_]?key)/i;
const EVENT_NAME = /^on/i;
const EXECUTABLE_URL = /^(?:javascript|data\s*:\s*text\/html)/i;
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'background']);
const OMIT_ATTRIBUTES = new Set(['value', 'srcdoc', 'nonce', 'integrity', 'style', 'srcset']);
const PRIVATE_CONTENT = 'script, style, noscript, template, object, embed, foreignObject, input, textarea, select, option, sourcepin-inspector, [data-sourcepin-root], [data-sourcepin-ui]';

function sanitizeUrl(value: string, base: string): string {
  const trimmed = value.trim();
  if (EXECUTABLE_URL.test(trimmed)) return '';
  try {
    const url = new URL(trimmed, base);
    if (!['http:', 'https:', 'blob:'].includes(url.protocol)) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_NAME.test(key)) url.searchParams.set(key, '[redacted]');
    }
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return trimmed.slice(0, 500);
  }
}

export function safeAttributes(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (EVENT_NAME.test(name) || OMIT_ATTRIBUTES.has(name) || SENSITIVE_NAME.test(name) || name.startsWith('data-sourcepin')) continue;
    let value = attribute.value;
    if (SENSITIVE_VALUE.test(value) && (name.startsWith('data-') || name.startsWith('aria-') || ['id','class','name'].includes(name))) continue;
    if (URL_ATTRIBUTES.has(name)) value = sanitizeUrl(value, element.ownerDocument.baseURI);
    if (!value && URL_ATTRIBUTES.has(name)) continue;
    result[name] = value.slice(0, 1000);
  }
  return result;
}

export function safeDocumentUrl(value: string): string {
  return sanitizeUrl(value, value);
}

export function safeText(element: Element, limit = 120): string {
  if (element.matches(PRIVATE_CONTENT)) return '';
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const parts: string[] = [];
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const parent = textNode.parentElement;
    const privateParent = parent?.closest(PRIVATE_CONTENT);
    if (!privateParent || !element.contains(privateParent)) parts.push(textNode.textContent ?? '');
    if (parts.join(' ').length >= limit * 2) break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function safeAssetUrl(value: string, base: string): string | null {
  const sanitized = sanitizeUrl(value, base);
  return sanitized && !EXECUTABLE_URL.test(sanitized) ? sanitized : null;
}

export function safeStyleValue(value: string, base: string): string {
  return value.replace(/url\((["']?)([^"')]+)\1\)/gi, (_match, quote: string, raw: string) => {
    const url = safeAssetUrl(raw, base);
    return url ? `url(${quote}${url}${quote})` : 'none';
  });
}
