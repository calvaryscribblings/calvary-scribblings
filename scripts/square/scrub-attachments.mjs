// W1 / SQ-01 — SCRUB STORY BODIES OUT OF SQUARE ATTACHMENTS.
//
//   node scripts/square/scrub-attachments.mjs                 # DRY RUN: counts, nothing written
//   node scripts/square/scrub-attachments.mjs --apply         # back up, write, re-read, verify
//   node scripts/square/scrub-attachments.mjs --backup-dir D  # where the backup goes (default ~/calvary-backups)
//
// Until W1 the web's story picker attached the whole cms_stories record to a post, so posts
// carried content, extractedText, epubUrl and the rest into three world-readable nodes:
// square_posts, user_square_posts/{uid} and square_archive. This rewrites EVERY attachedStory in
// those nodes to slimAttachedStory() — the seven fields AttachmentCard draws and links by, the
// set database.rules.json now enforces — and touches nothing else on any record.
//
// An attachment that named its story by `slug` (the pre-CMS static shape) gets `id` and `url`
// from it, which is what attachmentOf() needs to draw a card at all: those seven drew nothing
// before this ran.
//
// THE BACKUP holds the original attachedStory objects, which are story bodies. It is written
// OUTSIDE the repo (this repo is public) before anything is changed, and the apply refuses to
// start if the file cannot be written. The daily RTDB archive (scripts/backup/RESTORE.md) is the
// second copy.
//
// Admin SDK: square_archive is `.write: false` to every client, by design.

import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACHED_STORY_FIELDS, slimAttachedStory } from '../../app/lib/squarePostBody.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const bdIdx = process.argv.indexOf('--backup-dir');
const BACKUP_DIR = bdIdx > -1 ? resolve(process.argv[bdIdx + 1]) : join(homedir(), 'calvary-backups');

const ALLOWED = new Set(ATTACHED_STORY_FIELDS);

/** Every record under the three nodes, flattened to [path, record]. */
export function flatten({ square_posts, user_square_posts, square_archive }) {
  const out = [];
  for (const [id, p] of Object.entries(square_posts || {})) out.push([`square_posts/${id}`, p]);
  for (const [uid, posts] of Object.entries(user_square_posts || {})) {
    for (const [id, p] of Object.entries(posts || {})) out.push([`user_square_posts/${uid}/${id}`, p]);
  }
  for (const [id, p] of Object.entries(square_archive || {})) out.push([`square_archive/${id}`, p]);
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The plan: which attachments change, to what, and why. Pure. */
export function plan(records) {
  const changes = [];
  for (const [path, p] of records) {
    const a = p && p.attachedStory;
    if (a === undefined || a === null) continue;
    const slim = typeof a === 'object' ? slimAttachedStory(a) : null;
    if (slim && same(a, slim)) continue;
    const extra = typeof a === 'object' ? Object.keys(a).filter((k) => !ALLOWED.has(k)) : ['(not an object)'];
    changes.push({ path, before: a, after: slim, extra, body: typeof a === 'object' && ('content' in a || 'extractedText' in a) });
  }
  return changes;
}

async function main() {
  const sa = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: DB_URL });
  const db = getDatabase();
  const read = async () => {
    const [sp, usp, sa2] = await Promise.all(['square_posts', 'user_square_posts', 'square_archive'].map((n) => db.ref(n).once('value')));
    return { square_posts: sp.val(), user_square_posts: usp.val(), square_archive: sa2.val() };
  };

  const before = await read();
  const records = flatten(before);
  const changes = plan(records);
  const byNode = {};
  for (const c of changes) byNode[c.path.split('/')[0]] = (byNode[c.path.split('/')[0]] || 0) + 1;

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${records.length} records across square_posts, user_square_posts, square_archive`);
  console.log(`  attachments to rewrite ... ${changes.length}  ${JSON.stringify(byNode)}`);
  console.log(`  carrying a story body .... ${changes.filter((c) => c.body).length}`);
  console.log(`  slug-shaped (no id/url) .. ${changes.filter((c) => c.before && !c.before.id && !c.before.url).length}`);
  console.log(`  unrecoverable (→ null) ... ${changes.filter((c) => !c.after).length}`);
  for (const c of changes) {
    console.log(`  · ${c.path.padEnd(52)} −${c.extra.length} field(s)${c.body ? '  BODY' : ''}  → ${c.after ? c.after.url : 'null'}`);
  }
  if (!changes.length) { console.log('\n  Nothing to do.'); process.exit(0); }
  if (!APPLY) { console.log('\n  NOTHING WAS WRITTEN. Re-run with --apply.'); process.exit(0); }

  // 1. BACK UP, or do not start.
  await mkdir(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `square-attachments-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(changes.map(({ path, before: b }) => ({ path, attachedStory: b })), null, 2), { mode: 0o600 });
  console.log(`\n  backup ........ ${file}`);

  // 2. ONE ATOMIC MULTI-PATH UPDATE, attachedStory only.
  const patch = {};
  for (const c of changes) patch[`${c.path}/attachedStory`] = c.after;
  await db.ref().update(patch);

  // 3. RE-READ AND VERIFY: every touched attachment is slim, and nothing else on any record moved.
  const after = await read();
  const afterMap = new Map(flatten(after));
  let bad = 0;
  for (const [path, p] of records) {
    const q = afterMap.get(path);
    if (!q) continue; // the horizon may have moved a live post meanwhile; its archive copy is checked below
    const strip = (r) => { const { attachedStory, ...rest } = r || {}; return rest; };
    if (!same(strip(p), strip(q))) { bad++; console.log(`  ✗ ${path}: a field other than attachedStory changed`); }
    const a = q.attachedStory;
    if (a && Object.keys(a).some((k) => !ALLOWED.has(k))) { bad++; console.log(`  ✗ ${path}: still carries ${Object.keys(a).filter((k) => !ALLOWED.has(k)).join(', ')}`); }
  }
  const left = plan(flatten(after));
  console.log(`  verified ...... ${records.length} records re-read; ${bad} problem(s); ${left.length} attachment(s) still outside the set`);
  process.exit(bad || left.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
