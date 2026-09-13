import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The toolbar message after a failed injection used to blame the page for every
// failure, so an ordinary HTTP page that merely lost a race was told it could not
// be injected. These cases pin the honest wording.
test('a failed injection names the real reason instead of blaming the page', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sourcepin-status-'));
  try {
    await build({ entryPoints: ['src/extension/status.ts'], outfile: join(dir,'status.mjs'), bundle:true, platform:'node', format:'esm' });
    const { injectionFailureTitle, failureReason, RESTRICTED_HINT } = await import(pathToFileURL(join(dir,'status.mjs')));

    // Chrome's own wording for a page it refuses to script keeps the friendly hint.
    const blocked = injectionFailureTitle(new Error('Cannot access contents of the page. Extension manifest must request permission to access this host.'));
    assert.ok(blocked.startsWith(RESTRICTED_HINT), blocked);
    assert.match(blocked, /Cannot access contents of the page/);

    // Anything else quotes the actual error rather than inventing a protected page.
    const transient = injectionFailureTitle(new Error('The frame was removed.'));
    assert.equal(transient, '注入失败：The frame was removed.。可再点一次图标重试。');
    assert.doesNotMatch(transient, /不允许注入/);

    // Reasons are single-line and bounded so a tooltip stays readable.
    assert.equal(failureReason(new Error('Error:   broken\n  across lines  ')), 'broken across lines');
    assert.equal(failureReason('plain string'), 'plain string');
    assert.equal(failureReason(undefined), '未知错误');
    assert.equal(failureReason(new Error('x'.repeat(400))).length, 120);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
