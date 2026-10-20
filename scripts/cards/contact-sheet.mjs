// THE CARD CONTACT SHEET — gate 2 of Shorelines (CARDS-R1.3).
//
//   node --expose-gc scripts/cards/contact-sheet.mjs   # → cards/review/CONTACT-SHEET.png + MEASUREMENTS.md
//
// Renders EVERY card in cards/data/deck.json at 600 dpi with its code, decodes each code from
// that raster without trying the inverted image, and runs the collision assertion on each.
// That is the proof. The sheet shows the whole deck: every face (story cards, picture cards,
// the eight Endings and the Ring) and both backs; then a spread of faces with the trim, bleed,
// safe and index-region lines drawn; then details at 100%.
//
// READS: deck.json (the deck RATIFIED.md ratified), Ikenna's poster files in cards/posters/, and
// cards/Story-Island-icon.png.
// WRITES: cards/review/ and cards/data/qr-results.json only. Nothing is uploaded, and nothing
// is written to any database.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { registerFonts, descriptorLeading } from '../covers/render.mjs';
import { LIVERIES } from '../covers/liveries.mjs';
import { AUTHOR, BORDER, DESCRIPTOR, EYEBROW, FLEURON, FOOTER, RULE, STACK, TITLE } from '../covers/layout.mjs';
import {
  renderStoryFace, renderPictureFace, renderStoryBack, renderEndingFace, renderRingFace, renderEndingBack,
  isHalfTurnSymmetric, posterCrop, PICTURE_GEOMETRY, CODE_READ_MARGIN_MM, GRAIN_COUNT, CLEARANCE_MM, RING, BACK_RING,
} from './face.mjs';
import { decode, moduleMm } from './qr.mjs';
import {
  BLEED, DPI, ENDING, ENDINGS, GLYPH_MM, INDEX, INDEX_REGION_MM, KEYLINE,
  LIVERY_MARK, MM_PER_COVER_PX, MOTIFS, OPENING, PICTURE, PX_PER_MM, QR, RASTER, RULE_WIDTH_PX, SAFE_MM,
  STORY_BACK, TRIM, TYPE, LINE_FLOOR_PT, Y, mm, ptOf,
} from './geometry.mjs';
import { drawGlyph, glyphSVG, GLYPH_NAMES } from './glyphs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'cards/review');
const deck = JSON.parse(readFileSync(resolve(ROOT, 'cards/data/deck.json'), 'utf8'));
registerFonts();
const stories = deck.filter((c) => c.kind === 'story');
const pictures = deck.filter((c) => c.kind === 'picture');
// Each render's raster lives in native memory V8 does not see, so collect between cards where
// the runner allows it (run with node --expose-gc, as the usage line says).
const collect = () => globalThis.gc?.();

// ── POSTERS AND THE ICON ─────────────────────────────────────────────────────────────────
for (const c of pictures) {
  c.posterFile = PICTURE.posters[c.slug];
  if (!c.posterFile) throw new Error(`${c.slug}: no poster file named in geometry.mjs PICTURE.posters`);
  c.poster = await loadImage(readFileSync(resolve(ROOT, c.posterFile)));
}
const icon = await loadImage(readFileSync(resolve(ROOT, STORY_BACK.file)));

