// Repair user handle/username fields under the "WEB username is canonical" rule.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/repair-handle-fields.mjs            # plan only, no writes
//   node scripts/repair-handle-fields.mjs --apply    # perform writes
//
// Decided rule: the WEB `username` field is canonical. The whole real user
// base lives on web; the app is a few testers writing to a separate `handle`
// field. So for every user:
//     canonical = username (if non-empty) else handle (if non-empty) else SKIP
// Users with neither (bucket E) are left entirely untouched.
//
// canonical is LOWERCASED before being written anywhere, so every repaired
// record conforms to the web username validator (^[a-z0-9_]{3,20}$).
//
// App auto-generated placeholder handles (a random 10-char base-36 token the
// app assigns when no handle is chosen, e.g. "6h6rpfpgbz") are NOT promoted to
// username — those users are left handle-less (display-name-only readers).
//
// Per user, build a multi-path update writing ONLY fields that are missing or
// wrong (no no-op diffs):
//   - users/{uid}/username          = canonical            (fills bucket A)
//   - users/{uid}/handle            = canonical            (fills B, fixes D typo)
//   - users/{uid}/handleLowercased  = canonical.toLowerCase()
//   - user_search/{uid}/username    = canonical            (ONLY if a
//                                       user_search entry already exists;
//                                       never creates a new one)
//   - usernames/{canonicalLower}    = uid                  (set-only, never
//                                       deletes; only when missing/wrong)
//
// DRY RUN (default): prints a per-user table of what WOULD change + totals,
// ends with the no-writes notice.
// --apply: performs every per-user update, prints users touched + fields written.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');

// Old house/admin catch-all uid — not a real person, never touch it.
const EXCLUDED_UID = 'NH7HmRbwheVFG6XZRGaJDeuBWdJ3';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lc = (v) => str(v).toLowerCase();

// App auto-generated placeholder handle: exactly 10 lowercase base-36 chars
// containing at least one digit AND at least one letter (e.g. "6h6rpfpgbz",
// "9szhkvv9dn"). Real name-derived handles ("gaspar", "nana") never match.
const AUTO_TOKEN = (h) =>
  /^[a-z0-9]{10}$/.test(h) && /[0-9]/.test(h) && /[a-z]/.test(h);

