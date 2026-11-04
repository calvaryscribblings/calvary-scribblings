#!/usr/bin/env node
// RULING 329 (4 Nov 2026) — clear the two leftovers of the accounts that were gone before the
// deletion tool existed, after a backup, under the 26 Sept deletion policy. NOTHING ELSE.
//
//   node scripts/account/clear-329.mjs           dry run: what it would clear, as counts
//   node scripts/account/clear-329.mjs --apply   back up (SAFETY-1 guard), clear, verify
//
// WHAT IT CLEARS. NOTIF-B1 found, and NOTIF-B2's dry run of the full account scrub confirmed:
//   · push_tokens/{uid}: one account with no profile record that no longer exists in Auth
//     (1 token row);
//   · library_notifications/{key}: one inbox whose key has no profile and no Auth account (one
//     May 2026 follow note). NOTIF-B2 found that this key is NOT a Firebase uid at all: it is a
//     legacy "author_…" key, a follow note sent to a pre-account author page. It was never an
//     account, which is why the account scrub cannot plan for it (its uid check refuses the key).
// Exactly those two nodes, each whole, and nothing the scrub's dry run found besides.
//
// THE RAILS. It refuses unless it finds exactly EXPECTED leftovers of exactly that shape, so a new
// profile-less owner appearing later can never be swept up by a re-run. Every write is the guard's
// (dry without --apply; a fresh, checksum-verified backup of exactly these paths; one atomic update),
// and afterwards each path is read back and must be gone. Counts only: never a key, a token or a uid.
import { pathToFileURL } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { loadServiceAccount } from '../security/service-account.mjs';
import { openGuard, DB_URL } from '../safety/guard.mjs';

/** What ruling 329 names: one token owner, one library inbox. */
export const EXPECTED = Object.freeze({ push_tokens: 1, library_notifications: 1 });
/** The most each leftover may hold. More means it isn't the leftover NOTIF-B1 counted. */
export const MAX_RECORDS = 5;

/**
 * The plan, pure. `owners`: { node: { key: recordCount } } for the profile-less owners in each
 * node; `gone(key)`: true when the key has no Auth account (or is not a uid at all).
 * Returns { paths: [...], counts } or throws a refusal naming counts only.
 */
export function plan329(owners, gone) {
  const paths = [];
  const counts = {};
  for (const node of Object.keys(EXPECTED)) {
    const keys = Object.entries(owners[node] || {}).filter(([k]) => gone(k));
    counts[node] = { owners: keys.length, records: keys.reduce((n, [, c]) => n + c, 0) };
    if (keys.length !== EXPECTED[node]) {
      throw new Error(`REFUSED: ${node} has ${keys.length} profile-less owner(s) gone from Auth; ruling 329 names ${EXPECTED[node]}. Nothing was written.`);
    }
    for (const [k, c] of keys) {
      if (c < 1 || c > MAX_RECORDS) throw new Error(`REFUSED: a ${node} leftover holds ${c} record(s), not the leftover counted in NOTIF-B1. Nothing was written.`);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(k)) throw new Error(`REFUSED: a ${node} key is not a plain id. Nothing was written.`);
      paths.push(`${node}/${k}`);
    }
  }
  return { paths, counts };
}

async function main() {
  const apply = process.argv.includes('--apply');
  initializeApp({ credential: cert(loadServiceAccount()), databaseURL: DB_URL });
  const guard = await openGuard('ruling-329');
  const db = guard.adminDb(getDatabase());   // reads as normal; every write goes through the guard
  const val = async (p) => (await db.ref(p).get()).val();

  const owners = {};
  for (const node of Object.keys(EXPECTED)) {
    owners[node] = {};
    for (const [k, v] of Object.entries((await val(node)) || {})) {
      if ((await db.ref(`users/${k}`).get()).exists()) continue;
      owners[node][k] = v && typeof v === 'object' ? Object.keys(v).length : 1;
    }
  }
  const authGone = new Map();
  for (const k of new Set(Object.values(owners).flatMap((o) => Object.keys(o)))) {
    authGone.set(k, await getAuth().getUser(k).then(() => false, (e) => ['auth/user-not-found', 'auth/invalid-uid', 'auth/argument-error'].includes(e?.code)));
  }
  const { paths, counts } = plan329(owners, (k) => authGone.get(k) === true);
  console.log(`ruling 329: ${apply ? 'APPLY' : 'dry run'}`);
  for (const [node, c] of Object.entries(counts)) console.log(`  ${node}: ${c.owners} leftover, ${c.records} record(s)`);

  await db.ref().update(Object.fromEntries(paths.map((p) => [p, null])));   // the guard: dry, or backup + verify + write
  if (!apply) { console.log('  dry run: nothing written. Re-run with --apply.'); return; }

  let left = 0;
  for (const p of paths) if ((await db.ref(p).get()).exists()) left++;
  if (left) throw new Error(`VERIFY FAILED: ${left} of ${paths.length} path(s) still present.`);
  console.log(`  verified: ${paths.length} of ${paths.length} path(s) gone. The guard's backup is named above.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (e) => { console.error(`  ✗ ${e.message}`); process.exit(1); });
}
