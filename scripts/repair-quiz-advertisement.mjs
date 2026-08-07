// Restore the quiz advertisement on stories whose approved quiz stopped being
// advertised, and prove the repair against live data afterwards.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/repair-quiz-advertisement.mjs            # plan + verify only
//   node scripts/repair-quiz-advertisement.mjs --apply    # perform the write
//
// ── What went wrong ──────────────────────────────────────────────────────────
// The story editor (app/admin/page.js) used to save a story as a WHOLESALE node
// replacement — `update(ref(db), { 'cms_stories/<slug>': storyData })`, where a
// path→object value replaces the node entirely. storyData is the editor's form,
// so every field living on the node that the form did not own was deleted on
// every save. quizMeta was one of them.
//
// Nothing flagged it, because indexUpdatePaths() ran in the SAME atomic update
// and projected the absence faithfully: the index agreed with the record, so a
// drift check saw a healthy pair. The loss was only visible as a missing badge.
//
// Readers kept taking the quizzes throughout. The story page gates its card on
// quizAllowed() — "not a reader-collection story" — NOT on hasQuiz, and QuizCard
// fetches cms_quizzes/<slug> and decides for itself. So the card still rendered
// and still awarded points; what vanished was every POINTER to it (the "✦ This
// story has a quiz" pill, the /quizzes hub row, the library/search QuizPill).
// The proof is in the data: these stories carry attemptCount 1–9, and only the
// token-verified record-attempt endpoint writes that field.
//
// That endpoint also explains the wreckage's shape. It increments the DEEP path
// cms_stories/<slug>/quizMeta/attemptCount, and a deep-path write CREATES its
// parent — so a story whose quizMeta had been deleted got a new one holding
// attemptCount and nothing else. Same hazard app/lib/storyIndex.js documents for
// the index. Hence two populations: quizMeta{attemptCount} where a reader had
// since taken the quiz, and no quizMeta at all where nobody had.
//
// The editor's per-field write (R11.1) stops the deletion. This script repairs
// what the old behaviour already destroyed.
//
// ── Why this writes deep paths, not a quizMeta object ────────────────────────
// The obvious repair — rebuild the whole quizMeta block, carrying attemptCount
// over from a prior read — reintroduces the very race the editor fix removed:
// record-attempt increments that counter server-side, so a value read here and
// written back a moment later silently reverses any attempt landed in between.
// This writes only the three editorial fields as their own paths and never reads
// or writes attemptCount at all. It is idempotent and safe to re-run.
//
// ── Who is excluded, and why that is not an oversight ────────────────────────
// Reader-collection stories (readerMode/bookReader) are SKIPPED even though they
// have an approved quiz. R7.3 §A removed quizzes from the collection: quizAllowed
// is false there, so the card does not render. Advertising one would produce
// exactly the defect app/lib/readerCollection.js:47-51 warns about — a pill that
// promises a quiz and a tap that arrives where the quiz is gone. A missing pill
// is a smaller wrong than a lying one.
//
// Requires serviceAccountKey.json at the repo root (same as the other scripts/).

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { buildQuizSummary, isIndexed, INDEX_PATH } from '../app/lib/storyIndex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');

