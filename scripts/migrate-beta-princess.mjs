// MIGRATE BETA PRINCESS INTO THE SERIES — the one piece of real content the Series starts
// with. Its two published parts become instalments 1 and 2.
//
// DRY RUN BY DEFAULT. Writes ONLY with --apply.
//
//   node scripts/migrate-beta-princess.mjs            # plan, with the object paths resolved
//   node scripts/migrate-beta-princess.mjs --apply    # copy the files, write the records
//
// Requires serviceAccountKey.json at the repo root.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// IT IS A MOVE, NOT A COPY, AND THAT IS THE WHOLE POINT
//
// The two cms_stories records are UNPUBLISHED in the same atomic write that publishes the
// instalments. Leaving them up would make the gate ornamental, and it is worth being precise
// about why, because "we could leave the old ones as a free taster" is a reasonable-sounding
// thing to suggest later and it is wrong.
//
// cms_stories/beta-princess.epubUrl is a permanent Firebase Storage download URL under
// `epubs/**`, which storage.rules keeps at `allow read: if true`, and it carries its own
// access token in the query string. cms_stories itself is `.read: true`. So ANYONE — signed
// out, no membership, one curl — can read the record and fetch the file. If that record stays
// published, instalments 1 and 2 are Platinum-gated and simultaneously world-readable at a
// second URL, and the gate protects nothing at all. That is not a hypothetical: it is exactly
// the arrangement the whole Book Reader Collection shipped with, and the reason none of it
// could ever be gated.
//
// So: same bytes, new home, old door closed. One atomic multi-path PATCH so the two halves
// cannot disagree — a window in which the story is unpublished and the instalment is not yet
// live is a window in which the content is simply gone.
//
// ── THE FILES ARE COPIED FIRST, OUTSIDE THE TRANSACTION ──────────────────────────────────
//
// The GCS copy runs BEFORE the database write and is verified before anything is published.
// The failure modes are not symmetric: a file copied with no records pointing at it is dead
// weight in a bucket, while a published instalment with no file behind it is a Platinum
// member paying for a 502. The cheap failure goes first.
//
// The originals under `epubs/` are NOT deleted. They are the rollback: flipping `published`
// back on the two records restores the old state exactly, with no file restore step. Delete
// them in a later round, deliberately, once the Series has proven itself.
//
// ── WHAT THE INSTALMENTS INHERIT, AND WHAT THEY DO NOT ───────────────────────────────────
//
// Inherited: title, author, authorUid, authorHandle, cover, and the bytes. authorUid matters
// more than it looks — Voices, search and the app's profile → myStories all key off it, and
// an instalment without it is invisible to all three.
//
// NOT inherited: publishedAtMs. An instalment's releaseAtMs is a NEW editorial fact, not the
// old publication date. Both of these parts are already out, so both release in the past and
// are readable the moment the Series goes live — but the script sets the value explicitly
// rather than copying publishedAtMs, so that nobody later reads a coincidence as a rule.
//
// freeForGold: instalment 1 TRUE, instalment 2 FALSE. Set explicitly, per instalment. It is
// NOT `ordinal === 1` and must never become that — see app/lib/series/schema.js.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { INDEX_PATH } from '../app/lib/storyIndex.js';
import {
  SCHEMA_VERSION,
  SERIES_PATH,
  INSTALMENTS_PATH,
  INSTALMENTS_DETAIL_PATH,
  epubObjectPath,
  validateSeries,
  validateInstalment,
  validateInstalmentDetail,
} from '../app/lib/series/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';

const APPLY = process.argv.includes('--apply');

const SERIES_ID = 'beta-princess';

// The two source records, in order. `ordinal` and `freeForGold` are editorial decisions and
// are written here rather than derived, so a reader of this file can see them.
const PLAN = [
  { slug: 'beta-princess',          ordinal: 1, freeForGold: true,  title: 'Part One' },
  { slug: 'beta-princess-part-two', ordinal: 2, freeForGold: false, title: 'Part Two' },
];

