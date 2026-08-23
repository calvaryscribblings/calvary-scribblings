// BACKFILL — user_comments/{uid}/{commentId}, rebuilt from `comments` itself.
//
//   node scripts/backfill-user-comments.mjs            # report only, writes nothing
//   node scripts/backfill-user-comments.mjs --apply    # write the difference
//   node scripts/backfill-user-comments.mjs --apply --prune   # also remove orphan entries
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// WHY THIS MUST RUN, AND WHY IT MUST RUN BEFORE THE DEPLOY LANDS
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// R19.2 replaced eight whole-node scans of `comments` with reads of a per-author index. The
// index is written alongside every NEW comment, but 189 stories' worth of existing comments
// pre-date it. Until this has run, every reader's comment count reads 0 — profiles show
// nothing, badges lose their commented-slug component, and the 50-comment milestone starts
// again from zero.
//
// That failure is downward, by design (see IT FAILS CLOSED DOWNWARD in
// app/lib/userComments.js) — nobody gets points they did not earn, and nothing is
// destroyed. But it is still visibly wrong, so this is not optional.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE INDEX IS DERIVED, WHICH IS THE POINT
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Everything here is recomputed from `comments`, the only source of truth. That is the
// property a stored INTEGER could not have given us: an integer that has drifted cannot be
// checked against anything, whereas this can be rebuilt at any time and diffed against what
// is stored. Run it with no flags whenever you want to know whether the index is honest.
//
// It is idempotent. Running it twice writes nothing the second time.
//
// ── WHAT COUNTS AS A COMMENT ───────────────────────────────────────────────────────────
//
// Exactly what the code it replaces counted, and no more:
//
//   · TOP-LEVEL comments only. The old scan walked comments/{parent} one level deep and
//     never descended into `replies`, so nested replies were never counted. They are not
//     counted here either. Changing that would silently move every reader's total.
//   · Attributed by `authorUid`. Some older records carry `uid` instead; the old scan
//     tested `c.authorUid === uid` and therefore never counted those either. This reports
//     how many there are rather than quietly adopting them — moving them into the count is
//     a separate decision with a visible effect on readers' totals.
//   · Open-pages threads included, because comments/{postId} lives in the same node and the
//     old scan did not distinguish parents.

import { readFile } from 'node:fs/promises';
import { mintToken } from './rules-pull.mjs';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const USER_COMMENTS_PATH = 'user_comments';

const APPLY = process.argv.includes('--apply');
const PRUNE = process.argv.includes('--prune');

/** RTDB caps a single write; 500 paths per patch keeps each one small and restartable. */
const CHUNK = 500;

const token = await mintToken();
const api = (path) => `${DB}/${path}.json?access_token=${token}`;

async function get(path) {
  const res = await fetch(api(path));
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function patch(body) {
  const res = await fetch(api(''), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH → ${res.status} ${(await res.text()).slice(0, 300)}`);
}

console.log(APPLY ? 'MODE: apply' : 'MODE: report only — nothing will be written');
console.log('reading comments …');
const comments = (await get('comments')) || {};
console.log('reading user_comments …');
const existing = (await get(USER_COMMENTS_PATH)) || {};

// ── Build what the index SHOULD be ─────────────────────────────────────────────────────
const want = new Map();           // `${uid}/${commentId}` → { slug, createdAt }
let total = 0, unattributed = 0, legacyUidField = 0, nested = 0;

for (const [slug, thread] of Object.entries(comments)) {
  if (!thread || typeof thread !== 'object') continue;
  for (const [commentId, c] of Object.entries(thread)) {
    if (!c || typeof c !== 'object') continue;
    total++;
    if (c.replies && typeof c.replies === 'object') nested += Object.keys(c.replies).length;
    const uid = typeof c.authorUid === 'string' ? c.authorUid : null;
    if (!uid) {
      if (typeof c.uid === 'string') legacyUidField++;
      else unattributed++;
      continue;
    }
    want.set(`${uid}/${commentId}`, {
      slug: String(slug),
      createdAt: Number(c.createdAt) || 1,
    });
  }
}

// ── Compare against what is stored ─────────────────────────────────────────────────────
const have = new Map();
for (const [uid, entries] of Object.entries(existing)) {
  if (!entries || typeof entries !== 'object') continue;
  for (const [commentId, e] of Object.entries(entries)) have.set(`${uid}/${commentId}`, e);
}

const toWrite = {};
let missing = 0, wrong = 0, correct = 0;
for (const [key, entry] of want) {
  const cur = have.get(key);
  if (!cur || typeof cur !== 'object') { missing++; toWrite[`${USER_COMMENTS_PATH}/${key}`] = entry; continue; }
  if (cur.slug !== entry.slug || Number(cur.createdAt) !== entry.createdAt) {
    wrong++; toWrite[`${USER_COMMENTS_PATH}/${key}`] = entry; continue;
  }
  correct++;
}

const orphans = [...have.keys()].filter((k) => !want.has(k));

console.log(`
comments scanned            ${total} top-level across ${Object.keys(comments).length} threads
  nested replies (ignored)  ${nested}
  no authorUid, has uid     ${legacyUidField}   ← never counted before either; unchanged here
  no author at all          ${unattributed}
index entries wanted        ${want.size}
  already correct           ${correct}
  missing                   ${missing}
  wrong slug/createdAt      ${wrong}
  orphans (no such comment) ${orphans.length}${PRUNE ? '  → will be removed' : '  → left alone (pass --prune to remove)'}
readers with an index       ${new Set([...want.keys()].map((k) => k.split('/')[0])).size}
`);

if (PRUNE) for (const k of orphans) toWrite[`${USER_COMMENTS_PATH}/${k}`] = null;

const paths = Object.keys(toWrite);
if (!paths.length) {
  console.log('Nothing to do — the index already matches the comments.');
  process.exit(0);
}

if (!APPLY) {
  console.log(`${paths.length} paths would be written. Re-run with --apply.`);
  for (const p of paths.slice(0, 5)) console.log(`   ${p} = ${JSON.stringify(toWrite[p])}`);
  if (paths.length > 5) console.log(`   … and ${paths.length - 5} more`);
  process.exit(0);
}

console.log(`writing ${paths.length} paths in chunks of ${CHUNK} …`);
for (let i = 0; i < paths.length; i += CHUNK) {
  const chunk = Object.fromEntries(paths.slice(i, i + CHUNK).map((p) => [p, toWrite[p]]));
  await patch(chunk);
  console.log(`  ${Math.min(i + CHUNK, paths.length)}/${paths.length}`);
}
console.log('done. Re-run without --apply to verify it now reports nothing to do.');
