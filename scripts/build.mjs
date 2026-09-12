import { build } from 'esbuild';
import { ICON_SIZES, ICON_SVG } from './make-icons.mjs';
import { mkdir, copyFile, writeFile, readFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const readDirSafe=async dir=>{try{return await readdir(dir);}catch{return [];}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Every build writes the same dist/, and `npm test` starts more than one at a
// time because two test files each shell out to this script. Two processes
// zipping one directory can capture each other's half-published files and leave
// .tmp files behind, so builds take turns through an atomic mkdir lock instead
// of interleaving. A lock whose owner is gone is stolen immediately.
const LOCK='dist/.build-lock';
await mkdir('dist',{recursive:true});
const ownerAlive=async()=>{
  const pid=Number(await readFile(`${LOCK}/pid`,'utf8').catch(()=>''));
  if(!Number.isInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return true;}catch{return false;}
};
let locked=false;
for(let attempt=0;attempt<240&&!locked;attempt++){
  try{await mkdir(LOCK);locked=true;}
  catch{
    if(await ownerAlive())await sleep(250);
    else await rm(LOCK,{recursive:true,force:true});
  }
}
if(!locked)throw new Error(`Another build has held ${LOCK} for a minute; remove it and build again.`);
await writeFile(`${LOCK}/pid`,String(process.pid));
// Cleanup on the way out, including an uncaught error, so the next build never
// waits on a lock this process forgot to release.
process.on('exit',()=>{try{rmSync(LOCK,{recursive:true,force:true});}catch{ /* already gone */ }});
// Leftovers from a build that was killed outright.
for(const dir of ['dist','dist/site','dist/extension'])
  for(const name of await readDirSafe(dir))
    if(name.includes('.build-')&&name.endsWith('.tmp'))await rm(`${dir}/${name}`,{force:true});
// Everything under dist/ can be read at any moment: the local acceptance server
// serves it straight off disk, and a browser mid-reload reads dist/site/robot.svg
// right after index.html. Writing a file in place truncates it first, so a reader
// can observe a zero-byte or half-written file (a broken image on the install
// page). Write beside the target and rename instead: rename is atomic, so a
// reader sees either the previous complete file or the new complete one.
const tempName=path=>`${path}.build-${process.pid}.tmp`;
const publish=async(path,data)=>{await writeFile(tempName(path),data);await rename(tempName(path),path);};
const publishCopy=async(from,to)=>{await copyFile(from,tempName(to));await rename(tempName(to),to);};
const publishZip=async(name,dir)=>{await rm(`dist/${tempName(name)}`,{force:true});execFileSync('zip',['-q','-r',`../${tempName(name)}`,'.'],{cwd:dir});await rename(`dist/${tempName(name)}`,`dist/${name}`);};
await mkdir('dist/extension',{recursive:true});
// One version lives in package.json: it names the artifacts and the manifest, so
// exports never disagree with the build that produced them.
const {version}=JSON.parse(await readFile('package.json','utf8'));
const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));
manifest.version=version;
await publish('dist/extension/manifest.json',JSON.stringify(manifest,null,2)+'\n');
for(const name of await readDirSafe('dist'))if(/^sourcepin-\d/.test(name))await rm(`dist/${name}`,{force:true});
const options={bundle:true,target:'chrome120',minify:true,legalComments:'none',loader:{'.svg':'dataurl'}};
const [content,background,bookmark]=await Promise.all([
  build({...options,entryPoints:['src/content.ts'],write:false,format:'iife'}),
  build({...options,entryPoints:['src/extension/background.ts'],write:false,format:'iife'}),
  build({...options,entryPoints:['src/bookmarklet.ts'],write:false,format:'iife'})
]);
await Promise.all([
  publish('dist/extension/content.js',content.outputFiles[0].text),
  publish('dist/extension/background.js',background.outputFiles[0].text),
  publish('dist/sourcepin.js',bookmark.outputFiles[0].text)
]);
await Promise.all(ICON_SIZES.map(size=>publishCopy(`public/icon-${size}.png`,`dist/extension/icon-${size}.png`)));
const script=await readFile('dist/sourcepin.js','utf8');
const bookmarklet=`javascript:${encodeURIComponent(script)};void(0)`;
await publish('dist/sourcepin.bookmarklet.txt',bookmarklet);
await mkdir('dist/site',{recursive:true});
const preview=(await build({...options,entryPoints:['src/install-preview.ts'],write:false,format:'iife'})).outputFiles[0].text;
const previewBookmarklet=`javascript:${encodeURIComponent(preview)};void(0)`;
const escapedPreview=previewBookmarklet.replaceAll('&','&amp;').replaceAll('\"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const escaped=bookmarklet.replaceAll('&','&amp;').replaceAll('\"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const iconHref=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICON_SVG.replace(/\s+/g,' ').trim())}`;
await publish('dist/site/index.html',(await readFile('site/index.html','utf8')).replaceAll('{{BOOKMARKLET}}',escaped).replaceAll('{{PREVIEW_BOOKMARKLET}}',escapedPreview).replaceAll('{{ICON}}',iconHref));
await publishCopy('src/assets/robot.svg','dist/site/robot.svg');
await publish('dist/site/.nojekyll','');
await publish('dist/extension/INSTALL.txt',`SourcePin ${version}\n\n打开 chrome://extensions，开启开发者模式，点击“加载已解压的扩展程序”，选择本文件所在的 extension 文件夹。\n打开普通网页，点击 SourcePin 扩展图标或 Cmd/Ctrl+Shift+Y。\n点击只选中，Cmd/Ctrl+C 才复制。\n`);
try{await publishZip(`sourcepin-${version}-chrome.zip`,'dist/extension');}catch{console.warn('ZIP tool unavailable; unpacked extension is ready in dist/extension');}
await publishZip('sourcepin-site.zip','dist/site');
// Checksums are part of the build, not a manual follow-up: a rebuild must never
// leave SHA256SUMS describing the previous artifacts.
const artifacts=[];
for(const name of await readDirSafe('dist'))if(name.startsWith('sourcepin-')&&name.endsWith('.zip'))artifacts.push(name);
artifacts.push('sourcepin.js','sourcepin.bookmarklet.txt');
const lines=[];
for(const name of artifacts.sort()){
  const bytes=await readFile(`dist/${name}`);
  lines.push(`${createHash('sha256').update(bytes).digest('hex')}  dist/${name}`);
}
await publish('dist/SHA256SUMS',lines.join('\n')+'\n');
console.log('Built extension, bookmarklet and GitHub Pages installation site in dist/');
console.log(`Checksums written for ${artifacts.length} artifacts (version ${version})`);
