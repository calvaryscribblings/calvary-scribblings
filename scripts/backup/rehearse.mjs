// THE REHEARSAL. Restore the backup into a scratch location and check what comes back.
//
//   node scripts/backup/rehearse.mjs <backup-dir>              # full: round-trips the tree
//   node scripts/backup/rehearse.mjs <backup-dir> --offline    # checksums + hazards only
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// A BACKUP NOBODY HAS RESTORED IS A HOPE
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// This is the half that is usually skipped, and it is the half that decides whether the
// other half was worth running. It changes NOTHING live: the tree is written under a scratch
// node, read back, compared byte for byte, and deleted again.
//
//   scratch path:  _restore_rehearsal/<stamp>
//
// Cost of a full run: roughly 13 MB written and 13 MB read, against a 360 MB/day no-cost
// allowance. Use --offline (free) for a routine integrity check and the full form when you
// actually want to know that a restore works.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// IT ALSO CHECKS WHAT A RESTORE WOULD BREAK
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Verifying that bytes survive a round trip is the easy half. The Fortress Audit named three
// things that break on RESTORED data even when every byte is perfect, and each is asserted
// here rather than left in a document nobody reads at 3am:
//
//   1. THE FOUNDER UIDS ARE HARDCODED into database.rules.json and storage.rules. If the
//      accounts behind them are not in the backup, a restored project has an admin surface
//      nobody can reach, and the fix needs a rules edit and a deploy before anyone can log
//      in and do anything.
//   2. THE READING-POSITION PIN IS A CLOUD STORAGE GENERATION. Re-uploading an EPUB mints a
//      new generation, which drops every reader of that title from an exact resume position
//      to an approximate one and triggers a silent re-download. Restoring the ORIGINAL bytes
//      preserves the pin only if the object is restored, not re-uploaded.
//   3. STORIES ON coverHold STAY UNPUBLISHED until the covers reconciler next runs, because
//      publication and cover land in one atomic patch by design. A restore is not "live
//      again" the moment the data is back.

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintToken } from '../rules-pull.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const DIR = process.argv[2];
const OFFLINE = process.argv.includes('--offline');
if (!DIR) {
  console.error('\n  Usage: node scripts/backup/rehearse.mjs <backup-dir> [--offline]\n');
  process.exit(1);
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(await readFile(resolve(DIR, 'MANIFEST.json'), 'utf8'));

let failures = 0;
let warnings = 0;
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const pass = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => { warnings++; console.log(`  ! ${m}`); };

console.log(`\nrehearsing ${DIR}`);
console.log(`taken ${manifest.takenAt}\n`);

// ── 1. Integrity: does the backup say what it is? ──────────────────────────────────────
console.log('INTEGRITY');
const dbGz = await readFile(resolve(DIR, manifest.parts.database.file));
if (sha256(dbGz) !== manifest.parts.database.sha256Gzip) fail('database archive does not match its manifest checksum');
else pass('database archive matches its manifest checksum');

const dbRaw = gunzipSync(dbGz);
if (sha256(dbRaw) !== manifest.parts.database.sha256Raw) fail('decompressed database does not match its manifest checksum');
else pass('decompressed database matches its manifest checksum');

let tree;
try {
  tree = JSON.parse(dbRaw.toString('utf8'));
  pass(`database parses — ${Object.keys(tree).length} top-level nodes`);
} catch (e) {
  fail(`database does not parse: ${e.message}`);
  process.exit(1);
}

const authBuf = await readFile(resolve(DIR, manifest.parts.accounts.file));
if (sha256(authBuf) !== manifest.parts.accounts.sha256) fail('account export does not match its manifest checksum');
else pass('account export matches its manifest checksum');
const accounts = JSON.parse(authBuf.toString('utf8')).users || [];
if (accounts.length !== manifest.parts.accounts.users) fail(`account count differs: ${accounts.length} vs ${manifest.parts.accounts.users}`);
else pass(`${accounts.length} accounts present`);

if (manifest.parts.epubs?.skipped) {
  warn('EPUBs were skipped at export time — the sellable inventory is NOT in this backup');
} else {
  let bad = 0;
  for (const f of manifest.parts.epubs.files) {
    const buf = await readFile(resolve(DIR, f.file));
    if (sha256(buf) !== f.sha256) { bad++; fail(`${f.object} does not match its manifest checksum`); }
  }
  if (!bad) pass(`${manifest.parts.epubs.files.length} master EPUBs match their checksums (${(manifest.parts.epubs.totalBytes / 1048576).toFixed(2)} MB)`);
}

// ── 2. Hazards: what would break on this data even if every byte is perfect ────────────
console.log('\nWHAT A RESTORE WOULD BREAK');

// (1) The hardcoded founder uids.
const rules = await readFile(resolve(ROOT, 'database.rules.json'), 'utf8');
const founders = [...new Set([...rules.matchAll(/auth\.uid\s*===?\s*'([A-Za-z0-9]{20,})'/g)].map((m) => m[1]))];
if (!founders.length) warn('no hardcoded founder uid found in database.rules.json — check this script still matches the rules');
const byUid = new Set(accounts.map((u) => u.localId));
for (const uid of founders) {
  if (byUid.has(uid)) pass(`founder account ${uid.slice(0, 8)}… is in the backup`);
  else fail(`founder uid ${uid} is hardcoded in the rules but NOT in this backup — a restore would leave an admin surface nobody can reach`);
}

// (2) The reading-position pin.
if (!manifest.parts.epubs?.skipped) {
  const gens = manifest.parts.epubs.files.filter((f) => f.generation);
  if (gens.length === manifest.parts.epubs.files.length) {
    pass(`${gens.length} Cloud Storage generations recorded — the reading-position pins are known`);
    warn('re-UPLOADING these files mints new generations and drops every reader to an approximate position; restore the objects rather than re-uploading them');
  } else {
    fail('some EPUBs have no recorded generation — the reading-position pin cannot be checked after a restore');
  }
}

// (3) Stories that would come back unpublished.
const held = Object.entries(tree.cms_stories || {}).filter(([, s]) => s && s.coverHold);
if (held.length) warn(`${held.length} stor${held.length === 1 ? 'y is' : 'ies are'} on coverHold and would stay unpublished until the covers cron next runs`);
else pass('no story is on coverHold — nothing is waiting on the covers cron');

// (4) The thing the audit could not check, restated so it is not forgotten.
warn('password hash parameters are NOT in this backup (console only) — without them the 159 password accounts cannot be re-imported and every one of those readers must reset');

// ── 3. The round trip ──────────────────────────────────────────────────────────────────
if (OFFLINE) {
  console.log('\nROUND TRIP\n  – skipped (--offline)');
} else {
  console.log('\nROUND TRIP');
  const token = await mintToken();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scratch = `_restore_rehearsal/${stamp}`;
  const url = (p) => `${DB}/${p}.json?access_token=${token}`;

  try {
    const put = await fetch(url(scratch), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: dbRaw,
    });
    if (!put.ok) throw new Error(`restore write failed: ${put.status} ${(await put.text()).slice(0, 300)}`);
    pass(`restored ${(dbRaw.length / 1048576).toFixed(2)} MB into ${scratch}`);

    const back = await fetch(url(scratch));
    if (!back.ok) throw new Error(`read back failed: ${back.status}`);
    const returned = await back.json();

    // Compare on canonical JSON, not raw bytes: RTDB does not preserve key order and drops
    // nulls, so a byte comparison would fail for reasons that are not data loss.
    const norm = (v) => {
      if (Array.isArray(v)) return v.map(norm);
      if (v && typeof v === 'object') {
        return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
      }
      return v;
    };
    const before = JSON.stringify(norm(tree));
    const after = JSON.stringify(norm(returned));
    if (before === after) {
      pass('every node came back identical');
    } else {
      // Say WHICH nodes differ — "it differs" is not actionable at 3am.
      const a = norm(tree), b = norm(returned);
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      const diff = [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      fail(`${diff.length} node(s) differ after the round trip: ${diff.slice(0, 10).join(', ')}${diff.length > 10 ? ' …' : ''}`);
    }
  } finally {
    const del = await fetch(url(scratch), { method: 'DELETE' });
    if (del.ok) pass('scratch restore removed');
    else fail(`scratch restore could NOT be removed — delete ${scratch} by hand`);
  }
}

console.log(`\n${failures ? '✗' : '✓'} ${failures} failure(s), ${warnings} warning(s)\n`);
process.exit(failures ? 1 : 0);
