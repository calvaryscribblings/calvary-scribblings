#!/usr/bin/env node
// W23 §3 — how much of what our readers actually read does the house dictionary answer?
//
//   node scripts/dictionary/coverage.mjs [--misses 20]
//
// SAMPLES ONLY. It reads each published title's `samplePath` — the public sample EPUB any
// signed-out reader can open — and never `epubPath`, the master. Read-only: Admin SDK reads of
// bookstore_titles and the Storage objects, nothing written anywhere.
//
// It takes the distinct words of every sample, looks each one up exactly as the Reading Room
// would (lookupWord over the BUILT shards in public/, glossary excluded — this measures the
// dictionary), and reports the share answered. Then again without proper names, where a proper
// name is a word that NEVER appears in lowercase anywhere in the samples ("Lagos", "Edna"): a
// sentence-initial common word is almost always lowercase somewhere else, so it stays in.
//
// Credentials: FIREBASE_SA_KEY (base64 JSON, the codespace) or serviceAccountKey.json.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from './build.mjs';
import { lookupWord, normaliseWord, isSingleWord, DICT_BASE } from '../../app/lib/dictionary.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const MISSES = Number(arg('--misses', 20));

const sa = process.env.FIREBASE_SA_KEY
  ? JSON.parse(Buffer.from(process.env.FIREBASE_SA_KEY, 'base64').toString())
  : JSON.parse(readFileSync(join(ROOT, 'serviceAccountKey.json'), 'utf8'));
const { initializeApp, cert } = await import('firebase-admin/app');
const { getDatabase } = await import('firebase-admin/database');
const { getStorage } = await import('firebase-admin/storage');
initializeApp({
  credential: cert(sa),
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
});

const titles = (await getDatabase().ref('bookstore_titles').get()).val() || {};
const samples = Object.values(titles).filter((t) => t && t.status === 'published' && typeof t.samplePath === 'string');

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', mdash: '—', ndash: '–', hellip: '…' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITY[n.toLowerCase()] ?? ' ');
const textOf = (xhtml) => decode(String(xhtml)
  .replace(/<head[\s\S]*?<\/head>/i, ' ')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' '));

// A word as a reader could select it: letters, with internal apostrophes or hyphens.
const WORD = /\p{L}+(?:['’-]\p{L}+)*/gu;

const seen = new Map();          // normalised word → { lower: bool }
let tokens = 0;
for (const t of samples) {
  const [buf] = await getStorage().bucket().file(t.samplePath).download();
  for (const [name, bytes] of unzip(buf)) {
    if (!/\.(x?html?)$/i.test(name)) continue;
    for (const m of textOf(bytes.toString('utf8')).matchAll(WORD)) {
      const w = normaliseWord(m[0]);
      if (!w || !isSingleWord(w)) continue;
      tokens++;
      const rec = seen.get(w) || { lower: false };
      if (m[0][0] === m[0][0].toLowerCase()) rec.lower = true;
      seen.set(w, rec);
    }
  }
}

const PUBLIC = join(ROOT, 'public');
if (!existsSync(join(PUBLIC, DICT_BASE, 'manifest.json'))) throw new Error(`public${DICT_BASE} is not built`);
const fetchImpl = async (u) => {
  const p = join(PUBLIC, u);
  return existsSync(p) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(p, 'utf8')) } : { ok: false, status: 404 };
};

const cache = new Map();
const words = [...seen.keys()].sort();
const hit = new Set();
for (const w of words) if (await lookupWord(w, { fetchImpl, cache, timeoutMs: 60_000 })) hit.add(w);

const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
const common = words.filter((w) => seen.get(w).lower);
const commonHit = common.filter((w) => hit.has(w)).length;
console.log(`${samples.length} public samples, ${tokens} word tokens, ${words.length} distinct words`);
console.log(`answered: ${hit.size} of ${words.length} = ${pct(hit.size, words.length)}`);
console.log(`without proper names (${words.length - common.length} words never seen in lowercase): ${commonHit} of ${common.length} = ${pct(commonHit, common.length)}`);

// The misses, spread across the alphabet rather than the first twenty of it.
const misses = common.filter((w) => !hit.has(w));
const step = Math.max(1, Math.floor(misses.length / MISSES));
console.log(`\n${MISSES} of the ${misses.length} common-word misses, evenly spaced:`);
console.log(misses.filter((_, i) => i % step === 0).slice(0, MISSES).join(', '));
const propMiss = words.filter((w) => !seen.get(w).lower && !hit.has(w));
console.log(`\nand ${Math.min(10, propMiss.length)} of the ${propMiss.length} proper-name misses: ${propMiss.filter((_, i) => i % Math.max(1, Math.floor(propMiss.length / 10)) === 0).slice(0, 10).join(', ')}`);
process.exit(0);
