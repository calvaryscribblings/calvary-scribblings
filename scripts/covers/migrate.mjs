// THE MIGRATION — every published story's cover, regenerated and repointed.
//
//   node scripts/covers/migrate.mjs                    # PLAN. Reads, renders nothing, writes nothing.
//   node scripts/covers/migrate.mjs --render           # render all covers locally, still no writes
//   node scripts/covers/migrate.mjs --apply            # REFUSED without a sign-off. See below.
//   node scripts/covers/migrate.mjs --rollback         # flip every migrated pointer back
//   node scripts/covers/migrate.mjs --status           # read the manifest and report
//
// ════════════════════════════════════════════════════════════════════════════════════════
// THE GATE
// ════════════════════════════════════════════════════════════════════════════════════════
// `--apply` refuses to run unless BOTH of these hold:
//
//   1. covers-contact-sheet/manifest.json exists — a contact sheet has actually been built;
//   2. covers-migration/SIGNOFF.md exists and names THAT EXACT SHEET by its SHA-256.
//
// The second condition is the point. A sign-off is not a general permission to change covers,
// it is approval of a SPECIFIC SET OF RENDERED IMAGES. Binding it to the sheet's hash means
// that if anyone touches the layout, the liveries, the fonts or the renderer after approval,
// the sheet's hash moves, the sign-off stops matching, and the migration refuses until a new
// sheet is built and looked at. Approval cannot silently outlive the thing approved.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// WHAT THE BRIEF SAID, AND THE THREE FIELDS IT DID NOT MENTION
// ════════════════════════════════════════════════════════════════════════════════════════
// The brief describes the per-story step as "flip the story's cover URL to the new path".
// Flipping `cover` alone would ship a half-migrated library, and it is worth being exact
// about why, because it is invisible until it is live:
//
//   `coverSizes` { w360, w720 } is what the site ACTUALLY RENDERS almost everywhere.
//   app/components/CoverImage.js builds its srcset from it and picks `coverSizes.w360` for
//   every non-hero image; the story page's hero uses `coverSizes.w720`; the offline shelf
//   uses w360. `cover` is the top srcset rung and the fallback. So a story whose `cover`
//   points at a new typographic PNG while its `coverSizes` still point at the old artwork
//   shows THE OLD COVER on the library grid, on every story card, on the home page and on
//   the shelf — everywhere a reader actually looks — and the new one only in the hero.
//
//   `coverHash` is the blurhash placeholder painted before the image arrives. Left stale it
//   paints the old artwork's colours under the new cover: a purple-black bloom resolving
//   into a cream Poetry cover.
//
//   And all three are MIRRORED on cms_stories_index, which is what the app and the search,
//   profile and author-list surfaces read. An index left unflipped is a second stale copy.
//
// So the unit of migration is six fields across two nodes, written in ONE atomic patch.
//
// ════════════════════════════════════════════════════════════════════════════════════════
// NEW PATHS, AND WHY ROLLBACK IS FREE
// ════════════════════════════════════════════════════════════════════════════════════════
// Every object goes to covers-typographic/{slug}/…, never to covers/{slug}/…. Nothing is
// overwritten and no old cover file is deleted — deleting them is a deliberate later sweep,
// not part of this. Two things follow: the Cloudflare edge cache is never a factor, because
// these URLs have never existed before and cannot be stale; and rollback is restoring six
// scalars from the manifest, because the bytes they point at were never touched.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { encode as blurhashEncode } from 'blurhash';
import { renderCover } from './render.mjs';
import { toRecord, parseArgs } from './generate.mjs';
import { CASES } from './contact-sheet.mjs';
import { isIndexed, buildIndexRecord } from '../../app/lib/storyIndex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';
const CACHE = 'public, max-age=31536000, immutable';
const WIDTHS = [360, 720];
const WEBP_QUALITY = 82;
const DELAY_MS = 120;

