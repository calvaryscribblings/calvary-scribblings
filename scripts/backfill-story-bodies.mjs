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
// ── IDEMPOTENT, AND VERIFIABLE ───────────────────────────────────────────────
// Re-running writes the same bytes. `--verify` re-reads both nodes and reports any
// slug where they disagree, which is the standing check for the dual-write in
// app/admin/page.js: if an admin save ever writes one node and not the other, this
// is what finds it.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');
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

async function adminToken(svc) {
  return (await cert(svc).getAccessToken()).access_token;
}

async function main() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));

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

  // ── verify ─────────────────────────────────────────────────────────────────
  if (VERIFY) {
    const token = await adminToken(svc);
    const vres = await fetch(`${DB_URL}/${BODIES_PATH}.json`, { headers: { Authorization: `Bearer ${token}` } });
    if (!vres.ok) { console.error(`story_bodies read failed: HTTP ${vres.status}`); process.exit(1); }
    const live = (await vres.json()) || {};

    const missing = [];
    const differs = [];
    for (const slug of slugs) {
      const there = live[slug];
      if (!there) { missing.push(slug); continue; }
      if (there.content !== bodies[slug].content || there.extractedText !== bodies[slug].extractedText) {
        differs.push(slug);
      }
    }
    const extra = Object.keys(live).filter((s) => !bodies[s]);

    console.log(`\n── VERIFY ───────────────────────────────────────────────────`);
    console.log(`  in step           ${slugs.length - missing.length - differs.length}`);
    console.log(`  missing           ${missing.length}`);
    console.log(`  differing         ${differs.length}`);
    console.log(`  orphaned          ${extra.length}   (in story_bodies, not in cms_stories)`);
    for (const s of missing) console.log(`    MISSING   ${s}`);
    for (const s of differs) console.log(`    DIFFERS   ${s}`);
    for (const s of extra) console.log(`    ORPHAN    ${s}`);
    if (missing.length || differs.length) {
      console.log('\nA differing slug means a writer touched one node and not the other.');
      console.log('The dual-write lives in app/admin/page.js — check it before re-running --apply.');
      process.exitCode = 1;
    }
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write ${slugs.length} record(s).`);
    return;
  }

  // PUT rather than PATCH: story_bodies is derived wholesale from cms_stories, so
  // the node should end up mirroring exactly this set. A PATCH would leave behind
  // the body of a story that has since been deleted — and an orphaned body on an
  // unreadable node is not dangerous, but it is a lie about what exists.
  const token = await adminToken(svc);
  const writeRes = await fetch(`${DB_URL}/${BODIES_PATH}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodies),
  });
  if (!writeRes.ok) {
    console.error(`PUT failed: HTTP ${writeRes.status} ${(await writeRes.text()).slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`\n✓ wrote ${slugs.length} body record(s) to ${BODIES_PATH}.`);
  console.log('  Re-run with --verify to prove the two nodes agree.');
}

main().catch((e) => { console.error(e); process.exit(1); });
