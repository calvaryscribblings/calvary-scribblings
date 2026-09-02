// Write approved subcategory classifications to RTDB cms_stories.
//
// Source of truth: scripts/classification-report.json (the approved results
// from Part B). Three manual corrections are applied in-memory before writing.
// Only the `subcategory` field is touched per story (via update(), so every
// other field is preserved). As a final step, one story is unpublished.
//
//   node scripts/write-subcategories.mjs
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
const REPORT_PATH = resolve(__dirname, 'classification-report.json');
const DELAY_MS = 100;

// Corrections override the JSON for these slugs only (slug → new subcategory).
const CORRECTIONS = {
  'full': 'Slice of Life',
  'how-to-make-peppersoup': 'Essay',
  'in-your-20-s': 'Essay',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));

  // Flatten all categories into a single ordered work list and apply the
  // three corrections in-memory.
  const work = [];
  for (const rows of Object.values(report)) {
    for (const r of rows) {
      const subcategory = CORRECTIONS[r.slug] || r.suggested;
      work.push({ slug: r.slug, subcategory });
    }
  }

  // Report which corrections actually landed, so a typo'd slug can't pass silently.
  for (const slug of Object.keys(CORRECTIONS)) {
    const hit = work.find((w) => w.slug === slug);
    console.log(`correction: ${slug} → ${CORRECTIONS[slug]}${hit ? '' : '  [WARNING: slug not found in report]'}`);
  }
  console.log('');

  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  let written = 0;
  for (let i = 0; i < work.length; i++) {
    const { slug, subcategory } = work[i];
    // update() on the story node touches ONLY subcategory; all else preserved.
    await db.ref(`cms_stories/${slug}`).update({ subcategory });
    written++;
    console.log(`✓ ${slug} → ${subcategory}`);
    if (i < work.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nTotal written: ${written}`);

  // --- Final step: unpublish dead-end story (spoiler avoidance) ------------
  await db.ref('cms_stories/dead-end-a-halfway-around-the-moon-story/published').set(false);
  console.log('✓ dead-end unpublished');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