// ── PASS 1: EVERY CARD, WITH ITS CODE, DECODED ───────────────────────────────────────────
// A story card is tried 'direct' first: modules in the keyline colour on the ground as it is.
// Where that does not decode without inversion, it goes on the cream panel. The style a livery
// ends up with is reported, and must be the same for every card of that livery. A picture card's
// code sits straight on the mount.
const qrResults = [];
const styleByLivery = {};
const layouts = new Map();
for (const card of stories) {
  collect();
  const tried = [];
  let chosen = null;
  for (const style of ['direct', 'panel']) {
    const r = renderStoryFace(card, { qr: style });
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
for (const card of pictures) {
  collect();
  const r = renderPictureFace(card, { qr: true });
  const got = decode(r.codeImage);
  if (got !== r.layout.code.text) throw new Error(`${card.slug}: picture card code does not decode (${got})`);
  layouts.set(card.slug, r.layout);
  qrResults.push({ slug: card.slug, livery: 'series', text: r.layout.code.text, version: r.layout.code.version, modules: r.layout.code.modules, sideMm: r.layout.code.sideMm, style: 'mount', tried: [{ style: 'mount', decoded: 'yes' }] });
}
const breaks = stories.map((c) => ({ card: c, l: layouts.get(c.slug) })).filter((x) => x.l.descriptor && x.l.descriptor.lines.length > 1);

// ── THE SHEET ────────────────────────────────────────────────────────────────────────────
// Panel 1: the whole deck, in deck order (picture cards, then story cards by motif), then the
// eight Endings in ring order, the Ring, and the two backs. Each face is rendered, shrunk onto
// the sheet and dropped, so 64 full rasters are never held at once.
const ring = renderRingFace();
const ringPng = ring.png;
const back = renderEndingBack();
const symmetry = isHalfTurnSymmetric(back.imageData);
const backPng = back.png;
const storyBack = renderStoryBack(icon);
const storyBackPng = storyBack.png;
const tag = (c) => (c.kind === 'picture' ? 'PICTURE CARD' : LIVERIES[c.livery].name.toUpperCase());
const faceTiles = [
  ...deck.map((c) => ({
    render: () => (c.kind === 'picture' ? renderPictureFace(c, { qr: true }) : renderStoryFace(c, { qr: QR_STYLE[c.livery] })),
    label: c.title,
    sub: `${tag(c)} · ${c.motif}${c.kind === 'story' && layouts.get(c.slug).descriptor?.lines.length > 1 ? ' · descriptor on 2 lines' : ''}`,
  })),
  ...ENDINGS.map((e) => ({ render: () => renderEndingFace(e), label: e.name, sub: `ENDING · ${e.pair.join(' – ')}` })),
  { render: () => ({ png: ringPng }), label: 'The Ring', sub: 'RING · clockwise from the top' },
  { render: () => ({ png: backPng }), label: 'Ending back', sub: `ENDING + RING BACK · half-turn symmetric: ${symmetry.symmetric ? 'yes' : `NO (worst ${symmetry.worst})`}` },
  { render: () => ({ png: storyBackPng }), label: 'Story back', sub: `STORY BACK · ground ${storyBack.layout.ground.hex} to the bleed` },
];
const byLen = [...stories].sort((a, b) => a.title.length - b.title.length);
const longest = byLen[byLen.length - 1];
const guideCards = [
  ...pictures,
  stories.find((c) => c.slug === 'the-number-thirteen'),
  longest,
  stories.find((c) => c.livery === 'flash'),
  stories.find((c) => c.livery === 'poetry'),
  stories.find((c) => c.livery === 'inspiring'),
].filter((c, i, a) => c && a.findIndex((x) => x.slug === c.slug) === i);
const guideTiles = guideCards.map((c) => ({
  render: () => (c.kind === 'picture' ? renderPictureFace(c, { qr: true }) : renderStoryFace(c, { qr: QR_STYLE[c.livery] })),
  label: c.title,
  sub: `${tag(c)} · ${c.motif}${c === longest ? ` · longest title (${c.title.length} chars)` : ''}`,
}));

const S = 0.3;
const TW = Math.round(RASTER.w * S);
const TH = Math.round(RASTER.h * S);
const COLS = 8;
const GUT = 28;
const CAP = 76;
const HEAD = 150;
const panelH = (n) => Math.ceil(n / COLS) * (TH + CAP + GUT) + 80;
const DETAIL_H = 760;
const W = COLS * (TW + GUT) + GUT;
const P1 = HEAD;
const P2 = P1 + panelH(faceTiles.length) + 30;
const P3 = P2 + panelH(guideTiles.length) + 30;
const H = P3 + DETAIL_H;
const sheet = createCanvas(W, H);
const g = sheet.getContext('2d');
g.fillStyle = '#ECE8E0';
g.fillRect(0, 0, W, H);
const ink = '#1C1418';
const say = (t, x, y, font) => { g.fillStyle = ink; g.font = font; g.fillText(t, x, y); };
say('SHORELINES — CARD CONTACT SHEET (CARDS-R1.3, gate 2)', GUT, 64, '44px "Cormorant Garamond SemiBold"');
say(`Bridge ${TRIM.w} × ${TRIM.h} mm trim, ${BLEED} mm bleed, ${DPI} dpi; faces at ${Math.round(S * 100)}% of the print raster. The ratified deck: ${stories.length} story cards and ${pictures.length} picture cards, every code decoded; the ${ENDINGS.length} Endings, the Ring, and both backs. See MEASUREMENTS.md.`, GUT, 104, '24px "EB Garamond"');
say(`Panel 2: trim (cyan), bleed (magenta), safe ${SAFE_MM} mm (green) and the fan-index region (orange). Descriptors break as the covers' do (COVERS-R19/R20); picture cards are matted. Bottom strip: details at 100%.`, GUT, 136, '24px "EB Garamond"');

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

async function panel(top, title, tiles, guides) {
  say(title, GUT, top + 50, '34px "Cormorant Garamond SemiBold"');
  for (let i = 0; i < tiles.length; i++) {
    collect();
    const t = tiles[i];
    const x = GUT + (i % COLS) * (TW + GUT);
    const y = top + 80 + Math.floor(i / COLS) * (TH + CAP + GUT);
    g.drawImage(await loadImage(t.render().png), x, y, TW, TH);
    if (guides) drawGuides(x, y);
    say(t.label.length > 34 ? `${t.label.slice(0, 33)}…` : t.label, x, y + TH + 30, '22px "Cormorant Garamond SemiBold"');
    say(t.sub.length > 52 ? `${t.sub.slice(0, 51)}…` : t.sub, x, y + TH + 54, '17px "EB Garamond"');
  }
}
await panel(P1, `1 · Every face in the deck (${deck.length + ENDINGS.length + 1}) and both backs`, faceTiles, false);
await panel(P2, '2 · Guides: the three picture cards and a spread of story cards', guideTiles, true);

// ── DETAILS AT 100% ──────────────────────────────────────────────────────────────────────
const dTop = P3 + 10;
say('3 · Details at 100% of the 600-dpi raster', GUT, dTop + 40, '34px "Cormorant Garamond SemiBold"');
const dev = (m) => Math.round((BLEED + m) * PX_PER_MM);
const panelled = stories.find((c) => QR_STYLE[c.livery] === 'panel');
const picCard = pictures[0];
const crops = [];
for (const [card, what] of [[picCard, 'index (top left)'], [picCard, 'code'], [panelled, 'index (top left)'], [panelled, 'code']]) {
  collect();
  const r = card.kind === 'picture' ? renderPictureFace(card, { qr: true }) : renderStoryFace(card, { qr: QR_STYLE[card.livery] });
  const b = r.layout.boxes.find((x) => x.name === what);
  crops.push({ img: await loadImage(r.png), x: dev(b.x1) - 40, y: dev(b.y1) - 40, w: Math.round((b.x2 - b.x1) * PX_PER_MM) + 80, h: Math.round((b.y2 - b.y1) * PX_PER_MM) + 80, who: card.kind === 'picture' ? `${card.title} (matted)` : card.title, what });
}
let cx = GUT;
for (const c of crops) {
  g.drawImage(c.img, c.x, c.y, c.w, c.h, cx, dTop + 70, c.w, c.h);
  say(c.who.length > 22 ? `${c.who.slice(0, 21)}…` : c.who, cx, dTop + 70 + c.h + 28, '20px "EB Garamond"');
  say(c.what, cx, dTop + 70 + c.h + 52, '20px "EB Garamond"');
  cx += c.w + 60;
}
const gx0 = cx + 80;
say('The eight glyphs (6 mm, 0.15 mm stroke), at 2× the 600-dpi raster', gx0, dTop + 70 - 8, '20px "EB Garamond"');
GLYPH_NAMES.forEach((m, i) => {
  const size = GLYPH_MM * PX_PER_MM * 2;
  const x = gx0 + (i % 4) * (size + 60);
  const y = dTop + 80 + Math.floor(i / 4) * (size + 50);
  g.save(); g.lineWidth = 1; drawGlyph(g, m, x, y, size, ink); g.restore();
  say(m, x, y + size + 26, '20px "EB Garamond"');
});

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'CONTACT-SHEET.png'), sheet.toBuffer('image/png'));
mkdirSync(resolve(ROOT, 'cards/glyphs'), { recursive: true });
for (const m of GLYPH_NAMES) writeFileSync(resolve(ROOT, `cards/glyphs/${m.toLowerCase()}.svg`), glyphSVG(m));

