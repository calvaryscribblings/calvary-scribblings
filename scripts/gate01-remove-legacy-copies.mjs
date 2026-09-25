#!/usr/bin/env node
// GATE-01 — delete the public legacy copies of withdrawn book text. W4, ruled by Ikenna 24–25 Sep.
//
//   node scripts/gate01-remove-legacy-copies.mjs            # dry run: inventory + counts
//   node scripts/gate01-remove-legacy-copies.mjs --apply    # back up, verify the backup, delete
//
// WHAT IT TAKES, and only this:
//   · every object under the legacy public Storage prefix `epubs/` that NO PUBLISHED story uses —
//     including the Beta Princess I1 and I2 copies that are byte-identical (md5) to the locked
//     series_epubs/*/master.epub the Series tier gate protects;
//   · `extractedText` and `epubUrl` on every WITHDRAWN BOOK in cms_stories (unpublished,
//     reader-mode, not scheduled) — the full text of withdrawn books, still readable by anyone
//     with one unauthenticated GET. Scheduled and hidden prose records are not touched.
// A published story's epubUrl and its object are never touched: reader-mode books that are live
// are public by design (STORY-SERVING-CONTRACT §3.5 carve-out).
//
// THE BACKUP COMES FIRST: every object is downloaded to backups/gate-01/<stamp>/ and its md5
// checked against Storage's before anything is deleted; the removed RTDB fields are written to
// the same folder. RTDB also has its daily archive; Storage does not — this folder is the only
// copy of the deleted objects.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { servesAsReader } from '../app/lib/storyAccess.js';

export const LEGACY_PREFIX = 'epubs/';
const BUCKET = 'calvary-scribblings.firebasestorage.app';
const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

/** The object path an epubUrl points at, or null. */
export function objectOfUrl(url) {
  const m = /\/o\/([^?]+)/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * A WITHDRAWN BOOK: unpublished, a reader-mode (book) record, and not scheduled to publish. A
 * scheduled story is unpublished too, and so is a hidden news piece — neither is withdrawn book
 * text, and neither is touched. Pure.
 */
export function isWithdrawnBook(s, now = Date.now()) {
  if (!s || s.published !== false) return false;
  if (!servesAsReader(s)) return false;
  const at = typeof s.publishAt === 'string' ? Date.parse(s.publishAt) : NaN;
  return !(Number.isFinite(at) && at > now);
}

/**
 * The plan. Pure.
 * @param stories  the cms_stories node
 * @param objects  [{ name, md5 }] under LEGACY_PREFIX
 */
export function planRemoval(stories, objects, now = Date.now()) {
  const usedByPublished = new Set();
  for (const s of Object.values(stories || {})) {
    if (s && s.published !== false && typeof s.epubUrl === 'string') {
      const o = objectOfUrl(s.epubUrl);
      if (o) usedByPublished.add(o);
    }
  }
  const deleteObjects = objects.filter((o) => o.name.startsWith(LEGACY_PREFIX) && !usedByPublished.has(o.name));
  const keptObjects = objects.filter((o) => !deleteObjects.includes(o));
  const fieldNulls = {};
  const strippedRecords = [];
  for (const [slug, s] of Object.entries(stories || {})) {
    if (!isWithdrawnBook(s, now)) continue;
    const had = ['extractedText', 'epubUrl'].filter((k) => k in s);
    if (!had.length) continue;
    for (const k of had) fieldNulls[`cms_stories/${slug}/${k}`] = null;
    strippedRecords.push(slug);
  }
  return { deleteObjects, keptObjects, fieldNulls, strippedRecords };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const { getStorage } = await import('firebase-admin/storage');
  initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'serviceAccountKey.json', 'utf8'))), databaseURL: DATABASE_URL });
  const db = getDatabase();
  const bucket = getStorage().bucket(BUCKET);

  const stories = (await db.ref('cms_stories').get()).val() || {};
  const [files] = await bucket.getFiles({ prefix: LEGACY_PREFIX });
  const objects = files.map((f) => ({ name: f.name, md5: f.metadata.md5Hash, size: Number(f.metadata.size) }));
  const [masters] = await bucket.getFiles({ prefix: 'series_epubs/' });
  const masterByMd5 = new Map(masters.map((f) => [f.metadata.md5Hash, f.name]));
  const plan = planRemoval(stories, objects);

  console.log(`epubs/ objects: ${objects.length} — delete ${plan.deleteObjects.length}, keep ${plan.keptObjects.length} (used by a published story)`);
  for (const o of plan.deleteObjects) console.log(`  - ${o.name}  ${o.size} B${masterByMd5.has(o.md5) ? `  == ${masterByMd5.get(o.md5)} (a locked Series master)` : ''}`);
  console.log(`withdrawn books losing extractedText/epubUrl: ${plan.strippedRecords.length}`);
  for (const s of plan.strippedRecords) console.log(`  - cms_stories/${s}  (${Object.keys(plan.fieldNulls).filter((k) => k.startsWith(`cms_stories/${s}/`)).map((k) => k.split('/').pop()).join(', ')})`);
  if (!apply) { console.log('\nDRY RUN — nothing written. Add --apply.'); process.exit(0); }

  const dir = join('backups', 'gate-01', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(join(dir, 'epubs'), { recursive: true });
  for (const o of plan.deleteObjects) {
    const [buf] = await bucket.file(o.name).download();
    const md5 = createHash('md5').update(buf).digest('base64');
    if (md5 !== o.md5) throw new Error(`backup of ${o.name} does not match Storage's md5 — stopping, nothing deleted`);
    writeFileSync(join(dir, o.name), buf);
  }
  const removedFields = Object.fromEntries(plan.strippedRecords.map((slug) => [slug, {
    extractedText: stories[slug].extractedText ?? null, epubUrl: stories[slug].epubUrl ?? null,
  }]));
  writeFileSync(join(dir, 'removed-fields.json'), JSON.stringify(removedFields, null, 2));
  console.log(`\nbackup: ${dir} (${plan.deleteObjects.length} objects md5-verified, ${plan.strippedRecords.length} records' fields)`);

  if (Object.keys(plan.fieldNulls).length) await db.ref().update(plan.fieldNulls);
  for (const o of plan.deleteObjects) await bucket.file(o.name).delete();

  const [after] = await bucket.getFiles({ prefix: LEGACY_PREFIX });
  const still = after.filter((f) => plan.deleteObjects.some((o) => o.name === f.name));
  const storiesAfter = (await db.ref('cms_stories').get()).val() || {};
  const fieldsLeft = plan.strippedRecords.filter((s) => storiesAfter[s]?.extractedText || storiesAfter[s]?.epubUrl);
  console.log(still.length || fieldsLeft.length
    ? `✗ ${still.length} object(s) and ${fieldsLeft.length} record(s) still carry text`
    : `✓ deleted ${plan.deleteObjects.length} objects; stripped ${plan.strippedRecords.length} records; read back clean`);
  process.exit(still.length || fieldsLeft.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message || e); process.exit(1); });
