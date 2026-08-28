'use client';
// BoundBook — renders a title as a physical book object: front cover, spine hinge,
// RIGHT fore-edge page block, printed back cover, obi band, optional ribbon, contact shadow.
// All motion lives in CSS (BOUND_BOOK_CSS) so a consuming page injects the stylesheet ONCE
// and every instance shares it — no N copies. Reduced motion is handled entirely in CSS via
// prefers-reduced-motion (no resting angle, no transitions).
//
// R17.3 — THE BOOK CARRIES ITS OWN GESTURE. It used to be presentational, taking `flipped`,
// `bind` and `bookRef` from whatever wrapped it, and exactly one surface wrapped it: the
// shelf's ShelfBook. The Window's book and the book in a curated case were rendered directly
// and had no handler at all, so they were dead objects on a shop where every other book turns
// over on tap. See BOOK_SURFACES below for the whole argument and the register.
// R20 — next/image is gone from this file. It was `unoptimized` (output:'export' has no
// optimiser), which means it emitted no srcset, which is the whole of the payload problem this
// round measured. See FrontFace.
import { useEffect, useRef } from 'react';
import { coverSrcSet, coverSrc, coverLqip } from '../../lib/bookstore/covers';
// R26 — the board's width and its `sizes`, in one place both this client module and the
// detail page's server component can read. See that file's header.
import { boardSizes } from '../../lib/bookstore/board';
// R22C — the marker a link uses to find this board. See ./bookTransition.js for the mechanism.
import { BOOK_SLUG_ATTR } from './bookTransition';
import { useBookGesture } from './useBookGesture';
import { resolveOpeningLine, resolveBackBlurb, gradientFor, obiLabel, formatCatalogueNumber } from './fields';
import { useCurrency, useRegionCountry, priceLine } from '../../lib/currency';

// ═════════════════════════════════════════════════════════════════════════════════════════
// R16 — FEET OFF THE BOOK
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 19 August 2026, ratifying the app's storefront refinements as the house
// design:
//
//   "The book is a clean graphic object. Take the feet off — the bottom page block goes,
//    everywhere it renders, the Window included. That is the Masobe direction."
//
// ⚠ "REMOVE THE BOTTOM BLOCK" IS ONE EDIT AWAY FROM "REMOVE THE PAGE BLOCK", and that is why
// this constant exists rather than a deleted line and a silence. There were two page-edge
// elements and only one of them went. Everything in `keeps` below is still drawn, and
// tests/bookstore/boundbook.test.mjs asserts this record in BOTH directions: the removed one
// is gone from the stylesheet and from the DOM, and every kept one is still in both.
export const BOTTOM_PAGE_BLOCK_REMOVED = {
  ruledBy: 'Ikenna',
  on: '2026-08-19',
  ruling: 'The book is a clean graphic object. Take the feet off — the bottom page block goes, everywhere it renders, the Window included.',
  // The element as it stood, kept verbatim so the shadow derivation below can be read against
  // it and so a restoration is a copy rather than a reconstruction.
  removedClass: 'bb-foreedge-b',
  removedCss: 'position:absolute;left:2.5%;right:2.5%;bottom:-8px;height:8px;transform:translateZ(-5px);z-index:1;background:repeating-linear-gradient(0deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);border-radius:0 0 3px 3px',
  // THE NUMBER THE SHADOW MOVED BY. The feet hung exactly this far below the book's box, and
  // CONTACT_SHADOW_REBASE below is the same 8px travelling in the opposite direction. If the
  // feet are ever restored, these two move back together or the pool doubles.
  removedDropPx: 8,
  // Everything the ruling did NOT touch. Asserted present, individually, by name.
  keeps: [
    'bb-foreedge',   // the RIGHT fore-edge — the page block that stays. Its WIDTH moved in R17.4
    'bb-spine',      // the spine hinge, on both faces
    'bb-obi',        // the obi band, granted only by a live Editor's Choice claim
    'bb-ribbon',     // the gilt ribbon
    'bb-back',       // the printed back face
    'bb-book',       // the flip itself
  ],
  // ⚠ R17.4 — THIS KEY USED TO BE `foreEdgeMinWidthPx: 12`, AND THE NAME WAS ALREADY WRONG.
  // R16 pinned it so the feet-removal could not "tidy" the right fore-edge away with the
  // bottom one, which was the correct instinct — but the CSS it guarded was `width:12px`, a
  // FIXED width, and the record called it a minimum. Nothing in the tree ever treated it as a
  // floor: its two consumers were both assertions that the width was exactly 12.
  //
  // So there was no "the book must exceed a shelf book by one visible edge" rule to re-express
  // — there was a fixed number wearing the word "min". R17.4 makes the width proportional and
  // gives it a REAL floor, and both now live in FORE_EDGE below. The 12 is kept here as
  // provenance, because the ratio that replaced it is derived from this very number.
  foreEdgeWasFixedPx: 12,
  foreEdgeNowGovernedBy: 'FORE_EDGE',
};

