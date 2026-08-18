// TEXT PLACEMENT — tracking, wrapping, and the reason both are done by hand.
//
// ── WHY PER-GLYPH AND NOT ctx.letterSpacing ──────────────────────────────────────────────
// @napi-rs/canvas 1.0.6 does expose `ctx.letterSpacing`, so this module looks at first like
// work the engine would do for free. It is not, for two reasons that both bite:
//
//   1. MEASUREMENT AND DRAWING MUST AGREE. The title auto-sizer wraps against measured
//      widths and then the renderer draws. If tracking is applied by a property, the width
//      that comes back from measureText and the ink that lands on the canvas are produced by
//      two code paths inside the engine, and whether they agree at the ends of a run (does
//      the last glyph carry a trailing space?) is unspecified and has changed between Skia
//      releases. Placing each glyph at a position this module computed means the wrap
//      arithmetic and the draw arithmetic are THE SAME arithmetic.
//   2. IT IS THE PINNED CONTRACT. The renderer version is pinned exactly (see
//      scripts/covers/render.mjs) precisely so covers regenerate identically years from now.
//      Every behaviour delegated to the engine is a behaviour that pin has to hold; every
//      behaviour computed here is one it does not.
//
// ── WHAT IS GIVEN UP, AND WHERE IT IS GIVEN BACK ─────────────────────────────────────────
// Drawing glyph by glyph discards kerning pairs and ligatures — the engine only applies them
// within a single fillText run. For TRACKED CAPS that is not a loss but the goal: tracked
// caps are meant to be evenly spaced, and kerning fights the tracking.
//
// It WOULD be a loss on the author line, which is italic mixed-case at tracking 0, where
// Cormorant's kerning is doing real work. So `drawTracked` takes the whole-run path whenever
// tracking is zero. The author line keeps its kerning; nothing tracked wants it.
//
// ── CLUSTERS, NOT CODE POINTS ────────────────────────────────────────────────────────────
// Splitting a tracked string by code point would strand a combining mark: in a decomposed
// "Àkúdáàya" the grave accent is its own code point and would be drawn a full tracking-step
// away from the letter it belongs to. Text is normalised to NFC first, which composes almost
// every Latin accent into one code point, and any mark that survives normalisation is glued
// to the cluster before it.
//
// Intl.Segmenter would also do this and is deliberately NOT used: its output depends on the
// ICU version compiled into the host Node, which is exactly the kind of ambient dependency
// this whole subsystem exists to avoid.
const COMBINING = /\p{M}/u;

/** Split into grapheme clusters, deterministically and without ICU. */
export function clusters(text) {
  const out = [];
  for (const cp of String(text ?? '').normalize('NFC')) {
    if (out.length && COMBINING.test(cp)) out[out.length - 1] += cp;
    else out.push(cp);
  }
  return out;
}

/**
 * Uppercase, locale-independently.
 *
 * `toUpperCase()` without a locale uses the Unicode root mapping, so this is the same on a
 * Turkish host as anywhere else. `toLocaleUpperCase()` is NOT — it maps i → İ under tr — and
 * a cover whose title depends on the generating machine's locale is not deterministic.
 */
export const caps = (text) => String(text ?? '').normalize('NFC').toUpperCase();

/**
 * Width of `text` at the ctx's current font, with `tracking` px between clusters.
 * Tracking is BETWEEN glyphs only: n clusters carry n−1 gaps, so there is no trailing space
 * and a centred line is centred on its ink.
 */
export function trackedWidth(ctx, text, tracking) {
  if (!tracking) return ctx.measureText(String(text ?? '')).width;
  const cs = clusters(text);
  if (!cs.length) return 0;
  let w = 0;
  for (const c of cs) w += ctx.measureText(c).width;
  return w + tracking * (cs.length - 1);
}

/**
 * Draw `text` centred on `cx` with its baseline at `y`.
 *
 * At tracking 0 this is one fillText and the engine keeps its kerning and ligatures. Above
 * zero each cluster is placed by accumulated advance.
 */
