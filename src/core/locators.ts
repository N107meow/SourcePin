import type { Locator } from '../types';
import { visibleChildren, peerSelector } from './dom';
import { safeAttributes, safeText } from './privacy';

const BUSINESS_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-id', 'data-conv-id', 'name'];
const DYNAMIC = /(?:^|[-_])(?:\d{4,}|[a-f0-9]{8,}|[a-z0-9]{12,})(?:$|[-_])/i;

function identityAttributes(element: Element): Record<string, string> {
  return Object.fromEntries(Object.entries(safeAttributes(element).attributes).filter(([name]) =>
    name === 'id' || name === 'class' || name === 'name' || name.startsWith('data-'),
  ));
}

function cssEscape(value: string): string {
  if (typeof globalThis.CSS !== 'undefined') return CSS.escape(value);
  return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (character, leading) => {
    if (leading) return `\\3${character.at(-1)} `;
    return `\\${character.codePointAt(0)!.toString(16)} `;
  });
}

function attributeSelector(name: string, value: string): string {
  return `[${cssEscape(name)}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function queryRoot(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  return root.nodeType === 11 ? root as ShadowRoot : element.ownerDocument;
}

function verifyCss(element: Element, value: string): Pick<Locator, 'matches' | 'verified'> {
  if (!element.isConnected) return { matches: 0, verified: false };
  try {
    const matches = [...queryRoot(element).querySelectorAll(value)];
    return { matches: matches.length, verified: matches.length === 1 && matches[0] === element };
  } catch {
    return { matches: null, verified: false };
  }
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

function verifyXpath(element: Element, value: string): Pick<Locator, 'matches' | 'verified'> {
  if (!element.isConnected) return { matches: 0, verified: false };
  const root = queryRoot(element);
  try {
    const result = element.ownerDocument.evaluate(value, root, null, 7, null);
    let found = false;
    for (let index = 0; index < result.snapshotLength; index++) found ||= result.snapshotItem(index) === element;
    return { matches: result.snapshotLength, verified: result.snapshotLength === 1 && found };
  } catch {
    return { matches: null, verified: false };
  }
}

function structuralSelector(element: Element, stop?: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== stop) {
    const tag = current.localName;
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const peers = visibleChildren(parent).filter((child) => child.localName === tag);
    const hasExcludedPeer = [...parent.children].filter(child => child.localName === tag).length !== peers.length;
    parts.unshift(hasExcludedPeer ? `:nth-child(${peers.indexOf(current) + 1} of ${peerSelector(parent, tag)})` : peers.length > 1 ? `${tag}:nth-of-type(${peers.indexOf(current) + 1})` : tag);
    current = parent;
  }
  return parts.join(' > ');
}

export function validateLocators(element: Element, locators: Locator[]): Locator[] {
  return locators.map((locator) => {
    if (locator.kind === 'css') return { ...locator, ...verifyCss(element, locator.value) };
    if (locator.kind === 'xpath') return { ...locator, ...verifyXpath(element, locator.value) };
    return { ...locator, matches: null, verified: false, note: locator.note ?? 'Semantic suggestion; requires a Playwright engine to verify.' };
  });
}

export function generateLocators(element: Element): Locator[] {
  const candidates: Locator[] = [];
  const attributes = safeAttributes(element).attributes;
  const identities = identityAttributes(element);
  const businessNames = [...new Set([...BUSINESS_ATTRIBUTES, ...Object.keys(identities).filter((name) => name.startsWith('data-'))])];
  for (const name of businessNames) {
    const value = identities[name];
    if (value) candidates.push({ kind: 'css', value: attributeSelector(name, value), stability: 'stable', matches: null, verified: false });
  }
  if (identities.id) {
    candidates.push({ kind: 'css', value: `#${cssEscape(identities.id)}`, stability: DYNAMIC.test(identities.id) ? 'unstable' : 'stable', matches: null, verified: false });
  }
  const role = element.getAttribute('role') || ({ button: 'button', a: element.hasAttribute('href') ? 'link' : '' } as Record<string, string>)[element.localName];
  const label = attributes['aria-label'] || safeText(element, 80);
  if (role && label) candidates.push({ kind: 'playwright', value: `getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(label)} })`, stability: 'medium', matches: null, verified: false, note: 'Semantic suggestion; requires a Playwright engine to verify.' });

  let anchor: Element | null = element.parentElement;
  let anchorSelector = '';
  while (anchor) {
    const anchorIdentities = identityAttributes(anchor);
    const business = BUSINESS_ATTRIBUTES.find((name) => anchorIdentities[name]);
    if (business) {
      anchorSelector = attributeSelector(business, anchorIdentities[business]);
      if (verifyCss(anchor, anchorSelector).verified) break;
    }
    if (anchorIdentities.id && !DYNAMIC.test(anchorIdentities.id)) {
      anchorSelector = `#${cssEscape(anchorIdentities.id)}`;
      if (verifyCss(anchor, anchorSelector).verified) break;
    }
    anchorSelector = '';
    anchor = anchor.parentElement;
  }
  const structural = structuralSelector(element, anchor ?? undefined);
  candidates.push({ kind: 'css', value: anchorSelector ? `${anchorSelector} > ${structural}` : structuralSelector(element), stability: anchorSelector ? 'medium' : 'unstable', matches: null, verified: false });

  const classNames = (identities.class ?? '').split(/\s+/).filter(Boolean);
  for (const className of classNames) {
    candidates.push({ kind: 'css', value: `${element.localName}.${cssEscape(className)}`, stability: DYNAMIC.test(className) ? 'unstable' : 'medium', matches: null, verified: false });
  }
  for (const name of businessNames) {
    const value = identities[name];
    if (value) {
      candidates.push({ kind: 'xpath', value: `.//*[@${name}=${xpathLiteral(value)}]`, stability: 'stable', matches: null, verified: false });
      break;
    }
  }
  if (!structuralSelector(element).includes(':nth-child(')) candidates.push({ kind: 'xpath', value: `.//${structuralSelector(element).replaceAll(' > ', '/').replace(/:nth-of-type\((\d+)\)/g, '[$1]')}`, stability: 'unstable', matches: null, verified: false });
  return validateLocators(element, candidates).sort((a, b) => Number(b.verified) - Number(a.verified));
}
