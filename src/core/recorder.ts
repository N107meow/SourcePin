import type { RecordedState, Recorder, Recording, Styles, Transition } from '../types.js';
import { sampleStyles } from './capture.js';
import { SENSITIVE_VALUE, safeAttributes, safeStyleValue, unsafeDeclaration } from './privacy.js';

const MAX_STATES = 24;
const MAX_TRANSITIONS = 40;
const SETTLE_LIMIT_MS = 1200;
const MAX_CHANGE_CHARS = 200;

function cloneRecording(states: RecordedState[], transitions: Transition[], degradations: string[]): Recording {
  return { states: states.map((state) => ({ ...state, styles: { ...state.styles }, attributes: { ...state.attributes } })), transitions: transitions.map((transition) => ({ ...transition, styleDelta: { ...transition.styleDelta }, changes: [...transition.changes] })), degradations: [...degradations] };
}

function difference(before: Styles, after: Styles): Styles {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => before[key] !== value));
}

function transitionDuration(element: Element): { delay: number; timedOut: boolean } {
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!computed) return { delay: 24, timedOut: false };
  const parse = (input: string) => input.split(',').map((part) => { const value = Number.parseFloat(part); return Number.isFinite(value) ? value * (part.trim().endsWith('ms') ? 1 : 1000) : 0; });
  const durations = parse(computed.transitionDuration);
  const delays = parse(computed.transitionDelay);
  let longest = 0;
  for (let index = 0; index < Math.max(durations.length, delays.length); index += 1) longest = Math.max(longest, durations[index % durations.length] + delays[index % delays.length]);
  return { delay: Math.min(SETTLE_LIMIT_MS, Math.max(24, Math.ceil(longest) + 24)), timedOut: longest > SETTLE_LIMIT_MS };
}

/** Only sanitized identity reaches a change line, so a credential that lives in
 * an id or class can never be republished by naming the element that moved. A
 * removed id or class collapses into the tag name alone. */
