// THE MAKEPLAYINGCARDS UPLOAD SET — Shorelines, one playtest deck (CARDS-R2).
//
//   node --expose-gc scripts/cards/mpc-export.mjs
//     → cards/print/mpc-playtest/*.jpg + shorelines-playtest-1.zip   (git-ignored: delivered privately)
//     → cards/print/mpc-playtest/MANIFEST.md                         (committed)
//     → cards/review/MPC-PROOF.png                                   (committed)
//
// AN EXPORT, NOT A REDESIGN. The approved design (cards/review/SIGNOFF.md) is drawn unchanged on
// MPC's canvas: face.mjs useCanvas() keeps the 57 × 89 mm trim at its size, centres it, and lets
// the bleed run out to fill the canvas. Nothing is rescaled.
//
// MPC's numbers, from its own pages (checked 20 Oct 2026): "Custom Bridge Size Cards",
// PC1201C26-22, 2.25" × 3.5"; "the minimum image upload size requirements are 747 x 1122 pixels
// (300DPI)"; "36 pixels cut off each side"; a safe area "36 pixels each side". At 600 dpi:
// 1494 × 2244 px, 72 px of bleed and 72 px of safe margin, all derived below from those.
//
// READ-ONLY against the database: each card's printed fields (title, author, subcategory,
// descriptor) are re-read over the public REST endpoint and rendered as they stand now. The deck
// and its motifs stay as ratified. Nothing is written to any database or uploaded anywhere.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { registerFonts } from '../covers/render.mjs';
import { LIVERIES } from '../covers/liveries.mjs';
import {
  useCanvas, renderStoryFace, renderPictureFace, renderStoryBack, renderEndingFace, renderRingFace,
  renderEndingBack, isHalfTurnSymmetric, sampleIconGround, CODE_READ_MARGIN_MM,
} from './face.mjs';
import { decode } from './qr.mjs';
import { DPI, ENDINGS, KEYLINE, PICTURE, PX_PER_MM, SAFE_MM, STORY_BACK, TRIM } from './geometry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'cards/print/mpc-playtest');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const collect = () => globalThis.gc?.();
registerFonts();

// ── MPC'S CANVAS ─────────────────────────────────────────────────────────────────────────
const MPC = (() => {
  const at300 = { w: 747, h: 1122, bleed: 36, safe: 36 };   // MPC's FAQ and product page
  const k = DPI / 300;
  const w = at300.w * k;
  const h = at300.h * k;
  const bleed = at300.bleed * k;
  const safe = at300.safe * k;
  const trim = { w: (w - 2 * bleed) / PX_PER_MM, h: (h - 2 * bleed) / PX_PER_MM };   // 57.15 × 88.90 mm
  // MPC's trim in the DESIGN's trim coordinates (mm from the design trim's top-left): both are
  // centred on the canvas, so MPC's is offset by half the difference each way.
  const dx = (TRIM.w - trim.w) / 2;
  const dy = (TRIM.h - trim.h) / 2;
  const safeMm = safe / PX_PER_MM;
  return Object.freeze({
    name: 'mpc-bridge', w, h, bleed, safe, trim, safeMm,
    cut: { x1: dx, y1: dy, x2: TRIM.w - dx, y2: TRIM.h - dy },
    safeBox: { x1: dx + safeMm, y1: dy + safeMm, x2: TRIM.w - dx - safeMm, y2: TRIM.h - dy - safeMm },
  });
})();
if (MPC.w !== 1494 || MPC.h !== 2244) throw new Error(`MPC canvas is ${MPC.w} × ${MPC.h}, not 1494 × 2244`);

