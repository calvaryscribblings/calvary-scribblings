// WHAT COUNTS AS OPENING PROSE — the pure half, over plain data.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────
//
// app/lib/dropcap.js has, since R9.3, held the only correct answer in this codebase
// to "which paragraph is the story actually starting at?" — a class-driven exclusion
// list plus a front-matter walk, both measured against all 162 live story bodies and
// both guarded by tests/ci/dropcap-openers.test.mjs.
//
// The preview cutter needs exactly that answer, for a different reason: a preview
// whose 30% budget is spent on two content warnings and an epigraph has shown the
// reader nothing. Reimplementing the walk would mean two lists of marker classes
// drifting apart, and the one that drifts silently is the one nobody is looking at.
//
// So the rules move HERE and both callers import them. But dropcap.js walks a LIVE
// DOM (it tags elements and re-tags them under a MutationObserver) and the cutter
// runs in bare Node and in a Cloudflare Worker, neither of which has a DOM. The
// rules therefore operate on a plain-object BLOCK, and each caller supplies its own
// adapter:
//
//   dropcap.js          DOM element  → blockFromElement()  (in that file)
//   htmlBlocks.js       HTML string  → parseBlocks()
//
// No imports, so `node --test`, the static-export build and a Worker can all take
// it — the same rule app/lib/membership.js and app/lib/storyAccess.js already keep.
//
// ── THE BLOCK SHAPE ──────────────────────────────────────────────────────────────
//
//   {
//     tag:        'p',                     // lowercase element name
//     classes:    ['intro-note'],          // own classes, no dot prefix
//     text:       'Content note: …',       // textContent, untrimmed is fine
//     hasImg:     false,                   // an <img> anywhere inside
//     ancestors:  [{ tag: 'blockquote', classes: [] }],   // nearest-first
//     soleChild:  { tag: 'em', textLength: 41 } | null,   // exactly one element child
//   }
//
// Every field is required. An adapter that cannot supply one is an adapter that
// will disagree with the other adapter, which is the failure this file exists to
// prevent.

// ── EXCLUSIONS ───────────────────────────────────────────────────────────────────
// MOVED VERBATIM from dropcap.js. Every entry was observed in live content or
// asserted against it; see that file's note and tests/ci/dropcap-openers.test.mjs,
// which cross-references this list with the opener inventory emitted by
// scripts/audit-story-openers.mjs. A class that starts appearing at the top of story
// bodies and is in neither this list nor that test's PROSE set is a TEST FAILURE,
// not a rendered surprise — a class-driven list goes stale silently, so the
// staleness is what gets tested.
//
// Split into tags and classes because a plain-object block cannot run
// `.closest('blockquote, .intro-note')`. Both are matched against the block AND its
// ancestors, which is what `.closest()` did and what makes `blockquote > p` work:
// an epigraph's inner paragraph must not be the drop cap and must not open a
// preview.
//
// Headings are absent because they cannot occur — the callers only ever offer
// paragraphs. Do not "helpfully" add h2/h3; it would read as though the list were
// doing work it is not.
export const EXCLUDED_TAGS = ['blockquote', 'figure', 'figcaption', 'li'];

export const EXCLUDED_CLASSES = [
  'intro-note',            // observed live: CHAFF's section markers, content notes
  'section-break',
  'poem-numeral',          // observed live
  'poem-title',
  'poem-collection-intro',
  'poem-contents',
  'poem-stanza',           // verse lines are <p> children of the stanza block
  'image-caption',
  'inline-image-caption',
  'article-image',         // observed live
  'features-list',
];

/** The selector list dropcap.js still needs for its own querySelectorAll/.closest. */
export const EXCLUDED_SELECTOR = [
  ...EXCLUDED_TAGS,
  ...EXCLUDED_CLASSES.map((c) => `.${c}`),
].join(', ');

