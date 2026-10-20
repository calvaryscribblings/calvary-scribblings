// THE CARD CONTACT SHEET — gate 2 of CARDS-R1.
//
//   node scripts/cards/contact-sheet.mjs      # → cards/review/CONTACT-SHEET.png + MEASUREMENTS.md
//
// Renders EVERY card in cards/data/deck.json at 600 dpi with its code, decodes each code from
// that raster without trying the inverted image, and runs the collision assertion on each.
// That is the proof. The sheet itself shows a chosen selection, each face with and without its
// code, then the same faces again with the trim, bleed and safe lines drawn.
//
// READS: deck.json and, for the Series cards, each poster from its public Storage URL.
// WRITES: cards/review/ only. Nothing is uploaded, and nothing is written to any database.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { registerFonts } from '../covers/render.mjs';
import { LIVERIES } from '../covers/liveries.mjs';
import { AUTHOR, BORDER, DESCRIPTOR, EYEBROW, FLEURON, FOOTER, RULE, STACK, TITLE } from '../covers/layout.mjs';
import {
  renderStoryFace, renderEndingFace, renderRingFace, renderEndingBack, isHalfTurnSymmetric,
  GRAIN_COUNT, CLEARANCE_MM, FRAME, RING, BACK_RING,
} from './face.mjs';
import { decode, moduleMm } from './qr.mjs';
import {
  BLEED, CARD_H, DPI, ENDING, ENDINGS, GLYPH_MM, GLYPH_STROKE_MM, INDEX, INDEX_REGION_MM, KEYLINE,
  LIVERY_MARK, MM_PER_COVER_PX, OPENING, PX_PER_MM, QR, RASTER, RULE_WIDTH_PX, SAFE_MM, TRIM, TYPE,
  TYPE_FLOOR_PT, LINE_FLOOR_PT, Y, mm, ptOf,
} from './geometry.mjs';
import { glyphSVG, GLYPH_NAMES } from './glyphs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'cards/review');
const deck = JSON.parse(readFileSync(resolve(ROOT, 'cards/data/deck.json'), 'utf8'));
registerFonts();

// ── POSTERS ──────────────────────────────────────────────────────────────────────────────
const posters = new Map();
async function poster(url) {
  if (!posters.has(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`poster fetch failed: ${res.status}`);
    posters.set(url, await loadImage(Buffer.from(await res.arrayBuffer())));
  }
  return posters.get(url);
}
for (const c of deck) if (c.livery === 'series') c.poster = await poster(c.posterUrl);

