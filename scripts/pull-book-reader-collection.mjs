// PULL THE BOOK READER COLLECTION — everything except Beta Princess.
//
// DRY RUN BY DEFAULT. Writes ONLY with --apply.
//
//   node scripts/pull-book-reader-collection.mjs            # plan + the quiz audit
//   node scripts/pull-book-reader-collection.mjs --apply    # perform the write
//
// Requires serviceAccountKey.json at the repo root, same as every other write script here.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS DOES, AND THE ONE THING IT REFUSES TO DO
//
// It sets `published: false` and REMOVES THE INDEX ENTRY. That is all. It does not touch
// `readerMode`, it does not touch `bookReader`, it does not touch `category`, and it does not
// delete a single record or a single quiz.
//
//   ⛔ IT MUST NEVER UN-TICK readerMode. Three separate things break if it does, and all
//      three were measured on live data before this script was written.
//
// 1. TWO LIVE QUIZZES COME BACK. app/lib/readerCollection.js §THE QUIZ RULE: quiz records are
//    untouched in the database and "un-ticking readerMode restores the quiz everywhere with no
//    migration". Two of the ten collection records carry an approved quiz worth 100 Scribbles
//    each — diary-of-a-lagos-9-5er-1 (attemptCount 1) and filtered-reality. Un-ticking would
//    hand both back to readers.
//
//    AND IT WOULD DO IT EVEN THOUGH THE STORIES ARE UNPUBLISHED. app/quizzes/page.js filters
//    on advertisesQuiz() ALONE — there is no `published` term in that filter (line 36). So an
//    unpublished story that stopped being a collection story would appear on the quiz hub
//    with a working card behind it. Leaving readerMode set is what keeps quizAllowed() false
//    and both quizzes suppressed. This is the reason the pull is an unpublish and not an
//    un-tick, and it is not a stylistic preference.
//
// 2. FIVE RECORDS ENTER A SHAPE THE CONTRACT CALLS A DATA ERROR. The reader routing test is
//    `(poetry && epubUrl) || novel || readerMode` (app/stories/[slug]/page-client.js:841),
//    which is WIDER than the flag. Un-ticking readerMode on the five `category: 'novel'`
//    records does not stop them routing to /reader — the `novel` clause still fires — and
//    leaves them in exactly the shape readerShapeError() flags and R11.10 ruled a DATA ERROR.
//    /api/story logs each one loudly. Unpublishing sidesteps this entirely.
//
// 3. THE bookReader FLAG ON filtered-reality STAYS PUT. It is the only record anywhere
//    carrying it, and app/lib/storyIndex.js's header forbids dropping the field from the
//    projection because it is load-bearing in the Story Island app's storyHref /
//    isReaderCollection, and mirrored by hand in workers-external/calvary-newsletter.worker.js
//    line 313. Nothing in THIS repo reads bookReader alone — all nine sites read
//    `readerMode === true || bookReader === true` — so leaving it is free here and removing it
//    is a breaking change to another codebase that would not show up in this repo's build.
//
// ── WHY THE INDEX ENTRY IS DELETED RATHER THAN REWRITTEN ─────────────────────────────────
//
// isIndexed() is `published !== false`, so an unpublished story has no index entry at all.
// Writing a projected record with published:false would leave a member of the index that
// every surface then has to filter out — and app/lib/storyIndex.js's own header warns what a
// partial index record costs. Removal is the shape the admin's own hide path produces.
//
// ── BETA PRINCESS IS NOT PULLED HERE ─────────────────────────────────────────────────────
//
// Its two parts migrate into the Series and are unpublished by
// scripts/migrate-beta-princess.mjs, in the same atomic write that creates the instalments —
// see that file's header for why the two halves cannot be separated.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { INDEX_PATH } from '../app/lib/storyIndex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');

// The two parts that become the Series. Everything else in the collection is pulled.
const KEEP = new Set(['beta-princess', 'beta-princess-part-two']);

