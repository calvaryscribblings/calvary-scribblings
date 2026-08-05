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

// ── EXCLUSIONS ───────────────────────────────────────────────────────────────────────────
// Matched with .closest(), so ONE list covers both a class on the paragraph itself and a
// container the paragraph sits inside. That is what makes `blockquote` and `figure` work:
// querySelectorAll('p') happily returns `blockquote > p`, and an epigraph's inner paragraph
// must not be the drop cap.
//
// Headings are not listed because they cannot occur — querySelectorAll('p') does not return
// them. Do not "helpfully" add h2/h3 here; it would read as though the list were doing work
// it is not.
//
// EVERY CLASS HERE IS ASSERTED AGAINST LIVE CONTENT by tests/ci/dropcap-openers.test.mjs,
// which cross-references this list with the opener inventory in
// tests/fixtures/story-openers.json (emitted by scripts/audit-story-openers.mjs). A class
// that starts appearing at the top of story bodies and is in neither this list nor that
// test's PROSE set is a test failure, not a rendered surprise. That is the whole point: a
// class-driven list goes stale silently, so the staleness is what gets tested.
export const DROPCAP_EXCLUDED_SELECTORS = [
  'blockquote',            // epigraphs; `blockquote > p` is reachable from querySelectorAll
  'figure',
  'figcaption',
  'li',
  '.intro-note',           // observed live: CHAFF's section markers, content notes
  '.section-break',
  '.poem-numeral',         // observed live
  '.poem-title',
  '.poem-collection-intro',
  '.poem-contents',
  '.poem-stanza',          // verse lines are <p> children of the stanza block
  '.image-caption',
  '.inline-image-caption',
  '.article-image',        // observed live
  '.features-list',
];

const EXCLUDED_SELECTOR = DROPCAP_EXCLUDED_SELECTORS.join(', ');

const FRONTMATTER_RE = /^(content note|content warning|cw|trigger warning|tw|author's note|note|dedication|epigraph)[:\s—–-]/i;
// A line that ends on sentence-ending punctuation reads as prose, not a bare
// label — closing quotes after the terminal mark still count as terminated.
const TERMINATED_RE = /[.!?…]['"”’]*$/;
// Anything left over after stripping ONE terminal mark. "Drip. Drip. Drip." has marks
// inside it and is real prose; "I." and "My Dream Man" do not and are labels.
const INTERNAL_TERMINAL_RE = /[.!?…]/;

// ── THE FAIL-SAFE (R9.3, rider 2) ────────────────────────────────────────────────────────
// The exclusion list above is class-driven, so it goes stale the day the CMS gains a marker
// class nobody added here. This rule is the class-blind backstop: a very short paragraph of
// no more than three words, carrying at most one terminal mark, is a label — a numeral, a
// section marker, a title — whatever class it happens to wear.
//
// THE WORD COUNT IS LOAD-BEARING AND WAS MEASURED, NOT GUESSED. The rider as first
// written was "under ~40 chars AND no sentence-ending punctuation beyond a single terminal
// mark". Run against all 162 live story bodies that clause alone demotes five real prose
// openers, because plenty of stories open on a short, properly-punctuated sentence:
//
//     "The scream ripped through the spa."      village-people          (34 chars)
//     "Dayo was afraid of the number thirteen." the-number-thirteen     (39 chars)
//     "There is a new anthem now."              red-white-red
//     "People worship their 9-to-5s."           5-to-9
//     "Nobody talks about the grief."           a-heart-trained-for-battle
//
// Adding `words <= 3` separates those from the labels cleanly. With it, the rule fires on
// exactly six live paragraphs — "war", "Inspiration", "Him", "My Dream Man", "A prose poem.",
// "Introduction" — every one of them a title or a note, and none of them a story's opening
// line. Re-measure before widening the threshold; the margin here is two words.
const isMarkerish = (t) => {
  if (t.length >= 40) return false;
  if (t.split(/\s+/).filter(Boolean).length > 3) return false;
  return !INTERNAL_TERMINAL_RE.test(t.replace(TERMINATED_RE, ''));
};

const isEntirelyItalic = (p) => {
  const t = (p.textContent || '').trim();
  if (!t) return false;
  const kids = Array.from(p.children);
  return kids.length === 1
    && (kids[0].tagName === 'EM' || kids[0].tagName === 'I')
    && (kids[0].textContent || '').trim().length >= t.length * 0.9;
};

const isFrontmatter = (p, next) => {
  const t = (p.textContent || '').trim();
  if (!t) return false;
  if (FRONTMATTER_RE.test(t)) return true;
  if (isEntirelyItalic(p)) return true;
  if (isMarkerish(t)) return true;
  if (t.length < 40 && !TERMINATED_RE.test(t) && next && (next.textContent || '').trim().length > t.length) return true;
  return false;
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
const OPENS_ON_LETTER = /^\p{L}/u;

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

  const frontmatter = [];
  let target = null;
  for (let i = 0; i < candidates.length; i++) {
    if (isFrontmatter(candidates[i], candidates[i + 1] || null)) { frontmatter.push(candidates[i]); continue; }
    target = candidates[i];
    break;
  }

  // No qualifying paragraph — everything read as front-matter. No drop cap, and no
  // front-matter restyle either: greying out an entire body because the walk found nothing
  // it liked is a worse failure than simply leaving it alone. Silent, not broken.
  //
  // The old code fell back to paras[0] here, which is precisely how a section numeral got
  // capped — the fallback re-introduced the bug the walk had just avoided.
  if (!target) return;

  frontmatter.forEach((p) => p.classList.add('story-frontmatter'));

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
