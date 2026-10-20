// THE CARD FACE — a story's cover rebuilt at bridge size, plus its corner indices and its code.
//
//   import { renderStoryFace } from './face.mjs';
//   const { png, layout } = renderStoryFace(card, { qr: 'panel' });
//
// EVERYTHING THE COVER OWNS IS IMPORTED: the layout constants, the liveries, the vendored faces
// (registered by the cover's own registerFonts), the title ladder (planCover), the tracked
// setting (text.mjs), the fleuron outline and the slug-seeded grain stream. Nothing in
// scripts/covers/ is changed by this file. What it adds is the card's own geometry
// (geometry.mjs), drawn at 600 dpi with the bleed.
//
// THE COVER'S FURNITURE IS DRAWN IN COVER PX, under a transform that maps the cover's 1600-px
// width onto the card's 57 mm. measureText ignores the transform, so the ladder, the wraps and
// the tracking come out exactly as they do on the cover. The new marks (indices, glyphs, the
// code) are placed in millimetres.
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { FLEURON_PATH, FLEURON_BBOX } from '../../assets/covers/fleuron-2766.mjs';
import { registerFonts, measureCanaries, planCover, descriptorLeading } from '../covers/render.mjs';
import { LIVERIES, isLight } from '../covers/liveries.mjs';
import { rngForSlug } from '../covers/random.mjs';
import { caps, clusters, drawTracked, trackedWidth } from '../covers/text.mjs';
import { CANVAS, DESCRIPTOR, EYEBROW, FLEURON, GLOW, GRAIN, RULE, TITLE, VIGNETTE, BORDER, instalmentFooter } from '../covers/layout.mjs';
import {
  BLEED, BLEED_PX, CARD_H, ENDING, PICTURE, SAFE_MM, STORY_BACK, ENDINGS, GLYPH_MM, INDEX, K, KEYLINE, LIVERY_MARK, MOTIFS, PX_PER_MM,
  QR, RASTER, RULE_WIDTH_PX, TRIM, TYPE, Y, coverPx, mm, ptOf, pxOfPt,
} from './geometry.mjs';
import { drawGlyph } from './glyphs.mjs';
import { drawCode, encode, panelPx } from './qr.mjs';

// ── THE FACES ────────────────────────────────────────────────────────────────────────────
// render.mjs keeps its font strings private. These name the same three families that its
// registerFonts() registers, and assertSameFaces() proves it: the cover's own canaries must
// measure identically through these strings, or nothing renders.
const FONTS = {
  title: (px) => `${px}px "Cormorant Garamond SemiBold"`,
  italic: (px) => `${px}px "Cormorant Garamond Italic"`,
  meta: (px) => `${px}px "EB Garamond"`,
};
let facesChecked = false;
function assertSameFaces() {
  if (facesChecked) return;
  registerFonts();
  const want = measureCanaries();
  const ctx = createCanvas(10, 10).getContext('2d');
  for (const [key, fn] of Object.entries(FONTS)) {
    ctx.font = fn(100);
    const got = +ctx.measureText('Hamburgefonstiv').width.toFixed(4);
    if (got !== want[key]) throw new Error(`card font ${key} is not the cover's face (${got} vs ${want[key]})`);
  }
  facesChecked = true;
}

// ── THE CANVAS ───────────────────────────────────────────────────────────────────────────
// What the card is drawn on: a raster of R.w × R.h device px, with the TRIM's top-left at
// (R.ox, R.oy). The default is the design's own raster (RASTER, the 3 mm bleed on every side)
// and it is what every review render uses. An export may draw the SAME design on another
// printer's canvas (useCanvas): the trim keeps its size and is centred, and the bleed runs out
// to whatever canvas the printer asks for. Nothing is rescaled.
const DESIGN_CANVAS = Object.freeze({ name: 'design', w: RASTER.w, h: RASTER.h, ox: BLEED_PX, oy: BLEED_PX });
let R = DESIGN_CANVAS;
/** Draw on `{ name, w, h }` (device px) with the trim centred, or on the design's own canvas with null. */
export function useCanvas(canvas) {
  R = canvas ? Object.freeze({ name: canvas.name, w: canvas.w, h: canvas.h, ox: (canvas.w - TRIM.w * PX_PER_MM) / 2, oy: (canvas.h - TRIM.h * PX_PER_MM) / 2 }) : DESIGN_CANVAS;
  out = null; layer = null; grainImage = null;   // the pools are sized to the canvas
  return R;
}
export const currentCanvas = () => R;

// ── SURFACES — pooled, for the reason render.mjs gives (Skia memory is invisible to V8) ──
let out = null;
let layer = null;
let grainImage = null;
function fresh(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.resetTransform();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.clearRect(0, 0, R.w, R.h);
  return ctx;
}
const surface = () => { out ??= createCanvas(R.w, R.h); return { canvas: out, ctx: fresh(out) }; };
const scratch = () => { layer ??= createCanvas(R.w, R.h); return { canvas: layer, ctx: fresh(layer) }; };

// ── TRANSFORMS ───────────────────────────────────────────────────────────────────────────
/** Cover px from the trim's top-left. */
const coverSpace = (ctx) => ctx.setTransform(K, 0, 0, K, R.ox, R.oy);
/** Millimetres from the trim's top-left. */
const mmSpace = (ctx) => ctx.setTransform(PX_PER_MM, 0, 0, PX_PER_MM, R.ox, R.oy);
/** mm from the trim's left / top edge → device px on the current canvas. */
const devX = (millimetres) => R.ox + millimetres * PX_PER_MM;
const devY = (millimetres) => R.oy + millimetres * PX_PER_MM;

// ── COLOUR ───────────────────────────────────────────────────────────────────────────────
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const dim = (hex, f) => `rgb(${rgb(hex).map((v) => Math.round(v * f)).join(', ')})`;
const darken = (hex, a) => `rgb(${rgb(hex).map((v) => Math.max(0, v - a)).join(', ')})`;

