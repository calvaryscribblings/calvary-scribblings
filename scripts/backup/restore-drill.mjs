// THE RESTORE DRILL — proving the backups can actually be restored.
//
// An untested backup is a hope. This restores the newest automated backup into the
// LOCAL EMULATOR, reads it back, and compares it against the archive it came from —
// so the person doing this for real, on a bad day, is following a path that has been
// walked rather than one that was written down and never tried.
//
// It touches nothing live. The emulator is wiped at the start of the run.
//
// Usage:
//   firebase emulators:exec --only database --project demo-calvary-restore \
//     "node scripts/backup/restore-drill.mjs"
//
// Optional: --object <name> to drill a SPECIFIC archive rather than the newest, which
// is what you want when recovering something that was already wrong at the last backup.

import { gunzipSync } from 'node:zlib';
import { mintToken } from '../rules-pull.mjs';

const BUCKET = 'calvary-scribblings-default-rtdb-backups';
const EMU = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const NS = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'demo-calvary-restore';
const EMU_ROOT = `http://${EMU}/.json?ns=${NS}`;

const argObject = (() => {
  const i = process.argv.indexOf('--object');
  return i > -1 ? process.argv[i + 1] : null;
})();

function fail(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

// ---------------------------------------------------------------------------
console.log('THE RESTORE DRILL\n' + '='.repeat(60));

const token = await mintToken();
const H = { Authorization: `Bearer ${token}` };

// 1. Find the archive.
let items = [], pageToken = '';
do {
  const r = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?fields=items(name,size,timeCreated),nextPageToken&maxResults=1000${pageToken ? `&pageToken=${pageToken}` : ''}`,
    { headers: H },
  );
  if (!r.ok) fail(`bucket list failed (${r.status}) — is the service account still authorised?`);
  const j = await r.json();
  items = items.concat(j.items || []);
  pageToken = j.nextPageToken || '';
} while (pageToken);

const archives = items.filter((o) => o.name.endsWith('_data.json.gz'))
  .sort((a, b) => (a.timeCreated < b.timeCreated ? 1 : -1));
if (!archives.length) fail('no data archives in the bucket at all');

const chosen = argObject ? archives.find((a) => a.name === argObject) : archives[0];
if (!chosen) fail(`no archive named ${argObject}`);
console.log(`archive : ${chosen.name}`);
console.log(`taken   : ${chosen.timeCreated}`);
console.log(`size    : ${(Number(chosen.size) / 1048576).toFixed(2)} MB gzip`);

// 2. Download + inflate.
const dl = await fetch(
  `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(chosen.name)}?alt=media`,
  { headers: H },
);
if (!dl.ok) fail(`download failed (${dl.status})`);
const raw = gunzipSync(Buffer.from(await dl.arrayBuffer()));
console.log(`inflated: ${(raw.length / 1048576).toFixed(2)} MB`);

let tree;
try { tree = JSON.parse(raw); } catch (e) { fail(`the archive is not valid JSON: ${e.message}`); }
const nodes = Object.keys(tree);
console.log(`nodes   : ${nodes.length}`);

// 3. Restore into the emulator. Wipe first — a restore onto a dirty tree proves nothing.
console.log('\nrestoring into the emulator…');
const wipe = await fetch(EMU_ROOT, { method: 'DELETE' });
if (!wipe.ok) fail(`emulator wipe failed (${wipe.status}) — is the database emulator running?`);

const put = await fetch(EMU_ROOT, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: raw,
});
if (!put.ok) fail(`restore PUT failed (${put.status}): ${(await put.text()).slice(0, 300)}`);

// 4. Read it back and compare against the archive.
console.log('reading it back…\n');
const back = await fetch(EMU_ROOT);
if (!back.ok) fail(`read-back failed (${back.status})`);
const restored = await back.json();

let bad = 0;
const checks = [];
const check = (label, ok, detail = '') => { checks.push({ label, ok, detail: ok ? '' : detail }); if (!ok) bad++; };

// ⚠ A JSON.stringify COMPARE IS THE WRONG TEST AND THE FIRST RUN OF THIS DRILL FAILED ON IT.
// RTDB returns children in ITS OWN key order, not the archive's, so stringify reported six
// nodes as corrupt when every child count matched and a spot-checked record was identical
// byte for byte. It also returns a dense run of numeric keys as an ARRAY where the archive
// may hold an object, which is the same data in RTDB's model.
//
// So the comparison is canonical: keys sorted, numeric-keyed objects and arrays treated as
// equivalent. Recorded because "the restore is broken" was the wrong conclusion available for
// free, and the drill exists to be believed on a bad day.
function canon(v) {
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { if (x !== null && x !== undefined) o[String(i)] = canon(x); });
    return o;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
const sameTree = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

check('top-level node count', Object.keys(restored).length === nodes.length,
  `${Object.keys(restored).length} vs ${nodes.length}`);

// Per-node child counts — catches a partial write that a root-level count would miss.
let mismatched = [];
for (const n of nodes) {
  const a = tree[n], b = restored[n];
  const ca = a && typeof a === 'object' ? Object.keys(a).length : -1;
  const cb = b && typeof b === 'object' ? Object.keys(b).length : -1;
  if (ca !== cb) mismatched.push(`${n} (${ca} vs ${cb})`);
}
check('every node has its child count', mismatched.length === 0, mismatched.slice(0, 5).join(', '));

// The things a restore is FOR. Named explicitly, because these are what the Book Store
// opening on 30 Sep 2026 puts at risk, and a generic byte-compare would not say so.
const spot = [
  ['open_pages', 'community writing'],
  ['bookstore_purchases', 'reader entitlements — money'],
  ['bookstore_titles', 'the catalogue'],
  ['users', 'reader accounts'],
  ['bookstore_reading_progress', 'reading positions'],
  ['points', 'the leaderboard that decides payouts'],
  ['wallet', 'balances'],
  ['comments', 'the threads'],
];
for (const [node, why] of spot) {
  const a = tree[node], b = restored[node];
  if (a === undefined) { check(`${node} — ${why}`, true, 'not present in this archive'); continue; }
  check(`${node} — ${why}`, sameTree(a, b), 'restored data differs from the archive');
}

// A deep spot-check: one real record, compared field by field rather than by count.
const opId = Object.keys(tree.open_pages || {})[0];
if (opId) {
  check(`open_pages/${opId} is identical field for field`,
    sameTree(tree.open_pages[opId], restored.open_pages?.[opId]));
}

check('THE WHOLE TREE, every node, canonically compared', sameTree(tree, restored));

for (const c of checks) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}${c.detail ? `   [${c.detail}]` : ''}`);
}

console.log('\n' + '='.repeat(60));
if (bad) fail(`${bad} check(s) failed — THE BACKUP DOES NOT RESTORE CLEANLY.`);
console.log('✓ RESTORE PROVEN: the newest automated backup restores completely into a');
console.log('  live database and reads back identical to the archive.');
console.log('\n  The same archive restores to production by pointing the PUT at the real');
console.log('  database URL instead of the emulator — see scripts/backup/RESTORE.md.');
process.exit(0);