// ── MEASUREMENTS.md ──────────────────────────────────────────────────────────────────────
const f = (v, d = 2) => Number(v).toFixed(d);
const L = [];
L.push('# Shorelines cards: measurements (CARDS-R1.3, gate 2)');
L.push('');
L.push('Generated by `scripts/cards/contact-sheet.mjs`. All positions are in mm from the **trim\'s** top-left corner. **D** marks a number derived from the cover. **C** marks a number chosen here. The deck is the one `cards/review/RATIFIED.md` ratified.');
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
L.push(`The descriptor is set at the cover's own scale at this width, ${DESCRIPTOR.size} cover px = **${f(ptOf(DESCRIPTOR.size), 2)} pt**, tracked at the cover's own ${DESCRIPTOR.tracking} cover px (${f(mm(DESCRIPTOR.tracking), 3)} mm) (R1.2). **Nothing on a face is smaller than the descriptor:** the eyebrow and the footer are raised to its size and no further, each keeping its tracking as a proportion of its size.`);
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
L.push(`**The smallest type on any face is ${f(ptOf(TYPE.descriptor.size), 2)} pt** (descriptor, eyebrow, footer, Ending names, Ring names).`);
L.push('');
const lead = descriptorLeading(createCanvas(10, 10).getContext('2d'));
L.push('### Descriptors that break: as on the covers');
L.push('');
L.push(`**The face draws the descriptor the cover plans** (COVERS-R19/R20, on main since 2b2a551f, merged into this branch): \`planCover\`'s descriptor lines, imported, with \`descriptorLeading()\` between them, also imported. A descriptor wider than the title's measure (${TITLE.maxWidth} cover px, ${f(mm(TITLE.maxWidth))} mm) breaks the way a title does, filling the first line. Size and tracking never change. The leading is cap height ${f(lead.cap, 1)} + word gap ${f(lead.gap, 1)} = **${f(lead.leading, 1)} cover px (${f(mm(lead.leading), 3)} mm)**. The LAST line takes the single line's place in the stack: it is the stack's foot, the baseline the fleuron's gap is measured from, with the earlier lines one leading apart above it. The stack makes room as the cover's does: one extra line adds one leading to the stack, which still sits at 20% of its slack, so its top rises by 20% of the leading (${f(mm(0.2 * lead.leading), 3)} mm) and its foot falls by 80% (${f(mm(0.8 * lead.leading), 3)} mm). The fleuron keeps its ${FLEURON.gapFraction * 100}% of the gap below the last line.`);
L.push('');
L.push(`**R1.2's exception is gone.** A descriptor must now clear the inner keyline by ${CLEARANCE_MM} mm like every other mark, or the render fails. Every one of the ${stories.length} story cards passes.`);
L.push('');
L.push(`**${breaks.length} of the ${stories.length} story cards break their descriptor**, all onto two lines, two words over the third:`);
L.push('');
L.push('| Card | Livery | One line (cover px, mm) | Now |');
L.push('|---|---|---:|---|');
for (const { card, l } of breaks.sort((a, b) => b.l.descriptor.width - a.l.descriptor.width)) L.push(`| ${card.title} | ${LIVERIES[card.livery].name} | ${f(l.descriptor.width, 1)} px, ${f(mm(l.descriptor.width))} mm | ${l.descriptor.lines.join(' / ')} |`);
L.push('');
L.push('## Corner indices');
L.push('');
L.push(`- **Region, chosen:** a fanned hand held in the left hand shows each card's left edge. The index sits in the top-left ${INDEX_REGION_MM.w} × ${INDEX_REGION_MM.h} mm of the trim, and its 180° twin in the bottom-right. Orange on panel 2.`);
L.push(`- **Glyph box:** ${f(INDEX.x)}–${f(INDEX.x + GLYPH_MM)} mm across, ${f(INDEX.y)}–${f(INDEX.y + GLYPH_MM)} mm down. That is ${f(INDEX.x - KEYLINE.innerInsetMm)} mm inside the inner keyline. The bottom-right twin's glyph box is ${f(TRIM.w - INDEX.x - GLYPH_MM)}–${f(TRIM.w - INDEX.x)} mm across, ${f(TRIM.h - INDEX.y - GLYPH_MM)}–${f(TRIM.h - INDEX.y)} mm down. C`);
L.push(`- **Livery mark (story cards):** ${INDEX.markPt} pt Cormorant 600, its cap top ${INDEX.markGapMm} mm under the glyph. Marks: ${Object.entries(LIVERY_MARK).filter(([k]) => k !== 'series').map(([k, v]) => `${LIVERIES[k].name} **${v}**`).join(' · ')}. C`);
L.push('- **The livery is carried by a letter, not by colour.** The three dark grounds (#080610, #3C101A, #102E26) will not separate in a fan, or for a colour-blind player. A picture card carries the glyph alone (below): the poster says Series. An Ending carries its two glyphs side by side, and the Ring carries the eight-point ring mark.');
L.push(`- **Collisions asserted on every rendered card:** no two marks within ${CLEARANCE_MM} mm of each other, and none outside the inner keyline less ${CLEARANCE_MM} mm (the safe line, on a picture card). All ${deck.length} deck cards, the ${ENDINGS.length} Endings, the Ring and its names pass. The render throws if any fail.`);
L.push('');
L.push('## The card code');
L.push('');
const sl = [...layouts.values()].find((l) => l.kind === 'story' && l.code);
const storyCodeY2 = sl.code.y1 + sl.code.sideMm;
L.push(`- **Story cards, placement:** the right side. **R1.3: the panel's right edge is on the bottom-right index glyph box's right edge, ${f(QR.rightMm)} mm** (${f(TRIM.w - QR.rightMm - KEYLINE.innerInsetMm)} mm inside the inner keyline; it was ${f(TRIM.w - KEYLINE.innerInsetMm - 1.0)} mm). Nothing else moved: the foot is ${QR.bottomGapAboveIndexMm} mm above the bottom-right index and never closer than 0.8 mm to the author line's ascenders, at **${f(storyCodeY2)} mm**. So a panel spans ${f(QR.rightMm)} mm less its side across, and ${f(storyCodeY2)} mm less its side down.`);
const sides = [...new Set(qrResults.filter((q) => q.livery !== 'series').map((q) => `v${q.version} ${f(q.sideMm)} mm`))];
L.push(`  - Story code sizes in the deck: ${sides.join(', ')}. For example a ${f(sl.code.sideMm)} mm panel spans ${f(sl.code.x1)}–${f(QR.rightMm)} mm × ${f(sl.code.y1)}–${f(storyCodeY2)} mm.`);
const G = PICTURE_GEOMETRY;
L.push(`- **Picture cards, placement:** centred across the card in the mount, its bottom on the safe line: ${f(G.code.x1)}–${f(G.code.x2)} mm × ${f(G.code.y1)}–${f(G.code.y2)} mm. Version ${PICTURE.qrVersion} on all three, so the three cards are identical in layout.`);
L.push(`- **Module:** ${QR.modulePx} device px = **${f(moduleMm, 3)} mm**, whole pixels at 600 dpi. Quiet zone ${QR.quietModules} modules (the spec). Error correction ${QR.ecc}.`);
L.push(`- **Decoder:** jsQR 1.4.0 with \`inversionAttempts: 'dontInvert'\`, run on the ${DPI}-dpi render as drawn: the code and ${CODE_READ_MARGIN_MM} mm of the face around it on every side (a full-raster read in @napi-rs/canvas 1.0.6 is never freed).`);
L.push(`- **Gold on a dark ground fails** without inversion, so **the dark liveries (Short Story, Flash Fiction, Inspiring) carry the code on a small cream panel** (${QR.panel}), with modules in the livery's own ground colour. **Poetry decodes directly**, modules in its keyline colour on its light ground. **Picture cards decode directly too**: maroon ${PICTURE.ink} modules straight on the cream mount ${PICTURE.mount}, no plate.`);
L.push('');
L.push('| Card | Livery | Style | Version | Modules | Module | Side (with quiet zone) | Decoded |');
L.push('|---|---|---|---:|---:|---:|---:|---|');
for (const q of qrResults) L.push(`| ${q.slug} | ${LIVERIES[q.livery].name} | ${q.style}${q.tried.length > 1 ? ' (direct: no)' : ''} | ${q.version} | ${q.modules} | ${f(moduleMm, 3)} mm | ${f(q.sideMm)} mm | yes, \`${q.text}\` |`);
L.push('');
L.push(`**Every one of the ${qrResults.length} codes decodes** from its 600-dpi render without inversion, and each decodes to its own URL.`);
L.push('');
L.push('## Picture cards: matted (R1.3)');
L.push('');
L.push(`**Ikenna's ruling:** each poster whole and untouched on the Series cream, with the index and the code in the mount. R1.2's frame-to-type fitting, its options A to D for Diary, and the picture-card plates are gone. One geometry for all three cards, derived in \`face.mjs\` (\`PICTURE_GEOMETRY\`):`);
L.push('');
L.push(`| | | |\n|---|---|---|`);
L.push(`| Mount | Series cream **${PICTURE.mount}**, out to the bleed | ruled |`);
L.push(`| Poster top | ${f(INDEX.y + GLYPH_MM)} mm (foot of the index glyph box) + ${CLEARANCE_MM} mm = **${f(G.poster.y1)} mm** | D |`);
L.push(`| Code | v${PICTURE.qrVersion}, **${f(G.code.side)} mm** with its quiet zone; bottom on the safe line, **${f(G.code.y1)}–${f(G.code.y2)} mm** down, **${f(G.code.x1)}–${f(G.code.x2)} mm** across | D |`);
L.push(`| Poster bottom | ${f(G.code.y1)} mm − ${CLEARANCE_MM} mm = **${f(G.poster.y2)} mm** | D |`);
L.push(`| Poster | **${f(G.posterW)} × ${f(G.posterH)} mm**, 2:3, centred: **${f(G.poster.x1)} mm** from each side (${f(G.poster.x1)}–${f(G.poster.x2)} mm) | D |`);
L.push(`| Index | the motif glyph alone in Series maroon ${PICTURE.ink}, at the standard glyph box, with its 180° twin; no plate, no livery mark | ruled |`);
L.push(`| Code ink | modules in Series maroon straight on the cream, no plate | ruled |`);
L.push('');
L.push('| Series | File | Pixels | Trimmed to 2:3 | Drawn at | Effective dpi |');
L.push('|---|---|---|---|---|---:|');
for (const c of pictures) {
  const fit = layouts.get(c.slug).fit;
  L.push(`| ${c.title} | \`${c.posterFile}\` | ${fit.posterW} × ${fit.posterH} | ${fit.crop.trimEachSidePx > 0 ? `**${f(fit.crop.trimEachSidePx, 2)} px from each side** → ${f(fit.crop.sw, 2)} × ${fit.crop.sh}` : 'already 2:3, nothing trimmed'} | ${f(fit.drawnWmm)} × ${f(fit.drawnHmm)} mm | **${f(fit.effectiveDpi, 0)}** |`);
}
L.push('');
L.push('**Beta Princess\'s trimmed strips** (columns 0–20 and 1385–1405 of `beta.jpeg`, the 20.33 px each side rounded out) are **plain near-black background**: mean luma 0.6 (left) and 0.4 (right) on 0–255, the brightest pixel 4 and 5, and not one pixel above 120 (the threshold the type was measured at in R1.2). Brightened four times, they show no type, no ornament and no part of the arch. Only background goes, as ruled.');
L.push('');
L.push('## Endings, the Ring, and the backs');
L.push('');
L.push(`- **Ending ground, chosen:** house umber **${ENDING.ground}** (the site's #2a2318), with furniture in display gold ${ENDING.keyline}. It is not a purple, and it is distinct from every story livery and from the story back's icon purple.`);
L.push(`- **Ending face:** eyebrow ENDING, the name as title on the cover's ladder, then the two glyphs with their names (${f(ptOf(TYPE.descriptor.size), 2)} pt, the descriptor's size) where the descriptor sits, the fleuron, and footer THE TURN. There is no author row. Its index is the two glyphs side by side.`);
L.push(`- **Ring:** glyphs on a ${RING.glyphRadiusMm} mm radius, clockwise from the top: ${MOTIFS.join(', ')}. Each Ending is named on a ${RING.nameRadiusMm} mm radius, between its two neighbours: two lines, running along the ring, and turned on the lower half to read from the foot. Eyebrow THE RING, footer THE TURN (C).`);
L.push(`- **Ending back (shared by the Ring):** eight points (${BACK_RING.dotMm} mm radius) on a ${BACK_RING.radiusMm} mm circle with a hairline, in display gold, centred on the Ending ground. Nothing comes within ${f(Math.min(TRIM.w, TRIM.h) / 2 - BACK_RING.radiusMm - BACK_RING.dotMm)} mm of the trim. No glow, and the grain is written in half-turn pairs. **Half-turn symmetry is checked pixel by pixel on the 600-dpi raster: ${symmetry.symmetric ? 'identical' : `NOT identical (worst ${symmetry.worst})`}.**`);
const sb = storyBack.layout;
L.push(`- **Story back:** Ikenna's \`${STORY_BACK.file}\`, ${sb.iconPx[0]} × ${sb.iconPx[1]} px, RGB, no alpha. Every one of its ${sb.ground.edgePixels.toLocaleString('en-GB')} edge pixels is **${sb.ground.hex}**, so the ground is flat and runs to the bleed with no tile edge (seam deviation on the render: ${sb.seamDeviation}). Centred at the card's width, ${f(sb.drawnMm[0])} × ${f(sb.drawnMm[1])} mm; **effective dpi ${f(sb.effectiveDpi, 0)}**.`);
L.push('');
L.push('## Ground treatment at card size');
L.push('');
L.push(`The glow and vignette keep their proportions to the trim and run on into the bleed. Their blur scales by width. The grain keeps the cover's coverage: ${GRAIN_COUNT.toLocaleString('en-GB')} specks over ${(RASTER.w * RASTER.h).toLocaleString('en-GB')} px (3.9%), drawn from the cover's slug-seeded stream (D).`);
L.push('');
writeFileSync(resolve(OUT, 'MEASUREMENTS.md'), `${L.join('\n')}\n`);
writeFileSync(resolve(ROOT, 'cards/data/qr-results.json'), `${JSON.stringify(qrResults, null, 1)}\n`);
console.log(`sheet ${W}×${H}; ${deck.length} cards rendered and decoded (${qrResults.length} codes); ${faceTiles.length} tiles in panel 1; descriptor breaks ${breaks.length}: ${breaks.map((b) => b.card.slug).join(', ')}; styles ${JSON.stringify(QR_STYLE)}; back symmetric ${symmetry.symmetric}`);
