// THE CARD CONTACT SHEET — gate 2 of Shorelines (CARDS-R1.1).
//
//   node scripts/cards/contact-sheet.mjs      # → cards/review/CONTACT-SHEET.png + MEASUREMENTS.md
//
// Renders EVERY card in cards/data/deck.json at 600 dpi with its code, decodes each code from
// that raster without trying the inverted image, and runs the collision assertion on each.
// That is the proof. The sheet itself shows a chosen selection, each face with and without its
// code, then the same faces again with the trim, bleed and safe lines drawn.
//
// READS: deck.json, the posters from their public Storage URLs, and cards/Story-Island-icon.png.
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
  isHalfTurnSymmetric, deckDescriptorTracking, GRAIN_COUNT, CLEARANCE_MM, FRAME, RING, BACK_RING,
} from './face.mjs';
import { decode, moduleMm } from './qr.mjs';
import {
  BLEED, CARD_H, DPI, ENDING, ENDINGS, GLYPH_MM, GLYPH_STROKE_MM, INDEX, INDEX_REGION_MM, KEYLINE,
  LIVERY_MARK, MM_PER_COVER_PX, MOTIFS, OPENING, PLATE, PX_PER_MM, QR, RASTER, RULE_WIDTH_PX, SAFE_MM,
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
  const res = await fetch(c.posterUrl);
  if (!res.ok) throw new Error(`poster fetch failed: ${res.status}`);
  c.poster = await loadImage(Buffer.from(await res.arrayBuffer()));
}
const icon = await loadImage(readFileSync(resolve(ROOT, STORY_BACK.file)));

// ── THE DECK'S ONE DESCRIPTOR TRACKING ───────────────────────────────────────────────────
const descTexts = stories.map((c) => formatDescriptor(c.descriptor)).filter(Boolean);
const DT = deckDescriptorTracking(descTexts);
const faceOpts = { descriptorTracking: DT.tracking };

