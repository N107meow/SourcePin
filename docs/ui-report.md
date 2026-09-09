# SourcePin robot UI report

Date: 2026-09-09

## Implemented

- `createUI(actions, initial, assetUrl)` implements the exact `InspectorUI` contract and renders into an open Shadow DOM on a dedicated `sourcepin-inspector` host.
- The supplied 193 × 271 Figma SVG is displayed at 188 × 264. Interactive hit areas use the rendered coordinates of its red copy circle, blue settings circle, triangle capture button, yellow M download button, and gear.
- Lite and Pro state, copied success, busy and recording state, summary/count/match content, Markdown preview, settings, onboarding, capture actions, toast, panels, hide, cleanup, highlight, and multiple selection rectangles update without touching page markup. Empty and long-content screens leave the original robot face visible; a selected short summary covers the face and visibly reports locator accuracy.
- Pointer dragging constrains both the robot and its open panel to the viewport, including all four corners at 900 × 700 and 320 × 420. Highlight layers use viewport coordinates and never receive pointer events.
- The screen is keyboard accessible: Enter opens its preview, as does a pointer double click. Chinese is the initial UI language and every active control switches to English when that option is selected.
- `contains(event)` checks the event's composed path, allowing the controller to exclude events from all nested Shadow DOM controls.

## Callback mapping

| UI control | Callback |
| --- | --- |
| Pink/green circle | `copy()` |
| Yellow M | `download()` |
| Close | `close()` |
| Pick another element | `repick()` |
| Gear or Lite/Pro switch | `settings({...settings, mode})` |
| Language, max nodes, max depth, onboarding | `settings(settings)` |
| Start/stop recording | `record()` |
| Component/current viewport image | `screenshot(true/false)` |
| Whole-page DOM | `wholePage()` |
| Add current viewport | `addViewport()` |

## Verification evidence

- Red phase: the new browser assertions failed against the prior UI because the screen had no keyboard button role and panel bounds were not preserved at viewport corners.
- Browser interaction: `node --test tests/ui.test.mjs` passed 6/6 tests using headless Chromium. The suite exercises controls through visible roles, keyboard input, real pointer dragging, select/input changes and double click; it also verifies Shadow DOM isolation, exact callback arguments, onboarding defaults, match rendering, containment, viewport overlays, toast and destroy lifecycle.
- Full repository type check: `npm run typecheck` passed.
- Visual inspection: `artifacts/06-mobile-ui.png` was captured from Chromium at 320 × 420. The Pro body and selected screen are red/pink while the original yellow M, blue settings button, green capture triangle, black gear, paths, outline and shadow remain intact. The selected text covers the original face and the accuracy label is legible.

## Visual note

The Lite view uses the original Figma vector unchanged. Pro changes only the SVG's three known body/screen fills (`#59AC9D`, `#3F8B7E`, `#D4EDE3`) in memory, preserving every original path and all yellow, blue, green and black control fills.
