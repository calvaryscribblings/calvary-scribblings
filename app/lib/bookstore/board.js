// R26 — THE BOARD'S OWN NUMBERS, IN ONE PLACE, READABLE FROM BOTH SIDES OF THE BOUNDARY.
//
// This file holds two facts about a bound-book board that more than one module has to agree
// on: how wide the detail page draws it, and what `sizes` the browser is told for a board of a
// given width. It exists because R26 needed the DETAIL PAGE'S SERVER COMPONENT to name the
// same rung the client's <img> will end up choosing, so it can preload it — and BoundBook.js
// is a 'use client' module, from which a server component cannot safely read a plain value.
//
// ⚠ THIS IS NOT A SECOND COPY. app/lib/bookstore/covers.js says, at its foot, that no sizes
// constant lives there, and the argument is exactly right: "a second copy in this file would
// be a number that could disagree with the one actually rendered." So this is not a copy — the
// derivation MOVED here, BoundBook imports it, and there is still precisely one expression in
// the tree that decides a board's `sizes`. What changed is that a server component can now
// read it too.
//
// ── WHY THE PRELOAD NEEDS BOTH ─────────────────────────────────────────────────────────────
//
// <link rel="preload" as="image" imagesrcset=… imagesizes=…> only fetches the SAME candidate
// the <img> will later pick if the two agree on `sizes`. Disagree, and the preload warms a
// rung nothing draws — a wasted request AND a late cover, which is worse than no preload. The
// detail board is 220px, so its `sizes` is '220px', and both statements come from here.

/**
 * The width the detail page draws its board at. A CSS pixel count, passed to BoundBook's
 * `width` prop and used to derive the preload's `imagesizes`.
 */
export const DETAIL_BOARD_WIDTH = 220;

/**
 * The `sizes` attribute for a board of the given width.
 *
 * A fixed book states its pixels; a column-width one states the columns. Measured on the
 * shipped page: the shelf column renders 104.7px at 390 (33vw = 128.7, over-stated, which
 * picks the same 360w rung) and 197.6px at 1280 (200px, over-stated by 2.4). Over-stating
 * costs nothing; under-stating would pick a rung too small and the eye would see it.
 */
export function boardSizes(width) {
  return typeof width === 'number' ? `${width}px` : '(max-width:640px) 33vw, 200px';
}
