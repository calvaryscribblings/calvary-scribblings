// Audit user handle/username fields to size the blast radius of a
// "web username is canonical" repair.
//
// READ ONLY. This script NEVER writes and accepts no --apply flag.
//
//   node scripts/audit-handle-fields.mjs
//
// Decided rule: the WEB `username` field is canonical. The whole real user
// base lives on web; the app is a handful of testers writing to a separate
// `handle` field. So for every user:
//     canonical = username (if non-empty) else handle
// and a future repair would, per user:
//     - fill username   from handle   when username is empty   (bucket A)
//     - fill/correct handle + handleLowercased from username   (buckets B & D)
//     - rebuild user_search/{uid}.username from canonical       (search fix)
//
// What it does:
//   - Reads the whole users node (service account bypasses RTDB rules).
//   - Reads the whole user_search node for cross-referencing.
//   - Per uid, examines: handle, username, handleLowercased, and
//     user_search/{uid}.username.
//   - Categorizes into buckets A–E, counts them, lists bucket D in full.
//   - Counts user_search rows missing a username despite a resolvable handle.
//   - SIMULATES the web-canonical repair and reports change totals.
//
// Nothing is written. Ends with: "READ ONLY — nothing written."

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// Old house/admin catch-all uid — not a real person, exclude from all counts.
const EXCLUDED_UID = 'NH7HmRbwheVFG6XZRGaJDeuBWdJ3';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lc = (v) => str(v).toLowerCase();

async function main() {
  const keyPath = resolve(ROOT, 'serviceAccountKey.json');
  const serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: DB_URL,
  });
  const db = getDatabase();

  const [usersSnap, searchSnap] = await Promise.all([
    db.ref('users').get(),
    db.ref('user_search').get(),
  ]);
  const users = usersSnap.val() || {};
  const search = searchSnap.val() || {};

  // Buckets
  const buckets = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const bucketD = []; // { uid, handle, username, displayName }

  // Simulated repair tallies
  let usernameFilledFromHandle = 0;     // bucket A
  let handleFilledOrCorrected = 0;      // username -> handle differs/missing (B + D + any handle≠canonical)
  let handleLowercasedFixed = 0;        // handleLowercased differs from canonical lowercase
  let searchUsernameRebuilt = 0;        // user_search.username differs from canonical

  // Search-specific: rows whose username is empty/missing but the user has a
  // resolvable handle/username (i.e. a canonical exists) — these are the
  // non-clickable search rows (Nana's case).
  let searchEmptyButResolvable = 0;

  let scanned = 0;
  let skipped = 0;

  for (const [uid, u] of Object.entries(users)) {
    if (uid === EXCLUDED_UID) { skipped += 1; continue; }
    if (!u || typeof u !== 'object') { skipped += 1; continue; }
    scanned += 1;

    const handle = str(u.handle);
    const username = str(u.username);
    const handleLowercased = str(u.handleLowercased);
    const displayName = str(u.displayName) || str(u.name);

    const hasHandle = handle.length > 0;
    const hasUsername = username.length > 0;

    // Categorize
    if (!hasUsername && hasHandle) {
      buckets.A += 1;
    } else if (hasUsername && !hasHandle) {
      buckets.B += 1;
    } else if (hasUsername && hasHandle && lc(username) === lc(handle)) {
      buckets.C += 1;
    } else if (hasUsername && hasHandle && lc(username) !== lc(handle)) {
      buckets.D += 1;
      bucketD.push({ uid, handle, username, displayName });
    } else {
      // neither set
      buckets.E += 1;
    }

    // Web-canonical: username wins; fall back to handle only if username empty.
    const canonical = hasUsername ? username : (hasHandle ? handle : '');

    // Simulate repair (no writes)
    if (canonical) {
      // username filled from handle (only bucket A: username empty, handle set)
      if (!hasUsername && hasHandle) usernameFilledFromHandle += 1;

      // handle filled/corrected to match canonical (app compat)
      if (handle !== canonical) handleFilledOrCorrected += 1;

      // handleLowercased filled/corrected to match canonical lowercase
      if (handleLowercased !== lc(canonical)) handleLowercasedFixed += 1;

      // user_search rebuild: compare existing index username to canonical
      const sEntry = search[uid];
      const sUsername = sEntry ? str(sEntry.username) : '';
      if (sUsername !== canonical) searchUsernameRebuilt += 1;

      // non-clickable search row: index exists (or user is indexable) but its
      // username is empty/missing while a canonical handle/username exists.
      if (sEntry && !sUsername) searchEmptyButResolvable += 1;
    }
  }

  // ---- Output ----
  console.log('=== Handle field audit (READ ONLY) ===');
  console.log(`Users scanned: ${scanned}  (skipped ${skipped}: house account + malformed)\n`);

  console.log('--- Bucket counts ---');
  console.log(`A. username empty/missing, handle set      (handle→username): ${buckets.A}`);
  console.log(`B. username set, handle empty/missing       (username→handle): ${buckets.B}`);
  console.log(`C. both set & equal (lowercased) — healthy, no change        : ${buckets.C}`);
  console.log(`D. both set but DIFFERENT — username wins, handle overwritten : ${buckets.D}`);
  console.log(`E. neither set                                               : ${buckets.E}`);
  console.log(`   (A+B+C+D+E = ${buckets.A + buckets.B + buckets.C + buckets.D + buckets.E})\n`);

  console.log(`--- user_search non-clickable rows ---`);
  console.log(`Indexed rows with empty/missing username despite resolvable handle: ${searchEmptyButResolvable}\n`);

  console.log(`--- Bucket D in full (${bucketD.length}) — eyeball for real web users ---`);
  if (bucketD.length === 0) {
    console.log('(none)');
  } else {
    for (const r of bucketD) {
      console.log(
        `uid=${r.uid}  handle="${r.handle}"  username="${r.username}"  displayName="${r.displayName}"`
      );
    }
  }
  console.log('');

  console.log('--- Simulated web-canonical repair totals (NOT written) ---');
  console.log(`username filled (from handle)                 : ${usernameFilledFromHandle}`);
  console.log(`handle filled/corrected (to match username)   : ${handleFilledOrCorrected}`);
  console.log(`handleLowercased filled/corrected             : ${handleLowercasedFixed}`);
  console.log(`user_search.username rebuilt                  : ${searchUsernameRebuilt}\n`);

  console.log('READ ONLY — nothing written.');
}

main().catch((e) => {
  console.error('audit failed:', e);
  process.exit(1);
});