// ═════════════════════════════════════════════════════════════════════════════════════════
// R16 — THE CONTACT SHADOW, REBASED BY DERIVATION
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// THE THING THE EYE READS is the pool of shadow visible BELOW the object's silhouette. Not
// the shadow's box, and not the front face's own drop shadow (8px 14px 46px), which paints
// some fifty pixels further down, is attached to the face, and does not move when the feet do.
//
// BEFORE the removal, the silhouette's lowest paint WAS the feet, and the contact shadow was
// positioned against them: `bottom:-16px` on a book whose feet ended at -8px, so the pool
// extended 8px past the lowest thing the book put on the ground.
//
// Removing the feet raises the silhouette by that 8px. Leaving the shadow where it was would
// have left the pool 8px deeper — measured at 17.1px against 9.5px on the 150px shelf book —
// and the book would read as hovering. So the shadow moves up by exactly the drop the feet
// occupied, and the pool it leaves is the pool it always left.
//
// MEASURED, both sides, on the real page at deviceScaleFactor 4, with the contact shadow
// isolated DIFFERENTIALLY — the identical frame rendered twice, once with .bb-shadow
// suppressed, and the difference read down the book's centre. That isolation is the whole
// method: without it the probe reads the front face's drop shadow, which paints some fifty
// pixels below the book, does not move when the feet do, and would drown the signal.
//
// The two call sites whose SIZE did not change this round are the controlled comparison:
//
//                       silhouette below box     visible pool below the silhouette
//   window      190px   +9.00  →  +1.55          8.86px  →  8.31px    (−0.55)
//   curated case 170px  +8.75  →  +1.24          8.79px  →  9.43px    (+0.64)
//
// (The 150px shelf book is not in that table on purpose: the same round resized it to its
// column, so its before and after are not the same object. Its BEFORE is where the 8px came
// from — silhouette +8.54, pool 9.52px.)
//
// The residual is the one honest imperfection and it is written down rather than rounded
// away. The feet sat at translateZ(-5px) and the shadow sits at translateZ(-40px), so under
// the 1600px perspective the same 8px of CSS travel renders as 7.98px there and 7.81px here;
// and the required travel is itself size-dependent — 7.58px at 150, 7.45px at 190, 7.35px at
// 220 — because the perspective origin sits at 42% of a height that changes. No single CSS
// rule is exact at every size. Both measured residuals are inside two thirds of one CSS pixel,
// which is the price of a number that can be re-derived from the ruling rather than fitted to
// a screenshot.
export const CONTACT_SHADOW_REBASE = {
  wasBottomPx: -16,
  isBottomPx: -8,
  // …because the silhouette rose by exactly this, which is BOTTOM_PAGE_BLOCK_REMOVED.removedDropPx.
  raisedByPx: 8,
  measuredPoolBefore: { window190: 8.86, curatedCase170: 8.79, shelf150: 9.52 },
  measuredPoolAfter: { window190: 8.31, curatedCase170: 9.43 },

  // ── R19.7 — THE SILHOUETTE, PROMOTED OUT OF THE PROSE ABOVE ────────────────────────────
  //
  // The table in the comment records "silhouette below box" on both sides of the removal.
  // Those numbers are the RULING ITSELF made measurable: the feet are gone, so the lowest
  // paint is the front face's own perspective overhang and nothing else. They are exact,
  // stable and independent of how a shadow rasterises — which makes them a far better pin on
  // "did the geometry move" than any reading of a blurred tail. Re-measured 26 Aug 2026 and
  // IDENTICAL to the value R16 recorded, to the hundredth of a pixel.
  silhouetteAfterPx: { window190: 1.55, curatedCase170: 1.24 },

  // ── R19.7 — THE POOL, RE-BASELINED. READ THIS BEFORE CHANGING A NUMBER HERE. ───────────
  //
  // THE FAILURE: boundbook.spec.mjs compared the pool against `measuredPoolBefore` — the
  // PRE-removal depth — with tolerancePx 1. On the window that assertion shipped with 0.45px
  // of headroom, because R16 itself measured and wrote down a −0.55 residual (8.86 → 8.31)
  // and explained above exactly why it cannot be zero: the same 8px of CSS travel renders as
  // 7.98px at translateZ(-5) and 7.81px at translateZ(-40), and the required travel is itself
  // size-dependent (7.58 / 7.45 / 7.35px at 150 / 190 / 220). The suite ran in no workflow, so
  // nobody saw it go red when the last 0.45px went.
  //
  // WHAT WAS MEASURED, 26 Aug 2026, same probe, same dsf 4, on the shipped export:
  //
  //                     silhouette      pool @0.75      pool @1.5     pool @3
  //   window      190   +1.55  ✓ R16    7.75            5.00          2.75
  //   curated case 170  +1.24  ✓ R16    9.31            6.56            —
  //
  // THE GEOMETRY IS RIGHT. Both silhouettes are byte-identical to R16's post-removal record,
  // `.bb-shadow` computes to bottom:-8px = isBottomPx, isBottomPx === wasBottomPx +
  // raisedByPx, and no call site renders feet. Nothing moved. What moved is the extreme TAIL
  // of a blur: the probe's threshold is 0.75 of 255 per channel, and where that cutoff lands
  // is a rasterisation fact, not a layout one — the curated case shifted 0.12px and the window
  // 0.56px over the same interval, in the same direction, with identical geometry.
  //
  // So the comparison target moves from "the depth before the feet came off" to "the depth
  // this ruling actually renders". The documented R16 residual belongs in the derivation, not
  // inside the drift budget. THE TOLERANCE IS UNCHANGED at 1px — widening it to make a test
  // pass would be fitting to a screenshot, which is the one thing this whole record exists to
  // avoid.
  measuredPoolNow: { window190: 7.75, curatedCase170: 9.31 },
  measuredOn: '2026-08-26',

  // The guard tests/bookstore/boundbook.spec.mjs uses: the pool may not drift further than
  // this from `measuredPoolNow` on a call site whose size did not change.
  tolerancePx: 1,
};

