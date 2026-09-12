import { build } from 'esbuild';
import { ICON_SIZES, ICON_SVG } from './make-icons.mjs';
import { mkdir, copyFile, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const readDirSafe=async dir=>{try{return await readdir(dir);}catch{return [];}};
await mkdir('dist/extension',{recursive:true});
// One version lives in package.json: it names the artifacts and the manifest, so
// exports never disagree with the build that produced them.
const {version}=JSON.parse(await readFile('package.json','utf8'));
const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));
manifest.version=version;
await writeFile('dist/extension/manifest.json',JSON.stringify(manifest,null,2)+'\n');
await rm('dist/sourcepin-site.zip',{force:true});
await rm('dist/sourcepin-sourcepin-0.1.0-chrome.zip',{force:true}).catch(()=>{});
for(const name of await readDirSafe('dist'))if(/^sourcepin-\d/.test(name))await rm(`dist/${name}`,{force:true});
const options={bundle:true,target:'chrome120',minify:true,legalComments:'none',loader:{'.svg':'dataurl'}};
await Promise.all([
  build({...options,entryPoints:['src/content.ts'],outfile:'dist/extension/content.js',format:'iife'}),
  build({...options,entryPoints:['src/extension/background.ts'],outfile:'dist/extension/background.js',format:'iife'}),
  build({...options,entryPoints:['src/bookmarklet.ts'],outfile:'dist/sourcepin.js',format:'iife'})
]);
await Promise.all(ICON_SIZES.map(size=>copyFile(`public/icon-${size}.png`,`dist/extension/icon-${size}.png`)));
const script=await readFile('dist/sourcepin.js','utf8');
const bookmarklet=`javascript:${encodeURIComponent(script)};void(0)`;
await writeFile('dist/sourcepin.bookmarklet.txt',bookmarklet);
await mkdir('dist/site',{recursive:true});
const preview=(await build({...options,entryPoints:['src/install-preview.ts'],write:false,format:'iife'})).outputFiles[0].text;
const previewBookmarklet=`javascript:${encodeURIComponent(preview)};void(0)`;
const escapedPreview=previewBookmarklet.replaceAll('&','&amp;').replaceAll('\"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const escaped=bookmarklet.replaceAll('&','&amp;').replaceAll('\"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const iconHref=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICON_SVG.replace(/\s+/g,' ').trim())}`;
await writeFile('dist/site/index.html',(await readFile('site/index.html','utf8')).replaceAll('{{BOOKMARKLET}}',escaped).replaceAll('{{PREVIEW_BOOKMARKLET}}',escapedPreview).replaceAll('{{ICON}}',iconHref));
await copyFile('src/assets/robot.svg','dist/site/robot.svg');
await writeFile('dist/site/.nojekyll','');
await writeFile('dist/extension/INSTALL.txt','SourcePin 0.1.0\n\n打开 chrome://extensions，开启开发者模式，点击“加载已解压的扩展程序”，选择本文件所在的 extension 文件夹。\n打开普通网页，点击 SourcePin 扩展图标或 Cmd/Ctrl+Shift+Y。\n点击只选中，Cmd/Ctrl+C 才复制。\n');
try{execFileSync('zip',['-q','-r',`../sourcepin-${version}-chrome.zip`,'.'],{cwd:'dist/extension'});}catch{console.warn('ZIP tool unavailable; unpacked extension is ready in dist/extension');}
execFileSync('zip',['-q','-r','../sourcepin-site.zip','.'],{cwd:'dist/site'});
console.log('Built extension, bookmarklet and GitHub Pages installation site in dist/');
