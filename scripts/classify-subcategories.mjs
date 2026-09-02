// Classify each cms_stories record into the most appropriate subcategory using
// the Anthropic API. READ-ONLY: this script never writes to Firebase. It only
// reads cms_stories and emits scripts/classification-report.json plus a
// human-readable console summary.
//
//   node scripts/classify-subcategories.mjs
//
// Requirements:
//   - ANTHROPIC_API_KEY in the environment (Codespace secret).
//   - serviceAccountKey.json at the repo root (same as other scripts/).
//
// Only stories whose category is in SUBCATEGORY_MAP AND whose subcategory is
// currently empty are classified. Category 'serial' is treated as 'novel'.
// Any other category is skipped. Processing is sequential with a 200ms delay
// between API calls to stay clear of rate limits.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const REPORT_PATH = resolve(__dirname, 'classification-report.json');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';
const DELAY_MS = 200;

// Subcategory options keyed by category. Mirrors the CMS picker / category pages.
const SUBCATEGORY_MAP = {
  flash: ['Romance', 'Horror', 'Humour', 'Drama', 'Thriller', 'Slice of Life'],
  short: ['Romance', 'Horror', 'Humour', 'Drama', 'Thriller', 'Slice of Life', 'Mystery', 'Sci-Fi', 'Historical', 'Fantasy'],
  poetry: ['Love', 'Grief', 'Political', 'Nature', 'Spiritual', 'Spoken Word'],
  inspiring: ['Personal Essay', 'Overcoming', 'Faith', 'Ambition', 'Loss & Recovery'],
  novel: ['Novel', 'Novella', 'Serial'],
  news: ['Op-Ed', 'Essay', 'Music', 'Film', 'Tech', 'Science', 'Business', 'Finance', 'Sport', 'Politics', 'Culture'],
};

// 'serial' stories are classified against the 'novel' map but reported under
// their own resolved category key ('novel').
const CATEGORY_ALIASES = { serial: 'novel' };

function isEmpty(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call the Anthropic Messages API and return the trimmed text reply.
async function classify(story, category, options) {
  const opening = stripHtml(story.content || story.extractedText || '').slice(0, 500);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 50,
      system: 'You are a story classifier. Reply with ONLY the subcategory name, nothing else. No punctuation, no explanation.',
      messages: [
        {
          role: 'user',
          content:
            `Classify this story into exactly one subcategory.\n\n` +
            `Title: ${story.title}\n` +
            `Category: ${category}\n` +
            `Opening: ${opening}\n\n` +
            `Available subcategories for ${category}: ${options.join(', ')}\n\n` +
            `Reply with only the subcategory name.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = (data.content || []).map((b) => b.text || '').join('').trim();

  // Normalise to one of the allowed options (case-insensitive, ignore stray
  // punctuation). Fall back to the raw reply tagged so the report stays honest.
  const norm = raw.toLowerCase().replace(/[^a-z0-9& ]/gi, '').trim();
  const matched = options.find((o) => o.toLowerCase() === norm);
  return matched || `${raw} (unmatched)`;
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in the environment. Export it and re-run.');
  }

  const keyPath = resolve(ROOT, 'serviceAccountKey.json');
  const serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  const snap = await db.ref('cms_stories').get();
  const stories = snap.val() || {};

  // Build the work list: category in map (after alias) AND subcategory empty.
  const work = [];
  let skippedCategory = 0;
  let skippedClassified = 0;

  for (const [key, story] of Object.entries(stories)) {
    if (!story || typeof story !== 'object') continue;
    const rawCat = typeof story.category === 'string' ? story.category : '';
    const category = CATEGORY_ALIASES[rawCat] || rawCat;
    if (!SUBCATEGORY_MAP[category]) { skippedCategory++; continue; }
    if (!isEmpty(story.subcategory)) { skippedClassified++; continue; }
    work.push({ key, slug: story.slug || key, story, category });
  }

  console.log(`Read ${Object.keys(stories).length} cms_stories.`);
  console.log(`  To classify: ${work.length}`);
  console.log(`  Skipped (category not in map): ${skippedCategory}`);
  console.log(`  Skipped (already has subcategory): ${skippedClassified}`);
  console.log('');

  const report = {};
  for (const cat of Object.keys(SUBCATEGORY_MAP)) report[cat] = [];

  for (let i = 0; i < work.length; i++) {
    const { slug, story, category } = work[i];
    const options = SUBCATEGORY_MAP[category];
    let suggested;
    try {
      suggested = await classify(story, category, options);
    } catch (err) {
      suggested = `ERROR: ${err.message}`;
      console.error(`  [${i + 1}/${work.length}] ${slug} → ${suggested}`);
    }
    report[category].push({ slug, title: story.title || '', suggested });
    console.log(`  [${i + 1}/${work.length}] ${category.padEnd(9)} ${slug} → ${suggested}`);

    if (i < work.length - 1) await sleep(DELAY_MS);
  }

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

  // --- Human-readable summary ---------------------------------------------
  console.log(`\n${'='.repeat(72)}\nCLASSIFICATION SUMMARY\n${'='.repeat(72)}`);
  for (const cat of Object.keys(SUBCATEGORY_MAP)) {
    const rows = report[cat];
    console.log(`\n${cat}  (${rows.length})`);
    if (rows.length === 0) { console.log('  (none)'); continue; }
    for (const r of rows) {
      console.log(`  ${String(r.slug).slice(0, 44).padEnd(44)} → ${r.suggested}`);
    }
  }
  const total = Object.values(report).reduce((n, rows) => n + rows.length, 0);
  console.log(`\n${'='.repeat(72)}\nWrote ${total} suggestion(s) to ${REPORT_PATH}\n${'='.repeat(72)}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
