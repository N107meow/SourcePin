import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ICON_SIZES, ICON_SVG } from '../scripts/make-icons.mjs';

// Build explicitly: this suite also checks the distributable extension folder.
test('the square screen icon ships at every declared size', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs']);
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  assert.deepEqual(Object.keys(manifest.icons).sort((a, b) => Number(a) - Number(b)), ['16', '32', '48', '128']);
  assert.deepEqual(manifest.action.default_icon, manifest.icons, 'the toolbar button uses the same square icon');
  for (const size of ICON_SIZES) {
    const declared = manifest.icons[String(size)];
    assert.equal(declared, `icon-${size}.png`);
    for (const root of ['public', 'extension']) {
      const buffer = await readFile(`${root}/${declared}`);
      // Assert the real header: a PNG signature, the square size and an alpha channel.
      assert.equal(buffer.subarray(1, 4).toString(), 'PNG', `${root}/${declared} is a PNG`);
      assert.equal(buffer.readUInt32BE(16), size, `${root}/${declared} width`);
      assert.equal(buffer.readUInt32BE(20), size, `${root}/${declared} height`);
      assert.equal(buffer[25], 6, `${root}/${declared} keeps a transparent surround`);
    }
  }
});

test('the install page carries the square icon as its own favicon', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs']);
  const text = await readFile('dist/site/index.html', 'utf8');
  assert.doesNotMatch(text, /\{\{/, 'no placeholder is left unreplaced');
  const match = text.match(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)">/);
  assert.ok(match, 'the page declares an SVG favicon');
  const svg = decodeURIComponent(match[1].replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  assert.equal(svg, ICON_SVG.replace(/\s+/g, ' ').trim(), 'the favicon is the same square screen icon');
  // The page must stay self-contained for a GitHub Pages subpath.
  assert.doesNotMatch(match[1], /https?:/, 'the favicon needs no network fetch');
});

test('the install tag carries the square mark, not just text', async () => {
  const text = await readFile('dist/site/index.html', 'utf8');
  const tag = text.match(/<a id="bookmarklet"[\s\S]*?<\/a>/);
  assert.ok(tag, 'the draggable install tag exists');
  assert.match(tag[0], /class="tag-icon"/, 'the tag shows the square icon');
  assert.match(tag[0], /viewBox="0 0 64 64"/);
  assert.match(tag[0], /href="javascript:/, 'the tag is still the bookmarklet');
  assert.match(tag[0], /draggable="true"/, 'the tag stays draggable');
});
