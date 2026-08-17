// THE LAYOUT — every measurement on the cover, in one place, as data.
//
// Nothing here is computed from anything else at import time and nothing here varies by
// livery. The renderer reads these numbers; it does not invent any. If a cover looks wrong,
// the wrongness is either in this file or in the words, and that is the point of separating
// them.
//
// UNITS ARE CANVAS PIXELS on a 1600 × 2400 surface, and `y` on a text row always means the
// BASELINE, never the box top. Tracking is in pixels too, not em — a tracking of 14 at 34px
// is 0.41em, which is wide, and is meant to be: the eyebrow is a small-caps rule of type
// across the top of the frame, not a word.

export const CANVAS = Object.freeze({ w: 1600, h: 2400 });

// ── THE DOUBLE KEYLINE ───────────────────────────────────────────────────────────────────
// Outer at 108/3px in the keyline colour; inner at 128/1px in the SAME hue at 55% brightness.
// The dimming is applied to the colour, not with globalAlpha, so the two rules composite
// identically over the glow and the grain rather than one of them picking up what is under it.
export const BORDER = Object.freeze({
  outerInset: 108, outerWidth: 3,
  innerInset: 128, innerWidth: 1,
  innerBrightness: 0.55,
});

// ── THE FIXED BASELINES ──────────────────────────────────────────────────────────────────
// Three rows are pinned to the canvas and never move: the eyebrow at the top, and the author
// and footer at the foot. Everything between them floats — see STACK below.
export const EYEBROW = Object.freeze({ y: 203, size: 34, tracking: 14, font: 'meta' });
export const AUTHOR  = Object.freeze({ y: 2014, size: 74, tracking: 0, font: 'italic' });
export const FOOTER  = Object.freeze({ y: 2122, size: 40, tracking: 8, font: 'meta' });

// ── THE TITLE ────────────────────────────────────────────────────────────────────────────
// Set in caps, Cormorant 600, tracked 12, leading 1.12.
//
// THE LADDER IS TRIED IN ORDER AND THE FIRST FIT WINS. `maxLines` is a hard cap at that
// size, not a target: a title that wraps to three lines at 186 does not get to stay at 186,
// it drops to 140 and is re-wrapped. The consequence is deliberate and worth stating plainly
// because it will look like a bug to someone one day —
//
//   A LONG TITLE LANDS SMALL. That is correct. The alternative is a long title set large and
//   wrapped to five lines, which fills the frame, crowds the rule, and makes the eyebrow and
//   the author look like afterthoughts. The library's longest titles are meant to sit quietly
//   at 78 or 68 and let the frame carry them.
//
// The last rung is the FALLBACK: 68px with no line cap. It cannot fail to fit horizontally
// (a single word longer than the measure is broken in text.mjs), and if it ever overflows
// vertically the renderer raises rather than shipping a cover with the title over the rule.
export const TITLE = Object.freeze({
  font: 'title',
  tracking: 12,
  lineHeight: 1.12,
  maxWidth: 1232,          // canvas 1600 − 2 × (inner keyline 128 + 56 clearance)
  ladder: Object.freeze([
    Object.freeze({ size: 186, maxLines: 2 }),
    Object.freeze({ size: 140, maxLines: 2 }),
    Object.freeze({ size: 112, maxLines: 3 }),
    Object.freeze({ size:  92, maxLines: 4 }),
    Object.freeze({ size:  78, maxLines: 4 }),
    Object.freeze({ size:  68, maxLines: Infinity }),
  ]),
});

// ── THE HAIRLINE RULE ────────────────────────────────────────────────────────────────────
export const RULE = Object.freeze({
  gapAboveFromTitle: 80,   // below the title BLOCK, not below its last baseline
  x1: 0.26, x2: 0.74,      // fractions of canvas width
  width: 2,
});

// ── THE DESCRIPTOR ───────────────────────────────────────────────────────────────────────
// "DUTY.  SACRIFICE.  RUIN." — three words, each full-stopped, TWO spaces between them.
// The double space is not a typo and must survive any reformatting: at 54px tracked 9 a
// single space does not read as a separation between three separate declarations.
//
// OPTIONAL, and its absence is a COMPLETE DESIGN. When there is no descriptor the rule is
// the bottom of the stack and the fleuron takes the room. Nothing shifts to "fill the hole",
// because there is no hole. Do not add a placeholder here, ever.
export const DESCRIPTOR = Object.freeze({
  font: 'meta', size: 54, tracking: 9, lineHeight: 1.12,
  gapBelowRule: 100,
  separator: '  ',
});

// ── THE FLEURON ──────────────────────────────────────────────────────────────────────────
// U+2766 at 104px in the keyline colour, drawn from the frozen outline in
// assets/covers/fleuron-2766.mjs. Its INK is centred at 42% of the gap between the bottom of
// the stack and the top of the author — 42 and not 50 because the author's ascender and the
// footer beneath it weight the lower half, and a mark at dead centre reads as low.
export const FLEURON = Object.freeze({ size: 104, gapFraction: 0.42 });

// ── THE STACK, AND WHY IT IS NOT CENTRED ─────────────────────────────────────────────────
// The title+rule+descriptor group floats in the region between `top` and (author y − 120),
// placed at 20% of the slack rather than at 50%.
//
// DEAD CENTRE WAS TRIED AND REJECTED. Centring measures the gap above the title against the
// gap below it and calls them equal, but they are not equal to the eye: the space below is
// interrupted by the rule, the fleuron and two rows of type, and the space above is empty.
// A centred stack therefore reads as having SUNK. Twenty per cent puts the title high in its
// region, close to the eyebrow it belongs with, and leaves the lower half to the furniture.
export const STACK = Object.freeze({
  top: 338,
  bottomOffsetFromAuthor: 120,   // region ends at AUTHOR.y − this
  placement: 0.20,
});

/** Region the stack floats in. Derived here so no caller re-derives it differently. */
export const STACK_REGION = Object.freeze({
  top: STACK.top,
  bottom: AUTHOR.y - STACK.bottomOffsetFromAuthor,   // 1894
});

// ── ORDINALS ─────────────────────────────────────────────────────────────────────────────
// A Series cover's footer carries "INSTALMENT ONE" where a story carries its subcategory.
// Words to twenty, numerals past it — a run that long is a serial, and "INSTALMENT
// TWENTY-SEVEN" tracked at 8 is wider than the measure.
const WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN',
  'NINETEEN', 'TWENTY'];

export function instalmentFooter(ordinal) {
  const n = Number(ordinal);
  if (!Number.isFinite(n) || n < 1) return '';
  const i = Math.floor(n);
  return `INSTALMENT ${i <= 20 ? WORDS[i] : i}`;
}

// ── THE GROUND ───────────────────────────────────────────────────────────────────────────
export const GLOW = Object.freeze({
  widthFactor: 1.5,        // ellipse width = 1.5 × canvas width
  heightFactor: 0.5,       // ellipse height = 0.5 × canvas height
  centre: Object.freeze({ x: -0.10, y: -0.10 }),   // fractions of canvas — OFF the top-left corner
  blur: 240,
  alpha: 0.17,
});

export const VIGNETTE = Object.freeze({
  darkenPerChannel: 42,    // the ground composited against itself, this much darker
  radiusFactor: Object.freeze({ x: 0.62, y: 0.60 }),
  blur: 240,
});

export const GRAIN = Object.freeze({
  count: 150000,
  maxLuminance: 45,
  alphaDark: 0.05,
  alphaLight: 0.035,
});