// ═════════════════════════════════════════════════════════════════════════════════════════
// R17.4 — THE SIDE PAPER, AS A PROPORTION
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// THE DEFECT, from the iPad walk: the web book's right fore-edge read as a wide slab of
// striated paper where the app's reads as a slim sliver.
//
// ⚠ AND THERE WAS NO SEPARATE APP GEOMETRY TO COPY. The app's lib/bookDepth.ts transcribed
// this element FROM THIS REPO's stylesheet at da3b53d — FORE_EDGE_W = 12 fixed, right:-11,
// 2.5% top/bottom insets, radius 0/2/2/0, the two paper tones in 1px vertical bands, and a
// shadow on the side edge only. Both platforms carry the identical fixed 12px. So the two
// books do not differ in their CSS at all; they differ in what a fixed 12px MEANS on the board
// each one happens to draw:
//
//     app, iPad          245.33pt board   12 / 245.33  =  4.891%      the look Ikenna ruled for
//     web, laptop shelf  200px  board     12 / 200     =  6.02%
//     web, Window        190px  board     12 / 190     =  6.33%
//     web, curated case  170px  board     12 / 170     =  7.07%
//     web, 390px handset 106px  board     12 / 106     = 11.26%       the slab
//
// A fixed width on a board that changes size is a different drawing at every size. THE RULING
// IS A PROPORTION, so that is what the width is now: the app's ratified iPad ratio, applied to
// whatever board the book is actually drawing.
//
// ── THE DERIVATION LIVES IN THE STYLESHEET, NOT IN A ROUNDED NUMBER ──────────────────────
//
// The rule below reads `calc(100cqw * 12 / 245.33)`, with BOTH SOURCE NUMBERS VERBATIM and the
// division done by CSS. It is deliberately not `4.891cqw`: a pre-multiplied constant is a
// number nobody can check, and the two facts it came from — the app's fixed width and the
// board it was ratified on — stop being visible the moment they are multiplied together. Same
// discipline as HERO_LOCKUP_AIR, which stores 1.211 and .9 and derives .1555 rather than
// storing .1555. The suites recompute the arithmetic from this record and fail if the
// stylesheet disagrees with it.
//
// ── THE FLOOR, AND ITS ONE JUSTIFICATION ─────────────────────────────────────────────────
//
// A proportion has no lower bound, and this drawing does: the paper is TWO TONES IN 1px BANDS,
// so a strip narrower than two bands cannot show the alternation that makes it read as stacked
// pages rather than as a beige line. 2px is that width — one band of each tone — and it is
// therefore the smallest stroke this design can draw and still be the thing it is drawing.
// It binds below a 41px board, which no surface on the shop renders; it exists so that a future
// one cannot make the edge vanish into anti-aliasing without noticing.
//
// ── THE TUCK IS 1px AT EVERY SIZE, AND DOES NOT SCALE ────────────────────────────────────
//
// The strip's left edge sits 1px inside the cover's right edge so the two never separate into
// a hairline gap. That is a SEAM, not a proportion — a seam is a seam at any size — so it stays
// a fixed pixel while the width around it moves: right = -(width - 1px).
//
// ⚠ THE RENDERED TUCK IS SMALLER THAN 1px AND THAT IS NOT AN ERROR. The strip sits at
// translateZ(-7px) inside a book rotated -9deg under a 1600px perspective, so 1px of CSS
// projects to 0.13-0.34px on the glass depending on the board's size. Measured, both sides,
// and written down rather than "corrected" — the same foreshortening CONTACT_SHADOW_REBASE
// records for the shadow's 8px. Correcting it would mean scaling a seam.
//
// ── THE APP IS NOT CHANGED BY THIS, YET ──────────────────────────────────────────────────
//
// The app still carries FORE_EDGE_W = 12 fixed, and therefore carries the SAME LATENT SLAB at
// phone sizes — its board is not 245.33pt on an iPhone either. The web leads here deliberately;
// the app mirrors this rule in a later round. Nothing below was copied from it, because there
// was nothing there to copy that did not start here.
export const FORE_EDGE = {
  ruledOn: '2026-08-20',
  ruling: 'Bring the web fore-edge to the app\'s iPad proportion exactly: a fraction of the board, not a fixed width.',
  // The two numbers the fraction is made of. NEVER pre-multiply these into a percentage — see
  // the note above, and `pct` below, which does the multiplication so nothing else has to.
  appFixedWidthPt: 12,
  appBoardWidthPt: 245.33,
  get ratio() { return this.appFixedWidthPt / this.appBoardWidthPt; },
  get pct() { return +(this.ratio * 100).toFixed(4); },
  // The smallest stroke this drawing can make and still be two tones — one 1px band of each.
  floorPx: 2,
  bandPx: 1,
  tones: ['#e6dfc8', '#d3caae'],
  // A seam, fixed at every size. right = -(width - tuckPx).
  tuckPx: 1,
  // The construction R17.4 did NOT change, asserted present by tests/bookstore/foreedge.test.mjs
  // so that "make it thinner" cannot quietly become "make it a plain stripe".
  insetPct: 2.5,                                  // shorter than the board, top and bottom
  radius: '0 2px 2px 0',
  bandAngleDeg: 90,                               // vertical bands down the side edge
  sideShadow: '1px 2px 6px rgba(0,0,0,.5)',
  // Regenerate both halves of the proof with `node scripts/capture-foreedge.mjs` (after a
  // build). It shoots the shipped page, then re-shoots it with THIS rule overridden by the one
  // R17.4 replaced, so the pair differs in exactly one declaration. Frames and the JSON they
  // were captioned from land in docs/r17-foreedge/.
  capturedBy: 'scripts/capture-foreedge.mjs',
  // MEASURED on the real page at deviceScaleFactor 3, both sides. `pct` is the fraction of the
  // board the strip actually occupied; `tuck` and `height` are the construction, which had to
  // survive unchanged. The height figures also answer a question the walk raised — whether the
  // block was reaching full board height somewhere. It was not: 95.2-95.6% everywhere, which
  // is the 2.5% insets doing their job at every size.
  measured: {
    'window-190':  { book: 190, before: { w: 12.04, pct: 6.33,  tuck: 0.31, h: 95.55 }, after: { w: 9.31, pct: 4.90, tuck: 0.31, h: 95.55 } },
    'curated-170': { book: 170, before: { w: 12.01, pct: 7.07,  tuck: 0.27, h: 95.48 }, after: { w: 8.32, pct: 4.89, tuck: 0.27, h: 95.45 } },
    'shelf-200':   { book: 200, before: { w: 12.05, pct: 6.02,  tuck: 0.34, h: 95.62 }, after: { w: 9.82, pct: 4.91, tuck: 0.34, h: 95.60 } },
    'shelf-106':   { book: 106, before: { w: 11.94, pct: 11.26, tuck: 0.13, h: 95.19 }, after: { w: 5.14, pct: 4.85, tuck: 0.13, h: 95.13 } },
  },
  // The band the suite holds the rendered fraction to. Sub-pixel: the strip is projected under
  // the perspective, so its painted width is never exactly the fraction of the flat board.
  tolerancePct: 0.25,
};