// ── THE GROUND ───────────────────────────────────────────────────────────────────────────
// The cover's three treatments, at card geometry: the glow and the vignette keep their
// proportions to the TRIM (and run on into the bleed), their blur scales by width, and the
// grain keeps its COVERAGE: the cover's 150,000 specks over 3.84 M px is 3.9%, and the card
// raster gets the same fraction of its own pixels from the same slug-seeded stream.
export const GRAIN_COUNT = Math.round(GRAIN.count * (RASTER.w * RASTER.h) / (CANVAS.w * CANVAS.h));
/** The same coverage on whatever canvas is current. */
const grainCount = () => (R === DESIGN_CANVAS ? GRAIN_COUNT : Math.round(GRAIN.count * (R.w * R.h) / (CANVAS.w * CANVAS.h)));
const TRIM_W = TRIM.w * PX_PER_MM;
const TRIM_H = TRIM.h * PX_PER_MM;

function paintGround(ctx, livery, seed, { symmetric = false, treatment = true } = {}) {
  ctx.fillStyle = livery.ground;
  ctx.fillRect(0, 0, R.w, R.h);
  const light = isLight(livery);
  if (treatment && light) {
    const { canvas: l, ctx: lc } = scratch();
    lc.fillStyle = darken(livery.ground, VIGNETTE.darkenPerChannel);
    lc.fillRect(0, 0, R.w, R.h);
    lc.globalCompositeOperation = 'destination-out';
    lc.filter = `blur(${VIGNETTE.blur * K}px)`;
    lc.fillStyle = '#fff';
    lc.beginPath();
    lc.ellipse(R.w / 2, R.h / 2, TRIM_W * VIGNETTE.radiusFactor.x, TRIM_H * VIGNETTE.radiusFactor.y, 0, 0, Math.PI * 2);
    lc.fill();
    ctx.drawImage(l, 0, 0);
  } else if (treatment && livery.glow) {
    const { canvas: l, ctx: lc } = scratch();
    lc.filter = `blur(${GLOW.blur * K}px)`;
    lc.fillStyle = livery.glow;
    lc.beginPath();
    lc.ellipse(R.ox + TRIM_W * GLOW.centre.x, R.oy + TRIM_H * GLOW.centre.y,
      (TRIM_W * GLOW.widthFactor) / 2, (TRIM_H * GLOW.heightFactor) / 2, 0, 0, Math.PI * 2);
    lc.fill();
    ctx.save();
    ctx.globalAlpha = GLOW.alpha;
    ctx.drawImage(l, 0, 0);
    ctx.restore();
  }
  // The grain, from the cover's own seeded stream. A SYMMETRIC ground (the Ending back) writes
  // every speck twice, at (x, y) and at its 180° partner, so the back is the same either way up.
  const rand = rngForSlug(seed);
  const { canvas: l, ctx: lc } = scratch();
  grainImage ??= lc.createImageData(R.w, R.h);
  const d = grainImage.data;
  d.fill(0);
  const put = (x, y, v) => { const o = (y * R.w + x) * 4; d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255; };
  const n = symmetric ? Math.round(grainCount() / 2) : grainCount();
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rand() * R.w);
    const y = Math.floor(rand() * R.h);
    const v = Math.floor(rand() * (GRAIN.maxLuminance + 1));
    put(x, y, v);
    if (symmetric) put(R.w - 1 - x, R.h - 1 - y, v);
  }
  lc.putImageData(grainImage, 0, 0);
  ctx.save();
  ctx.globalAlpha = light ? GRAIN.alphaLight : GRAIN.alphaDark;
  ctx.drawImage(l, 0, 0);
  ctx.restore();
}

function paintKeylines(ctx, livery) {
  coverSpace(ctx);
  const rect = (inset, w, colour) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.strokeRect(inset + w / 2, inset + w / 2, CANVAS.w - 2 * inset - w, CARD_H - 2 * inset - w);
  };
  rect(BORDER.outerInset, KEYLINE.outerWidthPx, livery.keyline);
  rect(BORDER.innerInset, KEYLINE.innerWidthPx, dim(livery.keyline, BORDER.innerBrightness));
}

const capAscent = (ctx) => ctx.measureText('H').actualBoundingBoxAscent;

// ── BOXES, FOR THE COLLISION ASSERTION ───────────────────────────────────────────────────
// Every element registers its ink box in mm. assertClear() fails the render if any two boxes
// that are not allowed to touch come within CLEARANCE_MM of each other.
export const CLEARANCE_MM = 0.5;   // chosen: half a millimetre between any two marks
function textBox(ctx, name, text, cxCover, baselineCover, tracking) {
  const w = trackedWidth(ctx, text, tracking);
  const m = ctx.measureText(text);
  return { name, x1: mm(cxCover - w / 2), x2: mm(cxCover + w / 2), y1: mm(baselineCover - m.actualBoundingBoxAscent), y2: mm(baselineCover + m.actualBoundingBoxDescent) };
}
const overlaps = (a, b, c) => a.x1 < b.x2 + c && b.x1 < a.x2 + c && a.y1 < b.y2 + c && b.y1 < a.y2 + c;
export function assertClear(boxes, frame) {
  const problems = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a.x1 < frame.x1 || a.x2 > frame.x2 || a.y1 < frame.y1 || a.y2 > frame.y2) problems.push(`${a.name} leaves the frame`);
    for (let j = i + 1; j < boxes.length; j++) if (overlaps(a, boxes[j], CLEARANCE_MM)) problems.push(`${a.name} × ${boxes[j].name}`);
  }
  return problems;
}
/** The frame every mark must sit inside: the inner keyline, less the clearance. */
export const FRAME = Object.freeze({
  x1: KEYLINE.innerInsetMm + CLEARANCE_MM, y1: KEYLINE.innerInsetMm + CLEARANCE_MM,
  x2: TRIM.w - KEYLINE.innerInsetMm - CLEARANCE_MM, y2: TRIM.h - KEYLINE.innerInsetMm - CLEARANCE_MM,
});
const rot180 = (b, name) => ({ name, x1: TRIM.w - b.x2, x2: TRIM.w - b.x1, y1: TRIM.h - b.y2, y2: TRIM.h - b.y1 });

