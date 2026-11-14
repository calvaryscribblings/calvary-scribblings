// BACKUP LIVENESS — does the thing we believe in still run?
//
// ⚠ THE BACKUP ITSELF IS NOT BUILT HERE AND MUST NOT BE. Firebase's own scheduled
// Realtime Database backup is enabled on this project and has run daily since
// 2026-08-23. This file does not duplicate it. It watches it.
//
// WHY THAT NEEDS WATCHING. R33.2 found the Square's cleanup route had never executed
// once, for two independent reasons, and nothing noticed for months. A backup is the
// worst possible place for that failure mode, because a backup that has silently
// stopped is not neutral — it is BELIEVED, and the belief is what stops anyone
// looking for another copy on the day it matters.
//
// This project has already paid that price twice over in one week:
//   · scripts/backup/export.mjs asserted in a comment that automated backups had
//     never been enabled. They were switched on 48 MINUTES after that comment was
//     written and the comment was never corrected.
//   · Acting on it, R36 reported that no backup existed, restored a damaged live
//     record from a stale mirror, and declared 267 characters of Ikenna's writing
//     permanently lost. They were sitting in that morning's backup the whole time.
//
// So the failure this guards is not hypothetical and it is not really technical.
//
// WHAT IT CHECKS
//   1. FRESHNESS — the newest data archive is younger than MAX_AGE_HOURS.
//   2. PLAUSIBILITY — it is not a fraction of the size of recent ones. A job that
//      keeps running while backing up an empty database is still "green".
//   3. INTEGRITY — it actually inflates and parses, and carries the nodes that
//      matter. A corrupt archive fails on the day it is needed, not before.
//
// Exit 1 fails the workflow, which is the whole point: silence must be loud.

import { gunzipSync } from 'node:zlib';
import { mintToken } from '../rules-pull.mjs';
import { assess, MAX_AGE_HOURS, MUST_CARRY } from './assess.mjs';

const BUCKET = 'calvary-scribblings-default-rtdb-backups';
const maxAgeHours = Number(process.env.BACKUP_MAX_AGE_HOURS || MAX_AGE_HOURS);
const HEARTBEAT = 'ops/backup_liveness';
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const note = (s) => console.log('  ' + s);

console.log('BACKUP LIVENESS\n' + '='.repeat(60));

const token = await mintToken();
const H = { Authorization: `Bearer ${token}` };

// ---- 1. Freshness -----------------------------------------------------------
let items = [], pageToken = '';
do {
  const r = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?fields=items(name,size,timeCreated),nextPageToken&maxResults=1000${pageToken ? `&pageToken=${pageToken}` : ''}`,
    { headers: H },
  );
  if (!r.ok) {
    console.error(`::error::cannot list the backup bucket (HTTP ${r.status}). Either the bucket is gone or the service account lost access — both mean there is no backup.`);
    process.exit(1);
  }
  const j = await r.json();
  items = items.concat(j.items || []);
  pageToken = j.nextPageToken || '';
} while (pageToken);

// Open the newest archive before deciding, so "it exists" and "it is usable" are
// different findings rather than the same one.
const sortedArchives = items.filter((o) => o.name.endsWith('_data.json.gz'))
  .sort((a, b) => (a.timeCreated < b.timeCreated ? 1 : -1));
if (!sortedArchives.length) {
  console.error('::error::THE BACKUP BUCKET IS EMPTY. Scheduled backups are not running.');
  process.exit(1);
}
const newest = sortedArchives[0];

let treeKeys = null, inflateError = null, downloadStatus = null, inflatedMb = null;
const dl = await fetch(
  `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(newest.name)}?alt=media`,
  { headers: H },
);
downloadStatus = dl.status;
if (dl.ok) {
  try {
    const raw = gunzipSync(Buffer.from(await dl.arrayBuffer()));
    treeKeys = Object.keys(JSON.parse(raw));
    inflatedMb = (raw.length / 1048576).toFixed(2);
  } catch (e) { inflateError = e.message; }
}

const { problems, ageHours } = assess(items, Date.now(), { treeKeys, inflateError, downloadStatus }, { maxAgeHours });

note(`archives held : ${sortedArchives.length}`);
note(`newest        : ${newest.name}`);
note(`taken         : ${newest.timeCreated}  (${ageHours.toFixed(1)}h ago)`);
note(`size          : ${(Number(newest.size) / 1048576).toFixed(2)} MB`);
if (inflatedMb) note(`inflates to   : ${inflatedMb} MB, ${treeKeys.length} top-level nodes`);
if (treeKeys && !problems.some((p) => p.startsWith('INCOMPLETE'))) note(`carries       : ${MUST_CARRY.join(', ')}`);

// ---- Heartbeat --------------------------------------------------------------
// Written on every run, pass or fail, so "the checker itself stopped" is visible too.
// ⚠ The outermost layer is irreducible: something must be trusted to notice. Here that
// is GitHub's failure notification on a scheduled workflow — and note that GitHub
// DISABLES schedules after 60 days without repo activity, which is this system's real
// silent-failure mode. This heartbeat is what a human can look at to check the checker.
try {
  const body = JSON.stringify({
    checkedAt: Date.now(),
    ok: problems.length === 0,
    newestBackupAt: newest.timeCreated,
    newestBackupAgeHours: Number(ageHours.toFixed(2)),
    archiveCount: sortedArchives.length,
    problems,
  });
  const hb = await fetch(`${DB}/${HEARTBEAT}.json`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body,
  });
  note(`heartbeat     : ${hb.ok ? `written to ${HEARTBEAT}` : `FAILED (HTTP ${hb.status})`}`);
} catch (e) {
  note(`heartbeat     : FAILED (${e.message})`);
}

console.log('\n' + '='.repeat(60));
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\n✗ ${problems.length} problem(s). THE BACKUP CANNOT BE TRUSTED RIGHT NOW.`);
  process.exit(1);
}
console.log('✓ backups are running, plausible, and readable.');
process.exit(0);
