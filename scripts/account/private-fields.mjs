#!/usr/bin/env node
// PRIVATE FIELDS OFF THE PUBLIC RECORD — the migration, and the sweep that keeps it true.
//
//   node scripts/account/private-fields.mjs                    dry run: counts, no writes
//   node scripts/account/private-fields.mjs --apply            back up, then move
//
// users/{uid} is world-readable (".read": true at users/$uid), and RTDB reads cascade: no child
// of a readable node can be made private. So a reader's date of birth sat beside their name and
// handle for anyone to read, and user_search lists every uid. Private fields live at
// users_private/{uid} instead (owner and founders read; the owner writes their own).
//
// WHAT IS PRIVATE (recon, 24 Sep 2026, 312 users nodes):
//   dob            171 records   web signup, web completion step, app signup (all binaries)
//   email            1 record    a founder-era account; nothing in this repo writes it
//   profile/email    1 record    ┐ a nested legacy `profile` object on 2 accounts; nothing in this
//   profile/dob      1 record    │ repo writes it. Its other children (avatarUrl, displayName,
//   profile/country  1 record    ┘ handle…) are public profile and stay where they are.
// Nothing in this repo READS any of them back: the age checks use the date the form collects.
//
// THE SWEEP. Old app binaries keep writing dob into users/{uid} at signup until the app changes,
// so .github/workflows/account-scrub.yml runs this every 15 minutes (via scrub.mjs): any private
// field found on the public record is copied to users_private/{uid} and removed from users/{uid},
// in ONE update per reader. The public copy is the most recent write, so it wins over an older
// private value. Nothing else in the node is named, so nothing else is touched. A uid with a
// deletions/{uid} record is skipped: a sweep must never copy a deleted reader's data somewhere new.

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** users/{uid}-relative path → users_private/{uid} field. Top-level entries come first and win. */
export const PRIVATE_FIELDS = [
  ['dob', 'dob'],
  ['email', 'email'],
  ['profile/dob', 'dob'],
  ['profile/email', 'email'],
  ['profile/country', 'country'],
];

const at = (obj, path) => path.split('/').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const present = (v) => v !== undefined && v !== null;

/**
 * The plan: ONE root update that moves every private field off users/{uid}.
 * @param users    the whole users node
 * @param deleted  { [uid]: any } — deletions/ ; these uids are skipped
 * @returns {{ update: object, moved: {uid, from, to}[], counts: object }}
 */
export function planPrivateSweep(users, deleted = {}) {
  const update = {};
  const moved = [];
  const counts = { readers: 0, skippedDeleted: 0 };
  for (const [uid, node] of Object.entries(users || {})) {
    if (!node || typeof node !== 'object') continue;
    const hits = PRIVATE_FIELDS.filter(([from]) => present(at(node, from)));
    if (!hits.length) continue;
    if (deleted && deleted[uid] !== undefined) { counts.skippedDeleted++; continue; }
    counts.readers++;
    const written = new Set();
    for (const [from, to] of hits) {
      const v = at(node, from);
      // First (top-level) wins for a field; an empty string carries nothing and is not copied.
      if (!written.has(to) && !(typeof v === 'string' && v.trim() === '')) {
        update[`users_private/${uid}/${to}`] = v;
        written.add(to);
      }
      update[`users/${uid}/${from}`] = null;
      moved.push({ uid, from, to: written.has(to) ? to : null });
      counts[from] = (counts[from] || 0) + 1;
    }
  }
  return { update, moved, counts };
}

/** Read, plan, and (with apply) back up then write. Returns the plan's counts. */
export async function runPrivateSweep(db, { apply = false, backupDir = null, log = console.log, now = Date.now } = {}) {
  const [users, deleted] = await Promise.all([
    db.ref('users').get().then((s) => s.val() || {}),
    db.ref('deletions').get().then((s) => s.val() || {}),
  ]);
  const plan = planPrivateSweep(users, deleted);
  if (!plan.moved.length) { log('[private] nothing on the public record'); return plan.counts; }
  log(`[private] ${plan.counts.readers} readers, ${plan.moved.length} fields: ${JSON.stringify(plan.counts)} — ${apply ? 'moving' : 'would move'}`);
  if (!apply) return plan.counts;
  if (backupDir) {
    // Every value about to leave users/{uid}, and whatever users_private/{uid} held before.
    const uids = [...new Set(plan.moved.map((m) => m.uid))];
    const before = {};
    for (const uid of uids) before[uid] = { public: Object.fromEntries(PRIVATE_FIELDS.map(([f]) => [f, at(users[uid], f) ?? null])), private: (await db.ref(`users_private/${uid}`).get()).val() };
    mkdirSync(backupDir, { recursive: true });
    const file = resolve(backupDir, `private-fields-${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({ at: new Date(now()).toISOString(), readers: uids.length, before }, null, 2));
    log(`[private] backup: ${file}`);
  }
  // Per reader, so one refused path can never strand another reader's half-move. Each reader's
  // copy and removal are in the same update: the field is never in both places, nor in neither.
  const byUid = {};
  for (const [p, v] of Object.entries(plan.update)) (byUid[p.split('/')[1]] ||= {})[p] = v;
  for (const u of Object.values(byUid)) await db.ref().update(u);
  log(`[private] moved ${plan.moved.length} fields for ${plan.counts.readers} readers`);
  return plan.counts;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const keyPath = process.env.SCRUB_SERVICE_ACCOUNT || resolve(ROOT, 'serviceAccountKey.json');
  let credential;
  try { credential = cert(JSON.parse(readFileSync(keyPath, 'utf8'))); } catch { credential = applicationDefault(); }
  initializeApp({ credential, databaseURL: process.env.SCRUB_DATABASE_URL || 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
  const apply = process.argv.includes('--apply');
  const counts = await runPrivateSweep(getDatabase(), { apply, backupDir: apply ? resolve(ROOT, 'backups') : null });
  console.log(`[private] ${apply ? 'APPLIED' : 'DRY RUN, no writes'}: ${JSON.stringify(counts)}`);
  process.exit(0);
}