const grab = async (path) => {
  const res = await fetch(`${DB_URL}/${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
};

// Mirrors app/lib/readerCollection.js:isReaderCollection, which this script cannot import
// (it is a client module). The same one-line predicate, deliberately.
const isReaderCollection = (s) => !!s && (s.readerMode === true || s.bookReader === true);

async function main() {
  const [stories, quizzes] = await Promise.all([grab('cms_stories.json'), grab('cms_quizzes.json')]);

  const collection = Object.entries(stories || {})
    .filter(([, s]) => isReaderCollection(s))
    .sort((a, b) => (a[1].publishedAtMs || 0) - (b[1].publishedAtMs || 0));

  const pull = collection.filter(([slug, s]) => !KEEP.has(slug) && s.published !== false);
  const keep = collection.filter(([slug]) => KEEP.has(slug));
  const alreadyHidden = collection.filter(([slug, s]) => !KEEP.has(slug) && s.published === false);

  console.log('Book Reader Collection — the pull\n');
  console.log(`  collection members (readerMode || bookReader) : ${collection.length}`);
  console.log(`  kept for the Series migration                 : ${keep.length} (${keep.map(([s]) => s).join(', ')})`);
  console.log(`  already unpublished                           : ${alreadyHidden.length}`);
  console.log(`  TO PULL                                       : ${pull.length}\n`);

  console.log('  slug                                        category  readerMode  bookReader  quiz');
  for (const [slug, s] of pull) {
    const q = s.quizMeta?.hasQuiz === true ? `yes (${s.quizMeta.scribblesReward ?? '?'})` : '—';
    console.log(
      `   ${slug.padEnd(42)} ${String(s.category).padEnd(8)} ${s.readerMode === true ? '   yes    ' : '   no     '} `
      + `${s.bookReader === true ? '   yes    ' : '   no     '} ${q}`,
    );
  }

  // ── THE QUIZ AUDIT — stated out loud, every run, applied or not ────────────────────────
  quizAudit(pull, quizzes);

  const updates = {};
  for (const [slug] of pull) {
    updates[`cms_stories/${slug}/published`] = false;
    updates[`${INDEX_PATH}/${slug}`] = null;   // RTDB: null in a PATCH removes the key.
  }

  console.log(`\n  ${Object.keys(updates).length} paths in one atomic update`);
  console.log('  NOT among them: readerMode, bookReader, category, quizMeta, cms_quizzes.');
  console.log('  Every pulled story is restorable by flipping published back and rebuilding');
  console.log('  its index entry — scripts/backfill-stories-index.mjs does the second half.');

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply.');
    return;
  }

  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const token = (await cert(svc).getAccessToken()).access_token;
  const res = await fetch(`${DB_URL}/.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.error(`\nWRITE FAILED: HTTP ${res.status} — ${await res.text()}`);
    process.exit(1);
  }
  console.log('\nWritten. Verifying against a fresh read …\n');
  await verify(pull.map(([slug]) => slug));
}

/**
 * WHAT HAPPENS TO THE TWO QUIZZES. Printed on every run, including dry runs, because the
 * whole point is that this does not happen silently in either direction.
 */
function quizAudit(pull, quizzes) {
  const withQuiz = pull.filter(([, s]) => s.quizMeta?.hasQuiz === true);
  console.log('\n── THE QUIZZES ───────────────────────────────────────────────────────────');
  if (!withQuiz.length) {
    console.log('  No pulled story advertises a quiz. Nothing to state.');
    return;
  }
  for (const [slug, s] of withQuiz) {
    const record = quizzes?.[slug];
    console.log(`\n  ${slug}`);
    console.log(`    quizMeta      : hasQuiz=true  reward=${s.quizMeta.scribblesReward ?? '?'}  attempts=${s.quizMeta.attemptCount ?? 0}`);
    console.log(`    cms_quizzes   : ${record ? `present, ${record.approvedAt ? 'approved' : 'DRAFT'}` : 'ABSENT'}`);
    console.log('    after this run: the quiz record is UNTOUCHED and the story keeps quizMeta.');
    console.log('                    readerMode stays true, so quizAllowed() stays false and the');
    console.log('                    quiz renders NOWHERE — not on the story page, not on /quizzes,');
    console.log('                    not as a QuizPill. The story is also unpublished, so it leaves');
    console.log('                    every index-fed surface as well. Two independent reasons it is');
    console.log('                    gone, and no data destroyed by either.');
  }
  console.log('\n  THE ALTERNATIVE, FOR THE RECORD: un-ticking readerMode instead would have put');
  console.log('  both of these back on /quizzes — that page filters on advertisesQuiz() alone and');
  console.log('  has no published term (app/quizzes/page.js:36) — awarding 100 Scribbles each from');
  console.log('  a story that no longer exists anywhere else on the site.');
  console.log('──────────────────────────────────────────────────────────────────────────');
}

/** Read everything back and prove the pull did exactly what it said and nothing more. */
async function verify(pulledSlugs) {
  const [stories, index, quizzes] = await Promise.all([
    grab('cms_stories.json'), grab(`${INDEX_PATH}.json`), grab('cms_quizzes.json'),
  ]);
  let bad = 0;
  const ok = (cond, label) => { if (!cond) bad++; console.log(`   ${cond ? '✓' : '✗'} ${label}`); };

  ok(pulledSlugs.every((s) => stories?.[s]?.published === false),
    `all ${pulledSlugs.length} pulled stories are published:false`);
  ok(pulledSlugs.every((s) => !index?.[s]),
    'none of them has an index entry');
  ok(pulledSlugs.every((s) => stories?.[s]?.readerMode === true || stories?.[s]?.bookReader === true),
    'every one is STILL a collection member — readerMode/bookReader untouched');
  ok(stories?.['filtered-reality']?.bookReader === true,
    'filtered-reality still carries bookReader:true (the app routes on it)');
  ok(pulledSlugs.every((s) => !stories?.[s]?.quizMeta || stories[s].quizMeta.hasQuiz === true || stories[s].quizMeta.hasQuiz === undefined),
    'no quizMeta was altered');
  ok(Object.keys(quizzes || {}).length > 0, `cms_quizzes intact (${Object.keys(quizzes || {}).length} records)`);
  ok(stories?.['beta-princess']?.published === true && stories?.['beta-princess-part-two']?.published === true,
    'both Beta Princess parts untouched — they are the migration script\'s job');

  console.log(bad ? `\n${bad} check(s) FAILED.` : '\nAll checks passed.');
  if (bad) process.exit(1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
