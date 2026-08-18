// THE COVER RENDERER — a story record in, a finished 1600 × 2400 PNG out.
//
//   import { renderCover } from './render.mjs';
//   const { png, plan } = await renderCover({ slug, title, author, category, subcategory });
//
// ── THE DETERMINISM CONTRACT ─────────────────────────────────────────────────────────────
// Same record in, byte-identical PNG out — on this machine, on a runner, and in five years.
// Four things have to hold for that, and all four are pinned rather than hoped for:
//
//   1. NO NETWORK. Nothing here fetches. Fonts come off disk from assets/covers/fonts, the
//      fleuron is a frozen path, and there is no AI, no remote asset, and no clock read.
//   2. THE RENDERER IS PINNED EXACTLY. package.json carries "@napi-rs/canvas": "1.0.6" with
//      no caret, and that is not tidiness. TEXT MEASUREMENT MUST COME FROM THE SAME ENGINE
//      THAT DRAWS: the title auto-sizer picks a size by asking measureText whether a line
//      fits, and a minor engine bump that changes hinting or rounding by half a pixel can
//      move a title from "fits at 140" to "fits at 112" — a visibly different cover from an
//      unchanged record. A caret would let that happen on someone else's npm install.
//   3. THE FONTS ARE VENDORED AND HASHED. See assets/covers/fonts/PROVENANCE.md.
//   4. THE GRAIN IS SEEDED FROM THE SLUG. See scripts/covers/random.mjs.
//
// ── THE FALLBACK HAZARD, AND THE GUARD ───────────────────────────────────────────────────
// GlobalFonts sees the host's system fonts as well as ours — on this container that includes
// DejaVu, Liberation and FreeSerif. If a family name failed to resolve, Skia would silently
// draw in a system face instead of raising, and the cover would look plausible and be wrong
// in a way no assertion about the record could catch. `registerFonts()` therefore checks
// that each family arrived, and `assertNoFallback()` re-measures a known string against a
// recorded width. Silence is not treated as success anywhere in this file.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, Path2D } from '@napi-rs/canvas';
import { FLEURON_PATH, FLEURON_BBOX } from '../../assets/covers/fleuron-2766.mjs';
import { liveryFor, eyebrowFor, isLight, IMPRINT_EYEBROW, LIVERIES } from './liveries.mjs';
import { rngForSlug } from './random.mjs';
import { caps, drawTracked, trackedWidth, wrapTracked } from './text.mjs';
import {
  AUTHOR, BORDER, CANVAS, DESCRIPTOR, EYEBROW, FLEURON, FOOTER, GLOW, GRAIN,
  instalmentFooter, RULE, STACK, STACK_REGION, TITLE, VIGNETTE,
} from './layout.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FONT_DIR = join(ROOT, 'assets/covers/fonts');

// The three faces, each registered under a family that names exactly one file. See
// PROVENANCE.md for why the weights are baked into the files rather than asked for here.
const FACES = [
  { file: 'CormorantGaramond-SemiBold.ttf', family: 'Cormorant Garamond SemiBold' },
  { file: 'CormorantGaramond-Italic.ttf',   family: 'Cormorant Garamond Italic' },
  { file: 'EBGaramond-Regular.ttf',         family: 'EB Garamond' },
];

/** Font strings. No weight or style keyword: the FILE is the weight and the style. Asking
 *  for `italic` against an already-italic face invites a synthetic oblique on top of a real
 *  one, which is the sort of thing that differs between engine versions. */
const FONTS = {
  title:  (px) => `${px}px "Cormorant Garamond SemiBold"`,
  italic: (px) => `${px}px "Cormorant Garamond Italic"`,
  meta:   (px) => `${px}px "EB Garamond"`,
};

let registered = false;
export function registerFonts() {
  if (registered) return;
  for (const { file, family } of FACES) {
    const path = join(FONT_DIR, file);
    if (!GlobalFonts.registerFromPath(path, family)) throw new Error(`font failed to register: ${path}`);
  }
  const have = new Set(GlobalFonts.families.map((f) => f.family));
  const missing = FACES.filter((f) => !have.has(f.family)).map((f) => f.family);
  if (missing.length) throw new Error(`fonts registered but not resolvable: ${missing.join(', ')}`);
  registered = true;
}

