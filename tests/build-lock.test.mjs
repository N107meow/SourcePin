import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression tests for review finding S2: the dist/ build lock used to be a bare
// `mkdir` plus a later `pid` write, so a second build could observe the lock
// during that initialization window, conclude its owner was gone and `rm -rf` it.
// Both processes then built at once, and the loser's unconditional exit cleanup
// could delete the winner's lock. Every test below drives the lock into one
// specific state and asserts what the next process does with it, instead of
// starting builds and hoping a race occurs.
//
// Two harnesses are used:
//   * the lock-only CLI probe of scripts/build.mjs, against a throwaway lock
//     directory, so race ordering is controlled in milliseconds and the timing
//     knobs can be realistic without slowing the suite down;
//   * real `node scripts/build.mjs` child processes in a copy of the repository,
//     which is where "did both processes build at once" is directly observable.
//
// Each build test works inside `mkdtemp` with the repository's node_modules
// symlinked in, so the suite never reads or writes the repository's own dist/ and
// can run while other suites build it concurrently.

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
// A pid that certainly cannot be running, standing in for a build killed outright.
const FAKE_PID = 2147483646;
const FAILING_BUILD = 'SOURCEPIN_BUILD_FAIL=after-extension-zip';
const BUILT = /Built extension, bookmarklet and GitHub Pages installation site/;
const RECOVERED = /Removed stale build lock/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitFor = async (predicate, description, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(10);
  }
  assert.fail(`timed out after ${timeout}ms waiting for ${description}`);
};
const ownerFile = lock => `${lock}/owner.json`;
const mkTmp = prefix => mkdtemp(path.join(tmpdir(), prefix));
const cleanup = async area => { for (const item of area) await rm(item, { recursive: true, force: true }); };

// A real workspace: the repository's tracked files minus dist/, plus a symlink to
// the real node_modules so esbuild resolves exactly as it does in the repository.
const makeWorkspace = async () => {
  const root = await mkTmp('sourcepin-build-');
  for (const entry of ['package.json', 'tsconfig.json', 'public', 'src', 'site', 'scripts']) {
    await cp(path.join(REPO, entry), path.join(root, entry), { recursive: true });
  }
  await symlink(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));
  return root;
};

const spawnBuild = (cwd, env = {}) => {
  const child = spawn(process.execPath, [SCRIPT], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.spawnedAt = Date.now();
  child.out = '';
  child.err = '';
  child.stdout.on('data', chunk => { child.out += chunk; });
  child.stderr.on('data', chunk => { child.err += chunk; });
  child.finished = new Promise(resolve => child.on('close', code => { child.code = code; resolve(code); }));
  // Resolves with the probe's own JSON report when this was started as a probe.
  child.reported = new Promise(resolve => child.stdout.on('data', () => {
    const line = child.out.split('\n').filter(part => part.startsWith('PROBE ')).pop();
    if (line) resolve(JSON.parse(line.slice('PROBE '.length)));
  }));
  return child;
};
const probe = (lock, env = {}) => spawnBuild(REPO, {
  SOURCEPIN_BUILD_LOCK_PROBE: '1',
  SOURCEPIN_BUILD_LOCK_DIR: lock,
  SOURCEPIN_BUILD_LOCK_POLL_MS: '25',
  SOURCEPIN_BUILD_LOCK_WAIT_MS: '8000',
  ...env,
});

// Every relative path under a directory, for locating leftovers.
const tree = async dir => {
  const names = [];
  for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (item.isDirectory()) names.push(...(await tree(`${dir}/${item.name}`)).map(name => `${item.name}/${name}`));
    else names.push(item.name);
  }
  return names;
};
// Build output spans two roots: dist/ for the site, the ZIPs and the checksums, and
// the repository-root extension/ folder that ships as the loadable unpacked extension.
// Both must be swept, or a temporary file in the tracked folder would go unnoticed.
const leftovers = async root => (await tree(root)).filter(name => name.includes('.build-') || name.endsWith('.tmp'));
const allLeftovers = async workspace => [...await leftovers(`${workspace}/dist`), ...await leftovers(`${workspace}/extension`)];
const tombstones = async root => (await tree(root)).filter(name => name.startsWith('.build-lock.stale-'));
const lockExists = dir => stat(dir).then(() => true, () => false);
const readOwner = dir => readFile(ownerFile(dir), 'utf8').then(raw => JSON.parse(raw), () => null);
const staleLock = async lock => {
  await mkdir(lock, { recursive: true });
  await writeFile(ownerFile(lock), `${JSON.stringify({ v: 1, pid: FAKE_PID, token: 'dead-owner', created: Date.now() - 3600000 })}\n`);
};