const WORK_DIR = join(ROOT, 'covers-migration');
const MANIFEST = join(WORK_DIR, 'manifest.json');
const SIGNOFF = join(WORK_DIR, 'SIGNOFF.md');
const SHEET_MANIFEST = join(ROOT, 'covers-contact-sheet/manifest.json');
const NEW_PREFIX = 'covers-typographic';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ── THE MANIFEST ─────────────────────────────────────────────────────────────────────────
// One JSON file, rewritten after EVERY story. That is deliberately more IO than necessary:
// the whole value of a resumable manifest is that it is correct after a kill -9 between any
// two stories, and a manifest flushed at the end is a manifest that does not exist when it
// is needed. 158 rewrites of a ~100 KB file is nothing against 158 renders and uploads.
//
// STATES, and the order they move through:
//   pending   → nothing has happened
//   rendered  → the PNG exists locally, hashed. No remote state.
//   uploaded  → the three objects are in Storage. Still nothing flipped; the site is unchanged.
//   flipped   → RTDB now points at them. THE ONLY STATE VISIBLE TO A READER.
//   failed    → carries `error`; a re-run retries it from the top.
//
// Resume skips `flipped` and retries everything else from `pending`, because re-rendering
// and re-uploading are both idempotent — the render is deterministic, and the object path is
// a pure function of the slug — while a partial flip is not something that can exist: the
// flip is one atomic patch.
function loadManifest() {
  if (!existsSync(MANIFEST)) return { version: 1, startedAt: null, stories: {} };
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}
function saveManifest(m) {
  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

/** The gate. Returns the sheet's hash on success; exits the process on failure. */
function requireSignoff() {
  if (!existsSync(SHEET_MANIFEST)) {
    console.error(
      'REFUSED — no contact sheet has been built.\n' +
      '  Run: npm run covers:sheet\n' +
      '  Then have Ikenna look at covers-contact-sheet/contact-sheet.png.',
    );
    process.exit(3);
  }
  const sheetSha = sha(readFileSync(SHEET_MANIFEST));
  if (!existsSync(SIGNOFF)) {
    console.error(
      'REFUSED — no sign-off.\n\n' +
      '  The contact sheet exists but nobody has approved it. To record approval, create\n' +
      `  covers-migration/SIGNOFF.md containing this line:\n\n` +
      `      contactSheetSha256: ${sheetSha}\n\n` +
      '  That hash is of the sheet as it stands right now. It is required so that approval\n' +
      '  cannot outlive the images approved: change the layout or the fonts and it stops\n' +
      '  matching, and this refuses again until a new sheet has been looked at.',
    );
    process.exit(3);
  }
  const text = readFileSync(SIGNOFF, 'utf8');
  const named = text.match(/contactSheetSha256:\s*([0-9a-f]{64})/i)?.[1];
  if (!named) {
    console.error(`REFUSED — ${SIGNOFF} does not name a contact sheet.\n  Expected a line: contactSheetSha256: ${sheetSha}`);
    process.exit(3);
  }
  if (named.toLowerCase() !== sheetSha) {
    console.error(
      'REFUSED — the sign-off is for a DIFFERENT contact sheet.\n' +
      `  signed off : ${named}\n  on disk now: ${sheetSha}\n\n` +
      '  Something changed after approval — the layout, a livery, a font, the renderer, or\n' +
      '  the case list. Rebuild the sheet, have it looked at again, and update SIGNOFF.md.',
    );
    process.exit(3);
  }
  console.log(`sign-off verified against contact sheet ${sheetSha.slice(0, 16)}…\n`);
  return sheetSha;
}

/**
 * THE PREFLIGHT — proves the migration set before a single byte is uploaded.
 *
 * This exists because of a real question Ikenna asked of the contact sheet: three of the
 * seventeen plates carry titles nobody recognised. They are the SYNTHETIC records — a
 * Yorùbá-diacritic title, a story with no category at all, and a Series instalment — which
 * exist only to prove the renderer against cases the live library does not currently
 * contain. They are not stories. They have no cms_stories record, no slug anyone can visit,
 * and they must never touch Storage or RTDB.
 *
 * "They aren't in the migration" is easy to say and easy to be wrong about, so it is
 * ASSERTED rather than asserted-by-eye, and the synthetic set is DERIVED from the very
 * array the contact sheet renders from — not retyped here, where it could drift out of
 * agreement with the sheet it is supposed to describe.
 *
 * Every check below is a refusal, not a warning. A migration that writes to 157 of 158
 * stories, or to 159, is not a migration that can be reasoned about afterwards.
 */
export function preflight(stories, manifest) {
  const fail = (msg) => { console.error(`REFUSED — ${msg}`); process.exit(4); };
  const live = new Set(stories.map((s) => s.slug));
  const synthetic = new Set(CASES.filter((c) => c.synthetic).map((c) => c.slug));

  // 1. the synthetic records are not in the set, and cannot be
  const smuggled = [...synthetic].filter((s) => live.has(s));
  if (smuggled.length) fail(`synthetic record(s) present in the migration set: ${smuggled.join(', ')}`);

  // 2. nor are they lurking in a manifest carried over from an earlier run
  const stale = Object.keys(manifest.stories).filter((s) => !live.has(s));
  if (stale.length) fail(`manifest carries ${stale.length} slug(s) that are not live published stories: ${stale.slice(0, 5).join(', ')}`);

  // 3. every member of the set is a real, published, renderable record
  const unpublished = stories.filter((s) => !isIndexed(s.story));
  if (unpublished.length) fail(`${unpublished.length} unpublished record(s) in the set`);
  const nameless = stories.filter((s) => !s.slug || !String(s.record.title ?? '').trim());
  if (nameless.length) fail(`${nameless.length} record(s) without a slug or title`);

  // 4. no duplicates — a slug is the primary key AND the grain seed
  if (live.size !== stories.length) fail(`duplicate slugs in the set (${stories.length} records, ${live.size} distinct)`);

  console.log(
    `preflight OK — ${stories.length} published stories, all real, all published, all named.\n` +
    `  ${synthetic.size} synthetic contact-sheet record(s) confirmed ABSENT: ${[...synthetic].join(', ')}\n`,
  );
  return live;
}

async function fetchStories() {
  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) throw new Error(`cms_stories read failed: HTTP ${res.status}`);
  const all = await res.json();
  return Object.entries(all)
    .filter(([, s]) => isIndexed(s))
    .map(([slug, s]) => ({ slug, story: s, record: toRecord(slug, s) }));
}

