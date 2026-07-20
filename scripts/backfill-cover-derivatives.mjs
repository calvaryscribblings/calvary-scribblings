// Backfill sized WebP derivatives + long-cache metadata for every published cover.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/backfill-cover-derivatives.mjs            # plan only, no writes
//   node scripts/backfill-cover-derivatives.mjs --apply    # encode, upload, meta, coverSizes
//
// WHY THIS EXISTS
//   Story covers are full-resolution uploads — 0.9 to 4 MB each — served with
//   Firebase Storage's DEFAULT `cache-control: private, max-age=0`, so a list of
//   cover cards downloads megabytes on every visit and re-downloads them on every
//   revisit. The CMS upload path now cuts derivatives + sets long cache at upload
//   time (app/admin/page.js), so every FUTURE cover ships sized and cacheable.
//   This is the one-off that catches the covers uploaded before that door existed.
//
// WHAT IT DOES, per PUBLISHED story with an http(s) cover:
//   - Fetches the original from its Storage download URL.
//   - sharp → w360 + w720 WebP q82 (withoutEnlargement; same crop, no re-crop).
//   - Uploads to covers/{slug}/w{360,720}.webp beside the original, minting a
//     download token so the URL matches the ?alt=media&token= form the app uses.
//   - Sets cache-control: public, max-age=31536000, immutable on the derivatives
//     AND on the ORIGINAL (the srcset's top rung — it must be cacheable too).
//   - Records coverSizes { w360, w720 } on BOTH cms_stories/{slug} and
//     cms_stories_index/{slug} as a SIBLING of cover — cover itself is untouched.
//
// WHAT IT NEVER TOUCHES: the `cover` field / the original object's bytes. Only
//   metadata on the original changes; only ADD a sibling key in RTDB.
//
// Storage goes through firebase-admin (GCS JSON API over HTTPS). RTDB writes go
// through the REST API with an OAuth token (the realtime websocket is not
// reachable from every runner). Requires serviceAccountKey.json at the repo root.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { isIndexed, buildIndexRecord } from '../app/lib/storyIndex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';

const WIDTHS = [360, 720];
const QUALITY = 82;
const CACHE = 'public, max-age=31536000, immutable';
const DELAY_MS = 120;

const APPLY = process.argv.includes('--apply');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST_3G_BPS = 1.6 * 1024 * 1024;
const secondsOn3G = (bytes) => (bytes * 8) / FAST_3G_BPS;

// covers/1967_1967-cover.jpeg from a firebasestorage download URL, or null for a
// non-Storage cover (a /public/ path — we cannot derive those here).
function objectPathFromUrl(url) {
  if (!/^https?:/i.test(url)) return null;
  const m = url.match(/\/o\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function main() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(svc), storageBucket: BUCKET });
  const bucket = getStorage().bucket();

  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) { console.error(`cms_stories read failed: HTTP ${res.status}`); process.exit(1); }
  const all = await res.json();

  const published = Object.entries(all)
    .filter(([, s]) => isIndexed(s) && s.cover)
    .map(([slug, s]) => ({ slug, cover: s.cover }));

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${published.length} published cover(s)\n`);

  const coverSizes = {};   // slug -> { w360, w720 }
  const skippedLocal = [];
  let beforeTotal = 0, afterCardTotal = 0; // afterCard = the w360 rung a phone pulls

  for (const { slug, cover } of published) {
    const objPath = objectPathFromUrl(cover);
    if (!objPath) { skippedLocal.push(slug); continue; }

    let original;
    try {
      const r = await fetch(cover);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      original = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      console.log(`✗ ${slug} — could not fetch original (${e.message}), skipped`);
      continue;
    }
    beforeTotal += original.length;

    const made = {};
    for (const w of WIDTHS) {
      const out = await sharp(original).resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
      const path = `covers/${slug}/w${w}.webp`;
      console.log(`  ${slug}  ${kb(original.length)} → ${w}w ${kb(out.length)}  ${path}`);
      if (w === 360) afterCardTotal += out.length;
      if (APPLY) {
        const token = randomUUID();
        await bucket.file(path).save(out, {
          contentType: 'image/webp',
          metadata: { cacheControl: CACHE, metadata: { firebaseStorageDownloadTokens: token } },
        });
        made[`w${w}`] = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
      } else {
        made[`w${w}`] = `(dry run — would upload ${path})`;
      }
    }
    coverSizes[slug] = made;

    if (APPLY) {
      // Long-cache the ORIGINAL too — it is the srcset's top rung.
      try { await bucket.file(objPath).setMetadata({ cacheControl: CACHE }); }
      catch (e) { console.log(`  ! ${slug} — could not set metadata on original (${e.message})`); }
      await sleep(DELAY_MS);
    }
  }

  console.log('\n── COVER PAYLOAD ────────────────────────────────────────');
  console.log(`  originals total : ${kb(beforeTotal)}`);
  console.log(`  w360 rung total : ${kb(afterCardTotal)}   (−${((1 - afterCardTotal / beforeTotal) * 100).toFixed(1)}%)`);
  console.log(`  Fast 3G, full set: ${secondsOn3G(beforeTotal).toFixed(1)}s → ${secondsOn3G(afterCardTotal).toFixed(1)}s`);
  if (skippedLocal.length) console.log(`  skipped (local /public cover, no Storage object): ${skippedLocal.join(', ')}`);

  if (!APPLY) {
    console.log('\n  sample coverSizes:');
    for (const slug of Object.keys(coverSizes).slice(0, 2)) console.log('   ', slug, '→', JSON.stringify(coverSizes[slug]));
    console.log('\nDRY RUN — nothing uploaded or written. Re-run with --apply.');
    return;
  }

  // cms_stories takes a deep-path PATCH (merge — cover and every other field untouched).
  //
  // cms_stories_index does NOT. A deep path (`<slug>/coverSizes`) CREATES the parent when the
  // slug has no index entry, materialising a record that contains only coverSizes: a stub that
  // still counts as a member but carries none of the projection — no authorUid, no title, no
  // date. That is exactly how cms_stories_index/your-money-cannot-save-you lost its authorUid
  // and dropped a story from Ufedo-Ojo Adaji's Voices page. The old comment here asserted
  // "index carries only the published slugs, which is exactly the set we processed" — that
  // assumption is false for any story published after the last index backfill.
  //
  // So re-project the WHOLE record through buildIndexRecord instead: complete by construction,
  // impossible to stub, and self-healing if the entry was missing or stale.
  const token = (await cert(svc).getAccessToken()).access_token;
  const storyPatch = {}, indexPatch = {};
  for (const [slug, sizes] of Object.entries(coverSizes)) {
    storyPatch[`${slug}/coverSizes`] = sizes;
    const merged = { ...all[slug], coverSizes: { ...(all[slug].coverSizes || {}), ...sizes } };
    indexPatch[slug] = buildIndexRecord(slug, merged);
  }
  for (const [node, body] of [['cms_stories', storyPatch], ['cms_stories_index', indexPatch]]) {
    const pr = await fetch(`${DB_URL}/${node}.json?access_token=${token}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!pr.ok) { console.error(`\n✗ ${node} PATCH failed: HTTP ${pr.status} — ${await pr.text()}`); process.exit(1); }
    console.log(`✓ wrote coverSizes for ${Object.keys(body).length} slug(s) to ${node}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
