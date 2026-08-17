// SUBHEADING TAGGING — a render-time classifier over story prose.
//
// ── THE PROBLEM ──────────────────────────────────────────────────────────────────────────
// The CMS offers an H3 button (app/admin/page.js:341) and 37 published stories use it. But
// ten others carry their section titles as a bare bolded paragraph:
//
//   <p><strong>The Bottom Line</strong></p>
//
// Those are subheadings by intent and by every editorial reading, and they render as
// ordinary body bold — #1a1a1a, indistinguishable from an emphasised word mid-sentence.
// They were never styled as subheadings at all.
//
// ── WHY THIS IS NOT A CSS RULE ───────────────────────────────────────────────────────────
// The obvious fix is `.prose p:has(> strong:only-child) > strong { color: gold }`. It is
// wrong, and measurably so. Across the published corpus, 100 paragraphs contain exactly one
// <strong>, and 52 OF THEM ARE RUN-IN LEAD-INS:
//
//   <p><strong>Product:</strong> The commercial AI companion (Replika, Character.ai …)</p>
//   <p><strong>Tax season.</strong> Every year, phishing emails impersonating tax …</p>
//
// `:only-child` counts ELEMENT children; the trailing sentence is a text node, so it does
// not disqualify. That selector gilds the lead-in of over half the paragraphs it touches.
// CSS cannot ask the question that separates the two cases — "is the strong the WHOLE
// paragraph?" — because it cannot see text nodes. So the question is asked here.
//
// ── WHY A STRING TRANSFORM AND NOT A DOM PASS ────────────────────────────────────────────
// app/lib/dropcap.js is the neighbouring precedent and it works on the live DOM, client
// side. That is right for the drop cap, whose target depends on rendered structure. It is
// WRONG here, because story prose is rendered in two places that must agree:
//
//   1. the static export  — app/stories/[slug]/page.js inlines prose at BUILD time, and the
//                           words land in out/stories/<slug>.html
//   2. the client         — the same React component re-renders after hydration, and again
//                           when /api/story returns the full body
//   3. the shelf reader   — app/my-library/read/page.js, over the offline copy
//
// A client-side DOM pass would tag (2) and (3) but not (1): the exported HTML would carry
// untagged subheadings, and a reader without JS — or anyone reading before hydration — gets
// the old presentation. Because this is a pure string→string function applied INSIDE the
// render, it runs during static export and on the client identically, from the same input,
// with the same result. All three surfaces are byte-identical.
//
// ── THE STORED HTML IS NEVER TOUCHED ─────────────────────────────────────────────────────
// This is a classifier at render, not a content migration. cms_stories bodies stay exactly
// as the editor saved them; nothing here writes. Re-running it on already-tagged HTML is a
// no-op, because the pattern requires a bare `<p>` and a tagged one carries a class.
//
// ── THE PREDICATE, CONSERVATIVE BY CONSTRUCTION ──────────────────────────────────────────
// A <p> is a subheading when ALL of the following hold. False negatives are acceptable —
// a missed subheading looks exactly like today. False positives are not: a gilded run-in
// is a visible defect in the middle of a sentence.
//
//   1. it is a bare `<p>` with no attributes of its own;
//   2. its only element child is a single <strong>, which opens and closes it;
//   3. there is NO text outside that <strong> — this is the clause that rejects every
//      run-in lead-in, and the whole reason the classifier exists;
//   4. the text does not end in sentence-terminal punctuation.
//
// Clause 4 is the guard against a whole paragraph bolded for emphasis, which satisfies
// (1)–(3) but is prose, not a heading. It is not a guess: across all 41 real subheadings in
// the corpus, ZERO end in `.`, `!` or `?`, while an emphasised paragraph is by nature a
// finished sentence. `:` is deliberately NOT terminal — "Pros:" and "Cons (the trap):" are
// real subheadings in live stories. The same "is this a terminated sentence?" reasoning
// already governs drop-cap targeting in app/lib/prosePredicate.js.
//
// ── THE TEMPERED PATTERN ─────────────────────────────────────────────────────────────────
// The inner run is tempered so it can never cross a paragraph or strong boundary. Without
// that, a lazy `[\s\S]*?` starting at a run-in lead-in happily runs PAST the end of its own
// paragraph to find the next `</strong></p>` further down the story — which, tested against
// the live corpus, swallowed up to 1,415 characters and 218 words of body prose into a
// single bogus "subheading". The temper is load-bearing; do not simplify it away.
const SUBHEAD_RE =
  /<p>\s*<strong>((?:(?!<\/?p[\s/>]|<\/?strong[\s>])[\s\S])*?)<\/strong>\s*<\/p>/gi;

/** Sentence-terminal punctuation. `:` is excluded on purpose — see clause 4 above. */
const TERMINATED = /[.!?]["'’”)\]]*$/;

/** The class the stylesheet hooks. See app/lib/proseCSS.js. */
export const SUBHEAD_CLASS = 'prose-subhead';

/**
 * Is this the text of a subheading rather than an emphasised paragraph?
 * Exported for tests/dropcap/subhead.spec.mjs, which asserts it directly.
 */
export function isSubheadText(text) {
  const t = String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  return !TERMINATED.test(t);
}

/**
 * Tag whole-paragraph bold subheadings so the stylesheet can reach them.
 *
 * Pure, idempotent, and safe on empty/nullish input — the story page renders before the
 * body arrives, and passing '' must not throw.
 */
export function tagSubheads(html) {
  if (typeof html !== 'string' || !html) return html ?? '';
  return html.replace(SUBHEAD_RE, (whole, inner) =>
    isSubheadText(inner)
      ? `<p class="${SUBHEAD_CLASS}"><strong>${inner}</strong></p>`
      : whole,
  );
}