// ── THE ROWS ─────────────────────────────────────────────────────────────────────────────
function drawEyebrow(ctx, livery, text, boxes) {
  coverSpace(ctx);
  ctx.font = FONTS.meta(EYEBROW.size);
  const capTop = EYEBROW.y - capAscent(ctx);                     // the cover's cap top, held
  ctx.font = FONTS.meta(TYPE.eyebrow.size);
  const y = capTop + capAscent(ctx);
  ctx.fillStyle = livery.keyline;
  drawTracked(ctx, text, CANVAS.w / 2, y, TYPE.eyebrow.tracking);
  boxes.push(textBox(ctx, 'eyebrow', text, CANVAS.w / 2, y, TYPE.eyebrow.tracking));
  return y;
}

function drawFoot(ctx, livery, { author, footer }, boxes) {
  coverSpace(ctx);
  if (author) {
    ctx.font = FONTS.italic(TYPE.author.size);
    ctx.fillStyle = livery.title;
    drawTracked(ctx, author, CANVAS.w / 2, Y.authorBaseline, TYPE.author.tracking);
    boxes.push(textBox(ctx, 'author', author, CANVAS.w / 2, Y.authorBaseline, 0));
  }
  if (footer) {
    ctx.font = FONTS.meta(TYPE.footer.size);
    ctx.fillStyle = livery.keyline;
    drawTracked(ctx, footer, CANVAS.w / 2, Y.footerBaseline, TYPE.footer.tracking);
    boxes.push(textBox(ctx, 'footer', footer, CANVAS.w / 2, Y.footerBaseline, TYPE.footer.tracking));
  }
}

function drawFleuron(ctx, cy, colour, boxes, sizeCover = FLEURON.size, cx = CANVAS.w / 2, name = 'fleuron') {
  coverSpace(ctx);
  const s = sizeCover / 1000;
  const inkCx = (FLEURON_BBOX.x1 + FLEURON_BBOX.x2) / 2;
  const inkCy = (FLEURON_BBOX.y1 + FLEURON_BBOX.y2) / 2;
  ctx.save();
  ctx.translate(cx - inkCx * s, cy - inkCy * s);
  ctx.scale(s, s);
  ctx.fillStyle = colour;
  ctx.fill(new Path2D(FLEURON_PATH));
  ctx.restore();
  const hw = ((FLEURON_BBOX.x2 - FLEURON_BBOX.x1) * s) / 2;
  const hh = (Math.abs(FLEURON_BBOX.y2 - FLEURON_BBOX.y1) * s) / 2;
  boxes?.push({ name, x1: mm(cx - hw), x2: mm(cx + hw), y1: mm(cy - hh), y2: mm(cy + hh) });
}

/** Author cap-top in cover px: where the fleuron's gap ends, as on the cover. */
function authorTop(ctx) {
  ctx.font = FONTS.italic(TYPE.author.size);
  return Y.authorBaseline - capAscent(ctx);
}

/**
 * The stack — title, rule, then the row beneath the rule — placed in the card's opened region
 * by the cover's own arithmetic (planCover): 20% of the slack above it, the fleuron at 42% of
 * the gap below it. `belowRule` is the height of whatever sits under the rule, measured from
 * the rule (the descriptor's gap and cap height, or an Ending's glyph row), or 0 for nothing.
 */
function placeStack(ctx, fitted, belowRule) {
  const lineHeight = fitted.size * TITLE.lineHeight;
  ctx.font = FONTS.title(fitted.size);
  const baselineOffset = (lineHeight + capAscent(ctx)) / 2;
  const titleBlock = fitted.lines.length * lineHeight;
  const ruleOffset = titleBlock + RULE.gapAboveFromTitle;
  const height = ruleOffset + belowRule;
  const slack = (Y.stackBottom - Y.stackTop) - height;
  if (slack < 0) throw new Error('card stack overflows its region');
  const top = Y.stackTop + slack * 0.20;
  return {
    top, height, slack, lineHeight,
    baselines: fitted.lines.map((_, i) => top + i * lineHeight + baselineOffset),
    ruleY: top + ruleOffset,
    bottom: top + height,
  };
}

function drawTitleAndRule(ctx, livery, fitted, stack, boxes) {
  coverSpace(ctx);
  ctx.fillStyle = livery.title;
  ctx.font = FONTS.title(fitted.size);
  fitted.lines.forEach((line, i) => {
    drawTracked(ctx, line, CANVAS.w / 2, stack.baselines[i], TITLE.tracking);
    boxes.push(textBox(ctx, `title ${i + 1}`, line, CANVAS.w / 2, stack.baselines[i], TITLE.tracking));
  });
  ctx.strokeStyle = livery.keyline;
  ctx.lineWidth = RULE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(CANVAS.w * RULE.x1, stack.ruleY);
  ctx.lineTo(CANVAS.w * RULE.x2, stack.ruleY);
  ctx.stroke();
  boxes.push({ name: 'rule', x1: mm(CANVAS.w * RULE.x1), x2: mm(CANVAS.w * RULE.x2), y1: mm(stack.ruleY - RULE_WIDTH_PX / 2), y2: mm(stack.ruleY + RULE_WIDTH_PX / 2) });
}

// ── CORNER INDICES ───────────────────────────────────────────────────────────────────────
const MARK_PX = pxOfPt(INDEX.markPt);   // the mark's size in cover px
/**
 * The index's ink box with the glyph box's top-left at (ox, oy) mm. Measured, not drawn.
 */
