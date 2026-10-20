// THE CARD CONTACT SHEET — gate 2 of Shorelines (CARDS-R1.2).
//
//   node --expose-gc scripts/cards/contact-sheet.mjs   # → cards/review/CONTACT-SHEET.png + MEASUREMENTS.md
//
// Renders EVERY card in cards/data/deck.json at 600 dpi with its code, decodes each code from
// that raster without trying the inverted image, and runs the collision assertion on each.
// That is the proof. The sheet itself shows a chosen selection, each face with and without its
// code, then the same faces again with the trim, bleed and safe lines drawn.
//
// READS: deck.json, Ikenna's poster files in cards/posters/ (named in poster-type.json), and
// cards/Story-Island-icon.png.
// WRITES: cards/review/ and cards/data/qr-results.json only. Nothing is uploaded, and nothing
// is written to any database.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { trackedWidth } from '../covers/text.mjs';
const c0 = createCanvas(10, 10).getContext('2d');
import { registerFonts, formatDescriptor } from '../covers/render.mjs';
import { LIVERIES } from '../covers/liveries.mjs';
import { AUTHOR, BORDER, DESCRIPTOR, EYEBROW, FLEURON, FOOTER, RULE, STACK, TITLE } from '../covers/layout.mjs';
import {
  renderStoryFace, renderPictureFace, renderStoryBack, renderEndingFace, renderRingFace, renderEndingBack,
  isHalfTurnSymmetric, scaleToClearIndex, CODE_READ_MARGIN_MM, GRAIN_COUNT, CLEARANCE_MM, FRAME, RING, BACK_RING, FONTS,
} from './face.mjs';
import { decode, moduleMm } from './qr.mjs';
import {
  BLEED, CARD_H, DPI, ENDING, ENDINGS, GLYPH_MM, GLYPH_STROKE_MM, INDEX, INDEX_REGION_MM, KEYLINE,
  LIVERY_MARK, MM_PER_COVER_PX, MOTIFS, OPENING, PLATE, POSTER_FRAME, PX_PER_MM, QR, RASTER, RULE_WIDTH_PX, SAFE_MM,
  STORY_BACK, TRIM, TYPE, TYPE_FLOOR_PT, LINE_FLOOR_PT, Y, mm, ptOf,
} from './geometry.mjs';
import { glyphSVG, GLYPH_NAMES } from './glyphs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'cards/review');
const deck = JSON.parse(readFileSync(resolve(ROOT, 'cards/data/deck.json'), 'utf8'));
const posterType = JSON.parse(readFileSync(resolve(ROOT, 'cards/data/poster-type.json'), 'utf8')).posters;
registerFonts();
const stories = deck.filter((c) => c.kind === 'story');
const pictures = deck.filter((c) => c.kind === 'picture');

// ── POSTERS AND THE ICON ─────────────────────────────────────────────────────────────────
for (const c of pictures) {
  const p = posterType[c.slug];
  c.posterFile = p.file;
  c.poster = await loadImage(readFileSync(resolve(ROOT, p.file)));
  if (c.poster.width !== p.px[0] || c.poster.height !== p.px[1]) throw new Error(`${c.slug}: poster is not the file that was measured`);
  c.posterType = p.elements;
}
const icon = await loadImage(readFileSync(resolve(ROOT, STORY_BACK.file)));

// ── DESCRIPTORS AT THE COVER'S OWN SCALE (R1.2) ──────────────────────────────────────────
const descTexts = stories.map((c) => formatDescriptor(c.descriptor)).filter(Boolean);
c0.font = FONTS.meta(TYPE.descriptor.size);
const descWidths = stories.filter((c) => c.descriptor).map((c) => ({ card: c, text: formatDescriptor(c.descriptor), w: trackedWidth(c0, formatDescriptor(c.descriptor), TYPE.descriptor.tracking) })).sort((a, b) => b.w - a.w);
const faceOpts = {};

// ── PASS 1: EVERY CARD, WITH ITS CODE, DECODED ───────────────────────────────────────────
// A story card is tried 'direct' first: modules in the keyline colour on the ground as it is.
// Where that does not decode without inversion, it goes on the cream panel. The style a livery
// ends up with is reported, and must be the same for every card of that livery. A picture card's
// code is always on its plate.
const qrResults = [];
const styleByLivery = {};
const layouts = new Map();
// Each render's raster lives in native memory V8 does not see, so collect between cards where
// the runner allows it (run with node --expose-gc, as the usage line says).
const collect = () => globalThis.gc?.();
for (const card of stories) {
  collect();
  const tried = [];
  let chosen = null;
  for (const style of ['direct', 'panel']) {
    const r = renderStoryFace(card, { ...faceOpts, qr: style });
    const got = decode(r.codeImage);
    tried.push({ style, decoded: got === r.layout.code.text ? 'yes' : got ? `WRONG: ${got}` : 'no' });
    if (got === r.layout.code.text) { chosen = { style, layout: r.layout }; break; }
  }
  if (!chosen) throw new Error(`${card.slug}: the code does not decode in either style`);
  styleByLivery[card.livery] ??= new Set();
  styleByLivery[card.livery].add(chosen.style);
  layouts.set(card.slug, chosen.layout);
  qrResults.push({ slug: card.slug, livery: card.livery, text: chosen.layout.code.text, version: chosen.layout.code.version, modules: chosen.layout.code.modules, sideMm: chosen.layout.code.sideMm, style: chosen.style, tried });
}
for (const [l, set] of Object.entries(styleByLivery)) if (set.size > 1) throw new Error(`livery ${l} needs two code styles`);
const QR_STYLE = Object.fromEntries(Object.entries(styleByLivery).map(([l, s]) => [l, [...s][0]]));
// A picture card whose index cannot sit clear of its title is ALSO drawn two other ways, for
// Ikenna to choose between: (A) the poster shrunk further until the index clears in its
// standard place, and (B) the index without its livery mark, which makes the plate shorter.
// Neither is chosen here.
const pictureOptions = new Map();
for (const card of pictures) {
  const r = renderPictureFace(card, { qr: true });
  const got = decode(r.codeImage);
  if (got !== r.layout.code.text) throw new Error(`${card.slug}: picture card code does not decode (${got})`);
  layouts.set(card.slug, r.layout);
  qrResults.push({ slug: card.slug, livery: 'series', text: r.layout.code.text, version: r.layout.code.version, modules: r.layout.code.modules, sideMm: r.layout.code.sideMm, style: 'plate', tried: [{ style: 'plate', decoded: 'yes' }] });
  if (r.layout.index.tl.clear && r.layout.index.br.clear) continue;
  const sA = scaleToClearIndex(card);
  const A = renderPictureFace(card, { qr: true, scale: sA });
  const B = renderPictureFace(card, { qr: true, mark: null });
  for (const o of [A, B]) if (decode(o.codeImage) !== o.layout.code.text) throw new Error(`${card.slug}: option code does not decode`);
  pictureOptions.set(card.slug, { A: A.layout, B: B.layout });
}