const FRONTMATTER_RE = /^(content note|content warning|cw|trigger warning|tw|author's note|note|dedication|epigraph)[:\s—–-]/i;
// A line that ends on sentence-ending punctuation reads as prose, not a bare
// label — closing quotes after the terminal mark still count as terminated.
const TERMINATED_RE = /[.!?…]['"”’]*$/;
// Anything left over after stripping ONE terminal mark. "Drip. Drip. Drip." has marks
// inside it and is real prose; "I." and "My Dream Man" do not and are labels.
const INTERNAL_TERMINAL_RE = /[.!?…]/;

/**
 * Structurally excluded — this block cannot open a story on any surface.
 *
 * Matches the block itself OR any ancestor, which is what `.closest()` did.
 *
 * The `hasImg` clause also catches a prose paragraph with an image inline in it,
 * which is a deliberate trade inherited from R9.3: such a paragraph cannot carry a
 * sane floated cap anyway, and the walk simply moves to the next one.
 */
export function isExcludedBlock(block) {
  const b = block || {};
  if (b.hasImg) return true;

  const chain = [{ tag: b.tag, classes: b.classes || [] }, ...(b.ancestors || [])];
  for (const node of chain) {
    if (EXCLUDED_TAGS.includes(String(node.tag || '').toLowerCase())) return true;
    for (const c of node.classes || []) {
      if (EXCLUDED_CLASSES.includes(c)) return true;
    }
  }
  return false;
}

// ── THE FAIL-SAFE (R9.3, rider 2) ────────────────────────────────────────────────
// The exclusion list above is class-driven, so it goes stale the day the CMS gains a
// marker class nobody added here. This rule is the class-blind backstop: a very short
// paragraph of no more than three words, carrying at most one terminal mark, is a
// label — a numeral, a section marker, a title — whatever class it happens to wear.
//
// THE WORD COUNT IS LOAD-BEARING AND WAS MEASURED, NOT GUESSED. The rider as first
// written was "under ~40 chars AND no sentence-ending punctuation beyond a single
// terminal mark". Run against all 162 live story bodies that clause alone demotes
// five real prose openers, because plenty of stories open on a short, properly-
// punctuated sentence:
//
//     "The scream ripped through the spa."      village-people          (34 chars)
//     "Dayo was afraid of the number thirteen." the-number-thirteen     (39 chars)
//     "There is a new anthem now."              red-white-red
//     "People worship their 9-to-5s."           5-to-9
//     "Nobody talks about the grief."           a-heart-trained-for-battle
//
// Adding `words <= 3` separates those from the labels cleanly. With it, the rule
// fires on exactly six live paragraphs — "war", "Inspiration", "Him", "My Dream Man",
// "A prose poem.", "Introduction" — every one of them a title or a note, and none of
// them a story's opening line. Re-measure before widening the threshold; the margin
// here is two words.
export function isMarkerish(text) {
  const t = String(text || '').trim();
  if (t.length >= 40) return false;
  if (t.split(/\s+/).filter(Boolean).length > 3) return false;
  return !INTERNAL_TERMINAL_RE.test(t.replace(TERMINATED_RE, ''));
}

/** A block whose entire visible content is one <em>/<i> — an epigraph in italics. */
export function isEntirelyItalic(block) {
  const b = block || {};
  const t = String(b.text || '').trim();
  if (!t) return false;
  const only = b.soleChild;
  if (!only) return false;
  const tag = String(only.tag || '').toLowerCase();
  return (tag === 'em' || tag === 'i') && (only.textLength || 0) >= t.length * 0.9;
}

/**
 * Front matter — real markup, but not where the story starts. Content notes,
 * epigraphs, section numerals, standalone titles.
 *
 * `next` is the following CANDIDATE block (already past isExcludedBlock), or null.
 * The last clause uses it: a short unterminated line followed by something longer is
 * a heading over a paragraph.
 */
export function isFrontmatterBlock(block, next) {
  const b = block || {};
  const t = String(b.text || '').trim();
  if (!t) return false;
  if (FRONTMATTER_RE.test(t)) return true;
  if (isEntirelyItalic(b)) return true;
  if (isMarkerish(t)) return true;
  if (t.length < 40 && !TERMINATED_RE.test(t)) {
    const nextText = String((next && next.text) || '').trim();
    if (nextText.length > t.length) return true;
  }
  return false;
}

/**
 * THE WALK. Given every candidate block in order, where does the prose start?
 *
 *   { frontmatter: [indices], targetIndex: number | null }
 *
 * `targetIndex` is null when everything read as front matter. dropcap.js renders no
 * cap in that case (silent, not broken — the old code fell back to blocks[0], which
 * is precisely how a section numeral got capped); the preview cutter treats it as
 * "no prose to budget" and falls back to including the first block, because a
 * preview of nothing is worse than a preview of an epigraph.
 *
 * Indices are into the array passed in — callers hold their own mapping back to
 * elements or HTML.
 */
export function walkToProse(blocks) {
  const list = blocks || [];
  const frontmatter = [];
  for (let i = 0; i < list.length; i++) {
    if (isFrontmatterBlock(list[i], list[i + 1] || null)) { frontmatter.push(i); continue; }
    return { frontmatter, targetIndex: i };
  }
  return { frontmatter, targetIndex: null };
}

// ── THE PUNCTUATION GUARD ────────────────────────────────────────────────────────
// If the opening prose does not begin on a letter, dropcap renders no cap at all.
// Exported here because it is part of "what is opening prose", and because the
// cutter's tests assert the two files agree about the same eight live stories.
// See dropcap.js for the measured browser behaviour that forces this.
export const OPENS_ON_LETTER = /^\p{L}/u;
