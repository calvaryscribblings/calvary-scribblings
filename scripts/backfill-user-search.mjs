// Build the public user_search index for name-based user search.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/backfill-user-search.mjs            # plan only, no writes
//   node scripts/backfill-user-search.mjs --apply    # perform writes
//
// What it does:
//   - Reads the whole users node (the service account bypasses RTDB rules).
//   - For each uid with something to show, builds an index entry:
//       user_search/{uid} = { displayName, username, avatarUrl }
//     using the same dual-schema fallbacks the app tolerates:
//       displayName → prefer displayName, fall back to handle, then name
//       username    → prefer username, fall back to handle  (|| '')
//       avatarUrl   → prefer avatarUrl, fall back to photoURL  (|| '')
//   - Skips users with no displayName AND no username (nothing to match/show).
//
// DRY RUN (default): prints a table + totals, ends with the no-writes notice.
// --apply: writes every entry via a single multi-path update on user_search.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');

// Old house/admin catch-all uid — not a real person, never index it.
const EXCLUDED_UID = 'NH7HmRbwheVFG6XZRGaJDeuBWdJ3';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

async function main() {
  const keyPath = resolve(ROOT, 'serviceAccountKey.json');
  const serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: DB_URL,
  });
  const db = getDatabase();

  const snap = await db.ref('users').get();
  const users = snap.val() || {};

  const entries = []; // { uid, displayName, username, avatarUrl }
  let scanned = 0;
  let skipped = 0;

  for (const [uid, u] of Object.entries(users)) {
    scanned += 1;
    if (!u || typeof u !== 'object') { skipped += 1; continue; }

    // Catch-all/house account — not a real person.
    if (uid === EXCLUDED_UID) { skipped += 1; continue; }

    // Dual-schema fallbacks the app uses.
    const displayName = str(u.displayName) || str(u.handle) || str(u.name);
    const username = str(u.username) || str(u.handle);
    const avatarUrl = str(u.avatarUrl) || str(u.photoURL);

    // Nothing to match on or show → skip.
    if (!displayName && !username) { skipped += 1; continue; }

    entries.push({ uid, displayName, username, avatarUrl });
  }

  entries.sort((a, b) =>
    (a.displayName || a.username).localeCompare(b.displayName || b.username)
  );

  printPlan(entries, scanned, skipped);

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply.');
    return;
  }

  console.log('\n--apply: writing user_search index via multi-path update…\n');
  const updates = {};
  for (const e of entries) {
    updates[e.uid] = {
      displayName: e.displayName,
      username: e.username || '',
      avatarUrl: e.avatarUrl || '',
    };
  }

  if (Object.keys(updates).length === 0) {
    console.log('Nothing to write.');
    return;
  }

  await db.ref('user_search').update(updates);
  console.log(`Applied: ${entries.length} user_search entr${entries.length === 1 ? 'y' : 'ies'} written.`);
}

function printPlan(entries, scanned, skipped) {
  console.log(`${'='.repeat(78)}`);
  console.log(`user_search index plan  (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`);
  console.log(`${'='.repeat(78)}`);
  console.log(
    `  ${'uid'.padEnd(12)} | ${'displayName'.padEnd(28)} | ${'username'.padEnd(20)} | avatar`
  );
  console.log(`  ${'-'.repeat(12)}-+-${'-'.repeat(28)}-+-${'-'.repeat(20)}-+-------`);
  for (const e of entries) {
    console.log(
      `  ${e.uid.slice(0, 12).padEnd(12)} | ${(e.displayName || '∅').slice(0, 28).padEnd(28)} | ${(e.username || '∅').slice(0, 20).padEnd(20)} | ${e.avatarUrl ? 'yes' : 'no'}`
    );
  }

  console.log(`\n${'-'.repeat(78)}`);
  console.log(`  Users scanned:        ${scanned}`);
  console.log(`  Entries to write:     ${entries.length}`);
  console.log(`  Skipped (no name):    ${skipped}`);
  console.log(`${'-'.repeat(78)}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nERROR:', err.message || err);
  process.exit(1);
});
