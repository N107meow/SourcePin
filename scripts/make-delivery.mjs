import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm, stat, copyFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ICON_SVG } from './make-icons.mjs';

/**
 * Build the self-contained delivery installer.
 *
 * The install page itself is the same document GitHub Pages serves: layout,
 * copy and interactions come from site/index.html, so the two can never drift.
 * Only three things differ for a folder you open straight from disk:
 *
 *   - the bookmarklet embedded in the drag tag is the core of the version being
 *     handed over, not whatever was built last;
 *   - the "try it" entry embeds the same core, so the local file needs no server
 *     for the page to work end to end;
 *   - the artwork is inlined, because a file:// page next to its own folder has
 *     no site root that "./robot.svg" can resolve against.
 *
 * Everything else stays byte-identical to dist/site/index.html.
 */

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const out = `artifacts/sourcepin-${version}`;

// A fresh clone has no dist/, so build it instead of failing on a missing file.
// Building here also guarantees the package carries the core of the sources it
// is built from, rather than whatever happened to be in dist/.
if (process.env.SOURCEPIN_DELIVERY_SKIP_BUILD !== '1') {
  const { spawnSync } = await import('node:child_process');
  const built = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
  if (built.status !== 0) throw new Error(`build failed with status ${built.status}; delivery not produced`);
}
await mkdir(out, { recursive: true });

const bundle = async entry => (await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
  loader: { '.svg': 'dataurl' },
  write: false,
})).outputFiles[0].text;

// The core the tag carries, and the same core behind the try-it link.
const core = await readFile('dist/sourcepin.js', 'utf8');
const bookmarklet = `javascript:${encodeURIComponent(core)};void(0)`;
const preview = `javascript:${encodeURIComponent(await bundle('src/install-preview.ts'))};void(0)`;

const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const robot = await readFile('src/assets/robot.svg', 'utf8');
const robotDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(robot.replace(/\s+/g, ' ').trim())}`;
const iconDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICON_SVG.replace(/\s+/g, ' ').trim())}`;

const page = await readFile('site/index.html', 'utf8');
const rendered = page
  .replaceAll('{{BOOKMARKLET}}', escapeAttribute(bookmarklet))
  .replaceAll('{{PREVIEW_BOOKMARKLET}}', escapeAttribute(preview))
  .replaceAll('{{ICON}}', iconDataUrl)
  .replace('src="./robot.svg"', `src="${escapeAttribute(robotDataUrl)}"`);

if (/\{\{[A-Z_]+\}\}/.test(rendered)) throw new Error(`install page still has placeholders: ${rendered.match(/\{\{[A-Z_]+\}\}/g)}`);
if (/\.\/robot\.svg/.test(rendered)) throw new Error('install page still references robot.svg externally');
await writeFile(`${out}/install.html`, rendered);
const readme = await readFile('docs/DELIVERY-README.md', 'utf8');
if (!readme.includes('{{VERSION}}')) throw new Error('docs/DELIVERY-README.md must use {{VERSION}}');
await writeFile(`${out}/README.md`, readme.replaceAll('{{VERSION}}', version));

// The unpacked extension, the raw bookmarklet and the core travel with it, plus
// checksums so the folder can be verified after copying it anywhere.
await copyFile('dist/sourcepin.bookmarklet.txt', `${out}/sourcepin.bookmarklet.txt`);
await copyFile('dist/sourcepin.js', `${out}/sourcepin.js`);
await copyFile(`dist/sourcepin-${version}-chrome.zip`, `${out}/sourcepin-${version}-chrome.zip`);
await rm(`${out}/extension`, { recursive: true, force: true });
await cp('dist/extension', `${out}/extension`, { recursive: true });

const listed = [
  'install.html', 'README.md', 'sourcepin.js', 'sourcepin.bookmarklet.txt', `sourcepin-${version}-chrome.zip`,
  'extension/manifest.json', 'extension/content.js', 'extension/background.js', 'extension/INSTALL.txt',
  'extension/icon-16.png', 'extension/icon-32.png', 'extension/icon-48.png', 'extension/icon-128.png',
];
const lines = [];
for (const name of listed) {
  const digest = createHash('sha256').update(await readFile(`${out}/${name}`)).digest('hex');
  lines.push(`${digest}  ${name}`);
}
await writeFile(`${out}/SHA256SUMS`, `${lines.join('\n')}\n`);
console.log(`Delivery installer for ${version} → ${pathToFileURL(`${out}/install.html`).pathname}`);
console.log(`install.html ${(await stat(`${out}/install.html`)).size} bytes; checksums written for ${lines.length} files`);