/**
 * Prove the vendored faces are the ones being drawn with.
 *
 * Each face is asked for the width of a string at a fixed size and compared to a width
 * recorded from the vendored files. A system-font fallback misses by tens of pixels, so the
 * tolerance can be tight without being brittle about sub-pixel engine differences.
 * Called by tests/covers/determinism.test.mjs and by `npm run covers:verify`.
 */
export function measureCanaries() {
  registerFonts();
  const ctx = createCanvas(10, 10).getContext('2d');
  const out = {};
  for (const [key, fn] of Object.entries(FONTS)) {
    ctx.font = fn(100);
    out[key] = +ctx.measureText('Hamburgefonstiv').width.toFixed(4);
  }
  return out;
}

// ── COLOUR ───────────────────────────────────────────────────────────────────────────────
const hexToRgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
/** Scale each channel. Used for the inner keyline at 55% of the outer's brightness. */
const dim = (hex, f) => {
  const { r, g, b } = hexToRgb(hex);
  const c = (v) => Math.round(v * f);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
};
/** Subtract a flat amount per channel. The vignette's darkening, floored at black. */
const darken = (hex, amount) => {
  const { r, g, b } = hexToRgb(hex);
  const c = (v) => Math.max(0, v - amount);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
};

// ── THE GROUND ───────────────────────────────────────────────────────────────────────────

// ── SCRATCH SURFACES ─────────────────────────────────────────────────────────────────────
// The glow, the vignette and the grain are each composited from a full-canvas offscreen
// layer: 1600 × 2400 × 4 bytes = 15.4 MB apiece, plus another 15.4 MB for the grain's
// ImageData. Allocated fresh per cover that is ~46 MB per render, and the memory is held by
// SKIA, not by V8 — so the garbage collector does not feel the pressure and does not run.
//
// THIS WAS NOT THEORETICAL. The first full-library pass died at "Terminated" — the OOM
// killer — about ten seconds in, having rendered a handful of the 158. The renderer worked
// perfectly on one cover and could not do a hundred and fifty.
//
// So the layers are allocated ONCE and reused. Every user clears before drawing, and both
// clears are total: `clearRect` over the whole surface for the canvas, `fill(0)` over the
// whole buffer for the ImageData. A partial clear would let one cover's grain bleed into the
// next, which is the sort of bug that produces a library where 157 covers are right.
//
// The reuse is invisible to the output: tests/covers/determinism.test.mjs renders the same
// record first alone and then after other covers and asserts the two are byte-identical.
//
// THE OUTPUT SURFACE IS POOLED TOO, and that is why renderCover no longer hands back a
// canvas. Pooling the three LAYERS alone was not enough: a second full-library pass got
// twice as far and still died, because the output canvas is another 15.4 MB per cover and
// 158 of them is 2.4 GB of native memory that V8 has no reason to collect. The PNG buffer
// returned from toBuffer() is a copy, so callers lose nothing — the contact sheet reads its
// thumbnails back through loadImage(png), never from a live canvas.
let outCanvas = null;
let scratchCanvas = null;
let scratchImage = null;

/** Reset a pooled context to the state a fresh one would be in. */
function reset(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.resetTransform?.();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);
  return ctx;
}

function output() {
  outCanvas ??= createCanvas(CANVAS.w, CANVAS.h);
  return { canvas: outCanvas, ctx: reset(outCanvas) };
}

function scratch() {
  scratchCanvas ??= createCanvas(CANVAS.w, CANVAS.h);
  const ctx = scratchCanvas.getContext('2d');
  ctx.resetTransform?.();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);
  return { canvas: scratchCanvas, ctx };
}

