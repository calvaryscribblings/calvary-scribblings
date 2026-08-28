// R20 — THE BOOKSTORE'S COVER RUNGS.
//
// WHAT THE MEASUREMENT FOUND. A first paint of /bookstore was 15.7 MiB at 1280 and 11.2 MiB
// at 390, of which 92.3% and 89.2% respectively were cover bitmaps. The whole 21-title
// catalogue is 33.74 MiB as served — raw admin uploads, PNG and JPEG, up to 3931x5156 — and
// the board they are drawn into is 104.7px wide on a handset and 197.6px on a laptop. The
// worst single file, yahoo-yahoo.png, is 4567 KiB of 3931x5156 painted into 104.7x159.8: a
// 37.5x linear oversample, about 1400x by area. Re-encoded at the rungs below the same 21
// covers come to 474 KiB.
//
// WHY THERE IS NO IMAGE OPTIMISER TO DO THIS. next.config.mjs sets output:'export' and
// images.unoptimized:true, which is not a preference — a static export has no server to
// resize on demand, so next/image emits the src it was given and no srcset at all. The
// derivatives therefore have to exist as REAL OBJECTS somewhere before the browser asks for
// them. There are only two moments that can make them: the CMS upload (the door every cover
// comes through) and a backfill for the covers that predate the door. Both exist, and both
// write to the same paths this module names.
//
// THIS IS NOT A NEW IDEA IN THIS REPO. cms_stories has carried coverSizes:{w360,w720} since
// the covers work, app/components/CoverImage.js renders them, and /admin/voices and the
// stories CMS both cut their own derivatives in the browser. The bookstore is the one image
// surface that never got it. Everything below is deliberately the SAME shape as those —
// same widths, same WebP quality, same 'w' key prefix — so there is one pattern on this
// platform and not three.
//
// ── THE PATH IS FLAT, AND THAT IS A RULE RATHER THAN A STYLE ────────────────────────────────
// storage.rules matches `bookstore_covers/{titleId}` — a SINGLE path segment. A derivative at
// `bookstore_covers/basil/w360.webp` matches no rule at all and is denied both read and write.
// This is exactly the trap R18's author photograph already fell into and documented (see
// app/lib/bookstore/author.js), and the answer is the same one: a flat sibling KEY with a
// suffix a title slug cannot produce. SLUG_RE in schema.js is /^[a-z0-9]+(-[a-z0-9]+)*$/, so a
// title id can carry hyphens but never an underscore — `basil_w360.webp` cannot collide with
// the cover of a title legitimately slugged `basil-w360`.
//
// NO RULES CHANGE IS NEEDED FOR ANY OF THIS. The existing cover rule already grants public
// read and admin write under 5 MB for image/* on this prefix, which is precisely what a
// derivative is. And `coverSizes` rides onto the title record the way samplePath, glossary,
// catalogueNumber and the R18 author block already do — schema-external, spread through by
// the loader, with no $other deny in database.rules.json to refuse it.

export const COVER_PREFIX = 'bookstore_covers';

// The two rungs, matching cms_stories exactly. They are DPR-driven, not breakpoint-driven,
// which is why two cover every board this shop draws:
//
//   360w — the 104.7px shelf board at DPR3 (314), the 197.6px laptop board at DPR1
//   720w — the 197.6px laptop board at DPR3 (593), the 220px detail board at DPR3 (660)
//
// A third rung at 180w would fit the handset board at DPR1 more tightly, and it is
// deliberately not here: the 360w file is 22 KiB on average, so the rung would save single-
// digit kilobytes per board while adding a third object per title to upload, back-fill and
// keep in step. The story library settled on the same two for the same reason.
export const COVER_DERIVATIVE_WIDTHS = [360, 720];
export const coverSizeKey = (w) => `w${w}`;

/**
 * The Storage key for one derivative. Flat sibling of the cover — see the header.
 * `ext` is the encoder's actual output, never assumed: encodeBest falls back to JPEG on a
 * browser with no WebP encoder, and a path claiming .webp for JPEG bytes would be a lie the
 * cache keeps for a year.
 */
export function coverDerivativePath(titleId, width, ext) {
  const e = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `${COVER_PREFIX}/${titleId}_${coverSizeKey(width)}.${e}`;
}

/**
 * The srcset, or undefined for a title with no derivatives yet.
 *
 * UNDEFINED IS A SUPPORTED ANSWER, not a failure. A title uploaded before the CMS cut
 * derivatives, or one whose encode failed on a browser with neither WebP nor JPEG, has no
 * coverSizes — and then the <img> falls back to `src` alone, which is exactly the behaviour
 * that shipped before this round: heavier, and correct. Nothing on the shelf is allowed to
 * render blank because a performance optimisation was unavailable.
 *
 * THE ORIGINAL IS NOT A RUNG. CoverImage adds it as a 1600w rung for the story HERO only, and
 * a book board is never a hero: the largest it is drawn anywhere in this shop is 220px, so the
 * 720w rung already covers DPR3 with room. Offering a 4567 KiB original as a rung would let a
 * wide-viewport browser choose it and undo the entire round.
 */
export function coverSrcSet(title) {
  const sizes = title?.coverSizes;
  if (!sizes) return undefined;
  const rungs = COVER_DERIVATIVE_WIDTHS
    .filter((w) => sizes[coverSizeKey(w)])
    .map((w) => `${sizes[coverSizeKey(w)]} ${w}w`);
  return rungs.length ? rungs.join(', ') : undefined;
}