// ── THE POSTERS' OWN TYPE AGAINST THE SAFE LINE ──────────────────────────────────────────
// Each poster's type is measured (cards/data/poster-type.json), mapped through the card's own
// fit, and its clearance to the safe line reported: positive is inside, negative is outside
// by that much. The art is never moved or cropped to fix one. Overlaps with the plates are
// reported too.
const SAFE = { x1: SAFE_MM, y1: SAFE_MM, x2: TRIM.w - SAFE_MM, y2: TRIM.h - SAFE_MM };
const typeAgainstSafe = (l) => l.type.map((e) => {
  const b = e.box;
  const sides = { left: b.x1 - SAFE.x1, right: SAFE.x2 - b.x2, top: b.y1 - SAFE.y1, bottom: SAFE.y2 - b.y2 };
  const [side, clearance] = Object.entries(sides).sort((p, q) => p[1] - q[1])[0];
  const under = l.boxes.filter((p) => b.x1 < p.x2 && p.x1 < b.x2 && b.y1 < p.y2 && p.y1 < b.y2).map((p) => p.name);
  return { name: e.name, role: e.role, box: b, clearance, side, under };
});
const posterChecks = pictures.map((c) => ({ slug: c.slug, title: c.title, file: c.posterFile, fit: layouts.get(c.slug).fit, index: layouts.get(c.slug).index, type: typeAgainstSafe(layouts.get(c.slug)) }));

// ── THE SELECTION ────────────────────────────────────────────────────────────────────────
const byLen = [...stories].sort((a, b) => a.title.length - b.title.length);
const shortest = byLen[0];
const longest = byLen[byLen.length - 1];
const longestDesc = descWidths[0].card;
const chosenCards = [];
const add = (c, why) => { if (c && !chosenCards.some((x) => x.card.slug === c.slug)) chosenCards.push({ card: c, why }); };
for (const c of pictures) add(c, 'PICTURE CARD');
add(longest, `LONGEST SELECTED TITLE (${longest.title.length} chars)`);
add(shortest, `SHORTEST SELECTED TITLE (${shortest.title.length} chars)`);
add(longestDesc, `WIDEST DESCRIPTOR, at the cover's own scale${layouts.get(longestDesc.slug).descriptorOverrun?.crossesSafe ? ': CROSSES THE SAFE LINE' : ''}`);
add(stories.find((c) => c.slug === 'free-will'), 'SHORT STORY · CAPTIVE');
add(stories.find((c) => c.livery === 'flash' && c.motif === 'Grave'), 'FLASH FICTION · GRAVE');
add(stories.find((c) => c.slug === 'mother-and-other-poems'), 'POETRY');
add(stories.find((c) => c.slug === 'the-deadline'), 'POETRY · GRAVE');
add(stories.find((c) => c.livery === 'inspiring' && c.motif === 'Road'), 'INSPIRING');
add(stories.find((c) => c.slug === 'miss-lady'), 'CALVARY BYLINE');

const tiles = [];
for (const { card, why } of chosenCards) {
  collect();
  const opt = pictureOptions.get(card.slug);
  if (opt) {
    tiles.push({ png: renderPictureFace(card, { qr: true }).png, label: card.title, sub: `PICTURE CARD · FRAMED · ${card.motif} · index NOT CLEAR of the title (as ruled, the options follow)`, layout: layouts.get(card.slug) });
    tiles.push({ png: renderPictureFace(card, { qr: true, scale: opt.A.fit.scale }).png, label: `${card.title} — option A`, sub: `OPTION A · poster shrunk to ${(opt.A.fit.scaleOfBleedFit * 100).toFixed(1)}% of the bleed fit so the index clears in its standard place`, layout: opt.A });
    tiles.push({ png: renderPictureFace(card, { qr: true, mark: null }).png, label: `${card.title} — option B`, sub: `OPTION B · framed as ruled, index without its fleuron mark (shorter plate)${opt.B.index.tl.clear ? `, ${opt.B.index.tl.moved ? 'moved' : 'in place'}, clear` : ', STILL NOT CLEAR'}`, layout: opt.B });
    continue;
  }
  for (const qr of [true, false]) {
    const r = card.kind === 'picture'
      ? renderPictureFace(card, { qr })
      : renderStoryFace(card, { ...faceOpts, qr: qr ? QR_STYLE[card.livery] : null });
    tiles.push({ png: r.png, label: card.title, sub: `${why} · ${card.motif}${qr ? ` · code ${card.kind === 'picture' ? 'on plate' : QR_STYLE[card.livery]}` : ' · no code'}`, layout: r.layout });
  }
}
const showEndings = ENDINGS.filter((e) => ['THE RESCUE', 'THE ESCAPE'].includes(e.name));
const endingTiles = showEndings.map((e) => ({ png: renderEndingFace(e).png, label: e.name, sub: `ENDING · ${e.pair.join(' – ')}` }));
const ring = renderRingFace();
const back = renderEndingBack();
const symmetry = isHalfTurnSymmetric(back.imageData);
const storyBack = renderStoryBack(icon);
tiles.push(...endingTiles,
  { png: ring.png, label: 'The Ring', sub: 'RING · clockwise from the top' },
  { png: back.png, label: 'Ending back', sub: `ENDING + RING BACK · half-turn symmetric: ${symmetry.symmetric ? 'yes' : `NO (worst ${symmetry.worst})`}` },
  { png: storyBack.png, label: 'Story back', sub: `STORY BACK · the icon, ground ${storyBack.layout.ground.hex} run out to the bleed` });

