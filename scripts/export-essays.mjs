// Export the canonical text of named essays from the live database.
//
//   node scripts/export-essays.mjs            # the ten by TITLE  → essays-export.md
//   node scripts/export-essays.mjs --slugs    # the three by KEY  → essays-export-2.md
//   node scripts/export-essays.mjs --slugs=a,b,c
//
// READ ONLY, BY CONSTRUCTION AND BY ASSERTION. This script issues GETs against the
// RTDB REST API and writes exactly one file, to the local filesystem, outside git.
// It touches no database node. Before it reads anything it slices its OWN source and
// refuses to run if a write verb appears in it — so the guarantee is checked at run
// time against the bytes actually executing, not promised in a comment that a later
// edit could quietly falsify.
//
// That assertion is why this file builds its output by string concatenation and uses
// plain objects rather than Maps, and appends to arrays by index: the array and Map
// write verbs are spelled exactly like the database ones, and a check that had to
// carve out exceptions for them would be a check with a hole in it. Avoiding the
// verbs entirely costs nothing here and leaves the assertion absolute.
//
// ── THE TWO MODES, AND WHY THEY FAIL DIFFERENTLY ─────────────────────────────────
//
// TITLE MODE resolves ten essays by a normalised title. A near-miss is left NOT FOUND
// with its three nearest neighbours printed, because picking one would be a guess.
// It exits 1 on a partial export so a file with gaps cannot pass for a complete one.
//
// SLUG MODE takes exact keys that a human has already confirmed. There is nothing
// left to guess, so there is nothing to report as a gap: a key that is absent, or a
// record whose `published` flag is not exactly true, is a LOUD FAILURE. It is
// detected in a preflight, BEFORE the body reads and BEFORE the file is opened, so a
// failed run leaves no half-written export on disk to be mistaken for a good one.
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
// ── THE BODY IS COPIED, NOT PROCESSED ────────────────────────────────────────────
// The body is written to the file verbatim. No tag stripping, no entity decoding, no
// reflow, no markdown conversion, no whitespace collapse, no tidying of inline style
// attributes. The stored markup IS the artefact, defects included — the fingerprint
// below exists so those defects can be counted and planned for, never so they can be
// quietly corrected on the way out. Word counts and fingerprints are computed on
// THROWAWAY copies; the copy that reaches the file is the copy that came off the wire.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SELF = resolve(__dirname, 'export-essays.mjs');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const SEP = '=========='; // ten equals signs, per the brief