test('a contender that has created the lock but not yet written its owner record is not treated as dead and is not deleted (S2)', async () => {
  const workspace = await makeWorkspace();
  const marker = path.join(await mkTmp('sourcepin-sync-'), 'release');
  const lock = `${workspace}/dist/.build-lock`;

  // A takes the lock and stops inside its initialization window until released.
  const a = spawnBuild(workspace, { SOURCEPIN_BUILD_LOCK_SYNC: marker });
  await waitFor(() => a.out.includes('initialized by pid'), 'the first build to create the lock');
  assert.equal(existsSync(marker), false, 'the sync marker does not exist yet, so A is parked in the window');
  assert.equal(existsSync(ownerFile(lock)), false, 'the reproduction is only valid while no owner record exists');
  assert.equal(await lockExists(lock), true, 'the first build really created the lock directory');
  assert.equal(a.out.includes('held by pid'), false, 'A has not claimed the lock yet, only initialized it');

  // B arrives with a grace window that only a lock nobody is initializing could
  // exhaust, so correct handling of the initialized-but-unowned state is the only
  // thing that can make it wait.
  const b = spawnBuild(workspace, { SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '4000' });
  await sleep(700);
  const bWaited = b.code === undefined;
  const lockIntact = await lockExists(lock);
  const stillUnowned = !existsSync(ownerFile(lock));

  await writeFile(marker, 'go');
  const aCode = await a.finished;
  const bCode = await b.finished;

  assert.equal(bWaited, true, 'the second build was still waiting: a lock whose owner is mid-init must not be stolen');
  assert.equal(lockIntact, true, 'the second build did not delete the lock the first one had just created');
  assert.equal(stillUnowned, true, 'the second build did not claim the lock during the first one\'s initialization');
  assert.equal(aCode, 0, `the interrupted first build completed: ${a.err}`);
  assert.match(a.out, BUILT, 'the first build finished its artifacts after the pause');
  assert.equal(bCode, 0, `the second build completed afterwards: ${b.err}`);
  assert.match(b.out, BUILT, 'the second build built its artifacts too');
  assert.equal(await lockExists(lock), false, 'the lock is gone once the last holder releases it');
  assert.deepEqual(await allLeftovers(workspace), [], 'two serialized builds left no temp files');
  await cleanup([workspace, marker]);
});

test('two contenders for one unowned lock serialize: exactly one holds it, the other waits', async () => {
  const root = await mkTmp('sourcepin-lock-');
  const lock = path.join(root, '.build-lock');
  // Older than any grace window, so both contenders may attempt the takeover.
  await staleLock(lock);
  const old = new Date(Date.now() - 3600000);
  await utimes(lock, old, old);

  const a = probe(lock, { SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '4000' });
  const b = probe(lock, { SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '4000' });
  const [aCode, bCode] = await Promise.all([a.finished, b.finished]);
  const [aReport, bReport] = await Promise.all([a.reported, b.reported]);

  assert.deepEqual([aCode, bCode], [0, 0], `both contenders acquired the lock in turn: A=${a.err} B=${b.err}`);
  assert.equal(aReport.acquired && bReport.acquired, true, 'neither contender gave up');
  assert.notEqual(aReport.token, bReport.token, 'the two holders are different processes');
  // Every takeover that happened displaced the *dead* owner, never the live
  // contender: that is exactly the bug this suite exists for.
  const recoveries = [a, b].filter(child => RECOVERED.test(child.err));
  assert.ok(recoveries.length >= 1, `the stale lock was recovered: A=${JSON.stringify(a.err)} B=${JSON.stringify(b.err)}`);
  for (const child of recoveries) {
    assert.match(child.err, new RegExp(`previous owner pid ${FAKE_PID}`), `${child.pid} only ever displaced the dead owner`);
  }
  assert.doesNotMatch(a.err + b.err, new RegExp(`previous owner pid (?!${FAKE_PID})\\d+`), 'neither contender reported displacing a live owner');
  assert.equal(await lockExists(lock), false, 'no contender left a lock behind');
  assert.deepEqual(await tombstones(root), [], 'no takeover tombstone was left behind');
  await cleanup([root]);
});

