// Export the canonical text of ten named essays to essays-export.md at the repo root.
//
//   node scripts/export-essays.mjs
//
// READ ONLY, BY CONSTRUCTION AND BY ASSERTION. This script issues GETs against the
// RTDB REST API and writes exactly one file, to the local filesystem, outside git.
// It touches no database node. Before it reads anything it slices its OWN source and
// refuses to run if a write verb appears in it — so the guarantee is checked at run
// time against the bytes actually executing, not promised in a comment that a later
// edit could quietly falsify.
//
// That assertion is why this file builds its output by string concatenation and uses
// plain objects rather than Maps: the array and Map write verbs are spelled the same
// as the database ones, and a check that had to carve out exceptions for them would
// be a check with a hole in it. Avoiding the verbs entirely costs nothing here and
// leaves the assertion absolute.
//
// ── SCHEMA, VERIFIED AGAINST THE LIVE NODE ───────────────────────────────────────
// cms_stories/<slug> carries the metadata: title, author, authorHandle, category,
// categoryName, subcategory, date, publishedAtMs, published, url, content.
// story_bodies/<slug> carries { content, extractedText } and is `.read: false` — it
// is the node functions/api/_story-body.js reads, so it is the canonical body and is
// what this script prefers. Phase T3 has not run, so cms_stories.content still holds
// the same bytes; the two are compared and any disagreement is REPORTED, never
// silently reconciled.
//
// THERE IS NO `updatedAt` AND NO `status` FIELD ON THIS SCHEMA. Status is the boolean
// `published`. The only update stamp in the data is `epubUpdatedAt`, on 4 of 195
// records. Both are printed as they are; neither is synthesised.
//
// ── MATCHING ─────────────────────────────────────────────────────────────────────
// Titles are compared case-insensitively, with punctuation and a leading article
// stripped. A title that does not match EXACTLY under that rule is left NOT FOUND and
// its three nearest records are printed for a human to look at. Two records sharing a
// normalised title is ALSO not found — that is precisely the case where choosing one
// is a guess. Nothing is resolved by guessing: a wrong essay silently substituted is
// worse than a visible gap.
//
// ── THE BODY IS COPIED, NOT PROCESSED ────────────────────────────────────────────
// The body is written to the file verbatim. No tag stripping, no entity decoding, no
// reflow, no markdown conversion, no whitespace collapse. The stored HTML carries the
// italics, blockquotes and inline markup, which is the part of an essay a naive
// export destroys. Word counts are computed on a THROWAWAY copy; the copy that
// reaches the file is the copy that came off the wire.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SELF = resolve(__dirname, 'export-essays.mjs');
const OUT = resolve(ROOT, 'essays-export.md');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const SEP = '=========='; // ten equals signs, per the brief

/** The ten, in the order they must appear in the file. */
const WANTED = [
  'Become a Content Creator',
  'Where We Begin the Story',
  'What Are Cookies and Should You Accept Them?',
  'Why AI Will Take Your Job and What You Should Do About It',
  'Racial Representation in Film',
  'The Outrage Is Never Equal',
  'Tilting Scales',
  'The Iron and the Wood',
  'When Technology Becomes the Scene',
  'This Is Nigeria',
];

// ── the read-only assertion ──────────────────────────────────────────────────────
//
// Each needle is assembled from fragments so that the literal string does not appear
// anywhere in this file — otherwise the check would trip on its own definition, and
// the only way to make it pass would be to weaken it. The label is derived from the
// pieces at run time for the same reason.
const FORBIDDEN = [
  ['s', 'et('],
  ['up', 'date('],
  ['pu', 'sh('],
  ['re', 'move('],
  ['transa', 'ction('],
  ['de', 'lete '],
  ["'P", "UT'"],
  ["'PA", "TCH'"],
  ["'PO", "ST'"],
  ["'DE", "LETE'"],
  ['un', 'link('],
  ['w', 'riteBatch'],
  ['ref', '.child'],
];

/**
 * Slice this file's own source and prove no write verb is in it.
 *
 * `writeFile` is the single deliberate exception — the export has to land somewhere —
 * and it is asserted to appear exactly once, so a second one cannot be slipped in.
 */
