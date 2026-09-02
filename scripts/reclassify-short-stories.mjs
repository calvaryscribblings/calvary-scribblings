// Re-classify ONLY the Short Stories category using the full story body (not a
// 500-char opening). READ-ONLY: never writes to Firebase. Reads cms_stories,
// classifies each `short` story via the Anthropic API, prints a comparison
// table against the story's existing subcategory, and writes
// scripts/short-reclassification-report.json.
//
//   node scripts/reclassify-short-stories.mjs
//
// Requires ANTHROPIC_API_KEY in the environment and serviceAccountKey.json at
// the repo root. If the key is absent, it reports that and stops.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const REPORT_PATH = resolve(__dirname, 'short-reclassification-report.json');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';
const DELAY_MS = 200;

const SUBCATEGORIES = ['Romance', 'Horror', 'Humour', 'Drama', 'Thriller', 'Slice of Life', 'Mystery', 'Sci-Fi', 'Historical', 'Fantasy'];

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function classify(title, fullText) {
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
            `Title: ${title}\n` +
            `Full story: ${fullText}\n\n` +
            `Available subcategories: ${SUBCATEGORIES.join(', ')}\n\n` +
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
  const norm = raw.toLowerCase().replace(/[^a-z0-9& -]/gi, '').trim();
  const matched = SUBCATEGORIES.find((o) => o.toLowerCase() === norm);
  return matched || `${raw} (unmatched)`;
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set in the environment. Stopping — no API calls made.');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  const snap = await db.ref('cms_stories').get();
  const stories = snap.val() || {};

  const shorts = Object.entries(stories)
    .filter(([, s]) => s && typeof s === 'object' && s.category === 'short')
    .map(([key, s]) => ({ slug: s.slug || key, title: s.title || '', previous: isEmpty(s.subcategory) ? '' : s.subcategory, text: stripHtml(s.content || s.extractedText || '') }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  console.log(`Found ${shorts.length} short stories. Re-classifying on full body text…\n`);

  const results = [];
  for (let i = 0; i < shorts.length; i++) {
    const st = shorts[i];
    let suggested;
    try {
      suggested = await classify(st.title, st.text);
    } catch (err) {
      suggested = `ERROR: ${err.message}`;
    }
    const changed = suggested !== st.previous;
    results.push({ slug: st.slug, title: st.title, previous: st.previous, suggested, changed, chars: st.text.length });
    console.log(`  [${i + 1}/${shorts.length}] ${st.slug} (${st.text.length} chars): ${st.previous || '∅'} → ${suggested}${changed ? '  *CHANGED*' : ''}`);
    if (i < shorts.length - 1) await sleep(DELAY_MS);
  }

  await writeFile(REPORT_PATH, JSON.stringify(results, null, 2) + '\n', 'utf8');

  // --- Comparison table ----------------------------------------------------
  const wSlug = Math.max(4, ...results.map((r) => r.slug.length));
  const wTitle = Math.min(40, Math.max(5, ...results.map((r) => r.title.length)));
  const wPrev = Math.max(8, ...results.map((r) => (r.previous || '∅').length));
  const wNew = Math.max(13, ...results.map((r) => r.suggested.length));
  const trunc = (s, w) => (s.length > w ? s.slice(0, w - 1) + '…' : s).padEnd(w);

  const header = `${'slug'.padEnd(wSlug)} | ${'title'.padEnd(wTitle)} | ${'previous'.padEnd(wPrev)} | ${'new suggested'.padEnd(wNew)} | changed`;
  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));
  for (const r of results) {
    console.log(`${r.slug.padEnd(wSlug)} | ${trunc(r.title, wTitle)} | ${(r.previous || '∅').padEnd(wPrev)} | ${r.suggested.padEnd(wNew)} | ${r.changed ? 'YES' : ''}`);
  }

  const changes = results.filter((r) => r.changed);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${results.length} short stories re-classified. ${changes.length} differ from the previous classification:`);
  for (const r of changes) console.log(`  ${r.slug}: ${r.previous || '∅'} → ${r.suggested}`);
  console.log(`\nWrote ${results.length} result(s) to ${REPORT_PATH}`);
  console.log('READ-ONLY — nothing written to Firebase.');
  console.log('='.repeat(72));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