/** Title mode: the ten, in the order they must appear in the file. */
const WANTED_TITLES = [
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

/**
 * Slug mode: the three that title matching left unresolved, identified by a human
 * and confirmed on 28 Aug 2026. These are exact RTDB keys and are looked up as such
 * — there is no fuzzy fallback in this mode, deliberately.
 */
const WANTED_SLUGS = [
  'become-a-content-creator-the-step-by-step-guide',
  'why-ai-will-take-your-job-and-here-s-what-you-can-do-about-it',
  'when-the-technology-becomes-the-scene-the-case-of-ai',
];

const SLUG_ARG = process.argv.find((a) => a.startsWith('--slugs='));
const MODE = SLUG_ARG || process.argv.includes('--slugs') ? 'slugs' : 'titles';
const SLUGS = SLUG_ARG
  ? SLUG_ARG.slice('--slugs='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : WANTED_SLUGS;

const OUT = resolve(ROOT, MODE === 'slugs' ? 'essays-export-2.md' : 'essays-export.md');
const OUT_NAME = MODE === 'slugs' ? 'essays-export-2.md' : 'essays-export.md';

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
  console.log(`  filesystem writes   ${fsWrites} (expected exactly 1: ${OUT_NAME})`);
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

// ── title matching (title mode only) ─────────────────────────────────────────────

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

/**
 * Block-level elements that are not legal children of <p>. An open <p> is closed
 * implicitly by any of these, so a <p> containing one does not mean in the DOM what
 * it looks like in the source — which is exactly the class of defect that survives a
 * copy-paste into a typesetter and then moves the text.
 */
const NOT_IN_P = ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'ul', 'ol', 'li', 'figure', 'figcaption', 'table', 'hr', 'pre', 'section', 'article'];

/**
 * A one-line markup census, for planning normalisation. Diagnostic only — it reads a
 * throwaway copy and changes nothing.
 *
 * The nesting scan is a regex over `<p …> … </p>` spans, not a parser, so an unclosed
 * <p> makes its span run to the next `</p>`. That over-reports rather than under-
 * reports, which is the right way round for a defect count you are going to act on.
 */
function fingerprint(html) {
  const s = String(html || '');
  const tally = (re) => (s.match(re) || []).length;

  const counts = {
    p: tally(/<p[\s>]/gi),
    h3: tally(/<h3[\s>]/gi),
    em: tally(/<em[\s>]/gi),
    img: tally(/<img[\s>]/gi),
    figcaption: tally(/<figcaption[\s>]/gi),
    div: tally(/<div[\s>]/gi),
    br: tally(/<br\s*\/?>/gi),
  };

  const nested = Object.create(null);
  for (const span of s.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []) {
    const inner = span.replace(/^<p\b[^>]*>/i, '').replace(/<\/p>$/i, '');
    for (const tag of NOT_IN_P) {
      const n = (inner.match(new RegExp(`<${tag}[\\s>/]`, 'gi')) || []).length;
      if (n) nested[tag] = (nested[tag] || 0) + n;
    }
  }

  const styleAttrs = tally(/\sstyle\s*=/gi);
  const classAttrs = tally(/\sclass\s*=/gi);

  const nestedText = Object.keys(nested).length
    ? Object.entries(nested).map(([t, n]) => `${t}×${n}`).join(',')
    : 'none';

  const tagText = Object.entries(counts).map(([t, n]) => `${t}:${n}`).join(' ');

  return {
    counts,
    nested,
    styleAttrs,
    classAttrs,
    line: `${tagText} | nested-in-p: ${nestedText} | inline style attrs: ${styleAttrs ? `YES ×${styleAttrs}` : 'none'} | class attrs: ${classAttrs}`,
  };
}

const isoOf = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

const statusOf = (rec) => (rec.published === false ? 'NOT PUBLISHED' : 'published');

const bylineOf = (rec) =>
  `${rec.author || '(none)'}${rec.authorHandle ? ` (@${rec.authorHandle})` : ''}`;

const categoryOf = (rec) =>
  `${rec.category || ''}${rec.categoryName ? ` / ${rec.categoryName}` : ''}${rec.subcategory ? ` / ${rec.subcategory}` : ''}`;

// ── resolution ───────────────────────────────────────────────────────────────────

/** Title mode: normalised match, near-misses left unresolved. */
function resolveByTitle(records) {
  return WANTED_TITLES.map((wanted) => {
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
}

/**
 * Slug mode: exact key lookup, then a hard preflight.
 *
 * Absent key or `published !== true` aborts here, before any body is read and before
 * the output file is opened. The brief is explicit that a missing record is a failure
 * rather than a manifest note, and an abort that happens after the file exists would
 * be a note in a file, which is the thing being ruled out.
 */
function resolveBySlug(all) {
  const items = SLUGS.map((slug) => ({
    wanted: slug,
    slug,
    rec: Object.prototype.hasOwnProperty.call(all, slug) ? all[slug] : null,
  }));

  const absent = items.filter((x) => !x.rec || typeof x.rec !== 'object');
  const unpublished = items.filter((x) => x.rec && x.rec.published !== true);

  if (absent.length || unpublished.length) {
    console.error('\nPREFLIGHT FAILED — nothing was written.');
    for (const a of absent) console.error(`  ABSENT        cms_stories/${a.slug} does not exist`);
    for (const u of unpublished) {
      console.error(`  NOT PUBLISHED ${u.slug}  published=${JSON.stringify(u.rec.published)}  "${u.rec.title}"`);
    }
    console.error(`\n${absent.length} absent, ${unpublished.length} not published. Exiting 1.`);
    process.exit(1);
  }

  return items.map((x) => ({ ...x, found: true }));
}

async function main() {
  await assertReadOnly();
  console.log(`\nMODE  ${MODE} → ${OUT_NAME}`);

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
  console.log(`READ  cms_stories: ${Object.keys(all).length} records`);

  const resolved = MODE === 'slugs'
    ? resolveBySlug(all)
    : resolveByTitle(Object.entries(all).map(([slug, rec]) => ({
        slug, rec, key: flatTitle(rec?.title),
      })));

  if (MODE === 'slugs') console.log(`PREFLIGHT OK — all ${resolved.length} keys present and published===true`);

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
    item.fp = fingerprint(item.body);
  }

  const found = resolved.filter((x) => x.found);

  // ── build the file ───────────────────────────────────────────────────────────
  let out = '';
  const say = (line = '') => { out += `${line}\n`; };

  say('# Calvary Scribblings — essay export');
  say();
  say(`Exported ${new Date().toISOString()} from \`cms_stories\` / \`story_bodies\`. Read only.`);
  say(MODE === 'slugs'
    ? 'Resolved by EXACT SLUG — human-confirmed keys, no fuzzy matching.'
    : 'Resolved by normalised TITLE. Near-misses are left unresolved.');
  say('Bodies are the stored HTML, verbatim — no tags stripped, nothing reflowed, no inline styles tidied.');
  say();
  say('## Manifest');
  say();
  say(`**${found.length} of ${resolved.length} found.**`);
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
    say(`### ${rec.title}`);
    say();
    say(`- slug: \`${item.slug}\``);
    say(`- author: ${bylineOf(rec)}`);
    say(`- published flag: ${JSON.stringify(rec.published)} (${statusOf(rec)})`);
    say(`- publishedAt: ${isoOf(rec.publishedAtMs) || '(no publishedAtMs)'} — display date "${rec.date || ''}"`);
    say(`- updatedAt: not stored on this schema${rec.epubUpdatedAt ? ` (epubUpdatedAt = ${rec.epubUpdatedAt})` : ''}`);
    say(`- category: ${categoryOf(rec)}`);
    say(`- word count: ${item.words}`);
    say(`- body read from: ${item.bodySource}${item.copiesAgree === false ? ' — ⚠ DISAGREES with cms_stories.content' : ''}`);
    say(`- markup: ${item.fp.line}`);
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
    say(`- published flag: ${JSON.stringify(rec.published)} (${statusOf(rec)})`);
    say(`- publishedAt: ${isoOf(rec.publishedAtMs) || '(none)'} — "${rec.date || ''}"`);
    say('- updatedAt: not stored on this schema');
    say(`- category: ${categoryOf(rec)}`);
    say(`- words: ${item.words}`);
    say(`- source node: ${item.bodySource}`);
    say(`- markup: ${item.fp.line}`);
    say();
    out += item.body;   // verbatim, untouched — not routed through say()
    say();
    say();
  }

  await writeFile(OUT, out, 'utf8');

  // ── the summary ──────────────────────────────────────────────────────────────
  const size = (await stat(OUT)).size;
  const totalWords = found.reduce((n, x) => n + (x.words || 0), 0);
  const unpublished = found.filter((x) => x.rec.published !== true);
  const disagree = found.filter((x) => x.copiesAgree === false);
  const missing = resolved.filter((x) => !x.found);

  console.log('\nMARKUP FINGERPRINTS');
  for (const item of found) console.log(`  ${item.slug}\n    ${item.fp.line}`);

  console.log('\nSUMMARY');
  console.log(`  found            ${found.length} of ${resolved.length}`);
  console.log(`  total words      ${totalWords}`);
  console.log(`  file             ${OUT_NAME}  ${(size / 1024).toFixed(1)} KB`);

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

  if (found.length < resolved.length) {
    console.error(`\nEXIT 1 — partial export: ${found.length}/${resolved.length}. This file is NOT complete.`);
    process.exit(1);
  }
  console.log('\nComplete: all requested essays exported.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