function selectorFor(node: Element, root: Element): string {
  const tag = node.tagName.toLowerCase();
  if (node === root) return tag;
  const safe = safeAttributes(node).attributes;
  const id = safe.id ? `#${safe.id}` : '';
  const classes = (safe.class ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name}`).join('');
  return `${tag}${id || classes}`;
}

function hashes(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{6,}$/i.test(value.trim());
}

function isPointerOver(element: Element): boolean {
  return element.matches(':hover');
}

function isToolUi(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement;
  return Boolean(element?.closest('[data-sourcepin-ui]'));
}

/** Attribute values are filtered with the same rules as attribute snapshots;
 * declarations go through the shared CSS sanitizer after parsing. */
function describeChange(element: Element, name: string, before: string | null, after: string | null): string {
  const audit = safeAttributes(element);
  if (name === 'style') {
    // A filtered declaration disappears from both sides: the reason is stated,
    // the value never is — not even the old one the page has already replaced.
    if (audit.removed.includes('style') || (hashes(before) && hashes(after))) return `${name} content redacted`;
    const declarations = (value: string | null) => {
      const holder = element.ownerDocument.createElement('div');
      holder.setAttribute('style', value ?? '');
      const style = holder.style;
      // Custom properties such as --api-key are not enumerated by the CSSOM, so
      // the declarations are read from the source text as well and filtered by
      // the same rule that governs every other computed value.
      const source = new Map<string, string>();
      for (const declaration of (value ?? '').split(';')) {
        const colon = declaration.indexOf(':');
        if (colon > 0) source.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim());
      }
      for (const property of style) source.set(property.toLowerCase(), style.getPropertyValue(property).trim());
      return [...source].flatMap(([property, raw]) => {
        const safe = safeStyleValue(raw, element.ownerDocument.baseURI);
        return unsafeDeclaration(property, safe) ? [] : [`${property}: ${safe}`];
      }).join('; ');
    };
    const from = before === null ? 'none' : declarations(before);
    const to = after === null ? 'none' : declarations(after);
    return `${name} ${from || 'none'} -> ${to || 'none'}`;
  }
  if (hashes(before) || hashes(after)) return `${name} content redacted`;
  // The old value is sanitized on its own terms instead of being compared with
  // the current snapshot: an ordinary value the page has already replaced is
  // still ordinary, and a credential is redacted on whichever side it appears.
  const sanitized = (name: string, value: string) => {
    const bounded = value.slice(0, MAX_CHANGE_CHARS);
    if (SENSITIVE_VALUE.test(bounded)) return '[redacted]';
    if (name !== 'class') return bounded;
    const classes = bounded.split(/\s+/).filter(Boolean);
    return classes.some((entry) => SENSITIVE_VALUE.test(entry)) ? '[redacted]' : classes.join(' ');
  };
  const side = (value: string | null) => {
    if (value === null) return 'null';
    const safe = sanitized(name, value);
    if (safe === '[redacted]') return safe;
    return JSON.stringify(safe.length > MAX_CHANGE_CHARS ? `${safe.slice(0, MAX_CHANGE_CHARS)}…` : safe);
  };
  return `${name} ${side(before)} -> ${side(after)}`;
}

export function createRecorder(element: Element, onChange?: () => void): Recorder {
  const document = element.ownerDocument;
  const view = document.defaultView;
  const Observer = view?.MutationObserver ?? MutationObserver;
  const ElementClass = view?.Element ?? Element;
  const NodeClass = view?.Node ?? Node;
  const states: RecordedState[] = [];
  const transitions: Transition[] = [];
  const degradations: string[] = [];
  const timers = new Set<number>();
  const sequences = new Map<string, number>();
  let running = true;
  let stateCounter = 0;
  let mutationQueued = false;
  let mutationChanges = new Set<string>();
  let mutationTarget = element.tagName.toLowerCase();
  const activePointers = new Set<number>();
  const label = (condition: string, suffix = 'observed') => `${condition} @ viewport ${view?.innerWidth ?? 0}x${view?.innerHeight ?? 0}; ${suffix}`;
  const degrade = (message: string) => { if (!degradations.includes(message)) degradations.push(message); };

  const addState = (condition: string, changes: string[] = [], target = element.tagName.toLowerCase(), suffix = 'observed'): RecordedState | undefined => {
    if (!running || states.length >= MAX_STATES) { if (states.length >= MAX_STATES) degrade('Recording state limit reached.'); return undefined; }
    if (!element.isConnected && condition !== 'detached') return undefined;
    const displayCondition = label(condition, suffix);
    const state: RecordedState = { id: `state-${++stateCounter}`, name: displayCondition, at: Math.round(view?.performance.now() ?? performance.now()), styles: sampleStyles(element), attributes: safeAttributes(element).attributes, condition: displayCondition };
    const previous = states.at(-1);
    states.push(state);
    if (previous && transitions.length < MAX_TRANSITIONS) transitions.push({ from: previous.id, to: state.id, event: condition === 'mutation' ? 'mutation' : condition, target, styleDelta: difference(previous.styles, state.styles), changes });
    else if (previous) degrade('Recording transition limit reached.');
    onChange?.();
    return state;
  };

  const cancelSequence = (key: string) => sequences.set(key, (sequences.get(key) ?? 0) + 1);
  const sampleSettled = (condition: string, sequenceKey: string) => {
    const sequence = (sequences.get(sequenceKey) ?? 0) + 1;
    sequences.set(sequenceKey, sequence);
    const timing = transitionDuration(element);
    const timer = (view?.setTimeout ?? window.setTimeout)(() => {
      timers.delete(timer);
      if (!running || sequences.get(sequenceKey) !== sequence || !element.isConnected) return;
      if (timing.timedOut) { addState(`${condition}:timeout`, [], element.tagName.toLowerCase(), 'incomplete'); degrade(`Transition sampling timeout after ${SETTLE_LIMIT_MS}ms; final ${condition} state was not observed.`); }
      else addState(`${condition}:settled`);
    }, timing.delay);
    timers.add(timer);
  };
  const observeCondition = (condition: string, sequenceKey = condition) => { addState(condition); sampleSettled(condition, sequenceKey); };
  const relatedOutside = (event: Event) => { const related = (event as MouseEvent | FocusEvent).relatedTarget; return !(related instanceof NodeClass) || !element.contains(related as Node); };
  const elementListeners: Array<[string, EventListener]> = [
    ['pointerover', (event) => { if (relatedOutside(event)) observeCondition('hover', 'hover'); }],
    ['pointerout', (event) => { if (relatedOutside(event)) observeCondition('base', 'hover'); }],
    ['focusin', (event) => { if (relatedOutside(event)) observeCondition('focus', 'focus'); }],
    ['focusout', (event) => { if (relatedOutside(event)) observeCondition('blur', 'focus'); }],
    ['pointerdown', (event) => {
      const pointer = event as PointerEvent;
      if (isToolUi(pointer.target as Node | null) || activePointers.has(pointer.pointerId)) return;
      activePointers.add(pointer.pointerId);
      observeCondition('active', 'active');
    }],
  ];
  const finishPointer = (event: Event, condition: 'released' | 'cancelled') => {
    const pointerId = (event as PointerEvent).pointerId;
    if (!activePointers.delete(pointerId)) return;
    cancelSequence('active');
    addState(condition);
  };
  const documentListeners: Array<[string, EventListener, AddEventListenerOptions]> = [
    ['pointerup', (event) => finishPointer(event, 'released'), { capture: true }],
    ['pointercancel', (event) => finishPointer(event, 'cancelled'), { capture: true }],
  ];
  for (const [type, listener] of elementListeners) element.addEventListener(type, listener);
  for (const [type, listener, options] of documentListeners) document.addEventListener(type, listener, options);

  const observer = new Observer((records) => {
    if (!running) return;
    for (const record of records) {
      if (isToolUi(record.target)) continue;
      const source = record.target instanceof ElementClass ? record.target as Element : record.target.parentElement;
      if (!source) continue;
      const selector = selectorFor(source, element);
      const beforeCount = mutationChanges.size;
      if (record.type === 'attributes') {
        const name = record.attributeName ?? 'attribute';
        if (name !== 'class' && name !== 'style' && !name.startsWith('aria-')) continue;
        mutationChanges.add(`${selector}: ${describeChange(source, name, record.oldValue, source.getAttribute(name))}`);
      } else if (record.type === 'childList') {
        const added = [...record.addedNodes].filter((node) => !isToolUi(node)).length;
        const removed = [...record.removedNodes].filter((node) => !isToolUi(node)).length;
        if (added) mutationChanges.add(`${selector}: ${added} node(s) added`);
        if (removed) mutationChanges.add(`${selector}: ${removed} node(s) removed`);
      } else if (record.type === 'characterData') mutationChanges.add(`${selector}: text changed (content redacted)`);
      if (mutationChanges.size > beforeCount) mutationTarget = selector;
    }
    if (!mutationQueued && mutationChanges.size) {
      mutationQueued = true;
      queueMicrotask(() => { mutationQueued = false; const changes = [...mutationChanges].slice(0, 16); mutationChanges = new Set(); addState('mutation', changes, mutationTarget); });
    }
  });
  observer.observe(element, { attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true, childList: true, subtree: true });
  const connectionObserver = new Observer(() => { if (!running || element.isConnected) return; degrade('Recording target was detached.'); onChange?.(); cleanup(); });
  connectionObserver.observe(document.documentElement, { childList: true, subtree: true });

  const initiallyHovered = isPointerOver(element);
  const initiallyFocused = element === document.activeElement || element.contains(document.activeElement);
  const initiallyActive = element.matches(':active');
  addState(initiallyActive ? 'active' : initiallyFocused ? 'focus' : initiallyHovered ? 'hover' : 'base', [], element.tagName.toLowerCase(), 'observed initial');
  if (!initiallyHovered) degrade('Initial hover state was unobserved.');
  if (!initiallyFocused) degrade('Initial focus state was unobserved.');
  if (!initiallyActive) degrade('Initial active state was unobserved.');

  function cleanup() {
    if (!running) return;
    running = false;
    observer.disconnect();
    connectionObserver.disconnect();
    for (const [type, listener] of elementListeners) element.removeEventListener(type, listener);
    for (const [type, listener, options] of documentListeners) document.removeEventListener(type, listener, options);
    for (const timer of timers) (view?.clearTimeout ?? clearTimeout)(timer);
    timers.clear(); sequences.clear(); activePointers.clear();
  }
  return { stop() { cleanup(); return cloneRecording(states, transitions, degradations); }, snapshot() { return cloneRecording(states, transitions, degradations); }, dispose() { cleanup(); } };
}
