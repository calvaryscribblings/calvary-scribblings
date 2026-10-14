// W46 — MUTATION CHECKS for functions/api/series/notes.js.
//
//   node tests/series-notes/mutations.mjs
//
// Each mutant breaks ONE of the endpoint's checks the way a careless edit would, runs
// tests/series-notes/endpoint.test.mjs against it, and asserts the suite goes RED. A mutant that
// survives is a check the suite does not actually hold, and this script exits 1.
//
// The file is copied aside and copied back after every mutant (and in a finally, and on
// SIGINT) — never `git stash`, which would revert everyone's edits in a shared tree (CLAUDE.md,
// "Parallel workers"). Each anchor must occur in the source exactly as written; an anchor that
// has gone missing is reported as a failure of THIS script, so a refactor cannot quietly turn
// a mutant into a no-op that "passes".
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const TARGET = join(root, 'functions/api/series/notes.js');
const BACKUP = `${TARGET}.mutation-backup`;
const SUITE = join(here, 'endpoint.test.mjs');

const MUTANTS = [
  ['skip the flag check', "if (!notesEnabled(env)) return fail('not_enabled');", "if (false) return fail('not_enabled');"],
  ['drop the access check', "if (grant.access !== 'granted') {", 'if (false) {'],
  ['drop the finished check', "if (!finished) return fail('not_finished');", "if (false) return fail('not_finished');"],
  ['post flagged notes live', 'if (verdict && verdict.flagged) {', 'if (false) {', { all: true }],
  ['trust the side from the body', '{ recordedSide: mySide }', '{ recordedSide: body.side }'],
  ['let a non-founder use the founders\' actions', "if (!isFounder(uid)) return fail('forbidden');", "if (false) return fail('forbidden');"],
  ['publish with fewer than three ready', "if (pub.error) return fail('not_ready');", "if (false) return fail('not_ready');"],
  ['block on screening failure (hold instead of posting)', 'return null; // screening could not run', "return { flagged: true, category: 'other', reason: 'unscreened' };", { all: true }],
  ['never decrement the old side', 'moveTally(cur, prev, option)', 'moveTally(cur, null, option)'],
  ['no retry on 412', 'const CAS_TRIES = 5;', 'const CAS_TRIES = 1;'],
  ['lose the writer mark', 'uid === writerUid) note.writer = true;', 'false) note.writer = true;'],
  ['let anyone remove anything', 'const mayRemove = (rec) => founder || rec.uid === uid;', 'const mayRemove = () => true;'],
  ['skip the release check', "if (releaseGrant.reason === 'not_released') return fail('not_released');", "if (false) return fail('not_released');"],
];

function restore() {
  try { copyFileSync(BACKUP, TARGET); unlinkSync(BACKUP); } catch { /* nothing to restore */ }
}
process.on('SIGINT', () => { restore(); process.exit(130); });

const original = readFileSync(TARGET, 'utf8');
copyFileSync(TARGET, BACKUP);

// The baseline must be green, or every "kill" below would mean nothing.
const base = spawnSync(process.execPath, ['--test', SUITE], { cwd: root, encoding: 'utf8' });
if (base.status !== 0) {
  restore();
  console.error('The unmutated suite is not green — fix that first.');
  process.exit(1);
}

let killed = 0;
const survivors = [];
const broken = [];
try {
  for (const [name, from, to, opts = {}] of MUTANTS) {
    const count = original.split(from).length - 1;
    if (count === 0 || (!opts.all && count !== 1)) { broken.push(`${name} (anchor found ${count}×)`); continue; }
    const mutated = opts.all ? original.split(from).join(to) : original.replace(from, to);
    writeFileSync(TARGET, mutated);
    const r = spawnSync(process.execPath, ['--test', SUITE], { cwd: root, encoding: 'utf8' });
    copyFileSync(BACKUP, TARGET);
    if (r.status !== 0) { killed += 1; console.log(`  killed    ${name}`); }
    else { survivors.push(name); console.log(`  SURVIVED  ${name}`); }
  }
} finally {
  restore();
}

if (readFileSync(TARGET, 'utf8') !== original) {
  console.error('notes.js was NOT restored byte-for-byte.');
  process.exit(1);
}
console.log(`\n${killed} of ${MUTANTS.length} mutants killed.`);
if (broken.length) console.log(`Anchors missing: ${broken.join('; ')}`);
process.exit(survivors.length || broken.length ? 1 : 0);
