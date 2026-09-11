import { parseSrcset } from './srcset';
import { excluded, parentElementOrHost, hiddenByStyle, readStyle, type StyleReader } from './dom';
const SENSITIVE_NAME = /(?:pass(?:word)?|secret|token|auth|session|cookie|csrf|credit|card|cvv|cvc|api[-_]?key|private[-_]?key)/i;
// Field names such as "card" are sensitive; ordinary identity values such as
// "workspace-card" are not credentials and must remain usable as locators.
const SENSITIVE_VALUE = /(?:pass(?:word)?|secret|token|bearer|csrf|api[-_]?key|private[-_]?key)/i;
const EVENT_NAME = /^on/i;
const EXECUTABLE_URL = /^(?:javascript|data\s*:\s*text\/html)/i;
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'background']);
const OMIT_ATTRIBUTES = new Set(['value', 'srcdoc', 'nonce', 'integrity']);
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
    return '';
  }
}

export function safeAttributes(element: Element, base = element.ownerDocument.baseURI): { attributes: Record<string,string>; removed: string[] } {
  const result: Record<string, string> = {};
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (!/^[a-z_:][a-z0-9_.:-]*$/i.test(name) || EVENT_NAME.test(name) || OMIT_ATTRIBUTES.has(name) || SENSITIVE_NAME.test(name) || name.startsWith('data-sourcepin')) continue;
    let value = attribute.value;
    if (SENSITIVE_VALUE.test(value) && (name.startsWith('data-') || name.startsWith('aria-') || ['id','class','name'].includes(name))) continue;
    if (name === 'style') value = safeDeclarations((element as HTMLElement | SVGElement).style, base);
    else if (name === 'srcset') value = safeSrcset(value, base);
    else if (URL_ATTRIBUTES.has(name) || name === 'xlink:href') value = sanitizeUrl(value, base);
    if (!value && (URL_ATTRIBUTES.has(name) || ['style','srcset','xlink:href'].includes(name))) continue;
    result[name] = ['style','srcset','sizes'].includes(name) ? value : value.slice(0, 1000);
  }
  return {attributes:result,removed:[...element.attributes].map(attribute=>attribute.name).filter(name=>!(name.toLowerCase() in result))};
}

export function safeDocumentUrl(value: string): string {
  return sanitizeUrl(value, value);
}

export function safeText(element: Element, limit = 120, includeHidden = false, read: StyleReader = readStyle): string {
  if (element.matches(PRIVATE_CONTENT) || excluded(element)) return '';
  if (!includeHidden) for(let current: Element | null = element; current; current = parentElementOrHost(current)) if(hiddenByStyle(current, read)) return '';
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const parts: string[] = [];
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const parent = textNode.parentElement;
    const privateParent = parent?.closest(PRIVATE_CONTENT);
    let blocked = !!privateParent && element.contains(privateParent);
    for(let current: Element | null=parent; current && current!==element; current=parentElementOrHost(current)) {
      if(excluded(current) || (!includeHidden && hiddenByStyle(current, read))) {blocked=true;break;}
    }
    if (!blocked) parts.push(textNode.textContent ?? '');
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


export function safeDeclarations(style: CSSStyleDeclaration | undefined, base: string): string {
  if (!style) return '';
  return [...style].flatMap(property => {
    const value = safeStyleValue(style.getPropertyValue(property), base);
    if (SENSITIVE_NAME.test(property) || SENSITIVE_VALUE.test(value.replace(/url\([^)]*\)/gi, '')) || /expression\s*\(|-moz-binding|behavior\s*:/i.test(value)) return [];
    return [`${property}: ${value}${style.getPropertyPriority(property) ? ' !important' : ''};`];
  }).join(' ');
}
function safeSrcset(value: string, base: string): string {
  return parseSrcset(value).flatMap(candidate => {
    const url=safeAssetUrl(candidate.url,base);
    return url ? [`${url}${candidate.descriptor ? ' '+candidate.descriptor : ''}`] : [];
  }).join(', ');
}
