// THE CARD GEOMETRY — the cover's layout carried onto a bridge card, and every number that
// carrying it produces.
//
// ── THE RULE: THE GEOMETRY ADAPTS, THE GRAMMAR DOES NOT ──────────────────────────────────
// Nothing here restates the cover. Every cover measurement is IMPORTED from
// scripts/covers/layout.mjs and converted; this file only owns the conversion and the
// handful of decisions the card needs that the cover never had to make (indices, the QR,
// the floors). Those decisions are marked CHOSEN where they are chosen.
//
// ── UNITS ────────────────────────────────────────────────────────────────────────────────
// Three units meet here, and each name says which it is:
//   cover px   the cover's own 1600-wide canvas. Furniture is drawn in these, under a
//              transform, so measureText answers exactly as it does for the cover.
//   mm         physical, from the TRIM's top-left corner.
//   dev px     the 600-dpi output raster, which includes the bleed.
//
// SCALED BY WIDTH: the cover's 1600 px become the card's 57 mm, so one cover px is
// 57/1600 = 0.035625 mm. The cover's 2400 px of height would be 85.5 mm; the card is 89, so
// 3.5 mm (98.25 cover px) is left over. Top furniture keeps its distance from the top edge,
// bottom furniture keeps its distance from the bottom edge, and the 3.5 mm opens in the
// middle, in the region the title stack already floats in.
import {
  AUTHOR, BORDER, CANVAS, DESCRIPTOR, EYEBROW, FOOTER, RULE, STACK, TITLE,
} from '../covers/layout.mjs';

// ── THE CARD ─────────────────────────────────────────────────────────────────────────────
export const TRIM = Object.freeze({ w: 57, h: 89 });          // bridge, ruled
export const BLEED = 3;                                        // mm, ruled
export const DPI = 600;                                        // ruled
export const PX_PER_MM = DPI / 25.4;                           // 23.622…

/** The raster: trim plus bleed on every side, rounded to whole device pixels. */
export const RASTER = Object.freeze({
  w: Math.round((TRIM.w + 2 * BLEED) * PX_PER_MM),             // 1488
  h: Math.round((TRIM.h + 2 * BLEED) * PX_PER_MM),             // 2244
});
export const BLEED_PX = BLEED * PX_PER_MM;

// ── COVER PX → MM ────────────────────────────────────────────────────────────────────────
export const MM_PER_COVER_PX = TRIM.w / CANVAS.w;              // 0.035625
/** Cover px → dev px. The transform the furniture is drawn under. */
export const K = MM_PER_COVER_PX * PX_PER_MM;                  // 0.8415…
export const COVER_H_MM = CANVAS.h * MM_PER_COVER_PX;          // 85.5
/** The height the card has that the cover did not, in cover px. Opens in the middle. */
export const OPENING = (TRIM.h - COVER_H_MM) / MM_PER_COVER_PX; // 98.25
/** The card's height in cover px — 2498.25. */
export const CARD_H = CANVAS.h + OPENING;

export const mm = (coverPx) => coverPx * MM_PER_COVER_PX;
export const coverPx = (millimetres) => millimetres / MM_PER_COVER_PX;
export const PT_PER_MM = 72 / 25.4;
/** The printed size, in points, of type set at `px` cover px. */
export const ptOf = (px) => mm(px) * PT_PER_MM;
export const pxOfPt = (pt) => coverPx(pt / PT_PER_MM);

// ── THE FLOORS — CHOSEN, NOT DERIVED ─────────────────────────────────────────────────────
// 6 pt is the print convention for the smallest type a reader is asked to read, and the brief
// names it as a choice. Scaled by width, three of the cover's rows fall under it; see
// TYPE below. 0.25 pt is the matching convention for the thinnest rule a press will hold:
// the cover's 1 px inner keyline scales to 0.036 mm (0.10 pt), which a printer can drop.
export const TYPE_FLOOR_PT = 6;
export const LINE_FLOOR_PT = 0.25;
export const LINE_FLOOR_PX = pxOfPt(LINE_FLOOR_PT);           // in cover px

/**
 * THE PROPOSED FIX for type under the floor: raise it to the floor and keep its tracking AS A
 * PROPORTION OF ITS SIZE, so the row keeps the cover's colour of spacing. Rows already above
 * the floor are untouched.
 */
function floored(row) {
  const pt = ptOf(row.size);
  if (pt >= TYPE_FLOOR_PT) return { ...row, scaledPt: pt, raised: false };
  const size = pxOfPt(TYPE_FLOOR_PT);
  return { ...row, size, tracking: row.tracking * (size / row.size), scaledPt: pt, raised: true };
}

export const TYPE = Object.freeze({
  eyebrow: Object.freeze(floored(EYEBROW)),
  footer: Object.freeze(floored(FOOTER)),
  descriptor: Object.freeze(floored({ ...DESCRIPTOR, tracking: DESCRIPTOR.tracking })),
  author: Object.freeze(floored(AUTHOR)),
});