async function assertReadOnly() {
  const src = await readFile(SELF, 'utf8');

  const hits = FORBIDDEN.flatMap((pieces) => {
    const needle = pieces.join('');
    const found = [];
    let at = src.indexOf(needle);
    while (at !== -1) {
      found[found.length] = { needle, line: src.slice(0, at).split('\n').length };
      at = src.indexOf(needle, at + 1);
    }
    return found;
  });

  const fsWrites = (src.match(/writeFile\(/g) || []).length;

  console.log('READ-ONLY ASSERTION');
  console.log(`  source scanned      ${src.length} bytes of scripts/export-essays.mjs`);
  console.log(`  verbs searched      ${FORBIDDEN.map((p) => p.join('')).join('  ')}`);
  console.log(`  write verbs found   ${hits.length}`);
  for (const h of hits) console.log(`    !! "${h.needle}" at line ${h.line}`);
  console.log(`  filesystem writes   ${fsWrites} (expected exactly 1: essays-export.md)`);
  console.log(`  verdict             ${hits.length === 0 && fsWrites === 1 ? 'NO DATABASE WRITE IS POSSIBLE' : 'FAILED'}`);

  if (hits.length !== 0) {
    console.error('\nRefusing to run: a write verb is present in a script declared read-only.');
    process.exit(2);
  }
  if (fsWrites !== 1) {
    console.error(`\nRefusing to run: expected exactly one filesystem write, found ${fsWrites}.`);
    process.exit(2);
  }
}

// ── title matching ───────────────────────────────────────────────────────────────

/** Case-insensitive, punctuation-free, leading article dropped. */
function flatTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")        // curly quotes → straight, before punctuation goes
    .replace(/[^a-z0-9 ]+/g, ' ')   // drop all punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .trim();
}

/**
 * Dice coefficient over character bigrams — a stable, dependency-free similarity,
 * used ONLY to rank near-misses for a human. It never resolves a match.
 */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const counts = Object.create(null);
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      counts[g] = (counts[g] || 0) + 1;
    }
    return counts;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  let total = 0;
  for (const n of Object.values(ga)) total += n;
  for (const [g, n] of Object.entries(gb)) {
    total += n;
    shared += Math.min(n, ga[g] || 0);
  }
  return (2 * shared) / total;
}

// ── formatting helpers ───────────────────────────────────────────────────────────

/** Word count on a THROWAWAY copy. The exported body is never touched by this. */
function wordCount(html) {
  const text = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.split(' ').length : 0;
}

const isoOf = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

const statusOf = (rec) => (rec.published === false ? 'NOT PUBLISHED' : 'published');

const bylineOf = (rec) =>
  `${rec.author || '(none)'}${rec.authorHandle ? ` (@${rec.authorHandle})` : ''}`;

const categoryOf = (rec) =>
  `${rec.category || ''}${rec.categoryName ? ` / ${rec.categoryName}` : ''}${rec.subcategory ? ` / ${rec.subcategory}` : ''}`;