test('a lock whose owner is gone is recovered by the next build, which then succeeds', async () => {
  const workspace = await makeWorkspace();
  const lock = `${workspace}/dist/.build-lock`;
  await staleLock(lock);
  const build = spawnBuild(workspace, {
    SOURCEPIN_BUILD_LOCK_WAIT_MS: '20000',
    // Long enough that stealing is not immediate, short enough to keep the suite
    // quick: the recovery is still observed, not waited through.
    SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '1500',
  });
  const code = await build.finished;

  assert.equal(code, 0, `the build recovered instead of failing or hanging: ${build.err}`);
  assert.match(build.out, BUILT, 'the build reported success');
  assert.match(build.err, RECOVERED, 'the recovery is reported');
  assert.match(build.err, new RegExp(`previous owner pid ${FAKE_PID}`), 'the recovery names the dead owner');
  assert.equal(await lockExists(lock), false, 'no lock is left behind');
  assert.deepEqual(await tombstones(`${workspace}/dist`), [], 'no tombstone is left behind');
  assert.deepEqual(await allLeftovers(workspace), [], 'no .tmp leftovers');
  await cleanup([workspace]);
});

test('a corrupted lock directory is recovered instead of deadlocking the build', async () => {
  const workspace = await makeWorkspace();
  const lock = `${workspace}/dist/.build-lock`;
  await mkdir(lock, { recursive: true });
  await writeFile(ownerFile(lock), '{"v":1,"pid":');   // a crash between create and record write
  const old = new Date(Date.now() - 3600000);
  await utimes(lock, old, old);
  const build = spawnBuild(workspace, {
    SOURCEPIN_BUILD_LOCK_WAIT_MS: '20000',
    // Deliberately harsher than production: recovering a corrupt lock must not
    // depend on the grace window expiring.
    SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '600000',
  });
  const code = await build.finished;

  assert.equal(code, 0, `the build recovered: ${build.err}`);
  assert.match(build.out, BUILT, 'the build reported success');
  assert.match(build.err, /Removed stale build lock[\s\S]*previous owner unrecorded/, 'the unreadable record is reported as unrecorded');
  assert.equal(await lockExists(lock), false, 'no lock is left behind');
  assert.deepEqual(await allLeftovers(workspace), []);
  await cleanup([workspace]);
});

test('two builds racing to recover the same stale lock: one recovers, the other waits, both finish', async () => {
  const workspace = await makeWorkspace();
  const lock = `${workspace}/dist/.build-lock`;
  await staleLock(lock);

  const env = {
    SOURCEPIN_BUILD_LOCK_WAIT_MS: '25000',
    SOURCEPIN_BUILD_LOCK_POLL_MS: '25',
    // Longer than one build (measured at ~0.2s), so the loser cannot reach the
    // takeover branch before the winner has released: contention is forced.
    SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '2500',
  };
  const a = spawnBuild(workspace, env);
  const b = spawnBuild(workspace, env);
  const [aCode, bCode] = await Promise.all([a.finished, b.finished]);

  assert.deepEqual([aCode, bCode], [0, 0], `both builds completed: A=${a.err} B=${b.err}`);
  const recoveries = [a, b].filter(child => RECOVERED.test(child.err));
  assert.equal(recoveries.length, 1, `exactly one process recovered the stale lock: A=${JSON.stringify(a.err)} B=${JSON.stringify(b.err)}`);
  assert.match(recoveries[0].err, new RegExp(`previous owner pid ${FAKE_PID}`));
  const built = [a, b].filter(child => BUILT.test(child.out));
  assert.equal(built.length, 2, 'both processes built the artifacts');
  assert.equal(await lockExists(lock), false, 'no lock is left behind');
  assert.deepEqual(await tombstones(`${workspace}/dist`), [], 'no tombstone is left behind');
  assert.deepEqual(await allLeftovers(workspace), [], 'no .tmp leftovers');

  const after = spawnBuild(workspace, { SOURCEPIN_BUILD_LOCK_WAIT_MS: '20000' });
  assert.equal(await after.finished, 0, `a later build is unaffected by the competition: ${after.err}`);
  assert.equal(await lockExists(lock), false);
  await cleanup([workspace]);
});

