import {parseSrcset} from './srcset';
import type {Capture} from '../types';
import {renderMarkdown, type MarkdownOptions} from './markdown';
import {RIGHTS_NOTICE, TOOL_VERSION} from './provenance';
import {safeAssetUrl} from './privacy';
import {createZip} from './zip';
import {byteLength, escapeHtml} from './serialize';

export const EXPORT_LIMITS={maxZipBytes:16*1024*1024,maxHtmlBytes:8*1024*1024,maxReportBytes:4*1024*1024,maxAssetBytes:2*1024*1024,maxAssetTotalBytes:4*1024*1024,maxAssets:80,timeoutMs:20_000};
type Options=Partial<typeof EXPORT_LIMITS> & MarkdownOptions & {signal?:AbortSignal};
const PLACEHOLDER='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#eee"/><text x="5" y="24" font-size="10">Unavailable</text></svg>');
const embeddedCss=(text:string)=>text.replace(/<\/style/gi,match=>`\\3C ${match.slice(1)}`);
/** Report the real byte share of each part so an oversize export says what to cut. */
const check=(value:string,limit:number,label:string,parts?:Array<[string,number]>)=>{
 const size=byteLength(value);
 if(size>limit){
  const detail=parts?.length?` Breakdown: ${parts.map(([name,bytes])=>`${name} ${bytes}`).join(', ')} bytes.`:'';
  throw new Error(`${label} exceeds ${limit} bytes (requested ${size}); reduce capture range or viewports. No files were exported.${detail}`);
 }
 return value;
};
const CSS_URL=/url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
const csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; script-src 'none'";