// ── THE SHEET ────────────────────────────────────────────────────────────────────────────
const S = 0.3;
const TW = Math.round(RASTER.w * S);
const TH = Math.round(RASTER.h * S);
const COLS = 8;
const GUT = 28;
const CAP = 96;
const rows = Math.ceil(tiles.length / COLS);
const PANEL_H = rows * (TH + CAP + GUT);
const HEAD = 150;
const DETAIL_H = 760;
const W = COLS * (TW + GUT) + GUT;
const H = HEAD + 2 * (PANEL_H + 90) + DETAIL_H;
const sheet = createCanvas(W, H);
const g = sheet.getContext('2d');
g.fillStyle = '#ECE8E0';
g.fillRect(0, 0, W, H);
const ink = '#1C1418';
g.fillStyle = ink;
g.font = '44px "Cormorant Garamond SemiBold"';
g.fillText('SHORELINES — CARD CONTACT SHEET (CARDS-R1.2, gate 2)', GUT, 64);
g.font = '24px "EB Garamond"';
g.fillText(`Bridge ${TRIM.w} × ${TRIM.h} mm trim, ${BLEED} mm bleed, ${DPI} dpi. Faces shown at ${Math.round(S * 100)}% of the print raster. Every deck card (${deck.length}) was rendered and its code decoded; see MEASUREMENTS.md. Descriptors at the cover's own scale (${ptOf(TYPE.descriptor.size).toFixed(2)} pt, tracked ${TYPE.descriptor.tracking} cover px); nothing on a face is smaller.`, GUT, 104);
g.fillText(`Panel 1: the faces. Panel 2: the same faces with trim (cyan), bleed (magenta), safe 3 mm (green) and the chosen fan-index region (orange) drawn; on picture cards, each poster’s own type is boxed in red and the safe line + ${POSTER_FRAME.clearMm} mm it is framed to is dotted green. Bottom strip: details at 100%.`, GUT, 136);

const imgs = [];
for (const t of tiles) imgs.push(await loadImage(t.png));

function drawGuides(x, y, t) {
  const s = PX_PER_MM * S;
  if (t.layout?.kind === 'picture') {
    g.save(); g.strokeStyle = '#E02424'; g.lineWidth = 2;
    for (const e of t.layout.type) g.strokeRect(x + (BLEED + e.box.x1) * s, y + (BLEED + e.box.y1) * s, (e.box.x2 - e.box.x1) * s, (e.box.y2 - e.box.y1) * s);
    g.strokeStyle = '#2E9E44'; g.setLineDash([2, 4]);
    const f = SAFE_MM + POSTER_FRAME.clearMm;
    g.strokeRect(x + (BLEED + f) * s, y + (BLEED + f) * s, (TRIM.w - 2 * f) * s, (TRIM.h - 2 * f) * s);
    g.restore();
  }
  const rect = (colour, inset, dash) => {
    g.save(); g.strokeStyle = colour; g.lineWidth = 2; g.setLineDash(dash);
    g.strokeRect(x + (BLEED + inset) * s, y + (BLEED + inset) * s, (TRIM.w - 2 * inset) * s, (TRIM.h - 2 * inset) * s);
    g.restore();
  };
  g.save(); g.strokeStyle = '#E0249A'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, TW - 3, TH - 3); g.restore();
  rect('#12B5CB', 0, []);
  rect('#2E9E44', SAFE_MM, [8, 6]);
  g.save(); g.strokeStyle = '#E8862A'; g.lineWidth = 2; g.setLineDash([3, 4]);
  g.strokeRect(x + BLEED * s, y + BLEED * s, INDEX_REGION_MM.w * s, INDEX_REGION_MM.h * s);
  g.strokeRect(x + (BLEED + TRIM.w - INDEX_REGION_MM.w) * s, y + (BLEED + TRIM.h - INDEX_REGION_MM.h) * s, INDEX_REGION_MM.w * s, INDEX_REGION_MM.h * s);
  g.restore();
}

function panel(top, title, guides) {
  g.fillStyle = ink;
  g.font = '34px "Cormorant Garamond SemiBold"';
  g.fillText(title, GUT, top + 50);
  tiles.forEach((t, i) => {
    const x = GUT + (i % COLS) * (TW + GUT);
    const y = top + 80 + Math.floor(i / COLS) * (TH + CAP + GUT);
    g.drawImage(imgs[i], x, y, TW, TH);
    if (guides) drawGuides(x, y, t);
    g.fillStyle = ink;
    g.font = '22px "Cormorant Garamond SemiBold"';
    g.fillText(t.label.length > 34 ? `${t.label.slice(0, 33)}…` : t.label, x, y + TH + 30);
    g.font = '17px "EB Garamond"';
    const words = t.sub.split(' ');
    let line = '';
    let ly = y + TH + 54;
    for (const w of words) {
      if (g.measureText(`${line} ${w}`).width > TW && line) { g.fillText(line, x, ly); ly += 20; line = w; } else line = line ? `${line} ${w}` : w;
    }
    if (line) g.fillText(line, x, ly);
  });
}
panel(HEAD, '1 · Faces', false);
panel(HEAD + PANEL_H + 90, '2 · The same faces, with trim, bleed, safe and index-region lines', true);