/**
 * The src a board should request when it has derivatives: the SMALLEST rung, never the
 * original. `sizes` decides which rung a modern browser actually fetches; `src` is only the
 * fallback for a browser that ignores srcset, and the fallback should be the light one.
 */
export function coverSrc(title) {
  const sizes = title?.coverSizes;
  for (const w of COVER_DERIVATIVE_WIDTHS) {
    const u = sizes?.[coverSizeKey(w)];
    if (u) return u;
  }
  return title?.coverUrl || null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// R29 — THE STAND-IN
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 27 August 2026, on R28's measurements: a board must never show an empty
// plate while its cover is in flight. R28 measured the storefront cold, per cover, from
// entering the viewport to painting — 61ms and 664ms on 4G, 1,882ms and 5,647ms on Fast 3G,
// 7,818ms and 23,732ms on Slow 3G — with the board drawing spine, sheen, fore-edge and shadow
// around a flat rgb(14,10,22) plate holding nothing. A shelf of blank books for the better
// part of a minute on the connection most of this shop's readers are on.
//
// ── WHAT WAS ALREADY HERE, AND WHY IT IS NOT WHAT THIS USES ────────────────────────────────
//
// The story library has carried `coverHash` — a 4x3 BLURHASH — since the covers work, painted
// by an inlined decoder in app/components/CoverImage.js. `bookstore_titles` carries no such
// field: measured, 0 of 20 published titles have one, so the data has to be made either way.
//
// MEASURED, over all twenty real covers:
//
//     blurhash 4x3      28 bytes avg      560 bytes for the shelf
//     WebP 12w q40     161 bytes avg      3.1 KiB
//   * WebP 16w q40     199 bytes avg      3.9 KiB   (max 311)
//     WebP 20w q45     260 bytes avg      5.1 KiB
//     JPEG 16w q40     493 bytes avg      9.6 KiB
//
// THE BLURHASH IS SEVEN TIMES SMALLER AND IT LOSES ANYWAY, on three counts that all point the
// same way - the brief's own instruction was that the cheaper answer wins, not the elegant one:
//
//   - IT NEEDS A DECODER. CoverImage.js's inlined one is 2,756 bytes of JavaScript, and it
//     would have to be pulled into the bookstore bundle to save 3.4 KiB of data URI.
//   - IT NEEDS A CANVAS PER BOARD. Twenty canvases on a full shelf, against a compositing
//     ceiling of 260 that R27 has just bought 94 layers of headroom under. A background image
//     on an element that already exists adds no element and no layer.
//   - IT CANNOT PAINT BEFORE ITS JAVASCRIPT RUNS. A blurhash is drawn in a layout effect. A
//     background image is painted by the style system with the frame the board first appears
//     on, which is the frame this exists for.
//
// 3.9 KiB for a whole shelf is 0.24% of what R20 left the shelf's covers weighing (1.6 MiB),
// and it arrives inside records the page has already fetched - no request of its own, which is
// the whole point of a stand-in.
//
// 16px IS ALSO THE BEST-LOOKING, NOT A COMPROMISE FOR SIZE. Rendered at the 220px detail board
// and the 106px shelf board against the real cover: 16w reads as a soft field of the cover's
// own colour and composition with nothing legible in it, while 20w and 24w start to show
// blocky edges. Pre-blurring before the encode was tried and is pointless - it produced a
// byte-identical file. The upscale does the blurring.
export const COVER_LQIP_WIDTH = 16;
export const COVER_LQIP_QUALITY = 0.4;

// A stand-in that needed its own request would not be one. Anything that is not an inline
// data URI is refused rather than rendered.
const LQIP_PREFIX = 'data:image/';

// A ceiling, not a target. The largest of the twenty real covers encodes to 311 bytes; 2 KiB
// leaves room for a cover that resists compression and still refuses anything that is
// evidently not a 16px thumbnail - a full-size image pasted into this field would defeat the
// round by making the stand-in heavier than the thing it stands in for.
export const MAX_COVER_LQIP_BYTES = 2048;

/**
 * The inline stand-in for a board, or null.
 *
 * NULL IS A SUPPORTED ANSWER and always has been the shape of these getters: a title uploaded
 * before the CMS cut one, or one whose encode failed, has no stand-in and the board draws its
 * plate exactly as it did before this round. Nothing renders blank because a placeholder was
 * unavailable - the same rule coverSrcSet states above.
 */
export function coverLqip(title) {
  const v = title?.coverLqip;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s.startsWith(LQIP_PREFIX)) return null;
  if (s.length > MAX_COVER_LQIP_BYTES) return null;
  return s;
}

// NO SIZES CONSTANT LIVES HERE, AND R26 DID NOT PUT ONE HERE EITHER. The rule stands: a second
// copy in this file would be a number that could disagree with the one actually rendered.
// R26 needed the detail page's SERVER component to state the same `sizes` its <img> will use,
// so the ONE derivation moved out of BoundBook (a 'use client' module a server component cannot
// safely read a value from) into app/lib/bookstore/board.js, which BoundBook now imports. It
// moved; it was not duplicated. See that file, and the note at BoundBook's call site.