/** Neutral marker for one image position: keeps the box, carries no pixels. */
function markerSvg(width:number,height:number):string{
 return `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(Math.max(1,width),4000)}" height="${Math.min(Math.max(1,height),4000)}"><rect width="100%" height="100%" fill="#e8e8e8"/><text x="50%" y="50%" fill="#8a8a8a" font-family="sans-serif" font-size="11" text-anchor="middle" dominant-baseline="middle">image</text></svg>`)}`;
}
function descendants(root:DocumentFragment):Element[]{const nodes:Element[]=[];for(const node of root.querySelectorAll('*')){nodes.push(node);if(node.localName==='template')nodes.push(...descendants((node as HTMLTemplateElement).content));}return nodes;}

/** Reads only resource URLs referenced by this user-selected snapshot, after confirmation. */
export async function createPagePackage(captures:Capture[],options:Options={}):Promise<Blob>{
 const limits={...EXPORT_LIMITS};
 for(const key of Object.keys(limits) as Array<keyof typeof EXPORT_LIMITS>)if(Number.isFinite(options[key]))limits[key]=Math.max(key==='timeoutMs'?1:0,Math.min(limits[key],Math.floor(options[key]!)));
 options.signal?.throwIfAborted();
 // Reject oversized reports before making any resource requests.
 renderMarkdown(captures,{...options,maxBytes:limits.maxReportBytes});
 const files:Record<string,string>={},prepared:Capture[]=[];
 // Images are marked in place, never downloaded: the offline file keeps the
 // layout and the URL of every image, and carries no image bytes at all.
 const assets:{url:string;status:'marked';bytes:number;reason:string}[]=[];
 for(const [index,capture] of captures.entries()){
  options.signal?.throwIfAborted();
  const filename=index===0?'page.html':`page-${index+1}.html`;
  const template=document.createElement('template');
  // Template parsing is inert (including images). Preserve body attributes via a temporary div.
  const isBody=/^<body(?:\s|>)/i.test(capture.html);
  template.innerHTML=isBody?capture.html.replace(/^<body/i,'<div').replace(/<\/body>$/i,'</div>'):capture.html;
  const all=descendants(template.content);
  const nodeKeys=new Set(capture.nodes.map(node=>node.key));
  const marked=new Set<string>();
  // Record an image position once per file; the offline page shows a marker, not pixels.
  const mark=(raw:string,node:Element|null)=>{
   // Record the sanitized location only. An executable or credential URL never
   // reaches the audit trail, and a data: URL is not a location worth listing.
   const safe=safeAssetUrl(raw,capture.meta.url);
   if(!safe || safe.startsWith('data:'))return safe;
   if(!marked.has(safe)){
    marked.add(safe);
    assets.push({url:safe,status:'marked',bytes:0,reason:`marked in ${filename}${node?` on <${node.localName}>`:''}; image bytes are not exported`});
   }
   return safe;
  };
  // Marker geometry is read from the capture, never from the detached parse
  // tree: a node inside an inert template has no layout, so offsetWidth is
  // always zero there, and an inline "50%" is not 50 pixels.
  const rectFor=(node:Element)=>{
   const key=[...node.attributes].find(attribute=>attribute.name==='class')?.value.split(/\s+/).find(name=>/^sp-(?:s-)?\d+$/.test(name));
   const snapshot=key?capture.nodes.find(entry=>entry.key===key||entry.styleKey===key):undefined;
   const rect=snapshot?.rect;
   return rect && rect.width>0 && rect.height>0 ? {width:rect.width,height:rect.height} : null;
  };
  // Declared size is a fallback: the laid-out box is what the snapshot actually
  // showed, while a CSS px declaration still describes the intended size when
  // layout was unavailable. Unsupported units are ignored rather than
  // reinterpreted as pixels.
  const declaredPx=(node:Element,property:'width'|'height'):number=>{
   const attr=Number(node.getAttribute(property));
   if(Number.isFinite(attr) && attr>0)return attr;
   const inline=(node as HTMLElement).style?.[property]?.trim();
   const px=inline?/^(\d+(?:\.\d+)?)px$/i.exec(inline):null;
   const parsed=px?Number(px[1]):NaN;
   return Number.isFinite(parsed) && parsed>0 ? parsed : 0;
  };
  // A box smaller than the browser's own 16 px placeholder is not the image's
  // intended size, so the neutral default is kept instead of copying it.
  const usableRect=(rect:{width:number;height:number}|undefined|null,sized:boolean)=>{
   if(!rect)return null;
   const usable=rect.width>=20 && rect.height>=20;
   return usable || sized ? {width:rect.width,height:rect.height} : null;
  };
  const markerFor=(node:Element)=>{
   const declared={width:declaredPx(node,'width'),height:declaredPx(node,'height')};
   const sized=declared.width>0 && declared.height>0;
   const rect=usableRect(rectFor(node),sized);
   const width=rect?.width || declared.width || 80;
   const height=rect?.height || declared.height || 40;
   return markerSvg(Math.round(width),Math.round(height));
  };
  // Any url() image reference in CSS text is marked too, so a stylesheet cannot
  // carry an image reference the offline file never resolved.
  const markCssImages=(text:string,base:string,node?:Element|null):string=>text.replace(CSS_URL,(match:string,_quote:string,raw:string)=>{
   if(raw.startsWith('#') || /^data:/i.test(raw))return match;
   const safe=safeAssetUrl(raw,base);if(!safe)return 'none';
   mark(safe,node ?? null);
   return `url("${markerSvg(80,40)}")`;
  });
  for(const node of all){
   if(['script','iframe','object','embed','link','meta','base'].includes(node.localName)){node.remove();continue;}
   const isImage=node.localName==='img'||node.localName==='image';
   for(const attr of [...node.attributes]){
    const name=attr.name.toLowerCase();
    if(/^on/.test(name)||['srcdoc','autofocus','autoplay','action','formaction','ping'].includes(name)){node.removeAttribute(attr.name);continue;}
    // Inline style keeps its text, except for url() images which become markers.
    if(name==='style'){node.setAttribute('style',markCssImages(attr.value,capture.meta.url,node));continue;}
    if(name==='srcset'){
     // A srcset wins over src in the browser, so keeping the original candidates
     // would make the offline page request the live origin instead of showing the
     // marker. Record each declared candidate as a location and drop the
     // attribute; structure.json keeps the full candidate list.
     for(const {url} of parseSrcset(attr.value))mark(url,node);
     node.removeAttribute(attr.name);
     continue;
    }
    if(['src','href','xlink:href','poster','background'].includes(name)){
     if(isImage || name==='poster' || name==='background'){
      mark(attr.value,node);
      node.setAttribute(attr.name,markerFor(node));
     }else node.removeAttribute(attr.name);
    }
   }
   if(node.localName==='style')node.textContent=embeddedCss(markCssImages(node.textContent||'',capture.meta.url,node));
  }
  let body=template.innerHTML;
  body=isBody?body.replace(/^<div/i,'<body').replace(/<\/div>$/i,'</body>'):`<body>${body}</body>`;
  const styles=embeddedCss(markCssImages(capture.css,capture.meta.url));
  const head=`<!doctype html>\n<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><base href="${escapeHtml(capture.meta.url)}"><meta name="generator" content="SourcePin ${TOOL_VERSION}"><meta name="rights" content="${RIGHTS_NOTICE}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(capture.meta.title)}</title><style>${embeddedCss(styles)}</style></head>`;
  const tail='</html>';
  files[filename]=check(`${head}${body}${tail}`,limits.maxHtmlBytes,'HTML',[['head and CSS',byteLength(head)],['body markup',byteLength(body)]]);
  prepared.push({...capture,degradations:[...capture.degradations,`Offline file: ${filename}; scripts, frames, navigation and external font/media dependencies disabled. Images are marked in place by a same-size placeholder taken from the snapshot's own dimensions; no image bytes are downloaded or embedded. CSS is sampled, not a full stylesheet archive.`,`Images marked, not exported: ${marked.size} reference(s) recorded in assets.json with their URL; the page shows a placeholder at each position.`,`Export limits: ZIP ${limits.maxZipBytes}, HTML ${limits.maxHtmlBytes}, Markdown ${limits.maxReportBytes} bytes; images are not fetched, so the asset count, size and timeout limits do not apply.`]});
 }
 files['structure.json']=JSON.stringify(prepared.map(({id,meta,target,nodes,degradations})=>({id,meta,target,nodes,degradations})),null,2);
 files['assets.json']=JSON.stringify({toolVersion:TOOL_VERSION,rights:RIGHTS_NOTICE,limits,mode:'marked-not-fetched',assets},null,2);
 files['report.md']=check(renderMarkdown(prepared,{...options,packageFiles:captures.map((_,i)=>i===0?'page.html':`page-${i+1}.html`)}),limits.maxReportBytes,'Markdown');
 options.signal?.throwIfAborted();return createZip(files,limits.maxZipBytes);
}
