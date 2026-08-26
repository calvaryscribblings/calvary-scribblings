// R20 — BACKFILL SIZED WEBP RUNGS FOR THE BOOKSTORE COVERS.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/backfill-bookstore-cover-derivatives.mjs            # plan only, no writes
//   node scripts/backfill-bookstore-cover-derivatives.mjs --apply    # encode, upload, write coverSizes
//   node scripts/backfill-bookstore-cover-derivatives.mjs --slug basil --apply
//
// WHY THIS EXISTS
//   Measured on the shipped export, a first paint of /bookstore was 15.7 MiB at 1280 and
//   11.2 MiB at 390, of which 92.3% and 89.2% were cover bitmaps. The whole catalogue is
//   33.74 MiB across 21 covers — raw admin uploads, PNG and JPEG, up to 3931×5156 — drawn into
//   a board 104.7px wide on a handset and 197.6px on a laptop. The worst file is 4567 KiB of
//   3931×5156 painted into 104.7×159.8: a 37.5× linear oversample.
//
//   /admin/bookstore now cuts these rungs in the browser at upload time, so every FUTURE cover
//   ships sized from birth. This script is the one-off that catches the covers uploaded before
//   that door existed. It should never need to run twice.
//
// WHAT IT DOES, per title with a coverUrl:
//   - Fetches the original from its Storage download URL.
//   - sharp → resize to each width in WIDTHS, WebP q82, `withoutEnlargement` so a cover that
//     is already smaller than a rung is never upscaled into a bigger file than it started as.
//   - Uploads to bookstore_covers/{titleId}_w{width}.webp — FLAT, beside the original, minting
//     a download token so the URL matches the ?alt=media&token=… form the site already reads.
//   - Writes bookstore_titles/{titleId}/coverSizes = { w360, w720 }.
//
// ⚠ THE PATH IS FLAT AND THAT IS A RULE, NOT A STYLE. storage.rules matches
//   `bookstore_covers/{titleId}` on a SINGLE path segment, so `bookstore_covers/basil/w360.webp`
//   matches no rule at all and is denied both read and write. This is the same trap R18's
//   author photograph documented. The underscore is safe because SLUG_RE in schema.js is
//   /^[a-z0-9]+(-[a-z0-9]+)*$/ — a title id can carry hyphens but never an underscore.
//   The path is built by coverDerivativePath() in app/lib/bookstore/covers.js and NOT rebuilt
//   here, so the two writers cannot drift.
//
// WHAT IT NEVER TOUCHES
//   coverUrl itself. It stays the original: the fallback for any browser that ignores srcset,
//   and the file the CMS shows back to a curator. This script only ever ADDS a sibling key.
//
// NO RULES CHANGE IS NEEDED. The existing cover rule already grants public read and admin
// write under 5 MB for image/* on this prefix, which is exactly what a derivative is. And
// coverSizes rides onto the record the way samplePath, glossary and the R18 author block do —
// schema-external, with no $other deny in database.rules.json to refuse it.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { COVER_DERIVATIVE_WIDTHS, coverDerivativePath, coverSizeKey } from '../app/lib/bookstore/covers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';
const TITLES_PATH = 'bookstore_titles';

// Imported, never re-declared. A rung stored here that coverSrcSet() does not ask for is dead
// weight in the bucket; a rung it asks for and this never wrote is a 404 in a srcset.
const WIDTHS = COVER_DERIVATIVE_WIDTHS;
const QUALITY = 82;

const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const i = process.argv.indexOf('--slug');
  return i > -1 ? process.argv[i + 1] : null;
})();

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
// Fast 3G as DevTools defines it: 1.6 Mbit/s down.
const FAST_3G_BPS = 1.6 * 1024 * 1024;
const secs = (bytes) => ((bytes * 8) / FAST_3G_BPS).toFixed(1);

