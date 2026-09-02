// R32 — MEASURING THE PIN. The one place the trailer's stage height is decided.
//
// ⚠ NOTHING PINS UNTIL EVERY CANDIDATE HAS REPORTED. The stage height cannot be a constant in
// the source: the quote size is a clamp() so it depends on the viewport, the metrics depend on
// Cormorant Garamond having actually loaded, and the pool changes the moment a trailer quote
// is edited in the CMS. So it is measured — every eligible quote on the site, offscreen, in
// the real type at the real width — and the tallest wins.
//
// It lives in its own module rather than inside the carousel for one reason: so the height
// suite can run THE REAL FUNCTION against the live pool. A suite that re-implements the
// measurement it is checking proves only that somebody can write the same bug twice.
//
// Measured 2 Sept 2026 over the 157 live quotes: 209px at 390 and 430, 156 at 768, 260 at
// 1024, 335 at 1440 — a 279px swing on desktop between the shortest quote and the tallest,
// which is how far the STORY TRAILER kicker was jumping as the carousel turned before this
// existed.

/** Matches the trailer block's own maxWidth in app/public-library/page.js. */
export const QUOTE_BLOCK_MAX = 640;

/** The width the quote actually wraps at: left:4% / right:4%, capped. */
export function quoteBlockWidth(viewportWidth) {
  return Math.min(viewportWidth * 0.92, QUOTE_BLOCK_MAX);
}

/**
 * ⚠ THE PROBE BUILDS THE SAME DOM, NOT THE SAME STRING.
 *
 * The painted quote is one inline-block `.trailer-word` per word, each carrying a trailing
 * NON-BREAKING space — so line breaks fall between the boxes and a trailing nbsp sits at the
 * end of every line. Measuring the plain string instead measures a different wrap, and a pin
 * measured on a different wrap is not a pin. This produced a wrong number once already,
 * during R32's verify pass; it is written down so it cannot produce another.
 */
export function paintQuoteWords(el, text) {
  el.textContent = '';
  const words = String(text).split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    const span = el.ownerDocument.createElement('span');
    span.className = 'trailer-word';
    span.style.animation = 'none';
    span.textContent = w + (i < words.length - 1 ? ' ' : '');
    el.appendChild(span);
  });
  return el;
}

/**
 * The tallest quote in the pool, in CSS pixels, at this viewport.
 * Returns 0 for an empty pool — and a 0 pin emits no trailer steps at all, so the carousel
 * shows plain cards rather than a stage of the wrong height.
 */
export function measureQuotePin(quotes, doc = typeof document === 'undefined' ? null : document) {
  if (!doc || !quotes || quotes.length === 0) return 0;
  const host = doc.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none';
  const p = doc.createElement('p');
  // The class, not a copy of its properties — the probe and the painted element are the same
  // type by construction. See .trailer-quote in app/globals.css.
  p.className = 'trailer-quote';
  p.style.width = `${quoteBlockWidth(doc.defaultView.innerWidth)}px`;
  host.appendChild(p);
  doc.body.appendChild(host);
  let max = 0;
  for (const q of quotes) {
    paintQuoteWords(p, q);
    const h = p.getBoundingClientRect().height;
    if (h > max) max = h;
  }
  doc.body.removeChild(host);
  return Math.ceil(max);
}
