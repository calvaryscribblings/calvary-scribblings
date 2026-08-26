// THE GRAIN — one definition, two pages, and R20's ruling about what it is attached to.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// R20 — IKENNA'S RULING, 26 August 2026: THE GRAIN IS UN-FIXED
// ═════════════════════════════════════════════════════════════════════════════════════════
//
//   "Grain that holds still while the page moves reads as dust on the lens; grain that
//    travels with the page reads as texture in the paper. The second is what the house
//    meant."
//
// THIS IS A DESIGN RULING, FULL STOP — and the performance claim originally attached to it was
// MINE AND IT WAS WRONG. The correction is kept here rather than tidied away, because the next
// person to read this file will otherwise re-derive the same mistake.
//
// WHAT WAS MEASURED CORRECTLY: the grain is the single largest cost in a scroll of the
// storefront. Deleting it takes dropped frames at 1280 from ~44% to ~13%.
//
// WHAT WAS MEASURED WRONGLY: the ablation that priced "un-fix it" at 18.1% used
// `position:absolute;inset:0;height:100%`, and an absolutely positioned element with no
// positioned ancestor resolves against the viewport-sized initial containing block. So that
// ablation did not model grain travelling with the page — it modelled grain covering the first
// screenful and then scrolling away entirely. Of course it was cheap. It was barely there.
//
// BUILT FAITHFULLY — covering the document, animation running — un-fixing is PERFORMANCE
// NEUTRAL. Medians of three runs, before → after: storefront 1280 41.8% → 43.3% dropped,
// storefront 390 8.6% → 7.9%, detail 1280 2.9% → 3.8%, detail 390 0% → 0%. Layer memory rises
// on a long page (138 → 157 MiB, the grain is now document-tall rather than twice the viewport)
// and falls on a short one (50 → 41 MiB on the detail page).
//
// WHERE THE 22 POINTS ACTUALLY LIVE: the ANIMATION, on a large layer, fixed or not. Measured on
// the faithful build — absolute + animated 42.7%, absolute + animation:none 19.3%, removed
// 13.1%, and the old fixed + animated 44.9%. Nothing about the positioning scheme moves that
// number; only stopping the shimmer does, and the ruling keeps the shimmer.
//
// SO THE RULING STANDS ON ITS OWN TERMS, which is how it was argued in the first place: grain
// that travels with the page is the better drawing. It costs nothing and it buys nothing. If a
// future round wants the frames back, the question to put to the house is about the SHIMMER,
// not about this line.
//
// THE ANIMATION STAYS. Same rate, same ten steps, same eight seconds. What changed is the
// element's positioning scheme and nothing else about how it is drawn.
//
// ── WHY DENSITY AND SCALE CANNOT MOVE, WHICH IS THE THING THE RULING PROTECTS ──────────────
// The texture is two repeating-linear-gradients whose colour stops are in ABSOLUTE PIXELS —
// 1px and 2px on the 0deg pass, 1px and 3px on the 90deg. A background built from absolute
// lengths does not scale with the box that carries it, so re-parenting the element and
// resizing it cannot change how coarse the grain looks or how much of it there is per square
// inch. That is measured rather than asserted: tests/bookstore/payload.spec.mjs diffs a frozen
// first frame of both pages at both viewports against the fixed-position build and finds it
// unchanged.
//
// (For the record, since the ruling described it as feTurbulence: there is no SVG filter here
// and never has been. It is two CSS gradients. The distinction matters because it is exactly
// what makes the density guarantee above free — an feTurbulence would have had a baseFrequency
// resolving against the filter region, and un-fixing it really could have rescaled the noise.)
//
// ── COVERAGE, STATED PLAINLY ──────────────────────────────────────────────────────────────
// `position:absolute` resolves against the nearest positioned ancestor. Both consumers render
// this element as the FIRST CHILD OF <main>, and both <main>s are already position:relative —
// so the containing block is the whole document's worth of content, and `inset` covers it top
// to bottom however long the catalogue grows. That is the answer to "a very long page must not
// run out of grain": coverage is not a number that has to be maintained, it is the containing
// block.
//
// ⚠ AS A SIBLING BEFORE <main> — WHICH IS WHERE IT USED TO SIT — THIS WOULD BE BROKEN IN A WAY
// THAT LOOKS FINE ON A SHORT PAGE. With no positioned ancestor, an absolutely positioned
// element resolves against the INITIAL containing block, which is viewport-sized. The grain
// would cover the first screenful of the document and then simply stop, and on a laptop where
// the fold is most of the hero nobody would notice until they scrolled. The element must be
// inside <main>. GRAIN_PARENT_RULE below is asserted by the suite in both directions.
//
// A SHORT PAGE is handled by min-height rather than by hoping, and the floor is 100vh rather
// than 100% — 100% of a short <main> is still short, which would have been a floor that only
// held when it was not needed. If <main> is ever shorter than the viewport, the grain still
// fills the screen. The detail page already sets minHeight:100vh
// on its <main> and the storefront's hero is 88vh before anything else, so this is a floor
// nothing currently stands on — which is the best moment to put one in.
//
// ── THE BLEED, AND WHY THE KEYFRAMES ARE NOW IN PIXELS ────────────────────────────────────
// The keyframe sequence is the same nine offsets in the same order; only the unit changed,
// from % to px. That is not a cosmetic tidy — under the old scheme the offsets were
// percentages of the element's own box, which was 2× the VIEWPORT (inset:-50% of a fixed
// element). Absolutely positioned inside <main>, the same -50% would resolve against the
// DOCUMENT, so on a 7,800px shelf a "9%" step would have become 1,400px of travel and the
// element 15,600px tall.
//
// Reading the same numbers as pixels keeps the sequence's shape and bounds the travel at 9px,
// which is what BLEED_PX covers. And 9px is not a compromise on the look: the pattern repeats
// every 2px vertically and 3px horizontally, so ANY translate of more than a few pixels lands
// the texture at a different phase. Phase is the entire visible effect of this animation —
// a 150px step and a 9px step are both "the same grain, re-seeded", which is why the shimmer
// is preserved while the geometry stops being absurd.
//
// The first frame — transform:translate(0,0) — is byte-identical to the old first frame, and
// that is the frame the suite diffs.
//
// ── WHAT THIS ROUND DELIBERATELY DID NOT ADD ──────────────────────────────────────────────
// A prefers-reduced-motion stop. BoundBook has one for the flip and the argument for one here
// is decent, but the ruling said the animation STAYS and nobody asked for a class of readers
// to stop seeing it. Adding it under cover of a performance round would be a behaviour change
// smuggled in beside a design one. It is written here as the obvious next question rather than
// answered unilaterally.

