// Backfill sized WebP derivatives for the existing Voices cards.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/backfill-voice-derivatives.mjs            # plan only, no writes
//   node scripts/backfill-voice-derivatives.mjs --apply    # encode, upload, write cardSizes
//
// WHY THIS EXISTS
//   The cards are 1080×1350 social assets, ~1 MB of PNG each. That was survivable when
//   /voices showed one card per screen and lazy-loading deferred the rest. The dense grid
//   puts four to six in the opening viewport, so it defers almost nothing and a Fast 3G
//   reader pays for most of the roster before the page settles.
//
//   /admin/voices now cuts these derivatives in the browser at upload time, so every FUTURE
//   card ships sized from birth. This script is the one-off that catches the seven cards
//   uploaded before that door existed. It should never need to run twice.
//
// WHAT IT DOES, per published-or-draft voice with a cardImage:
//   - Fetches the original from its Storage download URL.
//   - sharp → resize to each width in WIDTHS, WebP q82. The originals are 1080×1350, so
//     the derivatives inherit the same 4:5 crop; nothing is re-cropped.
//   - Uploads to voices/{slug}/card-{w}.webp beside the original, minting a download token
//     so the URL matches the ?alt=media&token=… form every other image on the island uses.
//   - Writes cms_voices/{slug}/cardSizes = { w360, w540 }.
//
// WHAT IT NEVER TOUCHES
//   cardImage itself. It stays the 1080 original: the author page's hero, the morph's
//   arrival target, and the srcset's top rung. This script only ever ADDS a sibling key.
//
// The 'w' key prefix is deliberate — see app/lib/voices.js. RTDB coerces integer-keyed
// nodes into arrays on read, and the map is meant to grow.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';

// Must match CARD_DERIVATIVE_WIDTHS in app/lib/voices.js — the grid's srcset is built from
// that list, and a rung stored here that the grid does not ask for is dead weight in the
// bucket. Two rungs cover four layouts because the choice is DPR-driven, not
// breakpoint-driven: 360w serves a 173px card at DPR2 and a 268px card at DPR1; 540w serves
// the same two at DPR3 and DPR2.
const WIDTHS = [360, 540];
const QUALITY = 82;

const APPLY = process.argv.includes('--apply');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// Fast 3G as DevTools defines it: 1.6 Mbit/s down.
const FAST_3G_BPS = 1.6 * 1024 * 1024;
const secondsOn3G = (bytes) => (bytes * 8) / FAST_3G_BPS;

async function main() {
  const key = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(key), databaseURL: DB_URL, storageBucket: BUCKET });
  const db = getDatabase();
  const bucket = getStorage().bucket();

  const snap = await db.ref('cms_voices').get();
  const node = snap.exists() ? snap.val() || {} : {};
  const voices = Object.entries(node)
    .map(([slug, v]) => ({ ...v, slug }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!voices.length) {
    console.log('cms_voices is empty — nothing to do.');
    return;
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${voices.length} voice(s) in cms_voices\n`);

  let beforeTotal = 0;
  let afterTotal = 0;
  const writes = {};
  const rows = [];

  for (const v of voices) {
    if (!v.cardImage) {
      console.log(`· ${v.slug} — no cardImage, skipped`);
      continue;
    }

    const res = await fetch(v.cardImage);
    if (!res.ok) {
      console.log(`✗ ${v.slug} — could not fetch the original (HTTP ${res.status}), skipped`);
      continue;
    }
    const original = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(original).metadata();
    beforeTotal += original.length;

    const made = {};
    let chosenForGrid = 0; // the rung a 390px DPR3 phone actually pulls — what "after" means

    for (const w of WIDTHS) {
      const out = await sharp(original)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer();

      const path = `voices/${v.slug}/card-${w}.webp`;
      console.log(`  ${v.slug} ${meta.width}×${meta.height} ${kb(original.length)} → ${w}w ${kb(out.length)}  ${path}`);

      if (APPLY) {
        const token = randomUUID();
        const file = bucket.file(path);
        await file.save(out, {
          contentType: 'image/webp',
          metadata: {
            // Long-lived: the path is content-addressed by slug and a re-upload replaces
            // it, which is the same bargain the original card already makes.
            cacheControl: 'public, max-age=31536000',
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });
        made[`w${w}`] = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
      } else {
        made[`w${w}`] = `(dry run — would upload ${path})`;
      }

      if (w === 540) chosenForGrid = out.length;
    }

    afterTotal += chosenForGrid;
    rows.push({ slug: v.slug, before: original.length, after: chosenForGrid });
    if (APPLY) writes[`${v.slug}/cardSizes`] = made;
  }

  if (APPLY && Object.keys(writes).length) {
    // One multi-path update: the roster either gains its derivatives or it does not, rather
    // than the grid finding half the voices sized mid-write.
    await db.ref('cms_voices').update(writes);
    console.log(`\n✓ wrote cardSizes for ${Object.keys(writes).length} voice(s)`);
  }

  console.log('\n── GRID PAYLOAD ─────────────────────────────────────────');
  console.log('(after = the 540w rung, which is what a 390px DPR3 phone pulls)\n');
  for (const r of rows) {
    const pct = ((1 - r.after / r.before) * 100).toFixed(1);
    console.log(`  ${r.slug.padEnd(18)} ${kb(r.before).padStart(8)} → ${kb(r.after).padStart(7)}   −${pct}%`);
  }
  console.log(`\n  ${'TOTAL'.padEnd(18)} ${kb(beforeTotal).padStart(8)} → ${kb(afterTotal).padStart(7)}   −${((1 - afterTotal / beforeTotal) * 100).toFixed(1)}%`);
  console.log(`\n  Fast 3G, full set:  ${secondsOn3G(beforeTotal).toFixed(1)}s → ${secondsOn3G(afterTotal).toFixed(1)}s`);

  if (!APPLY) console.log('\nDRY RUN — nothing was uploaded or written. Re-run with --apply.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
