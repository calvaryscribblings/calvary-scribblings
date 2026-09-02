// Generate blurhash (and thumbhash) placeholders for every cms_stories cover.
// READ-ONLY: this script never writes to Firebase. It reads cms_stories,
// downloads each cover, downscales it with sharp, encodes a blurhash (4x3
// components, the primary hash) plus a thumbhash, and emits
// scripts/cover-hashes-report.json for the companion writer to consume.
//
//   node scripts/generate-cover-hashes.mjs
//
// Requires serviceAccountKey.json at the repo root (same as other scripts/).
// Uses sharp + blurhash + thumbhash (installed locally; sharp/thumbhash are
// script-only and intentionally kept out of package.json).
//
// Only stories that have a non-empty `cover` AND no existing `coverHash` are
// processed. A cover that is a local /public/ path is read from disk instead
// of fetched. Everything is sequential with a small delay to stay polite to
// Firebase Storage.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import sharp from 'sharp';
import { encode } from 'blurhash';
import { rgbaToThumbHash } from 'thumbhash';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = resolve(ROOT, 'public');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const REPORT_PATH = resolve(__dirname, 'cover-hashes-report.json');

const TARGET_WIDTH = 64;   // downscale width fed to blurhash
const THUMB_MAX = 90;      // thumbhash longest-side cap (must stay <= 100)
const BLUR_X = 4;          // blurhash horizontal components
const BLUR_Y = 3;          // blurhash vertical components
const DELAY_MS = 150;

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch a cover into a Buffer. http(s) → download; anything else is treated as
// a path under public/ (leading slash stripped).
async function loadCover(cover) {
  if (/^https?:/i.test(cover)) {
    const res = await fetch(cover);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const rel = cover.replace(/^\/+/, '');
  return readFile(resolve(PUBLIC_DIR, rel));
}

// Downscale + encode. blurhash is primary and must succeed; thumbhash is
// best-effort (null on failure) so a secondary-encoder hiccup never costs us
// the blurhash. Returns { blurhash, thumbhash, width, height }.
async function hashCover(buf) {
  const { data, info } = await sharp(buf)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8ClampedArray(data);
  const blurhash = encode(pixels, info.width, info.height, BLUR_X, BLUR_Y);

  // thumbhash requires the longest side <= 100px, so it gets its own capped
  // resize (portrait covers are ~64x115 and would otherwise throw). Stored as
  // base64 for JSON/RTDB; encoded best-effort.
  let thumbhash = null;
  try {
    const { data: tData, info: tInfo } = await sharp(buf)
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const thumb = rgbaToThumbHash(tInfo.width, tInfo.height, new Uint8ClampedArray(tData));
    thumbhash = Buffer.from(thumb).toString('base64');
  } catch (err) {
    console.warn(`      (thumbhash skipped: ${err.message})`);
  }

  return { blurhash, thumbhash, width: info.width, height: info.height };
}

async function main() {
  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  const snap = await db.ref('cms_stories').get();
  const stories = snap.val() || {};

  // Build the work list: has a cover, has no coverHash yet.
  const work = [];
  let skippedNoCover = 0;
  let skippedHasHash = 0;
  for (const [id, story] of Object.entries(stories)) {
    if (!story || typeof story !== 'object') continue;
    if (isEmpty(story.cover)) { skippedNoCover++; continue; }
    if (!isEmpty(story.coverHash)) { skippedHasHash++; continue; }
    work.push({ id, title: story.title || '', cover: story.cover });
  }

  console.log(`Read ${Object.keys(stories).length} cms_stories.`);
  console.log(`  To hash: ${work.length}`);
  console.log(`  Skipped (no cover): ${skippedNoCover}`);
  console.log(`  Skipped (already has coverHash): ${skippedHasHash}`);
  console.log('');

  const report = [];
  let ok = 0, failed = 0;
  for (let i = 0; i < work.length; i++) {
    const { id, title, cover } = work[i];
    try {
      const buf = await loadCover(cover);
      const { blurhash, thumbhash } = await hashCover(buf);
      report.push({ id, title, cover, hash: blurhash, thumbhash, status: 'ok' });
      ok++;
      console.log(`  [${i + 1}/${work.length}] ✓ ${id}  ${blurhash}`);
    } catch (err) {
      report.push({ id, title, cover, hash: null, thumbhash: null, status: `error: ${err.message}` });
      failed++;
      console.error(`  [${i + 1}/${work.length}] ✗ ${id}  ${err.message}`);
    }
    if (i < work.length - 1) await sleep(DELAY_MS);
  }

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`\n${'='.repeat(72)}`);
  console.log(`COVER HASH SUMMARY`);
  console.log(`${'='.repeat(72)}`);
  console.log(`  Total processed: ${work.length}`);
  console.log(`  Succeeded:       ${ok}`);
  console.log(`  Failed:          ${failed}`);
  console.log(`  Report:          ${REPORT_PATH}`);
  console.log(`${'='.repeat(72)}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
