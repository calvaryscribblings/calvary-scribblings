// THE PLAYTEST PAPER — The Turn's guess slips, the First Lines Ledger, a scorepad (CARDS-R3).
//
//   node scripts/cards/paper.mjs        # → cards/print/paper/*.pdf + cards/review/PAPER.md
//
// Three vector PDFs, printed at home: single-sided A4, black ink only, EB Garamond (the cards'
// own file, assets/covers/fonts/EBGaramond-Regular.ttf), nothing under 8 pt. Every sheet carries
// its cut lines (solid), its fold lines (dashed), and a labelled 50 mm check line, so a printer
// that scaled the page is caught with a ruler.
//
// THE FOLD DOES THE HIDING. Printed on one side, a slip folded in half shows either both printed
// faces or neither. So each slip is three bands, top to bottom: a FLAP, a HIDDEN band of the same
// height, and a VISIBLE strip. The flap folds down over the hidden band, printed face to printed
// face; what shows is the flap's blank back and, below it, the visible strip. The flap's printed
// face is a hatch, so a pencil mark or a printed line under it cannot be read through the paper.
//
//   The Turn       hidden: the eight Endings, each with its two glyphs and a circle to mark.
//                  visible: the Reader's name. Folded, no wider than a card.
//   First Lines    hidden: the story's first sentence. visible: the title and the author.
//
// READS: cards/data/first-lines.json (scripts/cards/first-lines.mjs) and geometry.mjs's ENDINGS,
// the data the Ending cards are drawn from. WRITES: cards/print/paper/ (git-ignored; the PDFs
// are delivered with the draft release, never committed) and cards/review/PAPER.md.
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { ENDINGS, GLYPH_MM, TRIM } from './geometry.mjs';
import { GLYPHS, BOX, STROKE_UNITS } from './glyphs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_DIR = join(ROOT, 'cards/print/paper');
const FONT = join(ROOT, 'assets/covers/fonts/EBGaramond-Regular.ttf');
const LINES = join(ROOT, 'cards/data/first-lines.json');
const MD = join(ROOT, 'cards/review/PAPER.md');

export const PT = 72 / 25.4;                       // points per mm
const pt = (mm) => mm * PT;

// ── THE PAGE — every number marked D (derived) or C (chosen) in PAPER.md ─────────────────────
export const A4 = Object.freeze({ w: 210, h: 297 });
export const MARGIN = 10;                          // C: clear of a home printer's 3–6.35 mm dead zone
export const TYPE_MIN = 8;                         // ruled: nothing under 8 pt
export const CHECK_MM = 50;                        // ruled
const HEAD = Object.freeze({ titleBase: MARGIN + 5.5, noteBase: MARGIN + 10.5, foot: MARGIN + 13 }); // C
const FOOT = Object.freeze({ lineY: A4.h - MARGIN - 1, labelBase: A4.h - MARGIN - 3.2, top: A4.h - MARGIN - 7 }); // C
export const AREA = Object.freeze({ top: HEAD.foot + 2, bottom: FOOT.top - 2 });                       // D
export const CUT = Object.freeze({ widthPt: 0.5 });                        // C
export const FOLD = Object.freeze({ widthPt: 0.5, dashMm: 2, gapMm: 1.5 }); // C
export const HATCH = Object.freeze({ pitchMm: 0.7, widthPt: 0.35, insetMm: 0.6 }); // C: ~13% ink each way, crossed

// ── THE TURN: GUESS SLIPS ────────────────────────────────────────────────────────────────────
export const GUESS = Object.freeze({
  w: TRIM.w,                       // D: the card's width, the most the brief allows
  inset: 3,                        // C: the cards' safe line
  circleMm: 4.5,                   // C: a pencil ring fits inside
  glyphMm: GLYPH_MM,               // D: the one glyph size (glyphs.mjs)
  glyphGapMm: 0.8,                 // C
  rowPitch: GLYPH_MM + 0.6,        // C: 0.6 mm between glyph boxes
  hiddenTopPad: 1.5,               // C
  hiddenFootPad: 3,                // C: a fold up to 3 mm low still covers the last row
  visible: 11,                     // C: room to write a name
  namePtMax: 10,                   // C: the Ending names, as large as fit, never under TYPE_MIN
});

