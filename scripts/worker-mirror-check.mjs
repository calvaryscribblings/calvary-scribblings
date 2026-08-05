// Copy-out protocol check for the dashboard-managed Workers.
//
//   node scripts/worker-mirror-check.mjs <path-to-dashboard-source> [worker]
//
// workers-external/*.worker.js are mirrors of Workers whose live source is edited
// in the Cloudflare dashboard (see each file's header). A mirror is only worth
// anything if it is byte-identical to what is deployed, and the only way to know
// is to copy the dashboard source out and compare.
//
// This reports which of the two candidates the live source matches — the
// committed mirror, the current working tree, or neither — and prints the diff
// when it is neither. It writes nothing and changes nothing.
//
// ── R9.6: WHY THIS TAKES A WORKER NAME NOW ───────────────────────────────────
// It was hardcoded to the newsletter mirror, from the days when that was the only
// one. It is not any more, and a hardcoded MIRROR is worse than useless for the
// second Worker: pointed at the hit-counter's dashboard source it would compare it
// against the NEWSLETTER file, report "matches neither", print a diff of two
// unrelated programs, and exit 1 — an answer that looks like drift and is actually
// a category error. The name defaults to `newsletter`, so the original one-argument
// invocation still behaves exactly as it did.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Every dashboard-managed Worker that has a mirror here. Add a row when a Worker is
// mirrored; the whole point of the mirrors is that this list is the complete set of
// Workers running outside version control.
const WORKERS = {
  newsletter: 'workers-external/calvary-newsletter.worker.js',
  'hit-counter': 'workers-external/calvary-hit-counter.worker.js',
};

const livePath = process.argv[2];
const workerName = process.argv[3] || 'newsletter';
if (!livePath) {
  console.error('\n  Usage: node scripts/worker-mirror-check.mjs <path-to-dashboard-source> [worker]');
  console.error(`  worker: ${Object.keys(WORKERS).join(' | ')}   (default: newsletter)\n`);
  process.exit(1);
}
if (!WORKERS[workerName]) {
  console.error(`\n  Unknown worker "${workerName}". Known: ${Object.keys(WORKERS).join(', ')}\n`);
  process.exit(1);
}
const MIRROR_REL = WORKERS[workerName];
const MIRROR = resolve(ROOT, MIRROR_REL);
if (!existsSync(MIRROR)) {
  // The hit-counter mirror does not exist until its source has been pasted in. Say so
  // plainly rather than failing on a read deep in the comparison.
  console.error(`\n  No mirror at ${MIRROR_REL} yet — nothing to compare against.`);
  console.error('  Create the mirror from the dashboard source first, commit it unmodified,\n'
    + '  and only then use this to prove the two stay identical.\n');
  process.exit(1);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

const live = await readFile(resolve(livePath), 'utf8');
const tree = await readFile(MIRROR, 'utf8');
const head = spawnSync('git', ['show', `HEAD:${MIRROR_REL}`],
  { cwd: ROOT, encoding: 'utf8' }).stdout;

const rows = [
  ['dashboard (live)', live],
  ['repo mirror @ HEAD', head],
  ['repo mirror (working tree)', tree],
];

console.log(`\n  worker: ${workerName}   mirror: ${MIRROR_REL}`);
for (const [label, text] of rows) {
  console.log(`  ${label.padEnd(28)} ${String(Buffer.byteLength(text)).padStart(6)} bytes   sha256 ${sha(text).slice(0, 16)}`);
}
console.log('');

if (live === head && live === tree) {
  console.log('  ✓ All three identical. Nothing to reconcile.\n');
  process.exit(0);
}
if (live === head) {
  console.log('  → LIVE MATCHES HEAD. The working-tree change is local noise.');
  console.log(`    Reconcile with:  git checkout -- ${MIRROR_REL}\n`);
  process.exit(0);
}
if (live === tree) {
  console.log('  → LIVE MATCHES THE WORKING TREE. The uncommitted change is real dashboard truth.');
  console.log('    Reconcile by committing the working tree as-is.\n');
  process.exit(0);
}

console.log('  ✗ LIVE MATCHES NEITHER — the dashboard has drifted from both.');
console.log('    The dashboard is authoritative. Diff against the working tree follows');
console.log('    (- = repo, + = live dashboard):\n');
const { writeFileSync, mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const dir = mkdtempSync(resolve(tmpdir(), 'mirror-'));
writeFileSync(resolve(dir, 'repo.js'), tree);
writeFileSync(resolve(dir, 'live.js'), live);
const d = spawnSync('diff', ['-u', resolve(dir, 'repo.js'), resolve(dir, 'live.js')], { encoding: 'utf8' });
console.log(d.stdout || '(diff produced no output)');
process.exit(1);
