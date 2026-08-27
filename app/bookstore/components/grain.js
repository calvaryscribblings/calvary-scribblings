// ═════════════════════════════════════════════════════════════════════════════════════════
// THE GRAIN — REMOVED. THIS FILE IS THE RECORD, AND NOTHING IMPORTS IT.
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// ⛔ R22.1 — IKENNA'S RULING, 27 August 2026, ON GLASS. THIS SUPERSEDES R22.
//
//   "It looks really bad... let's just go back to having dark background."
//
// He walked production on an iPhone at 01:38 and again at 05:45 and the shimmer/horizontal
// lines were still there across the whole page. THE LAYER IS OUT — texture and all. Not the
// animation, which R22 had already taken: THE TEXTURE. There is no grain overlay on the
// shipped site. The background is the plain dark ground, #070707, and nothing is drawn over it.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHY R22 DID NOT FIX IT, WHICH IS THE PART WORTH READING BEFORE ANYTHING ELSE
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// R22 shipped at 6fa7b217 and R22.1 opened with a three-way suspicion: a service worker
// serving the old bundle, a deploy that never landed, or a second grain site nobody had swept.
// ALL THREE WERE CHECKED AGAINST THE LIVE SITE, ANONYMOUSLY, AND ALL THREE WERE INNOCENT.
//
//   the SERVICE WORKER   /bookstore is in public/sw.js's PASS_THROUGH_PATHS, so its document
//                        is never intercepted, online or off. Chunks are content-hashed and
//                        cached under a per-build key, so a new build's grain rule arrives at
//                        a URL no cache has ever seen. Live sw.js was stamped 6fa7b21744ce —
//                        R22's own commit.
//   the DEPLOY           landed. The live entry chunk carried R22's grain rule verbatim, with
//                        no `animation` and no `grainShift` anywhere in the export.
//   a SECOND SITE        real, but not the one on his screen: .bb-grain, the same stripe
//                        recipe on every book cover. Removed by this round too — see
//                        COVER_GRAIN_REMOVED below.
//
// ⭑ SO NOTHING KEPT R22 OFF HIS GLASS. R22 REACHED HIM. IT FIXED THE WRONG HALF.
//
// The artefact was never the redraw. It is the TEXTURE ITSELF. Two repeating-linear-gradients
// with colour stops at 1px/2px and 1px/3px are a stripe pattern at a fixed period in CSS
// pixels; on a device at devicePixelRatio 3 that period does not land on the device grid, and
// the resampling folds it into wide low-frequency BANDS. Scroll the page and the phase moves
// under the bands, so they crawl — which is exactly "shimmer" and "horizontal lines", and
// which no amount of removing `animation:` can touch, because the page moving under a
// fixed-period stripe pattern IS the animation.
//
// That is why the ruling is now the whole layer and not a property of it. A future round
// tempted to bring the texture back at a lower opacity, or a coarser period, or "just on
// desktop", is proposing the same physics with a smaller coefficient.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE IS NOW
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// A RECORD, NOT A COMPONENT. It exports no CSS and no class name, and NOTHING IMPORTS IT —
// app/bookstore/page.js and app/bookstore/[slug]/page-detail.js both dropped their import in
// R22.1. That is deliberate and it is load-bearing twice over:
//
//   · a module with no importer cannot be rendered back by accident, and
//   · the removed strings below never reach the bundle, so the ratchet in
//     tests/bookstore/payload.spec.mjs can scan the WHOLE of out/ for them — HTML, CSS *and*
//     the JS chunks, which is where the grain rule actually lived — without the record itself
//     tripping it. (⚠ R22's ratchet scanned only .html and .css. The grain was in a chunk. It
//     would never have caught a restoration, and that is why this round's scans .js too.)
//
// Everything below is kept verbatim so a restoration is a COPY and not a reconstruction, and
// so the two earlier rulings can still be read by whoever comes to reverse this one. The way
// back is on the record. Taking it is Ikenna's call and nobody else's.