// ── FIRST LINES: THE LEDGER ──────────────────────────────────────────────────────────────────
export const LEDGER = Object.freeze({
  inset: 4,                        // C
  linePtMax: 11,                   // C: a short line is set larger, up to this
  leading: 1.3,                    // C: line height ÷ size
  hiddenTopPad: 2.5,               // C
  hiddenFootPad: 3,                // C: as the guess slip
  titlePt: 10.5,                   // C (wraps to two lines at most)
  authorPt: TYPE_MIN,              // C
  columns: [2, 3, 4],              // the candidates the size is derived over
  unreasonable: 1.5,               // C: flag if the longest line makes the hidden band 1.5× the next-longest's
});

// ── THE SCOREPAD ─────────────────────────────────────────────────────────────────────────────
export const SCORE = Object.freeze({
  players: 8,                      // ruled
  rows: 13,                        // ruled: Last Page with six players runs to 13 hands
  games: ['The Turn', 'First Lines', 'Last Page'],
  handCol: 14,                     // C
  nameRow: 13,                     // C
});

// ── drawing ──────────────────────────────────────────────────────────────────────────────────

export function newDoc(title) {
  const doc = new PDFDocument({
    size: 'A4', margin: 0, autoFirstPage: false,
    info: { Title: title, Author: 'Calvary Scribblings', Creator: 'scripts/cards/paper.mjs', CreationDate: new Date(Date.UTC(2026, 9, 22)) },
  });
  doc.registerFont('EB', FONT);
  doc.font('EB');
  return doc;
}

/** Text with its BASELINE at (x, y) mm. Refuses anything under the floor. */
export function text(doc, s, x, y, { size, track = 0, align = 'left', fill = '#000' } = {}) {
  if (!(size >= TYPE_MIN)) throw new Error(`type under ${TYPE_MIN} pt: ${size} for "${s}"`);
  doc.fontSize(size);
  const w = width(doc, s, size, track);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  doc.fillColor(fill).text(s, pt(x0), pt(y), { lineBreak: false, baseline: 'alphabetic', characterSpacing: track * size, width: 10000 });
  return w;
}

/** Width in mm, tracking in em. The trailing letter's tracking is not counted. */
export function width(doc, s, size, track = 0) {
  doc.fontSize(size);
  const w = doc.widthOfString(s, { characterSpacing: track * size }) - (s.length ? track * size : 0);
  return w / PT;
}