// ── THE DECK, WITH ITS PRINTED FIELDS RE-READ ────────────────────────────────────────────
const deck = JSON.parse(readFileSync(resolve(ROOT, 'cards/data/deck.json'), 'utf8'));
const getJSON = async (p) => { const r = await fetch(`${DB}/${p}.json`); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
const live = await getJSON('cms_stories');
const series = await getJSON('series');
const refreshed = [];
for (const c of deck) {
  const src = c.kind === 'picture' ? series[c.seriesId] : live[c.slug];
  if (!src) throw new Error(`${c.slug}: no live record`);
  if (c.kind === 'story' && !src.published) throw new Error(`${c.slug}: no longer published`);
  for (const k of c.kind === 'picture' ? ['title', 'author'] : ['title', 'author', 'subcategory', 'descriptor']) {
    const now = src[k] ?? (k === 'descriptor' ? null : '');
    const was = c[k] ?? (k === 'descriptor' ? null : '');
    if (now !== was) { refreshed.push({ slug: c.slug, field: k, was, now }); c[k] = now; }
  }
  if (c.kind === 'story' && typeof src.descriptorPending === 'string') refreshed.push({ slug: c.slug, field: 'descriptorPending (not printed)', was: '', now: src.descriptorPending });
}
const pictures = deck.filter((c) => c.kind === 'picture');
for (const c of pictures) c.poster = await loadImage(readFileSync(resolve(ROOT, PICTURE.posters[c.slug])));

// ── RENDER, EXPORT, DECODE ───────────────────────────────────────────────────────────────
useCanvas({ name: MPC.name, w: MPC.w, h: MPC.h });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const QR_STYLE = { short: 'panel', flash: 'panel', inspiring: 'panel', poetry: 'direct' };   // as decided on the approved sheet
const JPEG = { quality: 95, chromaSubsampling: '4:4:4' };
async function exportJpeg(png, file) {
  const jpg = await sharp(png).removeAlpha().withIccProfile('srgb').withMetadata({ density: DPI }).jpeg(JPEG).toBuffer();
  writeFileSync(resolve(OUT, file), jpg);
  const [a, b] = await Promise.all([sharp(png).removeAlpha().raw().toBuffer(), sharp(jpg).raw().toBuffer()]);
  if (a.length !== b.length) throw new Error(`${file}: decoded size differs`);
  let worst = 0; let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > worst) worst = d; sum += d; }
  const meta = await sharp(jpg).metadata();
  return { file, bytes: jpg.length, worst, mean: sum / a.length, jpg, meta };
}
const devX = (mmv) => MPC.w / 2 + (mmv - TRIM.w / 2) * PX_PER_MM;
const devY = (mmv) => MPC.h / 2 + (mmv - TRIM.h / 2) * PX_PER_MM;
async function decodeJpeg(jpg, box) {
  const left = Math.max(0, Math.floor(devX(box.x1 - CODE_READ_MARGIN_MM)));
  const top = Math.max(0, Math.floor(devY(box.y1 - CODE_READ_MARGIN_MM)));
  const width = Math.min(MPC.w, Math.ceil(devX(box.x2 + CODE_READ_MARGIN_MM))) - left;
  const height = Math.min(MPC.h, Math.ceil(devY(box.y2 + CODE_READ_MARGIN_MM))) - top;
  const { data, info } = await sharp(jpg).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return decode({ data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height });
}

