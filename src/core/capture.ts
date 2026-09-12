import { createStyleIndex } from './style-index';
import { TOOL_VERSION, RIGHTS_NOTICE } from './provenance';
import type { Asset, Capture, CaptureOptions, NodeSnapshot, Rect, Styles } from '../types';
import { excluded, visibleChildren, hiddenByStyle, parentElementOrHost, readStyle, type StyleReader } from './dom';
import { generateLocators } from './locators';
import { contentReferencesRemovedAttribute, safeAssetUrl, safeAttributes, safeDeclarations, safeDocumentUrl, safeStyleValue, safeText, unsafeDeclaration } from './privacy';

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

import { serialize, byteLength, markupTags, directTextNodes, contentNodes, nodeCss, groupedCss } from './serialize';
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

export function sampleStyles(element: Element, read: StyleReader = readStyle): Styles {
  const view = element.ownerDocument.defaultView;
  if (!view) return {};
  const computed = read(element)!;
  return Object.fromEntries(STYLE_PROPERTIES.map((property) => {
    const value = safeStyleValue(computed.getPropertyValue(property), element.ownerDocument.baseURI);
    return [property, unsafeDeclaration(property, value) ? '' : value];
  }).filter(([, value]) => value));
}

const PSEUDO_PROPERTIES = ['content','display','position','color','background','background-image','font','width','height'] as const;

/** Computed and pseudo styles share the attribute pass's verdict: a declaration
 * that republishes a removed attribute, or that is itself sensitive, is dropped
 * rather than trimmed, so no fragment of the original value can survive. */
function pseudoStyles(element: Element, safe: Record<string,string>, read: StyleReader = readStyle): { styles: Record<string, Styles>; filtered: number } {
  const result: Record<string, Styles> = {};
  let filtered = 0;
  const view = element.ownerDocument.defaultView;
  if (!view) return { styles: result, filtered };
  for (const pseudo of ['::before', '::after']) {
    try {
      const computed = read(element, pseudo)!;
      const content = computed.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') continue;
      if (contentReferencesRemovedAttribute(content, element, safe, read)) { filtered++; continue; }
      result[pseudo] = Object.fromEntries(PSEUDO_PROPERTIES.map((property) => {
        const value = property === 'content' ? content.slice(0, 1000) : safeStyleValue(computed.getPropertyValue(property), element.ownerDocument.baseURI);
        if (unsafeDeclaration(property, value)) { filtered++; return [property, '']; }
        return [property, value];
      }).filter(([, value]) => value));
    } catch { /* inaccessible pseudo styles are reported as absent */ }
  }
  return { styles: result, filtered };
}

