/**
 * Push a branch with the GitHub REST API instead of `git push`.
 *
 * Some networks reach api.github.com but not github.com:443, and then `git push`
 * dies with "Empty reply from server" while every `gh` command keeps working.
 * This script uploads the commit through the API: it creates one blob per tracked
 * file, builds a tree that must hash to the same tree as the local commit, creates
 * the commit, and moves the branch ref. Non-fast-forwards are rejected, so a
 * colleague's newer commit on the remote is never overwritten.
 *
 *   GITHUB_TOKEN=$(gh auth token) node scripts/publish-github.mjs [branch]
 *
 * The uploaded tree is identical to the local commit. GitHub records itself as the
 * author of the commit it creates, so the remote commit gets its own SHA: the two
 * repositories carry the same content and different commit IDs, which is what makes
 * `git push` and `git fetch` useless here in the first place.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const REPO = process.env.SOURCEPIN_REPO ?? 'N107meow/SourcePin';
const BRANCH = process.argv[2] ?? 'main';
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN (or GH_TOKEN) is required; `GITHUB_TOKEN=$(gh auth token) node scripts/publish-github.mjs` works.');
  process.exit(1);
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const dirty = git('status', '--porcelain');
if (dirty !== '') throw new Error(`the working tree has uncommitted changes:\n${dirty}`);

const head = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const message = execFileSync('git', ['cat-file', 'commit', 'HEAD'], { encoding: 'utf8' }).split('\n\n').slice(1).join('\n\n');

const ref = await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`).catch(() => null);
const remoteHead = ref?.object.sha ?? null;
if (remoteHead === null) throw new Error(`${REPO} has no branch ${BRANCH}; create it first or pass another branch name`);
if (remoteHead === head) {
  console.log(`${BRANCH} is already at ${head.slice(0, 7)}; nothing to publish.`);
  process.exit(0);
}

// An ancestor check across the two stores only works once the remote commit has
// been fetched, and that fetch is exactly what this network cannot do. So instead
// of comparing commit IDs, compare content: when the remote tree is byte-identical
// to the tree of a commit in this history, the remote holds nothing this branch
// does not already have, and moving the ref forward cannot lose work.
const localTrees = new Set(execFileSync('git', ['log', '--format=%T', '-n', '2000', 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean));
const remoteTree = (await api(`/repos/${REPO}/git/commits/${remoteHead}`)).tree.sha;
if (!localTrees.has(remoteTree)) {
  throw new Error(`${REPO}#${BRANCH} is at ${remoteHead.slice(0, 7)} with tree ${remoteTree.slice(0, 7)}, which matches nothing in this history. Fetch or merge it before publishing.`);
}
console.log(`publishing ${head.slice(0, 7)} (tree ${tree.slice(0, 7)}) over ${remoteHead.slice(0, 7)} (tree ${remoteTree.slice(0, 7)}, already in this history)`);

const files = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
const entries = [];
for (const path of files) {
  const blob = await api(`/repos/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: (await readFile(path)).toString('base64'), encoding: 'base64' }),
  });
  entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
}

const uploaded = await api(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ tree: entries }) });
if (uploaded.sha !== tree) throw new Error(`uploaded tree ${uploaded.sha} is not the local tree ${tree}; nothing was published`);

const commit = await api(`/repos/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message, tree, parents: [remoteHead] }),
});
await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});
console.log(`${files.length} files uploaded; ${REPO}#${BRANCH} is now ${commit.sha.slice(0, 7)} (tree ${tree.slice(0, 7)})`);
