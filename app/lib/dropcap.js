'use client';
// Drop cap targeting — shared by the story page and the offline shelf reader.
//
// ── PROVENANCE ───────────────────────────────────────────────────────────────────────────
// This began as a VERBATIM MOVE out of app/stories/[slug]/page-client.js. R9.3 is the first
// round to change its behaviour, so the "nothing was improved in transit" note that used to
// stand here no longer applies and has been removed rather than left to mislead. What is
// still true: the story page and the shelf reader run THIS module, not a copy. Importing is
// the only arrangement in which the two cannot drift.
//
// ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────────
// The CSS ::first-letter rule cannot tell front-matter (content notes, epigraphs, section
// numerals) from the story proper, so the decision is made here: walk the body, pick the
// first paragraph that is genuinely opening prose, tag it .dropcap-target, and let
// app/lib/proseCSS.js hook `p.dropcap-target::first-letter`. Selects with querySelectorAll
// scoped to the prose container (so a story whose opening <p> is nested in a wrapper div is
// still found), and keeps a MutationObserver on the article: if React re-applies the body
// HTML (which would wipe the class) or the content arrives after the first pass, it re-tags.
// Idempotent — clears prior tags before each pass.
//
// ── WHAT R9.3 FIXED ──────────────────────────────────────────────────────────────────────
// The predicate was entirely class-blind: it read text only. CHAFF opens with
// <p class="intro-note">I.</p>, and "I." is short but *terminated*, so the old rule read it
// as a properly-finished sentence — prose — and floated a 4.2em "I." beside the opening
// paragraph. Nine other live stories were mis-capping for the punctuation reason below. The
// CMS worked around CHAFF by switching the markers to <h3>; that revert is safe once this
// ships, because querySelectorAll('p') never returns a heading either way.

// ── R11.8: THE RULES MOVED, THE BEHAVIOUR DID NOT ────────────────────────────────────────
// The exclusion list, the front-matter heuristics and the walk now live in
// app/lib/prosePredicate.js, over plain objects rather than DOM elements. Nothing about
// what gets tagged changed; what changed is that the PREVIEW CUTTER runs the same rules.
// A preview whose 30% budget is spent on two content warnings and an epigraph has shown
// the reader nothing, and a second copy of this list would drift from this one silently.
//
// This file keeps the DOM half — the querySelectorAll scope, the .closest() exclusion, the
// MutationObserver, and blockFromElement() below, which is the adapter from an element to
// the shape the predicate reads. See prosePredicate.js for the reasoning behind every rule,
// including the measurements that fixed the word count and the exclusion list.
import {
  EXCLUDED_SELECTOR,
  walkToProse,
  OPENS_ON_LETTER,
  EXCLUDED_TAGS,
  EXCLUDED_CLASSES,
} from './prosePredicate.js';

// Kept as a named export because tests/ci/dropcap-openers.test.mjs imports it by this name
// and asserts it against the live opener inventory. Rebuilt from the two lists rather than
// re-typed, so it cannot drift from what isExcludedBlock() actually matches.
export const DROPCAP_EXCLUDED_SELECTORS = [
  ...EXCLUDED_TAGS,
  ...EXCLUDED_CLASSES.map((c) => `.${c}`),
];

/**
 * A DOM element → the plain block the predicate reads.
 *
 * `ancestors` is left EMPTY on purpose: this file still does its structural exclusion with
 * .closest() against EXCLUDED_SELECTOR, before the walk, exactly as it always has. The
 * ancestor chain exists for the cutter's adapter, which has no .closest() to call.
 */
const blockFromElement = (p) => {
  const kids = Array.from(p.children);
  return {
    tag: p.tagName.toLowerCase(),
    classes: Array.from(p.classList || []),
    text: p.textContent || '',
    hasImg: !!p.querySelector('img'),
    ancestors: [],
    soleChild: kids.length === 1
      ? { tag: kids[0].tagName.toLowerCase(), textLength: (kids[0].textContent || '').trim().length }
      : null,
  };
};

