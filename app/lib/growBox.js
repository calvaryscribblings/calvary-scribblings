// TEXT-W1 — ruling 390: ONE behaviour for every multi-line text box on the website.
//
// A box grows with the text, line by line, up to GROW_LINES, then scrolls inside itself. The cursor
// and the last line typed stay in view. It shrinks back when text is deleted or sent, and a pasted
// passage behaves the same. Each box keeps its own look (392): the box's resting height is whatever
// its own CSS and `rows` make it, and growth only ever adds to that.
//
// Long-form editors keep a taller limit suited to writing (LONG_FORM below). This file is the pure
// arithmetic, so it can be tested without a browser; app/components/GrowTextarea.js applies it.

/** A chosen number (ruling 390): a box grows to six lines, then scrolls inside itself. */
export const GROW_LINES = 6;

/**
 * Long-form editors, and the limit each keeps (ruling 390, "a taller limit suited to writing").
 *   PAGE   the box never scrolls inside itself: it grows with the page, as the Open Pages composer
 *          has since R38 ("a scrollbar inside the measure would be a box, and the surface has no
 *          boxes"). An Open Pages piece, new or edited.
 *   DESK   24 lines, then it scrolls: the CMS's story body and the long admin passages (the Book
 *          Store's sample passage). Tall enough to read a paragraph whole, short enough that the
 *          formatting buttons above it stay on an iPad's screen (24 lines of the CMS body is 568px).
 */
export const LONG_FORM = Object.freeze({ PAGE: Infinity, DESK: 24 });

/**
 * The height a box should be, in CSS pixels of its border box.
 *   natural     its resting height (its own CSS, `rows`, min-height), border box
 *   content     the height its text needs: scrollHeight + borders
 *   lineHeight  one line, in px
 *   padY, bY    vertical padding and borders, in px
 *   maxLines    GROW_LINES, a LONG_FORM value, or Infinity
 * Returns { height, cap, scrolls }: never below its resting height, never above the cap (unless the
 * resting height is itself taller, which a box's own look may make it), and `scrolls` when the text
 * needs more than the cap.
 */
export function growHeight({ natural, content, lineHeight, padY = 0, bY = 0, maxLines = GROW_LINES }) {
  const ok = [natural, content, lineHeight].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (!ok) return { height: natural || 0, cap: natural || 0, scrolls: false };
  const lines = maxLines === Infinity ? Infinity : Math.max(1, Math.floor(maxLines));
  const cap = lines === Infinity ? Infinity : Math.max(natural, Math.ceil(lines * lineHeight + padY + bY));
  const height = Math.min(cap, Math.max(natural, content));
  // One pixel of rounding is not a line: a box whose text needs its cap and a hair more does not scroll.
  return { height, cap, scrolls: content > cap + 1 };
}