// Injected once per page (storefront, detail, modal). Keyed classes only — no dynamic values.
// ⛔ R22.1 — THE COVER GRAIN IS GONE FROM THE STYLESHEET BELOW.
//
// Ikenna ruled the grain out ENTIRELY on glass on 27 Aug 2026 — texture and all — and `.bb-grain`
// was the same stripe recipe as the page overlay, drawn twice per book: front face and back.
// Twenty-odd boards on a full shelf is forty-odd of them. Leaving it while removing the page
// layer would have been half a fix, which is precisely how R22 cost a round.
//
// The element is recorded verbatim in COVER_GRAIN_REMOVED in ./grain.js — including the reason
// `.bb-foreedge` STAYS. That rule is also a repeating-linear-gradient of 1px stripes and it is
// NOT a texture: it is the drawing, the book's stacked page edges in opaque paper tones, ruled
// in by R16 and R17 and transcribed into the app from this repo. A noise overlay is rgba
// white-over-black at low opacity across a whole surface; a page block is opaque ink in the
// shape of an edge. The ratchet in tests/bookstore/payload.spec.mjs is written to that
// distinction rather than to "no repeating gradients", which would have taken the pages with it.
//
// ⚠ THIS NOTE IS OUT HERE, NOT IN THE TEMPLATE LITERAL, and that is not a style choice. A CSS
// comment inside the literal ships to every visitor in the chunk — measured: the first draft of
// this note put 600 bytes of prose, and the string `bb-grain`, into the export and tripped the
// very ratchet it was explaining.
export const BOUND_BOOK_CSS = `
  /* R16 — THE BOOK IS SIZED BY ITS CONTAINER, NOT BY A NUMBER PASSED IN.
     --bb-w is the one input: a length from the caller (the Window's 190px, the detail page's
     220px) or 100% for a shelf book, which then takes the width of its column. Everything the
     component used to derive in JS from that number — the height, the ribbon, two font sizes —
     is derived here instead, in container-query units against this element's own width, so a
     percentage works exactly as a pixel value does.
     THE RATIOS ARE THE OLD ONES, unchanged:
       height    = w * 1.5           → aspect-ratio 2/3
       ribbon    = height * .32      = w * .48    → 48cqw
       obi type  = max(.42rem, w/320 rem)         → 5cqw  (16px at w=320)
       cover type= max(.62rem, w/190 rem)         → 8.421cqw (16px at w=190)
     The floors stay in rem so a reader who scales their type still gets the floor; the fluid
     half is in cqw and does not scale with it. That asymmetry is deliberate — a floor is a
     legibility promise, a ratio is a drawing. */
  .bb-persp{--bb-w:160px;container-type:inline-size;position:relative;
    width:var(--bb-w);aspect-ratio:2/3;
    perspective:1600px;perspective-origin:50% 42%;
    touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
  .bb-book{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateY(-9deg);
    transition:transform .95s cubic-bezier(.2,.72,.16,1);will-change:transform}
  .bb-book.bb-flipped{transform:rotateY(-178deg) translateY(-16px) scale(1.045)}
  .bb-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;
    border-radius:2px 5px 5px 2px;overflow:hidden}
  /* R29 - THE STAND-IN'S BOX. background-size and background-position come AFTER the
     shorthand on purpose: 'background:#0e0a16' resets both to their initial values, so
     declaring them first would silently do nothing. The colour stays underneath as the floor
     beneath the floor, for a board whose title has no stand-in yet.
     cover, against a 2:3 face and a 2:3 stand-in, is an exact fit and never crops.
     No image-rendering: the DEFAULT smooth upscale is what does the blurring. */
  .bb-front{background:#0e0a16;background-size:cover;background-position:center;box-shadow:8px 14px 46px rgba(0,0,0,.8),0 0 0 1px rgba(201,164,76,.1),inset -5px 0 12px rgba(0,0,0,.42)}
  .bb-back{transform:rotateY(180deg);background:#ece4cf;color:#2a2318;
    box-shadow:8px 14px 46px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.2),inset 5px 0 12px rgba(0,0,0,.14)}
  .bb-spine{position:absolute;top:0;bottom:0;left:0;width:13px;z-index:4;pointer-events:none;
    background:linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.2) 34%,rgba(255,255,255,.09) 50%,rgba(0,0,0,.22) 66%,rgba(0,0,0,.34) 100%)}
  .bb-back .bb-spine{left:auto;right:0;transform:scaleX(-1)}
  /* R17.4 — THE WIDTH IS A PROPORTION OF THE BOARD, and the two numbers it is made of are
     written here rather than multiplied together first: 12 is the app's fixed fore-edge, 245.33
     the iPad board it was ratified on, and CSS does the division. A pre-multiplied 4.891cqw
     would be the same drawing and an uncheckable number.

     ⚠ NO BACKTICKS IN THIS COMMENT. It is inside a template literal, and a backtick here does
     not raise a syntax error you can read — it ends the string and leaves a broken export that
     throws at render. CuratedSection.js carries the same warning for the same reason, having
     blanked the admin preview once. This comment quoted a class name in backticks and cost a
     build.

     The 2px floor is one band of each paper tone — the
     smallest stroke this drawing can make and still read as stacked pages. The 1px tuck under
     the cover is a SEAM and stays fixed while the width moves around it. See FORE_EDGE. */
  .bb-foreedge{--bb-fe-w:max(2px,calc(100cqw * 12 / 245.33));
    position:absolute;top:2.5%;bottom:2.5%;right:calc(1px - var(--bb-fe-w));width:var(--bb-fe-w);
    transform:translateZ(-7px);z-index:1;
    border-radius:0 2px 2px 0;background:repeating-linear-gradient(90deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);
    box-shadow:1px 2px 6px rgba(0,0,0,.5)}
  /* .bb-foreedge-b — THE FEET — is gone. See BOTTOM_PAGE_BLOCK_REMOVED at the head of this
     file for the ruling, the element verbatim, and the 8px the shadow below moved by. The
     RIGHT fore-edge one line above it stays. Its WIDTH stopped being 12px in R17.4 — see
     FORE_EDGE — but the element itself is exactly as kept. */
  .bb-sheen{position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(122deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.04) 26%,transparent 46%)}
  /* R16 — bottom was -16px, against a silhouette whose lowest paint was the feet at -8px.
     The feet went, so it rises by the same 8px and the pool it leaves below the book is the
     pool it always left. Nothing else about it changes: same size, same blur, same falloff,
     same z. See CONTACT_SHADOW_REBASE for the measurement on both sides. */
  .bb-shadow{position:absolute;left:7%;right:7%;bottom:-8px;height:24px;z-index:0;filter:blur(5px);
    transform:translateZ(-40px);background:radial-gradient(ellipse at center,rgba(0,0,0,.6) 0%,transparent 72%)}
  .bb-obi{position:absolute;left:0;right:0;bottom:9%;z-index:5;pointer-events:none;
    font-size:max(.42rem,5cqw);
    background:linear-gradient(180deg,#ece4cf,#ddd2b4);color:#2a2318;
    border-top:1px solid rgba(0,0,0,.14);border-bottom:1px solid rgba(0,0,0,.14);
    box-shadow:0 3px 10px rgba(0,0,0,.35);padding:.34em .1em;text-align:center;
    font-family:'Cinzel',serif;text-transform:uppercase;letter-spacing:.14em;font-weight:600}
  .bb-ribbon{position:absolute;top:-4px;right:15%;width:15px;height:48cqw;z-index:6;pointer-events:none;
    background:linear-gradient(180deg,#e8c877,#a8842f);box-shadow:0 3px 8px rgba(0,0,0,.5)}
  .bb-ribbon::after{content:'';position:absolute;left:0;right:0;bottom:-7px;height:8px;
    background:linear-gradient(180deg,#c9a44c,#a8842f);clip-path:polygon(0 0,100% 0,100% 100%,50% 55%,0 100%)}
  .bb-foil{background:linear-gradient(135deg,#f4e2a6 0%,#c9a44c 42%,#8f6d24 62%,#e8c877 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
  /* R17.3 — the cursor is on EVERY book, because every book now answers a press. The LIFT is
     still only on the surfaces that always had it: that is a look, and no ruling moved it. */
  .bb-book{cursor:pointer}
  @media (hover:hover){
    .bb-hoverable .bb-book:not(.bb-flipped):hover{transform:rotateY(-9deg) translateY(-9px)}
  }
  /* The fallback cover's foil title. Was Math.max(0.62, width/190) in rem, computed per
     instance; the same curve, in the container's own units. */
  .bb-cover-title{font-family:'Cinzel',serif;font-weight:600;font-size:max(.62rem,8.421cqw);
    line-height:1.2;margin-bottom:.5rem;letter-spacing:.02em}
  .bb-barcode{display:flex;gap:1px;align-items:flex-end;height:26px}
  .bb-barcode i{display:block;width:2px;background:#2a2318}
  @media (prefers-reduced-motion: reduce){
    .bb-book,.bb-book.bb-flipped{transition:none}
    .bb-book{transform:none}
    .bb-book.bb-flipped{transform:rotateY(180deg)}
    .bb-hoverable .bb-book:not(.bb-flipped):hover{transform:none}
  }
`;

