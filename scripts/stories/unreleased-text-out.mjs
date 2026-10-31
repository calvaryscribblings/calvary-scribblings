// TAKE AN UNRELEASED STORY'S TEXT OUT OF THE PUBLIC DATABASE — PROOFS-R1, ruling 255.
//
//   node scripts/stories/unreleased-text-out.mjs           # dry run: counts only, writes nothing
//   node scripts/stories/unreleased-text-out.mjs --apply   # check, back up, then remove
//
// From this round on every writer keeps a story's text off cms_stories/<slug> while the story is
// not live (app/lib/storyText.js). This brings the records written before it into the same shape:
// for every record that is NOT live (isReadableStory false: scheduled, held, hidden, retired,
// draft) it removes `content` and `extractedText` from cms_stories/<slug>. Their copy in
// story_bodies/<slug> stays; that is where /api/story, the CMS and the go-live paths read it.
//
// ── THE CHECK COMES FIRST ───────────────────────────────────────────────────────────────────
// A record's text is removed only where story_bodies holds an IDENTICAL copy, compared the way
// scripts/backfill-story-bodies.mjs --verify compares (missing = ''), field by field. A public
// field that is EMPTY has nothing to lose, so it passes whatever story_bodies holds: measured
// 31 Oct, 8 retired Book Reader records have an emptied public extractedText while story_bodies
// kept the extraction. Those are counted apart ("story_bodies holds more"). If any record has no
// copy, or a different one, --apply refuses the whole run and writes nothing.
//
// ── AND EACH REMOVAL IS CONDITIONAL ─────────────────────────────────────────────────────────
// One transaction per record. If the story went live after the plan was read (the Worker's */15
// tick), or its text changed, that record is left exactly as it is and counted.
//
// ── OUTPUT ──────────────────────────────────────────────────────────────────────────────────
// Counts only. Never story text and never a credential. The backup (backups/, gitignored) holds
// the removed fields and the story_bodies copies of every record touched, read back before any
// write. Restore = write those fields back to cms_stories/<slug>.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReadableStory } from '../../app/lib/storyAccess.js';
import { BODIES_PATH, BODY_FIELDS, STORIES_PATH } from '../../app/lib/storyText.js';
import { storyStatus } from '../../app/lib/storyState.js';
import { RETIRED_PATH } from '../../app/lib/retiredStories.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const norm = (v) => (typeof v === 'string' ? v : '');
const hasText = (rec) => BODY_FIELDS.some((f) => rec?.[f] != null);
/** Is everything the public record holds also in story_bodies? (An empty public field holds nothing.) */
const keptIn = (pub, copy) => BODY_FIELDS.every((f) => norm(pub?.[f]) === '' || norm(pub?.[f]) === norm(copy?.[f]));
const sameText = (a, b) => BODY_FIELDS.every((f) => norm(a?.[f]) === norm(b?.[f]));

/** Pure. Which records lose their public text, and which can't yet. Slugs and counts only. */
export function planTextOut(stories, bodies) {
  const plan = { total: 0, live: 0, notLiveClean: 0, remove: [], bodiesHoldMore: [], missing: [], differs: [] };
  for (const [slug, rec] of Object.entries(stories || {})) {
    plan.total++;
    if (isReadableStory(rec)) { plan.live++; continue; }
    if (!hasText(rec)) { plan.notLiveClean++; continue; }
    const copy = bodies?.[slug];
    if (!copy) plan.missing.push(slug);
    else if (!keptIn(rec, copy)) plan.differs.push(slug);
    else {
      plan.remove.push(slug);
      if (!sameText(rec, copy)) plan.bodiesHoldMore.push(slug);
    }
  }
  return plan;
}

/**
 * The removal, one transaction per record. `db` is anything with ref(path).transaction(fn)
 * (firebase-admin, or the emulator's client in the tests). `bodies` is the story_bodies read the
 * plan was made from. Returns { removed, skippedLive, skippedChanged }.
 */
