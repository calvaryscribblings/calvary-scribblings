// Repair ONE cms_stories_index record by re-projecting it from cms_stories.
//
//   node scripts/repair-index-record.mjs <slug>            # read, project, diff. No writes.
//   node scripts/repair-index-record.mjs <slug> --apply    # write that one complete record
//
// ── WHY THIS EXISTS ALONGSIDE backfill-stories-index.mjs ─────────────────────────────────
//
// The backfill PUTs the WHOLE node — 172 records — to repair however many are wrong. That is
// right after a projection change, when every record needs re-deriving. It is the wrong
// instrument for "the cron left one record two fields short", which is what R48 found: a
// 172-record overwrite to fix one slug is 171 writes of blast radius nobody asked for.
//
// ⚠ IT STILL WRITES A COMPLETE PROJECTED RECORD, and that is not negotiable. See rule 2 in
// the header of app/lib/storyIndex.js: a DEEP-PATH write (cms_stories_index/<slug>/<field>)
// CREATES the parent when the slug is absent, leaving a record that holds one field, counts as
// a member, and carries no authorUid, title or date. That is how a story once vanished from
// its author's Voices page. This script PUTs the whole record at cms_stories_index/<slug>,
// built by buildIndexRecord — the same projection the admin dual-write and the backfill use.
//
// ── AND IT FOLLOWS THE LIVE-PROBE RULES IN CLAUDE.md ─────────────────────────────────────
//
//   1. READ THE VALUE FIRST. The `before` read happens before anything else and is printed in
//      full, so the record that is about to be replaced is on the terminal either way.
//   2. It refuses outright if the projection would DROP a field the live record already has —
//      a repair that loses data is not a repair, and that check is what stops this script
//      being run against a stale checkout whose buildIndexRecord is behind production's.
//   3. VERIFY AFTERWARDS. It re-reads and diffs against what it meant to write, and says so.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { buildIndexRecord, isIndexed, INDEX_PATH } from '../app/lib/storyIndex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) {
  console.error('usage: node scripts/repair-index-record.mjs <slug> [--apply]');
  process.exit(1);
}

const get = async (path) => {
  const r = await fetch(`${DB_URL}/${path}.json`);
  if (!r.ok) { console.error(`read failed ${path}: HTTP ${r.status}`); process.exit(1); }
  return r.json();
};

const story = await get(`cms_stories/${slug}`);
if (!story) { console.error(`cms_stories/${slug} does not exist.`); process.exit(1); }
if (!isIndexed(story)) {
  console.error(`${slug} is not index-eligible (published:${story.published}). Nothing to repair —`);
  console.error('an ineligible story should have NO index record at all.');
  process.exit(1);
}

// ── 1. READ THE VALUE FIRST ──────────────────────────────────────────────────────────────
const before = await get(`${INDEX_PATH}/${slug}`);
const want = buildIndexRecord(slug, story);

console.log(`\n${INDEX_PATH}/${slug}`);
console.log(`  before : ${before ? `${Object.keys(before).length} keys` : 'ABSENT'}`);
console.log(`  after  : ${Object.keys(want).length} keys\n`);

const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(want)])].sort();
const changed = [];
for (const k of keys) {
  const a = JSON.stringify((before || {})[k]);
  const b = JSON.stringify(want[k]);
  if (a === b) continue;
  changed.push(k);
  const trim = (v) => (v === undefined ? '<absent>' : v.length > 96 ? `${v.slice(0, 96)}…` : v);
  console.log(`  ${k}`);
  console.log(`     before  ${trim(a)}`);
  console.log(`     after   ${trim(b)}`);
}
if (!changed.length) {
  console.log('  No difference — the record already matches the projection. Nothing to do.');
  process.exit(0);
}

// ── 2. REFUSE TO LOSE A FIELD ────────────────────────────────────────────────────────────
// If the live record carries a key this checkout's projection would not emit, this checkout is
// BEHIND production, and applying it would delete a field the app may be reading. That is the
// one direction this script must never move in.
const wouldDrop = Object.keys(before || {}).filter((k) => !(k in want));
if (wouldDrop.length) {
  console.error(`\nREFUSING: the projection would DROP ${wouldDrop.join(', ')} from the live record.`);
  console.error('This checkout is behind production. Pull, re-check app/lib/storyIndex.js, and retry.');
  process.exit(1);
}

if (!APPLY) {
  console.log(`\nDRY RUN — ${changed.length} field(s) would change. Re-run with --apply.`);
  process.exit(0);
}

const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
const token = (await cert(svc).getAccessToken()).access_token;
const put = await fetch(`${DB_URL}/${INDEX_PATH}/${slug}.json?access_token=${token}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(want),
});
if (!put.ok) {
  console.error(`\nWRITE FAILED: HTTP ${put.status} — ${await put.text()}`);
  process.exit(1);
}

// ── 3. VERIFY AFTERWARDS, AND SAY SO ─────────────────────────────────────────────────────
const after = await get(`${INDEX_PATH}/${slug}`);
// ⚠ COMPARE FIELD BY FIELD, NEVER JSON.stringify(a) === JSON.stringify(b). The RTDB REST API
// returns object keys in its own order — alphabetical, not insertion — so a byte comparison of
// two serialisations reports a mismatch on a record that is perfectly correct. The first run of
// this script did exactly that: it printed "matches the projection: false" and then an EMPTY
// list of differing fields, which is the tell. A verification that can cry wolf is worse than
// none, because the next person learns to ignore it.
const bad = [...new Set([...Object.keys(after || {}), ...Object.keys(want)])]
  .filter((k) => JSON.stringify((after || {})[k]) !== JSON.stringify(want[k]));
console.log(`\n  wrote ${Object.keys(want).length} keys`);
console.log(`  read back: ${Object.keys(after || {}).length} keys, fields differing from the projection: ${bad.length}`);
if (bad.length) {
  console.error(`  ⚠ MISMATCH on: ${bad.join(', ')}`);
  process.exit(1);
}
console.log('  ✓ repaired and verified.');