// Varying bar widths for the faux barcode — deterministic (index-seeded), no randomness.
const BAR_WIDTHS = [2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 1, 2];

// R9.2 PL-20 — THE COVER'S alt IS EMPTY ON PURPOSE, and it is not an omission.
//
// The cover is decorative at every one of BoundBook's three call sites, because all three
// print the title as adjacent text: app/bookstore/page.js:76 (.entry-title on the shelf),
// :148 (.window-title in the window) and app/bookstore/[slug]/page-detail.js:268 (the <h1>).
// BackFace below prints it a fourth time. alt={title.title} therefore made a screen reader
// announce the same book twice in a row — once as an image, once as a heading — on a shelf
// of them. app/my-library/page.js:78 always had this right; this now matches it.
//
// IF A FOURTH CALL SITE EVER RENDERS A COVER WITH NO TITLE BESIDE IT, this has to change with
// it: alt="" on the only carrier of the name is a silent image, which is worse than the
// duplicate. tests/bookstore/gate.spec.mjs pins both halves for the shelf and the detail page.
function FrontFace({ title, sizes, eager }) {
  const hasCover = !!title.coverUrl;
  // R20 — THE RUNGS, AND WHY THIS IS A PLAIN <img> NOW.
  //
  // next/image was rendering `unoptimized` because output:'export' leaves no optimiser to
  // render through. In that mode it emits the src it was handed and NO srcset — which is how
  // a 3931x5156, 4567 KiB PNG came to be painted into a 104.7px board, and how a first paint
  // of this shop came to be 92.3% cover bytes. The `sizes` prop three lines below was already
  // commented "inert while next/image is unoptimized", and it was: measured, every cover on the
  // shipped page carried srcset="(none)".
  //
  // next/image has no srcSet prop — it derives one from a loader, and there is no loader in a
  // static export. So the rungs can only be reached through the element itself. next/image with
  // `fill` renders an <img> with position:absolute;inset:0;width:100%;height:100% and the
  // object-fit from `style`; that is reproduced EXACTLY below, and the pair harness asserts the
  // drawn box is unchanged at both widths. Every existing selector still matches: the tests,
  // gate.spec and the flip suite all query `.bb-front img`, which is what this still is.
  //
  // alt="" is unchanged and still deliberate — see the long note above.
  const srcSet = coverSrcSet(title);
  const src = coverSrc(title);
  // ══ R29 - THE STAND-IN ══════════════════════════════════════════════════════════════════
  //
  // Ikenna's ruling: a board never shows an empty plate while its cover is in flight. R28
  // measured that plate standing empty for 1.9s and 5.6s on Fast 3G and 7.8s and 23.7s on
  // Slow 3G, per cover, on the storefront.
  //
  // ⚠ IT IS A FLOOR AND IT CANNOT BE ANYTHING ELSE, WHICH IS THE POINT OF DOING IT THIS WAY.
  //
  // The stand-in is the BACKGROUND of the face. The cover is an <img> at inset:0 with
  // object-fit:cover on top of it. So THE INSTANT THE IMAGE HAS PIXELS IT OCCLUDES THE
  // BACKGROUND COMPLETELY. There is no `loaded` state, no effect, no decision: the browser's
  // own paint order is what makes this a floor, so the stand-in cannot outrank the cover for
  // even one frame, cached or not.
  //
  // That is the defect the app hit and had to correct by making the cached rung beat the
  // blurhash. The correction is not needed here because the failure mode is unreachable:
  // there is nothing in front of the image to rank against it.
  //
  // ⚠ WHAT A WARM CACHE STILL COSTS, STATED HONESTLY because the suite measures it and an
  // overstated comment here would read as a promise the code does not make. An <img> whose
  // bytes are already in the HTTP cache is STILL resolved asynchronously: the element is
  // created, and the cache read lands a tick later. Measured over six warm reloads of the
  // detail page, that is 0-2 frames (~40ms) in which the board shows the stand-in and not the
  // cover. No markup closes that gap - and before this round those same frames drew the flat
  // rgb(14,10,22) plate, so the stand-in took nothing from the cached cover; it filled a frame
  // that was empty. tests/bookstore/cover-standin.spec.mjs pins the two statements separately:
  // never in front of a cover that HAS pixels (the app's defect), and a warm window that
  // closes at once.
  //
  // NO ANIMATION, and none is possible. The handover is the image arriving over the
  // background. Nothing transitions, nothing fades, nothing is mounted or unmounted - R23, R26
  // and R27 each removed one of those and this round does not put one back.
  //
  // NO NEW ELEMENT AND NO NEW LAYER. This is a background on the face the board already draws,
  // so the shelf's composited layer count is untouched - R27 recovered 41 of them and
  // payload.spec.mjs holds the ceiling at 260.
  //
  // The corner and edge treatment come free: .bb-face carries the border-radius and
  // overflow:hidden, so the stand-in is clipped exactly as the cover is, behind the spine and
  // the sheen, which are drawn after it.
  const standIn = hasCover ? coverLqip(title) : null;
  return (
    <div
      className="bb-face bb-front"
      style={standIn ? { backgroundImage: `url("${standIn}")` } : undefined}
    >
      {hasCover ? (
        /* eslint-disable-next-line @next/next/no-img-element --
           The rule's advice is to use next/image "to automatically optimize images". There is
           no optimiser to use: next.config.mjs sets output:'export', which forces
           images.unoptimized and makes next/image emit the src it was handed with no srcset at
           all. Following the rule here is what produced a 4567 KiB cover in a 104.7px board.
           The rungs are cut at upload time instead — see app/lib/bookstore/covers.js — and
           tests/bookstore/payload.spec.mjs budgets the result. */
        <img
          src={src}
          srcSet={srcSet}
          // `sizes` is only meaningful alongside a srcset; without rungs it would tell the
          // browser about a choice it does not have.
          sizes={srcSet ? sizes : undefined}
          alt=""
          // THE SHELF STAYS LAZY. Only a board that IS the largest paint on its page loads
          // eagerly, which is the detail page's board and nothing else — the Window's book sits
          // below an 88vh hero, so eager-loading it would buy a slower first paint, not a
          // faster one.
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          decoding="async"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: gradientFor(title.slug || title.title), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.4rem 1rem', textAlign: 'center' }}>
          <div className="bb-foil bb-cover-title">{title.title}</div>
          <div style={{ width: '30px', height: '1px', background: 'rgba(232,200,119,.5)', margin: '.2rem 0 .5rem' }} />
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.62rem', letterSpacing: '.08em', color: 'rgba(240,234,216,.5)' }}>{title.author}</div>
        </div>
      )}
      <div className="bb-spine" />
      <div className="bb-sheen" />
    </div>
  );
}

