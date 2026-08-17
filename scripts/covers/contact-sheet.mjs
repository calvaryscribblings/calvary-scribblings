// THE CONTACT SHEET — the artefact the migration is gated on.
//
//   node scripts/covers/contact-sheet.mjs                 # → covers-contact-sheet/
//   node scripts/covers/contact-sheet.mjs --out <dir>
//
// NOTHING HERE WRITES TO FIREBASE OR TOUCHES A LIVE COVER URL. It reads published records,
// renders to a local directory, and stops. That is the whole point of the gate: the sheet
// exists so a human can look at sixteen covers and say yes or no BEFORE any story's cover
// pointer moves. See scripts/covers/migrate.mjs, which refuses to run without a signed-off
// manifest.
//
// ── WHY THESE SIXTEEN ────────────────────────────────────────────────────────────────────
// Fourteen are real published records read live from cms_stories — same title, same author,
// same category, same subcategory the site is serving right now — so the sheet shows the
// system against the actual library rather than against flattering examples. The two
// synthetic rows are the cases the library does not currently contain (a record with no
// usable category, and a series instalment), and both are marked SYNTHETIC in the caption.
//
// Every edge case the brief named has a row, and the caption says which:
//   · the longest title in the library, at 82 characters
//   · a two-word title, which must not look sparse
//   · a colon title
//   · accented and non-ASCII characters, in both title and author
//   · the longest author name in the library
//   · a missing/unknown category and subcategory
//   · a series instalment carrying an ordinal footer
// plus all six liveries, and both descriptor states — present and absent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { renderCover, registerFonts } from './render.mjs';
import { recordFromSlug, parseArgs } from './generate.mjs';
import { LIVERIES } from './liveries.mjs';

// `edge` is printed on the sheet. A row with no edge label is there for its livery alone.
// `descriptor` is supplied here for the sheet only — NOTHING is written back to any record.
export const CASES = [
  { slug: 'the-age-of-agentic-ai-when-machines-start-hacking-without-permission-or-a-human',
    edge: 'LONGEST TITLE IN THE LIBRARY — 82 chars, steps down, stays inside the frame' },
  { slug: 'beyond-saving', edge: 'TWO-WORD TITLE — must not look sparse',
    descriptor: 'devotion. betrayal. surrender.' },
  { slug: 'arrival-again', edge: 'COLON TITLE',
    descriptor: 'repetition. reckoning. dread.' },
  { slug: 'amor-s-cage', edge: 'ACCENTED TITLE — Amoré’s Cage, with a curly apostrophe' },
  { slug: 'chaff', edge: 'LONGEST AUTHOR NAME — Stanley Princewill McDaniels',
    descriptor: 'stillness. betrayal. reckoning.' },
  { slug: '1967', edge: 'NUMERAL-ONLY TITLE — the sparsest record in the library' },
  { slug: 'a-heart-trained-for-battle', edge: 'POETRY LIVERY — light ground, vignette, no glow',
    descriptor: 'suspicion. grief. staying.' },
  { slug: 'brown-skinned-girl' },
  { slug: '7am-an-american-pulp-classic', edge: 'INSPIRING LIVERY — colon title on a dark green ground' },
  { slug: 'my-best-friend-is-an-algorithm' },
  { slug: 'hold-your-breath-and-count-to-ten', edge: 'FLASH FICTION LIVERY — long title, long author' },
  { slug: '47-sessions', descriptor: 'arithmetic. pride. shortfall.' },
  { slug: 'chernobyl', edge: 'NO DESCRIPTOR — the fleuron takes the space, and that is the finished design' },
  { slug: 'release-the-footage-how-the-henry-nowak-case-became-an-international-debate',
    edge: 'SECOND-LONGEST TITLE — quotation marks inside a title' },
  { synthetic: true, slug: 'akudaaya-synthetic',
    record: { slug: 'akudaaya-synthetic', title: 'Àkúdáàya', author: 'Céline Beyoncé Adékúnlé',
      category: 'poetry', subcategory: 'Spoken Word', descriptor: 'return. rumour. recognition.' },
    edge: 'SYNTHETIC — non-ASCII throughout: Yorùbá diacritics in the title AND the author' },
  { synthetic: true, slug: 'series-instalment-synthetic',
    record: { slug: 'series-instalment-synthetic', title: 'Halfway Around the Moon',
      author: 'Ikenna Okpara', liveryKey: 'series', instalmentOrdinal: 1,
      descriptor: 'orbit. distance. return.' },
    edge: 'SYNTHETIC — SERIES LIVERY, instalment ordinal in the footer instead of a subcategory' },
  { synthetic: true, slug: 'unknown-category-synthetic',
    record: { slug: 'unknown-category-synthetic', title: 'The Unfiled Story',
      author: 'A. N. Other', category: '', subcategory: '' },
    edge: 'SYNTHETIC — MISSING CATEGORY AND SUBCATEGORY: eyebrow falls back to the imprint, footer is omitted' },
];

