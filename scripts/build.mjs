import { build } from 'esbuild';
import { ICON_SIZES, ICON_SVG } from './make-icons.mjs';
import { mkdir, copyFile, cp, writeFile, readFile, rename, rm, readdir, stat, utimes } from 'node:fs/promises';
import { rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

const readDirSafe=async dir=>{try{return await readdir(dir);}catch{return [];}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const number=(value,fallback)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:fallback;};

// ---------------------------------------------------------------------------
// Cross-process build lock
//
// Every build writes the same outputs, and `npm test` starts more than one at a
// time because two test files each shell out to this script. Two processes zipping
// one directory can capture each other's half-published files and leave .tmp files
// behind, so builds take turns through an atomic mkdir lock instead of interleaving.
//
// Creating the lock and recording who owns it cannot be one atomic step, so the
// two are separate states of the same lock:
//
//   initialized  the directory exists and may not have an owner record yet
//   owned        `owner.json` names the live process that holds the lock
//
// An unreadable or absent owner record is therefore NOT proof that the owner is
// gone. It is only treated as abandoned after INIT_GRACE_MS, which is far longer
// than the gap between mkdir and the owner record. Stealing is a single atomic
// rename of the lock directory aside: exactly one contender can win it, so two
// processes can never both conclude they own the lock. The stolen lock carries
// the old record, so every steal attempt is logged with the owner it displaced.
//
// Releasing the lock always re-reads the owner record first and deletes nothing
// unless this process's own pid and token are still in it. That is what stops a
// late-exiting build from removing the lock of the build that took over from it.
// ---------------------------------------------------------------------------
const LOCK=process.env.SOURCEPIN_BUILD_LOCK_DIR||'dist/.build-lock';
const OWNER=`${LOCK}/owner.json`;
const TOKEN=randomBytes(8).toString('hex');
const LOCK_OWNERSHIP={pid:process.pid,token:TOKEN};
// One minute overall, as before, so a stuck build still fails loudly instead of
// hanging forever. The poll interval only decides how quickly a free lock is
// noticed.
const LOCK_WAIT_MS=number(process.env.SOURCEPIN_BUILD_LOCK_WAIT_MS,60000);
const LOCK_POLL_MS=number(process.env.SOURCEPIN_BUILD_LOCK_POLL_MS,250);
// A lock nobody can prove live is given this long to finish initializing first.
const LOCK_INIT_GRACE_MS=number(process.env.SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS,5000);
// The message keeps its original wording and intent -- remove the lock and build
// again -- while naming the wait it actually applied.
const lockError=()=>new Error(`Another build has held ${LOCK} for ${LOCK_WAIT_MS===60000?'a minute':`${Math.round(LOCK_WAIT_MS/1000)}s`}; remove it and build again.`);
const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch{return false;}};
const readOwner=async dir=>{
  let raw;
  try{raw=await readFile(`${dir}/owner.json`,'utf8');}catch{return null;}
  try{
    const record=JSON.parse(raw);
    if(!record||typeof record!=='object')return null;
    // created is advisory: it explains how long a lock has been there in progress
    // messages and log lines, but liveness always comes from the pid.
    return {pid:Number(record.pid),token:String(record.token??''),created:Number(record.created)};
  }catch{return null;}
};
// Rename is atomic, so of N processes trying to steal one stale lock exactly one
// succeeds and the rest see ENOENT and retry against whatever replaced it.
const steal=async reason=>{
  const aside=`${LOCK}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try{await rename(LOCK,aside);}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
  const taken=await readOwner(aside);
  await rm(aside,{recursive:true,force:true});
  console.warn(`Removed stale build lock ${LOCK} (${reason}; previous owner ${taken&&Number.isInteger(taken.pid)?`pid ${taken.pid}`:'unrecorded'})`);
  return true;
};
// Control hook for tests/build-lock.test.mjs: hold the lock in its initialized
// state before the owner record exists. Unset, this costs one env lookup.
const waitForSync=async()=>{
  const marker=process.env.SOURCEPIN_BUILD_LOCK_SYNC;
  if(!marker||marker==='0')return;
  const deadline=Date.now()+number(process.env.SOURCEPIN_BUILD_LOCK_SYNC_TIMEOUT_MS,30000);
  while(Date.now()<deadline){if(await stat(marker).then(()=>true,()=>false))return;await sleep(20);}
  throw new Error(`SOURCEPIN_BUILD_LOCK_SYNC marker ${marker} never appeared`);
};
// Back off before looking again, never sleeping past the overall deadline.
const pollPause=deadline=>sleep(Math.max(25,Math.min(LOCK_POLL_MS,deadline-Date.now())));
const acquireLock=async()=>{
  // Idempotent: mkdir with recursive is only used for the lock's parent, where
  // "already exists" is the expected and harmless answer.
  await mkdir(dirname(LOCK),{recursive:true});
  const deadline=Date.now()+LOCK_WAIT_MS;
  for(;;){
    if(Date.now()>=deadline)throw lockError();
    try{
      // Non-recursive on purpose: exclusive creation of the lock directory is the
      // atomic primitive, and recursive mkdir succeeds silently on an existing
      // directory, which would hand the lock to every contender at once. The parent
      // is created beforehand instead.
      await mkdir(LOCK);
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      const owner=await readOwner(LOCK);
      if(owner&&alive(owner.pid)){await pollPause(deadline);continue;}
      // No live owner: only a lock that has been sitting in its initialized state
      // long enough may be taken over. A contender that is mid-init is still a
      // contender, and its lock must not be deleted out from under it. An
      // unreadable directory counts as fully stale so a corrupt lock cannot
      // deadlock the build.
      const info=await stat(LOCK).catch(()=>null);
      const age=info?Date.now()-info.mtimeMs:Infinity;
      if(age<LOCK_INIT_GRACE_MS){await pollPause(deadline);continue;}
      await steal(owner?`pid ${owner.pid} is gone`:`no owner record after ${Math.round(age)}ms`);
      continue;
    }
    // The lock exists but is not yet owned. This is the state a concurrent build
    // must respect instead of treating it as abandoned.
    console.log(`Build lock ${LOCK} initialized by pid ${process.pid}`);
    try{
      await waitForSync();
      await publish(OWNER,`${JSON.stringify({v:1,pid:process.pid,token:TOKEN,created:Date.now()})}\n`);
    }catch(error){
      // The directory was created but this process is not a usable owner: give it
      // back before failing, so the next build does not wait out the grace window.
      try{if(await ownsLock())await rm(LOCK,{recursive:true,force:true});}catch{ /* best effort */ }
      throw error;
    }
    console.log(`Build lock ${LOCK} held by pid ${process.pid}`);
    return true;
  }
};
// True when this process's own record is what the lock still holds. Reading the
// currently visible lock admits the case where a steal raced this read, so a
// failed read means "not ours" and never deletes anything.
const ownsLock=async()=>{const owner=await readOwner(LOCK);return owner!==null&&owner.pid===LOCK_OWNERSHIP.pid&&owner.token===LOCK_OWNERSHIP.token;};
const releaseSync=()=>{
  try{
    const owner=JSON.parse(readFileSync(OWNER,'utf8'));
    if(owner.pid!==LOCK_OWNERSHIP.pid||owner.token!==LOCK_OWNERSHIP.token)return;
    rmSync(LOCK,{recursive:true,force:true});
  }catch{ /* unreadable or already gone: never delete a lock we cannot prove is ours */ }
};
let holdingLock=false;
// Everything under dist/ can be read at any moment: the local acceptance server
// serves it straight off disk, and a browser mid-reload reads dist/site/robot.svg
// right after index.html. Writing a file in place truncates it first, so a reader
// can observe a zero-byte or half-written file (a broken image on the install
// page). Write beside the target and rename instead: rename is atomic, so a
// reader sees either the previous complete file or the new complete one.
const tempName=path=>`${path}.build-${process.pid}.tmp`;
const publish=async(path,data)=>{await writeFile(tempName(path),data);await rename(tempName(path),path);};
const publishCopy=async(from,to)=>{await copyFile(from,tempName(to));await rename(tempName(to),to);};
// ZIP stores each entry's mtime and the archive's own mtime, and a rebuild writes
// every artifact now -- so without normalizing the staging copies, two builds of
// identical sources would publish checksums that differ from each other for no
// reason a reader could act on. The live artifacts under dist/ keep the mtimes the
// build gave them; only the archive records the fixed one.
const ZIP_EPOCH=new Date(946684800000);   // 2000-01-01T00:00:00Z
const publishZip=async(name,dir)=>{
  const staged=`dist/${tempName(name)}`;
  const staging=`dist/.build-zip-${process.pid}.tmp`;
  await rm(staging,{recursive:true,force:true});
  await cp(dir,staging,{recursive:true});
  for(const entry of await readDirSafe(staging))await utimes(`${staging}/${entry}`,ZIP_EPOCH,ZIP_EPOCH);
  await utimes(staging,ZIP_EPOCH,ZIP_EPOCH);
  execFileSync('zip',['-q','-r',`../${tempName(name)}`,'.'],{cwd:staging});
  await rm(staging,{recursive:true,force:true});
  await utimes(staged,ZIP_EPOCH,ZIP_EPOCH);
  await rename(staged,`dist/${name}`);
};

// ---------------------------------------------------------------------------
// Lock-only CLI probe
//
// tests/build-lock.test.mjs exercises the protocol above directly through this
// entry point: it runs against a throwaway lock directory (SOURCEPIN_BUILD_LOCK_DIR)
// with a short wait, so the race conditions are tested in milliseconds and in
// parallel instead of by racing full builds. It touches only the lock, never any
// artifact. Everything else is a normal `node scripts/build.mjs`.
// ---------------------------------------------------------------------------
if(process.env.SOURCEPIN_BUILD_LOCK_PROBE){
  const outcome={pid:process.pid,token:TOKEN,lockDir:LOCK,acquired:false};
  try{
    outcome.acquired=await acquireLock();
    holdingLock=outcome.acquired;
    outcome.ownerWritten=await ownsLock();
  }catch(error){
    outcome.error=String(error&&error.message||error);
  }finally{
    if(holdingLock){
      const hold=number(process.env.SOURCEPIN_BUILD_LOCK_PROBE_HOLD_MS,0);
      if(hold>0)await sleep(hold);
      if(await ownsLock()){await rm(LOCK,{recursive:true,force:true});outcome.released=true;}
    }
  }
  console.log(`PROBE ${JSON.stringify(outcome)}`);
  process.exit(outcome.acquired?0:1);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
await mkdir('dist',{recursive:true});
await acquireLock();
holdingLock=true;
// Cleanup on the way out, including an uncaught error, so the next build never
// waits on a lock this process forgot to release. The release re-checks ownership,
// so a build that already lost the lock to a takeover leaves the new owner alone.
process.on('exit',releaseSync);
// Control hook for tests/build-lock.test.mjs: hold the lock while the build does its
// work, so a test can freeze this process at a known point and inspect what another
// build does about its lock. Unset, this costs one env lookup.
const hold=number(process.env.SOURCEPIN_BUILD_SLOW_MS,0);
if(hold>0)await sleep(hold);
// Leftovers from a build that was killed outright.
for(const dir of ['dist','dist/site','extension'])
  for(const name of await readDirSafe(dir))
    if(name.includes('.build-')&&name.endsWith('.tmp'))await rm(`${dir}/${name}`,{force:true});
// The unpacked extension is published to the repository root, not to dist/: a clone
// must load in chrome://extensions without a build step, so these nine files are the
// one built artifact that is tracked. dist/ keeps the site, the ZIPs and the checksums.
await mkdir('extension',{recursive:true});
// A checkout that predates the move still carries the old copy; the ZIP and the
// delivery package are built from extension/, so the stale one would only mislead.
await rm('dist/extension',{recursive:true,force:true});
// One version lives in package.json: it names the artifacts and the manifest, so
// exports never disagree with the build that produced them.
const {version}=JSON.parse(await readFile('package.json','utf8'));
const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));
manifest.version=version;
await publish('extension/manifest.json',JSON.stringify(manifest,null,2)+'\n');
for(const name of await readDirSafe('dist'))if(/^sourcepin-\d/.test(name))await rm(`dist/${name}`,{force:true});
const options={bundle:true,target:'chrome120',minify:true,legalComments:'none',loader:{'.svg':'dataurl'}};
const [content,background,bookmark]=await Promise.all([
  build({...options,entryPoints:['src/content.ts'],write:false,format:'iife'}),
  build({...options,entryPoints:['src/extension/background.ts'],write:false,format:'iife'}),
  build({...options,entryPoints:['src/bookmarklet.ts'],write:false,format:'iife'})
]);
await Promise.all([
  publish('extension/content.js',content.outputFiles[0].text),
  publish('extension/background.js',background.outputFiles[0].text),
  publish('dist/sourcepin.js',bookmark.outputFiles[0].text)
]);
await Promise.all(ICON_SIZES.map(size=>publishCopy(`public/icon-${size}.png`,`extension/icon-${size}.png`)));
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
await publish('extension/INSTALL.txt',`SourcePin ${version}\n\n打开 chrome://extensions，开启开发者模式，点击“加载已解压的扩展程序”，选择本文件所在的 extension 文件夹。\n打开普通网页，点击 SourcePin 扩展图标或 Cmd/Ctrl+Shift+Y。\n点击只选中，Cmd/Ctrl+C 才复制。\n`);
try{await publishZip(`sourcepin-${version}-chrome.zip`,'extension');}catch{console.warn('ZIP tool unavailable; unpacked extension is ready in extension/');}
// Control hook for tests/build-lock.test.mjs: make a build fail on purpose while it
// holds the lock, after the extension ZIP is already on disk, so the failure path can
// be asserted to release the lock and leave no .tmp files behind. Unset, this costs
// one env lookup.
if(process.env.SOURCEPIN_BUILD_FAIL==='after-extension-zip')throw new Error('SOURCEPIN_BUILD_FAIL=after-extension-zip (test hook)');
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
console.log('Built extension, bookmarklet and GitHub Pages installation site in dist/ and extension/');
console.log(`Checksums written for ${artifacts.length} artifacts (version ${version})`);
