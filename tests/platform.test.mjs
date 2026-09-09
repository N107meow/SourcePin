import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('settings from storage are constrained before driving capture', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sourcepin-policy-'));
  try {
    await build({ entryPoints: ['src/platform/policy.ts'], outfile: join(dir,'policy.mjs'), bundle:true, platform:'node', format:'esm' });
    const { normalizeSettings, safeFilename, validateDownload } = await import(pathToFileURL(join(dir,'policy.mjs')));
    assert.equal(normalizeSettings({ mode:'invalid', maxNodes:1e9, maxDepth:-1 }).mode,'lite');
    assert.equal(normalizeSettings({ maxNodes:1e9 }).maxNodes,1000);
    assert.equal(normalizeSettings({ maxDepth:-1 }).maxDepth,1);
    assert.equal(normalizeSettings({ maxNodes:NaN }).maxNodes,300);
    assert.equal(normalizeSettings({ language:'en', mode:'pro' }).language,'en');
    assert.equal(safeFilename('../../secret\n.md'),'secret.md');
    assert.equal(validateDownload({ text:'report', filename:'report.md' }),true);
    assert.equal(validateDownload({ text:'report', filename:'report.html' }),false);
    assert.equal(validateDownload({ text:'x'.repeat(5_000_001), filename:'report.md' }),false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