function indexGeometry(glyphs, mark, ox = INDEX.x, oy = INDEX.y) {
  const list = [].concat(glyphs);
  const gap = 0.6;
  const width = list.length * GLYPH_MM + (list.length - 1) * gap;
  const cx = ox + width / 2;
  c0.font = FONTS.title(MARK_PX);
  const markCap = mm(capAscent(c0));
  const markTop = oy + GLYPH_MM + INDEX.markGapMm;
  const fleuronH = markCap * 1.25;   // chosen: the fleuron's ink a quarter taller than a cap
  let box = { x1: ox, x2: ox + width, y1: oy, y2: oy + GLYPH_MM };
  if (mark) {
    const mw = mark === '❦' ? fleuronH * 1.1 : mm(trackedWidth(c0, mark, 0));
    box = { ...box, x1: Math.min(box.x1, cx - mw / 2), x2: Math.max(box.x2, cx + mw / 2), y2: markTop + (mark === '❦' ? fleuronH : markCap) };
  }
  return { list, gap, cx, markCap, markTop, fleuronH, ox, oy, box };
}

/**
 * Draw the top-left index and its 180° twin. `glyphs` is one motif or several (an Ending's
 * pair sits side by side); `mark` is a letter, '❦' for the fleuron, 'ring' for the Ring's
 * eight points, or null. Returns the bottom-right box as it lands on the card.
 */
function drawIndices(ctx, colour, glyphs, mark, boxes) {
  const paint = (c) => {
    const g = indexGeometry(glyphs, mark);
    mmSpace(c);
    g.list.forEach((m, i) => (m === 'ring'
      ? drawRingMark(c, g.ox + GLYPH_MM / 2, g.oy + GLYPH_MM / 2, colour)
      : drawGlyph(c, m, g.ox + i * (GLYPH_MM + g.gap), g.oy, GLYPH_MM, colour)));
    if (!mark) return g;
    if (mark === '❦') {
      const s = (coverPx(g.fleuronH) / Math.abs(FLEURON_BBOX.y2 - FLEURON_BBOX.y1)) * 1000;
      drawFleuron(c, coverPx(g.markTop + g.fleuronH / 2), colour, null, s, coverPx(g.cx));
      return g;
    }
    coverSpace(c);
    c.font = FONTS.title(MARK_PX);
    c.fillStyle = colour;
    drawTracked(c, mark, coverPx(g.cx), coverPx(g.markTop + g.markCap), 0);
    return g;
  };
  // Top left on the card; the bottom-right twin is the same drawing on a clear layer, turned
  // a half turn about the raster's centre.
  const g = paint(ctx);
  const { canvas: l, ctx: lc } = scratch();
  paint(lc);
  ctx.save();
  ctx.resetTransform();
  ctx.translate(R.w, R.h);
  ctx.rotate(Math.PI);
  ctx.drawImage(l, 0, 0);
  ctx.restore();

  const twin = rot180(g.box, 'index (bottom right)');
  boxes.push({ ...g.box, name: 'index (top left)' }, twin);
  return twin;
}

const c0 = createCanvas(10, 10).getContext('2d');