export function drawTracked(ctx, text, cx, y, tracking) {
  const s = String(text ?? '');
  if (!s) return 0;
  const total = trackedWidth(ctx, s, tracking);
  if (!tracking) {
    const prev = ctx.textAlign;
    ctx.textAlign = 'left';
    ctx.fillText(s, cx - total / 2, y);
    ctx.textAlign = prev;
    return total;
  }
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = cx - total / 2;
  for (const c of clusters(s)) {
    ctx.fillText(c, x, y);
    x += ctx.measureText(c).width + tracking;
  }
  ctx.textAlign = prev;
  return total;
}

/**
 * Break opportunities within one whitespace-delimited word.
 *
 * THE BUG THIS FIXES was on the contact sheet: "Brown-Skinned Girl" set at 186px is one
 * whitespace token wider than the measure, so it fell through to the character breaker and
 * came out as "BROWN-SKI / NNED GIRL". A hyphen that is ALREADY IN THE TITLE is a break the
 * author has already sanctioned, and taking it costs nothing and invents nothing — which is
 * exactly the property the character breaker lacks.
 *
 * The hyphen stays on the leading part, where a reader expects it. Trailing hyphens do not
 * create a break after themselves (nothing follows), and a leading hyphen is not a break
 * either — "-30" must not become "-" / "30".
 */
export function breakParts(word) {
  const parts = String(word).split(/(?<=-)(?!$)/g);
  return parts.length > 1 && parts[0] !== '-' ? parts : [word];
}

/**
 * Greedy wrap to `maxWidth` at the ctx's current font and the given tracking.
 *
 * Greedy and not Knuth-Plass on purpose: a title is one to four lines, the ladder in
 * layout.mjs is already choosing between whole size/line-count regimes, and a paragraph
 * optimiser would introduce a second, competing notion of what "fits".
 *
 * THREE TIERS OF BREAK, tried in order, each more invasive than the last:
 *   1. at a SPACE          — free, always right
 *   2. after an EXISTING HYPHEN — free, the author already put it there (see breakParts)
 *   3. between CLUSTERS    — the last resort, for a long hyphenless compound or a measure
 *                            narrowed by heavy tracking
 *
 * Tier 3 inserts NO HYPHEN. An invented hyphen in a title reads as part of the title, and a
 * cover is not a paragraph of justified body text where a reader forgives one.
 */
export function wrapTracked(ctx, text, tracking, maxWidth) {
  return wrapDetailed(ctx, text, tracking, maxWidth).lines;
}

/**
 * The wrap, plus WHETHER TIER 3 HAD TO FIRE.
 *
 * `brokeWord` is true when a word had to be split between clusters because it could not fit
 * the measure whole. That fact is not cosmetic bookkeeping — it is the signal fitTitle uses
 * to reject a size, and it exists because of a live defect:
 *
 *   "unstoppaBBL" set at 186px is 1396px wide against a 1232px measure. The character
 *   breaker split it into UNSTOPPAB / BL — two lines, which SATISFIED the 186px rung's
 *   two-line cap, so the ladder stopped there and shipped a title broken mid-word across a
 *   cover. At 140px the same word is 1080px and sets whole on one line.
 *
 * The line cap was doing its job; the problem was that a last-resort break was being counted
 * as a fit. A rung that can only be reached by breaking a word has not fitted the title, and
 * the ladder should keep walking.
 */
export function wrapDetailed(ctx, text, tracking, maxWidth) {
  // Tokens carry whether a space precedes them, so a hyphen-split rejoins without one.
  const tokens = [];
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    breakParts(word).forEach((part, i) => tokens.push({ text: part, space: i === 0 }));
  }

  const lines = [];
  let line = '';
  let brokeWord = false;
  const fits = (s) => trackedWidth(ctx, s, tracking) <= maxWidth;

  const pushBroken = (word) => {
    brokeWord = true;
    let chunk = '';
    for (const c of clusters(word)) {
      if (chunk && !fits(chunk + c)) { lines.push(chunk); chunk = c; }
      else chunk += c;
    }
    return chunk;
  };

  for (const tok of tokens) {
    const joiner = line && tok.space ? ' ' : '';
    const candidate = line + joiner + tok.text;
    if (fits(candidate)) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    if (fits(tok.text)) { line = tok.text; continue; }
    line = pushBroken(tok.text);
  }
  if (line) lines.push(line);
  return { lines, brokeWord };
}
