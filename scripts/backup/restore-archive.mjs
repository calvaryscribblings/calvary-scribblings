// SAFETY-1 — put data back from a daily database backup, THROUGH THE GUARD.
//
//   node scripts/backup/restore-archive.mjs --list
//   node scripts/backup/restore-archive.mjs --object <archive> --path open_pages/<id>           # dry run
//   node scripts/backup/restore-archive.mjs --object <archive> --path open_pages/<id> --apply   # write
//   node scripts/backup/restore-archive.mjs --object <archive> --all [--apply]                  # every node
//
// <archive> is a name from --list (…_data.json.gz in calvary-scribblings-default-rtdb-backups).
//
// One record is almost always what you want (RESTORE.md, "Recovering ONE record"). --all puts
// back every top-level node the archive holds, one path per node, never the root. A node created
// since the archive was taken is left alone; nothing here deletes a node the archive doesn't name.
//
// This is a bulk write like any other. Dry by default. With --apply the guard first backs up
// what is live at those paths now and verifies that backup, so the restore itself can be undone
// with scripts/safety/restore.mjs. It prints counts and hashes, never the data.
//
// Rehearse it in the emulator first (it follows FIREBASE_DATABASE_EMULATOR_HOST and
// FIREBASE_STORAGE_EMULATOR_HOST, which must be set together):
//   firebase emulators:exec --only database,storage --project demo-calvary-restore \
//     "node scripts/backup/restore-archive.mjs --object <archive> --all --apply"

import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mintToken } from '../rules-pull.mjs';
import { openGuard, checkPath } from '../safety/guard.mjs';
import { canon } from './verify-live.mjs';

const BUCKET = 'calvary-scribblings-default-rtdb-backups';
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const hash = (v) => createHash('sha256').update(JSON.stringify(canon(v ?? null))).digest('hex').slice(0, 12);
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const token = await mintToken();
const H = { Authorization: `Bearer ${token}` };

async function archives() {
  let items = [], pageToken = '';
  do {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?fields=items(name,size,timeCreated),nextPageToken${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: H });
    if (!r.ok) fail(`bucket list failed (HTTP ${r.status})`);
    const j = await r.json();
    items = items.concat(j.items || []);
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return items.filter((o) => o.name.endsWith('_data.json.gz')).sort((a, b) => (a.timeCreated < b.timeCreated ? 1 : -1));
}

if (args.includes('--list')) {
  for (const a of await archives()) console.log(`${a.timeCreated}  ${(Number(a.size) / 1048576).toFixed(2)} MB  ${a.name}`);
  process.exit(0);
}

const object = opt('--object');
const path = opt('--path');
const all = args.includes('--all');
if (!object || (!path && !all) || (path && all)) {
  fail('usage: --object <archive> and exactly one of --path <path> or --all (see the top of this file)');
}

const dl = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(object)}?alt=media`, { headers: H });
if (!dl.ok) fail(`download failed (HTTP ${dl.status})`);
const tree = JSON.parse(gunzipSync(Buffer.from(await dl.arrayBuffer())));
console.log(`archive: ${object} (${Object.keys(tree).length} top-level nodes)`);

const guard = await openGuard('restore-archive');
let updates;
if (all) {
  updates = Object.fromEntries(Object.entries(tree).map(([n, v]) => [checkPath(n), v]));
} else {
  const p = checkPath(path);
  const value = p.split('/').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), tree);
  if (value === undefined) fail('that path is not in this archive (nothing to restore; restoring would DELETE it)');
  updates = { [p]: value };
}

// What would change, by hash, without printing the data.
let same = 0, differ = 0, absent = 0;
for (const [p, v] of Object.entries(updates)) {
  const live = await guard.get(p);
  if (live === null) absent++;
  else if (hash(live) === hash(v)) same++;
  else differ++;
}
console.log(`paths: ${Object.keys(updates).length} — ${same} already identical to the archive, ${differ} differ, ${absent} absent live`);
if (!all) console.log(`  archive ${hash(Object.values(updates)[0])} vs live ${hash(await guard.get(Object.keys(updates)[0]))} (sha-256, first 12)`);

await guard.update(updates, { label: all ? 'restore every node' : 'restore one path' });

if (guard.apply) {
  let ok = 0;
  for (const [p, v] of Object.entries(updates)) if (hash(await guard.get(p)) === hash(v)) ok++;
  console.log(`read back: ${ok} of ${Object.keys(updates).length} path(s) now identical to the archive`);
  if (ok !== Object.keys(updates).length) process.exitCode = 1;
}
guard.summary();