/** Derivatives + blurhash from the rendered PNG. Same widths, quality and 4×3 components
 *  the CMS upload path uses (app/admin/page.js computeBlurhash), so a migrated cover is
 *  indistinguishable from one uploaded through the door. */
async function deriveFrom(png) {
  const sizes = {};
  for (const w of WIDTHS) {
    sizes[`w${w}`] = await sharp(png).resize({ width: w, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
  }
  const small = await sharp(png).resize({ width: 64 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hash = blurhashEncode(
    new Uint8ClampedArray(small.data), small.info.width, small.info.height, 4, 3,
  );
  return { sizes, hash };
}

const downloadUrl = (path, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

// `access_token=`, NOT `auth=`. The `auth` parameter is for legacy database secrets and
// Firebase ID tokens; a Google OAuth2 access token presented there is rejected with a bare
// HTTP 401 "Permission denied" that reads exactly like a rules problem and is not one.
// Cost an entire 158-story run to learn. scripts/backfill-cover-derivatives.mjs had it right.
async function rtdbPatch(token, updates) {
  const res = await fetch(`${DB_URL}/.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`RTDB PATCH failed: HTTP ${res.status} ${await res.text()}`);
}

async function accessToken(svc) {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    credentials: svc,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  return (await (await auth.getClient()).getAccessToken()).token;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const APPLY = !!args.apply;
  const RENDER = !!args.render || APPLY;
  const ROLLBACK = !!args.rollback;
  const manifest = loadManifest();

  if (args.status) return reportStatus(manifest);
  if (APPLY || ROLLBACK) requireSignoff();

  const stories = await fetchStories();
  preflight(stories, manifest);
  console.log(
    `${ROLLBACK ? 'ROLLBACK' : APPLY ? 'APPLYING' : RENDER ? 'RENDER ONLY (no writes)' : 'PLAN ONLY (no renders, no writes)'}` +
    ` — ${stories.length} published stories\n`,
  );

  let bucket, token;
  if (APPLY || ROLLBACK) {
    const svc = JSON.parse(readFileSync(join(ROOT, 'serviceAccountKey.json'), 'utf8'));
    initializeApp({ credential: cert(svc), storageBucket: BUCKET });
    bucket = getStorage().bucket();
    token = await accessToken(svc);
  }

  if (ROLLBACK) return rollback(manifest, token);

  mkdirSync(join(WORK_DIR, 'png'), { recursive: true });
  manifest.startedAt ??= new Date().toISOString();
  let done = 0, skipped = 0, failed = 0, withDescriptor = 0;

  for (const { slug, story, record } of stories) {
    const entry = manifest.stories[slug] ??= { state: 'pending' };
    if (entry.state === 'flipped') { skipped++; continue; }
    if (record.descriptor) withDescriptor++;

    try {
      // ── render ───────────────────────────────────────────────────────────────────────
      if (!RENDER) {
        entry.state = 'pending';
        entry.plannedPath = `${NEW_PREFIX}/${slug}/cover.png`;
        continue;
      }
      const { png, plan } = renderCover(record);
      const pngPath = join(WORK_DIR, 'png', `${slug}.png`);
      writeFileSync(pngPath, png);
      Object.assign(entry, {
        state: 'rendered', sha256: sha(png), bytes: png.length,
        livery: plan.livery.key, titleSize: plan.title.size, titleLines: plan.title.lines.length,
        descriptor: plan.descriptor?.text ?? null, footer: plan.footer,
      });

      if (!APPLY) { saveManifest(manifest); done++; continue; }

      // ── the pre-flip snapshot, captured BEFORE anything moves ────────────────────────
      // Rollback reads this and nothing else. Captured from the record we just read rather
      // than re-fetched later, so it is the state the flip is actually replacing.
      entry.old ??= {
        cover: story.cover ?? '', coverSizes: story.coverSizes ?? null, coverHash: story.coverHash ?? '',
      };

      // ── upload: PNG + both WebP rungs, all under the new prefix ──────────────────────
      const { sizes, hash } = await deriveFrom(png);
      const put = async (path, buf, contentType) => {
        const t = randomUUID();
        await bucket.file(path).save(buf, {
          contentType,
          metadata: { cacheControl: CACHE, metadata: { firebaseStorageDownloadTokens: t } },
        });
        return downloadUrl(path, t);
      };
      const coverUrl = await put(`${NEW_PREFIX}/${slug}/cover.png`, png, 'image/png');
      const newSizes = {};
      for (const w of WIDTHS) newSizes[`w${w}`] = await put(`${NEW_PREFIX}/${slug}/w${w}.webp`, sizes[`w${w}`], 'image/webp');
      Object.assign(entry, { state: 'uploaded', new: { cover: coverUrl, coverSizes: newSizes, coverHash: hash } });
      saveManifest(manifest);

      // ── the flip: ONE ATOMIC PATCH, TWO NODES ────────────────────────────────────────
      // A root-level PATCH with deep paths is applied by RTDB as a single transaction. That
      // is what makes a story atomic: there is no instant at which cms_stories points at the
      // new cover while cms_stories_index still points at the old one.
      //
      // NOTE THE ASYMMETRY, WHICH IS NOT A STYLE CHOICE.
      //
      // cms_stories takes deep paths — a merge that leaves every other field alone.
      //
      // cms_stories_index MUST NOT. A deep path (`<slug>/cover`) CREATES THE PARENT when the
      // slug has no index entry, materialising a record containing only cover fields: a stub
      // with no title, no authorUid, no date, that still counts as a member of the index.
      // That is not hypothetical — it is exactly how cms_stories_index/your-money-cannot-
      // save-you lost its authorUid and dropped a story off its author's Voices page, and
      // scripts/backfill-cover-derivatives.mjs carries the scar in its own comments.
      //
      // So the whole index record is RE-PROJECTED through buildIndexRecord from the merged
      // story: complete by construction, impossible to stub, and self-healing if the entry
      // was missing or stale to begin with.
      const merged = { ...story, cover: coverUrl, coverSizes: newSizes, coverHash: hash };
      await rtdbPatch(token, {
        [`cms_stories/${slug}/cover`]: coverUrl,
        [`cms_stories/${slug}/coverSizes`]: newSizes,
        [`cms_stories/${slug}/coverHash`]: hash,
        [`cms_stories_index/${slug}`]: buildIndexRecord(slug, merged),
      });
      entry.state = 'flipped';
      entry.flippedAt = new Date().toISOString();
      saveManifest(manifest);
      await sleep(DELAY_MS);
      done++;
      console.log(`✓ ${slug.padEnd(46)} ${entry.livery.padEnd(10)} ${entry.titleSize}px×${entry.titleLines}`);
    } catch (e) {
      entry.state = 'failed';
      entry.error = e.message;
      failed++;
      console.log(`✗ ${slug} — ${e.message}`);
      saveManifest(manifest);
    }
  }
  saveManifest(manifest);

  console.log(`\n── SUMMARY ────────────────────────────────────────────`);
  console.log(`  processed          ${done}`);
  console.log(`  already flipped    ${skipped}  (resumed — not redone)`);
  console.log(`  failed             ${failed}`);
  console.log(`  with a descriptor  ${withDescriptor} / ${stories.length}`);
  if (!APPLY) console.log(`\n  NOTHING WAS WRITTEN. No cover URL has changed.`);
  console.log(`  manifest           ${MANIFEST}`);
}

async function rollback(manifest, token) {
  const flipped = Object.entries(manifest.stories).filter(([, e]) => e.state === 'flipped' && e.old);
  console.log(`rolling back ${flipped.length} storie(s) to their pre-migration covers\n`);
  // The index is re-read so the rollback re-projects a CURRENT record rather than one this
  // process remembers — same reason as the flip: never write a partial index entry.
  const live = await (await fetch(`${DB_URL}/cms_stories.json`)).json();
  for (const [slug, e] of flipped) {
    const merged = { ...(live[slug] || {}), cover: e.old.cover, coverSizes: e.old.coverSizes, coverHash: e.old.coverHash };
    await rtdbPatch(token, {
      [`cms_stories/${slug}/cover`]: e.old.cover,
      [`cms_stories/${slug}/coverSizes`]: e.old.coverSizes,
      [`cms_stories/${slug}/coverHash`]: e.old.coverHash,
      [`cms_stories_index/${slug}`]: buildIndexRecord(slug, merged),
    });
    e.state = 'rolled-back';
    saveManifest(manifest);
    console.log(`↩ ${slug}`);
    await sleep(DELAY_MS);
  }
  // The new objects are left in Storage on purpose: rolling back a pointer should not
  // destroy the thing it pointed at, and re-applying should not have to re-upload.
  console.log(`\ndone. The typographic objects are still under ${NEW_PREFIX}/ — nothing was deleted.`);
}

function reportStatus(manifest) {
  const by = {};
  for (const e of Object.values(manifest.stories)) by[e.state] = (by[e.state] || 0) + 1;
  console.log(`manifest: ${MANIFEST}`);
  console.log(`started : ${manifest.startedAt ?? '(never run)'}`);
  for (const [k, v] of Object.entries(by).sort()) console.log(`  ${k.padEnd(12)} ${v}`);
  const failed = Object.entries(manifest.stories).filter(([, e]) => e.state === 'failed');
  if (failed.length) {
    console.log('\nfailures (a re-run retries these from the top):');
    for (const [slug, e] of failed) console.log(`  ${slug} — ${e.error}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