/** Dark liveries: a soft radial wash off the top-left corner, blended at 17%. */
function paintGlow(ctx, livery) {
  const { canvas: layer, ctx: lc } = scratch();
  lc.filter = `blur(${GLOW.blur}px)`;
  lc.fillStyle = livery.glow;
  lc.beginPath();
  lc.ellipse(
    CANVAS.w * GLOW.centre.x, CANVAS.h * GLOW.centre.y,
    (CANVAS.w * GLOW.widthFactor) / 2, (CANVAS.h * GLOW.heightFactor) / 2,
    0, 0, Math.PI * 2,
  );
  lc.fill();
  ctx.save();
  ctx.globalAlpha = GLOW.alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/**
 * Light liveries: a vignette instead of a glow.
 *
 * The ground is composited against ITSELF darkened by a flat amount per channel, through a
 * large blurred elliptical hole. Same hue, less light at the edges — which is what a vignette
 * is. A black overlay at low alpha would also darken the edges but would desaturate them
 * towards grey, and on a cream ground that reads as dirt.
 */
function paintVignette(ctx, livery) {
  const { canvas: layer, ctx: lc } = scratch();
  lc.fillStyle = darken(livery.ground, VIGNETTE.darkenPerChannel);
  lc.fillRect(0, 0, CANVAS.w, CANVAS.h);
  lc.globalCompositeOperation = 'destination-out';
  lc.filter = `blur(${VIGNETTE.blur}px)`;
  lc.fillStyle = '#fff';
  lc.beginPath();
  lc.ellipse(
    CANVAS.w / 2, CANVAS.h / 2,
    CANVAS.w * VIGNETTE.radiusFactor.x, CANVAS.h * VIGNETTE.radiusFactor.y,
    0, 0, Math.PI * 2,
  );
  lc.fill();
  ctx.drawImage(layer, 0, 0);
}

/**
 * Film grain — 150,000 specks at 0–45 luminance, from the slug's own stream.
 *
 * Written straight into an ImageData buffer rather than as 150,000 fillRect calls: the pixel
 * grid is the thing being described, the loop is ~40× faster, and — the reason that matters
 * — a buffer write cannot be perturbed by antialiasing, whereas a 1×1 rect at an integer
 * coordinate is at the mercy of the rasteriser's rounding.
 *
 * Specks may land on the same pixel; that is not a collision to guard against. The last write
 * wins, deterministically, and 150,000 samples over 3.84M pixels is a 3.9% coverage where
 * overlap is part of the texture.
 */
function paintGrain(ctx, slug, light) {
  const rand = rngForSlug(slug);
  const { canvas: layer, ctx: lc } = scratch();
  scratchImage ??= lc.createImageData(CANVAS.w, CANVAS.h);
  const img = scratchImage;
  const d = img.data;
  d.fill(0);   // total, not partial — see the scratch-surface note above
  for (let i = 0; i < GRAIN.count; i++) {
    const x = Math.floor(rand() * CANVAS.w);
    const y = Math.floor(rand() * CANVAS.h);
    const v = Math.floor(rand() * (GRAIN.maxLuminance + 1));
    const o = (y * CANVAS.w + x) * 4;
    d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
  }
  lc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = light ? GRAIN.alphaLight : GRAIN.alphaDark;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function paintBorder(ctx, livery) {
  ctx.strokeStyle = livery.keyline;
  ctx.lineWidth = BORDER.outerWidth;
  const o = BORDER.outerInset;
  ctx.strokeRect(o + BORDER.outerWidth / 2, o + BORDER.outerWidth / 2,
    CANVAS.w - 2 * o - BORDER.outerWidth, CANVAS.h - 2 * o - BORDER.outerWidth);
  ctx.strokeStyle = dim(livery.keyline, BORDER.innerBrightness);
  ctx.lineWidth = BORDER.innerWidth;
  const i = BORDER.innerInset;
  ctx.strokeRect(i + BORDER.innerWidth / 2, i + BORDER.innerWidth / 2,
    CANVAS.w - 2 * i - BORDER.innerWidth, CANVAS.h - 2 * i - BORDER.innerWidth);
}

/** Cap-height ascent at the ctx's current font, measured by the engine that will draw. */
const capAscent = (ctx) => ctx.measureText('H').actualBoundingBoxAscent;

/**
 * Choose the title size and wrap.
 *
 * The ladder is walked in order and the first rung that satisfies BOTH constraints wins:
 *
 *   1. the wrap fits within that rung's line cap — the horizontal question;
 *   2. the resulting stack fits the region it floats in — the VERTICAL question.
 *
 * ── BE HONEST ABOUT CONSTRAINT 2: AS THE LADDER STANDS, IT CANNOT BIND ───────────────────
 * It was added when the descriptor gate opened, on the assumption that a descriptor might
 * push a long title down a rung. Measured, it does not — and it cannot. The region is 1556px
 * and the worst case any CAPPED rung can produce, with a descriptor, is:
 *
 *     186px x 2 lines = 636px      112px x 3 = 595px      78px x 4 = 568px
 *     140px x 2 lines = 532px       92px x 4 = 631px
 *
 * 636px of 1556px — 41% of the region. Every capped rung has more than twice the room it can
 * possibly need, so constraint 2 never decides anything, and across all 158 published stories
 * with every ratified descriptor applied, ZERO titles step down.
 *
 * Nor does it rescue the one case that CAN overflow. A title long enough to overflow does so
 * at the 68px fallback rung, which is uncapped and last — there is nothing below it to step
 * to, so an impossible cover still raises, exactly as it should.
 *
 * ── SO WHY KEEP IT ───────────────────────────────────────────────────────────────────────
 * Because the arithmetic above is a property of the CURRENT line caps, not a law. Raise
 * `maxLines` on a rung, shrink STACK_REGION, or grow the descriptor row, and constraint 2
 * becomes live — silently, and in the right direction. tests/covers/determinism.test.mjs
 * asserts the 41% headroom explicitly, so the day someone changes the ladder the test tells
 * them this guard has woken up rather than leaving them to discover it in a cover.
 *
 * It is a guard that currently costs one comparison and decides nothing. That is a fine
 * thing for it to be, as long as nobody believes it is doing more than it is.
 */
function fitTitle(ctx, title, extraBelow = 0) {
  const text = caps(title);
  const region = STACK_REGION.bottom - STACK_REGION.top;
  let candidate = null;
  for (const rung of TITLE.ladder) {
    ctx.font = FONTS[TITLE.font](rung.size);
    const lines = wrapTracked(ctx, text, TITLE.tracking, TITLE.maxWidth);
    const stackHeight = lines.length * rung.size * TITLE.lineHeight + RULE.gapAboveFromTitle + extraBelow;
    candidate = { size: rung.size, lines, rung, stackHeight };
    if (lines.length <= rung.maxLines && stackHeight <= region) return candidate;
  }
  return candidate;   // ladder exhausted — planCover reports overflow and renderCover raises
}

/**
 * Lay the whole cover out without drawing any of it.
 *
 * Separated from painting so the geometry can be asserted directly by the test suite and
 * printed by the CLI — a layout bug should be catchable without diffing pixels.
 */
export function planCover(ctx, record) {
  const livery = record.liveryKey ? LIVERIES[record.liveryKey] : liveryFor(record.category);
  if (!livery) throw new Error(`unknown livery: ${record.liveryKey}`);

  // The descriptor is measured FIRST, because its height is an input to the size choice —
  // see fitTitle. Measuring it after would mean picking a rung blind to the row beneath it.
  const descriptorText = formatDescriptor(record.descriptor);
  let descAscent = 0;
  if (descriptorText) {
    ctx.font = FONTS[DESCRIPTOR.font](DESCRIPTOR.size);
    descAscent = capAscent(ctx);
  }
  const extraBelow = descriptorText ? DESCRIPTOR.gapBelowRule + descAscent : 0;

  const fitted = fitTitle(ctx, record.title, extraBelow);
  const lineHeight = fitted.size * TITLE.lineHeight;
  ctx.font = FONTS[TITLE.font](fitted.size);
  const titleBaselineOffset = (lineHeight + capAscent(ctx)) / 2;
  const titleBlockHeight = fitted.lines.length * lineHeight;

  // Heights are all relative offsets from the stack top, so the stack's HEIGHT can be known
  // before its POSITION — which is what lets the 20% placement be computed in one pass.
  const ruleOffset = titleBlockHeight + RULE.gapAboveFromTitle;
  const descOffset = descriptorText ? ruleOffset + DESCRIPTOR.gapBelowRule + descAscent : null;
  const stackHeight = descriptorText ? descOffset : ruleOffset;

  const slack = (STACK_REGION.bottom - STACK_REGION.top) - stackHeight;
  const stackTop = STACK_REGION.top + Math.max(0, slack) * STACK.placement;

  const titleBaselines = fitted.lines.map((_, i) => stackTop + i * lineHeight + titleBaselineOffset);
  const ruleY = stackTop + ruleOffset;
  const descriptorY = descriptorText ? stackTop + descOffset : null;
  const stackBottom = descriptorY ?? ruleY;

  ctx.font = FONTS[AUTHOR.font](AUTHOR.size);
  const authorTop = AUTHOR.y - capAscent(ctx);
  const fleuronY = stackBottom + (authorTop - stackBottom) * FLEURON.gapFraction;

  return {
    livery,
    // An EXPLICIT liveryKey names the eyebrow when the record has no category of its own.
    // Series instalments arrive that way — they live on series_instalments, not cms_stories,
    // and carry no cms category — and without this a series cover's eyebrow fell back to the
    // imprint and read CALVARY SCRIBBLINGS where it must read SERIES. Caught on the first
    // contact sheet. A record that HAS a category still wins: the category is the truth, and
    // liveryKey is only ever a stand-in for a record that cannot supply one.
    // THREE SOURCES, IN THIS ORDER, and the order is the whole content of the rule:
    //   1. the record's own category — always wins when it has one;
    //   2. an EXPLICIT liveryKey — for records that cannot have a cms category at all.
    //      Series instalments live on series_instalments and arrive this way; without this
    //      a series cover's eyebrow read CALVARY SCRIBBLINGS where it must read SERIES;
    //   3. the imprint — a record with neither. `liveryFor` also falls back to the Short
    //      Story livery, so `livery.name` CANNOT be used as the last resort here: it would
    //      print SHORT STORY over a story nobody has categorised, which is a confident lie
    //      where the imprint is an honest silence. (Caught by the suite, not by eye.)
    eyebrow: caps(
      record.category || record.categoryName
        ? eyebrowFor(record.category, record.categoryName)
        : record.liveryKey ? livery.name : IMPRINT_EYEBROW,
    ),
    title: { ...fitted, lineHeight, baselines: titleBaselines },
    ruleY,
    descriptor: descriptorText ? { text: descriptorText, y: descriptorY } : null,
    fleuronY,
    author: String(record.author ?? '').trim(),
    footer: footerFor(record),
    stack: { top: stackTop, bottom: stackBottom, height: stackHeight, slack },
    overflow: slack < 0,
  };
}

/**
 * "DUTY.  SACRIFICE.  RUIN." from ["duty","sacrifice","ruin"] or from a ready-made string.
 *
 * ABSENCE RETURNS null AND THAT IS A FINISHED DESIGN, not a failure to load. The renderer
 * drops the row entirely, the rule becomes the bottom of the stack, and the fleuron takes
 * the room. Nothing is substituted, and nothing must ever be: a placeholder here would put
 * the same three words on every descriptorless cover in the library.
 */
export function formatDescriptor(descriptor) {
  const words = Array.isArray(descriptor)
    ? descriptor
    : String(descriptor ?? '').split(/[.\s]+/);
  const clean = words.map((w) => caps(String(w ?? '').trim())).filter(Boolean);
  if (!clean.length) return null;
  return clean.map((w) => `${w}.`).join(DESCRIPTOR.separator);
}

/** Series covers carry an instalment ordinal where a story carries its subcategory. */
function footerFor(record) {
  if (record.instalmentOrdinal != null) return instalmentFooter(record.instalmentOrdinal);
  return caps(String(record.subcategory ?? '').trim());
}

/**
 * Render a cover. Returns the PNG and the layout that produced it.
 *
 * `record`: { slug, title, author, category?, categoryName?, subcategory?, descriptor?,
 *             liveryKey?, instalmentOrdinal? }
 */
export function renderCover(record) {
  registerFonts();
  if (!record?.slug) throw new Error('renderCover: slug is required — it seeds the grain');
  if (!String(record.title ?? '').trim()) throw new Error(`renderCover: ${record.slug} has no title`);

  const { canvas, ctx } = output();
  const plan = planCover(ctx, record);
  if (plan.overflow) {
    throw new Error(
      `cover would overflow its frame: ${record.slug} — title needs ${plan.stack.height.toFixed(0)}px ` +
      `in a ${STACK_REGION.bottom - STACK_REGION.top}px region at the ladder's last rung`,
    );
  }
  const { livery } = plan;
  const light = isLight(livery);
  const cx = CANVAS.w / 2;

  ctx.fillStyle = livery.ground;
  ctx.fillRect(0, 0, CANVAS.w, CANVAS.h);
  if (light) paintVignette(ctx, livery); else paintGlow(ctx, livery);
  paintGrain(ctx, record.slug, light);
  paintBorder(ctx, livery);

  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = livery.keyline;
  ctx.font = FONTS[EYEBROW.font](EYEBROW.size);
  drawTracked(ctx, plan.eyebrow, cx, EYEBROW.y, EYEBROW.tracking);

  ctx.fillStyle = livery.title;
  ctx.font = FONTS[TITLE.font](plan.title.size);
  plan.title.lines.forEach((line, i) => drawTracked(ctx, line, cx, plan.title.baselines[i], TITLE.tracking));

  ctx.strokeStyle = livery.keyline;
  ctx.lineWidth = RULE.width;
  ctx.beginPath();
  ctx.moveTo(CANVAS.w * RULE.x1, plan.ruleY);
  ctx.lineTo(CANVAS.w * RULE.x2, plan.ruleY);
  ctx.stroke();

  if (plan.descriptor) {
    ctx.fillStyle = livery.keyline;
    ctx.font = FONTS[DESCRIPTOR.font](DESCRIPTOR.size);
    drawTracked(ctx, plan.descriptor.text, cx, plan.descriptor.y, DESCRIPTOR.tracking);
  }

  paintFleuron(ctx, cx, plan.fleuronY, livery.keyline);

  if (plan.author) {
    ctx.fillStyle = livery.title;
    ctx.font = FONTS[AUTHOR.font](AUTHOR.size);
    drawTracked(ctx, plan.author, cx, AUTHOR.y, AUTHOR.tracking);
  }

  if (plan.footer) {
    ctx.fillStyle = livery.keyline;
    ctx.font = FONTS[FOOTER.font](FOOTER.size);
    drawTracked(ctx, plan.footer, cx, FOOTER.y, FOOTER.tracking);
  }

  return { png: canvas.toBuffer('image/png'), plan };
}

/**
 * The fleuron, centred on its INK rather than on its advance box.
 *
 * A glyph's advance carries sidebearings that are not symmetrical, so centring the box would
 * put the mark visibly off the cover's axis while every measurement said it was centred. The
 * bbox is baked into the asset for exactly this.
 */
function paintFleuron(ctx, cx, cy, colour) {
  const s = FLEURON.size / 1000;
  const inkCx = (FLEURON_BBOX.x1 + FLEURON_BBOX.x2) / 2;
  const inkCy = (FLEURON_BBOX.y1 + FLEURON_BBOX.y2) / 2;
  ctx.save();
  ctx.translate(cx - inkCx * s, cy - inkCy * s);
  ctx.scale(s, s);
  ctx.fillStyle = colour;
  ctx.fill(new Path2D(FLEURON_PATH));
  ctx.restore();
}