/** Eight points on a circle — the Ring, as a mark. In mm space. */
function drawRingMark(ctx, cx, cy, colour, r = GLYPH_MM * 0.38, dot = 0.42) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colour;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.arc(cx + r * Math.sin(a), cy - r * Math.cos(a), dot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── THE CODE ─────────────────────────────────────────────────────────────────────────────
/**
 * Place the code on the right, its bottom 1.2 mm above the bottom-right index. `style`:
 *   'direct' — modules in the livery's keyline colour straight on the ground;
 *   'panel'  — dark modules on a small cream panel: the livery's ground where the ground is
 *              dark, its keyline where the ground is light.
 */
/**
 * The code's foot, the same on every card: QR.bottomGapAboveIndexMm above the bottom-right
 * index, and never lower than 0.8 mm above the author line's ascenders. A long author line
 * (Stanley Princewill McDaniels, 27.6 mm) reaches under the code's left edge.
 */
function codeFootMm(ctx) {
  ctx.font = FONTS.title(MARK_PX);
  const indexTop = TRIM.h - (INDEX.y + GLYPH_MM + INDEX.markGapMm + mm(capAscent(ctx)) * 1.25);
  ctx.font = FONTS.italic(TYPE.author.size);
  const ascender = mm(Y.authorBaseline - ctx.measureText('bdfhklt').actualBoundingBoxAscent);
  return Math.min(indexTop - QR.bottomGapAboveIndexMm, ascender - 0.8);
}

function drawCardCode(ctx, livery, url, style, indexBox, boxes) {
  const code = encode(url);
  const side = panelPx(code) / PX_PER_MM;
  const x2 = QR.rightMm;
  const y2 = codeFootMm(ctx);
  const x1 = x2 - side;
  const y1 = y2 - side;
  drawCode(ctx, code, devX(x1), devY(y1), style === 'panel'
    ? { dark: isLight(livery) ? livery.keyline : livery.ground, panel: QR.panel }
    : { dark: livery.keyline, panel: null });
  boxes.push({ name: 'code', x1, x2, y1, y2 });
  return { code, x1, y1, x2, y2, side, style };
}

/**
 * The rendered pixels around a code: its box plus CODE_READ_MARGIN_MM on every side, cut from the
 * 600-dpi raster as drawn. The decoder reads this, not the whole face, because @napi-rs/canvas
 * 1.0.6 never returns the memory of a full-raster getImageData (about 14 MB a call, measured,
 * gc or not), and a deck of renders ran the Codespace out of memory. The margin takes in the
 * ground and whatever else is printed beside the code, so the decoder still has to find it.
 */
export const CODE_READ_MARGIN_MM = 3;
function codeRegion(ctx, b) {
  const x = Math.max(0, Math.floor(devX(b.x1 - CODE_READ_MARGIN_MM)));
  const y = Math.max(0, Math.floor(devY(b.y1 - CODE_READ_MARGIN_MM)));
  const w = Math.min(R.w, Math.ceil(devX(b.x2 + CODE_READ_MARGIN_MM))) - x;
  const h = Math.min(R.h, Math.ceil(devY(b.y2 + CODE_READ_MARGIN_MM))) - y;
  ctx.save();
  ctx.resetTransform();
  const img = ctx.getImageData(x, y, w, h);
  ctx.restore();
  return img;
}

// ── THE STORY FACE ───────────────────────────────────────────────────────────────────────
/**
 * `card`: a deck.json entry ({ slug, title, author, livery, subcategory, descriptor, url, motif }).
 * `opts.qr`: null (no code), 'direct' or 'panel'.
 */
export function renderStoryFace(card, opts = {}) {
  assertSameFaces();
  if (card.kind === 'picture') throw new Error(`${card.slug} is a picture card — renderPictureFace`);
  const livery = LIVERIES[card.livery];
  const { canvas, ctx } = surface();
  const boxes = [];
  paintGround(ctx, livery, card.slug);
  paintKeylines(ctx, livery);

  // The cover's own plan decides the title's rung and wrap, measured on a clean context.
  const plan = planCover(createCanvas(10, 10).getContext('2d'), {
    slug: card.slug, title: card.title, author: card.author, category: card.livery,
    subcategory: card.subcategory, descriptor: card.descriptor,
  });

  drawEyebrow(ctx, livery, plan.eyebrow, boxes);

  let desc = null;
  let belowRule = 0;
  if (plan.descriptor) {
    // The descriptor the COVER plans (COVERS-R19/R20): its lines, broken the way a title breaks
    // where it is wider than the title's measure, at the cover's own size and tracking. The face
    // is the cover scaled by width, so the cover's px are the card's px. Between lines, the
    // cover's derived leading (descriptorLeading: cap height plus word gap). The LAST line sits
    // where the single line sat, and the stack makes room for the lines above it, as the
    // cover's does.
    ctx.font = FONTS.meta(TYPE.descriptor.size);
    const leading = plan.descriptor.lines.length > 1 ? descriptorLeading(ctx).leading : 0;
    desc = { text: plan.descriptor.text, lines: plan.descriptor.lines.map((l) => l.text), tracking: TYPE.descriptor.tracking, leading, width: plan.descriptor.width };
    ctx.font = FONTS.meta(TYPE.descriptor.size);
    belowRule = DESCRIPTOR.gapBelowRule + capAscent(ctx) + (desc.lines.length - 1) * leading;
  }
  const stack = placeStack(ctx, plan.title, belowRule);
  drawTitleAndRule(ctx, livery, plan.title, stack, boxes);
  if (desc) {
    coverSpace(ctx);
    ctx.font = FONTS.meta(TYPE.descriptor.size);
    ctx.fillStyle = livery.keyline;
    desc.lines.forEach((line, i) => {
      const y = stack.bottom - (desc.lines.length - 1 - i) * desc.leading;
      drawTracked(ctx, line, CANVAS.w / 2, y, desc.tracking);
      boxes.push(textBox(ctx, desc.lines.length > 1 ? `descriptor ${i + 1}` : 'descriptor', line, CANVAS.w / 2, y, desc.tracking));
    });
  }
  const top = authorTop(ctx);
  const fleuronY = stack.bottom + (top - stack.bottom) * FLEURON.gapFraction;
  drawFleuron(ctx, fleuronY, livery.keyline, boxes);
  drawFoot(ctx, livery, { author: plan.author, footer: plan.footer }, boxes);

  const indexBox = drawIndices(ctx, livery.keyline, card.motif, LIVERY_MARK[card.livery], boxes);
  const code = opts.qr ? drawCardCode(ctx, livery, card.url, opts.qr, indexBox, boxes) : null;

  // Every mark, the descriptor included, must clear the inner keyline and every other mark.
  // (R1.2 excused a descriptor wider than the keylines; the covers' break makes that impossible.)
  const collisions = assertClear(boxes, FRAME);
  if (collisions.length) throw new Error(`${card.slug}: marks collide — ${collisions.join('; ')}`);
  return {
    png: canvas.toBuffer('image/png'),
    codeImage: code ? codeRegion(ctx, code) : null,
    layout: { kind: 'story', slug: card.slug, rung: plan.title.size, rungPt: ptOf(plan.title.size), lines: plan.title.lines, stack, fleuronY, descriptor: desc, boxes, code: code && { version: code.code.version, modules: code.code.size, text: code.code.text, sideMm: code.side, x1: code.x1, y1: code.y1, style: code.style } },
  };
}

// ── THE PICTURE CARD: MATTED (R1.3) ──────────────────────────────────────────────────────
// One per published series, wearing the series' curated poster (CLAUDE.md: Series covers are
// curated artwork by rule), whole and untouched, on a Series-cream mount that runs out to the
// bleed. The index and the code sit in the mount, never on the art. The geometry is
// PICTURE_GEOMETRY below, one for all three cards; geometry.mjs says where each number comes from.

/** The shared geometry, in mm from the trim's top-left. Derived; nothing in it is typed in. */
export const PICTURE_GEOMETRY = (() => {
  const side = panelPx(encode('/series/x', { version: PICTURE.qrVersion })) / PX_PER_MM;
  const code = { x1: (TRIM.w - side) / 2, x2: (TRIM.w + side) / 2, y2: TRIM.h - SAFE_MM, y1: TRIM.h - SAFE_MM - side };
  const top = INDEX.y + GLYPH_MM + CLEARANCE_MM;
  const bottom = code.y1 - CLEARANCE_MM;
  const h = bottom - top;
  const w = (h * 2) / 3;
  const poster = { x1: (TRIM.w - w) / 2, x2: (TRIM.w + w) / 2, y1: top, y2: bottom };
  return Object.freeze({ poster: Object.freeze(poster), code: Object.freeze({ ...code, side }), posterW: w, posterH: h });
})();

/**
 * The source rectangle of a poster file at exactly 2:3: the full height, and the width trimmed by
 * the same amount from each side (Beta Princess's file is 1406 × 2048, 0.6865; the other two are
 * already 2:3 and lose nothing). Fractional pixels are kept, so the trim is exactly even.
 */
export function posterCrop(img) {
  const want = (img.height * 2) / 3;
  if (img.width < want - 1e-9) throw new Error(`poster is narrower than 2:3 (${img.width} × ${img.height}); the ruling only trims width`);
  const trim = (img.width - want) / 2;
  return { sx: trim, sy: 0, sw: want, sh: img.height, trimEachSidePx: trim };
}

/** `card.poster` is the loaded image. `opts.qr` adds the code. */
export function renderPictureFace(card, opts = {}) {
  assertSameFaces();
  const img = card.poster;
  if (!img) throw new Error(`${card.slug}: no poster image supplied`);
  const G = PICTURE_GEOMETRY;
  const crop = posterCrop(img);
  const { canvas, ctx } = surface();
  const boxes = [];
  ctx.resetTransform();
  ctx.fillStyle = PICTURE.mount;
  ctx.fillRect(0, 0, R.w, R.h);
  mmSpace(ctx);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, G.poster.x1, G.poster.y1, G.posterW, G.posterH);
  boxes.push({ name: 'poster', ...G.poster });

  drawIndices(ctx, PICTURE.ink, card.motif, null, boxes);
  let code = null;
  if (opts.qr) {
    const c = encode(card.url, { version: PICTURE.qrVersion });
    if (Math.abs(panelPx(c) / PX_PER_MM - G.code.side) > 1e-9) throw new Error(`${card.slug}: the code is not the shared size`);
    drawCode(ctx, c, devX(G.code.x1), devY(G.code.y1), { dark: PICTURE.ink, panel: null });
    boxes.push({ name: 'code', x1: G.code.x1, x2: G.code.x2, y1: G.code.y1, y2: G.code.y2 });
    code = { version: c.version, modules: c.size, text: c.text, sideMm: G.code.side, style: 'mount' };
  }
  // No keyline on a picture card: its marks are held inside the SAFE line, and the poster, the
  // index and the code keep CLEARANCE_MM from one another, as every mark does.
  const collisions = assertClear(boxes, { x1: SAFE_MM, y1: SAFE_MM, x2: TRIM.w - SAFE_MM, y2: TRIM.h - SAFE_MM });
  if (collisions.length) throw new Error(`${card.slug}: marks collide — ${collisions.join('; ')}`);
  return {
    png: canvas.toBuffer('image/png'),
    codeImage: code ? codeRegion(ctx, G.code) : null,
    layout: {
      kind: 'picture', slug: card.slug, boxes, code,
      fit: { posterW: img.width, posterH: img.height, crop, drawnWmm: G.posterW, drawnHmm: G.posterH, effectiveDpi: img.height / (G.posterH / 25.4) },
    },
  };
}

