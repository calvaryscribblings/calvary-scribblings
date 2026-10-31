// Populate story_bodies/<slug> from cms_stories — phase T1 of the gating work.
//
// DRY RUN BY DEFAULT. Writes ONLY with --apply.
//
//   node scripts/backfill-story-bodies.mjs           # plan only
//   node scripts/backfill-story-bodies.mjs --apply   # write
//   node scripts/backfill-story-bodies.mjs --verify  # compare the two nodes, write nothing
//
// See STORY-SERVING-CONTRACT.md §7. This is the FIRST half of T1 and it is
// deliberately additive: it copies the two body fields to a new, unreadable node and
// CHANGES NOTHING on cms_stories. Both copies exist and agree from here until T3,
// which is what lets the app ship against /api/story without any deployed version
// losing its story text on the day the endpoint goes live.
//
//   story_bodies/<slug> = { content, extractedText }
//
// ── WHY extractedText TRAVELS WITH content ───────────────────────────────────
// It is the SECOND copy of the body — 258 KB of plain text pulled out of uploaded
// EPUBs (app/admin/extract-text/) and read by functions/api/generate-quiz.js for
// reader-mode stories. Gating `content` while `extractedText` stays world-readable
// on cms_stories would gate the story and publish the story, which is not a gate.
// They move together or the move is theatre.
//
// ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
// It does not delete anything from cms_stories. That is T3, it happens only once
// app adoption is measured, and it replaces `content` with a TOMBSTONE SENTENCE
// rather than removing the field — an old client renders that field, and a deleted
// one gives its reader a story page with a cover, a byline and no words.
//
// ── PROOFS-R1 (ruling 255): story_bodies IS NOW THE ONLY COPY OF AN UNRELEASED STORY ──
// A story that is not live keeps its text in story_bodies alone (app/lib/storyText.js). So this
// can no longer derive story_bodies wholesale from cms_stories: it PATCHes the records that carry
// text publicly and leaves every other body exactly where it is. (It used to PUT the whole node,
// which would now delete every scheduled story's only copy.) --verify also counts the bodies held
// back on purpose, and fails on any story that is not live but still has public text.
//
// ── SAFETY-1: ONLY WHAT IS MISSING OR DIFFERS, AND ONLY THROUGH THE GUARD ─────
// It reads story_bodies first and writes ONLY the records that are missing there or differ from
// cms_stories, as one guarded update (scripts/safety/guard.mjs: dry by default, a verified backup
// of exactly those paths, then one atomic multi-path write). A body that is in story_bodies but
// carries no text on cms_stories is never in the write set, by construction and by a check.
//
// ── IDEMPOTENT, AND VERIFIABLE ───────────────────────────────────────────────
// Re-running writes nothing once the two agree. `--verify` re-reads both nodes and reports any
// slug where they disagree, which is the standing check for the dual-write in
// app/admin/page.js: if an admin save ever writes one node and not the other, this
// is what finds it.

import { isReadableStory } from '../app/lib/storyAccess.js';
import { openGuard, DB_URL } from './safety/guard.mjs';

const VERIFY = process.argv.includes('--verify');

const BODIES_PATH = 'story_bodies';

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** The body projection. Exactly two fields, both always present as strings. */
function bodyRecord(story) {
  const s = story || {};
  return {
    content: typeof s.content === 'string' ? s.content : '',
    extractedText: typeof s.extractedText === 'string' ? s.extractedText : '',
  };
}

const differsFrom = (there, rec) => !there || there.content !== rec.content || there.extractedText !== rec.extractedText;

