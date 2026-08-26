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

// NO SIZES CONSTANT LIVES HERE. BoundBook already derives the attribute correctly and has
// since R16 — `${width}px` for a fixed board, '(max-width:640px) 33vw, 200px' for a board that
// is its column — and a second copy in this file would be a number that could disagree with the
// one actually rendered. See the note at its call site.
