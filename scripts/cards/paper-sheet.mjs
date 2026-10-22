// THE PAPER REVIEW SHEET — cards/review/PAPER-SHEET.png (CARDS-R3).
//
//   node scripts/cards/paper.mjs && node scripts/cards/paper-sheet.mjs
//
// Rasterises the PDFs themselves (pdfjs-dist), not a second drawing of them: every sheet, then
// details at 100% of a 600-dpi raster: a guess slip open and folded, a Ledger slip open and
// folded, and the Ledger slip with the longest line.
//
// FOLDED is shown as the paper does it: the hidden band is covered by the flap's back, which is
// blank (the sheet is printed on one side), and the visible strip is untouched.
//
// pdfjs needs DOMMatrix, Path2D and ImageData in Node. They come from the root's
// @napi-rs/canvas (pinned 1.0.6 for the covers), never from a copy of its own: scripts/cards/.npmrc
// omits optional dependencies so none is installed here.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Canvas from '@napi-rs/canvas';
import { registerFonts } from '../covers/render.mjs';
import { A4, FILES, OUT_DIR, guessSheet, ledgerCards, ledgerSheets, newDoc } from './paper.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'cards/review/PAPER-SHEET.png');
const { createCanvas } = Canvas;
Object.assign(globalThis, { DOMMatrix: Canvas.DOMMatrix, Path2D: Canvas.Path2D, ImageData: Canvas.ImageData });
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const THUMB_DPI = 100;                             // the sheets, whole
const DETAIL_DPI = 600;                            // "100%": one pixel of the 600-dpi raster
const pxPerMm = (dpi) => dpi / 25.4;

const docs = {};
async function page(file, n) {
  docs[file] ??= await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(OUT_DIR, file))), verbosity: 0 }).promise;
  return docs[file].getPage(n + 1);
}

/** Render a page, or the mm rectangle `crop` of it, at `dpi`. White paper underneath. */
async function render(file, n, dpi, crop = null) {
  const p = await page(file, n);
  const scale = dpi / 72;
  const k = pxPerMm(dpi);
  const r = crop || { x: 0, y: 0, w: A4.w, h: A4.h };
  const vp = p.getViewport({ scale, offsetX: -r.x * k, offsetY: -r.y * k });
  const c = createCanvas(Math.round(r.w * k), Math.round(r.h * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  return c;
}

/** The folded slip: from the fold down, with the flap's blank back over the hidden band. */
async function renderFolded(file, n, s) {
  const k = pxPerMm(DETAIL_DPI);
  const c = await render(file, n, DETAIL_DPI, { x: s.x, y: s.y + s.flap, w: s.w, h: s.h - s.flap });
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, s.hidden * k);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.5 / 72 * DETAIL_DPI;
  ctx.strokeRect(0, 0, c.width, s.hidden * k);
  return c;
}

const slipRect = (s) => ({ x: s.x, y: s.y, w: s.w, h: s.h });

async function main() {
  registerFonts();
  const cards = ledgerCards();
  const guess = guessSheet(newDoc('plan'));
  const ledger = ledgerSheets(newDoc('plan'), cards);

  // Every sheet.
  const sheets = [[FILES.guess, 0, 'The Turn: guess slips']];
  for (let i = 0; i < ledger.P.sheets; i++) sheets.push([FILES.ledger, i, `First Lines: Ledger ${i + 1} of ${ledger.P.sheets}`]);
  sheets.push([FILES.score, 0, 'Scorepad']);
  const thumbs = [];
  for (const [f, n, label] of sheets) thumbs.push({ c: await render(f, n, THUMB_DPI), label });

  // The details.
  const g = guess.slips[0];
  const sample = ledger.placed.find((s) => s.slug === 'the-number-thirteen');
  const longest = ledger.placed.find((s) => s.slug === ledger.P.longest.slug);
  const details = [
    { c: await render(FILES.guess, 0, DETAIL_DPI, slipRect(g)), label: 'Guess slip, open' },
    { c: await renderFolded(FILES.guess, 0, g), label: 'Guess slip, folded' },
    { c: await render(FILES.ledger, sample.sheet, DETAIL_DPI, slipRect(sample)), label: 'Ledger slip, open' },
    { c: await renderFolded(FILES.ledger, sample.sheet, sample), label: 'Ledger slip, folded' },
    { c: await render(FILES.ledger, longest.sheet, DETAIL_DPI, slipRect(longest)), label: `The longest line (${ledger.P.longest.title}, ${longest.size} pt)` },
  ];

  const GUT = 60;
  const HEAD = 150;
  const LABEL = 70;
  const thumbsW = thumbs.reduce((a, t) => a + t.c.width + GUT, GUT);
  const detW = details.reduce((a, t) => a + t.c.width + GUT, GUT);
  const W = Math.max(thumbsW, detW);
  const thumbsH = Math.max(...thumbs.map((t) => t.c.height));
  const detH = Math.max(...details.map((t) => t.c.height));
  const H = HEAD + LABEL + thumbsH + GUT + 110 + LABEL + detH + GUT;
  const out = createCanvas(W, H);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#E9E6E0';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1C1418';
  ctx.font = '56px "Cormorant Garamond SemiBold"';
  ctx.fillText('Shorelines: the playtest paper (CARDS-R3)', GUT, 80);
  ctx.font = '28px "EB Garamond"';
  ctx.fillText(`1 · Every sheet, at ${THUMB_DPI} dpi. Printed single-sided A4, black ink; cut on solid lines, fold on dashed lines; the 50 mm check line bottom left.`, GUT, 128);

  let x = GUT;
  let y = HEAD + LABEL;
  for (const t of thumbs) {
    ctx.fillStyle = '#1C1418';
    ctx.font = '30px "EB Garamond"';
    ctx.fillText(t.label, x, y - 20);
    ctx.drawImage(t.c, x, y);
    ctx.strokeStyle = '#9A948A';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, t.c.width, t.c.height);
    x += t.c.width + GUT;
  }
  y += thumbsH + GUT + 60;
  ctx.font = '28px "EB Garamond"';
  ctx.fillStyle = '#1C1418';
  ctx.fillText(`2 · Details at 100% of a ${DETAIL_DPI}-dpi raster. Folded = the flap's blank back over the hidden band; what shows is what the table sees.`, GUT, y);
  y += 50 + LABEL;
  x = GUT;
  for (const t of details) {
    ctx.fillStyle = '#1C1418';
    ctx.font = '30px "EB Garamond"';
    ctx.fillText(t.label, x, y - 20);
    ctx.drawImage(t.c, x, y);
    x += t.c.width + GUT;
  }
  const png = await out.encode('png');
  writeFileSync(OUT, png);
  console.log(`PAPER-SHEET.png ${W}×${H} sha256 ${createHash('sha256').update(png).digest('hex')}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