// ── PASS 1: EVERY CARD, WITH ITS CODE, DECODED ───────────────────────────────────────────
// Each card is tried 'direct' first: modules in the keyline colour on the ground as it is.
// Where that does not decode without inversion, it goes on the cream panel. The style a
// livery ends up with is reported, and must be the same for every card of that livery.
const qrResults = [];
const styleByLivery = {};
const layouts = new Map();
for (const card of deck) {
  const tried = [];
  let chosen = null;
  for (const style of ['direct', 'panel']) {
    const r = renderStoryFace(card, { qr: style });
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

// ── THE SELECTION ────────────────────────────────────────────────────────────────────────
const byLen = [...deck].filter((c) => c.livery !== 'series').sort((a, b) => a.title.length - b.title.length);
const shortest = byLen[0];
const longest = byLen[byLen.length - 1];
const pick = (livery, not = []) => deck.find((c) => c.livery === livery && !not.includes(c.slug));
const chosenSlugs = [];
const add = (c, why) => { if (c && !chosenSlugs.some((x) => x.card.slug === c.slug)) chosenSlugs.push({ card: c, why }); };
add(longest, `LONGEST SELECTED TITLE (${longest.title.length} chars)`);
add(shortest, `SHORTEST SELECTED TITLE (${shortest.title.length} chars)`);
add(deck.find((c) => c.slug === 'brenda'), 'SHORT STORY');
add(deck.find((c) => c.slug === 'the-enabler'), 'FLASH FICTION');
add(pick('poetry'), 'POETRY — the deck\'s only poem');
add(deck.find((c) => c.slug === '7am-an-american-pulp-classic'), 'INSPIRING');
add(deck.find((c) => c.slug === 'miss-lady'), 'CALVARY BYLINE');
add(deck.find((c) => c.slug === 'diary-of-a-lagos-9-5er-i1'), 'SERIES — the picture card');
add(deck.find((c) => c.slug === 'beta-princess-i3'), 'SERIES — a second poster');

const tiles = [];
for (const { card, why } of chosenSlugs) {
  for (const qr of [QR_STYLE[card.livery], null]) {
    const r = renderStoryFace(card, { qr });
    tiles.push({ png: r.png, label: card.livery === 'series' ? `${card.seriesTitle}, ${card.instalmentTitle}` : card.title, sub: `${why} · ${card.motif}${qr ? ` · code ${qr}` : ' · no code'}`, layout: r.layout });
  }
}
const endingTiles = [ENDINGS[0], ENDINGS[6]].map((e) => ({ png: renderEndingFace(e).png, label: e.name, sub: `ENDING · ${e.pair.join(' – ')}` }));
const ring = renderRingFace();
const back = renderEndingBack();
const symmetry = isHalfTurnSymmetric(back.imageData);
tiles.push(...endingTiles,
  { png: ring.png, label: 'The Ring', sub: 'RING · clockwise from the top' },
  { png: back.png, label: 'Ending back', sub: `ENDING + RING BACK · half-turn symmetric: ${symmetry.symmetric ? 'yes' : `NO (worst ${symmetry.worst})`}` },
  { blocked: true, label: 'Story back', sub: 'BLOCKED — the app repo is not reachable from this Codespace' });

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
g.fillText('STORY ISLAND — CARD CONTACT SHEET (CARDS-R1, gate 2)', GUT, 64);
g.font = '24px "EB Garamond"';
g.fillText(`Bridge ${TRIM.w} × ${TRIM.h} mm trim, ${BLEED} mm bleed, ${DPI} dpi. Faces shown at ${Math.round(S * 100)}% of the print raster. Every deck card (${deck.length}) was rendered and its code decoded; see MEASUREMENTS.md. The story back is blocked: the app repo cannot be reached from here.`, GUT, 104);
g.fillText('Panel 1: the faces. Panel 2: the same faces with trim (cyan), bleed (magenta), safe 3 mm (green) and the chosen fan-index region (orange) drawn. Bottom strip: details at 100%.', GUT, 136);

const imgs = [];
for (const t of tiles) imgs.push(t.blocked ? null : await loadImage(t.png));

function drawGuides(x, y) {
  const s = PX_PER_MM * S;
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
    if (t.blocked) {
      g.fillStyle = '#D9D3C7'; g.fillRect(x, y, TW, TH);
      g.strokeStyle = '#9A2B2B'; g.lineWidth = 3; g.setLineDash([10, 8]); g.strokeRect(x + 2, y + 2, TW - 4, TH - 4); g.setLineDash([]);
      g.fillStyle = '#9A2B2B'; g.font = '26px "EB Garamond"';
      ['STORY BACK', 'NOT RENDERED', '', 'The icon master lives in', 'the app repository, which', 'this Codespace cannot reach.', '', 'Stopped at this item,', 'as the brief directs.'].forEach((l, k) => g.fillText(l, x + 24, y + 70 + k * 36));
    } else {
      g.drawImage(imgs[i], x, y, TW, TH);
      if (guides) drawGuides(x, y);
    }
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
const brenda = tiles.find((t) => t.layout?.slug === 'brenda' && t.layout.code);
const poem = tiles.find((t) => t.layout?.kind === 'story' && t.layout.slug === pick('poetry').slug && t.layout.code);
const series = tiles.find((t) => t.layout?.kind === 'series' && t.layout.code);
const dev = (m) => Math.round((BLEED + m) * PX_PER_MM);
for (const [t, what] of [[brenda, 'index (top left)'], [brenda, 'code'], [poem, 'code'], [series, 'index (top left)']]) {
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
L.push('# Story Island cards: measurements (CARDS-R1, gate 2)');
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
L.push(`| Eyebrow baseline | ${EYEBROW.y} px | ${f(mm(EYEBROW.y))} mm at cover size; at 6 pt its cap top is held, giving baseline ${f(tiles[0].layout.boxes.find((b) => b.name === 'eyebrow').y2)}* mm | D |`);
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
typeRow('Footer', 'EB Garamond', TYPE.footer);
typeRow('Author', 'Cormorant Italic', TYPE.author);
for (const r of TITLE.ladder) L.push(`| Title, ${r.size}-px rung | Cormorant 600 | ${r.size} | ${f(ptOf(r.size), 1)} pt | ${f(ptOf(r.size), 1)} pt | ${ptOf(r.size) < TYPE_FLOOR_PT ? '**FLAG**' : 'above the floor'} |`);
L.push(`| Index livery mark | Cormorant 600 | — | — | ${INDEX.markPt} pt | C |`);
L.push(`| Ending: glyph names | EB Garamond | — | — | ${TYPE_FLOOR_PT} pt | C, at the floor (the descriptor's row) |`);
L.push(`| Ring: Ending names | EB Garamond | — | — | ${TYPE_FLOOR_PT} pt, tracking stepped to ${f(ring.layout.tracking, 1)} px | C. Two lines (THE / name): one line runs to 22.8 mm against 15.4 mm of arc |`);
L.push('');
const descStepped = [...layouts.values()].filter((l) => l.descriptor?.stepped);
L.push(`**Descriptor at the floor:** at 6 pt, ${descStepped.length} of the ${deck.length} deck descriptors outran the ${f(mm(TITLE.maxWidth))} mm measure at the held tracking. Their tracking steps down, never their size, until they fit: ${descStepped.map((l) => `${l.slug} (${f(l.descriptor.tracking, 1)} px)`).join(', ') || 'none'}.`);
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
L.push(`- **Gold on a dark ground fails.** The modules are lighter than the ground, which is an inverted code, and the decoder does not try inversion. So **the dark liveries (Short Story, Flash Fiction, Inspiring) carry the code on a small cream panel** (${QR.panel}), with modules in the livery's own ground colour. **Poetry and Series decode directly**, with modules in their keyline colour on their light ground and no panel.`);
L.push('');
L.push('| Card | Livery | Style | Version | Modules | Module | Side (with quiet zone) | Decoded |');
L.push('|---|---|---|---:|---:|---:|---:|---|');
for (const q of qrResults) L.push(`| ${q.slug} | ${LIVERIES[q.livery].name} | ${q.style}${q.tried.length > 1 ? ' (direct: no)' : ''} | ${q.version} | ${q.modules} | ${f(moduleMm, 3)} mm | ${f(q.sideMm)} mm | yes, \`${q.text}\` |`);
L.push('');
L.push(`**Every one of the ${qrResults.length} codes decodes** from its 600-dpi render without inversion, and each decodes to its own URL.`);
L.push('');
L.push('## Series cards: the artwork crop');
L.push('');
L.push('The picture card keeps the Series livery\'s frame, eyebrow, author and footer (INSTALMENT n), as the cover built them. The artwork takes the title block\'s place, in a window as wide as the title measure. The window runs from 1 mm under the index down to the series title, which is set beneath it on the cover\'s ladder from the 112-px rung down (C). The fleuron gives its room to the art (C). The crop is a centred "cover" fit.');
L.push('');
L.push('| Card | Poster (source px) | Window (mm) | Crop kept (source px) | Kept | Effective dpi |');
L.push('|---|---|---|---|---:|---:|');
for (const c of deck.filter((x) => x.livery === 'series')) {
  const l = layouts.get(c.slug);
  const k = l.crop;
  L.push(`| ${c.seriesTitle}, ${c.instalmentTitle} | ${k.imgW} × ${k.imgH} | ${f(l.window.x2 - l.window.x1)} × ${f(l.window.y2 - l.window.y1)} | x ${Math.round(k.sx)}–${Math.round(k.sx + k.sw)}, y ${Math.round(k.sy)}–${Math.round(k.sy + k.sh)} | ${f(k.keptFraction * 100, 0)}% | ${f(k.effectiveDpi, 0)}${k.effectiveDpi < 300 ? ' **FLAG < 300**' : ''} |`);
}
L.push('');
L.push('## Endings, the Ring, and the backs');
L.push('');
L.push(`- **Ending ground, chosen:** house umber **${ENDING.ground}** (the site's #2a2318), with furniture in display gold ${ENDING.keyline}. It is not a purple, and it is distinct from every story livery and from the story back's icon purple.`);
L.push('- **Ending face:** eyebrow ENDING, the name as title on the cover\'s ladder, then the two glyphs with their names (6 pt) where the descriptor sits, the fleuron, and footer THE TURN. There is no author row. Its index is the two glyphs side by side.');
L.push(`- **Ring:** glyphs on a ${RING.glyphRadiusMm} mm radius, clockwise from the top: Letter, Secret, Child, Storm, Road, House, Debt, Fire. Each Ending is named on a ${RING.nameRadiusMm} mm radius, between its two neighbours: two lines, running along the ring, and turned on the lower half to read from the foot. Eyebrow THE RING, footer THE TURN (C).`);
L.push(`- **Ending back (shared by the Ring):** eight points (${BACK_RING.dotMm} mm radius) on a ${BACK_RING.radiusMm} mm circle with a hairline, in display gold, centred on the Ending ground. Nothing comes within ${f(Math.min(TRIM.w, TRIM.h) / 2 - BACK_RING.radiusMm - BACK_RING.dotMm)} mm of the trim. No glow, and the grain is written in half-turn pairs. **Half-turn symmetry is checked pixel by pixel on the 600-dpi raster: ${symmetry.symmetric ? 'identical' : `NOT identical (worst ${symmetry.worst})`}.**`);
L.push('- **Story back: NOT BUILT. Stopped at this item.** The brief sources it from the app repo\'s icon master. This Codespace\'s GitHub token sees only `calvaryscribblings/calvary-scribblings`, and the app repository is not on disk (see CLAUDE.md). So the icon\'s pixel size and its effective dpi cannot be reported, and its purple cannot be sampled. A placeholder sits in its slot on the sheet.');
L.push('');
L.push('## Ground treatment at card size');
L.push('');
L.push(`The glow and vignette keep their proportions to the trim and run on into the bleed. Their blur scales by width. The grain keeps the cover's coverage: ${GRAIN_COUNT.toLocaleString('en-GB')} specks over ${(RASTER.w * RASTER.h).toLocaleString('en-GB')} px (3.9%), drawn from the cover's slug-seeded stream (D).`);
L.push('');
writeFileSync(resolve(OUT, 'MEASUREMENTS.md'), `${L.join('\n')}\n`);
writeFileSync(resolve(ROOT, 'cards/data/qr-results.json'), `${JSON.stringify(qrResults, null, 1)}\n`);
console.log(`sheet ${W}×${H}; ${deck.length} cards rendered and decoded; styles ${JSON.stringify(QR_STYLE)}; back symmetric ${symmetry.symmetric}`);