// ── THE STORY BACK ───────────────────────────────────────────────────────────────────────
// Ikenna's icon, cards/Story-Island-icon.png. Its ground is sampled from the file, never chosen,
// and checked FLAT: every edge pixel must be the one colour, or the back is refused, because a
// ground that varies would show the icon's tile edge where the flat run-out meets it. The icon
// is then centred at the card's width (its own width = the trim width) on that colour, run out
// to the bleed. Not rotationally symmetric, which is accepted.
export function sampleIconGround(img) {
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const at = (x, y) => { const o = (y * img.width + x) * 4; return [d[o], d[o + 1], d[o + 2], d[o + 3]]; };
  const ref = at(0, 0);
  let worst = 0;
  let alphaMin = 255;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      alphaMin = Math.min(alphaMin, d[o + 3]);
      if (x > 0 && y > 0 && x < img.width - 1 && y < img.height - 1) continue;
      n += 1;
      const p = at(x, y);
      worst = Math.max(worst, ...[0, 1, 2].map((k) => Math.abs(p[k] - ref[k])));
    }
  }
  const hex = `#${ref.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return { hex, rgb: ref.slice(0, 3), edgePixels: n, worstEdgeDeviation: worst, alphaMin, flat: worst === 0 && alphaMin === 255 };
}

export function renderStoryBack(img) {
  const ground = sampleIconGround(img);
  if (!ground.flat) throw new Error(`story back refused: the icon's ground is not flat (worst edge deviation ${ground.worstEdgeDeviation}, min alpha ${ground.alphaMin})`);
  const { canvas, ctx } = surface();
  ctx.resetTransform();
  ctx.fillStyle = ground.hex;
  ctx.fillRect(0, 0, R.w, R.h);
  const w = STORY_BACK.widthMm * PX_PER_MM;
  const h = w * (img.height / img.width);
  const x = (R.w - w) / 2;
  const y = (R.h - h) / 2;
  ctx.drawImage(img, x, y, w, h);
  // Seam check: the drawn icon's edge pixels against the run-out, on the rendered raster.
  const out = ctx.getImageData(0, 0, R.w, R.h).data;
  let seam = 0;
  const px = (X, Y) => { const o = (Y * R.w + X) * 4; return [out[o], out[o + 1], out[o + 2]]; };
  for (const [X, Y] of [[Math.floor(x) - 1, Math.floor(R.h / 2)], [Math.floor(x) + 1, Math.floor(R.h / 4)], [Math.floor(R.w / 2), Math.floor(y) - 1], [Math.floor(R.w / 2), Math.floor(y) + 1], [Math.ceil(x + w) + 1, Math.floor(y) + 3], [Math.ceil(x + w) - 2, Math.ceil(y + h) - 2]]) {
    seam = Math.max(seam, ...px(X, Y).map((v, k) => Math.abs(v - ground.rgb[k])));
  }
  return {
    png: canvas.toBuffer('image/png'),
    layout: { ground, iconPx: [img.width, img.height], drawnMm: [w / PX_PER_MM, h / PX_PER_MM], topMm: y / PX_PER_MM - BLEED, effectiveDpi: img.width / (STORY_BACK.widthMm / 25.4), seamDeviation: seam },
  };
}

