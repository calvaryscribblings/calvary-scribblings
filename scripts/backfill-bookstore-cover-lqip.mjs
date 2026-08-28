// R29 — BACKFILL THE INLINE STAND-IN FOR EVERY BOOKSTORE COVER THAT PREDATES THE DOOR.
//
//   node scripts/backfill-bookstore-cover-lqip.mjs            # plan only, no writes
//   node scripts/backfill-bookstore-cover-lqip.mjs --apply    # encode and write coverLqip
//   node scripts/backfill-bookstore-cover-lqip.mjs --slug basil --apply
//   node scripts/backfill-bookstore-cover-lqip.mjs --force --apply    # re-cut existing ones
//
// Requires serviceAccountKey.json at the repo root, like every other script here.
//
// ── WHAT THIS IS AND WHY IT IS TEMPORARY ────────────────────────────────────────────────────
//
// Ikenna's ruling of 27 Aug 2026: a board never shows an empty plate while its cover is in
// flight. /admin/bookstore now cuts the stand-in in the browser at upload time, so every FUTURE
// cover carries one from birth (see makeCoverLqip in app/lib/bookstore/admin-writes.js). This
// catches the twenty that were uploaded before that line existed — measured, 0 of 20 published
// titles carried any placeholder field.
//
// It is the same shape, the same flags and the same posture as
// scripts/backfill-bookstore-cover-derivatives.mjs, deliberately: one backfill pattern in this
// tree, not two.
//
// ── NOTHING IS UPLOADED ─────────────────────────────────────────────────────────────────────
//
// The stand-in is a data URI stored ON THE RECORD, not an object in the bucket. A placeholder
// that needed its own request would not be one — the whole point is that it arrives inside a
// payload the page has already fetched. So this script touches Storage only to READ the cover
// it is downscaling.
//
// ── IT ENCODES FROM THE w360 RUNG WHEN THERE IS ONE ─────────────────────────────────────────
//
// R20's smallest derivative is already a clean 360px WebP of exactly the art the board draws,
// so downscaling from it is both faster and closer to what the browser will paint than pulling
// a 4 MB original. coverUrl is the fallback for a title that predates the rungs.
//
// ⚠ sharp IS SCRIPT-ONLY and deliberately out of package.json, exactly as the derivative
// backfill and scripts/generate-cover-hashes.mjs say of it. This never runs in a build.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import sharp from 'sharp';
import { COVER_LQIP_WIDTH, COVER_LQIP_QUALITY, MAX_COVER_LQIP_BYTES, coverSizeKey, COVER_DERIVATIVE_WIDTHS } from '../app/lib/bookstore/covers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const TITLES_PATH = 'bookstore_titles';

// Imported, never re-declared. The browser door and this script must produce the same kind of
// object, and the one place that decides what that is, is covers.js.
const WIDTH = COVER_LQIP_WIDTH;
const QUALITY = Math.round(COVER_LQIP_QUALITY * 100);

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ONLY = (() => {
  const i = process.argv.indexOf('--slug');
  return i > -1 ? process.argv[i + 1] : null;
})();

/** The lightest honest source for the downscale: the w360 rung, else the original. */
function sourceFor(t) {
  for (const w of COVER_DERIVATIVE_WIDTHS) {
    const u = t.coverSizes?.[coverSizeKey(w)];
    if (u) return { url: u, from: coverSizeKey(w) };
  }
  return t.coverUrl ? { url: t.coverUrl, from: 'original' } : null;
}

async function main() {
  const key = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(key), databaseURL: DB_URL });
  const db = getDatabase();

  const snap = await db.ref(TITLES_PATH).once('value');
  const all = snap.val() || {};
  const rows = Object.entries(all)
    .map(([id, t]) => ({ id, ...t }))
    .filter((t) => (ONLY ? t.slug === ONLY : true))
    .filter((t) => t.coverUrl || t.coverSizes);

  console.log(`${rows.length} title(s) with a cover${ONLY ? ` matching --slug ${ONLY}` : ''}`);
  console.log(APPLY ? 'APPLYING — coverLqip will be written.\n' : 'PLAN ONLY — nothing will be written. Add --apply.\n');

  let done = 0; let skipped = 0; let failed = 0; let bytes = 0;
  for (const t of rows) {
    if (t.coverLqip && !FORCE) { skipped++; console.log(`  · ${t.slug} — already has a stand-in (--force to re-cut)`); continue; }
    const src = sourceFor(t);
    if (!src) { skipped++; console.log(`  · ${t.slug} — no cover to encode from`); continue; }
    try {
      const buf = Buffer.from(await (await fetch(src.url)).arrayBuffer());
      const out = await sharp(buf).resize(WIDTH).webp({ quality: QUALITY, effort: 6 }).toBuffer();
      const uri = `data:image/webp;base64,${out.toString('base64')}`;
      if (uri.length > MAX_COVER_LQIP_BYTES) {
        // The reader-side getter would refuse this anyway, so refusing it here keeps a value
        // that can never render out of the database.
        failed++;
        console.log(`  ✗ ${t.slug} — ${uri.length} bytes, over the ${MAX_COVER_LQIP_BYTES}-byte ceiling`);
        continue;
      }
      bytes += uri.length;
      done++;
      console.log(`  ✓ ${t.slug} — ${uri.length} bytes from ${src.from}`);
      if (APPLY) await db.ref(`${TITLES_PATH}/${t.id}/coverLqip`).set(uri);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${t.slug} — ${err.message}`);
    }
  }

  console.log(`\n${done} encoded, ${skipped} skipped, ${failed} failed`);
  if (done) console.log(`${(bytes / done).toFixed(0)} bytes average, ${(bytes / 1024).toFixed(1)} KiB for all ${done}`);
  if (!APPLY && done) console.log('\nRe-run with --apply to write them.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