// ── THE PUNCTUATION GUARD ────────────────────────────────────────────────────────────────
// If the opening prose does not begin on a letter, no drop cap is rendered at all. Silent,
// not broken.
//
// WHY IT CANNOT SIMPLY CAP THE LETTER AND LEAVE THE QUOTE ALONE. ::first-letter has no way
// to skip leading punctuation — it is a browser-computed range, not a selector we control.
// MEASURED in Chromium at 375px against the shipped 4.2em declaration (per-character Range
// heights, capped paragraph vs. uncapped, 20px normal / 86px capped):
//
//     'As a woman…      captures  'A     ← the apostrophe is floated at 4.2em too
//     “You can have…    captures  “Y
//     "You can have…    captures  "Y
//     (Later, she…      captures  (L
//     2026 is shaping…  captures  2
//     I.                captures  I.
//     …I dey  (no space) captures …I
//     — and then…       captures  —      ← the dash alone, floated, regardless
//     … I dey (space)   captures  nothing — the rule does not apply
//     *** The morning   captures  nothing
//
// So the operative browser rule is contiguity: leading punctuation is swallowed into the cap
// whenever a letter follows it directly, and an em dash is capped alone whether or not one
// does. There is no CSS-only escape.
//
// THE RICHER FIX, DELIBERATELY NOT BUILT IN R9.3. Stop relying on ::first-letter for these:
// in the tagger, split the target's leading text node into `<span data-dropcap-glyph>` around
// the first LETTER, leave the punctuation before it in the normal run, float the span, and
// switch proseCSS to style `[data-dropcap-glyph]` instead of `::first-letter` for that case.
// That keeps the ornament on dialogue openers rather than dropping it. It was scoped out
// because it is a text-node surgery under a MutationObserver — it has to be idempotent
// against its own output — and that deserves its own round rather than a rider on this one.
//
// ITS CORPUS, so a future round does not have to re-derive it. EIGHT live stories open on a
// character this guard suppresses — measured over cms_stories, 2026-08-05. Seven on a
// straight apostrophe U+0027, NOT a curly quote; a “-only guard would miss every one:
//
//     dont-worry · full · i-dey-your-back · mask-with-no-memory ·
//     peer-pressure-from-the-dead · unstoppabbl ·
//     release-the-footage-how-the-henry-nowak-case-became-an-international-debate
//
// and one on a digit:
//
//     is-2026-shaping-up-to-be-the-year-for-peak-modern-cinema   ("2026 is shaping up…")
//
// All eight render a floated 4.2em quote mark or numeral TODAY; this guard is what stops
// that. Re-run `node scripts/audit-story-openers.mjs` for the current list before building
// the richer fix on top of it.
//
// OPENS_ON_LETTER itself now lives in prosePredicate.js and is imported above — it is part
// of "what is opening prose", and the cutter's tests assert the two agree about exactly
// these eight stories. The measurements stay here, next to the drop cap they were taken
// for.

// One tagging pass over an article element. Exported for callers that render prose once
// and know it will not change; most callers want attachDropcap instead.
export function tagDropcap(article) {
  if (!article) return;
  const container = article.querySelector('.prose.has-dropcap');
  if (!container) return; // poetry (no has-dropcap) or body not in the DOM yet
  const paras = Array.from(container.querySelectorAll('p'))
    .filter((p) => (p.textContent || '').trim().length > 0);
  if (!paras.length) return;
  // Clear any tags from a prior pass so re-runs converge on the same state.
  paras.forEach((p) => p.classList.remove('dropcap-target', 'story-frontmatter'));

  // Structurally excluded paragraphs are dropped BEFORE the front-matter walk, and are never
  // given .story-frontmatter: an .intro-note already carries its own presentation from
  // proseCSS, and stacking the front-matter treatment on top would shrink it and grey it out.
  // Only heuristically-detected front-matter gets that class, exactly as it did before.
  //
  // The img test also catches a prose paragraph with an image inline in it, which is a
  // deliberate trade: such a paragraph cannot carry a sane floated cap anyway, and the walk
  // simply moves to the next one.
  const candidates = paras.filter((p) => !p.closest(EXCLUDED_SELECTOR) && !p.querySelector('img'));
  if (!candidates.length) return;

  // The walk itself is prosePredicate.js:walkToProse, run over adapted blocks. Same
  // heuristics, same order, same answer — the indices come back and map 1:1 onto
  // `candidates` because the adapter preserves order and drops nothing.
  const { frontmatter, targetIndex } = walkToProse(candidates.map(blockFromElement));

  // No qualifying paragraph — everything read as front-matter. No drop cap, and no
  // front-matter restyle either: greying out an entire body because the walk found nothing
  // it liked is a worse failure than simply leaving it alone. Silent, not broken.
  //
  // The old code fell back to paras[0] here, which is precisely how a section numeral got
  // capped — the fallback re-introduced the bug the walk had just avoided.
  if (targetIndex === null) return;
  const target = candidates[targetIndex];

  frontmatter.forEach((i) => candidates[i].classList.add('story-frontmatter'));

  // Opens on punctuation or a digit — see the guard's note above. No drop cap.
  if (!OPENS_ON_LETTER.test((target.textContent || '').trim())) return;

  target.classList.add('dropcap-target');
}

// Tag now, and keep tagging if the body is replaced. Returns the cleanup function an
// effect should return.
export function attachDropcap(article) {
  if (!article) return undefined;
  const tag = () => tagDropcap(article);

  tag();
  // Adding a class is an attribute mutation, not childList, so re-tagging here
  // never retriggers the observer — no loop.
  let obs;
  if (typeof MutationObserver !== 'undefined') {
    obs = new MutationObserver(() => tag());
    obs.observe(article, { childList: true, subtree: true });
  }
  return () => { if (obs) obs.disconnect(); };
}