// ── THE ENDING FACE ──────────────────────────────────────────────────────────────────────
export function renderEndingFace(ending) {
  assertSameFaces();
  const livery = ENDING;
  const { canvas, ctx } = surface();
  const boxes = [];
  paintGround(ctx, livery, `ending-${ending.name}`);
  paintKeylines(ctx, livery);
  drawEyebrow(ctx, livery, 'ENDING', boxes);

  const plan = planCover(createCanvas(10, 10).getContext('2d'), { slug: 'ending', title: ending.name, author: '', category: 'short' });
  // Where the descriptor sits: the two glyphs, each with its name beneath at the floor.
  ctx.font = FONTS.meta(TYPE.descriptor.size);
  const nameCap = capAscent(ctx);
  const nameGap = coverPx(1.0);
  const rowHeight = coverPx(GLYPH_MM) + nameGap + nameCap;
  const stack = placeStack(ctx, plan.title, DESCRIPTOR.gapBelowRule + rowHeight);
  drawTitleAndRule(ctx, livery, plan.title, stack, boxes);
  const rowTop = stack.ruleY + DESCRIPTOR.gapBelowRule;
  const pitch = coverPx(GLYPH_MM) * 2.6;   // centre to centre, chosen: wide enough for the longer name
  ending.pair.forEach((m, i) => {
    const cx = CANVAS.w / 2 + (i === 0 ? -pitch / 2 : pitch / 2);
    mmSpace(ctx);
    drawGlyph(ctx, m, mm(cx) - GLYPH_MM / 2, mm(rowTop), GLYPH_MM, livery.keyline);
    boxes.push({ name: `glyph ${m}`, x1: mm(cx) - GLYPH_MM / 2, x2: mm(cx) + GLYPH_MM / 2, y1: mm(rowTop), y2: mm(rowTop) + GLYPH_MM });
    coverSpace(ctx);
    ctx.font = FONTS.meta(TYPE.descriptor.size);
    ctx.fillStyle = livery.keyline;
    const y = rowTop + coverPx(GLYPH_MM) + nameGap + nameCap;
    drawTracked(ctx, caps(m), cx, y, TYPE.descriptor.tracking);
    boxes.push(textBox(ctx, `name ${m}`, caps(m), cx, y, TYPE.descriptor.tracking));
  });
  const fleuronY = stack.bottom + (authorTop(ctx) - stack.bottom) * FLEURON.gapFraction;
  drawFleuron(ctx, fleuronY, livery.keyline, boxes);
  drawFoot(ctx, livery, { author: '', footer: 'THE TURN' }, boxes);
  drawIndices(ctx, livery.keyline, ending.pair, null, boxes);
  const collisions = assertClear(boxes, FRAME);
  if (collisions.length) throw new Error(`${ending.name}: marks collide — ${collisions.join('; ')}`);
  return { png: canvas.toBuffer('image/png'), layout: { kind: 'ending', name: ending.name, rung: plan.title.size, lines: plan.title.lines, boxes } };
}

