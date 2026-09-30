// W32 — FILM A GATEWAY DOOR, FRAME BY FRAME, AND SAY WHAT EACH FRAME SHOWS.
//
//   node tests/gateway/film-doors.mjs --door store|library [--engine chromium|webkit]
//        [--site URL] [--out DIR] [--settle 4000]
//
// Chromium: CDP Page.startScreencast — every compositor frame, with its timestamp.
// WebKit:   Playwright's video (no CDP), decoded frame by frame with Playwright's ffmpeg; WebKit
//           launched on softpipe (tests/storybar/webkit.mjs).
// Signed out, GET only; /api/hit and every non-GET are refused. Frames stay in --out (local).
//
// Each frame is classified from its pixels at 402×874 (DPR 1):
//   veil      ≥ 99% of pixels within 8 of the veil colour #050309 — the dark between the pages
//   partial   the tab-bar band has content but the middle of the screen is near-empty, or
//             the nav band is empty while the middle is not — a page drawn in pieces
//   content   anything else; `lum` is mean luminance (0–255), `veilPct` the veil-coloured share
// A FLASH is any frame after the first full-veil frame and before the page settles that is not
// veil, not part of one continuous rise in luminance, and differs in kind from its neighbours:
// the summary lists every class change on the way, which is what the report reads.
import { chromium } from '@playwright/test';
import { launchWebKit } from '../storybar/webkit.mjs';
import sharp from 'sharp';
import { mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const DOOR = arg('--door', 'store');
const ENGINE = arg('--engine', 'chromium');
const SITE = arg('--site', 'https://calvaryscribblings.co.uk');
const OUT = arg('--out', `/tmp/film-${DOOR}-${ENGINE}`);
const SETTLE = Number(arg('--settle', '4000'));
const W = 402, H = 874;
const HREF = DOOR === 'store' ? '/bookstore' : '/public-library';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

async function classify(buf) {
  const { data, info } = await sharp(buf).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  let veil = 0, lum = 0;
  const band = (y0, y1) => { let n = 0, lit = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * 3; n++; if (data[i] + data[i + 1] + data[i + 2] > 90) lit++; } return lit / n; };
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.abs(r - 5) <= 8 && Math.abs(g - 3) <= 8 && Math.abs(b - 9) <= 8) veil++;
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const nav = band(0, 68), mid = band(150, 700), tab = band(H - 80, H);
  const veilPct = veil / px;
  let kind = 'content';
  if (veilPct >= 0.99) kind = 'veil';
  else if ((tab > 0.02 && mid < 0.004) || (nav < 0.002 && mid > 0.01)) kind = 'partial';
  return { kind, lum: +(lum / px).toFixed(2), veilPct: +(veilPct * 100).toFixed(1), nav: +(nav * 100).toFixed(2), mid: +(mid * 100).toFixed(2), tab: +(tab * 100).toFixed(2) };
}

const mute = async (ctx) => {
  await ctx.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  await ctx.route('**/*', (r) => (r.request().method() !== 'GET' || /\/api\/hit/.test(r.request().url()) ? r.abort() : r.continue()));
};

const frames = [];   // { t (ms since tap), buf }
let tapAt = 0;
if (ENGINE === 'chromium') {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await mute(ctx);
  const page = await ctx.newPage();
  await page.goto(SITE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ ts: f.metadata.timestamp * 1000, buf: Buffer.from(f.data, 'base64') });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: W, maxHeight: H });
  await page.waitForTimeout(400);
  tapAt = Date.now();
  await page.locator(`a.cs-gw-door[href="${HREF}"]`).tap();
  await page.waitForURL(`**${HREF}`, { timeout: 20000 });
  await page.waitForTimeout(SETTLE);
  await cdp.send('Page.stopScreencast');
  for (const f of frames) f.t = Math.round(f.ts - tapAt);
  await b.close();
} else {
  const b = await launchWebKit();
  const vdir = join(OUT, 'video');
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', recordVideo: { dir: vdir, size: { width: W, height: H } } });
  await mute(ctx);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(SITE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  tapAt = Date.now();
  await page.locator(`a.cs-gw-door[href="${HREF}"]`).tap();
  await page.waitForURL(`**${HREF}`, { timeout: 20000 });
  await page.waitForTimeout(SETTLE);
  const video = await page.video().path();
  await ctx.close(); await b.close();
  const ff = join(process.env.HOME, '.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux');
  const fdir = join(OUT, 'raw'); mkdirSync(fdir, { recursive: true });
  execFileSync(ff, ['-loglevel', 'error', '-i', video, '-vsync', '0', join(fdir, 'f%05d.png')]);
  const fps = 25;   // Playwright's recorder
  for (const f of readdirSync(fdir).sort()) {
    const n = Number(f.slice(1, 6)) - 1;
    frames.push({ t: Math.round(t0 + (n * 1000) / fps - tapAt), buf: readFileSync(join(fdir, f)) });
  }
}

const rows = [];
for (const [i, f] of frames.entries()) {
  if (f.t < -200) continue;
  const c = await classify(f.buf);
  const name = `f${String(i).padStart(4, '0')}_${f.t}ms_${c.kind}.png`;
  writeFileSync(join(OUT, name), f.buf);
  rows.push({ i, t: f.t, ...c });
}
writeFileSync(join(OUT, 'frames.json'), JSON.stringify(rows, null, 1));

// The story: every class change, plus lum jumps > 20 between consecutive content frames.
const firstVeil = rows.findIndex((r) => r.kind === 'veil');
const story = [];
let prev = null;
for (const r of rows) {
  const jump = prev && r.kind === 'content' && prev.kind === 'content' && Math.abs(r.lum - prev.lum) > 20;
  if (!prev || r.kind !== prev.kind || jump) story.push(r);
  prev = r;
}
const afterVeil = firstVeil >= 0 ? rows.slice(firstVeil) : [];
const lastVeil = afterVeil.length ? afterVeil.map((r) => r.kind).lastIndexOf('veil') : -1;
const between = afterVeil.slice(0, lastVeil + 1).filter((r) => r.kind !== 'veil');
console.log(`${ENGINE} ${DOOR}: ${rows.length} frames, first veil at ${firstVeil >= 0 ? rows[firstVeil].t : '—'}ms, ${afterVeil.filter((r) => r.kind === 'veil').length} veil frames`);
console.log(`  non-veil frames INSIDE the veil run (first veil → last veil): ${between.length}`);
console.log(`  partial frames after the first veil: ${afterVeil.filter((r) => r.kind === 'partial').length}`);
for (const r of story) console.log(`  ${String(r.t).padStart(6)}ms  #${String(r.i).padStart(4)}  ${r.kind.padEnd(8)} lum ${String(r.lum).padStart(6)}  veil ${String(r.veilPct).padStart(5)}%  nav ${r.nav}%  mid ${r.mid}%  tab ${r.tab}%`);
console.log(`  frames: ${OUT}`);
