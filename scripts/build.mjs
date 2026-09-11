import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

await mkdir('dist/extension',{recursive:true});
const options={bundle:true,target:'chrome120',minify:true,legalComments:'none',loader:{'.svg':'dataurl'}};
await Promise.all([
  build({...options,entryPoints:['src/content.ts'],outfile:'dist/extension/content.js',format:'iife'}),
  build({...options,entryPoints:['src/extension/background.ts'],outfile:'dist/extension/background.js',format:'iife'}),
  build({...options,entryPoints:['src/bookmarklet.ts'],outfile:'dist/sourcepin.js',format:'iife'})
]);
await copyFile('public/manifest.json','dist/extension/manifest.json');
const script=await readFile('dist/sourcepin.js','utf8');
const bookmarklet=`javascript:${encodeURIComponent(script)};void(0)`;
await writeFile('dist/sourcepin.bookmarklet.txt',bookmarklet);
await mkdir('dist/site',{recursive:true});
const preview=(await build({...options,entryPoints:['src/install-preview.ts'],write:false,format:'iife'})).outputFiles[0].text;
const previewBookmarklet=`javascript:${encodeURIComponent(preview)};void(0)`;
const escapedPreview=previewBookmarklet.replaceAll('&','&amp;').replaceAll('\"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const escaped=bookmarklet.replaceAll('&','&amp;').replaceAll('\"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
await writeFile('dist/site/index.html',(await readFile('site/index.html','utf8')).replaceAll('{{BOOKMARKLET}}',escaped).replaceAll('{{PREVIEW_BOOKMARKLET}}',escapedPreview));
await copyFile('src/assets/robot.svg','dist/site/robot.svg');
await writeFile('dist/site/.nojekyll','');
await writeFile('dist/extension/INSTALL.txt','SourcePin 0.1.0\n\n打开 chrome://extensions，开启开发者模式，点击“加载已解压的扩展程序”，选择本文件所在的 extension 文件夹。\n打开普通网页，点击 SourcePin 扩展图标或 Cmd/Ctrl+Shift+Y。\n点击只选中，Cmd/Ctrl+C 才复制。\n');
try{execFileSync('zip',['-q','-r','../sourcepin-0.1.0-chrome.zip','.'],{cwd:'dist/extension'});}catch{console.warn('ZIP tool unavailable; unpacked extension is ready in dist/extension');}
execFileSync('zip',['-q','-r','../sourcepin-site.zip','.'],{cwd:'dist/site'});
console.log('Built extension, bookmarklet and GitHub Pages installation site in dist/');
