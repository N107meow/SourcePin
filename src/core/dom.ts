/** Nodes excluded from capture and structural measurements. Template is inert
 * markup, so its content is handled explicitly by the capture walker. */
export const EXCLUDED = 'script, style, noscript, object, embed, foreignObject, sourcepin-inspector';

export function isToolNode(element: Element): boolean {
  return element.localName === 'sourcepin-inspector' || element.getAttributeNames().some(name => name.startsWith('data-sourcepin-') && name !== 'data-sourcepin-probe');
}
export function excluded(element: Element): boolean {
  return element.matches(EXCLUDED) || isToolNode(element);
}
export function visibleChildren(element: Element | DocumentFragment): Element[] {
  return [...element.children].filter(child => !excluded(child));
}
// :nth-child(... of selector) counts the same filtered peers while remaining
// executable against the live page, where injected siblings are still present.
export function peerSelector(parent: Element, tag: string): string {
  const attrs = [...new Set([...parent.children].flatMap(child => child.getAttributeNames().filter(name => name.startsWith('data-sourcepin-') && name !== 'data-sourcepin-probe')))];
  const excludedSelectors = [EXCLUDED, ...attrs.map(name => `[${CSS.escape(name)}]`)];
  return `${tag}:not(${excludedSelectors.join(',')})`;
}
export function parentElementOrHost(element: Element): Element | null {
  return element.parentElement || ((element.getRootNode() as ShadowRoot).host ?? null);
}
export function hiddenByStyle(element: Element): boolean {
  if (element.localName === 'template') return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return element.hasAttribute('hidden') || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse';
}