async function main() {
  const key = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(key), databaseURL: DB_URL, storageBucket: BUCKET });
  const db = getDatabase();
  const bucket = getStorage().bucket();

  const snap = await db.ref(TITLES_PATH).get();
  const node = snap.exists() ? snap.val() || {} : {};
  let titles = Object.entries(node).map(([id, t]) => ({ ...t, id }));
  if (ONLY) titles = titles.filter((t) => t.id === ONLY || t.slug === ONLY);
  titles.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  if (!titles.length) {
    console.log(ONLY ? `No title matched '${ONLY}'.` : `${TITLES_PATH} is empty — nothing to do.`);
    return;
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${titles.length} title(s) in ${TITLES_PATH}\n`);

  let beforeTotal = 0;
  let afterTotal = 0;
  const writes = {};
  const rows = [];
  let skipped = 0;

  for (const t of titles) {
    if (!t.coverUrl) { console.log(`· ${t.id} — no coverUrl, skipped`); skipped++; continue; }

    let original;
    try {
      const res = await fetch(t.coverUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      original = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.log(`✗ ${t.id} — could not fetch the original (${e.message}), skipped`);
      skipped++; continue;
    }

    const meta = await sharp(original).metadata();
    beforeTotal += original.length;

    const made = {};
    let shelfRung = 0; // the 360w rung — what a handset actually pulls, and what "after" means

    for (const w of WIDTHS) {
      const out = await sharp(original)
        // withoutEnlargement: three covers in this catalogue are 484×726, smaller than the
        // 720 rung. Upscaling them would produce a LARGER file than the original for no extra
        // detail — the exact opposite of the round.
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer();

      const path = coverDerivativePath(t.id, w, 'webp');
      console.log(`  ${String(t.id).padEnd(38)} ${meta.width}×${meta.height} ${kb(original.length).padStart(8)} → ${String(w).padStart(3)}w ${kb(out.length).padStart(7)}   ${path}`);

      if (APPLY) {
        const token = randomUUID();
        await bucket.file(path).save(out, {
          contentType: 'image/webp',
          metadata: {
            // Long-lived. A re-upload from the CMS replaces the object at the same path, which
            // is the same bargain the original cover already makes on this prefix.
            cacheControl: 'public, max-age=31536000',
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });
        made[coverSizeKey(w)] = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
      } else {
        made[coverSizeKey(w)] = `(dry run — would upload ${path})`;
      }

      if (w === 360) shelfRung = out.length;
    }

    afterTotal += shelfRung;
    rows.push({ id: t.id, before: original.length, after: shelfRung });
    if (APPLY) writes[`${t.id}/coverSizes`] = made;
  }

  if (APPLY && Object.keys(writes).length) {
    // ONE multi-path update. The shelf either gains its rungs or it does not — a half-written
    // catalogue would render some boards from 22 KB and others from 4.5 MB, which is the state
    // this round exists to end rather than to create.
    await db.ref(TITLES_PATH).update(writes);
    console.log(`\n✓ wrote coverSizes for ${Object.keys(writes).length} title(s)`);
  }

  console.log('\n── SHELF PAYLOAD ────────────────────────────────────────');
  console.log('(after = the 360w rung, which is what a handset board pulls)\n');
  for (const r of rows) {
    const pct = ((1 - r.after / r.before) * 100).toFixed(1);
    console.log(`  ${String(r.id).slice(0, 40).padEnd(42)} ${kb(r.before).padStart(9)} → ${kb(r.after).padStart(7)}   −${pct}%`);
  }
  console.log('\n  ' + 'TOTAL'.padEnd(42) + `${kb(beforeTotal).padStart(9)} → ${kb(afterTotal).padStart(7)}   −${((1 - afterTotal / beforeTotal) * 100).toFixed(1)}%`);
  console.log(`  ${''.padEnd(42)} ${secs(beforeTotal).padStart(9)}s → ${secs(afterTotal).padStart(6)}s on Fast 3G`);
  if (skipped) console.log(`\n  ${skipped} title(s) skipped.`);
  if (!APPLY) console.log('\nDRY RUN — nothing was written. Re-run with --apply to upload and record.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
