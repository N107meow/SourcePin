import { parseSrcset } from './srcset';
import { excluded, parentElementOrHost, hiddenByStyle, readStyle, type StyleReader } from './dom';
const SENSITIVE_NAME = /(?:pass(?:word)?|secret|token|auth|session|cookie|csrf|credit|card|cvv|cvc|api[-_]?key|private[-_]?key)/i;
// Field names such as "card" are sensitive; ordinary identity values such as
// "workspace-card" are not credentials and must remain usable as locators.
export const SENSITIVE_VALUE = /(?:pass(?:word)?|secret|token|bearer|csrf|api[-_]?key|private[-_]?key)/i;
const EVENT_NAME = /^on/i;
const EXECUTABLE_URL = /^(?:javascript|data\s*:\s*text\/html)/i;
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'background']);
const OMIT_ATTRIBUTES = new Set(['value', 'srcdoc', 'nonce', 'integrity']);
const PRIVATE_CONTENT = 'script, style, noscript, template, object, embed, foreignObject, input, textarea, select, option, sourcepin-inspector, [data-sourcepin-root], [data-sourcepin-ui]';

function safeAttributeName(name: string): boolean {
  return /^[a-z_:][a-z0-9_.:-]*$/i.test(name) && !EVENT_NAME.test(name) && !OMIT_ATTRIBUTES.has(name) && !SENSITIVE_NAME.test(name) && !name.startsWith('data-sourcepin');
}

/** A name is sensitive when it says so on its own or as one segment of a
 * compound name: access_token, api-key, __Host-session. Values such as
 * "workspace-card" are identity, not credentials, and must stay usable. */
function sensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name) || name.split(/[^a-z0-9]+/i).some(segment => !!segment && SENSITIVE_NAME.test(segment));
}

/** RDP-ish fragment parameters split on separators instead of one strict
 * grammar, because fragments are not URLs and re-encoding them would break
 * normal anchors such as #/route/detail. */
function redactFragmentParameters(fragment: string, splitOnSemicolon: boolean): string {
  const separator = splitOnSemicolon ? /[&;]/ : /&/;
  return fragment.split(separator).map(part => {
    const equals = part.indexOf('=');
    if (equals < 0) return part;
    const name = part.slice(0, equals);
    const decoded = safeDecodeURIComponent(name);
    return sensitiveName(decoded) || sensitiveName(name) ? `${name}=[redacted]` : part;
  }).join('&');
}

/** Redacting the whole fragment keeps the output a valid URL and keeps the
 * fragment's role visible, without ever echoing a credential. The byte length
 * is preserved so a marker cannot be mistaken for the original text. */
function redactWholeFragment(fragment: string): string {
  return `#${'*'.repeat(Math.max(1, Math.min(200, fragment.length)))}`;
}

const SENSITIVE_VALUE_ONLY = /^=?(?![^=]*=)([A-Za-z0-9+_.%~-]{4,})$/;
/** A bare value (#=…) is withheld only when it is long and mixed, or when it
 * says what it is. "#token" names a credential; "#features" and "#/route" do
 * not, and an in-page anchor must keep working. */
function looksLikeCredential(value: string): boolean {
  const text = safeDecodeURIComponent(value);
  return text.length >= 20 && /[A-Za-z]/.test(text) && /[0-9]/.test(text);
}
/** Query and fragment are sanitized by different rules on purpose. The query is
 * always a real parameter list. A fragment is usually a plain in-page anchor, so
 * only parameter-shaped parts are rewritten: a decoded "#" inside a fragment
 * starts another fragment, not another value of the same one. */
export function safeFragment(value: string): string {
  const hashIndex = value.indexOf('#');
  if (hashIndex < 0) return '';
  const queryIndex = value.indexOf('?', hashIndex + 1);
  const parameters = (text: string) => redactFragmentParameters(text, false);
  // #/route?access_token=… keeps its route and loses only the token.
  const query = queryIndex < 0 ? '' : parameters(value.slice(queryIndex + 1));
  const segments = (queryIndex < 0 ? value.slice(hashIndex + 1) : value.slice(hashIndex + 1, queryIndex)).split('#').map(parameters);
  const fragment = segments.join('#');
  if (fragment.includes('=')) {
    const bare = SENSITIVE_VALUE_ONLY.exec(fragment);
    if (bare?.[1] && (sensitiveName(safeDecodeURIComponent(bare[1])) || looksLikeCredential(bare[1]))) return `#${fragment.slice(0, bare.index)}[redacted]`;
    return `#${queryIndex < 0 ? fragment : `${segments.join('#')}?${query}`}`;
  }
  // Nothing in a fragment without parameter text can be treated as a parameter
  // name, so a fragment that still names a credential is withheld in full.
  if (!sensitiveName(fragment) && !sensitiveName(safeDecodeURIComponent(fragment)) && !looksLikeCredential(fragment)) return `#${fragment}${query ? `?${query}` : ''}`;
  return redactWholeFragment(fragment);
}

function safeDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Strip userinfo even when the URL is malformed enough that the parser put
 * credential text into the host, which would otherwise be re-emitted by href. */
function scrubAuthority(href: string): string {
  return href.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i, (whole, scheme: string, authority: string) => {
    if (!authority.includes('@')) return whole;
    const host = authority.slice(authority.lastIndexOf('@') + 1);
    return host.includes('@') ? `${scheme}[redacted]` : `${scheme}${host}`;
  });
}