async function main() {
  // --verify is read-only whatever else is on the command line: its guard never applies.
  const guard = await openGuard('backfill-story-bodies', VERIFY ? { apply: false } : {});

  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) { console.error(`cms_stories read failed: HTTP ${res.status}`); process.exit(1); }
  const all = await res.json();
  if (!all || typeof all !== 'object') { console.error('cms_stories is empty.'); process.exit(1); }

  const bodies = {};
  let contentBytes = 0;
  let extractedBytes = 0;
  let empty = 0;
  for (const [slug, story] of Object.entries(all)) {
    const rec = bodyRecord(story);
    if (!rec.content && !rec.extractedText) { empty++; continue; }
    bodies[slug] = rec;
    contentBytes += Buffer.byteLength(rec.content, 'utf8');
    extractedBytes += Buffer.byteLength(rec.extractedText, 'utf8');
  }

  const slugs = Object.keys(bodies);
  console.log(`cms_stories: ${Object.keys(all).length} records`);
  console.log(`  with a body       ${slugs.length}`);
  console.log(`  with neither      ${empty}`);
  console.log(`  content           ${kb(contentBytes)}`);
  console.log(`  extractedText     ${kb(extractedBytes)}`);
  console.log(`  story_bodies      ${kb(Buffer.byteLength(JSON.stringify(bodies), 'utf8'))} total`);

  // What story_bodies holds now. Both modes need it: --verify reports against it, and the write
  // set is exactly the slugs missing from it or differing from cms_stories.
  let live;
  try {
    live = (await guard.get(BODIES_PATH)) || {};
  } catch (e) {
    console.error(`story_bodies read failed: ${e.message}`);
    process.exit(1);
  }
  const missing = [];
  const differs = [];
  for (const slug of slugs) {
    const there = live[slug];
    if (!there) { missing.push(slug); continue; }
    if (differsFrom(there, bodies[slug])) differs.push(slug);
  }

  // ── verify ─────────────────────────────────────────────────────────────────
  if (VERIFY) {
    // In story_bodies only: right for a story that is not live, an orphan if the record is gone.
    const heldBack = Object.keys(live).filter((s) => !bodies[s] && all[s] && !isReadableStory(all[s]));
    const extra = Object.keys(live).filter((s) => !bodies[s] && !all[s]);
    // PROOFS-R1: the invariant itself. A story that isn't live must have no public text.
    const exposed = slugs.filter((s) => !isReadableStory(all[s]));

    console.log(`\n── VERIFY ───────────────────────────────────────────────────`);
    console.log(`  in step           ${slugs.length - missing.length - differs.length}`);
    console.log(`  missing           ${missing.length}`);
    console.log(`  differing         ${differs.length}`);
    console.log(`  held back         ${heldBack.length}   (not live: text in story_bodies only, as it should be)`);
    console.log(`  orphaned          ${extra.length}   (in story_bodies, not in cms_stories)`);
    console.log(`  exposed           ${exposed.length}   (not live, but text still on cms_stories)`);
    for (const s of missing) console.log(`    MISSING   ${s}`);
    for (const s of differs) console.log(`    DIFFERS   ${s}`);
    for (const s of extra) console.log(`    ORPHAN    ${s}`);
    for (const s of exposed) console.log(`    EXPOSED   ${s}`);
    if (exposed.length) {
      console.log('\nAn exposed slug is unreleased text on the public node: scripts/stories/unreleased-text-out.mjs removes it.');
      process.exitCode = 1;
    }
    if (missing.length || differs.length) {
      console.log('\nA differing slug means a writer touched one node and not the other.');
      console.log('The dual-write lives in app/admin/page.js — check it before re-running --apply.');
      process.exitCode = 1;
    }
    return;
  }

  // ── the write set: missing or differing, nothing else ──────────────────────
  // PROOFS-R1: story_bodies is the ONLY copy of every story that isn't live, so it can't be
  // rebuilt from cms_stories. Each path replaces exactly one record that cms_stories carries text
  // for; a record that is already equal is not written at all.
  const writeSlugs = [...missing, ...differs];
  const updates = {};
  for (const slug of writeSlugs) {
    // By construction every slug here has public text. Asserted anyway: a body held only in
    // story_bodies (an unreleased story) must never be in the write set.
    if (!bodies[slug]) throw new Error('refusing: a slug with no text on cms_stories is in the write set.');
    updates[`${BODIES_PATH}/${slug}`] = bodies[slug];
  }
  console.log(`\n  in step           ${slugs.length - writeSlugs.length}`);
  console.log(`  missing           ${missing.length}`);
  console.log(`  differing         ${differs.length}`);
  console.log(`  untouched in story_bodies only ${Object.keys(live).filter((s) => !bodies[s]).length}`);

  if (!writeSlugs.length) {
    console.log('\nNothing to do — story_bodies already holds every public body.');
    return;
  }

  let result;
  try {
    result = await guard.update(updates, { label: 'story-bodies' });
  } catch (e) {
    console.error(`write to ${BODIES_PATH} failed: ${e.message}`);
    process.exit(1);
  }
  if (!result.applied) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write ${writeSlugs.length} record(s).`);
    return;
  }
  console.log(`\n✓ wrote ${writeSlugs.length} body record(s) to ${BODIES_PATH}.`);
  console.log('  Re-run with --verify to prove the two nodes agree.');
  guard.summary();
}

main().catch((e) => { console.error(e); process.exit(1); });
