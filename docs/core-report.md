# Capture and locator core report

Implemented and reviewed the browser capture core without changing `src/types.ts`, shared build configuration, UI, export, or recorder modules.

## Interfaces

- `src/core/capture.ts`: `captureElement(element, options)` and `sampleStyles(element)`
- `src/core/locators.ts`: `generateLocators(element)` and `validateLocators(element, locators)`
- `src/core/privacy.ts`: `safeAttributes(element)`

## Behavior

- Lite captures only the selected element. Pro traverses descendants with a clamped depth and node budget; node snapshots, sanitized HTML, and scoped CSS all use the same captured element set.
- Mixed direct text remains in DOM order around captured child elements and is limited to 120 characters in total per parent node. Text and markup belonging to omitted, executable, form-control, or SourcePin-owned subtrees do not leak into snapshots or serialized HTML.
- Script, style, noscript, template, object, embed, SVG `foreignObject`, event handlers, inline style, `srcdoc`, `srcset`, form values, and SourcePin UI markers are removed from page captures.
- Document, attribute, computed-style, pseudo-element, CSSOM, animation, and asset URLs reject executable protocols, remove credentials, and redact sensitive query values.
- CSSOM traversal is bounded to 2,000 readable rules. Matched source rules, computed pseudo styles, Web Animations keyframes, and CSS keyframes are retained with sanitized URL values.
- Stable business attributes, including opaque `data-id` and `data-conv-id`, are preferred. Target and ancestor identity candidates pass through the privacy filter; sensitive IDs, names, classes, and data values are omitted rather than emitted as redacted selectors. Hash-like classes and structural indexes are downgraded. Semantic locator labels use filtered text and never include script or input values.
- CSS and XPath candidates are verified in the target's own document or open shadow root. Cross-realm iframe and shadow-root capture avoids global `instanceof` and global DOM constants.
- Truncation degradation messages are emitted only when capturable descendants were actually omitted by the corresponding node or depth budget.

## Test evidence

- RED: the expanded browser suite reproduced unsafe descendant text, SourcePin UI leakage, the synthetic-origin URL fixture error, and cross-realm iframe XPath verification failure.
- GREEN: `node --test tests/core.test.mjs` passes 17/17 Chromium tests. Coverage includes stable and duplicate anchors, sensitive ancestor identities, escaping, detached targets, node/depth/text budgets, mixed text, form-control defaults, URL and executable-content sanitization, SourcePin UI exclusion, open shadow roots, same-origin iframe plus shadow traversal, readable CSSOM, pseudo styles, animations, and cancellation.
- `npm run typecheck` passes.

## Limits

- Playwright semantic locators remain suggestions with `matches: null` and `verified: false`; verification requires an actual Playwright locator engine outside this browser-only module.
- Closed shadow roots, cross-origin parent frames, and inaccessible cross-origin stylesheets cannot be traversed by page JavaScript. Captures report the available path and stylesheet degradation instead.
- CSSOM capture records bounded readable source rules as comments alongside replayable scoped computed CSS; it does not rewrite arbitrary source selectors into scoped selectors.
- Framework metadata remains the platform adapter's responsibility, as defined by the shared `Platform.framework` interface.