// ── THE RULING, AND THE TWO IT SUPERSEDES ────────────────────────────────────────────────
export const GRAIN_REMOVED = {
  ruledBy: 'Ikenna',
  on: '2026-08-27',
  ruling: "It looks really bad... let's just go back to having dark background.",
  seenOn: 'iPhone Safari, production, 01:38 and 05:45 — the shipped R22 build',
  removed: 'the whole layer — texture and animation. There is no grain overlay on the site.',
  ground: '#070707',
  // Why the thing R22 removed was not the thing he was looking at. See the header.
  whyR22DidNotFix: 'the artefact is the texture, not the redraw: a 1px/2px stripe period '
    + 'resampled at DPR 3 folds into moire bands, and scrolling moves their phase. Stopping '
    + 'the CSS animation cannot stop that.',
  // Checked against the live site before anything was changed. All three were innocent.
  ruledOutBeforeChanging: {
    serviceWorker: '/bookstore is in PASS_THROUGH_PATHS; chunks are content-hashed per build. '
      + 'Live sw.js stamped 6fa7b21744ce, which is R22.',
    deploy: 'landed — the live chunk carried R22\'s grain rule, with no animation and no grainShift',
    secondSite: '.bb-grain on every cover. Real, and also removed this round — but not what was '
      + 'covering "the whole page".',
  },
  // ⚠ THE SUPERSESSION, NAMED. R22's header said "the TEXTURE IS UNTOUCHED"; R20's said the
  // grain travels with the page. Both were rulings about a layer that no longer exists.
  supersedes: [
    { round: 'R22', on: '2026-08-26', said: 'the shimmer goes, the texture stays' },
    { round: 'R20', on: '2026-08-26', said: 'the grain is un-fixed — it travels with the page' },
  ],
};

// ── THE PAGE GRAIN, VERBATIM ─────────────────────────────────────────────────────────────
// One full-bleed overlay, first child of <main> on the storefront and on every detail page.
export const PAGE_GRAIN_REMOVED = {
  wasClass: 'bookstore-grain',
  wasBleedPx: 16,
  wasCss: '.bookstore-grain{position:absolute;inset:-16px;z-index:1;pointer-events:none;opacity:.05;min-height:calc(100vh + 32px);background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.6) 0,rgba(0,0,0,.6) 1px,transparent 1px,transparent 2px),repeating-linear-gradient(90deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 3px)}',
  wasMarkup: '<div className={GRAIN_CLASS} aria-hidden="true" />',
  wasRenderedBy: ['app/bookstore/page.js', 'app/bookstore/[slug]/page-detail.js'],
  // R22 had already taken these. Kept because a restoration would otherwise reconstruct them.
  wasKeyframeName: 'grainShift',
  wasKeyframes: '@keyframes grainShift{0%{transform:translate(0,0)}10%{transform:translate(-3px,-2px)}20%{transform:translate(-8px,4px)}30%{transform:translate(3px,-8px)}40%{transform:translate(-2px,9px)}50%{transform:translate(-8px,3px)}60%{transform:translate(4px,-2px)}70%{transform:translate(-4px,6px)}80%{transform:translate(6px,3px)}90%{transform:translate(-2px,-4px)}}',
  wasDeclaration: 'animation:grainShift 8s steps(10) infinite',
  // R20's positioning ruling, which governed where it hung. Moot now; recorded so the argument
  // does not have to be had again from scratch if it ever comes back.
  wasPositioning: 'absolute, first child of a position:relative <main>, so it was as tall as the document',
  wasFixedPositioningBefore: 'position:fixed;inset:-50%;z-index:1;pointer-events:none;opacity:.05',
};

// ── THE COVER GRAIN, VERBATIM ────────────────────────────────────────────────────────────
// The SECOND grain site, found by the sweep this round asked for. Same stripe recipe, drawn
// twice per book — front face and back face — on every board on the shelf and on the detail
// page's own board. Twenty-odd books on a full shelf is forty-odd of these.
//
// ⚠ WHAT WAS DELIBERATELY *NOT* REMOVED, AND THE DISTINCTION IS THE WHOLE POINT:
// `.bb-foreedge` is also a repeating-linear-gradient of 1px stripes. It STAYS. It is not a
// texture laid over the drawing — it IS the drawing: the stacked page edges of the book, in
// opaque paper tones (#e6dfc8 / #d3caae), at the object's own scale, ruled in by R16 and R17
// and transcribed into the app from this repo. Removing it would revert a ruling and break
// cross-repo parity. A NOISE OVERLAY IS rgba WHITE-OVER-BLACK AT LOW OPACITY ACROSS A WHOLE
// SURFACE; A PAGE BLOCK IS OPAQUE PAPER INK IN THE SHAPE OF AN EDGE. The ratchet is written
// to that distinction rather than to "no repeating gradients", which would have taken the
// book's pages with it.
export const COVER_GRAIN_REMOVED = {
  ruledBy: 'Ikenna',
  on: '2026-08-27',
  reason: 'the same stripe recipe as the page grain, on every cover. Left in place it would '
    + 'have been half a fix — which is precisely how R22 cost a round.',
  wasClass: 'bb-grain',
  wasCss: '.bb-grain{position:absolute;inset:0;pointer-events:none;opacity:.06;mix-blend-mode:overlay;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 2px),repeating-linear-gradient(90deg,rgba(255,255,255,.4) 0,rgba(0,0,0,.4) 1px,transparent 1px,transparent 3px)}',
  wasMarkup: '<div className="bb-grain" />',
  wasRenderedBy: ['app/bookstore/components/BoundBook.js — FrontFace and BackFace'],
  // Everything on the book that this round did not touch, named individually so a later
  // "tidy the gradients" edit has to argue with a list rather than with a silence.
  keeps: [
    'bb-foreedge',  // the page block — the drawing, not a texture. See the block above.
    'bb-sheen',     // one soft linear-gradient highlight. No repetition, no stripe, no period.
    'bb-spine', 'bb-obi', 'bb-ribbon', 'bb-shadow', 'bb-foil', 'bb-barcode',
  ],
};