test('a build that fails while holding the lock leaves no lock and no temp files', async () => {
  const workspace = await makeWorkspace();
  const lock = `${workspace}/dist/.build-lock`;
  // Pre-seed a stale lock so the failing build does not spend the grace window
  // waiting before it can even start.
  await staleLock(lock);
  const failing = spawnBuild(workspace, { SOURCEPIN_BUILD_FAIL: 'after-extension-zip', SOURCEPIN_BUILD_LOCK_WAIT_MS: '20000', SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '1500' });
  const code = await failing.finished;

  assert.notEqual(code, 0, 'the injected failure really failed the build');
  assert.ok(failing.err.includes(FAILING_BUILD), `the failure came from the injected hook: ${failing.err}`);
  assert.equal(await lockExists(lock), false, 'the failed build released its lock');
  assert.deepEqual(await tombstones(`${workspace}/dist`), [], 'no tombstone is left behind');
  assert.deepEqual(await allLeftovers(workspace), [], 'the failed build left no .tmp files');

  // The next build must not wait on anything the failure left behind: the grace
  // window is set far beyond the test's patience, so only a released lock can pass.
  const recovered = spawnBuild(workspace, { SOURCEPIN_BUILD_LOCK_WAIT_MS: '20000', SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '60000' });
  assert.equal(await recovered.finished, 0, `a later build succeeds with no grace window available: ${recovered.err}`);
  assert.match(recovered.out, BUILT);
  assert.deepEqual(await allLeftovers(workspace), []);
  await cleanup([workspace]);
});

test('a release never deletes a lock another process owns: the waiter fails loudly and the owner keeps it', async () => {
  const workspace = await makeWorkspace();
  const lock = `${workspace}/dist/.build-lock`;
  const owner = probe(lock, { SOURCEPIN_BUILD_LOCK_PROBE_HOLD_MS: '2500' });
  // Read the owner record while its holder is deliberately still holding: keyed on
  // stdout rather than a sleep, so the lock is provably alive at this instant.
  await waitFor(() => owner.out.includes('held by pid'), 'the owner to take the lock');
  const held = JSON.parse(await readFile(ownerFile(lock), 'utf8'));
  assert.equal(held.pid, owner.pid, 'the owner record names the live holder');
  assert.match(held.token, /^[0-9a-f]{16}$/, 'the owner record carries a random token');
  assert.equal(typeof held.created, 'number', 'the owner record carries a creation time');
  assert.equal(await lockExists(lock), true, 'the lock is on disk while its owner is alive');

  // This build resolves the very same lock and must give up rather than delete a
  // lock its owner is still holding.
  const waiter = spawnBuild(workspace, {
    SOURCEPIN_BUILD_LOCK_WAIT_MS: '1200',
    SOURCEPIN_BUILD_LOCK_POLL_MS: '25',
    // Harsher than production: the live owner alone must protect the lock.
    SOURCEPIN_BUILD_LOCK_INIT_GRACE_MS: '600000',
  });
  const waiterCode = await waiter.finished;
  assert.notEqual(waiterCode, 0, 'the blocked build failed instead of building alongside the owner');
  assert.match(waiter.err, /Another build has held \S*build-lock for 1s; remove it and build again\./, 'the error keeps the original intent and names the wait it applied');
  assert.equal(await lockExists(lock), true, 'the failed waiter did not delete the owner\'s lock');

  const ownerReport = await owner.reported;
  const ownerCode = await owner.finished;
  assert.equal(ownerReport.acquired, true);
  assert.equal(ownerReport.released, true, 'the owner released a lock it still owned');
  assert.equal(ownerCode, 0, `the owner completed normally despite the waiter: ${owner.err}`);
  assert.equal(await lockExists(lock), false, 'the owner released its own lock');
  await cleanup([workspace]);
});