// ── PASS 1: EVERY CARD, WITH ITS CODE, DECODED ───────────────────────────────────────────
// A story card is tried 'direct' first: modules in the keyline colour on the ground as it is.
// Where that does not decode without inversion, it goes on the cream panel. The style a livery
// ends up with is reported, and must be the same for every card of that livery. A picture card's
// code is always on its plate.
const qrResults = [];
const styleByLivery = {};
const layouts = new Map();
for (const card of stories) {
  const tried = [];
  let chosen = null;
  for (const style of ['direct', 'panel']) {
    const r = renderStoryFace(card, { ...faceOpts, qr: style });
    const got = decode(r.imageData);
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
for (const card of pictures) {
  const r = renderPictureFace(card, { qr: true });
  const got = decode(r.imageData);
  if (got !== r.layout.code.text) throw new Error(`${card.slug}: picture card code does not decode (${got})`);
  layouts.set(card.slug, r.layout);
  qrResults.push({ slug: card.slug, livery: 'series', text: r.layout.code.text, version: r.layout.code.version, modules: r.layout.code.modules, sideMm: r.layout.code.sideMm, style: 'plate', tried: [{ style: 'plate', decoded: 'yes' }] });
}

// ── THE POSTERS' OWN TYPE AGAINST THE SAFE LINE ──────────────────────────────────────────
// Each poster's type is measured (cards/data/poster-type.json), mapped through the card's own
// fit, and its clearance to the safe line reported: positive is inside, negative is outside
// by that much. The art is never moved or cropped to fix one. Overlaps with the plates are
// reported too.
const SAFE = { x1: SAFE_MM, y1: SAFE_MM, x2: TRIM.w - SAFE_MM, y2: TRIM.h - SAFE_MM };
const posterChecks = pictures.map((c) => {
  const l = layouts.get(c.slug);
  const plates = l.boxes;
  return {
    slug: c.slug, title: c.title, fit: l.fit,
    type: posterType[c.slug].map((e) => {
      const b = l.toTrim(e.box);
      const sides = { left: b.x1 - SAFE.x1, right: SAFE.x2 - b.x2, top: b.y1 - SAFE.y1, bottom: SAFE.y2 - b.y2 };
      const [side, clearance] = Object.entries(sides).sort((p, q) => p[1] - q[1])[0];
      const under = plates.filter((p) => b.x1 < p.x2 && p.x1 < b.x2 && b.y1 < p.y2 && p.y1 < b.y2).map((p) => p.name);
      return { name: e.name, box: b, clearance, side, under };
    }),
  };
});

// ── THE SELECTION ────────────────────────────────────────────────────────────────────────
const byLen = [...stories].sort((a, b) => a.title.length - b.title.length);
const shortest = byLen[0];
const longest = byLen[byLen.length - 1];
const longestDesc = stories.find((c) => formatDescriptor(c.descriptor) === DT.longest);
const chosenCards = [];
const add = (c, why) => { if (c && !chosenCards.some((x) => x.card.slug === c.slug)) chosenCards.push({ card: c, why }); };
for (const c of pictures) add(c, 'PICTURE CARD');
add(longest, `LONGEST SELECTED TITLE (${longest.title.length} chars)`);
add(shortest, `SHORTEST SELECTED TITLE (${shortest.title.length} chars)`);
add(longestDesc, 'LONGEST DESCRIPTOR — sets the deck tracking');
add(stories.find((c) => c.motif === 'Water'), 'SHORT STORY · WATER');
add(stories.find((c) => c.livery === 'flash' && c.motif === 'Grave'), 'FLASH FICTION · GRAVE');
add(stories.find((c) => c.slug === 'mother-and-other-poems'), 'POETRY');
add(stories.find((c) => c.slug === 'the-deadline'), 'POETRY · GRAVE');
add(stories.find((c) => c.livery === 'inspiring' && c.motif === 'Road'), 'INSPIRING');
add(stories.find((c) => c.slug === 'miss-lady'), 'CALVARY BYLINE');

const tiles = [];
for (const { card, why } of chosenCards) {
  for (const qr of [true, false]) {
    const r = card.kind === 'picture'
      ? renderPictureFace(card, { qr })
      : renderStoryFace(card, { ...faceOpts, qr: qr ? QR_STYLE[card.livery] : null });
    tiles.push({ png: r.png, label: card.title, sub: `${why} · ${card.motif}${qr ? ` · code ${card.kind === 'picture' ? 'on plate' : QR_STYLE[card.livery]}` : ' · no code'}`, layout: r.layout });
  }
}
const showEndings = ENDINGS.filter((e) => ['THE ESCAPE', 'THE FAREWELL'].includes(e.name));
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
g.fillText('SHORELINES — CARD CONTACT SHEET (CARDS-R1.1, gate 2)', GUT, 64);
g.font = '24px "EB Garamond"';
g.fillText(`Bridge ${TRIM.w} × ${TRIM.h} mm trim, ${BLEED} mm bleed, ${DPI} dpi. Faces shown at ${Math.round(S * 100)}% of the print raster. Every deck card (${deck.length}) was rendered and its code decoded; see MEASUREMENTS.md. Descriptors on every card share one tracking (${DT.tracking.toFixed(2)} px at 6 pt).`, GUT, 104);
g.fillText('Panel 1: the faces. Panel 2: the same faces with trim (cyan), bleed (magenta), safe 3 mm (green) and the chosen fan-index region (orange) drawn; on picture cards, each poster’s own type is boxed in red. Bottom strip: details at 100%.', GUT, 136);

const imgs = [];
for (const t of tiles) imgs.push(await loadImage(t.png));

function drawGuides(x, y, t) {
  const s = PX_PER_MM * S;
  if (t.layout?.kind === 'picture') {
    g.save(); g.strokeStyle = '#E02424'; g.lineWidth = 2;
    for (const e of posterChecks.find((p) => p.slug === t.layout.slug).type) g.strokeRect(x + (BLEED + e.box.x1) * s, y + (BLEED + e.box.y1) * s, (e.box.x2 - e.box.x1) * s, (e.box.y2 - e.box.y1) * s);
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
const picture = tiles.find((t) => t.layout?.kind === 'picture' && t.layout.code);
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
g.fillText('The eight glyphs (6 mm, 0.15 mm stroke), at 2× the 600-dpi raster', gx0, dTop + 70 - 8);
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
L.push('# Shorelines cards: measurements (CARDS-R1.1, gate 2)');
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
L.push(`| Eyebrow baseline | ${EYEBROW.y} px | ${f(mm(EYEBROW.y))} mm at cover size; at 6 pt its cap top is held, giving baseline ${f([...layouts.values()].find((l) => l.kind === 'story').boxes.find((b) => b.name === 'eyebrow').y2)}* mm | D |`);
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
L.push('## Type: printed sizes');
L.push('');
L.push(`The floor is ${TYPE_FLOOR_PT} pt. That is a chosen print convention, not a derivation.`);
L.push('');
L.push('| Element | Face | Cover px | Scaled by width | Printed | |');
L.push('|---|---|---:|---:|---:|---|');
const typeRow = (n, face, row) => L.push(`| ${n} | ${face} | ${row === TYPE.descriptor ? DESCRIPTOR.size : { eyebrow: EYEBROW, footer: FOOTER, author: AUTHOR }[n.toLowerCase()].size} | ${f(row.scaledPt, 1)} pt | **${f(ptOf(row.size), 1)} pt** | ${row.raised ? `**FLAG**: under ${TYPE_FLOOR_PT} pt. Proposed fix: raise it to ${TYPE_FLOOR_PT} pt with its tracking held as a proportion of size (${f(row.tracking, 1)} px)` : 'above the floor, unchanged'} |`);
typeRow('Eyebrow', 'EB Garamond', TYPE.eyebrow);
typeRow('Descriptor', 'EB Garamond', TYPE.descriptor);
L[L.length - 1] = L[L.length - 1].replace(/with its tracking held as a proportion of size \([0-9.]+ px\)/, `at the deck's one tracking, ${f(DT.tracking, 2)} px (below)`);
typeRow('Footer', 'EB Garamond', TYPE.footer);
typeRow('Author', 'Cormorant Italic', TYPE.author);
for (const r of TITLE.ladder) L.push(`| Title, ${r.size}-px rung | Cormorant 600 | ${r.size} | ${f(ptOf(r.size), 1)} pt | ${f(ptOf(r.size), 1)} pt | ${ptOf(r.size) < TYPE_FLOOR_PT ? '**FLAG**' : 'above the floor'} |`);
L.push(`| Index livery mark | Cormorant 600 | — | — | ${INDEX.markPt} pt | C |`);
L.push(`| Ending: glyph names | EB Garamond | — | — | ${TYPE_FLOOR_PT} pt | C, at the floor (the descriptor's row) |`);
L.push(`| Ring: Ending names | EB Garamond | — | — | ${TYPE_FLOOR_PT} pt, tracking stepped to ${f(ring.layout.tracking, 1)} px | C. Two lines (THE / name): one line runs to 22.8 mm against 15.4 mm of arc |`);
L.push('');
const toCover = DT.tracking * (DESCRIPTOR.size / TYPE.descriptor.size);
L.push('### The descriptor: one tracking for the deck');
L.push('');
L.push(`At 6 pt the descriptor is ${f(TYPE.descriptor.size)} cover px. Holding the cover's own tracking as a proportion of size would give ${f(DT.held)} px, and ${descTexts.filter((t) => { c0.font = `${TYPE.descriptor.size}px "EB Garamond"`; return trackedWidth(c0, t, DT.held) > TITLE.maxWidth; }).length} of the ${descTexts.length} deck descriptors would then outrun the ${f(mm(TITLE.maxWidth))} mm measure. R1 tightened each of those on its own. **R1.1 sets one value for every card, derived from the longest descriptor in the deck:**`);
L.push('');
L.push(`- **The longest descriptor:** "${DT.longest}". It is the widest at 6 pt untracked, so it is the one that binds.`);
L.push(`- **Deck tracking: ${f(DT.tracking, 2)} px between clusters at the ${f(TYPE.descriptor.size)}-px (6 pt) size.** That is **${f(DT.em, 4)} em**, or ${f(mm(DT.tracking), 3)} mm. At this tracking the longest descriptor sets exactly to the measure (${f(mm(TITLE.maxWidth))} mm), and every other descriptor is narrower.`);
L.push(`- **In the cover's tracking units:** the cover tracks its 54-px descriptor at ${DESCRIPTOR.tracking} px (${f(DESCRIPTOR.tracking / DESCRIPTOR.size, 4)} em). The deck value is ${f(toCover, 2)} px at the cover's 54 px, which is ${f((toCover / DESCRIPTOR.tracking) * 100, 0)}% of the cover's tracking.`);
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
L.push(`- **Decoder:** jsQR 1.4.0 with \`inversionAttempts: 'dontInvert'\`, run on the full ${DPI}-dpi render.`);
L.push(`- **Gold on a dark ground fails.** The modules are lighter than the ground, which is an inverted code, and the decoder does not try inversion. So **the dark liveries (Short Story, Flash Fiction, Inspiring) carry the code on a small cream panel** (${QR.panel}), with modules in the livery's own ground colour. **Poetry decodes directly**, with modules in its keyline colour on its light ground and no panel. **Picture cards carry the code on a plate** (below), with modules in the plate ink.`);
L.push('');
L.push('| Card | Livery | Style | Version | Modules | Module | Side (with quiet zone) | Decoded |');
L.push('|---|---|---|---:|---:|---:|---:|---|');
for (const q of qrResults) L.push(`| ${q.slug} | ${LIVERIES[q.livery].name} | ${q.style}${q.tried.length > 1 ? ' (direct: no)' : ''} | ${q.version} | ${q.modules} | ${f(moduleMm, 3)} mm | ${f(q.sideMm)} mm | yes, \`${q.text}\` |`);
L.push('');
L.push(`**Every one of the ${qrResults.length} codes decodes** from its 600-dpi render without inversion, and each decodes to its own URL.`);
L.push('');
L.push('## Picture cards: one per published series');
L.push('');
L.push(`Each poster is 2:3 (0.6667). The card with its bleed is ${TRIM.w + 2 * BLEED} × ${TRIM.h + 2 * BLEED} mm (${f((TRIM.w + 2 * BLEED) / (TRIM.h + 2 * BLEED), 4)}), within half a percent of it. So **the poster is fitted to the bleed height and centred, and only the bleed trims it**: nothing is cut from the top or the foot, and a sliver from each long side. R1's centred crop to a window is gone. No title is set over the art; every poster carries its own. No keyline or other furniture is drawn over it.`);
L.push('');
L.push('| Series | Poster (source px) | Drawn at | Trimmed by the bleed, each long side | Kept of the poster inside the bleed edge | Effective dpi | Code |');
L.push('|---|---|---|---|---:|---:|---|');
for (const p of posterChecks) {
  const q = qrResults.find((r) => r.slug === p.slug);
  L.push(`| ${p.title} | ${p.fit.posterW} × ${p.fit.posterH} | ${f(p.fit.drawnWmm)} × ${f(p.fit.drawnHmm)} mm | ${f(p.fit.trimmedEachSideMm, 3)} mm (${f(p.fit.trimmedEachSidePosterPx, 1)} poster px) | ${f(100 * (1 - (2 * p.fit.trimmedEachSidePosterPx) / p.fit.posterW), 1)}% | ${f(p.fit.effectiveDpi, 0)} | v${q.version}, ${f(q.sideMm)} mm, decodes to \`${q.text}\` |`);
}
L.push('');
L.push(`**Plates, chosen:** each corner index and the code sits on a small plate in **${PLATE.colour}** (the Series livery's own ground), with its marks and modules in **${PLATE.ink}** (the Series keyline). Corner radius ${PLATE.radiusMm} mm. The index plate pads the index by ${PLATE.padMm} mm: **${f(layouts.get(pictures[0].slug).boxes[0].x2 - layouts.get(pictures[0].slug).boxes[0].x1)} × ${f(layouts.get(pictures[0].slug).boxes[0].y2 - layouts.get(pictures[0].slug).boxes[0].y1)} mm**. The code's plate is its own quiet zone, ${QR.quietModules} modules wide: **${pictures.map((c) => `${f(qrResults.find((r) => r.slug === c.slug).sideMm)} mm`).join(' / ')}** square. It sits where the story cards' code sits, ${QR.bottomGapAboveIndexMm} mm above the bottom-right index plate.`);
L.push('');
L.push('### The posters\' own type against the safe line');
L.push('');
L.push(`The safe line is ${SAFE_MM} mm inside the trim. Each element's ink box is measured on the poster (\`cards/data/poster-type.json\` holds the method) and mapped through the card's fit. **Clearance is positive inside the safe line and negative outside it.** Nothing was cropped or moved to fix one. "Under a plate" means one of our plates covers part of that element.`);
L.push('');
L.push('| Series | Element | Box on the card (mm from trim) | Clearance to safe | Nearest side | Under a plate |');
L.push('|---|---|---|---:|---|---|');
for (const p of posterChecks) for (const e of p.type) L.push(`| ${p.title} | ${e.name} | ${f(e.box.x1)}–${f(e.box.x2)} × ${f(e.box.y1)}–${f(e.box.y2)} | ${e.clearance < 0 ? `**${f(e.clearance)} mm (outside)**` : `${f(e.clearance)} mm`} | ${e.side} | ${e.under.length ? `**${e.under.join(', ')}**` : 'no'} |`);
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
console.log(`sheet ${W}×${H}; ${deck.length} cards rendered and decoded; styles ${JSON.stringify(QR_STYLE)}; back symmetric ${symmetry.symmetric}`);