function BackFace({ title }) {
  const [currency] = useCurrency();
  const opening = resolveOpeningLine(title);
  const blurb = resolveBackBlurb(title);
  // R8.3: the effective price, and the mark when it is not the one being browsed in. The
  // back face is printed matter — cream stock, brown ink — so the mark takes its muted tone
  // from THAT palette rather than from the dark shelf's.
  // R8.4: and no price at all when the book is not licensed here, because a price printed on a
  // back cover is the strongest claim the shop makes that a sum of money will buy this book.
  const country = useRegionCountry();
  const { price, note } = priceLine(title, currency, country);
  const cat = formatCatalogueNumber(title.catalogueNumber);
  return (
    <div className="bb-face bb-back">
      <div className="bb-spine" />
      <div style={{ position: 'absolute', inset: 0, padding: '11% 12% 9% 15%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: '#5a4a2a', marginBottom: '.6rem' }}>{title.title}</div>
        {opening && (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.72rem', lineHeight: 1.5, color: '#3a3020', marginBottom: '.55rem' }}>&ldquo;{opening}&rdquo;</div>
        )}
        {blurb && (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.66rem', lineHeight: 1.55, color: 'rgba(42,35,24,.72)', flex: 1, overflow: 'hidden' }}>{blurb}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '.5rem', marginTop: 'auto', paddingTop: '.6rem' }}>
          {cat !== null ? (
            <div>
              <div className="bb-barcode" aria-hidden="true">
                {BAR_WIDTHS.map((w, i) => <i key={i} style={{ width: `${w}px`, height: `${16 + ((i * 7) % 10)}px` }} />)}
              </div>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.5rem', letterSpacing: '.1em', color: '#2a2318', marginTop: '2px' }}>{cat}</div>
            </div>
          ) : <span />}
          {/* R8.4 — the mark no longer hangs off the price. A territory-restricted title has
              NO price to print (priceLine withholds it) and yet is exactly the case that most
              needs its line, so the block renders for either. */}
          {(price || note) && (
            <div style={{ textAlign: 'right' }}>
              {price && (
                <>
                  <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 700, fontSize: '.82rem', color: '#2a2318' }}>{price}</div>
                  <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.44rem', letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(42,35,24,.6)' }}>ebook</div>
                </>
              )}
              {/* R8.3. Brown ink on cream stock, not the shelf's vellum-on-black — the back
                  face is printed matter and the mark has to belong to it. */}
              {note && (
                <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '.52rem', color: 'rgba(42,35,24,.62)', marginTop: '1px' }}>{note}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// R17.3 — EVERY BOOK ON THE SHOP TURNS OVER, AND THE HANDLER LIVES WHERE THEY SHARE IT
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// THE DEFECT, from the walk of the live site: a book on the shop grid flipped on tap; the book
// in the Window and the book in a curated case did not. One shop, two grammars, and no reason
// a reader could infer — the same object, drawn by the same component, answering a tap on one
// shelf and ignoring it on another.
//
// THE CAUSE was not a missing handler at those two sites. It was WHERE the handler lived. The
// gesture sat in a wrapper — `ShelfBook` in app/bookstore/page.js — that called useBookGesture
// and spread the result into BoundBook as `flipped` / `bind` / `bookRef`. Exactly one surface
// used that wrapper. Every other surface rendered BoundBook directly and therefore got a book
// with no listeners, which looks completely correct in review: the props were optional and the
// JSX read fine.
//
// ⚠ SO THE FIX IS NOT "CALL useBookGesture IN THREE MORE PLACES". Three copies of a gesture is
// three places for a fourth surface to be forgotten, and forgetting is exactly what happened.
// The handler moved INTO THIS COMPONENT, and the three props that let a caller supply its own
// were REMOVED rather than left as an override. That is the whole guarantee: there is no way
// to render a BoundBook without a gesture, because there is no longer a prop that turns one
// off. A fourth surface added next year gets the flip whether or not anyone remembers to.
//
// ── WHAT A TAP LEADS TO, PER SURFACE ─────────────────────────────────────────────────────
//
// The FLIP is universal. What the flip leads INTO is the surface's own way in, and there are
// only two answers: the storefront's Quick Look, or back to the front cover. A surface passes
// `onOpen` when it has a modal to open; useBookGesture turns the book back when it has not, so
// a book is never left face-down with nothing to press.
//
// ── ACCESSIBILITY, STATED PLAINLY BECAUSE IT IS A GAP AND NOT A DESIGN ───────────────────
//
// The grid's gesture was pointer-only — touchstart/move/end, contextmenu, click, on a plain
// <div> with no tabIndex, no role and no key handler. Moving it here carries that to the other
// surfaces IDENTICALLY, which is what was asked, and identically is also the honest word for
// it: keyboard users could not flip a book before this change and cannot flip one now.
//
// What saves it from being a content gap is that THE FLIP IS DECORATIVE FOR ASSISTIVE TECH.
// Both faces are in the DOM at all times — backface-visibility hides a face from the eye, not
// from the accessibility tree — so the back cover's opening line, blurb, catalogue mark and
// price are announced on every surface whether or not the book has been turned. The flip shows
// a sighted reader something a screen reader already had.
//
// tests/bookstore/flip.spec.mjs asserts the parity as a PROPERTY rather than a level: every
// surface's book carries the same attribute set. If the grid ever gains a real keyboard
// affordance, the suite fails until the others have it too.
export const BOOK_SURFACES = {
  ruledOn: '2026-08-20',
  ruling: 'One interaction grammar: every BoundBook on the shop flips on tap, whatever surface holds it.',
  // The register. A `<BoundBook` call site anywhere in the tree that is not listed here fails
  // tests/bookstore/flip.test.mjs — which is how a fourth surface is stopped from shipping a
  // dead book quietly. `opens` is what a completed tap leads to.
  surfaces: [
    { key: 'shelf',        file: 'app/bookstore/page.js',                    component: 'ShelfEntry',   opens: 'quick-look' },
    { key: 'window',       file: 'app/bookstore/page.js',                    component: 'TheWindow',    opens: 'quick-look' },
    { key: 'curated-case', file: 'app/bookstore/components/CuratedSection.js', component: 'CuratedCase', opens: 'quick-look' },
    // The detail page IS the quick look. A modal repeating the page you are standing on is not
    // a way in, so the book turns back instead — the gesture is the same, its destination is
    // the only honest difference.
    { key: 'detail',       file: 'app/bookstore/[slug]/page-detail.js',      component: 'BookDetailClient', opens: 'turns-back' },
  ],
  // The props that USED to let a caller own the gesture. Their absence is the guarantee, so
  // they are named here and asserted absent rather than simply deleted and forgotten.
  retiredProps: ['flipped', 'bind', 'bookRef'],
};

/**
 * @param width   a CSS length. A NUMBER is pixels, exactly as it always was — the Window's 190,
 *                the curated case's 170, the detail page's 220 all pass one and render at the
 *                same size they always have. A STRING is used verbatim, which is how a shelf
 *                book takes the width of its column: `width="100%"`. Everything the component
 *                used to compute off the number is now derived in CSS from the element's own
 *                width, so the two forms cannot diverge. See the note on .bb-persp.
 * @param onOpen  (title, rect, reset) => void. The surface's way in, called after the back
 *                cover has breathed. OMIT IT and the book turns back instead — see
 *                BOOK_SURFACES. It is not a switch for the gesture; there isn't one.
 */
export default function BoundBook({ title, variant = 'shelf', width = 160, ribbon, onOpen, hoverable }) {
  // `reset` is referenced by the callback before the destructuring completes, and that is fine:
  // the callback cannot run until a finger has been on the glass. Same shape ShelfBook used.
  const { flipped, bind, bookRef, reset } = useBookGesture({ onOpen: onOpen ? (rect) => onOpen(title, rect, reset) : undefined });
  const cssWidth = typeof width === 'number' ? `${width}px` : width;
  const showRibbon = ribbon ?? variant === 'window';
  const obi = obiLabel(title);
  // The HOVER LIFT stays where it already was — it is a look, and no ruling moved it. The
  // POINTER CURSOR is a different thing and now applies to every book, because every book is
  // now pressable and a pressable object that says otherwise is the discoverability bug this
  // round exists to fix. See .bb-book / .bb-hoverable in the stylesheet.
  const canHover = hoverable ?? (variant === 'shelf' || variant === 'detail');
  // R20 — THIS LINE IS NO LONGER INERT. It was written against the day next/image stopped
  // being `unoptimized`; that day never came (a static export has no optimiser), so FrontFace
  // now carries the rungs itself and this is what tells the browser which one to take.
  //
  // R26 — THE EXPRESSION MOVED, THE NUMBER DID NOT. It now lives in
  // app/lib/bookstore/board.js, a module with no 'use client', because the detail page's
  // SERVER component has to state the same `sizes` in its <link rel="preload"> or the preload
  // warms a rung the <img> never draws. Still one expression in the tree; see that file.
  const sizes = boardSizes(width);

  // R22C — THE MARKER AND THE WAY BACK.
  //
  // `data-bb-slug` is how a link to /bookstore/{slug} finds the board it should carry — see
  // armBookTransition() in ./bookTransition.js. It is an ATTRIBUTE and not a ref registry
  // because the shop draws boards from four different components on two pages, and a registry
  // would need every one of them to remember to enrol.
  //
  // The `cs-book-unflip` listener is the other half. A book that has been turned over shows its
  // back, and `backface-visibility:hidden` means its front is not painted — so a view
  // transition that snapshotted it would capture nothing and fall back to a cross-fade, which
  // is the cover blinking out. Arming therefore asks the book to turn back first. A
  // CustomEvent rather than a prop: the gesture's `reset` lives inside useBookGesture and the
  // link that needs it is in a modal three components away, and threading a callback through
  // all of them would be a prop every future surface has to remember — the exact failure
  // BOOK_SURFACES was written about.
  const bookHostRef = useRef(null);
  useEffect(() => {
    const el = bookHostRef.current;
    if (!el) return undefined;
    const onUnflip = () => reset();
    el.addEventListener('cs-book-unflip', onUnflip);
    return () => el.removeEventListener('cs-book-unflip', onUnflip);
  }, [reset]);

  return (
    <div
      ref={bookHostRef}
      className={'bb-persp' + (canHover ? ' bb-hoverable' : '')}
      style={{ '--bb-w': cssWidth }}
      {...{ [BOOK_SLUG_ATTR]: title?.slug || undefined }}
      {...bind}
    >
      <div className="bb-shadow" />
      <div ref={bookRef} className={'bb-book' + (flipped ? ' bb-flipped' : '')}>
        {/* The RIGHT fore-edge. The bottom one was removed by R16 — see
            BOTTOM_PAGE_BLOCK_REMOVED at the head of this file. */}
        <div className="bb-foreedge" />
        <FrontFace title={title} sizes={sizes} eager={variant === 'detail'} />
        <BackFace title={title} />
        {showRibbon && <div className="bb-ribbon" />}
        {obi && <div className="bb-obi">{obi}</div>}
      </div>
    </div>
  );
}
