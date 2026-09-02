// R32 — THE REAL POOL, read from the live database at suite time.
//
// The height ruling is about "the tallest state across the REAL POOL — every eligible trailer
// quote, every eligible comment, both at the live width, in the real type. Nothing seeded,
// nothing estimated." A fixture would defeat that on the first day somebody writes a longer
// comment or edits a quote, which is the same argument live-slug.mjs makes for the shop:
// assert invariants over what is really there.
//
// Both nodes are world-readable (".read": true), so this needs no credentials — the same
// public read the carousel itself performs.
//
// ⚠ IT THROWS RATHER THAN RETURNING A GUESS. A height suite that quietly ran on an empty pool
// would be a suite that stopped running the day it was most needed.
import { VOICE_MIN_CHARS, isScreenable } from '../../app/lib/trailerVoices.js';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

async function readNode(path) {
  const res = await fetch(`${DB}/${path}.json`);
  if (!res.ok) throw new Error(`live read ${path} failed: ${res.status}`);
  return res.json();
}

/**
 * { quotes: string[], attributions: string[], comments: string[] }
 *
 * `comments` is every comment that could ever reach a card — the pre-spend filter's output,
 * NOT the screened set. That is deliberate and it is the conservative direction: screening
 * can only ever REMOVE candidates, so a pin measured over the superset can be too generous
 * but never too small, and the suite keeps working before the backfill has run.
 */
export async function livePool() {
  const [index, comments] = await Promise.all([readNode('cms_stories_index'), readNode('comments')]);

  const quotes = [];
  const attributions = [];
  const quoted = new Set();
  for (const [slug, s] of Object.entries(index || {})) {
    const q = typeof s?.trailerQuote === 'string' ? s.trailerQuote.trim() : '';
    if (!q) continue;
    quoted.add(slug);
    quotes.push(q);
    attributions.push(`from ${s.title} · ${s.author}`);
  }

  const texts = [];
  for (const [slug, thread] of Object.entries(comments || {})) {
    if (!quoted.has(slug)) continue;
    for (const c of Object.values(thread || {})) {
      if (!c || typeof c !== 'object') continue;
      if (!isScreenable({ text: c.text, parentId: c.parentId, hasTrailerQuote: true })) continue;
      texts.push(String(c.text).trim());
    }
  }

  if (quotes.length === 0) throw new Error('no live trailer quotes — nothing to measure');
  if (texts.length === 0) {
    throw new Error(
      `no live comment clears the ${VOICE_MIN_CHARS}-character floor, so this suite has nothing to fit.`);
  }
  return { quotes, attributions, comments: texts };
}