async function main() {
  const keyPath = resolve(ROOT, 'serviceAccountKey.json');
  const serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: DB_URL,
  });
  const db = getDatabase();

  const [usersSnap, searchSnap, usernamesSnap] = await Promise.all([
    db.ref('users').get(),
    db.ref('user_search').get(),
    db.ref('usernames').get(),
  ]);
  const users = usersSnap.val() || {};
  const search = searchSnap.val() || {};
  const usernames = usernamesSnap.val() || {};

  // The combined multi-path update we would (or do) apply.
  const updates = {};
  // Per-user plan rows for the dry-run table.
  const plan = []; // { uid, displayName, changes: [{ field, from, to }] }

  // Field-write tallies
  let usernameFills = 0;       // bucket A: username was empty
  let handleFills = 0;         // handle was empty
  let handleCorrections = 0;   // handle non-empty but wrong (bucket D typo)
  let handleLowercasedWrites = 0;
  let searchRebuilds = 0;
  let usernamesIndexWrites = 0;

  let scanned = 0;
  let skippedHouse = 0;
  let skippedBucketE = 0;
  let skippedJunk = 0;
  const junkSkipped = []; // { uid, displayName, handle }

  for (const [uid, u] of Object.entries(users)) {
    if (uid === EXCLUDED_UID) { skippedHouse += 1; continue; }
    if (!u || typeof u !== 'object') { skippedHouse += 1; continue; }
    scanned += 1;

    const username = str(u.username);
    const handle = str(u.handle);
    const handleLowercased = str(u.handleLowercased);
    const displayName = str(u.displayName) || str(u.name);

    // Web-canonical: username wins; fall back to handle only if username empty.
    const canonicalRaw = username || handle;
    if (!canonicalRaw) { skippedBucketE += 1; continue; } // bucket E — untouched

    // Don't promote an app auto-generated placeholder token to a username.
    // (Only relevant when falling back to handle; real usernames never match.)
    if (!username && AUTO_TOKEN(handle)) {
      skippedJunk += 1;
      junkSkipped.push({ uid, displayName, handle });
      continue;
    }

    // Lowercase the canonical so every written value conforms to the web schema.
    const canonical = lc(canonicalRaw);
    const canonicalLower = canonical; // already lowercase

    const changes = [];

    // users/{uid}/username
    if (username !== canonical) {
      updates[`users/${uid}/username`] = canonical;
      changes.push({ field: 'users/username', from: username || '∅', to: canonical });
      usernameFills += 1; // only reachable when username was empty (else canonical===username)
    }

    // users/{uid}/handle
    if (handle !== canonical) {
      updates[`users/${uid}/handle`] = canonical;
      changes.push({ field: 'users/handle', from: handle || '∅', to: canonical });
      if (handle) handleCorrections += 1; else handleFills += 1;
    }

    // users/{uid}/handleLowercased
    if (handleLowercased !== canonicalLower) {
      updates[`users/${uid}/handleLowercased`] = canonicalLower;
      changes.push({ field: 'users/handleLowercased', from: handleLowercased || '∅', to: canonicalLower });
      handleLowercasedWrites += 1;
    }

    // user_search/{uid}/username — only if an entry already exists.
    const sEntry = search[uid];
    if (sEntry && typeof sEntry === 'object') {
      const sUsername = str(sEntry.username);
      if (sUsername !== canonical) {
        updates[`user_search/${uid}/username`] = canonical;
        changes.push({ field: 'user_search/username', from: sUsername || '∅', to: canonical });
        searchRebuilds += 1;
      }
    }

    // usernames/{canonicalLower} reverse-lookup — set-only, never delete.
    const existingIndex = str(usernames[canonicalLower]);
    if (existingIndex !== uid) {
      updates[`usernames/${canonicalLower}`] = uid;
      changes.push({ field: `usernames/${canonicalLower}`, from: existingIndex || '∅', to: uid });
      usernamesIndexWrites += 1;
    }

    if (changes.length > 0) plan.push({ uid, displayName, changes });
  }

  // ---- Output ----
  console.log(`=== Handle field repair (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Users scanned: ${scanned}  (skipped ${skippedHouse} house/malformed, ${skippedBucketE} bucket-E no-handle, ${skippedJunk} app auto-token)\n`);

  if (junkSkipped.length > 0) {
    console.log(`--- Skipped app auto-generated tokens (NOT promoted to username) ---`);
    for (const j of junkSkipped) {
      console.log(`uid=${j.uid}  displayName="${j.displayName}"  handle="${j.handle}"`);
    }
    console.log('');
  }

  console.log(`--- Per-user plan (${plan.length} users with changes) ---`);
  for (const p of plan) {
    console.log(`\nuid=${p.uid}  displayName="${p.displayName}"`);
    for (const c of p.changes) {
      console.log(`    ${c.field}: "${c.from}" -> "${c.to}"`);
    }
  }
  console.log('');

  const totalFields =
    usernameFills + handleFills + handleCorrections +
    handleLowercasedWrites + searchRebuilds + usernamesIndexWrites;

  console.log('--- Totals (fields that would be written) ---');
  console.log(`username fills (from handle)          : ${usernameFills}`);
  console.log(`handle fills (was empty)              : ${handleFills}`);
  console.log(`handle corrections (typo -> username) : ${handleCorrections}`);
  console.log(`handleLowercased fills/corrections    : ${handleLowercasedWrites}`);
  console.log(`user_search.username rebuilds         : ${searchRebuilds}`);
  console.log(`usernames/ reverse-lookup set         : ${usernamesIndexWrites}`);
  console.log(`users touched                         : ${plan.length}`);
  console.log(`total field writes                    : ${totalFields}  (${Object.keys(updates).length} paths)\n`);

  if (!APPLY) {
    console.log('DRY RUN — no writes. Re-run with --apply.');
    return;
  }

  if (Object.keys(updates).length === 0) {
    console.log('Nothing to write.');
    return;
  }

  await db.ref().update(updates);
  console.log(`APPLIED — ${plan.length} users touched, ${Object.keys(updates).length} field paths written.`);
}

main().catch((e) => {
  console.error('repair failed:', e);
  process.exit(1);
});