// ── THE RING CARD ────────────────────────────────────────────────────────────────────────
// The eight motifs clockwise from the top, each Ending named between its two neighbours.
// The glyphs sit upright on the ring; the names run along it, outside, reading clockwise on
// the upper half and turned to read from the foot on the lower half.
export const RING = Object.freeze({ glyphRadiusMm: 12.5, nameRadiusMm: 19.6 });
export function renderRingFace() {
  assertSameFaces();
  const livery = ENDING;
  const { canvas, ctx } = surface();
  const boxes = [];
  paintGround(ctx, livery, 'the-ring');
  paintKeylines(ctx, livery);
  drawEyebrow(ctx, livery, 'THE RING', boxes);
  drawFoot(ctx, livery, { author: '', footer: 'THE TURN' }, boxes);
  drawIndices(ctx, livery.keyline, 'ring', null, boxes);

  const cx = TRIM.w / 2;
  const cy = TRIM.h / 2;
  mmSpace(ctx);
  ctx.strokeStyle = dim(livery.keyline, BORDER.innerBrightness);
  ctx.lineWidth = mm(RULE_WIDTH_PX);
  ctx.beginPath();
  ctx.arc(cx, cy, RING.glyphRadiusMm, 0, Math.PI * 2);
  ctx.stroke();
  MOTIFS.forEach((m, i) => {
    const a = (i * Math.PI) / 4;
    const gx = cx + RING.glyphRadiusMm * Math.sin(a);
    const gy = cy - RING.glyphRadiusMm * Math.cos(a);
    mmSpace(ctx);
    ctx.fillStyle = livery.ground;                       // knock the ring out behind the glyph
    ctx.beginPath();
    ctx.arc(gx, gy, GLYPH_MM * 0.62, 0, Math.PI * 2);
    ctx.fill();
    drawGlyph(ctx, m, gx - GLYPH_MM / 2, gy - GLYPH_MM / 2, GLYPH_MM, livery.keyline);
    boxes.push({ name: `glyph ${m}`, x1: gx - GLYPH_MM / 2, x2: gx + GLYPH_MM / 2, y1: gy - GLYPH_MM / 2, y2: gy + GLYPH_MM / 2 });
  });
  // The names, along the ring, on two lines: THE above the name, both at the type floor.
  // One line does not fit: THE REVELATION is 22.8 mm at the descriptor's tracking, against
  // 15.4 mm of arc per Ending. The tracking steps down (never the size) until every pair of
  // neighbours clears by CLEARANCE_MM, measured on the label's inner edge, where arc is shortest.
  coverSpace(ctx);
  ctx.font = FONTS.meta(TYPE.descriptor.size);
  const capH = mm(capAscent(ctx));
  const lineGap = 0.6;
  const labelH = 2 * capH + lineGap;
  const rIn = RING.nameRadiusMm - labelH / 2;
  const split = (n) => n.replace(/^THE\s+/, '');
  let tracking = TYPE.descriptor.tracking;
  const widthAt = (t, txt) => mm(trackedWidth(ctx, txt, t));
  const worstGap = (t) => Math.min(...ENDINGS.map((e, i) => {
    const n = ENDINGS[(i + 1) % ENDINGS.length];
    return (Math.PI / 4) * rIn - (widthAt(t, split(e.name)) + widthAt(t, split(n.name))) / 2;
  }));
  while (worstGap(tracking) < CLEARANCE_MM && tracking > 0) tracking = Math.max(0, tracking - 0.5);
  const names = [];
  ENDINGS.forEach((e, i) => {
    const a = ((i + 0.5) * Math.PI) / 4;
    const lower = Math.cos(a) < 0;
    const noun = split(e.name);
    const w = Math.max(widthAt(tracking, noun), widthAt(tracking, 'THE'));
    const r = RING.nameRadiusMm;
    ctx.save();
    mmSpace(ctx);
    ctx.translate(cx + r * Math.sin(a), cy - r * Math.cos(a));
    ctx.rotate(lower ? a + Math.PI : a);
    ctx.scale(mm(1), mm(1));                              // into cover px, centred on the point
    ctx.fillStyle = livery.keyline;
    ctx.font = FONTS.meta(TYPE.descriptor.size);
    drawTracked(ctx, 'THE', 0, coverPx(-labelH / 2 + capH), tracking);
    drawTracked(ctx, noun, 0, coverPx(labelH / 2), tracking);
    ctx.restore();
    const halfArc = (w / 2) / rIn;
    const corners = [-1, 0, 1].flatMap((sg) => [rIn, rIn + labelH].map((rr) => {
      const t = a + sg * halfArc;
      return [cx + rr * Math.sin(t), cy - rr * Math.cos(t)];
    }));
    names.push({ name: e.name, a, halfArc, w, corners, tracking });
  });
  const problems = assertClear(boxes, FRAME);
  names.forEach((n, i) => {
    const next = names[(i + 1) % names.length];
    const gap = (Math.PI / 4 - n.halfArc - next.halfArc) * rIn;
    if (gap < CLEARANCE_MM) problems.push(`${n.name} × ${next.name} (${gap.toFixed(2)} mm apart)`);
    for (const [x, y] of n.corners) if (x < FRAME.x1 || x > FRAME.x2 || y < FRAME.y1 || y > FRAME.y2) problems.push(`${n.name} leaves the frame`);
  });
  // every other mark vs the names' corners
  for (const n of names) {
    for (const b of boxes) {
      for (const [x, y] of n.corners) if (x > b.x1 - CLEARANCE_MM && x < b.x2 + CLEARANCE_MM && y > b.y1 - CLEARANCE_MM && y < b.y2 + CLEARANCE_MM) problems.push(`${n.name} × ${b.name}`);
    }
  }
  if (problems.length) throw new Error(`ring: ${problems.join('; ')}`);
  return { png: canvas.toBuffer('image/png'), layout: { kind: 'ring', boxes, tracking, capH, labelH, rIn, names: names.map(({ name, w, a }) => ({ name, widthMm: w, angleDeg: (a * 180) / Math.PI })) } };
}

// ── THE ENDING BACK (shared by the Ring) ─────────────────────────────────────────────────
// Full bleed, nothing near the trim: the Ring as eight points on a circle, centred, in display
// gold on the Ending ground. Exactly symmetric under a half turn, grain included, so a
// face-down Ending tells the table nothing by which way up it lies.
export const BACK_RING = Object.freeze({ radiusMm: 13, dotMm: 1.1, hairline: true });
export function renderEndingBack() {
  const livery = ENDING;
  const { canvas, ctx } = surface();
  paintGround(ctx, livery, 'ending-back', { symmetric: true, treatment: false });
  ctx.resetTransform();
  const cx = R.w / 2;
  const cy = R.h / 2;
  const r = BACK_RING.radiusMm * PX_PER_MM;
  ctx.strokeStyle = livery.keyline;
  ctx.lineWidth = KEYLINE.outerWidthPx * K;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = livery.keyline;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.arc(cx + r * Math.sin(a), cy - r * Math.cos(a), BACK_RING.dotMm * PX_PER_MM, 0, Math.PI * 2);
    ctx.fill();
  }
  // Skia's antialiasing is not itself symmetric under a half turn: the dots' and circle's edge
  // pixels differ by up to 50/255 from their partners. So the top half is the drawing and the
  // bottom half is that drawing turned a half turn, pixel for pixel. The back is then
  // identical whichever way up it lies, and isHalfTurnSymmetric checks it to zero.
  const imageData = ctx.getImageData(0, 0, R.w, R.h);
  const d = imageData.data;
  const total = R.w * R.h;
  for (let i = 0; i < Math.floor(total / 2); i++) {
    const j = total - 1 - i;
    for (let k = 0; k < 4; k++) d[j * 4 + k] = d[i * 4 + k];
  }
  ctx.putImageData(imageData, 0, 0);
  return { png: canvas.toBuffer('image/png'), imageData };
}

/** True when an image is identical under a half turn, within `tol` per channel. */
export function isHalfTurnSymmetric({ data, width, height }, tol = 0) {
  let worst = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = (y * width + x) * 4;
      const b = ((height - 1 - y) * width + (width - 1 - x)) * 4;
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(data[a + k] - data[b + k]));
    }
  }
  return { symmetric: worst <= tol, worst };
}

export { FONTS, MARK_PX };
