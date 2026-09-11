import type { NodeSnapshot } from '../types';

export const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
const VOID = new Set(['area','base','br','col','embed','hr','img','image','input','link','meta','param','source','track','wbr']);
const TEXT_MARKER = '<!-- text truncated -->';
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]!);
export function contentNodes(element: Element): Node[] {
  return [...(element.localName === 'template' ? (element as HTMLTemplateElement).content.childNodes : element.childNodes)];
}
export function markupTags(node: NodeSnapshot): [string,string] {
  const attributes={...node.attributes,class:[node.attributes.class,node.key,node.styleKey].filter(Boolean).join(' ')};
  const attrs=Object.entries(attributes).map(([name,value])=>` ${name}="${escapeHtml(value)}"`).join('');
  if(node.tag === 'image') return [`<image${attrs}/>`, ''];
  return [`<${node.tag}${attrs}>`,VOID.has(node.tag)?'':`</${node.tag}>`];
}
export function directTextNodes(element: Element): Text[] {
  if(element.matches('input,textarea,select,option')) return [];
  return contentNodes(element).filter(node=>node.nodeType===3) as Text[];
}
export function nodeCss(node: NodeSnapshot): string {
  if(!Object.keys(node.styles).length)return '';
  const rule=(suffix: string,styles: Record<string,string>)=>`.${node.styleKey ?? node.key}${suffix}{${Object.entries(styles).map(([property,value])=>`${property}:${value};`).join('')}}`;
  return rule('',node.styles)+Object.entries(node.pseudo).map(([pseudo,styles])=>rule(pseudo,styles)).join('');
}
function safeEmbeddedCss(css: string): string { return css.replace(/<\/style/gi,match=>`\\3C ${match.slice(1)}`); }
function fitText(text: string, limit: number): string {
  if(byteLength(escapeHtml(text))<=limit)return text;
  let low=0,high=Math.min(text.length,limit);
  while(low<high){const middle=Math.ceil((low+high)/2);if(byteLength(escapeHtml(text.slice(0,middle)))<=limit)low=middle;else high=middle-1;}
  if(low>0 && /[\uD800-\uDBFF]/.test(text[low-1]))low--;
  return text.slice(0,low);
}
/** Skeleton is reserved before text, so a long paragraph cannot eat later tags.
 * This is also the size probe used during structure collection. */
export function serialize(root: Element,snapshots: Map<Element,NodeSnapshot>,maxBytes: number): {html:string;truncatedText:number;skeletonBytes:number} {
  const parts: Array<string | Text> = [];
  const representatives=new Map([...snapshots.values()].filter(node=>Object.keys(node.styles).length).map(node=>[node.styleKey??node.key,node]));
  const visit=(element: Element)=>{
    const node=snapshots.get(element);if(!node)return;
    const [open,close]=markupTags(node);parts.push(open);
    if(!close)return;
    if(element.shadowRoot){
      parts.push('<template shadowrootmode="open">');
      const shadowCss=[...snapshots].filter(([el])=>el.getRootNode()===element.shadowRoot).map(([,snapshot])=>representatives.get(snapshot.styleKey??snapshot.key)).filter((node):node is NodeSnapshot=>!!node);
      const shadowRules=groupedCss([...new Set(shadowCss)]);
      if(shadowRules)parts.push(`<style>${safeEmbeddedCss(shadowRules)}</style>`);
      for(const child of [...element.shadowRoot.children])visit(child);
      parts.push('</template>');
    }
    for(const child of contentNodes(element)){
      if(child.nodeType===1)visit(child as Element);
      else if(child.nodeType===3 && !element.matches('textarea,select,option'))parts.push(child as Text);
    }
    parts.push(close);
  };
  visit(root);
  const skeletonBytes=parts.reduce((size,part)=>size+byteLength(typeof part==='string'?part:TEXT_MARKER),0);
  let remaining=Math.max(0,maxBytes-skeletonBytes),truncatedText=0;
  const html=parts.map(part=>{
    if(typeof part==='string')return part;
    const original=part.data,kept=fitText(original,remaining),escaped=escapeHtml(kept);
    remaining-=byteLength(escaped);
    if(kept.length<original.length){truncatedText++;return escaped+TEXT_MARKER;}
    remaining+=byteLength(TEXT_MARKER);return escaped;
  }).join('');
  return {html,truncatedText,skeletonBytes};
}

/** Share declarations without changing per-node selector specificity. */
export function groupedCss(nodes:NodeSnapshot[]):string {
  let factored: string | undefined;
  if(nodes.some(node=>node.styleKey)){
    // Preserve property order (including shorthand/longhand precedence), while
    // sharing equal values across signatures instead of repeating whole blocks.
    const properties=new Map<string,Map<string,Set<string>>>();
    for(const node of nodes)for(const [suffix,styles] of [['',node.styles],...Object.entries(node.pseudo)] as Array<[string,Record<string,string>]>){
      for(const [property,value] of Object.entries(styles)){
        const values=properties.get(property)??new Map<string,Set<string>>();
        const selectors=values.get(value)??new Set<string>();
        selectors.add(`.${node.styleKey??node.key}${suffix}`);values.set(value,selectors);properties.set(property,values);
      }
    }
    factored=[...properties].flatMap(([property,values])=>[...values].map(([value,selectors])=>`${[...selectors].join(',')}{${property}:${value};}`)).join('\n');
  }
  const groups=new Map<string,string[]>();
  for(const node of nodes)for(const [suffix,styles] of [['',node.styles],...Object.entries(node.pseudo)] as Array<[string,Record<string,string>]>){
    if(!Object.keys(styles).length)continue;
    const declaration=Object.entries(styles).map(([key,value])=>`${key}:${value};`).join('');
    const selectors=groups.get(declaration)??[];selectors.push(`.${node.styleKey ?? node.key}${suffix}`);groups.set(declaration,selectors);
  }
  const grouped=[...groups].map(([declaration,selectors])=>`${selectors.join(',')}{${declaration}}`).join('\n');
  return factored!==undefined && byteLength(factored)<byteLength(grouped)?factored:grouped;
}
