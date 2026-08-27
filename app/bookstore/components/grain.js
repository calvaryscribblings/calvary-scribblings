// THE GRAIN — one definition, two pages, and TWO rulings: what it is attached to, and that it
// holds still.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// ⛔ R22 — IKENNA'S RULING, 26 August 2026: THE SHIMMER IS GONE. DO NOT PUT IT BACK.
// ═════════════════════════════════════════════════════════════════════════════════════════
//
//   "Doesn't look good at all... needs to go very quickly."
//
// He was shown the animated grain on glass and that was the verdict. THE LOOK RULED. The
// animation is removed; the TEXTURE IS UNTOUCHED — same two gradients, same absolute-pixel
// stops, same .05 opacity, same -16px bleed, same absolute positioning inside <main> so it
// still travels with the page per the R20 ruling below. Only the redraw stopped.
//
// ── AND THE FRAMES ARE A BONUS, NOT THE ARGUMENT ─────────────────────────────────────────
// R20 measured the shimmer at TWENTY-TWO POINTS of dropped frames on the storefront at 1280:
// absolute + animated 42.7%, absolute + animation:none 19.3%, the element removed entirely
// 13.1%. That harness is not in this repo, so R22 built one — `npm run bench:grain`, which
// puts both arms on ONE build and reads Chrome's own PipelineReporter accounting.
//
// R22's figures, medians of five interleaved wheel-scrolls in this container:
//
//     WITH the shimmer      34.1% of frames not fully presented
//     WITHOUT (as shipped)  20.8%
//     the shimmer cost      13.3 points
//
// ⚠ THE BASELINE REPRODUCES R20 AND THE LOADED ARM DOES NOT, and that is stated rather than
// smoothed over. 20.8% against R20's 19.3% is the same number; 34.1% against R20's 42.7% is
// not. So the honest claim is THIRTEEN points on this harness, not twenty-two — same
// direction, same order of magnitude, consistently reproduced on every run, and materially
// less than the figure R20 recorded. Anyone quoting "22 points" is quoting a measurement
// nobody in this repo can now re-run.
//
// The number is real and it is large. IT IS STILL NOT WHY THIS CHANGED.
//
// BOTH REASONS ARE WRITTEN HERE ON PURPOSE. A restoration argued as "the A24 trick" or "film
// grain needs to move" is answering the performance half of a decision whose other half was a
// judgement about how it looked on a screen — and the judgement is the one that carries.
// Winning the frames argument does not reopen this. Ikenna does.
//
// THE ONE THING THAT WOULD: Ikenna saying so. Everything needed to put it back is on the
// record — GRAIN_ANIMATION_REMOVED below holds the keyframes and the declaration verbatim, so
// a restoration is a copy and not a reconstruction.
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
// ⤷ R22 PUT EXACTLY THAT QUESTION TO THE HOUSE, and the house answered. R20's last paragraph
//   here read "THE ANIMATION STAYS. Same rate, same ten steps, same eight seconds." It does
//   not stay. It was removed one round later on how it looked, and the 22 points R20 located
//   came with it. The positioning ruling — which is what the rest of this block is about — is
//   UNCHANGED and still governs: the grain is absolute inside <main> and travels with the
//   page. Two rulings, two different questions, and R22 answered only the second one.
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
// ── THE BLEED, AND WHY THE KEYFRAMES WERE IN PIXELS ───────────────────────────────────────
// R22 note: the keyframes are gone, so nothing travels and nothing can drag an uncovered edge
// into view. THE BLEED STAYS AT 16px ANYWAY, and it is not vestigial — the texture's colour
// stops are in absolute pixels, so the gradient's PHASE is a function of the element's origin.
// Move the origin by 16px and the horizontal pass (a 3px period) lands 1/3 of a period out.
// That would be a visible change to a texture two rulings say must not change. The paragraph
// below is the original argument, kept because it is what makes the 16px unarguable.
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
// ── WHAT R20 DELIBERATELY DID NOT ADD, AND WHY R22 DID NOT NEED TO ────────────────────────
// R20 left out a prefers-reduced-motion stop, on the grounds that the ruling kept the
// animation and dropping it for one class of readers under cover of a performance round would
// be a behaviour change smuggled in beside a design one. That question is CLOSED rather than
// answered: there is no animation left to stop, for anybody. A media query guarding a
// declaration that does not exist would be the kind of dead code that reads as a live
// safeguard.