// ── DETAILS AT 100% ──────────────────────────────────────────────────────────────────────
const dTop = HEAD + 2 * (PANEL_H + 90) + 10;
g.fillStyle = ink;
g.font = '34px "Cormorant Garamond SemiBold"';
g.fillText('3 · Details at 100% of the 600-dpi raster', GUT, dTop + 40);
const crops = [];
const panelled = tiles.find((t) => t.layout?.kind === 'story' && t.layout.code?.style === 'panel');
const direct = tiles.find((t) => t.layout?.kind === 'story' && t.layout.code?.style === 'direct');
const picture = tiles.find((t) => t.layout?.kind === 'picture' && t.layout.code && t.layout.index.tl.moved);
const dev = (m) => Math.round((BLEED + m) * PX_PER_MM);
for (const [t, what] of [[panelled, 'index (top left)'], [panelled, 'code'], [direct, 'code'], [picture, 'index (top left)'], [picture, 'code']]) {
  const b = t.layout.boxes.find((x) => x.name === what);
  crops.push({ img: await loadImage(t.png), x: dev(b.x1) - 40, y: dev(b.y1) - 40, w: Math.round((b.x2 - b.x1) * PX_PER_MM) + 80, h: Math.round((b.y2 - b.y1) * PX_PER_MM) + 80, label: `${t.label} — ${what}` });
}
let cx = GUT;
for (const c of crops) {
  g.drawImage(c.img, c.x, c.y, c.w, c.h, cx, dTop + 70, c.w, c.h);
  g.fillStyle = ink; g.font = '20px "EB Garamond"';
  const [who, what] = c.label.split(' — ');
  g.fillText(who.length > 22 ? `${who.slice(0, 21)}…` : who, cx, dTop + 70 + c.h + 28);
  g.fillText(what, cx, dTop + 70 + c.h + 52);
  cx += c.w + 60;
}
// the eight glyphs at print size ×4, for reading
const gx0 = Math.max(cx + 40, crops.reduce((a, c) => a + c.w + 60, GUT) + 140);
g.font = '20px "EB Garamond"';
g.fillText('The eight glyphs (6 mm, 0.15 mm stroke), at 2× the 600-dpi raster. Captive is new in R1.2', gx0, dTop + 70 - 8);
const { drawGlyph } = await import('./glyphs.mjs');
GLYPH_NAMES.forEach((m, i) => {
  const size = GLYPH_MM * PX_PER_MM * 2;
  const x = gx0 + (i % 4) * (size + 60);
  const y = dTop + 80 + Math.floor(i / 4) * (size + 50);
  g.save(); g.lineWidth = 1; drawGlyph(g, m, x, y, size, ink); g.restore();
  g.fillStyle = ink; g.fillText(m, x, y + size + 26);
});

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'CONTACT-SHEET.png'), sheet.toBuffer('image/png'));
mkdirSync(resolve(ROOT, 'cards/glyphs'), { recursive: true });
for (const m of GLYPH_NAMES) writeFileSync(resolve(ROOT, `cards/glyphs/${m.toLowerCase()}.svg`), glyphSVG(m));

