// THE LINT RATCHET.
//
//   node scripts/lint-ratchet.mjs            (npm run lint:ratchet)
//   node scripts/lint-ratchet.mjs --update   rewrite the baseline after a cleanup
//
// The repo carries a real backlog of lint problems — 146 errors and 110 warnings
// across app/, functions/, scripts/ and tests/ at the time of writing, dominated
// by react-hooks/set-state-in-effect. Gating CI on zero would mean either a
// permanently red pipeline or a giant unrelated cleanup commit before anything
// else could land. Both are worse than the backlog.
//
// So this gates on the DIRECTION instead: the count may fall, and may never rise.
// A new violation fails the build the day it lands; fixing violations lowers the
// bar behind you (run with --update and commit the new baseline).
//
// public/vendor/** is excluded deliberately — 807 of the repo's problems live in
// the vendored foliate-js tree, which is third-party and explicitly meant to stay
// pristine (public/reading-room.html:7). Counting it would drown the signal.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = resolve(ROOT, 'scripts/lint-baseline.json');
const TARGETS = ['app', 'functions', 'scripts', 'tests'];

const run = spawnSync('npx', ['eslint', ...TARGETS, '-f', 'json'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

// eslint exits 1 when there are errors; that is expected here. Only a crash
// (no parseable JSON on stdout) is fatal.
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error('lint-ratchet: eslint produced no parseable JSON. stderr follows:\n');
  console.error(run.stderr || '(empty)');
  process.exit(2);
}

const errors = report.reduce((a, f) => a + f.errorCount, 0);
const warnings = report.reduce((a, f) => a + f.warningCount, 0);
const total = errors + warnings;

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ errors, warnings, total }, null, 2)}\n`);
  console.log(`lint-ratchet: baseline updated to ${errors} errors / ${warnings} warnings (${total} total).`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

console.log(`lint-ratchet: ${errors} errors, ${warnings} warnings (${total} total)`);
console.log(`   baseline:  ${baseline.errors} errors, ${baseline.warnings} warnings (${baseline.total} total)`);

if (total > baseline.total) {
  // Name the files that grew, so the failure points somewhere.
  const worst = report
    .filter((f) => f.errorCount + f.warningCount > 0)
    .sort((a, b) => (b.errorCount + b.warningCount) - (a.errorCount + a.warningCount))
    .slice(0, 10);
  console.error(`\n✗ lint went UP by ${total - baseline.total}. The ratchet only turns one way.`);
  console.error('  Worst files in this run:');
  for (const f of worst) {
    console.error(`    ${f.errorCount + f.warningCount}  ${f.filePath.replace(ROOT + '/', '')}`);
  }
  console.error('\n  Fix the new problems, or — if you genuinely lowered the count elsewhere —');
  console.error('  run `npm run lint:ratchet -- --update` and commit scripts/lint-baseline.json.\n');
  process.exit(1);
}

if (total < baseline.total) {
  console.log(`\n✓ lint went DOWN by ${baseline.total - total}. Run with --update to lock the gain in.`);
} else {
  console.log('\n✓ lint held at the baseline.');
}
process.exit(0);