// The bleed each side, in px. It USED to be sized to exceed the largest keyframe offset (9px)
// so a step could not drag an uncovered edge into view. R22 removed the steps, and it stays at
// 16 for the reason in the header: the texture's stops are absolute pixels, so the element's
// origin sets the gradient's PHASE, and moving it would change a texture two rulings protect.
export const GRAIN_BLEED_PX = 16;

// ⛔ THE SHIMMER, VERBATIM, SO A RESTORATION IS A COPY AND NOT A RECONSTRUCTION.
//
// Removed R22 on Ikenna's judgement of how it looked — "doesn't look good at all... needs to
// go very quickly" — and NOT on the frames, which are a bonus and are recorded here so that
// nobody re-derives the performance case and mistakes winning it for permission.
//
// This object is exported because tests/bookstore/payload.spec.mjs RATCHETS AGAINST IT: the
// suite asserts the built export ships no `animation` on the grain and no `grainShift`
// keyframe anywhere, and it reads the removed strings from here rather than restating them,
// so the ratchet cannot drift from the record.
//
// ⚠ A PLAIN OBJECT, NOT Object.freeze(...), AND THAT IS DELIBERATE ON A PERFORMANCE ROUND.
// Nothing imports this at runtime — the suite reads it out of the SOURCE — so webpack should
// drop it entirely, and it does, exactly as it already drops GRAIN_PARENT_RULE below. Wrapping
// it in Object.freeze() defeats that: the call is a side effect the bundler cannot prove pure,
// so the whole record survives into out/_next/static/chunks and ships the removed keyframes to
// every visitor. That was MEASURED, not assumed — the frozen version put all 800-odd bytes of
// `wasKeyframes` in the shipped bundle, which is a comical way to close a round about a
// shimmer nobody can see.
export const GRAIN_ANIMATION_REMOVED = {
  ruledBy: 'Ikenna',
  on: '2026-08-26',
  ruling: "Doesn't look good at all... needs to go very quickly.",
  reason: 'how it looked on glass. The frames are a bonus, not the argument.',
  // Measured by `npm run bench:grain` — both arms on one build, /bookstore at 1280, medians of
  // five interleaved wheel-scrolls, Chrome's own PipelineReporter accounting. See the header
  // for why this says 13 points where R20 said 22.
  droppedFramesBefore: '34.1%',
  droppedFramesAfter: '20.8%',
  droppedFramesCost: '13.3 points',
  measuredBy: 'npm run bench:grain',
  keyframeName: 'grainShift',
  wasKeyframes: '@keyframes grainShift{0%{transform:translate(0,0)}10%{transform:translate(-3px,-2px)}20%{transform:translate(-8px,4px)}30%{transform:translate(3px,-8px)}40%{transform:translate(-2px,9px)}50%{transform:translate(-8px,3px)}60%{transform:translate(4px,-2px)}70%{transform:translate(-4px,6px)}80%{transform:translate(6px,3px)}90%{transform:translate(-2px,-4px)}}',
  wasDeclaration: 'animation:grainShift 8s steps(10) infinite',
  maxTravelPx: 9,
  // What did NOT change, listed so a reviewer can check the claim rather than take it.
  unchanged: ['the two gradients', 'the absolute-pixel stops', 'opacity .05', 'inset -16px',
    'position:absolute inside <main>', 'min-height', 'z-index', 'pointer-events'],
};

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

// ⛔ NO `animation`, AND NO @keyframes. R22. Every other declaration is byte-identical to what
// R20 shipped — the frame this draws is the frame it drew, held still. See
// GRAIN_ANIMATION_REMOVED above for the ruling and for what was taken out.
export const GRAIN_CSS = `
  .${GRAIN_CLASS}{position:absolute;inset:-${GRAIN_BLEED_PX}px;z-index:1;pointer-events:none;opacity:.05;
    min-height:calc(100vh + ${GRAIN_BLEED_PX * 2}px);
    background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.6) 0,rgba(0,0,0,.6) 1px,transparent 1px,transparent 2px),repeating-linear-gradient(90deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 3px)}
`;