// ── MEASUREMENTS.md ──────────────────────────────────────────────────────────────────────
const f = (v, d = 2) => Number(v).toFixed(d);
const L = [];
L.push('# Shorelines cards: measurements (CARDS-R1.2, gate 2)');
L.push('');
L.push('Generated by `scripts/cards/contact-sheet.mjs`. All positions are in mm from the **trim\'s** top-left corner. **D** marks a number derived from the cover. **C** marks a number chosen here.');
L.push('');
L.push('## The card');
L.push('');
L.push(`| | | |\n|---|---|---|`);
L.push(`| Trim | ${TRIM.w} × ${TRIM.h} mm | ruled |`);
L.push(`| Bleed | ${BLEED} mm each side → ${TRIM.w + 2 * BLEED} × ${TRIM.h + 2 * BLEED} mm | ruled |`);
L.push(`| Raster | ${RASTER.w} × ${RASTER.h} px at ${DPI} dpi (${f(PX_PER_MM, 3)} px/mm) | D |`);
L.push(`| Scale | 1 cover px = ${MM_PER_COVER_PX} mm (cover 1600 px → ${TRIM.w} mm) | D |`);
L.push(`| Cover height at this width | ${f(2400 * MM_PER_COVER_PX)} mm; the card's extra ${f(TRIM.h - 2400 * MM_PER_COVER_PX)} mm (${f(OPENING)} cover px) opens in the stack region | D |`);
L.push(`| Safe line | ${SAFE_MM} mm inside trim | C (printer convention) |`);
L.push('');
L.push('## Furniture, scaled by width, top anchored to the top edge and bottom to the bottom edge');
L.push('');
L.push('| Element | Cover | Card | |');
L.push('|---|---|---|---|');
L.push(`| Outer keyline inset | ${BORDER.outerInset} px | **${f(KEYLINE.outerInsetMm)} mm** from trim | D, **PROVISIONAL**: the first printer sets it from its cut tolerance |`);
L.push(`| Inner keyline inset | ${BORDER.innerInset} px | ${f(KEYLINE.innerInsetMm)} mm | D, provisional with the outer |`);
L.push(`| Outer keyline weight | ${BORDER.outerWidth} px | ${f(mm(BORDER.outerWidth), 3)} mm (${f(ptOf(BORDER.outerWidth))} pt), kept | D |`);
L.push(`| Inner keyline weight | ${BORDER.innerWidth} px | scaled ${f(mm(BORDER.innerWidth), 3)} mm (${f(ptOf(BORDER.innerWidth))} pt), **raised to ${f(mm(KEYLINE.innerWidthPx), 3)} mm (${LINE_FLOOR_PT} pt)** | **FLAG**: under a press's thinnest line. C: ${LINE_FLOOR_PT} pt floor |`);
L.push(`| Hairline rule weight | ${RULE.width} px | scaled ${f(mm(RULE.width), 3)} mm (${f(ptOf(RULE.width))} pt), **raised to ${f(mm(RULE_WIDTH_PX), 3)} mm** | **FLAG**, same floor |`);
L.push(`| Hairline rule extent | ${RULE.x1}–${RULE.x2} of width | ${f(TRIM.w * RULE.x1)}–${f(TRIM.w * RULE.x2)} mm | D |`);
L.push(`| Eyebrow baseline | ${EYEBROW.y} px | ${f(mm(EYEBROW.y))} mm at cover size; raised to the descriptor's size, its cap top is held, giving baseline ${f([...layouts.values()].find((l) => l.kind === 'story').boxes.find((b) => b.name === 'eyebrow').y2)}* mm | D |`);
L.push(`| Title measure | ${TITLE.maxWidth} px | ${f(mm(TITLE.maxWidth))} mm (${f(mm((1600 - TITLE.maxWidth) / 2))}–${f(TRIM.w - mm((1600 - TITLE.maxWidth) / 2))} mm) | D |`);
L.push(`| Stack region | ${STACK.top}–${2014 - STACK.bottomOffsetFromAuthor} px | ${f(mm(Y.stackTop))}–${f(mm(Y.stackBottom))} mm (${f(mm(Y.stackBottom - Y.stackTop))} mm tall, cover ${f(mm(1894 - 338))} mm + the opening) | D |`);
L.push(`| Stack placement | 20% of slack | unchanged | D |`);
L.push(`| Title → rule gap | ${RULE.gapAboveFromTitle} px | ${f(mm(RULE.gapAboveFromTitle))} mm | D |`);
L.push(`| Rule → descriptor cap | ${DESCRIPTOR.gapBelowRule} px | ${f(mm(DESCRIPTOR.gapBelowRule))} mm | D |`);
L.push(`| Fleuron | ${FLEURON.size} px, at ${FLEURON.gapFraction} of the gap | ${f(mm(FLEURON.size))} mm em, same fraction | D |`);
L.push(`| Author baseline | ${AUTHOR.y} px | ${f(mm(Y.authorBaseline))} mm (${f(TRIM.h - mm(Y.authorBaseline))} mm from the bottom edge, as on the cover) | D |`);
L.push(`| Footer baseline | ${FOOTER.y} px | ${f(mm(Y.footerBaseline))} mm (${f(TRIM.h - mm(Y.footerBaseline))} mm from the bottom edge) | D |`);
L.push('');
L.push('\\* The eyebrow\'s ink box bottom, which includes no descenders: it is set in caps.');
L.push('');
L.push('## Type: every element, its size and its tracking');
L.push('');
L.push(`**R1.2 ruling:** the descriptor is set at the cover's own scale at this width, ${DESCRIPTOR.size} cover px = **${f(ptOf(DESCRIPTOR.size), 2)} pt**, tracked at the cover's own ${DESCRIPTOR.tracking} cover px (${f(mm(DESCRIPTOR.tracking), 3)} mm). The face is the cover scaled by width, so that IS the cover's tracking scaled to match. R1.1's one deck-wide tracking is gone. **Nothing on a face is smaller than the descriptor:** the eyebrow and the footer are raised to its size and no further, each keeping its tracking as a proportion of its size, so the eyebrow never outranks the descriptor. The 6-pt floor is gone.`);
L.push('');
L.push('Tracking is the space added between clusters. "em" is that space as a fraction of the type size, which is how a proportion is held.');
L.push('');
L.push('| Element | Face | Cover | Card size | Card tracking | |');
L.push('|---|---|---|---:|---|---|');
const trk = (px, size) => `${f(px, 2)} cover px = ${f(mm(px), 3)} mm (${f(px / size, 4)} em)`;
const typeRow = (n, face, cover, row) => L.push(`| ${n} | ${face} | ${cover.size} px, tracked ${cover.tracking} (${f(ptOf(cover.size), 2)} pt by width) | **${f(ptOf(row.size), 2)} pt** (${f(row.size, 2)} cover px) | ${trk(row.tracking, row.size)} | ${row.raised ? `raised from ${f(row.scaledPt, 2)} pt to the descriptor's size; tracking held at the cover's ${f(cover.tracking / cover.size, 4)} em` : row === TYPE.descriptor ? "the cover's own: D" : 'above the descriptor, unchanged: D'} |`);
typeRow('Eyebrow', 'EB Garamond', EYEBROW, TYPE.eyebrow);
typeRow('Descriptor', 'EB Garamond', DESCRIPTOR, TYPE.descriptor);
typeRow('Footer', 'EB Garamond', FOOTER, TYPE.footer);
typeRow('Author', 'Cormorant Italic', AUTHOR, TYPE.author);
for (const r of TITLE.ladder) L.push(`| Title, ${r.size}-px rung | Cormorant 600 | ${r.size} px, tracked ${TITLE.tracking} | **${f(ptOf(r.size), 2)} pt** | ${trk(TITLE.tracking, r.size)} | the cover's ladder: D |`);
L.push(`| Index livery mark | Cormorant 600 | — | **${f(INDEX.markPt, 2)} pt** | none | C (R1) |`);
L.push(`| Ending: glyph names | EB Garamond | — | **${f(ptOf(TYPE.descriptor.size), 2)} pt** | ${trk(TYPE.descriptor.tracking, TYPE.descriptor.size)} | the descriptor's row, so the descriptor's size and tracking |`);
L.push(`| Ring: Ending names | EB Garamond | — | **${f(ptOf(TYPE.descriptor.size), 2)} pt** | ${trk(ring.layout.tracking, TYPE.descriptor.size)} | the descriptor's size. Two lines (THE / name); the tracking steps down from the descriptor's until neighbours clear by ${CLEARANCE_MM} mm on the ring's inner edge. Never the size |`);
L.push('');
L.push(`**The smallest type on any face is ${f(ptOf(TYPE.descriptor.size), 2)} pt** (descriptor, eyebrow, footer, Ending names, Ring names). Every story, Ending and Ring face is rendered at these sizes; none is tightened.`);
L.push('');
const over = [...layouts.values()].filter((l) => l.kind === 'story' && l.descriptorOverrun);
L.push('### Descriptors wider than the keylines: as on the covers');
L.push('');
L.push(`At the cover's own scale, a descriptor takes exactly the share of the width it takes on its cover. **The cover does not hold a descriptor to its keylines**: the live cover of *The Number Thirteen* (byte-identical to a fresh render) sets SUPERSTITION.  AVOIDANCE.  CONFIRMATION. at ${f(mm(1567.6), 2)} mm on a ${TRIM.w}-mm-wide equivalent, through both keylines. Across the library, 29 of the 196 published descriptors run past the cover's inner keyline. That is in the cover generator, which this round does not touch (it is a shared module under DESIGN-LOCK).`);
L.push('');
L.push(`On the cards it is reproduced, not corrected, because the ruling sets the cover's scale. **${over.length} of the ${stories.length} story cards in the deck** have a descriptor that comes within ${CLEARANCE_MM} mm of the inner keyline (${f(KEYLINE.innerInsetMm)} mm from the trim). **${over.filter((o) => o.descriptorOverrun.pastInnerKeylineMm > 0.005).length} of them cross it**, and ${over.filter((o) => o.descriptorOverrun.pastOuterKeylineMm > 0.005).length} cross the outer keyline (${f(KEYLINE.outerInsetMm)} mm) too. ${over.some((o) => o.descriptorOverrun.crossesSafe) ? `**${over.filter((o) => o.descriptorOverrun.crossesSafe).map((o) => o.slug).join(', ')} also cross${over.filter((o) => o.descriptorOverrun.crossesSafe).length === 1 ? 'es' : ''} the ${SAFE_MM} mm safe line and cannot print as set.** It is drawn as ruled, shown on the sheet, and not tightened: it needs a ruling (its own tighter tracking, a smaller size for that one card, or a shorter descriptor). Every other overrun clears the safe line.` : `Every one still clears the ${SAFE_MM} mm safe line.`} All of them, widest first:`);
L.push('');
L.push('| Card | Descriptor | Width | Left edge from trim | Past the inner keyline | Past the outer keyline | Inside the safe line? |');
L.push('|---|---|---:|---:|---:|---:|---|');
for (const o of over.sort((a, b) => a.descriptorOverrun.x1 - b.descriptorOverrun.x1)) {
  const d = o.descriptorOverrun;
  L.push(`| ${o.slug} | ${o.descriptor.text} | ${f(d.x2 - d.x1)} mm | ${f(d.x1)} mm | ${d.pastInnerKeylineMm > 0.005 ? `${f(d.pastInnerKeylineMm)} mm` : 'no (within 0.5 mm)'} | ${d.pastOuterKeylineMm > 0.005 ? `**${f(d.pastOuterKeylineMm)} mm**` : '—'} | ${d.crossesSafe ? `**NO: ${f(SAFE_MM - d.x1)} mm outside**` : 'yes'} |`);
}
L.push('');
L.push('## Corner indices');
L.push('');
L.push(`- **Region, chosen:** a fanned hand held in the left hand shows each card's left edge. The index sits in the top-left ${INDEX_REGION_MM.w} × ${INDEX_REGION_MM.h} mm of the trim, and its 180° twin in the bottom-right. Orange on panel 2.`);
L.push(`- **Glyph box:** ${f(INDEX.x)}–${f(INDEX.x + GLYPH_MM)} mm across, ${f(INDEX.y)}–${f(INDEX.y + GLYPH_MM)} mm down. That is ${f(INDEX.x - KEYLINE.innerInsetMm)} mm inside the inner keyline. C`);
L.push(`- **Livery mark:** ${INDEX.markPt} pt Cormorant 600, its cap top ${INDEX.markGapMm} mm under the glyph. Marks: ${Object.entries(LIVERY_MARK).map(([k, v]) => `${LIVERIES[k].name} **${v === '❦' ? 'the house fleuron' : v}**`).join(' · ')}. C`);
L.push('- **The livery is carried by a letter, not by colour.** The three dark grounds (#080610, #3C101A, #102E26) will not separate in a fan, or for a colour-blind player. Series takes the fleuron because it is the picture card. An Ending carries its two glyphs side by side, and the Ring carries the eight-point ring mark.');
L.push(`- **Collisions asserted on every rendered card:** no two marks within ${CLEARANCE_MM} mm of each other, and none outside the inner keyline less ${CLEARANCE_MM} mm. All ${deck.length} deck cards, both Endings shown, the Ring and its names pass. The render throws if any fail.`);
L.push('');
L.push('## The card code');
L.push('');
L.push(`- **Placement, chosen:** the right side, with the panel's right edge at ${f(QR.rightMm)} mm and its foot ${QR.bottomGapAboveIndexMm} mm above the bottom-right index and never closer than 0.8 mm to the author line's ascenders (a long author line reaches under the code). The same position on every card. The top right is too close to a wide eyebrow (FLASH FICTION runs to 41.6 mm). The bottom left is too close to a long author line.`);
L.push(`- **Module:** ${QR.modulePx} device px = **${f(moduleMm, 3)} mm**, whole pixels at 600 dpi. Quiet zone ${QR.quietModules} modules (the spec). Error correction ${QR.ecc}.`);
L.push(`- **Decoder:** jsQR 1.4.0 with \`inversionAttempts: 'dontInvert'\`, run on the ${DPI}-dpi render as drawn: the code and ${CODE_READ_MARGIN_MM} mm of the face around it on every side. (R1.1 read the whole face. R1.2 reads the region because @napi-rs/canvas 1.0.6 never frees a full-raster read, about 14 MB a call, and the deck ran the Codespace out of memory.)`);
L.push(`- **Gold on a dark ground fails.** The modules are lighter than the ground, which is an inverted code, and the decoder does not try inversion. So **the dark liveries (Short Story, Flash Fiction, Inspiring) carry the code on a small cream panel** (${QR.panel}), with modules in the livery's own ground colour. **Poetry decodes directly**, with modules in its keyline colour on its light ground and no panel. **Picture cards carry the code on a plate** (below), with modules in the plate ink.`);
L.push('');
L.push('| Card | Livery | Style | Version | Modules | Module | Side (with quiet zone) | Decoded |');
L.push('|---|---|---|---:|---:|---:|---:|---|');
for (const q of qrResults) L.push(`| ${q.slug} | ${LIVERIES[q.livery].name} | ${q.style}${q.tried.length > 1 ? ' (direct: no)' : ''} | ${q.version} | ${q.modules} | ${f(moduleMm, 3)} mm | ${f(q.sideMm)} mm | yes, \`${q.text}\` |`);
L.push('');
L.push(`**Every one of the ${qrResults.length} codes decodes** from its 600-dpi render without inversion, and each decodes to its own URL.`);
L.push('');
L.push('## Picture cards: one per published series, framed');
L.push('');
L.push(`**The files.** Ikenna added three files to \`public/\`; they are moved to \`cards/posters/\` under the same names and committed there. Nothing from this round is in \`public/\`. None of the three is the art without its words, so **every card takes the framed route** and there is no re-set version (a) to choose between.`);
L.push('');
L.push('| Series | File | Pixels | Colour mode | Transparency | Words on it? | What it is |');
L.push('|---|---|---|---|---|---|---|');
L.push('| Beta Princess | `cards/posters/beta.jpeg` | 1406 × 2048 (0.6865, **not 2:3**) | JPEG, 8-bit RGB, baseline | none | yes: title, author, NIGHTSONG NOVELLA | **The full poster at a higher resolution, but not the published image resized**: a different render of the same design, with **no Story Island badge**, and slightly wider than 2:3. Used in place of the 1024 × 1536 image, as ruled. |');
L.push('| Diary of a Lagos 9-5er | `cards/posters/diary.jpeg` | 1024 × 1536 (2:3) | JPEG, 8-bit RGB, progressive | none | yes: title, subtitle, author, NOVEL | **Byte-identical to the published poster** (same SHA-256). Not higher resolution. |');
L.push('| The Doherty Confessions | `cards/posters/doherty.png` | 1024 × 1536 (2:3) | PNG, 8-bit RGB | none (no alpha channel) | yes: series line, title, rule, author | **Byte-identical to the published poster** (same SHA-256). Not higher resolution. |');
L.push('');
L.push(`**The frame.** The whole poster is shrunk, centred on the trim, until its outermost type clears the safe line by ${POSTER_FRAME.clearMm} mm, and the margin is Series cream **${POSTER_FRAME.colour}**. The scale is derived from each poster's worst element. It is never larger than the fit to the bleed height. Beta Princess's 0.6865 proportion needs **no crop**: the poster is scaled whole, and the cream takes up the difference.`);
L.push('');
L.push('| Series | Scale (mm per poster px) | Of the fit to the bleed | Set by | Poster drawn at | Frame at the trim: left / right | top / bottom | Effective dpi |');
L.push('|---|---:|---:|---|---|---|---|---:|');
for (const p of posterChecks) {
  const m = p.fit.margins;
  const side = (v) => (v < 0 ? `none: the art runs ${f(-v)} mm past the trim, cream only in the bleed beyond it` : `${f(v)} mm cream`);
  L.push(`| ${p.title} | ${f(p.fit.scale, 5)} | ${f(p.fit.scaleOfBleedFit * 100, 1)}% | ${p.fit.frameScale.element}, ${p.fit.frameScale.side} | ${f(p.fit.drawnWmm)} × ${f(p.fit.drawnHmm)} mm | ${side(m.left)} | ${side(m.top)} | ${f(p.fit.effectiveDpi, 0)} |`);
}
L.push('');
const thin = posterChecks.filter((p) => Object.values(p.fit.margins).some((v) => v < 1));
L.push(`**Flag, for print:** ${thin.map((p) => { const m = p.fit.margins; return `*${p.title}*: ${m.left < 0 ? `the art passes the trim by only ${f(-m.left)} mm at the sides` : `the side frame is ${f(m.left)} mm`}${m.top < 1 ? `, and the top and bottom frame is ${f(m.top)} mm` : ''}`; }).join('; ')}. Where the art stops less than a millimetre from the trim, a cut that drifts that far shows a sliver of cream on one side, or loses it. The frame is what the ruled scale leaves, so this is reported rather than adjusted.`);
L.push('');
L.push(`**The index.** It must not cover the poster's title. It keeps its standard place where that is clear. Otherwise it moves to the nearest place, on a 0.05 mm grid, inside the safe line and the fanned-hand region that clears every element of the poster's type by ${CLEARANCE_MM} mm. Plates **${PLATE.colour}** with **${PLATE.ink}** marks, corner radius ${PLATE.radiusMm} mm, padding ${PLATE.padMm} mm (C, R1.1). The index plate is ${f(layouts.get(pictures[0].slug).boxes[0].x2 - layouts.get(pictures[0].slug).boxes[0].x1)} × ${f(layouts.get(pictures[0].slug).boxes[0].y2 - layouts.get(pictures[0].slug).boxes[0].y1)} mm.`);
L.push('');
L.push('| Series | Top-left index | Bottom-right index | Code |');
L.push('|---|---|---|---|');
const idx = (i) => (!i.clear ? `**NOT CLEAR: covers ${i.covers.join(', ')}.** No place in the region clears it; see the options below` : i.moved ? `moved ${[i.shift.x && `${f(Math.abs(i.shift.x))} mm ${i.shift.x > 0 ? 'right' : 'left'}`, i.shift.y && `${f(Math.abs(i.shift.y))} mm ${i.shift.y > 0 ? 'down' : 'up'}`].filter(Boolean).join(' and ')} from its standard place, inside the region, to clear ${i.covers.join(', ')}` : 'standard place, clear');
for (const p of posterChecks) {
  const q = qrResults.find((r) => r.slug === p.slug);
  L.push(`| ${p.title} | ${idx(p.index.tl)} | ${idx(p.index.br)} | v${q.version}, ${f(q.sideMm)} mm plate, ${QR.bottomGapAboveIndexMm} mm above the bottom-right index; decodes to \`${q.text}\` |`);
}
L.push('');
for (const [slug, o] of pictureOptions) {
  const p = posterChecks.find((x) => x.slug === slug);
  const mA = o.A.fit.margins;
  L.push(`**${p.title}: the index cannot sit clear of the title inside the fanned-hand region.** At the ruled scale the title runs from ${f(p.type.find((e) => e.role === 'title').box.x1)} mm across and ${f(p.type.find((e) => e.role === 'title').box.y1)} mm down, and the plate needs ${f(layouts.get(slug).boxes[0].x2 - layouts.get(slug).boxes[0].x1)} × ${f(layouts.get(slug).boxes[0].y2 - layouts.get(slug).boxes[0].y1)} mm inside the safe line. The ruled card is drawn with the index in its standard place, over the start of the title. **The options, not chosen:**`);
  L.push('');
  L.push(`- **A. Shrink the poster further**, to ${f(o.A.fit.scale, 5)} mm/px (${f(o.A.fit.scaleOfBleedFit * 100, 1)}% of the bleed fit, ${f((o.A.fit.scale / p.fit.scale) * 100, 1)}% of the ruled frame scale), until the title clears the index in its standard place. Poster ${f(o.A.fit.drawnWmm)} × ${f(o.A.fit.drawnHmm)} mm; frame ${f(mA.left)} mm at the sides and ${f(mA.top)} mm top and bottom; ${f(o.A.fit.effectiveDpi, 0)} dpi. Drawn on the sheet.`);
  L.push(`- **B. Drop the fleuron livery mark on picture cards**, leaving the glyph alone on a ${f(o.B.boxes[0].x2 - o.B.boxes[0].x1)} × ${f(o.B.boxes[0].y2 - o.B.boxes[0].y1)} mm plate. At the ruled scale that ${o.B.index.tl.clear ? `${o.B.index.tl.moved ? `clears the title after moving within the region` : 'clears the title in its standard place'}` : '**still does not clear**'}. The poster itself already says Series. Drawn on the sheet.`);
  L.push('- **C. Move the indices on picture cards to the other diagonal** (top right and bottom left). That breaks the fanned-hand rule, where only the left edge shows. Not drawn.');
  L.push('- **D. Accept the plate over the first letters**, as R1.1 had it. That is the card as drawn.');
  L.push('');
}
L.push('### The posters\' own type against the safe line');
L.push('');
L.push(`Each element's ink box is measured on the poster file (\`cards/data/poster-type.json\` holds the method, the search regions and the thresholds; Beta Princess is re-measured on the new file, and the Doherty title line by line) and mapped through the card's frame. **Clearance is positive inside the safe line.** By construction every element is at least ${POSTER_FRAME.clearMm} mm inside it, and the worst is exactly that.`);
L.push('');
L.push('| Series | Element | Box on the card (mm from trim) | Clearance to safe | Nearest side | Under a plate |');
L.push('|---|---|---|---:|---|---|');
for (const p of posterChecks) for (const e of p.type) L.push(`| ${p.title} | ${e.name} | ${f(e.box.x1)}–${f(e.box.x2)} × ${f(e.box.y1)}–${f(e.box.y2)} | ${f(e.clearance)} mm | ${e.side} | ${e.under.length ? `**${e.under.join(', ')}**` : 'no'} |`);
L.push('');
L.push('## Endings, the Ring, and the backs');
L.push('');
L.push(`- **Ending ground, chosen:** house umber **${ENDING.ground}** (the site's #2a2318), with furniture in display gold ${ENDING.keyline}. It is not a purple, and it is distinct from every story livery and from the story back's icon purple.`);
L.push('- **Ending face:** eyebrow ENDING, the name as title on the cover\'s ladder, then the two glyphs with their names (6 pt) where the descriptor sits, the fleuron, and footer THE TURN. There is no author row. Its index is the two glyphs side by side.');
L.push(`- **Ring:** glyphs on a ${RING.glyphRadiusMm} mm radius, clockwise from the top: ${MOTIFS.join(', ')}. Each Ending is named on a ${RING.nameRadiusMm} mm radius, between its two neighbours: two lines, running along the ring, and turned on the lower half to read from the foot. Eyebrow THE RING, footer THE TURN (C).`);
L.push(`- **Ending back (shared by the Ring):** eight points (${BACK_RING.dotMm} mm radius) on a ${BACK_RING.radiusMm} mm circle with a hairline, in display gold, centred on the Ending ground. Nothing comes within ${f(Math.min(TRIM.w, TRIM.h) / 2 - BACK_RING.radiusMm - BACK_RING.dotMm)} mm of the trim. No glow, and the grain is written in half-turn pairs. **Half-turn symmetry is checked pixel by pixel on the 600-dpi raster: ${symmetry.symmetric ? 'identical' : `NOT identical (worst ${symmetry.worst})`}.**`);
const sb = storyBack.layout;
L.push(`- **Story back:** Ikenna's \`${STORY_BACK.file}\`, taken from where he put it in the Codespace. It was on no branch and not on origin/main, so it is committed on this branch under his name for it.`);
L.push(`  - **Source:** ${sb.iconPx[0]} × ${sb.iconPx[1]} px, RGB with no alpha channel (minimum alpha ${sb.ground.alphaMin}). It has no transparency, no rounded corners, and is not square.`);
L.push(`  - **Ground:** every one of its ${sb.ground.edgePixels.toLocaleString('en-GB')} edge pixels is **${sb.ground.hex}** (rgb ${sb.ground.rgb.join(', ')}), a worst deviation of ${sb.ground.worstEdgeDeviation}. The whole ground outside the mark was also sampled: about 263,000 pixels, every one the same colour. So the ground is flat, and the purple runs to the bleed with no tile edge. Checked on the render too: worst deviation across the icon's edge, ${sb.seamDeviation}.`);
L.push(`  - **Placement:** the icon is centred at the card's width (its own width = the ${STORY_BACK.widthMm} mm trim width, so ${f(sb.drawnMm[0])} × ${f(sb.drawnMm[1])} mm), centred vertically, on the sampled purple, which runs out to the bleed. The mark inside the icon sits about 1.3 mm above the icon's own centre, as drawn in the source.`);
L.push(`  - **Effective dpi: ${f(sb.effectiveDpi, 0)}**, above 300. Not rotationally symmetric; accepted by the brief.`);
L.push('');
L.push('## Ground treatment at card size');
L.push('');
L.push(`The glow and vignette keep their proportions to the trim and run on into the bleed. Their blur scales by width. The grain keeps the cover's coverage: ${GRAIN_COUNT.toLocaleString('en-GB')} specks over ${(RASTER.w * RASTER.h).toLocaleString('en-GB')} px (3.9%), drawn from the cover's slug-seeded stream (D).`);
L.push('');
writeFileSync(resolve(OUT, 'MEASUREMENTS.md'), `${L.join('\n')}\n`);
writeFileSync(resolve(ROOT, 'cards/data/qr-results.json'), `${JSON.stringify(qrResults, null, 1)}\n`);
console.log(`sheet ${W}×${H}; ${deck.length} cards rendered and decoded; overruns ${[...layouts.values()].filter((l) => l.descriptorOverrun).length}; options ${[...pictureOptions.keys()]}; styles ${JSON.stringify(QR_STYLE)}; back symmetric ${symmetry.symmetric}`);