const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fronts = [
  ...deck.map((c) => ({ card: c, slug: c.slug, title: c.title, motif: c.motif, livery: c.kind === 'picture' ? 'Series (picture card)' : LIVERIES[c.livery].name, back: 'back-story.jpg', url: c.url })),
  ...ENDINGS.map((e) => ({ ending: e, slug: `ending-${kebab(e.name.replace(/^THE /, ''))}`, title: e.name, motif: e.pair.join(' – '), livery: 'Ending', back: 'back-ending.jpg', url: null })),
  { ring: true, slug: 'the-ring', title: 'The Ring', motif: 'all eight', livery: 'Ring', back: 'back-ending.jpg', url: null },
];
const rows = [];
for (let i = 0; i < fronts.length; i++) {
  collect();
  const f = fronts[i];
  f.slot = String(i + 1).padStart(2, '0');
  f.file = `${f.slot}-front-${f.slug}.jpg`;
  const r = f.card
    ? (f.card.kind === 'picture' ? renderPictureFace(f.card, { qr: true }) : renderStoryFace(f.card, { qr: QR_STYLE[f.card.livery] }))
    : f.ending ? renderEndingFace(f.ending) : renderRingFace();
  const ex = await exportJpeg(r.png, f.file);
  const row = { ...f, ...ex, boxes: r.layout.boxes, png: null };
  delete row.jpg;
  if (r.layout.code) {
    const b = r.layout.boxes.find((x) => x.name === 'code');
    const got = await decodeJpeg(ex.jpg, b);
    row.decoded = got;
    row.codeText = r.layout.code.text;
    if (got !== r.layout.code.text) throw new Error(`${f.file}: the code does not decode from the JPEG (${got})`);
    // whole device pixels: the code's top-left, as drawn, on the integer grid
    row.codeOffsetPx = { x: devX(b.x1) - Math.round(devX(b.x1)), y: devY(b.y1) - Math.round(devY(b.y1)) };
  }
  if (f.card?.kind === 'story' && r.layout.descriptor) row.descriptorLines = r.layout.descriptor.lines.length;
  if (i === 3) row.keepJpg = ex.jpg;   // the first story card, for the proof's details
  rows.push(row);
}
// the backs
const icon = await loadImage(readFileSync(resolve(ROOT, STORY_BACK.file)));
const sb = renderStoryBack(icon);
const backStory = await exportJpeg(sb.png, 'back-story.jpg');
const eb = renderEndingBack();
const symmetric = isHalfTurnSymmetric(eb.imageData);
if (!symmetric.symmetric) throw new Error(`the Ending back is not half-turn symmetric on MPC's canvas (worst ${symmetric.worst})`);
const backEnding = await exportJpeg(eb.png, 'back-ending.jpg');
const jpgSym = await (async () => {
  const { data, info } = await sharp(backEnding.jpg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return isHalfTurnSymmetric({ data, width: info.width, height: info.height });
})();
useCanvas(null);

// ── WHAT FALLS INSIDE MPC'S SAFE MARGIN ──────────────────────────────────────────────────
// Every registered mark on every front, against MPC's safe area (36 px at 300 dpi inside MPC's
// own trim). Positive is inside the safe area; negative is how far into the margin it reaches.
const inMargin = [];
const S = MPC.safeBox;
for (const r of rows) {
  for (const b of r.boxes) {
    const d = Math.min(b.x1 - S.x1, S.x2 - b.x2, b.y1 - S.y1, S.y2 - b.y2);
    if (d < 0) inMargin.push({ file: r.file, element: b.name, by: -d, side: [['left', b.x1 - S.x1], ['right', S.x2 - b.x2], ['top', b.y1 - S.y1], ['bottom', S.y2 - b.y2]].sort((p, q) => p[1] - q[1])[0][0] });
  }
}
// Marks that are not boxes: the keylines on every story, Ending and Ring face, and the story
// back's mark (the icon's own ground is the back's flat ground, so only its non-ground pixels
// count).
const keylineClear = Math.min(KEYLINE.outerInsetMm - S.x1, KEYLINE.outerInsetMm - S.y1);
const ground = sampleIconGround(icon);
const iconMark = await (async () => {
  const { data, info } = await sharp(readFileSync(resolve(ROOT, STORY_BACK.file))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let x1 = info.width; let y1 = info.height; let x2 = -1; let y2 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const o = (y * info.width + x) * 3;
    if (data[o] !== ground.rgb[0] || data[o + 1] !== ground.rgb[1] || data[o + 2] !== ground.rgb[2]) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  }
  const s = STORY_BACK.widthMm / info.width;
  const top = (TRIM.h - info.height * s) / 2;
  return { x1: x1 * s, x2: (x2 + 1) * s, y1: top + y1 * s, y2: top + (y2 + 1) * s };
})();
const iconClear = Math.min(iconMark.x1 - S.x1, S.x2 - iconMark.x2, iconMark.y1 - S.y1, S.y2 - iconMark.y2);

// ── THE MANIFEST ─────────────────────────────────────────────────────────────────────────
const f2 = (v, d = 2) => Number(v).toFixed(d);
const all = [...rows, backStory, backEnding];
const total = all.reduce((a, r) => a + r.bytes, 0);
const worst = all.reduce((a, r) => (r.worst > a.worst ? r : a), { worst: -1 });
const M = [];
M.push('# Shorelines — MakePlayingCards upload set: playtest deck 1 (CARDS-R2)');
M.push('');
M.push('The deck `cards/review/RATIFIED.md` ratified, in the design `cards/review/SIGNOFF.md` approved, exported for one MakePlayingCards playtest deck. **The images are not in git.** They are in the zip attached to the draft release `shorelines-playtest-1`, visible only to people with push access. Generated by `scripts/cards/mpc-export.mjs`.');
M.push('');
M.push('## The product and the canvas');
M.push('');
M.push(`- **MPC "Custom Bridge Size Cards", product code PC1201C26-22**, 2.25 × 3.5 in, each card with its own front and back. Checked on MPC's own pages, 20 Oct 2026: "the minimum image upload size requirements are 747 x 1122 pixels (300DPI)", "36 pixels cut off each side", a safe area of "36 pixels each side". (The product page's description also says "56mm x 88mm"; its specifications say 57 × 89 mm and 2.25" × 3.5". The upload numbers are the inch ones.)`);
M.push(`- **Upload canvas: ${MPC.w} × ${MPC.h} px at ${DPI} dpi** (MPC's 747 × 1122 at 300 dpi, doubled). MPC's bleed ${MPC.bleed} px and safe margin ${MPC.safe} px (${f2(MPC.safeMm, 3)} mm); MPC's trim ${f2(MPC.trim.w)} × ${f2(MPC.trim.h)} mm.`);
M.push(`- **The design is not rescaled.** Its ${TRIM.w} × ${TRIM.h} mm trim is centred on the canvas, and the bleed runs out to fill it: the ground, glow and grain carry on, as does the picture cards' mount. MPC's cut is ${f2(-MPC.cut.x1, 3)} mm outside the design's trim at each side and ${f2(MPC.cut.y1, 3)} mm inside it at the top and bottom.`);
M.push(`- **Export:** JPEG, quality ${JPEG.quality}, chroma ${JPEG.chromaSubsampling} (no subsampling), an embedded sRGB profile, ${DPI} dpi in the metadata.`);
M.push('');
M.push(`## The ${rows.length} cards`);
M.push('');
M.push(`**${rows.length} cards: ${rows.filter((r) => r.back === 'back-story.jpg').length} on the story back** (${deck.filter((c) => c.kind === 'picture').length} picture cards and ${deck.filter((c) => c.kind === 'story').length} story cards) **and ${rows.filter((r) => r.back === 'back-ending.jpg').length} on the Ending back** (the ${ENDINGS.length} Endings and the Ring). Order: the picture cards, then the story cards by motif in Ring order (Letter to Grave), then the Endings in Ring order, then the Ring.`);
M.push('');
M.push('| Slot | Front | Back | Title | Motif | Livery | Code |');
M.push('|---:|---|---|---|---|---|---|');
for (const r of rows) M.push(`| ${r.slot} | \`${r.file}\` | \`${r.back}\` | ${String(r.title).replace(/\|/g, '\\|')} | ${r.motif} | ${r.livery} | ${r.url ? `\`${r.codeText}\`` : '—'} |`);
M.push('');
M.push(`Backs: \`back-story.jpg\` (Ikenna's icon on its own ground, ${ground.hex}) and \`back-ending.jpg\` (the Ring as eight points on the Ending ground). The Ending back is half-turn symmetric pixel for pixel on MPC's canvas, as rendered (worst ${symmetric.worst}); after JPEG compression the worst difference between a pixel and its half-turn partner is ${jpgSym.worst}/255.`);
M.push('');
M.push('## Checks on the exported files');
M.push('');
M.push(`- **Every code decodes from its exported JPEG**, without inversion, to its own URL: ${rows.filter((r) => r.decoded).length} of ${rows.filter((r) => r.url).length} (${rows.filter((r) => r.decoded && r.card?.kind === 'picture').length} picture cards, ${rows.filter((r) => r.decoded && r.card?.kind === 'story').length} story cards).`);
M.push(`- **Code modules sit on whole device pixels** on the new canvas: each code's top-left is snapped to the pixel grid as it is drawn (the largest snap was ${f2(Math.max(...rows.filter((r) => r.codeOffsetPx).map((r) => Math.max(Math.abs(r.codeOffsetPx.x), Math.abs(r.codeOffsetPx.y)))), 2)} px, ${f2(Math.max(...rows.filter((r) => r.codeOffsetPx).map((r) => Math.max(Math.abs(r.codeOffsetPx.x), Math.abs(r.codeOffsetPx.y)))) / PX_PER_MM, 3)} mm), and every module is ${6} px square.`);
M.push(`- **JPEG against its lossless render:** worst single-channel difference **${worst.worst}/255** (${worst.file}); the mean absolute difference over all ${all.length} images is at most ${f2(Math.max(...all.map((r) => r.mean)), 3)}/255.`);
M.push(`- **Total size: ${f2(total / 1e6, 1)} MB** for ${all.length} images.`);
M.push('');
M.push('## What falls inside MPC\'s safe margin');
M.push('');
M.push(`MPC's safe area is ${f2(MPC.safeMm, 3)} mm inside MPC's trim: in the design's coordinates, ${f2(S.x1, 3)}–${f2(S.x2, 3)} mm across and ${f2(S.y1, 3)}–${f2(S.y2, 3)} mm down. Every registered mark on every front was measured against it. **Nothing was moved.**`);
M.push('');
if (inMargin.length) {
  M.push('| Front | Element | Into the margin by | Side |');
  M.push('|---|---|---:|---|');
  for (const e of inMargin) M.push(`| \`${e.file}\` | ${e.element} | ${f2(e.by, 3)} mm | ${e.side} |`);
} else M.push('Nothing.');
M.push('');
M.push(`Not boxes, measured separately: the outer keyline (${f2(KEYLINE.outerInsetMm)} mm from the design trim) is ${f2(keylineClear, 3)} mm inside MPC's safe area; the story back's mark is ${f2(iconClear, 3)} mm inside it (the rest of the icon is the back's own flat ground); the Ending back's ring is ${f2(Math.min(TRIM.w, TRIM.h) / 2 - 13 - 1.1, 2)} mm from the trim.`);
M.push('');
if (refreshed.length) {
  M.push('## Printed fields refreshed from the database');
  M.push('');
  M.push('Read-only, at export. The deck and its motifs are as ratified; these are the printed fields as they stand now.');
  M.push('');
  M.push('| Card | Field | In deck.json | Printed |');
  M.push('|---|---|---|---|');
  for (const r of refreshed) M.push(`| ${r.slug} | ${r.field} | ${JSON.stringify(r.was)} | ${JSON.stringify(r.now)} |`);
  M.push('');
}
writeFileSync(resolve(OUT, 'MANIFEST.md'), `${M.join('\n')}\n`);

