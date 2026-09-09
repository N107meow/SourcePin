import type { Asset, Capture, CaptureOptions, NodeSnapshot, Rect, Styles } from '../types';
import { generateLocators } from './locators';
import { safeAssetUrl, safeAttributes, safeDocumentUrl, safeStyleValue, safeText } from './privacy';

const STYLE_PROPERTIES = [
  'display','position','inset','top','right','bottom','left','z-index','overflow','overflow-x','overflow-y',
  'box-sizing','width','height','min-width','min-height','max-width','max-height','margin','margin-top','margin-right','margin-bottom','margin-left',
  'padding','padding-top','padding-right','padding-bottom','padding-left','border','border-top-width','border-right-width','border-bottom-width','border-left-width',
  'border-top-style','border-right-style','border-bottom-style','border-left-style','border-top-color','border-right-color','border-bottom-color','border-left-color',
  'border-radius','box-shadow','opacity','visibility','transform','transform-origin','filter','background','background-color',
  'background-image','background-position','background-size','color','font','font-family','font-size','font-weight','font-style',
  'line-height','letter-spacing','text-align','text-decoration','text-transform','white-space','word-break','vertical-align',
  'cursor','pointer-events','user-select','object-fit','object-position','aspect-ratio','flex','flex-direction','flex-wrap',
  'justify-content','align-items','align-content','align-self','gap','grid','grid-template-columns','grid-template-rows',
  'grid-column','grid-row','animation','animation-name','animation-duration','animation-delay','animation-iteration-count','animation-direction','animation-fill-mode','animation-play-state','animation-timing-function',
  'transition','transition-property','transition-duration','transition-delay','transition-timing-function',
] as const;

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const EXCLUDED = 'script, style, noscript, template, object, embed, foreignObject, sourcepin-inspector, [data-sourcepin-root], [data-sourcepin-ui]';

function excluded(element: Element): boolean {
  return element.matches(EXCLUDED);
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.floor(value!), max)) : fallback;
}

function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function sampleStyles(element: Element): Styles {
  const view = element.ownerDocument.defaultView;
  if (!view) return {};
  const computed = view.getComputedStyle(element);
  return Object.fromEntries(STYLE_PROPERTIES.map((property) => [property, safeStyleValue(computed.getPropertyValue(property), element.ownerDocument.baseURI)]).filter(([, value]) => value));
}

function pseudoStyles(element: Element): Record<string, Styles> {
  const result: Record<string, Styles> = {};
  const view = element.ownerDocument.defaultView;
  if (!view) return result;
  for (const pseudo of ['::before', '::after']) {
    try {
      const computed = view.getComputedStyle(element, pseudo);
      const content = computed.getPropertyValue('content');
      if (content && content !== 'none' && content !== 'normal') {
        result[pseudo] = Object.fromEntries(['content','display','position','color','background','background-image','font','width','height'].map((property) => [property, safeStyleValue(computed.getPropertyValue(property), element.ownerDocument.baseURI)]).filter(([, value]) => value));
      }
    } catch { /* inaccessible pseudo styles are reported as absent */ }
  }
  return result;
}

function isVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const styles = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (!styles || styles.display === 'none' || styles.visibility === 'hidden' || Number(styles.opacity) === 0) return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function collectCssom(document: Document, snapshots: Map<Element, NodeSnapshot>): { rules: Map<string, string[]>; keyframes: string[]; inaccessible: boolean } {
  const rules = new Map<string, string[]>();
  const keyframes: string[] = [];
  let inaccessible = false;
  let visited = 0;
  const visit = (list: CSSRuleList) => {
    for (const rule of [...list]) {
      if (visited++ >= 2000) return;
      const nested = (rule as CSSGroupingRule).cssRules;
      if (rule.type === 7) {
        keyframes.push(safeStyleValue(rule.cssText, document.baseURI).slice(0, 8000));
      } else if (rule.type === 1) {
        const styleRule = rule as CSSStyleRule;
        for (const [element, snapshot] of snapshots) {
          try {
            if (element.matches(styleRule.selectorText)) {
              const entries = rules.get(snapshot.key) ?? [];
              if (entries.length < 20) entries.push(`${styleRule.selectorText}{${safeStyleValue(styleRule.style.cssText, document.baseURI)}}`);
              rules.set(snapshot.key, entries);
            }
          } catch { /* selector unsupported by matches() */ }
        }
      } else if (nested) visit(nested);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    if (visited >= 2000) break;
    try { if (sheet.cssRules) visit(sheet.cssRules); } catch { inaccessible = true; }
  }
  return { rules, keyframes, inaccessible };
}

function collectAnimations(root: Element, snapshots: Map<Element, NodeSnapshot>): unknown[] {
  const animations: unknown[] = [];
  try {
    for (const animation of root.getAnimations({ subtree: true }).slice(0, 100)) {
      const effect = animation.effect as KeyframeEffect | null;
      const target = effect?.target && effect.target.nodeType === Node.ELEMENT_NODE ? snapshots.get(effect.target as Element) : undefined;
      animations.push({
        target: target?.key ?? null,
        id: animation.id || undefined,
        playState: animation.playState,
        playbackRate: animation.playbackRate,
        timing: effect?.getTiming() ?? null,
        computedTiming: effect?.getComputedTiming() ?? null,
        keyframes: effect?.getKeyframes().slice(0, 100).map((frame) => Object.fromEntries(Object.entries(frame).map(([key, value]) => [key, typeof value === 'string' ? safeStyleValue(value, root.ownerDocument.baseURI) : value]))) ?? [],
      });
    }
  } catch { /* getAnimations may be unavailable on older engines */ }
  return animations;
}

function reachPath(element: Element): string[] {
  const result: string[] = [`document ${safeDocumentUrl(element.ownerDocument.URL)}`];
  let current: Node = element;
  while (true) {
    const root = current.getRootNode();
    const shadowHost = root.nodeType === 11 ? (root as ShadowRoot).host : null;
    if (shadowHost) {
      result.unshift(`open shadow host ${safeLabel(shadowHost)}`);
      current = shadowHost;
      continue;
    }
    const frame = (current.ownerDocument?.defaultView?.frameElement ?? null) as Element | null;
    if (frame) {
      result.unshift(`same-origin frame ${safeLabel(frame)}`);
      current = frame;
      continue;
    }
    break;
  }
  return result;
}

function safeLabel(element: Element): string {
  const id = safeAttributes(element).id;
  return element.localName + (id ? `#${id}` : '');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!);
}

function serialize(root: Element, snapshots: Map<Element, NodeSnapshot>): string {
  const visit = (element: Element): string => {
    const node = snapshots.get(element);
    if (!node) return '';
    const attributes = { ...node.attributes, class: [node.attributes.class, node.key].filter(Boolean).join(' ') };
    let output = `<${node.tag}${Object.entries(attributes).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('')}>`;
    if (!VOID.has(node.tag)) {
      let remainingText = 120;
      const suppressText = element.matches('textarea, select, option');
      for (const child of [...element.childNodes]) {
        if (child.nodeType === 3 && !suppressText && remainingText > 0) {
          const text = (child.textContent ?? '').slice(0, remainingText);
          remainingText -= text.length;
          output += escapeHtml(text);
        } else if (child.nodeType === 1) output += visit(child as Element);
      }
      output += `</${node.tag}>`;
    }
    return output;
  };
  return visit(root);
}

function tokens(nodes: NodeSnapshot[]): Record<string, string[]> {
  const values: Record<string, Set<string>> = { colors: new Set(), fonts: new Set(), radii: new Set(), spacing: new Set() };
  for (const node of nodes) {
    for (const property of ['color','background-color','border-color']) if (node.styles[property] && node.styles[property] !== 'rgba(0, 0, 0, 0)') values.colors.add(node.styles[property]);
    if (node.styles['font-family']) values.fonts.add(node.styles['font-family']);
    if (node.styles['border-radius'] && node.styles['border-radius'] !== '0px') values.radii.add(node.styles['border-radius']);
    for (const property of ['gap','padding','margin']) if (node.styles[property] && node.styles[property] !== '0px') values.spacing.add(node.styles[property]);
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, [...value].slice(0, 30)]));
}

function collectAssets(element: Element, styles: Styles): Asset[] {
  const assets: Asset[] = [];
  const add = (kind: string, raw: string | null, width?: number, height?: number) => {
    if (!raw) return;
    const url = safeAssetUrl(raw, element.ownerDocument.baseURI);
    if (url && !assets.some((asset) => asset.url === url)) assets.push({ kind, url, width, height });
  };
  if (element.localName === 'img') {
    const image = element as HTMLImageElement;
    add('image', image.currentSrc || image.src, image.naturalWidth, image.naturalHeight);
  }
  if (element.localName === 'video') {
    const video = element as HTMLVideoElement;
    add('video-poster', video.poster, video.videoWidth, video.videoHeight);
  }
  for (const match of styles['background-image']?.matchAll(/url\(["']?([^"')]+)["']?\)/g) ?? []) add('background-image', match[1]);
  return assets;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in globalThis) (globalThis as typeof globalThis & { requestIdleCallback(cb: () => void, options: {timeout: number}): number }).requestIdleCallback(resolve, { timeout: 16 });
    else setTimeout(resolve, 0);
  });
}