function isVisible(element: Element, read: StyleReader = readStyle): boolean {
  for (let current: Element | null = element; current; current = parentElementOrHost(current)) {
    const styles = read(current);
    if (!styles || styles.display === 'none' || styles.visibility === 'hidden' || styles.visibility === 'collapse' || (current===element && Number(styles.opacity) === 0)) return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function collectCssom(document: Document, snapshots: Map<Element, NodeSnapshot>): { rules: Map<string, string[]>; keyframes: string[]; inaccessible: boolean; limited: boolean; visited:number; matches:number } {
  const rules = new Map<string, string[]>();
  const keyframes: string[] = [];
  let inaccessible = false;
  let visited = 0, limited = false, matches=0;
  const candidates=createStyleIndex([...snapshots.keys()]);
  const visit = (list: CSSRuleList) => {
    for (const rule of [...list]) {
      if (visited >= 2000) {limited=true;return;}
      visited++;
      const nested = (rule as CSSGroupingRule).cssRules;
      if (rule.type === 7) {
        if(rule.cssText.length>8000)limited=true;
        const frames=rule as CSSKeyframesRule;
        const serialized=`@keyframes ${frames.name}{${[...frames.cssRules].map(frame=>`${(frame as CSSKeyframeRule).keyText}{${safeDeclarations((frame as CSSKeyframeRule).style,document.baseURI)}}`).join('')}}`;
        if(serialized.length<=8000)keyframes.push(serialized);
      } else if (rule.type === 1) {
        const styleRule = rule as CSSStyleRule;
        for (const element of candidates(styleRule.selectorText)) {
          const snapshot=snapshots.get(element)!;
          try {
            matches++;
            if (element.matches(styleRule.selectorText)) {
              const entries = rules.get(snapshot.key) ?? [];
              if (entries.length >= 20)limited=true;
              if (entries.length < 20) entries.push(`.${snapshot.key}{${safeDeclarations(styleRule.style, document.baseURI)}}`);
              rules.set(snapshot.key, entries);
            }
          } catch { /* selector unsupported by matches() */ }
        }
      } else if (nested) visit(nested);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    if (visited >= 2000) {limited=true;break;}
    try { if (sheet.cssRules) visit(sheet.cssRules); } catch { inaccessible = true; }
  }
  return { rules, keyframes, inaccessible, limited, visited, matches };
}

function collectAnimations(root: Element, snapshots: Map<Element, NodeSnapshot>): unknown[] {
  const animations: unknown[] = [];
  try {
    for (const animation of root.getAnimations({ subtree: true }).slice(0, 100)) {
      const effect = animation.effect as KeyframeEffect | null;
      const target = effect?.target && effect.target.nodeType === Node.ELEMENT_NODE ? snapshots.get(effect.target as Element) : undefined;
      if(!target)continue;
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
  const id = safeAttributes(element).attributes.id;
  return element.localName + (id ? `#${id}` : '');
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
  const scheduler=(globalThis as typeof globalThis & {scheduler?:{yield():Promise<void>}}).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve=>setTimeout(resolve,0));
}

export async function captureElement(element: Element, options: CaptureOptions): Promise<Capture> {
  abort(options.signal);
  if (!element.isConnected) throw new DOMException('Target is detached', 'InvalidStateError');
  const kind=options.kind ?? 'element', full=kind==='page' || options.mode==='pro';
  const maxNodes=boundedInteger(options.maxNodes,kind==='page'?20000:300,1,kind==='page'?100000:1000);
  const maxDepth=boundedInteger(options.maxDepth,kind==='page'?40:6,0,kind==='page'?100:20);
  const maxBytes=boundedInteger(options.maxBytes,2*1024*1024,4096,8*1024*1024);
  const maxStyleNodes=boundedInteger(options.maxStyleNodes,kind==='page'?120:maxNodes,0,maxNodes);
  const document=element.ownerDocument,view=document.defaultView!;
  const snapshots=new Map<Element,NodeSnapshot>(), sampled=new Map<Element,NodeSnapshot>();
  const nodes: NodeSnapshot[]=[], assets: Asset[]=[], degradations: string[]=[];
  let hiddenExcluded=0,hiddenIncluded=0,filtered=0,attributeFiltered=0,styleFiltered=0,depthLimited=false,byteLimited=false;
  let structureBytes=2,styleBytes=0,shadowCount=0,iframeCount=0;
  // Capture-local cache: normal and pseudo declarations are distinct CSSOM objects.
  const computedCache=new WeakMap<Element,Map<string,CSSStyleDeclaration>>();
  const read: StyleReader=(el,pseudo='')=>{
    let entry=computedCache.get(el);if(!entry){entry=new Map();computedCache.set(el,entry);}
    if(!entry.has(pseudo)){const style=readStyle(el,pseudo || undefined);if(style)entry.set(pseudo,style);}
    return entry.get(pseudo);
  };
  const signatures=new Map<string,string>();
  const representatives=new Map<string,NodeSnapshot>();
  const attempted=new Set<string>();
  const shadowStyles=new WeakMap<Node,Set<string>>();
  const safeIdentity=new WeakMap<Element,string>();
  const identity=(el:Element,attributes?:Record<string,string>)=>{
    let value=safeIdentity.get(el);
    if(value===undefined){const safe=attributes??safeAttributes(el,document.baseURI).attributes;value=JSON.stringify([el.localName,safe.class??'',safe.id??'',safe.style??'']);safeIdentity.set(el,value);}
    return value;
  };
  const stylePool=new Map<string,Styles>();
  const intern=(styles:Styles)=>{const key=JSON.stringify(styles);const existing=stylePool.get(key);if(existing)return existing;stylePool.set(key,styles);return styles;};
  let yieldedAt=performance.now(),yields=0;
  const removedNames=new Map<string,number>();
  const pending: Array<{element:Element;depth:number;hidden:boolean}>= [{element,depth:0,hidden:false}];
  let ancestorHidden=false;
  for(let parent=parentElementOrHost(element);parent;parent=parentElementOrHost(parent))ancestorHidden ||= hiddenByStyle(parent,read);
  while(pending.length && nodes.length<maxNodes){
    abort(options.signal);
    const current=pending.pop()!,el=current.element;
    if(excluded(el)){filtered++;continue;}
    const hidden=current.hidden || (current.depth===0 && ancestorHidden) || hiddenByStyle(el,read);
    if(hidden && !options.includeHidden){hiddenExcluded++;continue;}
    if(hidden)hiddenIncluded++;
    const audit=safeAttributes(el,document.baseURI), attributes=audit.attributes;
    for(const name of audit.removed)removedNames.set(name,(removedNames.get(name) ?? 0)+1);
    attributeFiltered += [...el.attributes].filter(attr=>!(attr.name in attributes) || attributes[attr.name]!==attr.value).length;
    if(hidden)attributes['data-sourcepin-hidden']='true';
    const key=`sp-${nodes.length}`;
    const text=directTextNodes(el).map(node=>node.data).join('').replace(/\s+/g,' ').trim().slice(0,120);
    const snapshot: NodeSnapshot={key,depth:current.depth,tag:el.localName,attributes,text,styles:{},rect:rectOf(el),pseudo:{}};
    if(kind==='page'){
      const ancestry=[identity(el,attributes)];
      for(let parent=parentElementOrHost(el),depth=0;parent && depth<2;parent=parentElementOrHost(parent),depth++)ancestry.push(identity(parent));
      const signature=JSON.stringify(ancestry);
      if(!signatures.has(signature))signatures.set(signature,`sp-s-${signatures.size}`);
      snapshot.styleKey=signatures.get(signature)!;
    }
    if(sampled.size<maxStyleNodes && (!snapshot.styleKey || !attempted.has(snapshot.styleKey))){
      if(snapshot.styleKey)attempted.add(snapshot.styleKey);
      const styles=sampleStyles(el,read),pseudoSample=pseudoStyles(el,attributes,read),pseudo=pseudoSample.styles;
      styleFiltered+=pseudoSample.filtered;
      const cost=byteLength(nodeCss({...snapshot,styles,pseudo}));
      if(styleBytes+cost<=maxBytes/4){snapshot.styles=intern(styles);snapshot.pseudo=Object.fromEntries(Object.entries(pseudo).map(([key,value])=>[key,intern(value)]));styleBytes+=cost;}
    }
    // Reserve HTML skeleton, direct-text markers and per-node CSS before text.
    // JSON nodes + HTML + CSS share this byte ceiling; metadata is separate.
    const hasShadow=!!el.shadowRoot;
    const root=el.getRootNode(),styleKey=snapshot.styleKey??snapshot.key;
    let shadowExtra=0;
    if((root as ShadowRoot).host){
      const keys=shadowStyles.get(root)??new Set<string>();
      const representative=snapshot.styleKey?representatives.get(snapshot.styleKey):undefined;
      if(!keys.has(styleKey) && !Object.keys(snapshot.styles).length && representative)shadowExtra=byteLength(nodeCss(representative))+1;
      keys.add(styleKey);shadowStyles.set(root,keys);
    }
    const cost=shadowExtra+byteLength(JSON.stringify(snapshot))+1+byteLength(markupTags(snapshot).join(''))+directTextNodes(el).length*23+byteLength(nodeCss(snapshot))*2+(hasShadow?80:0);
    if(structureBytes+cost>maxBytes-1024){byteLimited=true;break;}
    structureBytes+=cost;nodes.push(snapshot);snapshots.set(el,snapshot);
    if(Object.keys(snapshot.styles).length){sampled.set(el,snapshot);if(snapshot.styleKey)representatives.set(snapshot.styleKey,snapshot);}
    if(hasShadow)shadowCount++;
    if(el.localName==='iframe')iframeCount++;
    for(const asset of collectAssets(el,snapshot.styles))if(!assets.some(candidate=>candidate.url===asset.url))assets.push(asset);
    if(full){
      const children=[...contentNodes(el).filter(child=>child.nodeType===1) as Element[],...el.shadowRoot?.children ?? []];
      if(current.depth<maxDepth)for(let i=children.length-1;i>=0;i--)pending.push({element:children[i],depth:current.depth+1,hidden});
      else if(children.some(child=>!excluded(child)))depthLimited=true;
    }
    if(nodes.length%500===0 || performance.now()-yieldedAt>=8){await nextFrame();yieldedAt=performance.now();yields++;}
  }
  abort(options.signal);
  const cssom=full ? collectCssom(document,sampled) : {rules:new Map<string,string[]>(),keyframes:[],inaccessible:false,limited:false,visited:0,matches:0};
  const baseCss=full?groupedCss(nodes):'';
  // Source rules are supplementary evidence. Bound them separately so they
  // cannot consume the structure/text allowance or turn sampling quadratic.
  const sourceCss=full?[...cssom.rules.values()].flat().map(rule=>`/* matched CSSOM: ${rule.replaceAll('*/','* /')} */`).join('\n'):'';
  let css=baseCss;
  const supplemental=sourceCss+'\n'+cssom.keyframes.join('\n');
  if(full && byteLength(supplemental)<=Math.min(32768,Math.max(0,maxBytes-structureBytes-1024)))css+='\n'+supplemental;
  else if(full && supplemental.trim())degradations.push('CSS source byte budget reached; supplementary CSSOM rules/keyframes omitted.');
  const markup=full?serialize(element,snapshots,maxBytes-byteLength(css)-byteLength(JSON.stringify(nodes))):{html:'',truncatedText:0};
  const rect=rectOf(element),htmlRect=rectOf(document.documentElement);
  const ancestors: string[]=[];
  for(let parent=element.parentElement;parent && ancestors.length<3;parent=parent.parentElement)ancestors.push(safeLabel(parent));
  if(pending.length && !byteLimited)degradations.push(`Node budget reached (${maxNodes}); remaining descendants omitted.`);
  if(depthLimited)degradations.push(`Depth budget reached (${maxDepth}); deeper descendants omitted.`);
  if(byteLimited)degradations.push(`Structure byte budget reached (${maxBytes}); remaining descendants omitted.`);
  if(markup.truncatedText)degradations.push(`Global text byte budget reached (${maxBytes} bytes shared by nodes/HTML/CSS); ${markup.truncatedText} text nodes truncated with visible markers.`);
  degradations.push('Target and Structure text fields are summaries (up to 120 characters); full eligible text is in Cleaned HTML, subject to the global byte budget.');
  if(hiddenExcluded)degradations.push(`${hiddenExcluded} hidden subtrees excluded by default; their content was not captured.`);
  if(hiddenIncluded)degradations.push(`${hiddenIncluded} hidden nodes included by explicit opt-in and marked data-sourcepin-hidden.`);
  if(filtered)degradations.push(`${filtered} executable, private or tool subtrees filtered; content not captured.`);
  if(removedNames.size)degradations.push(`Removed attributes (${[...removedNames.values()].reduce((sum,n)=>sum+n,0)}): ${[...removedNames].sort().map(([name,n])=>`${name}: ${n}`).join(', ')}. Values are not retained in this audit.`);
  if(attributeFiltered)degradations.push(`${attributeFiltered} attributes filtered, normalized or redacted (including form values, event handlers and sensitive URL parameters).`);
  if(styleFiltered)degradations.push(`${styleFiltered} computed or pseudo-element declarations omitted because they derive from filtered attributes or are themselves sensitive; remaining text and layout are unaffected.`);
  if([...snapshots.keys()].some(el=>el.matches('input,textarea,select,option')))degradations.push('Form values and control text were excluded.');
  if([...snapshots.keys()].some(el=>el.localName==='template'))degradations.push('Template contents retained as inert markup; computed layout is unavailable until instantiated.');
  if([...snapshots.keys()].some(el=>el.localName==='canvas'))degradations.push('Canvas pixels and rendering context were not inspected.');
  const covered=nodes.filter(node=>Object.keys(node.styles).length || (node.styleKey && representatives.has(node.styleKey))).length;
  const coverage=`Sampled ${sampled.size}/${nodes.length} nodes; covered ${covered}/${nodes.length} (${nodes.length?(covered/nodes.length*100).toFixed(1):0}%); ${nodes.length-covered} uncovered nodes have no captured computed/pseudo rules (safe inline styles and browser inheritance may still apply).`;
  if(full)degradations.push(coverage);
  if(kind==='page')degradations.push('Shared style signatures use sanitized tag/class/id/style and up to two ancestors. Representative style approximation: same-signature nodes may differ due to :nth-child, more distant ancestors, layout or state; their own computed/pseudo styles are not individually sampled.');
  if(full && !document.styleSheets.length)degradations.push('No readable stylesheet source was available; scoped CSS uses computed styles.');
  if(cssom.limited)degradations.push('CSSOM sampling limit reached (2000 rules, 20 matches per sampled node, 8000 characters per keyframe); remaining source rules omitted.');
  if(full)degradations.push('Animations sampled at most 100 animations and 100 keyframes per animation; unobserved interactions and server behavior remain unknown.');
  if(cssom.inaccessible)degradations.push('One or more stylesheets were inaccessible; scoped CSS uses sampled computed styles for affected rules.');
  let ancestorOpacityZero=false;
  for(let parent=parentElementOrHost(element);parent;parent=parentElementOrHost(parent))if(Number(read(parent)!.opacity)===0)ancestorOpacityZero=true;
  if(ancestorOpacityZero)degradations.push('Ancestor opacity is zero; target visible reports its own opacity and layout, not ancestor animation state.');
  if(full)degradations.push(`Sampling policy: CSSOM up to 2000 rules, 20 matches per sampled node, 8000 characters per keyframe, 32768 supplementary CSS bytes; visited ${cssom.visited} rules, ${cssom.matches} candidate matches; ${stylePool.size} interned style sets. Yield every 500 nodes or 8 ms via scheduler.yield/setTimeout (${yields} yields).`);
  const siblings=element.parentElement?visibleChildren(element.parentElement):[element];
  const images=[...document.images].filter(img=>!excluded(img) && !img.closest('sourcepin-inspector,[data-sourcepin-root]'));
  const capabilities: Capture['capabilities']={
    markup:{status:markup.html?'present':'absent',reason:full?(markup.html?'Sanitized markup; see budgets and filtering below.':'No eligible markup within capture policy/budget.'):'Lite element capture does not collect markup (Lite 元素形态).'},
    css:{status:css.trim()?'present':'absent',reason:full?(css.trim()?'Scoped sampled styles; not a complete stylesheet archive.':'No CSS available within the independent style sampling/source budget.'):'Lite element capture does not serialize CSS.'},
    computedStyles:{status:sampled.size?'present':'absent',count:sampled.size,total:nodes.length,reason:`${coverage} Independent representative sampling limit ${maxStyleNodes}; CSS byte budget ${maxBytes/4}.`},
    recording:{status:'absent',reason:'No interaction recording is attached to this capture.'},
    framework:{status:'absent',reason:'Framework metadata requires a platform adapter; not collected by the DOM core.'},
    screenshot:{status:'absent',reason:'No screenshot is embedded; screenshots are a separate explicit operation.'},
    shadowDom:{status:full && shadowCount?'present':'absent',count:shadowCount,reason:full?`${shadowCount} open shadow roots serialized as declarative templates; closed roots cannot be inspected.`:'Shadow subtrees are not serialized in Lite element capture; closed roots cannot be inspected.'},
    iframes:{status:'absent',count:iframeCount,reason:`${iframeCount} iframe placeholders; iframe content was not captured (same-origin or cross-origin).`},
    hiddenContent:{status:hiddenIncluded?'present':'absent',count:options.includeHidden?hiddenIncluded:hiddenExcluded,reason:options.includeHidden?'Explicit opt-in: included hidden nodes are marked.':`${hiddenExcluded} hidden subtrees excluded by default.`},
  };
  for(const [name,capability] of Object.entries(capabilities))if(capability.status==='absent')degradations.push(`${name}: absent — ${capability.reason}`);
  return {
    id:globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}`,timestamp:new Date().toISOString(),mode:options.mode,capabilities,
    meta:{toolVersion:TOOL_VERSION,rights:RIGHTS_NOTICE,captureKind:kind,documentHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight ?? 0),documentElementRect:htmlRect,htmlRect,images:{total:images.length,complete:images.filter(img=>img.complete).length},budgets:{maxNodes,maxDepth,maxBytes,maxStyleNodes},url:safeDocumentUrl(document.URL),title:document.title,viewport:{width:view.innerWidth,height:view.innerHeight},dpr:view.devicePixelRatio,scroll:{x:view.scrollX,y:view.scrollY},reach:reachPath(element)},
    target:{tag:element.localName,text:safeText(element,120,options.includeHidden,read),attributes:hiddenExcluded && !nodes.length?{}:safeAttributes(element).attributes,ancestors,childIndex:siblings.indexOf(element),typeIndex:siblings.filter(sibling=>sibling.localName===element.localName).indexOf(element),siblingCount:siblings.length,rect,visible:isVisible(element,read),ancestorOpacityZero,inViewport:rect.y+rect.height>0 && rect.x+rect.width>0 && rect.y<view.innerHeight && rect.x<view.innerWidth},
    locators:generateLocators(element,read),nodes,html:markup.html,css,tokens:tokens(nodes),assets,
    animations:full?[...collectAnimations(element,sampled),...cssom.keyframes.map(cssText=>({kind:'css-keyframes',cssText}))]:[],degradations,
  };
}
