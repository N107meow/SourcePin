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
const check=(value:string,limit:number,label:string)=>{if(byteLength(value)>limit)throw new Error(`${label} exceeds ${limit} bytes; reduce capture range or viewports. No files were exported.`);return value;};
const CSS_URL=/url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
const csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; script-src 'none'";

// SVG images are inert, additionally remove any embedded resource or executable surface.
function cleanSvg(text:string): string {
 const doc=new DOMParser().parseFromString(text,'image/svg+xml');
 if(doc.documentElement.localName!=='svg' || doc.querySelector('parsererror'))throw new Error('invalid SVG');
 const allowed=new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feDropShadow'.toLowerCase().split(' '));
 for(const node of [...doc.querySelectorAll('*')]){
  if(!allowed.has(node.localName.toLowerCase())){node.remove();continue;}
  for(const attr of [...node.attributes])if(/^on|href|src|style|base/i.test(attr.name) || /url\(\s*["']?(?!#)/i.test(attr.value))node.removeAttribute(attr.name);
 }
 return new XMLSerializer().serializeToString(doc);
}
function asData(bytes:Uint8Array,type:string):string{let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return `data:${type};base64,${btoa(binary)}`;}
function descendants(root:DocumentFragment):Element[]{const nodes:Element[]=[];for(const node of root.querySelectorAll('*')){nodes.push(node);if(node.localName==='template')nodes.push(...descendants((node as HTMLTemplateElement).content));}return nodes;}

/** Reads only resource URLs referenced by this user-selected snapshot, after confirmation. */
export async function createPagePackage(captures:Capture[],options:Options={}):Promise<Blob>{
 const limits={...EXPORT_LIMITS};
 for(const key of Object.keys(limits) as Array<keyof typeof EXPORT_LIMITS>)if(Number.isFinite(options[key]))limits[key]=Math.max(key==='timeoutMs'?1:0,Math.min(limits[key],Math.floor(options[key]!)));
 options.signal?.throwIfAborted();
 // Reject oversized reports before making any resource requests.
 renderMarkdown(captures,{...options,maxBytes:limits.maxReportBytes});
 const signal=options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(limits.timeoutMs)]) : AbortSignal.timeout(limits.timeoutMs);
 const cache=new Map<string,string>();
 const assets:{url:string;status:string;bytes:number;reason?:string}[]=[];let rawTotal=0;
 const resource=async(raw:string,base:string):Promise<string>=>{
  options.signal?.throwIfAborted();
  if(raw.startsWith('#'))return raw;
  const url=safeAssetUrl(raw,base);if(!url)return PLACEHOLDER;
  if(cache.has(url))return cache.get(url)!;
  cache.set(url,PLACEHOLDER);
  try{
   if(assets.length>=limits.maxAssets)throw new Error(`resource count limit ${limits.maxAssets}`);
   if(rawTotal>=limits.maxAssetTotalBytes)throw new Error(`resource total byte limit ${limits.maxAssetTotalBytes}`);
   if(signal.aborted)throw new Error(`resource time limit ${limits.timeoutMs} ms`);
   // Never request a redacted credential URL or send cookies/referrer/page content.
   if(/(?:\[redacted\]|%5bredacted%5d)/i.test(url))throw new Error('redacted URL not requested');
   const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal,redirect:'error'});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
   if(!['image/png','image/jpeg','image/gif','image/webp','image/avif','image/svg+xml','image/bmp','image/x-icon'].includes(type))throw new Error('unsupported image type');
   const size=Number(response.headers.get('content-length')||0),remaining=Math.min(limits.maxAssetBytes,limits.maxAssetTotalBytes-rawTotal);
   if(size>remaining)throw new Error(`resource byte limit ${remaining}`);
   const reader=response.body?.getReader();if(!reader)throw new Error('unreadable response');
   const parts:Uint8Array[]=[];let length=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;rawTotal+=value.length;if(length>limits.maxAssetBytes || rawTotal>limits.maxAssetTotalBytes)throw new Error('resource byte limit reached');parts.push(value);}}
   finally{await reader.cancel().catch(()=>{});}
   let bytes=new Uint8Array(length);let position=0;for(const part of parts){bytes.set(part,position);position+=part.length;}
   if(type==='image/svg+xml')bytes=new TextEncoder().encode(cleanSvg(new TextDecoder().decode(bytes)));
   const data=asData(bytes,type);cache.set(url,data);assets.push({url,status:'embedded',bytes:length});return data;
  }catch(error){options.signal?.throwIfAborted();assets.push({url,status:'failed',bytes:0,reason:error instanceof Error?error.message:String(error)});return PLACEHOLDER;}
 };
 const css=async(text:string,base:string)=>{
  const matches=[...text.matchAll(CSS_URL)];let output='',last=0;
  for(const match of matches){output+=text.slice(last,match.index)+`url("${await resource(match[2],base)}")`;last=match.index!+match[0].length;}
  return output+text.slice(last);
 };
 const files:Record<string,string>={},prepared:Capture[]=[];
 for(const [index,capture] of captures.entries()){
  options.signal?.throwIfAborted();
  const filename=index===0?'page.html':`page-${index+1}.html`;
  const template=document.createElement('template');
  // Template parsing is inert (including images). Preserve body attributes via a temporary div.
  const isBody=/^<body(?:\s|>)/i.test(capture.html);
  template.innerHTML=isBody?capture.html.replace(/^<body/i,'<div').replace(/<\/body>$/i,'</div>'):capture.html;
  const all=descendants(template.content);
  for(const node of all){
   if(['script','iframe','object','embed','link','meta','base'].includes(node.localName)){node.remove();continue;}
   for(const attr of [...node.attributes]){
    const name=attr.name.toLowerCase();
    if(/^on/.test(name)||['srcdoc','autofocus','autoplay','action','formaction','ping'].includes(name)){node.removeAttribute(attr.name);continue;}
    if(name==='style'){node.setAttribute('style',await css(attr.value,capture.meta.url));continue;}
    if(name==='srcset'){
     const parts=[];for(const candidate of attr.value.split(',')){const [url,...descriptor]=candidate.trim().split(/\s+/);parts.push(`${await resource(url,capture.meta.url)} ${descriptor.join(' ')}`.trim());}node.setAttribute(name,parts.join(', '));continue;
    }
    if(['src','href','xlink:href','poster','background'].includes(name)){
     if((node.localName==='img' && name==='src') || node.localName==='image' || name==='poster' || name==='background')node.setAttribute(attr.name,await resource(attr.value,capture.meta.url));
     else node.removeAttribute(attr.name);
    }
   }
   if(node.localName==='style')node.textContent=embeddedCss(await css(node.textContent||'',capture.meta.url));
  }
  let body=template.innerHTML;
  body=isBody?body.replace(/^<div/i,'<body').replace(/<\/div>$/i,'</body>'):`<body>${body}</body>`;
  const styles=await css(capture.css,capture.meta.url);
  files[filename]=check(`<!doctype html>\n<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><base href="${escapeHtml(capture.meta.url)}"><meta name="generator" content="SourcePin ${TOOL_VERSION}"><meta name="rights" content="${RIGHTS_NOTICE}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(capture.meta.title)}</title><style>${embeddedCss(styles)}</style></head>${body}</html>`,limits.maxHtmlBytes,'HTML');
  prepared.push({...capture,degradations:[...capture.degradations,`Offline file: ${filename}; scripts, frames, navigation and external font/media dependencies disabled; only embedded images can load. CSS is sampled, not a full stylesheet archive.`,...assets.filter(a=>a.status==='failed').map(a=>`Resource failed: ${a.url} — ${a.reason}; placeholder used.`),`Export limits: ZIP ${limits.maxZipBytes}, HTML ${limits.maxHtmlBytes}, Markdown ${limits.maxReportBytes} bytes; images ${limits.maxAssets}, individual ${limits.maxAssetBytes}, total ${limits.maxAssetTotalBytes} bytes, ${limits.timeoutMs} ms.`]});
 }
 files['structure.json']=JSON.stringify(prepared.map(({id,meta,target,nodes,degradations})=>({id,meta,target,nodes,degradations})),null,2);
 files['assets.json']=JSON.stringify({toolVersion:TOOL_VERSION,rights:RIGHTS_NOTICE,limits,rawBytes:rawTotal,assets},null,2);
 files['report.md']=check(renderMarkdown(prepared,{...options,packageFiles:captures.map((_,i)=>i===0?'page.html':`page-${i+1}.html`)}),limits.maxReportBytes,'Markdown');
 options.signal?.throwIfAborted();return createZip(files,limits.maxZipBytes);
}
