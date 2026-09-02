// IS THE HORIZON STILL RUNNING? — the question the last cleanup could not answer.
//
// app/api/square-cleanup never ran once in 150 days and nothing anywhere said
// so. The room simply filled up, and the only way to find out was to read the
// code and notice that the URL 404s. That is the failure this file exists to
// make impossible: a horizon that stops must be loud.
//
// Run after every scheduled sweep. Exits non-zero — which fails the workflow,
// which shows red in the Actions tab and emails the owner — when the last bell
// is more than MAX_SILENCE_MS old.
//
// 26 hours, not 24: the bell fires once a day, so a 24-hour threshold would sit
// exactly on the boundary and flap on ordinary runner delay. 26 gives two hours
// of slack and still catches a genuine stop within a day.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

export const MAX_SILENCE_MS = 26 * 60 * 60 * 1000;

const sa = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB_URL });
const db = getDatabase();

const hb = (await db.ref('square_horizon').get()).val() || {};
const now = Date.now();
const stamp = (t) => (t ? new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'never');

console.log(`  last run  ${stamp(hb.lastRunAt)}`);
console.log(`  last bell ${stamp(hb.lastBellAt)}`);
console.log(`  swept at last run ${hb.sweptAtLastRun ?? 0}, remaining in the room ${hb.remaining ?? '?'}`);

// A first deploy has no bell yet. That is not a fault — it becomes one only once
// a bell has been missed, which the next day's run will catch.
if (!hb.lastBellAt) {
  console.log('\n  No bell recorded yet. The first one lands at the next 20:00 London.');
  process.exit(0);
}

const silence = now - hb.lastBellAt;
if (silence > MAX_SILENCE_MS) {
  console.error(
    `\n::error::THE HORIZON HAS STOPPED. Last bell was ${(silence / 3600000).toFixed(1)}h ago ` +
    `(threshold ${MAX_SILENCE_MS / 3600000}h). The Square is filling up and posts are not clearing.`
  );
  process.exit(1);
}
console.log(`\n  ✓ Healthy — last bell ${(silence / 3600000).toFixed(1)}h ago.`);
process.exit(0);
