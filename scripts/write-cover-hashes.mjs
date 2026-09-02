// Write generated cover blurhashes to RTDB cms_stories.
//
// Source of truth: scripts/cover-hashes-report.json (from
// generate-cover-hashes.mjs). Only rows with status 'ok' and a non-empty hash
// are written. Only the `coverHash` field is touched per story (via update(),
// so every other field is preserved). blurhash is the primary/only field
// written here — the report also carries a thumbhash for future use.
//
//   node scripts/write-cover-hashes.mjs
//
// Requires serviceAccountKey.json at the repo root (same as other scripts/).
// After writing, reads back 3 random ids and prints them for verification.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const REPORT_PATH = resolve(__dirname, 'cover-hashes-report.json');
const DELAY_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic sample of n items from an array (seeded by index spread — no
// Math.random, so the verification set is reproducible run to run).
function sample(arr, n) {
  if (arr.length <= n) return arr.slice();
  const step = Math.floor(arr.length / n);
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[i * step]);
  return out;
}

async function main() {
  const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));

  const work = report.filter((r) => r.status === 'ok' && r.hash);
  const skipped = report.length - work.length;

  console.log(`Report rows: ${report.length}`);
  console.log(`  To write (ok + hash): ${work.length}`);
  console.log(`  Skipped (error/no hash): ${skipped}`);
  console.log('');

  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  let written = 0;
  for (let i = 0; i < work.length; i++) {
    const { id, hash } = work[i];
    // update() touches ONLY coverHash; all other fields preserved.
    await db.ref(`cms_stories/${id}`).update({ coverHash: hash });
    written++;
    console.log(`✓ ${id} → ${hash}`);
    if (i < work.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nTotal written: ${written}`);

  // --- Read-back verification of 3 ids ------------------------------------
  const checkIds = sample(work, 3).map((r) => r.id);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`READ-BACK VERIFICATION (${checkIds.length} ids)`);
  console.log(`${'='.repeat(72)}`);
  for (const id of checkIds) {
    const snap = await db.ref(`cms_stories/${id}/coverHash`).get();
    const expected = work.find((r) => r.id === id).hash;
    const actual = snap.val();
    const match = actual === expected ? 'MATCH' : 'MISMATCH';
    console.log(`  ${id}`);
    console.log(`    expected: ${expected}`);
    console.log(`    actual:   ${actual}   [${match}]`);
  }
  console.log(`${'='.repeat(72)}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