/** Greedy wrap into lines no wider than `measure` mm. */
export function wrap(doc, s, size, measure) {
  const out = [];
  let line = '';
  for (const word of s.split(/ +/)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (!line || width(doc, tryLine, size) <= measure) line = tryLine;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

const line = (doc, x1, y1, x2, y2, wPt) => doc.moveTo(pt(x1), pt(y1)).lineTo(pt(x2), pt(y2)).lineWidth(wPt).strokeColor('#000').stroke();

export function cutRect(doc, x, y, w, h) {
  doc.undash().rect(pt(x), pt(y), pt(w), pt(h)).lineWidth(CUT.widthPt).strokeColor('#000').stroke();
}
export function foldLine(doc, x1, y, x2) {
  doc.dash(pt(FOLD.dashMm), { space: pt(FOLD.gapMm) });
  line(doc, x1, y, x2, y, FOLD.widthPt);
  doc.undash();
}

function hatch(doc, x, y, w, h) {
  const i = HATCH.insetMm;
  doc.save();
  doc.rect(pt(x + i), pt(y + i), pt(w - 2 * i), pt(h - 2 * i)).clip();
  doc.lineWidth(HATCH.widthPt).strokeColor('#000');
  for (let d = -h; d < w + h; d += HATCH.pitchMm) {
    doc.moveTo(pt(x + d), pt(y)).lineTo(pt(x + d + h), pt(y + h)).stroke();
    doc.moveTo(pt(x + d), pt(y + h)).lineTo(pt(x + d + h), pt(y)).stroke();
  }
  doc.restore();
}

/** A white label on the hatch, so the flap says what it is for when open. */
function flapLabel(doc, s, cx, cy) {
  const size = TYPE_MIN;
  const w = width(doc, s, size, 0.04) + 4;
  doc.rect(pt(cx - w / 2), pt(cy - 3), pt(w), pt(5)).fillColor('#fff').fill();
  text(doc, s, cx, cy + 0.9, { size, track: 0.04, align: 'center' });
}

export function glyph(doc, motif, x, y, size) {
  const s = (size / BOX) * PT;
  doc.save();
  doc.translate(pt(x), pt(y)).scale(s);
  doc.lineWidth(STROKE_UNITS).lineCap('round').lineJoin('round').strokeColor('#000');
  for (const d of GLYPHS[motif]) doc.path(d).stroke();
  doc.restore();
}

function circle(doc, cx, cy, d) {
  doc.circle(pt(cx), pt(cy), pt(d / 2)).lineWidth(0.6).strokeColor('#000').stroke();
}

/** The furniture every sheet carries: what it is, how to print it, the check line, the legend. */
export function furniture(doc, title, note) {
  text(doc, title, MARGIN, HEAD.titleBase, { size: 12, track: 0.06 });
  text(doc, note, MARGIN, HEAD.noteBase, { size: TYPE_MIN });
  // The check line, with end ticks.
  const x0 = MARGIN;
  line(doc, x0, FOOT.lineY, x0 + CHECK_MM, FOOT.lineY, 0.6);
  line(doc, x0, FOOT.lineY - 1.6, x0, FOOT.lineY + 1, 0.6);
  line(doc, x0 + CHECK_MM, FOOT.lineY - 1.6, x0 + CHECK_MM, FOOT.lineY + 1, 0.6);
  text(doc, `Check: this line is ${CHECK_MM} mm. If it is not, the page was scaled. Print at Actual size, 100%.`, x0 + CHECK_MM + 3, FOOT.lineY + 0.9, { size: TYPE_MIN });
  // The legend, right-aligned on the check line's row: cut, then fold.
  const right = A4.w - MARGIN;
  const base = FOOT.lineY + 0.9;
  const fw = text(doc, 'fold', right, base, { size: TYPE_MIN, align: 'right' });
  foldLine(doc, right - fw - 11, FOOT.lineY, right - fw - 2);
  const cx = right - fw - 16;
  const cw = text(doc, 'cut', cx, base, { size: TYPE_MIN, align: 'right' });
  line(doc, cx - cw - 11, FOOT.lineY, cx - cw - 2, FOOT.lineY, CUT.widthPt);
}

// ── THE TURN ─────────────────────────────────────────────────────────────────────────────────

export function planGuess(doc) {
  const g = GUESS;
  const rowsH = ENDINGS.length * g.rowPitch;
  const hidden = g.hiddenTopPad + rowsH + g.hiddenFootPad;
  const h = 2 * hidden + g.visible;
  // The name size: as large as fits between the circle and the glyph pair, up to namePtMax.
  const nameX = g.inset + g.circleMm + 1.8;
  const glyphsX = g.w - g.inset - 2 * g.glyphMm - g.glyphGapMm;
  const measure = glyphsX - 1.8 - nameX;
  const longest = ENDINGS.reduce((a, e) => (width(doc, e.name, 1, 0.04) > width(doc, a, 1, 0.04) ? e.name : a), ENDINGS[0].name);
  let namePt = g.namePtMax;
  while (namePt > TYPE_MIN && width(doc, longest, namePt, 0.04) > measure) namePt = Math.round((namePt - 0.25) * 100) / 100;
  if (width(doc, longest, namePt, 0.04) > measure) throw new Error(`${longest} does not fit at ${TYPE_MIN} pt`);
  const cols = Math.floor((A4.w - 2 * MARGIN) / g.w);
  const rows = Math.floor((AREA.bottom - AREA.top) / h);
  return { w: g.w, h, flap: hidden, hidden, visible: g.visible, rowsH, nameX, glyphsX, measure, longest, namePt, cols, rows, perSheet: cols * rows };
}

export function drawGuessSlip(doc, P, x, y) {
  const g = GUESS;
  cutRect(doc, x, y, P.w, P.h);
  hatch(doc, x, y, P.w, P.flap);
  flapLabel(doc, 'THE TURN · fold down over your choice', x + P.w / 2, y + P.flap / 2);
  foldLine(doc, x, y + P.flap, x + P.w);
  const top = y + P.flap + g.hiddenTopPad;
  ENDINGS.forEach((e, i) => {
    const rowTop = top + i * g.rowPitch;
    const cy = rowTop + g.glyphMm / 2;
    circle(doc, x + g.inset + g.circleMm / 2, cy, g.circleMm);
    text(doc, e.name, x + P.nameX, cy + P.namePt / PT * 0.33, { size: P.namePt, track: 0.04 });
    glyph(doc, e.pair[0], x + P.glyphsX, rowTop, g.glyphMm);
    glyph(doc, e.pair[1], x + P.glyphsX + g.glyphMm + g.glyphGapMm, rowTop, g.glyphMm);
  });
  // The visible strip: the Reader's name.
  const vTop = y + P.flap + P.hidden;
  text(doc, 'READER', x + g.inset, vTop + 3.9, { size: TYPE_MIN, track: 0.12 });
  line(doc, x + g.inset, vTop + P.visible - 2.2, x + P.w - g.inset, vTop + P.visible - 2.2, 0.4);
}

export function guessSheet(doc) {
  const P = planGuess(doc);
  doc.addPage();
  furniture(doc, 'SHORELINES · THE TURN · GUESS SLIPS', `${P.perSheet} slips. Cut out on the solid lines. Fold the hatched flap down on the dashed line: your name shows, your choice does not.`);
  const x0 = (A4.w - P.cols * P.w) / 2;
  const slips = [];
  for (let r = 0; r < P.rows; r++) for (let c = 0; c < P.cols; c++) {
    const x = x0 + c * P.w;
    const y = AREA.top + r * P.h;
    drawGuessSlip(doc, P, x, y);
    slips.push({ x, y, w: P.w, h: P.h, flap: P.flap, hidden: P.hidden });
  }
  return { P, slips };
}

// ── FIRST LINES ──────────────────────────────────────────────────────────────────────────────

/** Sorted by title, a leading The, A or An ignored. */
export function ledgerOrder(cards) {
  const key = (t) => t.replace(/^(the|a|an)\s+/i, '');
  return [...cards].sort((a, b) => key(a.title).localeCompare(key(b.title), 'en', { numeric: true, sensitivity: 'base' }));
}

function ledgerSizeFor(doc, cards, w) {
  const L = LEDGER;
  const measure = w - 2 * L.inset;
  const linesAt = (s, size) => wrap(doc, s, size, measure).length;
  // The hidden band: the longest line, at the floor.
  const byLines = cards.map((c) => ({ c, n: linesAt(c.line, TYPE_MIN) })).sort((a, b) => b.n - a.n);
  const box = (n) => n * TYPE_MIN * L.leading / PT;
  const lineBox = box(byLines[0].n);
  const hidden = L.hiddenTopPad + lineBox + L.hiddenFootPad;
  const nextHidden = L.hiddenTopPad + box(byLines.find((x) => x.n < byLines[0].n)?.n ?? byLines[0].n) + L.hiddenFootPad;
  // The visible strip: the longest title (two lines at most) and the author.
  let titleLines = 1;
  for (const c of cards) titleLines = Math.max(titleLines, wrap(doc, c.title, L.titlePt, measure).length);
  if (titleLines > 2) throw new Error('a title needs three lines');
  const titleLead = L.titlePt * 1.15 / PT;
  const visible = 3.2 + titleLines * titleLead + L.authorPt * 1.25 / PT + 2.2;
  const h = 2 * hidden + visible;
  const cols = Math.round((A4.w - 2 * MARGIN) / w);
  const rows = Math.floor((AREA.bottom - AREA.top) / h);
  return { w, measure, lineBox, hidden, nextHidden, visible, titleLines, titleLead, h, cols, rows, perSheet: cols * rows, longest: byLines[0].c, longestLines: byLines[0].n };
}

export function planLedger(doc, cards) {
  // THE SIZE IS DERIVED: for each column count, the width fills the page; the height follows from
  // the longest line at the floor. The plan that fits the most slips on a sheet wins; on a tie,
  // the wider slip (fewer, larger lines).
  const candidates = LEDGER.columns.map((c) => ledgerSizeFor(doc, cards, (A4.w - 2 * MARGIN) / c));
  const best = candidates.reduce((a, b) => (b.perSheet > a.perSheet ? b : a));
  const unreasonable = best.hidden / best.nextHidden >= LEDGER.unreasonable;
  return { ...best, candidates, unreasonable, sheets: Math.ceil(cards.length / best.perSheet) };
}

/** The size a line is set at: the largest, up to linePtMax, that still fits the box. */
export function linePt(doc, P, s) {
  for (let size = LEDGER.linePtMax; size >= TYPE_MIN; size -= 0.5) {
    const n = wrap(doc, s, size, P.measure).length;
    if (n * size * LEDGER.leading / PT <= P.lineBox + 1e-6) return size;
  }
  return TYPE_MIN;
}

export function drawLedgerSlip(doc, P, c, x, y) {
  const L = LEDGER;
  cutRect(doc, x, y, P.w, P.h);
  hatch(doc, x, y, P.w, P.hidden);
  flapLabel(doc, 'FIRST LINES · fold down', x + P.w / 2, y + P.hidden / 2);
  foldLine(doc, x, y + P.hidden, x + P.w);
  const size = linePt(doc, P, c.line);
  const lines = wrap(doc, c.line, size, P.measure);
  const lead = size * L.leading / PT;
  // Centred in the box, first baseline one cap-ish below the box top.
  const boxTop = y + P.hidden + L.hiddenTopPad + (P.lineBox - lines.length * lead) / 2;
  lines.forEach((ln, i) => text(doc, ln, x + L.inset, boxTop + (i + 0.78) * lead, { size }));
  const vTop = y + 2 * P.hidden;
  const tl = wrap(doc, c.title, L.titlePt, P.measure);
  tl.forEach((t, i) => text(doc, t, x + L.inset, vTop + 3.2 + (i + 0.78) * P.titleLead, { size: L.titlePt }));
  text(doc, c.author, x + L.inset, vTop + 3.2 + tl.length * P.titleLead + L.authorPt * 1.0 / PT, { size: L.authorPt, track: 0.02 });
  return { size, lines: lines.length };
}

export function ledgerSheets(doc, cards) {
  const P = planLedger(doc, cards);
  const order = ledgerOrder(cards);
  const placed = [];
  const x0 = (A4.w - P.cols * P.w) / 2;
  for (let s = 0; s < P.sheets; s++) {
    doc.addPage();
    const from = s * P.perSheet;
    const to = Math.min(order.length, from + P.perSheet);
    furniture(doc, `SHORELINES · FIRST LINES · THE LEDGER · ${s + 1} OF ${P.sheets}`,
      `Slips ${from + 1}–${to} of ${order.length}, by title. Cut out on the solid lines. Fold the hatched flap down on the dashed line: the title shows, the line does not.`);
    for (let i = from; i < to; i++) {
      const k = i - from;
      const x = x0 + (k % P.cols) * P.w;
      const y = AREA.top + Math.floor(k / P.cols) * P.h;
      const r = drawLedgerSlip(doc, P, order[i], x, y);
      placed.push({ slug: order[i].slug, sheet: s, x, y, w: P.w, h: P.h, flap: P.hidden, hidden: P.hidden, ...r });
    }
  }
  return { P, order, placed };
}

// ── THE SCOREPAD ─────────────────────────────────────────────────────────────────────────────

export function scorepad(doc) {
  doc.addPage();
  furniture(doc, 'SHORELINES · SCORE', 'One sheet a game: tick the game, write the players across the top, a hand to a row. Nothing to cut or fold.');
  const S = SCORE;
  const top = AREA.top;
  // The games, each with a tick box.
  let x = MARGIN;
  const boxMm = 4.5;
  const gy = top + 2;
  for (const g of S.games) {
    doc.rect(pt(x), pt(gy), pt(boxMm), pt(boxMm)).lineWidth(0.6).strokeColor('#000').stroke();
    x += boxMm + 2.2;
    x += text(doc, g, x, gy + boxMm - 0.7, { size: 11 }) + 9;
  }
  text(doc, 'Date', A4.w - MARGIN - 52, gy + boxMm - 0.7, { size: TYPE_MIN, track: 0.08 });
  line(doc, A4.w - MARGIN - 44, gy + boxMm, A4.w - MARGIN, gy + boxMm, 0.4);
  const tTop = gy + boxMm + 5;
  const tBottom = AREA.bottom;
  const left = MARGIN;
  const right = A4.w - MARGIN;
  const colW = (right - left - S.handCol) / S.players;
  const rowH = (tBottom - tTop - S.nameRow) / (S.rows + 1);
  // Grid.
  const ys = [tTop, tTop + S.nameRow];
  for (let r = 1; r <= S.rows + 1; r++) ys.push(tTop + S.nameRow + r * rowH);
  for (const [i, yy] of ys.entries()) line(doc, left, yy, right, yy, i === 0 || i === 1 || i === ys.length - 1 ? 0.8 : 0.4);
  line(doc, left, ys[ys.length - 2] - 0.6, right, ys[ys.length - 2] - 0.6, 0.4); // the total's double rule
  line(doc, left, tTop, left, tBottom, 0.8);
  line(doc, right, tTop, right, tBottom, 0.8);
  for (let c = 0; c <= S.players; c++) line(doc, left + S.handCol + c * colW, tTop, left + S.handCol + c * colW, tBottom, c === 0 ? 0.8 : 0.4);
  text(doc, 'Player', left + S.handCol / 2, tTop + S.nameRow / 2 + 1.2, { size: TYPE_MIN, align: 'center', track: 0.06 });
  for (let c = 0; c < S.players; c++) text(doc, String(c + 1), left + S.handCol + c * colW + 1.6, tTop + 3.6, { size: TYPE_MIN });
  for (let r = 0; r < S.rows; r++) text(doc, String(r + 1), left + S.handCol / 2, tTop + S.nameRow + r * rowH + rowH / 2 + 1.4, { size: 10, align: 'center' });
  text(doc, 'Total', left + S.handCol / 2, tTop + S.nameRow + S.rows * rowH + rowH / 2 + 1.4, { size: 10, align: 'center', track: 0.04 });
  return { colW, rowH, tTop, tBottom };
}

// ── THE NIGHT ────────────────────────────────────────────────────────────────────────────────
// What a six-player night prints. The Turn's count rests on two readings of the rules, stated in
// PAPER.md: every player fills one slip each round, and the night plays one round per player.
export const NIGHT = Object.freeze({ players: 6, turnRounds: 6, scoreGames: 3 });

// ── run ──────────────────────────────────────────────────────────────────────────────────────

async function save(doc, file) {
  const out = createWriteStream(file);
  doc.pipe(out);
  doc.end();
  await new Promise((r) => out.on('finish', r));
}

export function ledgerCards() {
  return JSON.parse(readFileSync(LINES, 'utf8')).cards.filter((c) => c.line);
}

export const FILES = Object.freeze({
  guess: 'shorelines-the-turn-guess-slips.pdf',
  ledger: 'shorelines-first-lines-ledger.pdf',
  score: 'shorelines-scorepad.pdf',
});

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const cards = ledgerCards();

  const gd = newDoc('Shorelines — The Turn — guess slips');
  const guess = guessSheet(gd);
  await save(gd, join(OUT_DIR, FILES.guess));

  const ld = newDoc('Shorelines — First Lines — the Ledger');
  const ledger = ledgerSheets(ld, cards);
  await save(ld, join(OUT_DIR, FILES.ledger));

  const sd = newDoc('Shorelines — scorepad');
  const score = scorepad(sd);
  await save(sd, join(OUT_DIR, FILES.score));

  writeFileSync(MD, measurements({ guess, ledger, score, cards, doc: ld }));
  const n = NIGHT;
  console.log(`guess: ${guess.P.perSheet}/sheet (${guess.P.w} × ${guess.P.h.toFixed(1)} mm); ledger: ${ledger.P.perSheet}/sheet × ${ledger.P.sheets} sheets (${ledger.P.w.toFixed(2)} × ${ledger.P.h.toFixed(2)} mm)${ledger.P.unreasonable ? ' FLAG: longest line' : ''}; scorepad: 1`);
  console.log(`six-player night: turn ${Math.ceil(n.players * n.turnRounds / guess.P.perSheet)}, ledger ${ledger.P.sheets}, scorepad ${n.scoreGames}`);
}

function measurements({ guess, ledger, score, cards }) {
  const G = guess.P;
  const L = ledger.P;
  const f = (x, d = 2) => x.toFixed(d);
  const sizes = {};
  for (const s of ledger.placed) sizes[s.size] = (sizes[s.size] || 0) + 1;
  const n = NIGHT;
  const turnSlips = n.players * n.turnRounds;
  const out = [];
  out.push('# Shorelines: the playtest paper (CARDS-R3)', '');
  out.push('Generated by `scripts/cards/paper.mjs`. **D** marks a number derived; **C** a number chosen here. All sizes in mm unless marked; positions from each slip\'s top-left corner.', '');
  out.push('Three PDFs, vector, single-sided A4, black ink only, EB Garamond Regular (the cards\' own file). Nothing is set under 8 pt: `text()` refuses it. They are delivered with the draft release `shorelines-playtest-1`, never committed.', '');
  out.push('## Every sheet', '', '| | | |', '|---|---|---|');
  out.push(`| Page | A4, ${A4.w} × ${A4.h}, portrait | ruled |`);
  out.push(`| Margin | ${MARGIN} | C: clear of a home printer's unprintable edge (3–6.35 mm) |`);
  out.push(`| Slip area | ${f(AREA.top, 1)}–${f(AREA.bottom, 1)} from the top (${f(AREA.bottom - AREA.top, 1)} tall) | D: between the heading and the check line |`);
  out.push(`| Check line | ${CHECK_MM} mm, with end ticks, bottom left, labelled | ruled |`);
  out.push(`| Cut line | solid, ${CUT.widthPt} pt; slips share their cut lines (no gutters) | C |`);
  out.push(`| Fold line | dashed ${FOLD.dashMm} on, ${FOLD.gapMm} off, ${FOLD.widthPt} pt | C |`);
  out.push(`| Type floor | ${TYPE_MIN} pt | ruled |`);
  out.push(`| Flap hatch | crossed diagonals, ${HATCH.pitchMm} pitch, ${HATCH.widthPt} pt, ${HATCH.insetMm} inside the cut | C: so a pencil ring or a printed line can't be read through the folded flap |`);
  out.push('', '**How a single-sided slip hides by folding.** One fold of a sheet printed on one side shows both printed faces or neither. So a slip is three bands: a flap, a hidden band of the same height, and a visible strip. The flap folds down over the hidden band, printed face to printed face. What shows is the flap\'s blank back, and below it the visible strip.', '');
  out.push('## The Turn: guess slips', '', '| | | |', '|---|---|---|');
  out.push(`| Slip width | ${G.w} | D: the card's width, the most the brief allows; folded, it is the same |`);
  out.push(`| Inset | ${GUESS.inset} | C: the cards' safe line |`);
  out.push(`| Glyphs | ${GUESS.glyphMm} square, ${GUESS.glyphGapMm} apart, right-aligned to the inset | D: the one glyph size (glyphs.mjs), the Ending cards' pairs (geometry.mjs ENDINGS) |`);
  out.push(`| Row pitch | ${f(GUESS.rowPitch, 1)} (8 rows: ${f(G.rowsH, 1)}) | C: glyph + 0.6 |`);
  out.push(`| Circle | ${GUESS.circleMm} across, 0.6 pt | C |`);
  out.push(`| Ending names | ${G.namePt} pt, tracked 0.04 em; measure ${f(G.measure)} | D: the largest up to ${GUESS.namePtMax} pt at which ${G.longest} fits between circle and glyphs |`);
  out.push(`| Hidden band | ${GUESS.hiddenTopPad} + ${f(G.rowsH, 1)} + ${GUESS.hiddenFootPad} = ${f(G.hidden, 1)} | D (pads C: the foot pad lets a fold sit 3 mm low and still cover the last row) |`);
  out.push(`| Flap | ${f(G.flap, 1)} | D: equal to the hidden band |`);
  out.push(`| Visible strip | ${GUESS.visible}: READER and a line to write on | C |`);
  out.push(`| Slip | ${G.w} × ${f(G.h, 1)} open; ${G.w} × ${f(G.hidden + G.visible, 1)} folded | D |`);
  out.push(`| Per sheet | ${G.cols} × ${G.rows} = ${G.perSheet} | D |`);
  out.push('', '## First Lines: the Ledger', '', '| | | |', '|---|---|---|');
  out.push(`| Slips | ${cards.length}: every card with a line (FIRST-LINES.md), sorted by title ignoring a leading The, A or An | D |`);
  out.push(`| The size, derived | ${L.candidates.map((c) => `${c.cols} across: ${f(c.w)} × ${f(c.h)}, ${c.perSheet}/sheet`).join('; ')} → **${L.cols} across** | D: for each width the height follows from the longest line at ${TYPE_MIN} pt; the most slips a sheet wins |`);
  out.push(`| Slip | ${f(L.w)} × ${f(L.h)} open; ${f(L.w)} × ${f(L.hidden + L.visible)} folded | D |`);
  out.push(`| Inset, measure | ${LEDGER.inset}, ${f(L.measure)} | C, D |`);
  out.push(`| Longest line | ${L.longest.title} (${L.longest.words} words): ${L.longestLines} lines at ${TYPE_MIN} pt | D |`);
  out.push(`| Line box | ${L.longestLines} × ${TYPE_MIN} pt × ${LEDGER.leading} = ${f(L.lineBox)} | D (leading C) |`);
  out.push(`| Hidden band | ${LEDGER.hiddenTopPad} + ${f(L.lineBox)} + ${LEDGER.hiddenFootPad} = ${f(L.hidden)} | D |`);
  out.push(`| The longest line's cost | the hidden band is ${f(L.hidden / L.nextHidden)}× what the next-longest needs (${f(L.nextHidden)}) | ${L.unreasonable ? '**FLAG**' : 'not flagged'}: C threshold ${LEDGER.unreasonable}× |`);
  out.push(`| Line size | each line at the largest size up to ${LEDGER.linePtMax} pt that fits the box, never under ${TYPE_MIN}: ${Object.entries(sizes).sort((a, b) => b[0] - a[0]).map(([s, k]) => `${s} pt × ${k}`).join(', ')} | D (cap C) |`);
  out.push(`| Visible strip | ${f(L.visible)}: title ${LEDGER.titlePt} pt (${L.titleLines === 1 ? 'every title on one line' : `up to ${L.titleLines} lines`}), author ${LEDGER.authorPt} pt | D (sizes C) |`);
  out.push(`| Per sheet, sheets | ${L.cols} × ${L.rows} = ${L.perSheet}; ${L.sheets} sheets | D |`);
  out.push('', '## The scorepad', '', '| | | |', '|---|---|---|');
  out.push(`| Games | ${SCORE.games.join(', ')}, each with a 4.5 tick box | ruled (box C) |`);
  out.push(`| Players | ${SCORE.players} columns, ${f(score.colW)} wide | ruled; width D |`);
  out.push(`| Rows | ${SCORE.rows} numbered hands and a total, ${f(score.rowH)} each; the name row ${SCORE.nameRow} | ruled (Last Page, six players, 13 hands); heights D (name row C) |`);
  out.push('| Cut, fold | none: one pad is the whole sheet, and it hides nothing | — |');
  out.push('', '## A six-player night', '', '| Part | Sheets | Why |', '|---|---|---|');
  out.push(`| The Turn | ${Math.ceil(turnSlips / G.perSheet)} | ${turnSlips} slips at ${G.perSheet} a sheet. **Assumed** (no rulebook in this repo): every player fills one slip each round, and the night plays one round per player. Sheets = players × rounds ÷ ${G.perSheet} |`);
  out.push(`| First Lines | ${L.sheets} | one Ledger of ${cards.length} slips, kept and reused |`);
  out.push(`| Scorepad | ${n.scoreGames} | one per game, each game played once |`);
  out.push(`| **Total** | **${Math.ceil(turnSlips / G.perSheet) + L.sheets + n.scoreGames}** | |`);
  out.push('');
  return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
