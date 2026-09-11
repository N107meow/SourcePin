import type { InspectorUI, Rect, Settings, UIActions, UIState } from '../types';
import { RIGHTS_NOTICE } from '../core/provenance';
import { INSPECTOR_CSS } from './styles';

const q = <T extends Element>(root: ShadowRoot, selector: string): T => root.querySelector(selector) as T;

export function createUI(actions: UIActions, initial: UIState, assetUrl: string): InspectorUI {
  const host = document.createElement('sourcepin-inspector');
  host.dataset.sourcepinRoot = '';
  host.setAttribute('aria-label', 'SourcePin inspector');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${INSPECTOR_CSS}</style>
    <div class="overlay-layer"><div class="highlight" hidden><span class="highlight-label"></span></div><div class="selections"></div></div>
    <div class="stage">
      <section class="panel" data-panel="review" role="dialog" aria-label="导出前确认" hidden>
        <div class="panel-head"><span class="review-title">导出前确认</span><button class="panel-close" data-action="export-cancel" aria-label="取消导出"></button></div>
        <p class="review-counts"></p><p class="review-privacy"></p><p class="review-flow"></p><p class="review-images"></p><p class="review-rights"></p>
        <div class="panel-actions"><button class="panel-action" data-action="export-confirm">继续导出</button><button class="panel-action" data-action="export-cancel">取消</button></div>
      </section>
      <section class="panel" data-panel="settings" aria-label="设置" hidden>
        <div class="panel-head"><span data-text="settings">设置</span><button class="panel-close" data-action="panel-close" aria-label="关闭设置"></button></div>
        <label class="field"><span data-text="language">输出语言</span><select name="language"><option value="zh">中文</option><option value="en">English</option></select></label>
        <label class="field"><span data-text="maxNodes">最大节点数</span><input name="maxNodes" type="number" min="20" max="1000" step="10"></label>
        <label class="field"><span data-text="maxDepth">最大深度</span><input name="maxDepth" type="number" min="1" max="12"></label>
        <label class="field"><span data-text="includeHidden">包含隐藏内容</span><input name="includeHidden" type="checkbox"></label>
        <div class="panel-actions"><button class="panel-action" data-action="record"></button><button class="panel-action" data-action="repick">重新选择元素</button></div>
      </section>
      <section class="panel" data-panel="capture" aria-label="画面采集" hidden>
        <div class="panel-head"><span data-text="capture">画面采集</span><button class="panel-close" data-action="panel-close" aria-label="关闭画面采集"></button></div>
        <div class="panel-actions"><button class="panel-action" data-action="component-shot">截取组件</button><button class="panel-action" data-action="viewport-shot">截取当前视口</button><button class="panel-action" data-action="whole-page">捕获整页 DOM</button><button class="panel-action" data-action="add-viewport">追加当前视口</button></div>
      </section>
      <section class="panel" data-panel="preview" aria-label="Markdown 预览" hidden>
        <div class="panel-head"><span data-text="preview">预览</span><button class="panel-close" data-action="panel-close" aria-label="关闭预览"></button></div><pre class="preview"></pre>
      </section>
      <section class="panel" data-panel="onboarding" aria-label="欢迎使用 SourcePin" hidden>
        <div class="panel-head"><span>选中组件，交给 AI</span></div>
        <p>默认使用 Lite 模式、中文输出并手动开始状态录制。点击网页元素后，按 Cmd/Ctrl+C 复制提示词。</p>
        <button class="panel-action" data-action="onboarding-done">开始选择</button>
      </section>
      <div class="robot" data-mode="lite">
        <img class="asset asset-lite" width="188" height="264" alt="SourcePin 机器人" draggable="false">
        <img class="asset asset-pro" width="188" height="264" alt="" draggable="false">
        <button class="drag-handle" aria-label="拖动 SourcePin"></button>
        <button class="screen" type="button" data-action="preview-panel" aria-label="预览捕获内容" title="单击或按 Enter 预览"><span class="screen-count"></span><span class="screen-status"></span><span class="screen-match"></span><span class="screen-summary"></span></button>
        <button class="hotspot copy" data-action="copy" aria-label="复制 Markdown"></button>
        <button class="hotspot settings-button" data-action="settings-panel" aria-label="打开设置"></button>
        <button class="hotspot capture" data-action="capture-panel" aria-label="打开画面采集"></button>
        <button class="hotspot download" data-action="download" aria-label="下载 Markdown"></button>
        <button class="hotspot gear" data-action="mode-picker" aria-label="选择 Lite 或 Pro 模式" aria-expanded="false" aria-controls="sourcepin-mode-picker"></button>
        <button class="inspector-close" data-action="close" aria-label="关闭 SourcePin">×</button>
        <div class="mode-picker" id="sourcepin-mode-picker" hidden><button class="mode-switch" data-action="mode" role="switch" aria-label="切换 Lite 或 Pro 模式"></button><span class="mode-label"></span></div>
      </div><div class="toast" role="status" aria-live="polite"></div>
    </div>`;
  document.documentElement.append(host);

  const robot = q<HTMLElement>(root, '.robot');
  const stage = q<HTMLElement>(root, '.stage');
  const image = q<HTMLImageElement>(root, '.asset-lite');
  const proImage = q<HTMLImageElement>(root, '.asset-pro');
  const toastNode = q<HTMLElement>(root, '.toast');
  let state = initial;
  let toastTimer: number | undefined;
  let hidden = false;
  let onboardingShown = false;
  image.src = assetUrl;
  proImage.src = assetUrl;
  // The trusted bundled SVG stays vector-based so each visible control can move.
  const installArtwork = (svg: string) => {
    const install = (source: string, target: HTMLImageElement, className: string) => {
      if (!host.isConnected) return;
      const vector = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
      if (vector.localName !== 'svg') return;
      vector.removeAttribute('style');
      vector.setAttribute('class', className);
      vector.setAttribute('aria-hidden', 'true');
      // Separate URL-addressed filters: duplicate IDs across inline SVGs can
      // make Chromium reuse the hidden theme's filter surface on a mode change.
      const shadow = vector.querySelector('filter');
      if (shadow) {
        const shadowId = `sourcepin-shadow-${className.endsWith('pro') ? 'pro' : 'lite'}`;
        shadow.id = shadowId;
        vector.querySelectorAll('[filter]').forEach(node => node.setAttribute('filter', `url(#${shadowId})`));
      }
      target.replaceWith(document.importNode(vector, true));
    };
    install(svg, image, 'asset asset-lite');
    install(svg.replaceAll('#59AC9D', '#FF003F').replaceAll('#3F8B7E', '#E60038').replaceAll('#D4EDE3', '#FFD1D9'), proImage, 'asset asset-pro');
  };
  // Shipping adapters embed the SVG as a data URL. Decode it locally: fetch()
  // is subject to the host page's connect-src CSP even for embedded data URLs.
  if (assetUrl.startsWith('data:image/svg+xml')) {
    const comma = assetUrl.indexOf(',');
    const metadata = assetUrl.slice(0, comma);
    const payload = assetUrl.slice(comma + 1);
    const svg = /;base64$/i.test(metadata)
      ? new TextDecoder().decode(Uint8Array.from(atob(payload), character => character.charCodeAt(0)))
      : decodeURIComponent(payload);
    installArtwork(svg);
  } else {
    fetch(assetUrl).then(response => response.text()).then(installArtwork).catch(() => {});
  }

  const iconIds: Record<string,string> = {copy:'Vector_9', 'settings-panel':'Vector_12', 'capture-panel':'Vector_13', download:'Vector_8', 'mode-picker':'Group'};
  const animateButton = (button: HTMLElement, pressed: boolean) => {
    const id = iconIds[button.dataset.action || ''];
    const targets: Element[] = id ? [...root.querySelectorAll(`.asset [id="${id}"]`)] : [button];
    for (const target of targets) {
      for (const animation of target.getAnimations()) animation.cancel();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) continue;
      if (pressed) target.animate([{transform:'none'}, {transform:'translateY(1.5px) scale(.88)'}],{duration:90,fill:'forwards',easing:'ease-out'});
      else target.animate([{transform:'translateY(1.5px) scale(.88)'},{transform:'translateY(-3px) scale(1.06)',offset:.45},{transform:'none'}],{duration:280,easing:'cubic-bezier(.22,.7,.3,1)'});
    }
  };
  root.addEventListener('pointerdown', event => {
    const button=(event.target as Element).closest<HTMLElement>('button[data-action]');
    if (button) animateButton(button,true);
  });
  const releaseButtons = () => {
    root.querySelectorAll<HTMLElement>('button[data-action]').forEach(button => {
      const id=iconIds[button.dataset.action || ''];
      const target=id ? root.querySelector(`.asset [id="${id}"]`) : button;
      if(target?.getAnimations().some(animation=>animation.effect?.getTiming().fill==='forwards'))animateButton(button,false);
    });
  };
  root.addEventListener('pointerup',releaseButtons);
  root.addEventListener('pointercancel',releaseButtons);
  root.addEventListener('pointerleave',releaseButtons);


  const panels = () => Array.from(root.querySelectorAll<HTMLElement>('.panel'));
  const placePanels = () => {
    const hostRect = host.getBoundingClientRect();
    panels().filter(panel => !panel.hidden).forEach(panel => {
      if (panel.dataset.panel === 'preview') {
        // Reserve room above the console. Short windows keep both surfaces
        // visible by reducing only the scrollable preview's height.
        const minimumTop = Math.min(264 + 8 + 8 - 16, Math.max(0, innerHeight - stage.offsetHeight));
        if (hostRect.top < minimumTop) Object.assign(host.style, {top:`${minimumTop}px`,bottom:'auto'});
        const body = robot.getBoundingClientRect();
        const height = Math.max(0, Math.min(264, body.top - 16));
        Object.assign(panel.style, {width:'188px',height:`${height}px`,left:`${Math.max(8, Math.min(innerWidth - 196, body.left))}px`,top:`${body.top - height - 8}px`,right:'auto',bottom:'auto'});
        return;
      }
      const width = Math.min(340, innerWidth - 16);
      panel.style.width = `${width}px`;
      const height = panel.getBoundingClientRect().height;
      const beside = hostRect.left >= width + 8;
      const left = beside ? hostRect.left - width - 8 : Math.max(8, Math.min(innerWidth - width - 8, hostRect.left));
      const top = Math.max(8, Math.min(innerHeight - height - 8, hostRect.bottom - height));
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    });
  };
  let finishReview: ((accepted:boolean)=>void) | undefined;
  const settleReview=(accepted=false)=>{const resolve=finishReview;finishReview=undefined;q<HTMLElement>(root,'[data-panel="review"]').hidden=true;resolve?.(accepted);};
  const closePanel = (): boolean => {
    const open = panels().find(panel => !panel.hidden);
    if (!open) return false;
    if(open.dataset.panel==='review')settleReview();
    open.hidden = true;
    return true;
  };
  const openPanel = (name: string) => {
    if(finishReview)settleReview();
    const target = q<HTMLElement>(root, `[data-panel="${name}"]`);
    const wasOpen = !target.hidden;
    panels().forEach(panel => { panel.hidden = true; });
    target.hidden = wasOpen;
    if (!target.hidden) placePanels();
  };
  const changedSettings = () => {
    const settings: Settings = {
      ...state.settings,
      includeHidden: q<HTMLInputElement>(root, '[name="includeHidden"]').checked,
      language: q<HTMLSelectElement>(root, '[name="language"]').value as Settings['language'],
      maxNodes: Number(q<HTMLInputElement>(root, '[name="maxNodes"]').value),
      maxDepth: Number(q<HTMLInputElement>(root, '[name="maxDepth"]').value),
    };
    update({ ...state, settings });
    actions.settings(settings);
  };

  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    animateButton(button,false);
    if (action === 'export-confirm') settleReview(true);
    else if (action === 'export-cancel') settleReview();
    else if (action === 'copy') actions.copy();
    else if (action === 'download') actions.download();
    else if (action === 'repick') actions.repick();
    else if (action === 'close') actions.close();
    else if (action === 'mode-picker') {
      const picker=q<HTMLElement>(root, '.mode-picker');
      picker.hidden=!picker.hidden;
      button.setAttribute('aria-expanded',String(!picker.hidden));
      if(!picker.hidden)q<HTMLElement>(root, '.mode-switch').focus();
    }
    else if (action === 'mode') { actions.settings({ ...state.settings, mode: state.mode === 'lite' ? 'pro' : 'lite' }); }
    else if (action === 'settings-panel') openPanel('settings');
    else if (action === 'capture-panel') openPanel('capture');
    else if (action === 'preview-panel') openPanel('preview');
    else if (action === 'record') actions.record();
    else if (action === 'component-shot') actions.screenshot(true);
    else if (action === 'viewport-shot') actions.screenshot(false);
    else if (action === 'whole-page') actions.wholePage();
    else if (action === 'add-viewport') actions.addViewport();
    else if (action === 'onboarding-done') {
      const settings = { ...state.settings, onboardingDone: true };
      q<HTMLElement>(root, '[data-panel="onboarding"]').hidden = true;
      update({ ...state, settings });
      actions.settings(settings);
    }
    else if (action === 'panel-close') closePanel();
  });
  root.addEventListener('change', changedSettings);
  q(root, '.screen').addEventListener('dblclick', event => { event.preventDefault(); openPanel('preview'); });

  let drag: { x: number; y: number; left: number; top: number } | null = null;
  const dragHandle = q<HTMLElement>(root, '.drag-handle');
  dragHandle.addEventListener('pointerdown', event => {
    const rect = host.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener('pointermove', event => {
    if (!drag) return;
    const left = Math.max(0, Math.min(innerWidth - stage.offsetWidth, drag.left + event.clientX - drag.x));
    const top = Math.max(0, Math.min(innerHeight - stage.offsetHeight, drag.top + event.clientY - drag.y));
    Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    placePanels();
  });
  const endDrag = () => { drag = null; };
  dragHandle.addEventListener('pointerup', endDrag);
  dragHandle.addEventListener('pointercancel', endDrag);

  const constrain = () => {
    const rect = host.getBoundingClientRect();
    if (rect.right > innerWidth || rect.bottom > innerHeight || rect.left < 0 || rect.top < 0) {
      const left = Math.max(0, Math.min(innerWidth - rect.width, rect.left));
      const top = Math.max(0, Math.min(innerHeight - rect.height, rect.top));
      Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    }
    placePanels();
  };
  addEventListener('resize', constrain);

  const update = (next: UIState) => {
    state = next;
    const en = next.settings.language === 'en';
    robot.dataset.mode = next.mode;
    robot.dataset.copied = String(next.copied);
    robot.classList.toggle('busy', next.busy);
    const showText = next.count > 0 && next.summary.length > 0 && next.summary.length <= 80;
    q<HTMLElement>(root, '.screen').dataset.content = String(showText);
    q<HTMLElement>(root, '.screen-status').textContent = showText ? next.status : '';
    q<HTMLElement>(root, '.screen-match').textContent = showText ? (next.matched ? (en ? 'Exact match' : '定位准确') : (en ? 'Check locator' : '定位待确认')) : '';
    q<HTMLElement>(root, '.screen-summary').textContent = showText ? next.summary : '';
    q<HTMLElement>(root, '.screen-count').textContent = next.count ? String(next.count) : '';
    q<HTMLElement>(root, '.copy').dataset.copied = String(next.copied);
    q<HTMLElement>(root, '.copy').setAttribute('aria-label', next.copied ? '已复制' : '复制 Markdown');
    const labels: Record<string, string> = en ? {
      includeHidden: 'Include hidden content', settings: 'Settings', language: 'Output language', maxNodes: 'Maximum nodes', maxDepth: 'Maximum depth', capture: 'Capture', preview: 'Preview',
    } : { includeHidden: '包含隐藏内容', settings: '设置', language: '输出语言', maxNodes: '最大节点数', maxDepth: '最大深度', capture: '画面采集', preview: '预览' };
    root.querySelectorAll<HTMLElement>('[data-text]').forEach(node => { node.textContent = labels[node.dataset.text || ''] || ''; });
    const aria: Record<string, string> = en ? {
      '.screen': 'Preview capture', '.settings-button': 'Open settings', '.capture': 'Open capture', '.drag-handle': 'Drag SourcePin', '.gear': 'Choose Lite or Pro mode', '.mode-switch': 'Switch Lite or Pro mode',
      '[data-action="component-shot"]': 'Capture component', '[data-action="viewport-shot"]': 'Capture viewport', '[data-action="whole-page"]': 'Capture whole-page DOM',
    } : {
      '.screen': '预览捕获内容', '.settings-button': '打开设置', '.capture': '打开画面采集', '.drag-handle': '拖动 SourcePin', '.gear': '选择 Lite 或 Pro 模式', '.mode-switch': '切换 Lite 或 Pro 模式',
    };
    Object.entries(aria).forEach(([selector, label]) => q<HTMLElement>(root, selector).setAttribute('aria-label', label));
    q<HTMLElement>(root, '[data-panel="settings"] .panel-close').setAttribute('aria-label', en ? 'Close settings' : '关闭设置');
    q<HTMLElement>(root, '[data-panel="capture"] .panel-close').setAttribute('aria-label', en ? 'Close capture' : '关闭画面采集');
    q<HTMLElement>(root, '[data-panel="preview"] .panel-close').setAttribute('aria-label', en ? 'Close preview' : '关闭预览');
    q<HTMLElement>(root, '[data-action="repick"]').textContent = en ? 'Pick another element' : '重新选择元素';
    q<HTMLElement>(root, '[data-action="component-shot"]').textContent = en ? 'Capture component' : '截取组件';
    q<HTMLElement>(root, '[data-action="viewport-shot"]').textContent = en ? 'Capture viewport' : '截取当前视口';
    q<HTMLElement>(root, '[data-action="whole-page"]').textContent = en ? 'Capture whole-page DOM' : '捕获整页 DOM';
    q<HTMLElement>(root, '[data-action="add-viewport"]').textContent = en ? 'Add current viewport' : '追加当前视口';
    q<HTMLElement>(root, '.mode-label').textContent = next.mode.toUpperCase();
    q<HTMLElement>(root, '.mode-switch').setAttribute('aria-checked', String(next.mode === 'pro'));
    q<HTMLSelectElement>(root, '[name="language"]').value = next.settings.language;
    q<HTMLInputElement>(root, '[name="maxNodes"]').value = String(next.settings.maxNodes);
    q<HTMLInputElement>(root, '[name="maxDepth"]').value = String(next.settings.maxDepth);
    q<HTMLInputElement>(root, '[name="includeHidden"]').checked = !!next.settings.includeHidden;
    q<HTMLElement>(root, '[data-action="record"]').textContent = next.recording ? (en ? 'Stop recording' : '停止录制') : (en ? 'Start recording' : '开始录制');
    q<HTMLElement>(root, '[data-action="record"]').classList.toggle('danger', next.recording);
    q<HTMLElement>(root, '.preview').textContent = next.markdown || '尚未捕获内容。';
    host.style.display = hidden ? 'none' : '';
    requestAnimationFrame(constrain);
    if (!onboardingShown && !next.settings.onboardingDone && panels().every(panel => panel.hidden)) {onboardingShown=true;openPanel('onboarding');}
  };

  update(initial);
  const api: InspectorUI = {
    host,
    review(details) {
      openPanel('review');
      const en=state.settings.language==='en';
      q<HTMLElement>(root,'.review-title').textContent=en?'Review before export':details.action+' · 导出前确认';
      q<HTMLElement>(root,'.review-counts').textContent=`${en?'Snapshot DOM matches (unique)':'已有 DOM 快照疑似信息（去重）'}: ${en?'Email':'邮箱'} ${details.counts.email} · ${en?'Phone':'手机号'} ${details.counts.phone} · ${en?'ID':'身份证'} ${details.counts.identity} · ${en?'Address':'地址'} ${details.counts.address}`;
      q<HTMLElement>(root,'.review-privacy').textContent=en?'Local heuristics may miss or misclassify data. DOM may contain personal information; screenshot pixels may contain text. Screenshots are not scanned by OCR.':'本地模式检测可能误报或漏报。DOM 可能含个人信息；截图像素可能含文字，截图未做 OCR 检测。请检查内容后决定。';
      q<HTMLElement>(root,'.review-flow').textContent=en?'Pasting into an LLM sends this content to that third party for processing. SourcePin does not upload captures.':'粘贴给 LLM 即把内容交给第三方处理。SourcePin 本身不会上传采集内容。';
      q<HTMLElement>(root,'.review-images').textContent=details.downloadsImages?(en?'Continue reads referenced images without credentials and embeds them in the ZIP; inaccessible images become placeholders.':'继续后将无凭据读取当前快照引用的图片并内联进 ZIP；无法读取的图片会用占位图替代。'):'';
      q<HTMLElement>(root,'.review-rights').textContent=RIGHTS_NOTICE;
      q<HTMLElement>(root,'[data-action="export-confirm"]').textContent=en?'Continue export':'继续导出';
      q<HTMLElement>(root,'[data-action="export-cancel"].panel-action').textContent=en?'Cancel':'取消';
      placePanels();q<HTMLElement>(root,'[data-action="export-confirm"]').focus();
      return new Promise(resolve=>{finishReview=resolve;});
    },
    update,
    toast(message) {
      toastNode.textContent = message;
      toastNode.dataset.show = 'true';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => { toastNode.dataset.show = 'false'; }, 2200);
    },
    contains(event) { return event.composedPath().includes(host); },
    closePanel,
    destroy() {
      settleReview();
      if (toastTimer) clearTimeout(toastTimer);
      removeEventListener('resize', constrain);
      host.remove();
    },
    highlight(rect: Rect | null, label = '', selected = false, color) {
      const node = q<HTMLElement>(root, '.highlight');
      node.hidden = !rect;
      if (!rect) return;
      Object.assign(node.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderColor: color || '' });
      node.dataset.selected = String(selected);
      q<HTMLElement>(root, '.highlight-label').textContent = label;
    },
    selections(rects: Rect[]) {
      const layer = q<HTMLElement>(root, '.selections');
      while(layer.children.length>rects.length)layer.lastElementChild!.remove();
      rects.forEach((rect,index)=>{
        let node=layer.children[index] as HTMLElement | undefined;
        if(!node){node=document.createElement('div');node.className='selection';layer.append(node);}
        const values={left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`};
        for(const key of ['left','top','width','height'] as const)if(node.style[key]!==values[key])node.style[key]=values[key];
      });
    },
    hide(value: boolean) { hidden = value; host.style.display = value ? 'none' : ''; },
  };
  return api;
}
