# Passive recording and Markdown export report

Implemented `createRecorder` and `renderMarkdown` for SourcePin's passive recording and Pro reproduction package.

## Delivered behavior

- Markdown output has the specified 18 Pro sections and serializes captures as inert fenced data.
- Fence length grows past backtick runs in captured HTML/CSS, so captured content cannot close its own block.
- Clipboard summaries remain at or below 15 KB in UTF-8 and omit whole sections instead of truncating content or fences.
- Saved-file wording only appears after `savedFilename` is supplied.
- Missing source locations, unobserved behavior, and unavailable canvas 3D details are stated explicitly.
- Recorder uses real :hover/focus/active evidence for initial state, without guessing the pointer position and includes viewport context; states that were not active at startup are explicitly marked unobserved.
- It passively observes hover, focus, active/release, and meaningful class/style/ARIA, child-list, and text mutations. Mutation details contain bounded old/new values and a source selector while captured text is redacted.
- Pointer release and cancellation are observed on the target document, so releasing a matching pointer gesture outside the target cancels stale active samples. Unrelated releases are ignored. Event and observer constructors come from the target's document realm.
- Delayed transition samples use per-condition sequence numbers and cancellation on stop, replacement, or a newer opposing event. Transitions longer than 1200 ms are reported as incomplete timeouts rather than settled states.
- Elements marked as SourcePin UI are excluded from mutation recording, including UI inserted inside a recorded body/root element.
- Recording is bounded to 24 states and 40 transitions. Snapshots are defensive copies and do not mutate recorder state.
- `stop()` and `dispose()` remove listeners, observers, and timers. Detached targets are reported as a degradation.

## Verification

The focused output and real-browser recording suite passes without skipped browser checks:

```text
node --test tests/output.test.mjs
tests 14
pass 14
fail 0
skipped 0
```

The browser checks used Playwright Chromium and covered real and initial hover, focus, pointer active/release outside the target, computed style deltas, sanitized mutation aggregation, tool-UI exclusion, stale sample cancellation, long-transition timeout reporting, detached targets, and post-stop cleanup.

`npm run typecheck` also passes. The focused tests bundle the recorder and Markdown browser entry points before running assertions.
