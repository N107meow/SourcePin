import { TOOL_VERSION, RIGHTS_NOTICE } from './provenance';
import type { Capture, Capabilities, Language, Recording } from '../types.js';

export interface MarkdownOptions {
  summary?: boolean;
  packageFiles?: string[];
  maxBytes?: number;
  language?: Language;
  recording?: Recording;
  recordingCaptureId?: string;
  savedFilename?: string;
}

const SECTION_NAMES = [
  'Meta', 'Locators', 'Structure', 'Cleaned HTML', 'Scoped CSS',
  'Pseudo Elements', 'Design Tokens', 'Geometry', 'Assets', 'Animations',
  'A11y', 'Component', 'Interaction States', 'State Machine',
  'Animation Spec', 'Behavior Contract', 'Reference Impl', 'Degradations',
] as const;
const LITE_SECTION_NAMES = ['Meta', 'Target', 'Locators', 'Reach Path', 'Context', 'Geometry', 'Framework', 'Degradations'] as const;

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

function codeFence(value: string, language = ''): string {
  const runs = value.match(/`+/g) ?? [];
  const width = Math.max(3, ...runs.map((run) => run.length + 1));
  const fence = '`'.repeat(width);
  return `${fence}${language}\n${value}\n${fence}`;
}

function json(value: unknown): string {
  return codeFence(JSON.stringify(value, null, 2), 'json');
}

// HTML raw-text parsing happens before CSS parsing, including inside CSS strings.
function embeddedCss(css: string): string {
  return css.replace(/<\/style/gi, match => `\\3C ${match.slice(1)}`);
}

function list(values: string[], empty: string): string {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : `- ${empty}`;
}

function compactString(value: string, limit = 240): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function renderLiteSection(name: typeof LITE_SECTION_NAMES[number], captures: Capture[], language: Language): string {
  const unavailable = language === 'zh' ? '未采集或不可得。' : 'Not captured or unavailable.';
  const values = captures.map((capture) => {
    switch (name) {
      case 'Meta': return { id: capture.id, timestamp: capture.timestamp, mode: capture.mode, ...capture.meta,toolVersion:capture.meta.toolVersion ?? TOOL_VERSION,rights:RIGHTS_NOTICE };
      case 'Target': return capture.target;
      case 'Locators': return capture.locators;
      case 'Reach Path': return capture.meta.reach;
      case 'Context': return { ancestors: capture.target.ancestors, text: capture.target.text, attributes: capture.target.attributes };
      case 'Geometry': return { rect: capture.target.rect, visible: capture.target.visible, ancestorOpacityZero:capture.target.ancestorOpacityZero, inViewport: capture.target.inViewport };
      case 'Framework': return capture.framework ?? unavailable;
      case 'Degradations': return capture.degradations.length ? capture.degradations : [unavailable];
    }
  });
  return `## ${name}\n\n${json(captures.length === 1 ? values[0] : values)}`;
}

// Legacy fixture/import support derives evidence from payload, never from mode.
function capabilitiesFor(capture: Capture): Capabilities {
  if(capture.capabilities)return capture.capabilities;
  const entry=(present: boolean,reason: string)=>({status:present?'present' as const:'absent' as const,reason});
  return {
    markup:entry(!!capture.html,'Markup '+(capture.html?'is in this capture.':'was not collected.')),
    css:entry(!!capture.css,'CSS '+(capture.css?'is in this capture.':'was not collected.')),
    computedStyles:entry(capture.nodes.some(node=>Object.keys(node.styles).length>0),'Computed style evidence in node snapshots.'),
    recording:entry(false,'No recording attached.'),framework:entry(!!capture.framework,'Framework metadata '+(capture.framework?'provided.':'unavailable.')),
    screenshot:entry(false,'No embedded screenshot.'),shadowDom:entry(false,'No shadow serialization evidence.'),iframes:entry(false,'Iframe contents not captured.'),hiddenContent:entry(false,'No hidden-content inclusion evidence.'),
  };
}
function capabilitySection(captures: Capture[], summary=false): string {
  const bodies=captures.map(capture=>{
    const capabilities={...capabilitiesFor(capture)};
    if(summary)for(const key of ['markup','css','computedStyles'] as const)if(capabilities[key].status==='present')capabilities[key]={status:'absent',reason:'Omitted from the 15 KB clipboard summary; download full Markdown for this captured evidence.'};
    return `### Capture ${capture.id}\n\n`+Object.entries(capabilities).map(([name,item])=>`- ${name}: ${item.status} — ${item.reason}`).join('\n');
  });
  return `## Capabilities\n\n${bodies.join('\n\n')}`;
}

function behaviorContract(recording: Recording | undefined, language: Language): string {
  const unknown = language === 'zh'
    ? '业务逻辑、服务端效果以及未触发的 disabled、loading、empty、error 状态均为未知。'
    : 'Business logic, server effects, and untriggered disabled, loading, empty, or error states remain unknown.';
  if (!recording?.transitions.length) return language === 'zh' ? `本轮没有录制到交互迁移。${unknown}` : `No interaction transitions were recorded. ${unknown}`;
  const events = [...new Set(recording.transitions.map((transition) => transition.event.split(':')[0]))];
  const carriers = [...new Set(recording.transitions.map((transition) => transition.target))];
  const aria = [...new Set(recording.transitions.flatMap((transition) => transition.changes.filter((change) => change.includes('aria-'))))].slice(0, 8);
  const observed = json({ observedEvents: events, observedCarriers: carriers, observedAriaChanges: aria });
  return language === 'zh' ? `以下合同仅来自本轮实际观测：\n\n${observed}\n\n${unknown}` : `This contract contains only behavior observed in this recording:\n\n${observed}\n\n${unknown}`;
}

function renderSection(name: typeof SECTION_NAMES[number], captures: Capture[], recording: Recording | undefined, language: Language, packageFiles?: Map<string,string>): string {
  const unavailable = language === 'zh' ? '未采集或不可得。' : 'Not captured or unavailable.';
  const blocks = captures.map((capture, index) => ({ capture, label: captures.length > 1 ? `Capture ${index + 1} (${capture.id})` : '' }));
  const joined = (render: (capture: Capture) => string) => blocks.map(({ capture, label }) => `${label ? `### ${label}\n\n` : ''}${render(capture)}`).join('\n\n');

  let body: string;
  switch (name) {
    case 'Meta':
      body = joined((capture) => json({ id: capture.id, timestamp: capture.timestamp, mode: capture.mode, ...capture.meta,toolVersion:capture.meta.toolVersion ?? TOOL_VERSION,rights:RIGHTS_NOTICE }));
      break;
    case 'Locators': body = joined((capture) => json(capture.locators)); break;
    case 'Structure':
      body = joined((capture) => json({ target: capture.target, nodes: capture.nodes.map(({ key, depth, tag, attributes, text }) => ({ key, depth, tag, attributes, text })) }));
      break;
    case 'Cleaned HTML': body = joined((capture) => codeFence(capture.html || `<!-- ${unavailable} -->`, 'html')); break;
    case 'Scoped CSS': body = joined((capture) => codeFence(capture.css || `/* ${unavailable} */`, 'css')); break;
    case 'Pseudo Elements':
      body = joined((capture) => json(capture.nodes.flatMap((node) => Object.entries(node.pseudo).map(([pseudo, styles]) => ({ node: node.key, pseudo, styles })))));
      break;
    case 'Design Tokens': body = joined((capture) => json(capture.tokens)); break;
    case 'Geometry': body = joined((capture) => json(capture.nodes.map(({ key, rect }) => ({ key, rect })))); break;
    case 'Assets': body = joined((capture) => json(capture.assets)); break;
    case 'Animations': body = joined((capture) => json(capture.animations)); break;
    case 'A11y':
      body = joined((capture) => json(capture.nodes.map((node) => ({
        node: node.key,
        attributes: Object.fromEntries(Object.entries(node.attributes).filter(([key]) => key === 'role' || key === 'tabindex' || key.startsWith('aria-'))),
      }))));
      break;
    case 'Component':
      body = joined((capture) => {
        const source = capture.framework?.source
          ? capture.framework.source
          : (language === 'zh' ? '源码文件与行号在当前渲染页面中不可得。' : 'Source file and line are unavailable on this rendered page.');
        const canvas = capture.target.tag.toLowerCase() === 'canvas'
          ? `\n\n${language === 'zh' ? 'Canvas 3D 场景、材质与模型未探测。' : 'Canvas 3D scene, materials, and models were not inspected.'}`
          : '';
        return `${json(capture.framework ?? { framework: 'unknown', components: [], props: {} })}\n\n${source}${canvas}`;
      });
      break;
    case 'Interaction States': body = recording ? json(recording.states) : unavailable; break;
    case 'State Machine': body = recording ? json(recording.transitions) : unavailable; break;
    case 'Animation Spec':
      body = joined((capture) => json({ capturedAnimations: capture.animations, recordedTransitions: recording?.transitions.filter((transition) => Object.keys(transition.styleDelta).length) ?? [] }));
      break;
    case 'Behavior Contract':
      body = behaviorContract(recording, language);
      break;
    case 'Reference Impl':
      body = joined((capture) => capture.meta.captureKind==='page' ? `打开 ZIP 中的 [${packageFiles?.get(capture.id) ?? 'page.html'}](./${packageFiles?.get(capture.id) ?? 'page.html'})，查看结构和样式的实现参考。仅是静态采集快照，不包含原工程业务逻辑。` : `${language === 'zh' ? '以下是基于已采集 HTML/CSS 的 vanilla 骨架，不代表原工程业务实现。' : 'This vanilla skeleton uses the captured HTML/CSS and does not claim to restore the original application logic.'}\n\n${codeFence(`${capture.html}\n\n<style>\n${embeddedCss(capture.css)}\n</style>`, 'html')}`);
      break;
    case 'Degradations':
      body = list([...captures.flatMap((capture) => capture.degradations), ...(recording?.degradations ?? [])], unavailable);
      break;
  }
  return `## ${name}\n\n${body}`;
}

function fitSummary(header: string, sections: string[], language: Language): string {
  const budget = 15 * 1024;
  const names=sections.map((section,index)=>section.match(/^## (.+)/m)?.[1] ?? `Note ${index+1}`);
  const prefix=language==='zh'?'15 KB 摘要省略的章节：':'Sections omitted from the 15 KB summary: ';
  const allNotice=`\n\n> ${prefix}${names.join(', ')}.`;
  const kept:string[]=[],omitted:string[]=[];
  for(const [index,section] of sections.entries()){
    if(byteLength([header,...kept,section].join('\n\n')+allNotice)<=budget)kept.push(section);
    else omitted.push(names[index]);
  }
  return [header,...kept].join('\n\n')+(omitted.length?`\n\n> ${prefix}${omitted.join(', ')}.`:'');
}

function renderCompactSummary(header: string, captures: Capture[], recording: Recording | undefined, language: Language): string {
  const selected = captures.slice(0, 6);
  const compactAttributes = (attributes: Record<string, string>, count: number) => Object.fromEntries(Object.entries(attributes).slice(0, count).map(([key, value]) => [compactString(key, 80), compactString(value, 160)]));
  const targets = selected.map((capture) => ({ id: compactString(capture.id, 80), tag: compactString(capture.target.tag, 40), text: compactString(capture.target.text), attributes: compactAttributes(capture.target.attributes, 8), rect: capture.target.rect }));
  const locators = selected.map((capture) => ({
    id: compactString(capture.id, 80),
    locators: [...capture.locators].sort((left, right) => Number(right.verified) - Number(left.verified)).slice(0, 3).map((locator) => ({ ...locator, value: compactString(locator.value, 400) })),
  }));
  const structure = selected.map((capture) => ({ id: compactString(capture.id, 80), nodes: capture.nodes.filter((node) => node.depth <= 2).slice(0, 24).map((node) => ({ key: compactString(node.key, 80), depth: node.depth, tag: compactString(node.tag, 40), text: compactString(node.text, 120), attributes: compactAttributes(node.attributes, 5) })) }));
  const sections = [
    `## Targets\n\n${json(targets)}`,
    `## Locators\n\n${json(locators)}`,
    `## Meta\n\n${json(selected.map((capture) => ({ id: compactString(capture.id, 80), timestamp: capture.timestamp, toolVersion:TOOL_VERSION,rights:RIGHTS_NOTICE,url: compactString(capture.meta.url, 500), viewport: capture.meta.viewport, reach: capture.meta.reach.slice(0, 8).map((step) => compactString(step, 200)) })))}`,
    capabilitySection(selected,true),
    `## Structure (depth 0–2)\n\n${json(structure)}`,
    `## Design Tokens\n\n${json(selected.map((capture) => ({ id: capture.id, tokens: capture.tokens })))}`,
    `## Recording Summary\n\n${json(recording ? { states: recording.states.slice(0, 12).map(({ id, name, at, condition }) => ({ id, name, at, condition })), transitions: recording.transitions.slice(0, 16), degradations: recording.degradations } : { states: [], transitions: [], note: language === 'zh' ? '未录制。' : 'Not recorded.' })}`,
    `## Degradations\n\n${list(captures.flatMap((capture) => capture.degradations), language === 'zh' ? '无。' : 'None.')}`,
  ];
  const output = fitSummary(header, sections, language);
  const sourceWasOmitted = captures.some((capture) => !!capture.html || !!capture.css);
  if (!sourceWasOmitted) return output;
  const note = language === 'zh' ? '> 完整 HTML/CSS 章节（Cleaned HTML、Scoped CSS、Reference Impl）因 15 KB 剪贴板预算而省略；Structure 仅保留 depth 0–2。' : '> Complete HTML/CSS sections omitted: Cleaned HTML, Scoped CSS, Reference Impl; Structure retains depth 0–2 only.';
  return fitSummary(`${header}\n\n${note}`, sections, language);
}

export function renderMarkdown(captures: Capture[], options: MarkdownOptions = {}): string {
  const language = options.language ?? 'zh';
  if (!captures.length) return language === 'zh' ? '# SourcePin\n\n没有采集内容。' : '# SourcePin\n\nNo capture is available.';

  const saved = options.savedFilename?.replace(/[\r\n]/g, ' ').trim();
  const status = saved
    ? (language === 'zh' ? `\n\n已保存完整包：${saved}` : `\n\nFull package saved as: ${saved}`)
    : '';
  const header = `# SourcePin${status}\n\n> ${RIGHTS_NOTICE}`;
  const recordingId=options.recordingCaptureId ?? captures[0].id;
  const prepared=captures.map(capture=>{
    const capabilities={...capabilitiesFor(capture)};
    if(options.recording && capture.id===recordingId)capabilities.recording={status:'present',reason:'Observed recording is attached to this capture only.'};
    const degradations=capture.degradations.filter(note=>!(capabilities.recording.status==='present' && note.startsWith('recording: absent')));
    for(const [name,item] of Object.entries(capabilities))if(item.status==='absent' && !degradations.some(note=>note.startsWith(`${name}: absent`)))degradations.push(`${name}: absent — ${item.reason}`);
    return {...capture,capabilities,degradations};
  });
  if(options.summary)return renderCompactSummary(header,prepared,options.recording,language);
  // The original eight Lite sections retain their names and relative order.
  // Additional evidence is appended only for captures that actually contain it.
  const sections=LITE_SECTION_NAMES.map(name=>renderLiteSection(name,prepared,language));
  sections.splice(1,0,capabilitySection(prepared));
  const rich=prepared.filter(capture=>capture.capabilities.markup.status==='present' || capture.capabilities.css.status==='present');
  if(rich.length)for(const name of SECTION_NAMES){
    if((LITE_SECTION_NAMES as readonly string[]).includes(name))continue;
    let eligible=rich;
    if(name==='Cleaned HTML')eligible=rich.filter(capture=>capture.capabilities.markup.status==='present');
    if(name==='Scoped CSS')eligible=rich.filter(capture=>capture.capabilities.css.status==='present');
    if(eligible.length)sections.push(renderSection(name,eligible,options.recording,language,new Map(prepared.map((capture,index)=>[capture.id,options.packageFiles?.[index] ?? (index===0?'page.html':`page-${index+1}.html`)]))));
  }
  const output=[header,...sections].join('\n\n');
  const limit=options.maxBytes ?? 4*1024*1024;
  if(byteLength(output)>limit)throw new Error(`Markdown exceeds ${limit} bytes; reduce capture range or viewports. No sections were silently omitted.`);
  return output;
}
