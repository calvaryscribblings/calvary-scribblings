// Prove the repo rule files match what Firebase is serving LIVE.
//
//   node scripts/rules-check.mjs      (npm run rules:check)
//
// Pulls the live RTDB and Storage rules and diffs them against the canonical repo
// files (database.rules.json / storage.rules). Prints each diff and exits NONZERO
// on any drift. Empty diffs = repo is the source of truth; the console has not
// been edited behind the repo's back.
//
// RTDB is verified byte-for-byte against the live .settings/rules.json text.
// Storage is verified by comparing the live active ruleset's SOURCE (the Firebase
// Rules API), which is what a deploy round-trips — the ruleset id changes on each
// deploy but the source content does not.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mintToken, pullRtdb, pullStorage } from './rules-pull.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function diff(repoPath, livePath, label) {
  const r = spawnSync('diff', ['-u', repoPath, livePath], { encoding: 'utf8' });
  if (r.status === 0) {
    console.log(`✓ ${label}: no drift (repo === live)`);
    return true;
  }
  console.log(`✗ ${label}: DRIFT — the console was edited behind the repo:`);
  console.log(r.stdout || r.stderr);
  return false;
}

const token = await mintToken();
let ok = true;

// RTDB
const liveRtdb = resolve(tmpdir(), 'rules-check-rtdb.json');
await pullRtdb(token, liveRtdb);
ok = diff(resolve(ROOT, 'database.rules.json'), liveRtdb, 'RTDB (database.rules.json)') && ok;

// Storage
const liveStorage = resolve(tmpdir(), 'rules-check-storage');
const s = await pullStorage(token, liveStorage);
if (s.skipped) {
  console.log(`⚠ Storage: could not verify automatically (${s.reason}). Compare storage.rules against the console by hand.`);
  ok = false;
} else {
  ok = diff(resolve(ROOT, 'storage.rules'), liveStorage, `Storage (storage.rules, live ruleset ${s.ruleset})`) && ok;
}

if (!ok) {
  console.log('\nDRIFT DETECTED — reconcile it INTO the repo before deploying. Never deploy over unexamined drift.');
  process.exit(1);
}
console.log('\nParity proven: repo files match live exactly.');