// ── THE BETA PAGE'S GRAIN, VERBATIM ──────────────────────────────────────────────────────
// THE THIRD SITE, and the only one the ruling named by technique. public/beta.html is a
// hand-written static page served byte-for-byte from public/, so the sweep that found the two
// React ones would have missed it entirely if it had only read app/. It carried a FIXED
// full-viewport feTurbulence tile at 0.6 opacity — the "dust on the lens" arrangement R20 had
// already ruled out on the shop, still standing here a week later because nobody had looked.
//
// ⚠ THE RECORD LIVES HERE AND NOT IN THAT FILE. beta.html is shipped verbatim, so a verbatim
// record in its own comments would send the removed layer's source to every visitor and would
// trip the ratchet that scans the export for exactly these strings. The comment left in
// beta.html points here instead.
export const BETA_PAGE_GRAIN_REMOVED = {
  ruledBy: 'Ikenna',
  on: '2026-08-27',
  file: 'public/beta.html',
  wasSelector: 'body::after',
  wasCss: "body::after{content:'';position:fixed;inset:0;background-image:url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E\");background-size:200px 200px;opacity:0.6;pointer-events:none;z-index:0}",
  // What was NOT removed: the page's own ground.
  keeps: 'body::before — the radial-gradient ground. A dark background is not a texture.',
};

// ── THE BENCH, WHICH OUTLIVES THE LAYER IT MEASURED ──────────────────────────────────────
// `npm run bench:grain` and scripts/bench-grain-frames.mjs STAY, on purpose. R22 built the
// harness that reproduced R20's baseline and honestly failed to reproduce its loaded arm, and
// that is a finding about the measurement, not about the grain. It is kept for the record and
// because the next expensive full-bleed layer will want it. It no longer has an arm to load:
// there is no grain to switch on.
export const GRAIN_BENCH = {
  command: 'npm run bench:grain',
  keptBecause: 'the harness is the finding as much as the number is. It reproduced R20\'s '
    + 'baseline and did not reproduce R20\'s loaded arm, and the next expensive full-bleed '
    + 'layer will want it.',
  // ── R22.1's ARMS, AND THEY ARE NOT R22's ────────────────────────────────────────────────
  // R22 compared a shimmering texture against a static one. There is no static arm now, so the
  // script compares THE WHOLE LAYER against nothing — R20's "absolute + animated" against its
  // "removed entirely", the widest of the three comparisons it ever drew. Measured on this
  // container, /bookstore at 1280, medians of three interleaved wheel-scrolls:
  r221Figures: { wholeLayer: '47.4%', asShipped: '31.8%', cost: '15.6 points' },
  // ⚠ AND THE ABSOLUTES MOVED BETWEEN SESSIONS WHILE THE DELTA DID NOT. R22 read its shipped
  // arm at 20.8% and R22.1 reads a lighter page at 31.8% — the container was simply busier on
  // the 27th. QUOTE THE DELTA, NEVER THE ABSOLUTE: 15.6 points is measured the same way on both
  // sides of one run, and it is the only figure here that survives a change of machine.
  absolutesAreNotComparable: 'the same page reads 20.8% on one day and 31.8% on another. Only '
    + 'the within-run delta is a measurement of the grain.',
  r22Figures: { withShimmer: '34.1%', withoutShimmer: '20.8%', cost: '13.3 points' },
  r20Figures: { animated: '42.7%', animationNone: '19.3%', removedEntirely: '13.1%' },
  // What the shop now serves: R20's cheapest arm, the one it called "removed entirely".
  nowShipping: 'removed entirely',
};
