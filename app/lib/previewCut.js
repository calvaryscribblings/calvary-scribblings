// THE PREVIEW CUTTER — how much of a gated story a reader is shown.
//
// Pure, no imports beyond the two sibling modules that are themselves pure, so this
// runs in the composer (browser), the audit script (bare Node) and the serving
// endpoint (a Cloudflare Worker) with one implementation. See
// STORY-SERVING-CONTRACT.md §4.2, which this file IS.
//
// ── THE SHAPE OF THE DECISION ────────────────────────────────────────────────────
//
//   1. Split the body into top-level blocks, REFUSING anything malformed (htmlBlocks).
//   2. Decide which blocks are prose and which are front matter (prosePredicate) —
//      the same rules the drop-cap tagger uses, imported, not copied.
//   3. Budget 30% of the PROSE blocks, rounded up, min 1, capped at total-1.
//   4. If the last included block dangles, advance exactly one. Once.
//   5. Emit the prefix verbatim.
//
// The preview is always a PREFIX of the original source — the block HTML is sliced,
// never re-serialised. Nothing is rewritten, nothing is summarised, no ellipsis is
// invented. Whatever the reader sees is the story's own opening words in the story's
// own markup, which is the only version of this that stays honest as the CMS grows
// markup we did not anticipate.

import { parseBlocks } from './htmlBlocks.js';
import { isExcludedBlock, isFrontmatterBlock } from './prosePredicate.js';

/** 30%. The one number, named once. */
export const PREVIEW_FRACTION = 0.30;

// ── DANGLING CONNECTIVES ─────────────────────────────────────────────────────────
//
// A 30% cut lands wherever it lands. Where it lands on a block that does not
// FINISH — one ending on a conjunction, a preposition, a comma, a colon, an em dash,
// an ellipsis — the preview stops the reader mid-thought. That is not a cliffhanger,
// it is a stutter, and it reads as a bug rather than as an invitation.
//
// THE ADVANCE IS ONE BLOCK. ONCE. NEVER TWICE. This is the whole discipline of the
// rule and the reason it is written as a single `if` rather than a `while`: a loop
// that kept advancing until it found a satisfying ending would, on a story written
// in long chained sentences, walk most of the way to the end and give the archive
// away one comma at a time. One step turns a stutter into a stop. If the block after
// it also dangles the reader gets a slightly awkward break — a far cheaper failure
// than an unbounded preview.
const TRAILING_PUNCT_RE = /[,;:—–-]$|\.{3}$|…$/;

// Words that cannot end a thought. Deliberately a closed list of function words
// rather than a part-of-speech guess: every entry here is a word that is ALWAYS
// followed by more, in any sentence it appears at the end of.
const DANGLING_WORDS = new Set([
  // coordinating and subordinating conjunctions
  'and', 'but', 'or', 'nor', 'yet', 'so', 'for',
  'because', 'although', 'though', 'while', 'whilst', 'whereas', 'unless',
  'until', 'till', 'since', 'if', 'when', 'whenever', 'where', 'wherever',
  'as', 'than', 'that', 'whether', 'once', 'before', 'after',
  // prepositions
  'of', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto',
  'upon', 'about', 'over', 'under', 'through', 'between', 'among', 'across',
  'against', 'toward', 'towards', 'without', 'within', 'behind', 'beneath',
  'beside', 'beyond', 'during', 'despite',
  // determiners and pronouns that must be followed by their noun
  'the', 'a', 'an', 'my', 'his', 'her', 'their', 'its', 'our', 'your',
  'this', 'these', 'those', 'every', 'each', 'some', 'any', 'no',
  // auxiliaries left hanging
  'is', 'was', 'were', 'are', 'be', 'been', 'being', 'had', 'has', 'have',
  'will', 'would', 'could', 'should', 'might', 'must', 'can', 'did', 'does',
]);