/** Redact credentials from query, fragment and userinfo in one place, so every
 * output path (meta.url, reach, locators, assets, CSS, HTML) agrees. */
export function safeUrl(value: string, base: string): string | null {
  const trimmed = value.trim();
  if (EXECUTABLE_URL.test(trimmed)) return null;
  return safeParsedUrl(trimmed, base) ?? safeFragment(trimmed) ?? null;
}

function safeParsedUrl(trimmed: string, base: string): string | null {
  try {
    const url = new URL(trimmed, base);
    if (!['http:', 'https:', 'blob:'].includes(url.protocol)) return null;
    // The fragment is read from the original text, not from url.hash: that one
    // is percent-encoded, and decoding it before the credential check would let
    // an escaped name walk past the filter.
    const fragment = safeFragment(trimmed);
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveName(key)) url.searchParams.set(key, '[redacted]');
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return scrubAuthority(url.href) + (fragment ?? '');
  } catch {
    // A URL that cannot be parsed is withheld except for a fragment that
    // sanitized cleanly: an anchor never carries a credential by itself.
    return null;
  }
}

export function safeAttributes(element: Element, base = element.ownerDocument.baseURI): { attributes: Record<string,string>; removed: string[] } {
  const result: Record<string, string> = {};
  const removed: string[] = [];
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (!safeAttributeName(name)) { removed.push(attribute.name); continue; }
    let value = attribute.value;
    if (SENSITIVE_VALUE.test(value) && (name.startsWith('data-') || name.startsWith('aria-') || ['id','class','name'].includes(name))) { removed.push(attribute.name); continue; }
    if (name === 'style') value = safeDeclarations((element as HTMLElement | SVGElement).style, base);
    else if (name === 'srcset') value = safeSrcset(value, base);
    else if (URL_ATTRIBUTES.has(name) || name === 'xlink:href') value = safeUrl(value, base) ?? '';
    if (!value && (URL_ATTRIBUTES.has(name) || ['style','srcset','xlink:href'].includes(name))) { removed.push(attribute.name); continue; }
    result[name] = ['style','srcset','sizes'].includes(name) ? value : value.slice(0, 1000);
  }
  return {attributes:result,removed};
}

export function safeDocumentUrl(value: string): string {
  // A URL that carries no usable form is omitted rather than echoed back: the
  // raw string is exactly the material this function exists to withhold.
  return safeUrl(value, value) ?? '';
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
  const sanitized = safeUrl(value, base);
  return sanitized && !EXECUTABLE_URL.test(sanitized) ? sanitized : null;
}

/** Share declaration filtering between sampled computed styles, page CSSOM,
 * keyframes and the recorder, so no output path has a looser rule than another. */
export function unsafeDeclaration(property: string, value: string): boolean {
  return sensitiveName(property) || SENSITIVE_VALUE.test(value.replace(/url\([^)]*\)/gi, '')) || /expression\s*\(|-moz-binding|behavior\s*:/i.test(value);
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
    if (unsafeDeclaration(property, value)) return [];
    return [`${property}: ${value}${style.getPropertyPriority(property) ? ' !important' : ''};`];
  }).join(' ');
}
function safeSrcset(value: string, base: string): string {
  return parseSrcset(value).flatMap(candidate => {
    const url=safeAssetUrl(candidate.url,base);
    return url ? [`${url}${candidate.descriptor ? ' '+candidate.descriptor : ''}`] : [];
  }).join(', ');
}

const ATTR_FUNCTION = /attr\(\s*(?:(["'])(.*?)\1|([^,)]+?))(?:\s+[^,)]*)?\s*\)/gi;
/** `content: attr(data-token)` republishes an attribute the attribute pass just
 * removed. A browser resolves attr() while computing the style, so the concrete
 * value arrives without saying where it came from: the reference is detected
 * statically and, when a removed attribute is present, confirmed by removing it
 * for one measurement and comparing what the pseudo element then renders. */
export function contentReferencesRemovedAttribute(content: string, element: Element, safe: Record<string, string>, read?: StyleReader): boolean {
  const names = new Set<string>();
  for (const match of content.matchAll(ATTR_FUNCTION)) {
    const name = (match[2] ?? match[3] ?? '').trim().toLowerCase();
    if (name) names.add(name);
  }
  for (const attribute of element.attributes) if (names.has(attribute.name.toLowerCase()) && !(attribute.name.toLowerCase() in safe)) return true;
  if (!read || element.attributes.length >= 50) return false;
  // A resolved attr() arrives as a quoted string, so the comparison ignores the
  // quotes the browser added around it.
  const body = content.replace(/^(["'])(.*)\1$/s, '$2');
  return [...element.attributes].some((attribute) => {
    const name = attribute.name.toLowerCase();
    if (name in safe) return false;
    if (!body.includes(attribute.value)) return false;
    try {
      element.removeAttribute(attribute.name);
      // Measure through the live view: a caller-supplied reader may cache the
      // declaration it returned before the attribute was removed.
      const without = element.ownerDocument.defaultView?.getComputedStyle(element, '::before')?.getPropertyValue('content');
      element.setAttribute(attribute.name, attribute.value);
      return without !== content;
    } catch { return true; }
  });
}