export async function applyTextOut(db, plan, bodies) {
  const out = { removed: 0, skippedLive: 0, skippedChanged: 0 };
  for (const slug of plan.remove) {
    let why = null;
    const res = await db.ref(`${STORIES_PATH}/${slug}`).transaction((cur) => {
      // null is the SDK's first guess before it has the server's value: hand it back unchanged so
      // the server answers with the real record (an abort here would end the transaction).
      if (cur === null) return null;
      if (isReadableStory(cur)) { why = 'live'; return undefined; }
      if (!keptIn(cur, bodies[slug])) { why = 'changed'; return undefined; }
      why = null;
      const next = { ...cur };
      for (const f of BODY_FIELDS) delete next[f];
      return next;
    });
    if (res.committed && why === null && res.snapshot.exists()) out.removed++;
    else if (why === 'live') out.skippedLive++;
    else out.skippedChanged++;
  }
  return out;
}

function report(plan) {
  console.log(`cms_stories                 ${plan.total} records`);
  console.log(`  live (text stays)         ${plan.live}`);
  console.log(`  not live, already clean   ${plan.notLiveClean}`);
  console.log(`  not live, text to remove  ${plan.remove.length}`);
  console.log(`    of which ${BODIES_PATH} holds more   ${plan.bodiesHoldMore.length}   (public field empty, ${BODIES_PATH} kept it)`);
  console.log(`  not live, NO copy in ${BODIES_PATH}         ${plan.missing.length}`);
  console.log(`  not live, DIFFERENT copy in ${BODIES_PATH}  ${plan.differs.length}`);
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const { loadServiceAccount, publicFields } = await import('../security/service-account.mjs');
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const sa = loadServiceAccount();
  console.log(`service account: ${publicFields(sa).client_email}`);
  initializeApp({ credential: cert(sa), databaseURL: DB_URL });
  const db = getDatabase();

  const [stories, bodies, retired] = await Promise.all([
    db.ref(STORIES_PATH).get().then((s) => s.val() || {}),
    db.ref(BODIES_PATH).get().then((s) => s.val() || {}),
    db.ref(RETIRED_PATH).get().then((s) => s.val() || {}),
  ]);
  const plan = planTextOut(stories, bodies);
  report(plan);

  if (plan.missing.length || plan.differs.length) {
    console.log('\nREFUSED: story_bodies does not hold an identical copy of every record above.');
    console.log('Run scripts/backfill-story-bodies.mjs --verify, settle those first, then re-run.');
    process.exit(1);
  }
  const statuses = {};
  for (const slug of plan.remove) {
    const k = retired[slug] ? 'retired' : storyStatus(stories[slug]);
    statuses[k] = (statuses[k] || 0) + 1;
  }
  console.log(`  by state: ${Object.entries(statuses).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (!APPLY) { console.log(`\nDRY RUN: nothing written. --apply would remove the text from ${plan.remove.length} record(s).`); process.exit(0); }
  if (!plan.remove.length) { console.log('\nNothing to remove.'); process.exit(0); }

  // Back up, and prove the backup reads back, before the first write.
  const backup = Object.fromEntries(plan.remove.map((slug) => [slug, {
    [STORIES_PATH]: Object.fromEntries(BODY_FIELDS.map((f) => [f, stories[slug][f] ?? null])),
    [BODIES_PATH]: bodies[slug],
  }]));
  mkdirSync(resolve(ROOT, 'backups'), { recursive: true });
  const file = resolve(ROOT, 'backups', `proofs-r1-text-out-${new Date().toISOString().replace(/[:.]/g, '')}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2));
  if (readFileSync(file, 'utf8') !== JSON.stringify(backup, null, 2)) throw new Error('backup did not read back identically');
  console.log(`\nbackup: ${file.replace(`${ROOT}/`, '')} (${plan.remove.length} records)`);

  const res = await applyTextOut(db, plan, bodies);
  console.log(`removed ${res.removed}, left alone because now live ${res.skippedLive}, left alone because changed ${res.skippedChanged}`);

  // Re-read every record touched (CLAUDE.md, probes rule 4): no public text, story_bodies unchanged.
  let bad = 0;
  for (const slug of plan.remove) {
    const [rec, copy] = await Promise.all([db.ref(`${STORIES_PATH}/${slug}`).get(), db.ref(`${BODIES_PATH}/${slug}`).get()]);
    const okCopy = JSON.stringify(copy.val()) === JSON.stringify(bodies[slug]);
    const okRec = isReadableStory(rec.val()) || !hasText(rec.val());
    if (!okCopy || !okRec) bad++;
  }
  console.log(`verified ${plan.remove.length - bad} of ${plan.remove.length}: public text gone (or the story is live), story_bodies copy unchanged`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