const grab = async (path) => {
  const res = await fetch(`${DB_URL}/${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
};

/** The Cloud Storage object path out of a Firebase download URL. */
function objectPathFromUrl(url) {
  const m = /\/o\/([^?]+)/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Server-side object copy. No bytes travel through this process. */
async function copyObject(token, from, to) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}`
    + `/o/${encodeURIComponent(from)}/copyTo/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(to)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'application/epub+zip' }),
  });
  if (!res.ok) throw new Error(`copy ${from} → ${to} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  const stories = await grab('cms_stories.json');
  const now = Date.now();

  const rows = PLAN.map((p) => {
    const s = stories?.[p.slug];
    if (!s) throw new Error(`source story ${p.slug} not found`);
    return { ...p, source: s, from: objectPathFromUrl(s.epubUrl), to: epubObjectPath(`${SERIES_ID}-i${p.ordinal}`) };
  });

  console.log('Beta Princess → the Series\n');
  for (const r of rows) {
    console.log(`  instalment ${r.ordinal}  ${r.source.title}`);
    console.log(`    from  ${r.from}`);
    console.log(`    to    ${r.to}`);
    console.log(`    author ${r.source.author} <${r.source.authorHandle}> uid=${r.source.authorUid}`);
    console.log(`    freeForGold ${r.freeForGold}`);
    if (!r.from) throw new Error(`could not resolve an object path from ${r.slug}.epubUrl`);
    if (!r.source.authorUid) throw new Error(`${r.slug} has no authorUid — an instalment without one is invisible to Voices, search and myStories`);
  }

  // ── the records ────────────────────────────────────────────────────────────
  const series = {
    schemaVersion: SCHEMA_VERSION,
    slug: SERIES_ID,
    title: 'Beta Princess',
    synopsis: 'A novella in instalments by Monica Garcia.',
    // The POSTER. Part One's cover is used as the placeholder rather than invented, and it is
    // flagged here because it is the one field in this migration that is a stand-in: a series
    // poster is meant to be distinct from any instalment's art (see SERIES_SCHEMA), and this
    // one is not yet. Replace it in the admin before launch.
    coverUrl: rows[0].source.cover || null,
    status: 'published',
    addedAt: now,
    updatedAt: now,
  };
  const seriesCheck = validateSeries(series);
  if (!seriesCheck.valid) throw new Error(`series record invalid: ${seriesCheck.errors.join('; ')}`);

  const updates = { [`${SERIES_PATH}/${SERIES_ID}`]: series };

  for (const r of rows) {
    const id = `${SERIES_ID}-i${r.ordinal}`;
    const row = {
      schemaVersion: SCHEMA_VERSION,
      seriesId: SERIES_ID,
      ordinal: r.ordinal,
      // Already published, so already released. Set to the migration instant rather than
      // copied from publishedAtMs — see the header on why the two are not the same fact.
      releaseAtMs: now,
      freeForGold: r.freeForGold,
      status: 'published',
      addedAt: now,
      updatedAt: now,
    };
    const detail = {
      schemaVersion: SCHEMA_VERSION,
      title: r.title,
      synopsis: r.source.trailerQuote || null,
      author: r.source.author || '',
      authorUid: r.source.authorUid || '',
      authorHandle: r.source.authorHandle || '',
      coverUrl: r.source.cover || null,
      epubPath: r.to,
      updatedAt: now,
    };
    const rc = validateInstalment(row);
    if (!rc.valid) throw new Error(`instalment ${id} invalid: ${rc.errors.join('; ')}`);
    const dc = validateInstalmentDetail(detail, { publishing: true });
    if (!dc.valid) throw new Error(`instalment detail ${id} invalid: ${dc.errors.join('; ')}`);

    updates[`${INSTALMENTS_PATH}/${id}`] = row;
    updates[`${INSTALMENTS_DETAIL_PATH}/${id}`] = detail;

    // THE OLD DOOR, CLOSED IN THE SAME WRITE. See the header.
    updates[`cms_stories/${r.slug}/published`] = false;
    updates[`${INDEX_PATH}/${r.slug}`] = null;
  }

  console.log(`\n  ${Object.keys(updates).length} database paths in one atomic update`);
  console.log('  including cms_stories/<slug>/published = false for BOTH source records —');
  console.log('  leaving them up would keep the same EPUB world-readable at a public URL and');
  console.log('  make the Platinum gate ornamental. The files under epubs/ are NOT deleted;');
  console.log('  they are the rollback.');
  console.log('\n  NOT touched: readerMode, bookReader, category, quizMeta, cms_quizzes.');
  console.log('  Neither Beta Princess record carries a quiz (verified live, 2026-08-16).');

  if (!APPLY) {
    console.log('\nDRY RUN — no writes, no copies. Re-run with --apply.');
    return;
  }

  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const token = (await cert(svc).getAccessToken()).access_token;

  // Files first, outside the transaction. See the header.
  for (const r of rows) {
    process.stdout.write(`\n  copying ${r.from} → ${r.to} … `);
    const meta = await copyObject(token, r.from, r.to);
    console.log(`ok (generation ${meta.generation})`);
  }

  const res = await fetch(`${DB_URL}/.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.error(`\nWRITE FAILED: HTTP ${res.status} — ${await res.text()}`);
    console.error('The copied files are harmless orphans; re-running is safe.');
    process.exit(1);
  }

  console.log('\nWritten. Verifying against a fresh read …\n');
  await verify();
}

async function verify() {
  const [stories, series, rows, details, index] = await Promise.all([
    grab('cms_stories.json'),
    grab(`${SERIES_PATH}/${SERIES_ID}.json`),
    grab(`${INSTALMENTS_PATH}.json`),
    grab(`${INSTALMENTS_DETAIL_PATH}.json`),
    grab(`${INDEX_PATH}.json`),
  ]);
  let bad = 0;
  const ok = (cond, label) => { if (!cond) bad++; console.log(`   ${cond ? '✓' : '✗'} ${label}`); };

  ok(series?.status === 'published', 'the series record is published');
  for (const p of PLAN) {
    const id = `${SERIES_ID}-i${p.ordinal}`;
    ok(rows?.[id]?.status === 'published', `${id} row published`);
    ok(rows?.[id]?.freeForGold === p.freeForGold, `${id} freeForGold=${p.freeForGold}`);
    ok(typeof rows?.[id]?.releaseAtMs === 'number', `${id} releaseAtMs is a NUMBER`);
    ok(!!details?.[id]?.authorUid, `${id} detail carries authorUid`);
    ok(stories?.[p.slug]?.published === false, `${p.slug} is unpublished — the free door is shut`);
    ok(!index?.[p.slug], `${p.slug} has no index entry`);
    ok(stories?.[p.slug]?.readerMode === true, `${p.slug} readerMode untouched (restorable)`);
  }

  console.log(bad ? `\n${bad} check(s) FAILED.` : '\nAll checks passed.');
  if (bad) process.exit(1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
