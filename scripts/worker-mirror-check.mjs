// Copy-out protocol check for the dashboard-managed newsletter Worker.
//
//   node scripts/worker-mirror-check.mjs <path-to-dashboard-source>
//
// workers-external/calvary-newsletter.worker.js is a mirror of a Worker whose
// live source is edited in the Cloudflare dashboard (see that file's header).
// The mirror is only worth anything if it is byte-identical to what is deployed,
// and the only way to know is to copy the dashboard source out and compare.
//
// This reports which of the two candidates the live source matches — the
// committed mirror, the current working tree, or neither — and prints the diff
// when it is neither. It writes nothing and changes nothing.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MIRROR = resolve(ROOT, 'workers-external/calvary-newsletter.worker.js');

const livePath = process.argv[2];
if (!livePath) {
  console.error('\n  Usage: node scripts/worker-mirror-check.mjs <path-to-dashboard-source>\n');
  process.exit(1);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

const live = await readFile(resolve(livePath), 'utf8');
const tree = await readFile(MIRROR, 'utf8');
const head = spawnSync('git', ['show', 'HEAD:workers-external/calvary-newsletter.worker.js'],
  { cwd: ROOT, encoding: 'utf8' }).stdout;

const rows = [
  ['dashboard (live)', live],
  ['repo mirror @ HEAD', head],
  ['repo mirror (working tree)', tree],
];

console.log('');
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
  console.log('    Reconcile with:  git checkout -- workers-external/calvary-newsletter.worker.js\n');
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