export async function captureElement(element: Element, options: CaptureOptions): Promise<Capture> {
  abort(options.signal);
  if (!element.isConnected) throw new DOMException('Target is detached', 'InvalidStateError');
  const maxNodes = boundedInteger(options.maxNodes, 300, 1, 1000);
  const maxDepth = boundedInteger(options.maxDepth, 6, 0, 20);
  const nodes: NodeSnapshot[] = [];
  const snapshots = new Map<Element, NodeSnapshot>();
  const assets: Asset[] = [];
  const pending: Array<{ element: Element; depth: number; parentKey: string }> = [{ element, depth: 0, parentKey: 'sp' }];
  while (pending.length && nodes.length < maxNodes) {
    abort(options.signal);
    const current = pending.pop()!;
    if (excluded(current.element)) continue;
    const key = `${current.parentKey}-${nodes.length}`;
    const styles = sampleStyles(current.element);
    const snapshot = { key, depth: current.depth, tag: current.element.localName, attributes: safeAttributes(current.element), text: safeText(current.element), styles, rect: rectOf(current.element), pseudo: pseudoStyles(current.element) };
    nodes.push(snapshot);
    snapshots.set(current.element, snapshot);
    for (const asset of collectAssets(current.element, styles)) if (!assets.some((candidate) => candidate.url === asset.url)) assets.push(asset);
    if (options.mode === 'pro' && current.depth < maxDepth) {
      const children = [...current.element.children];
      for (let index = children.length - 1; index >= 0; index--) pending.push({ element: children[index], depth: current.depth + 1, parentKey: key });
    }
    if (nodes.length % 25 === 0) await nextFrame();
  }
  abort(options.signal);
  const document = element.ownerDocument;
  const view = document.defaultView!;
  const rect = rectOf(element);
  const ancestors: string[] = [];
  for (let parent = element.parentElement; parent && ancestors.length < 3; parent = parent.parentElement) ancestors.push(safeLabel(parent));
  const cssom = options.mode === 'pro' ? collectCssom(document, snapshots) : { rules: new Map<string, string[]>(), keyframes: [], inaccessible: false };
  const css = options.mode === 'pro' ? nodes.map((node) => {
    const base = `.${node.key}{${Object.entries(node.styles).map(([property, value]) => `${property}:${value};`).join('')}}`;
    const pseudo = Object.entries(node.pseudo).map(([selector, styles]) => `.${node.key}${selector}{${Object.entries(styles).map(([property, value]) => `${property}:${value};`).join('')}}`).join('');
    const sourceRules = (cssom.rules.get(node.key) ?? []).map((rule) => `/* matched CSSOM: ${rule} */`).join('');
    return sourceRules + base + pseudo;
  }).join('\n') + (cssom.keyframes.length ? `\n${cssom.keyframes.join('\n')}` : '') : '';
  const animations = options.mode === 'pro' ? [...collectAnimations(element, snapshots), ...cssom.keyframes.map((cssText) => ({ kind: 'css-keyframes', cssText }))] : [];
  const degradations: string[] = [];
  if (pending.some(({ element: queued }) => !excluded(queued))) degradations.push(`Node budget reached (${maxNodes}); remaining descendants omitted.`);
  if (options.mode === 'pro' && [...snapshots.keys()].some((node) => snapshots.get(node)!.depth === maxDepth && [...node.children].some((child) => !excluded(child)))) degradations.push(`Depth budget reached (${maxDepth}); deeper descendants omitted.`);
  if (element.localName === 'canvas') degradations.push('Canvas pixels and rendering context were not inspected.');
  if (!document.styleSheets.length) degradations.push('No readable stylesheet source was available; scoped CSS uses computed styles.');
  if (cssom.inaccessible) degradations.push('One or more stylesheets were inaccessible; scoped CSS uses computed styles for affected rules.');
  if (options.mode === 'lite') degradations.push('Framework metadata is unavailable without a platform adapter.');
  const siblings = element.parentElement ? [...element.parentElement.children] : [element];
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}`,
    timestamp: new Date().toISOString(), mode: options.mode,
    meta: { url: safeDocumentUrl(document.URL), title: document.title, viewport: { width: view.innerWidth, height: view.innerHeight }, dpr: view.devicePixelRatio, scroll: { x: view.scrollX, y: view.scrollY }, reach: reachPath(element) },
    target: { tag: element.localName, text: safeText(element), attributes: safeAttributes(element), ancestors, childIndex: siblings.indexOf(element), typeIndex: siblings.filter((sibling) => sibling.localName === element.localName).indexOf(element), siblingCount: siblings.length, rect, visible: isVisible(element), inViewport: rect.y + rect.height > 0 && rect.x + rect.width > 0 && rect.y < view.innerHeight && rect.x < view.innerWidth },
    locators: generateLocators(element), nodes, html: options.mode === 'pro' ? serialize(element, snapshots) : '', css,
    tokens: tokens(nodes), assets, animations, degradations,
  };
}