// ── THE ZIP ──────────────────────────────────────────────────────────────────────────────
const zipName = 'shorelines-playtest-1.zip';
rmSync(resolve(OUT, zipName), { force: true });
execFileSync('zip', ['-X', '-q', zipName, 'MANIFEST.md', 'back-story.jpg', 'back-ending.jpg', ...rows.map((r) => r.file)], { cwd: OUT });
const zipBytes = readFileSync(resolve(OUT, zipName));
const zipSha = createHash('sha256').update(zipBytes).digest('hex');

// ── THE PROOF ────────────────────────────────────────────────────────────────────────────
// Every upload image as exported (decoded from the JPEG), at 30%, with MPC's trim (cyan) and
// safe area (green) drawn; then 100% details, from the JPEGs, of one code and one descriptor.
const P = 0.3;
const TW = Math.round(MPC.w * P);
const TH = Math.round(MPC.h * P);
const COLS = 8; const GUT = 28; const CAP = 60; const HEAD = 140;
const files = [...rows.map((r) => ({ file: r.file, label: `${r.slot} ${r.title}` })), { file: 'back-story.jpg', label: 'back-story' }, { file: 'back-ending.jpg', label: 'back-ending' }];
const gridH = Math.ceil(files.length / COLS) * (TH + CAP + GUT);
const DET = 620;
const W = COLS * (TW + GUT) + GUT;
const H = HEAD + gridH + DET;
const sheet = createCanvas(W, H);
const g = sheet.getContext('2d');
g.fillStyle = '#ECE8E0'; g.fillRect(0, 0, W, H);
const say = (t, x, y, font) => { g.fillStyle = '#1C1418'; g.font = font; g.fillText(t, x, y); };
say('SHORELINES — MPC UPLOAD PROOF (CARDS-R2), decoded from the exported JPEGs', GUT, 60, '42px "Cormorant Garamond SemiBold"');
say(`${files.length} images, ${MPC.w} × ${MPC.h} px at ${DPI} dpi, shown at ${P * 100}%. Cyan: MPC's trim (${f2(MPC.trim.w)} × ${f2(MPC.trim.h)} mm). Green dashed: MPC's safe area (${MPC.safe} px inside it). Bottom: 100% details from the JPEGs.`, GUT, 104, '24px "EB Garamond"');
for (let i = 0; i < files.length; i++) {
  collect();
  const x = GUT + (i % COLS) * (TW + GUT);
  const y = HEAD + Math.floor(i / COLS) * (TH + CAP + GUT);
  g.drawImage(await loadImage(readFileSync(resolve(OUT, files[i].file))), x, y, TW, TH);
  g.save(); g.lineWidth = 2;
  g.strokeStyle = '#12B5CB'; g.strokeRect(x + MPC.bleed * P, y + MPC.bleed * P, (MPC.w - 2 * MPC.bleed) * P, (MPC.h - 2 * MPC.bleed) * P);
  g.strokeStyle = '#2E9E44'; g.setLineDash([6, 5]);
  g.strokeRect(x + (MPC.bleed + MPC.safe) * P, y + (MPC.bleed + MPC.safe) * P, (MPC.w - 2 * (MPC.bleed + MPC.safe)) * P, (MPC.h - 2 * (MPC.bleed + MPC.safe)) * P);
  g.restore();
  say(files[i].label.length > 36 ? `${files[i].label.slice(0, 35)}…` : files[i].label, x, y + TH + 28, '20px "EB Garamond"');
}
const dTop = HEAD + gridH + 20;
say('100% details, from the JPEGs', GUT, dTop + 30, '32px "Cormorant Garamond SemiBold"');
const detailCard = rows.find((r) => r.keepJpg);
const dImg = await loadImage(detailCard.keepJpg);
const cb = detailCard.boxes.find((b) => b.name === 'code');
const db = detailCard.boxes.find((b) => /^descriptor/.test(b.name));
let cx = GUT;
for (const [b, what] of [[cb, 'code'], [db, 'descriptor (5.45 pt)']]) {
  const sx = Math.floor(devX(b.x1)) - 30; const sy = Math.floor(devY(b.y1)) - 30;
  const sw = Math.ceil((b.x2 - b.x1) * PX_PER_MM) + 60; const sh = Math.ceil((b.y2 - b.y1) * PX_PER_MM) + 60;
  g.drawImage(dImg, sx, sy, sw, sh, cx, dTop + 60, sw, sh);
  say(`${detailCard.title} — ${what}`, cx, dTop + 60 + sh + 30, '20px "EB Garamond"');
  cx += sw + 60;
}
writeFileSync(resolve(ROOT, 'cards/review/MPC-PROOF.png'), sheet.toBuffer('image/png'));

console.log(JSON.stringify({
  canvas: `${MPC.w}x${MPC.h}`, mpcTrimMm: [f2(MPC.trim.w, 3), f2(MPC.trim.h, 3)], cut: MPC.cut, safeBox: S,
  refreshed, fronts: rows.length, decoded: rows.filter((r) => r.decoded).length, withCodes: rows.filter((r) => r.url).length,
  inMargin, keylineClear, iconClear, endingBackSymmetric: symmetric, endingBackJpgWorst: jpgSym.worst,
  worstJpeg: { file: worst.file, worst: worst.worst }, maxMean: Math.max(...all.map((r) => r.mean)), totalBytes: total,
  jpegMeta: { space: backStory.meta.space, density: backStory.meta.density, icc: !!backStory.meta.icc, chroma: backStory.meta.chromaSubsampling },
  zip: { bytes: statSync(resolve(OUT, zipName)).size, sha256: zipSha },
}, null, 1));