// ── THE SHEET ────────────────────────────────────────────────────────────────────────────
const COLS = 4;
const THUMB_W = 400;
const THUMB_H = 600;
const CAPTION_H = 132;
const GUTTER = 36;
const HEADER = 190;
const SHEET_BG = '#141118';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = String(args.out || 'covers-contact-sheet');
  mkdirSync(join(outDir, 'full'), { recursive: true });
  registerFonts();

  const rendered = [];
  for (const c of CASES) {
    const record = c.synthetic ? c.record : { ...(await recordFromSlug(c.slug)), ...(c.descriptor ? { descriptor: c.descriptor } : {}) };
    const { png, plan } = renderCover(record);
    const file = join(outDir, 'full', `${record.slug}.png`);
    writeFileSync(file, png);
    rendered.push({ ...c, record, png, plan, file, sha: createHash('sha256').update(png).digest('hex') });
    console.log(
      `${(plan.livery.key + '').padEnd(10)} ${String(plan.title.size).padStart(3)}px×${plan.title.lines.length}  ` +
      `${plan.descriptor ? 'desc' : '  — '}  ${record.slug}`,
    );
  }

  const rows = Math.ceil(rendered.length / COLS);
  const W = COLS * THUMB_W + (COLS + 1) * GUTTER;
  const H = HEADER + rows * (THUMB_H + CAPTION_H) + (rows + 1) * GUTTER;
  const sheet = createCanvas(W, H);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#C9A84C';
  ctx.font = '54px "EB Garamond"';
  ctx.fillText('THE TYPOGRAPHIC COVER SYSTEM — CONTACT SHEET', GUTTER + 6, 78);
  ctx.fillStyle = 'rgba(245,240,232,0.62)';
  ctx.font = '30px "EB Garamond"';
  ctx.fillText(
    `${rendered.length} covers · all six liveries · every edge case · rendered at 1600 × 2400, shown here at ${THUMB_W} wide`,
    GUTTER + 6, 126,
  );
  ctx.fillText(
    'NOTHING IS LIVE. No cover URL has changed. This sheet is the gate.',
    GUTTER + 6, 166,
  );

  for (let i = 0; i < rendered.length; i++) {
    const r = rendered[i];
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = GUTTER + col * (THUMB_W + GUTTER);
    const y = HEADER + GUTTER + row * (THUMB_H + CAPTION_H + GUTTER);
    ctx.drawImage(await imageOf(r.png), x, y, THUMB_W, THUMB_H);

    let ty = y + THUMB_H + 34;
    ctx.fillStyle = '#F5F0E8';
    ctx.font = '27px "EB Garamond"';
    ctx.fillText(clip(ctx, r.record.title, THUMB_W), x, ty);
    ty += 30;
    ctx.fillStyle = 'rgba(245,240,232,0.50)';
    ctx.font = '22px "EB Garamond"';
    ctx.fillText(clip(ctx, `${LIVERIES[r.plan.livery.key].name} · ${r.plan.title.size}px × ${r.plan.title.lines.length} · ${r.plan.descriptor ? 'descriptor' : 'no descriptor'}`, THUMB_W), x, ty);
    if (r.edge) {
      ty += 28;
      ctx.fillStyle = '#C9A84C';
      ctx.font = '20px "EB Garamond"';
      for (const line of wrapPlain(ctx, r.edge, THUMB_W).slice(0, 2)) { ctx.fillText(line, x, ty); ty += 24; }
    }
  }

  const sheetPng = sheet.toBuffer('image/png');
  const sheetPath = join(outDir, 'contact-sheet.png');
  writeFileSync(sheetPath, sheetPng);

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
    generatedBy: 'scripts/covers/contact-sheet.mjs',
    renderer: '@napi-rs/canvas 1.0.6 (pinned exactly)',
    canvas: '1600x2400',
    live: false,
    covers: rendered.map((r) => ({
      slug: r.record.slug, synthetic: !!r.synthetic, title: r.record.title, author: r.record.author,
      livery: r.plan.livery.key, titleSize: r.plan.title.size, titleLines: r.plan.title.lines,
      descriptor: r.plan.descriptor?.text ?? null, footer: r.plan.footer, edge: r.edge ?? null,
      bytes: r.png.length, sha256: r.sha,
    })),
  }, null, 2));

  console.log(`\nsheet   ${sheetPath}  ${W} × ${H}  ${sheetPng.length} bytes`);
  console.log(`full    ${join(outDir, 'full')}/  ${rendered.length} PNGs at 1600 × 2400`);
  console.log(`manifest ${join(outDir, 'manifest.json')}`);
  const liveries = new Set(rendered.map((r) => r.plan.livery.key));
  console.log(`liveries covered: ${[...liveries].sort().join(', ')}  (${liveries.size}/6)`);
}

async function imageOf(png) {
  const { loadImage } = await import('@napi-rs/canvas');
  return loadImage(png);
}
const clip = (ctx, s, max) => {
  let t = String(s ?? '');
  while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(0, -2);
  return t === String(s ?? '') ? t : `${t}…`;
};
function wrapPlain(ctx, s, max) {
  const words = String(s).split(/\s+/), lines = []; let line = '';
  for (const w of words) {
    const c = line ? `${line} ${w}` : w;
    if (ctx.measureText(c).width <= max) line = c; else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