const grab = async (path) => {
  const res = await fetch(`${DB_URL}/${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
};

// Mirrors app/lib/readerCollection.js:isReaderCollection, which this script cannot
// import (it is a client module). Kept as the same one-line predicate.
const isReaderCollection = (s) => !!s && (s.readerMode === true || s.bookReader === true);

async function main() {
  const [stories, quizzes, index] = await Promise.all([
    grab('cms_stories.json'), grab('cms_quizzes.json'), grab(`${INDEX_PATH}.json`),
  ]);

  const repair = [];
  const skippedCollection = [];
  const skippedDraft = [];
  const skippedNoStory = [];

  for (const [slug, quiz] of Object.entries(quizzes || {})) {
    const story = stories?.[slug];
    if (!story) { skippedNoStory.push(slug); continue; }
    // No approvedAt means the quiz is a saved draft, deliberately not advertised.
    if (!quiz.approvedAt) { skippedDraft.push(slug); continue; }
    if (story.quizMeta?.hasQuiz === true) continue;           // already healthy
    if (isReaderCollection(story)) { skippedCollection.push(slug); continue; }
    repair.push({
      slug,
      title: story.title || slug,
      reward: quiz.maxPoints ?? 50,
      approvedAt: quiz.approvedAt,
      attempts: story.quizMeta?.attemptCount ?? 0,
      indexed: isIndexed(story),
      published: story.published !== false,
    });
  }

  console.log('Quiz advertisement repair plan\n');
  console.log(`  quiz records          : ${Object.keys(quizzes || {}).length}`);
  console.log(`  already advertised    : ${Object.values(stories || {}).filter(s => s?.quizMeta?.hasQuiz === true).length}`);
  console.log(`  TO REPAIR             : ${repair.length}`);
  console.log(`  skipped, collection   : ${skippedCollection.length}${skippedCollection.length ? ` → ${skippedCollection.join(', ')}` : ''}`);
  console.log(`  skipped, draft quiz   : ${skippedDraft.length}`);
  console.log(`  skipped, no story     : ${skippedNoStory.length}`);

  if (!repair.length) {
    // Still verify. A clean plan is the expected state after a successful run, and
    // "nothing to repair" is only good news if the invariants actually hold — this
    // doubles as the standing check that they still do.
    console.log('\nNothing to repair. Verifying the invariants anyway …\n');
    await verify([]);
    return;
  }

  console.log('\n  slug                                                     attempts  indexed  reward');
  for (const r of repair) {
    console.log(`   ${r.slug.padEnd(56)} ${String(r.attempts).padStart(5)}  ${r.indexed ? '  yes  ' : '  no   '}  ${String(r.reward).padStart(5)}`);
  }

  // One atomic multi-path PATCH: the record's editorial quiz fields and the
  // index's slim badge land together, so the pair can never half-write. The
  // index entry exists only for published stories — an unpublished story gets
  // its record repaired and no index path (unhideStory rebuilds the entry from
  // quizMeta when it is published, so the badge follows automatically).
  const updates = {};
  for (const r of repair) {
    updates[`cms_stories/${r.slug}/quizMeta/hasQuiz`] = true;
    updates[`cms_stories/${r.slug}/quizMeta/scribblesReward`] = r.reward;
    updates[`cms_stories/${r.slug}/quizMeta/publishedAt`] = r.approvedAt;
    if (r.indexed) {
      updates[`${INDEX_PATH}/${r.slug}/quiz`] = buildQuizSummary({ hasQuiz: true, scribblesReward: r.reward });
    }
  }
  console.log(`\n  ${Object.keys(updates).length} paths in one atomic update`);
  console.log('  attemptCount is NOT among them — the counter is never read or written.');

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
  await verify(repair);
}

// Read everything back and prove three things: the repaired slugs advertise, the
// record and the index agree across EVERY quiz, and the attempt counters are
// exactly what they were before the write.
async function verify(repaired = []) {
  const repairedSlugs = repaired.map(r => r.slug);
  const [stories, quizzes, index] = await Promise.all([
    grab('cms_stories.json'), grab('cms_quizzes.json'), grab(`${INDEX_PATH}.json`),
  ]);
  let bad = 0;
  const ok = (cond, label) => { if (!cond) bad++; console.log(`   ${cond ? '✓' : '✗'} ${label}`); };

  const advertised = Object.entries(stories || {}).filter(([, s]) => s?.quizMeta?.hasQuiz === true);
  ok(repairedSlugs.every(s => stories?.[s]?.quizMeta?.hasQuiz === true),
    `all ${repairedSlugs.length} repaired stories advertise their quiz`);

  // The whole reason this writes deep paths: prove the counters survived. A
  // reader taking a quiz mid-run moves one UP, which is fine and not a failure —
  // what must never happen is a counter going DOWN, which is what a
  // read-merge-write would have caused.
  const lowered = repaired.filter(r => (stories?.[r.slug]?.quizMeta?.attemptCount ?? 0) < r.attempts);
  ok(lowered.length === 0,
    `no attempt counter went backwards${lowered.length ? ` — ${lowered.map(r => `${r.slug} ${r.attempts}→${stories?.[r.slug]?.quizMeta?.attemptCount}`).join(', ')}` : ` (${repaired.reduce((n, r) => n + r.attempts, 0)} attempts preserved across ${repaired.length} stories)`}`);

  // Projection drift across every quiz — the check that would have caught this
  // had the record and the index not been broken in the same breath.
  const drift = Object.keys(quizzes || {}).filter((slug) => {
    const s = stories?.[slug]; const i = index?.[slug];
    if (!s || !i) return false;
    return (s.quizMeta?.hasQuiz === true) !== (i.quiz?.hasQuiz === true);
  });
  ok(drift.length === 0, `zero projection drift across all ${Object.keys(quizzes || {}).length} quizzes${drift.length ? ` — ${drift.join(', ')}` : ''}`);

  // The /quizzes hub filters on advertisesQuiz over cms_stories, and excludes the
  // collection. This is that same predicate, so the count is what the hub renders.
  const hub = advertised.filter(([slug, s]) => !isReaderCollection(s) && quizzes?.[slug]);
  ok(repairedSlugs.every(s => hub.some(([slug]) => slug === s)),
    `all repaired stories appear in the /quizzes hub (hub now lists ${hub.length})`);

  const phantom = advertised.filter(([slug]) => !quizzes?.[slug]);
  ok(phantom.length === 0, `no story advertises a quiz that does not exist${phantom.length ? ` — ${phantom.map(([s]) => s).join(', ')}` : ''}`);

  // What matters is the predicate the SURFACES call, not the raw stored flag.
  // advertisesQuiz() is `quizAllowed(story) && hasQuiz`, so a collection story is
  // never advertised however its quizMeta reads — R7.3 §A left the DB records
  // alone on purpose and moved the gate into rendering. Two collection stories do
  // still carry hasQuiz in storage (diary-of-a-lagos-9-5er-1 and filtered-reality,
  // named and audited in app/lib/readerCollection.js:47-51); that is inert, and
  // this run neither created it nor added to it. Test the effective predicate.
  const advertisesQuiz = (s) => !isReaderCollection(s) && s?.quizMeta?.hasQuiz === true;
  const lying = Object.entries(stories || {}).filter(([slug, s]) => advertisesQuiz(s) && !quizzes?.[slug]);
  ok(lying.length === 0, `nothing the app advertises is unrenderable${lying.length ? ` — ${lying.map(([s]) => s).join(', ')}` : ''}`);

  const inert = advertised.filter(([, s]) => isReaderCollection(s)).map(([slug]) => slug);
  console.log(`   · ${inert.length} collection story record(s) still carry hasQuiz in storage, inert behind quizAllowed${inert.length ? ` — ${inert.join(', ')}` : ''}`);

  console.log(bad === 0 ? '\n✓ repair verified' : `\n✗ ${bad} check(s) failed`);
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