// ── THE VERTICAL MAP ─────────────────────────────────────────────────────────────────────
// Top furniture keeps its cover y. Bottom furniture moves down by OPENING. The stack region
// keeps its top and gains OPENING at its foot.
//
// The eyebrow is raised to the floor ANCHORED BY ITS CAP TOP — it keeps its distance from the
// top keyline and grows downward, into the empty band above the stack. The footer is anchored
// by its BASELINE, so it keeps its distance from the bottom keyline and grows upward, into the
// band below the author. Both are measured by the drawing engine in face.mjs, which owns the
// fonts; this file only says which edge holds.
export const Y = Object.freeze({
  eyebrowBaselineCover: EYEBROW.y,         // re-anchored by cap top in face.mjs
  authorBaseline: AUTHOR.y + OPENING,
  footerBaseline: FOOTER.y + OPENING,
  stackTop: STACK.top,
  stackBottom: AUTHOR.y + OPENING - STACK.bottomOffsetFromAuthor,
});

// ── THE KEYLINE — PROVISIONAL ────────────────────────────────────────────────────────────
// The cover's proportion, at this width. The first print run's printer sets the real inset
// from its cut tolerance; until then this is a placeholder that happens to be the cover's.
export const KEYLINE = Object.freeze({
  outerInsetMm: mm(BORDER.outerInset),     // 3.85
  innerInsetMm: mm(BORDER.innerInset),     // 4.56
  outerWidthPx: Math.max(BORDER.outerWidth, LINE_FLOOR_PX),
  innerWidthPx: Math.max(BORDER.innerWidth, LINE_FLOOR_PX),
  provisional: true,
});
export const RULE_WIDTH_PX = Math.max(RULE.width, LINE_FLOOR_PX);

// ── SAFE AREA — CHOSEN ───────────────────────────────────────────────────────────────────
// 3 mm inside trim: the usual card-printer convention, drawn on the second panel of the
// contact sheet. The provisional keyline sits 0.85 mm inside it.
export const SAFE_MM = 3;

// ── CORNER INDICES — CHOSEN ──────────────────────────────────────────────────────────────
// THE REGION: a fanned hand held in the left hand and spread to the right leaves the left
// edge of every card showing, and the top-left corner of that strip is where the eye goes.
// The region chosen is the strip 12 mm wide down the left edge, top 16 mm; the bottom-right
// index is the same box turned 180°, so a card the wrong way up still shows one.
//
// THE CONTENTS: the motif glyph, and under it a livery mark set in Cormorant 600. Both
// are drawn in the livery's keyline colour. The ground's colour is not relied on to carry
// the livery: three story grounds are near-black and do not separate in a fan or for a
// colour-blind player, so the LETTER carries it.
export const INDEX_REGION_MM = Object.freeze({ x: 0, y: 0, w: 12, h: 16 });
export const GLYPH_MM = 6;                 // the one size every glyph is drawn at
export const GLYPH_STROKE_MM = 0.15;       // the one stroke — 0.43 pt, a hairline that holds
export const INDEX = Object.freeze({
  x: KEYLINE.innerInsetMm + 0.9,           // glyph box left, mm from trim
  y: KEYLINE.innerInsetMm + 0.9,           // glyph box top
  markGapMm: 0.9,                          // glyph foot → mark cap top
  markPt: 8.5,
});
/** The livery marks. Series takes the house fleuron: it is the picture card, not a letter. */
export const LIVERY_MARK = Object.freeze({
  short: 'S', flash: 'F', poetry: 'P', inspiring: 'I', series: '❦',
});

// ── THE CARD CODE — CHOSEN ───────────────────────────────────────────────────────────────
// A QR of the story's own URL, on the right side above the bottom-right index. The top
// right is too close to a wide eyebrow (FLASH FICTION runs to 41.6 mm), and the bottom left
// is too close to a long author line. The right side of the opened middle is empty on every
// card, at every rung.
export const SITE = 'https://calvaryscribblings.co.uk';
export const QR = Object.freeze({
  ecc: 'M',
  modulePx: 6,                             // dev px — 0.254 mm, whole pixels at 600 dpi
  quietModules: 4,                         // the spec's quiet zone, on the panel
  rightMm: TRIM.w - KEYLINE.innerInsetMm - 1.0,
  bottomGapAboveIndexMm: 1.2,
  panel: '#F5F0E8',                        // house cream — the livery's own title colour
});

// ── THE ENDING GROUND — CHOSEN ───────────────────────────────────────────────────────────
// House umber (#2a2318 in the site's palette). Not a purple, not a story livery, not the
// story back; dark, so its furniture is display gold.
export const ENDING = Object.freeze({
  key: 'ending', name: 'Ending',
  ground: '#2A2318', keyline: '#C9A84C', title: '#F5F0E8', glow: '#5A4A2C',
});

export const MOTIFS = Object.freeze(['Letter', 'Secret', 'Child', 'Storm', 'Road', 'House', 'Debt', 'Fire']);
export const ENDINGS = Object.freeze([
  { name: 'THE REVELATION', pair: ['Letter', 'Secret'] },
  { name: 'THE BIRTHRIGHT', pair: ['Secret', 'Child'] },
  { name: 'THE RESCUE', pair: ['Child', 'Storm'] },
  { name: 'THE ESCAPE', pair: ['Storm', 'Road'] },
  { name: 'THE RETURN', pair: ['Road', 'House'] },
  { name: 'THE FALL', pair: ['House', 'Debt'] },
  { name: 'THE RECKONING', pair: ['Debt', 'Fire'] },
  { name: 'THE FAREWELL', pair: ['Fire', 'Letter'] },
]);

export { TITLE, RULE, STACK, DESCRIPTOR, CANVAS };