// The bleed each side, in px. Must exceed the largest single offset in the keyframes below
// (9px) or a step would drag an uncovered edge into view. Asserted against the keyframes by
// tests/bookstore/payload.spec.mjs so the two cannot drift apart.
export const GRAIN_BLEED_PX = 16;
export const GRAIN_MAX_TRAVEL_PX = 9;

// The class, and the rule that it must live inside a positioned <main>. Exported so the suite
// asserts the arrangement rather than trusting it.
export const GRAIN_CLASS = 'bookstore-grain';
export const GRAIN_PARENT_RULE = {
  ruledBy: 'Ikenna',
  on: '2026-08-26',
  ruling: 'Grain that holds still while the page moves reads as dust on the lens; grain that travels with the page reads as texture in the paper.',
  positioning: 'absolute',
  mustBeFirstChildOf: 'main',
  parentMustBePositioned: true,
  // What it was, kept verbatim so a restoration is a copy rather than a reconstruction, and so
  // the cost of going back is on the record beside the way back.
  wasCss: 'position:fixed;inset:-50%;z-index:1;pointer-events:none;opacity:.05',
  // Honest, and smaller than first claimed — see the correction in the header. Re-fixing this
  // is a DESIGN reversal, not a performance one; it would cost the drawing, not the frames.
  costOfRefixing: 'nothing measurable — the positioning scheme is performance neutral. Reversing it reverses the ruling.',
};

export const GRAIN_CSS = `
  @keyframes grainShift{0%{transform:translate(0,0)}10%{transform:translate(-3px,-2px)}20%{transform:translate(-8px,4px)}30%{transform:translate(3px,-8px)}40%{transform:translate(-2px,9px)}50%{transform:translate(-8px,3px)}60%{transform:translate(4px,-2px)}70%{transform:translate(-4px,6px)}80%{transform:translate(6px,3px)}90%{transform:translate(-2px,-4px)}}
  .${GRAIN_CLASS}{position:absolute;inset:-${GRAIN_BLEED_PX}px;z-index:1;pointer-events:none;opacity:.05;
    min-height:calc(100vh + ${GRAIN_BLEED_PX * 2}px);
    background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.6) 0,rgba(0,0,0,.6) 1px,transparent 1px,transparent 2px),repeating-linear-gradient(90deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 3px);
    animation:grainShift 8s steps(10) infinite}
`;
