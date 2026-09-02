// Write manually-approved subcategory corrections to RTDB cms_stories.
//
// The corrections below are the authoritative, hand-approved values — NOT the
// model's report suggestions. Only the `subcategory` field is touched per story
// (via update(), so every other field is preserved).
//
//   node scripts/write-corrections.mjs
//
// Requires serviceAccountKey.json at the repo root (same as other scripts/).

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const DELAY_MS = 100;

const CORRECTIONS = {
  // Flash corrections
  'in-case-of-emergency': 'Drama',
  'stuck-on-rewind': 'Drama',
  'the-enabler': 'Humour',
  '47-sessions': 'Humour',

  // Short story corrections
  'afterglow': 'Slice of Life',
  'i-dey-your-back': 'Horror',
  'one-day-for-the-thief': 'Horror',
  'the-man-i-met-at-nineteen': 'Thriller',
  'witness-me': 'Mystery',
  'i-told-you': 'Fantasy',
  '5-to-9': 'Thriller',
  'almost-like-her': 'Drama',
  'final-boarding-call': 'Drama',
  'peekaboo': 'Fantasy',
  'pigment': 'Horror',
  'the-pill': 'Horror',
  'you-didnt-ask': 'Drama',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  const entries = Object.entries(CORRECTIONS);
  let written = 0;
  let skipped = 0;

  for (let i = 0; i < entries.length; i++) {
    const [slug, value] = entries[i];

    // Safety: never create a stray node from a typo'd slug.
    const exists = (await db.ref(`cms_stories/${slug}`).get()).exists();
    if (!exists) {
      console.log(`✗ ${slug} → ${value}  [SKIPPED: slug not found in cms_stories]`);
      skipped++;
      continue;
    }

    // update() touches ONLY subcategory; all other fields preserved.
    await db.ref(`cms_stories/${slug}`).update({ subcategory: value });
    written++;
    console.log(`✓ ${slug} → ${value}`);
    if (i < entries.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nTotal written: ${written}${skipped ? `  (skipped: ${skipped})` : ''}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