/**
 * Does this block leave the reader mid-thought?
 *
 * Three ways, checked in order of how certain each is:
 *   - it ends on punctuation that promises continuation (comma, dash, colon, ellipsis)
 *   - its last word is a function word that is always followed by more
 *   - it opens a quotation it does not close (dialogue running across paragraphs)
 *
 * The unclosed-quote test counts straight and curly marks together, because story
 * bodies carry both and the eight-story apostrophe corpus in dropcap.js is proof
 * that assuming one form is how this codebase gets caught.
 */
export function isDangling(text) {
  const t = String(text || '').trim();
  if (!t) return true;

  if (TRAILING_PUNCT_RE.test(t)) return true;

  const last = (t.toLowerCase().match(/[\p{L}']+(?=[^\p{L}']*$)/u) || [''])[0];
  if (DANGLING_WORDS.has(last)) return true;

  // An odd number of double-quote marks means one is still open. Apostrophes are NOT
  // counted — they are overwhelmingly possessives and contractions in this corpus,
  // and counting them would mark almost every paragraph as dangling.
  const doubles = (t.match(/["“”]/g) || []).length;
  if (doubles % 2 === 1) return true;

  return false;
}

/**
 * Cut a story body to its preview.
 *
 *   { html, prose, total }
 *
 *     html   the preview source — a verbatim prefix of `body`
 *     prose  how many PROSE blocks it contains (what the budget was computed against)
 *     total  how many prose blocks the whole body has
 *
 * THROWS MalformedHtmlError (from htmlBlocks) if the body cannot be proven
 * well-formed. That is the hard gate: it does not patch, it does not close tags it
 * did not open, it does not fall back to a character slice, and above all it does
 * not fall back to the full body — a body that failed validation would otherwise
 * become a paywall bypass, and the worse the markup the more reliably it would work.
 */
export function cutPreview(body) {
  const blocks = parseBlocks(body);
  if (!blocks.length) return { html: '', prose: 0, total: 0 };

  // Which blocks count. Structural exclusions first (blockquote, figure, .intro-note
  // …), exactly as the drop-cap tagger drops them before its walk. Then the
  // front-matter heuristics over what survives, with `next` taken from the surviving
  // list so the "short line followed by a longer one" rule sees what it expects.
  const survivors = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!isExcludedBlock(blocks[i])) survivors.push(i);
  }

  const isProse = new Array(blocks.length).fill(false);
  for (let s = 0; s < survivors.length; s++) {
    const i = survivors[s];
    const next = s + 1 < survivors.length ? blocks[survivors[s + 1]] : null;
    if (!isFrontmatterBlock(blocks[i], next)) isProse[i] = true;
  }

  const proseIdx = [];
  for (let i = 0; i < blocks.length; i++) if (isProse[i]) proseIdx.push(i);
  const total = proseIdx.length;

  // Everything read as front matter or was excluded. A preview of nothing is worse
  // than a preview of an epigraph, so the first block goes out and the counts say
  // honestly that there was no prose to budget.
  if (!total) {
    return { html: blocks[0].html, prose: 0, total: 0 };
  }

  // ── the budget ──────────────────────────────────────────────────────────────
  // Rounded UP so a three-paragraph story previews one paragraph rather than none.
  // Capped at total-1 so a preview is never silently the entire story — a one-prose-
  // block story therefore previews zero prose blocks and falls to the floor below.
  let take = Math.max(1, Math.ceil(total * PREVIEW_FRACTION));
  take = Math.min(take, Math.max(1, total - 1));

  // ── the one-block advance ───────────────────────────────────────────────────
  if (isDangling(blocks[proseIdx[take - 1]].text) && take < total - 1) take += 1;

  // The cut lands AFTER the last included prose block, carrying with it any
  // front-matter or excluded blocks that sit before it — an epigraph belongs with
  // the opening it introduces, and it cost the reader none of their budget.
  const end = proseIdx[take - 1];
  const html = blocks.slice(0, end + 1).map((b) => b.html).join('\n');

  return { html, prose: take, total };
}