async function main() {
  await assertReadOnly();

  // ── credentials: the established scripts/ pattern, unchanged ───────────────────
  // serviceAccountKey.json at the repo root, an OAuth token minted from it, and the
  // RTDB REST API rather than the admin websocket — same as backfill-stories-index.
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const token = (await cert(svc).getAccessToken()).access_token;

  // cms_stories is world-readable; this GET is deliberately unauthenticated, as in
  // every other script here.
  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) {
    console.error(`\ncms_stories read failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const all = await res.json();
  if (!all || typeof all !== 'object') {
    console.error('\ncms_stories is empty.');
    process.exit(1);
  }

  const records = Object.entries(all).map(([slug, rec]) => ({
    slug,
    rec,
    key: flatTitle(rec?.title),
  }));
  console.log(`\nREAD  cms_stories: ${records.length} records`);

  // ── resolve the ten ───────────────────────────────────────────────────────────
  const resolved = WANTED.map((wanted) => {
    const key = flatTitle(wanted);
    const exact = records.filter((x) => x.key === key);

    if (exact.length === 1) {
      return { wanted, found: true, slug: exact[0].slug, rec: exact[0].rec };
    }

    const near = records
      .map((x) => ({ slug: x.slug, title: x.rec?.title, score: similarity(key, x.key) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      wanted,
      found: false,
      reason: exact.length > 1
        ? `AMBIGUOUS — ${exact.length} records normalise to this title`
        : 'no exact match',
      near,
    };
  });

  // ── fetch bodies from the canonical (gated) node ──────────────────────────────
  for (const item of resolved) {
    if (!item.found) continue;

    const url = `${DB_URL}/story_bodies/${encodeURIComponent(item.slug)}.json`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const legacy = typeof item.rec.content === 'string' ? item.rec.content : '';

    if (!r.ok) {
      console.error(`  story_bodies read failed for ${item.slug}: HTTP ${r.status} — falling back to cms_stories`);
      item.body = legacy;
      item.bodySource = 'cms_stories (story_bodies unreadable)';
      item.copiesAgree = null;
    } else {
      const rec = await r.json();
      const gated = typeof rec?.content === 'string' ? rec.content : null;
      if (gated === null) {
        item.body = legacy;
        item.bodySource = 'cms_stories (no story_bodies record)';
        item.copiesAgree = null;
      } else {
        item.body = gated;                 // canonical, verbatim
        item.bodySource = 'story_bodies';
        item.copiesAgree = gated === legacy;
      }
    }
    item.words = wordCount(item.body);
  }

  const found = resolved.filter((x) => x.found);

  // ── build the file ───────────────────────────────────────────────────────────
  let out = '';
  const say = (line = '') => { out += `${line}\n`; };

  say('# Calvary Scribblings — essay export');
  say();
  say(`Exported ${new Date().toISOString()} from \`cms_stories\` / \`story_bodies\`. Read only.`);
  say('Bodies are the stored HTML, verbatim — no tags stripped, nothing reflowed or converted.');
  say();
  say('## Manifest');
  say();
  say(`**${found.length} of ${WANTED.length} found.**`);
  say();

  for (const item of resolved) {
    if (!item.found) {
      say(`### NOT FOUND — ${item.wanted}`);
      say();
      say(`Reason: ${item.reason}. Nearest three by title similarity, **left unresolved** —`);
      say();
      for (const n of item.near) say(`- \`${n.slug}\` — "${n.title}" (similarity ${n.score.toFixed(3)})`);
      say();
      continue;
    }
    const rec = item.rec;
    say(`### FOUND — ${rec.title}`);
    say();
    say(`- requested as: ${item.wanted}`);
    say(`- slug: \`${item.slug}\``);
    say(`- author: ${bylineOf(rec)}`);
    say(`- status: ${statusOf(rec)} (\`published\` = ${JSON.stringify(rec.published)})`);
    say(`- publishedAt: ${isoOf(rec.publishedAtMs) || '(no publishedAtMs)'} — stored display date "${rec.date || ''}"`);
    say(`- updatedAt: not stored on this schema${rec.epubUpdatedAt ? ` (epubUpdatedAt = ${rec.epubUpdatedAt})` : ''}`);
    say(`- category: ${categoryOf(rec)}`);
    say(`- word count: ${item.words}`);
    say(`- body read from: ${item.bodySource}${item.copiesAgree === false ? ' — ⚠ DISAGREES with cms_stories.content' : ''}`);
    say();
  }

  for (const item of resolved) {
    say(SEP);
    say();
    if (!item.found) {
      say(`## ${item.wanted}`);
      say();
      say('**NOT FOUND — no body exported.**');
      say();
      say(`No record matched this title (${item.reason}). The nearest three were:`);
      say();
      for (const n of item.near) say(`- \`${n.slug}\` — "${n.title}" (${n.score.toFixed(3)})`);
      say();
      continue;
    }
    const rec = item.rec;
    say(`## ${rec.title}`);
    say();
    say(`- slug: \`${item.slug}\``);
    say(`- author: ${bylineOf(rec)}`);
    say(`- status: ${statusOf(rec)}`);
    say(`- publishedAt: ${isoOf(rec.publishedAtMs) || '(none)'} — "${rec.date || ''}"`);
    say(`- updatedAt: not stored on this schema`);
    say(`- category: ${categoryOf(rec)}`);
    say(`- words: ${item.words}`);
    say(`- source node: ${item.bodySource}`);
    say();
    out += item.body;   // verbatim, untouched — not routed through say()
    say();
    say();
  }

  await writeFile(OUT, out, 'utf8');

  // ── the summary ──────────────────────────────────────────────────────────────
  const size = (await stat(OUT)).size;
  const totalWords = found.reduce((n, x) => n + (x.words || 0), 0);
  const unpublished = found.filter((x) => x.rec.published === false);
  const disagree = found.filter((x) => x.copiesAgree === false);
  const missing = resolved.filter((x) => !x.found);

  console.log('\nSUMMARY');
  console.log(`  found            ${found.length} of ${WANTED.length}`);
  console.log(`  total words      ${totalWords}`);
  console.log(`  file             essays-export.md  ${(size / 1024).toFixed(1)} KB`);

  if (missing.length) {
    console.log('\n  NOT FOUND — left as gaps, not guessed:');
    for (const m of missing) {
      console.log(`    ${m.wanted}  (${m.reason})`);
      for (const n of m.near) console.log(`        ${n.score.toFixed(3)}  ${n.slug}  "${n.title}"`);
    }
  }

  if (unpublished.length) {
    console.log('\n  NOT PUBLISHED:');
    for (const u of unpublished) {
      console.log(`    ${u.slug}  "${u.rec.title}"  published=${JSON.stringify(u.rec.published)}`);
    }
  } else {
    console.log('  status           every found record is published');
  }

  if (disagree.length) {
    console.log('\n  ⚠ story_bodies and cms_stories.content DISAGREE (the story_bodies copy was exported):');
    for (const d of disagree) console.log(`    ${d.slug}`);
  }

  if (found.length < WANTED.length) {
    console.error(`\nEXIT 1 — partial export: ${found.length}/${WANTED.length}. This file is NOT complete.`);
    process.exit(1);
  }
  console.log('\nComplete: all ten exported.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