test('a late-exiting owner never deletes the lock a later build took over (release is ownership-checked)', { timeout: 60000 }, async () => {
  const workspace = await makeWorkspace();
  const lock = `${workspace}/dist/.build-lock`;
  // A first build holds the lock for the whole window.
  const a = spawnBuild(workspace, { SOURCEPIN_BUILD_SLOW_MS: '4000' });
  await waitFor(() => a.out.includes('held by pid'), 'the first build to take the lock');
  const first = await readOwner(lock);
  assert.equal(first.pid, a.pid, 'the first build owns the lock it took');
  // Freeze it mid-build. Its lock stops being reclaimable by anyone else, which is
  // what makes the interleaving deterministic instead of a guess about timing.
  process.kill(a.pid, 'SIGSTOP');
  assert.equal(await lockExists(lock), true, 'the frozen build still holds a lock directory');
  let stopped = true;
  try {
    // Replace the lock the way the original defect did: removed while its owner was
    // still alive, then recreated by whoever came next. The frozen build is now the
    // late exiter, and the lock belongs to the process that recovered it.
    await rm(lock, { recursive: true, force: true });
    const takeover = probe(lock, { SOURCEPIN_BUILD_LOCK_PROBE_HOLD_MS: '8000' });
    await waitFor(() => existsSync(ownerFile(lock)), 'the later build to write its owner record');
    const next = await readOwner(lock);
    assert.equal(next.pid, takeover.pid, 'the lock now belongs to the later build');
    assert.notEqual(next.token, first.token, 'the later build holds a different owner token');

    // Wake A while that lock is still held. A exits as a late exiter; without the
    // ownership check its cleanup would delete the lock listed below.
    process.kill(a.pid, 'SIGCONT');
    stopped = false;
    const aCode = await a.finished;
    assert.equal(aCode, 0, `the first build completed after being resumed: ${a.err}`);
    assert.match(a.out, BUILT, 'the first build finished its artifacts');
    assert.equal(await lockExists(lock), true, 'the late exiter did not delete the lock another process holds');
    assert.deepEqual(await readOwner(lock), next, 'the holder\'s owner record is untouched by the late exiter');

    assert.equal(await takeover.finished, 0, `the recovering build finished: ${takeover.err}`);
    assert.equal((await takeover.reported).released, true, 'the holder released its own lock');
    assert.equal(await lockExists(lock), false, 'no lock is left behind');
    assert.deepEqual(await tombstones(`${workspace}/dist`), [], 'no tombstone is left behind');
    assert.deepEqual(await allLeftovers(workspace), [], 'no .tmp files are left behind');
    const after = spawnBuild(workspace, { SOURCEPIN_BUILD_LOCK_WAIT_MS: '20000' });
    assert.equal(await after.finished, 0, `a later build is unaffected: ${after.err}`);
  } finally {
    // A stopped child must never be left behind by a failed assertion.
    if (stopped) { try { process.kill(a.pid, 'SIGCONT'); } catch { /* already gone */ } }
  }
  await cleanup([workspace]);
});

test('SHA256SUMS matches the artifacts this build produced, and a rebuild of the same sources is identical', async () => {
  const workspace = await makeWorkspace();
  const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const first = spawnBuild(workspace);
  assert.equal(await first.finished, 0, `the first build succeeded: ${first.err}`);
  const firstSums = await readFile(`${workspace}/dist/SHA256SUMS`, 'utf8');

  // Cross a whole second, and preferably the zip timestamp granularity, so a build
  // that merely preserves entry times cannot look reproducible by accident.
  await sleep(2100 - (Date.now() % 2000));
  const second = spawnBuild(workspace);
  assert.equal(await second.finished, 0, `the second build succeeded: ${second.err}`);
  const sums = await readFile(`${workspace}/dist/SHA256SUMS`, 'utf8');
  assert.equal(sums, firstSums, 'a rebuild of unchanged sources publishes the same checksums');
  const listed = sums.trim().split('\n').map(line => /^([0-9a-f]{64}) {2}dist\/(.+)$/.exec(line));
  assert.equal(listed.every(Boolean), true, `every checksum line is well formed:\n${sums}`);
  assert.match(sums, /dist\/sourcepin\.js\n/, 'the bookmarklet script is checksummed');
  assert.doesNotMatch(sums, /\.tmp/, 'no temporary file is ever listed');

  const names = listed.map(match => match[2]);
  assert.deepEqual(names, [...names].sort(), 'the list is sorted, so two builds are comparable line by line');
  // Exactly the artifacts of this build: the versioned extension ZIP, the site
  // ZIP, the bookmarklet script and its text form.
  assert.equal(names.filter(name => name.endsWith('.zip')).length, 2, `both ZIPs are checksummed: ${names}`);
  assert.equal(names.filter(name => name === 'sourcepin.js').length, 1);
  assert.equal(names.filter(name => name === 'sourcepin.bookmarklet.txt').length, 1);

  for (const match of listed) {
    const file = `${workspace}/dist/${match[2]}`;
    assert.equal(await digest(file), match[1], `${match[2]} matches its own checksum`);
    if (!match[2].endsWith('.zip')) {
      // Non-archive artifacts keep a real modification time, so a leftover from
      // the first build is directly detectable.
      assert.ok((await stat(file)).mtimeMs >= second.spawnedAt, `${match[2]} carries the rebuild's own timestamp`);
    }
  }

  for (const name of names.filter(candidate => candidate.endsWith('.zip'))) {
    const entries = execFileSync('unzip', ['-Z1', `${workspace}/dist/${name}`], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(entries.length > 0, `${name} is a readable ZIP`);
    assert.deepEqual(entries.filter(entry => /\.tmp$/.test(entry)), [], `${name} ships no temporary file`);
    execFileSync('unzip', ['-t', `${workspace}/dist/${name}`], { stdio: 'pipe' });   // every CRC must check out
    if (name.includes('extension')) {
      // The ZIP carries exactly the published unpacked extension, no more. The
      // published folder is tracked at the repository root, not under dist/.
      const published = (await readdir(`${workspace}/extension`)).slice().sort();
      assert.deepEqual(entries.slice().sort(), published, 'the extension ZIP carries exactly the published files');
      // Byte-for-byte equality with what this build published is the direct proof
      // that the archive came from this build and not from a leftover: an inode or
      // a normalized archive timestamp cannot show that on its own.
      for (const entry of entries) {
        const extracted = execFileSync('unzip', ['-p', `${workspace}/dist/${name}`, entry], { maxBuffer: 64 * 1024 * 1024 });
        assert.equal(extracted.equals(await readFile(`${workspace}/extension/${entry}`)), true, `${name}:${entry} is byte-identical to the published file`);
      }
    }
    if (name.includes('site')) {
      assert.ok(entries.includes('.nojekyll'), 'the site ZIP ships .nojekyll');
      for (const entry of entries) {
        const extracted = execFileSync('unzip', ['-p', `${workspace}/dist/${name}`, entry], { maxBuffer: 64 * 1024 * 1024 });
        assert.equal(extracted.equals(await readFile(`${workspace}/dist/site/${entry}`)), true, `${name}:${entry} is byte-identical to the published file`);
      }
    }
  }
  assert.deepEqual(await allLeftovers(workspace), [], 'no .tmp files survived either build');
  assert.equal(await lockExists(`${workspace}/dist/.build-lock`), false, 'the last build released the lock');
  await cleanup([workspace]);
});
