#!/usr/bin/env node
// W17 — WHAT RULINGS 29, 30 AND 33 WOULD NOW DO FOR READERS WHO WERE ALREADY DELETED.
//
//   node scripts/account/rulings-report.mjs            (needs serviceAccountKey.json)
//
// READ-ONLY, and COUNTS ONLY: no uid, no name, no words are printed (Actions logs are public, W12,
// and this is a report for Ikenna). It writes nothing anywhere. Every deletion record already has
// its scrub step, so the 15-minute scrub will never touch these readers again; this says what the
// rulings of 26 Sep would do if Ikenna says to apply them backwards.
//
//   29  anything of theirs still up (comments, replies, Square posts) — planned against TODAY's data
//   30  what the OLD scrub removed that ruling 30 keeps: other readers' replies under a deleted
//       reader's comment or post, and the tombstones they would stand under. Planned against the
//       daily backup taken BEFORE each deletion — the only place those replies still exist. A
//       reply written after that backup and before the deletion is not in it, so this is a floor.
//   33  reader voices quoting them — today (a voice still linked to a deleted uid) and in the
//       backup (a voice the old scrub DETACHED, which ruling 33 would take down).
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { planScrub, SCAN_NODES } from './scrub-plan.mjs';
import { mintToken } from '../rules-pull.mjs';

const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings-default-rtdb-backups';
initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: DB_URL });
const db = getDatabase();

const records = (await db.ref('deletions').get()).val() || {};
const today = {};
await Promise.all(SCAN_NODES.map(async (n) => { today[n] = (await db.ref(n).get()).val(); }));

const token = await mintToken();
const list = await (await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?maxResults=500`, { headers: { Authorization: `Bearer ${token}` } })).json();
const archives = (list.items || []).filter((o) => o.name.endsWith('_data.json.gz')).map((o) => ({ name: o.name, at: Date.parse(o.timeCreated) })).sort((a, b) => a.at - b.at);
const cache = new Map();
async function archive(name) {
  if (!cache.has(name)) {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    cache.set(name, JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer()))));
  }
  return cache.get(name);
}

const sum = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; return a; };
const r29 = {}, r30 = {}, r33 = { voicesStillLinkedToday: 0, voicesDetachedEarlier: 0 };
let readers = 0, noBackup = 0, stillPresentToday = 0;
const deletedUids = new Set(Object.keys(records));
for (const [uid, rec] of Object.entries(records)) {
  readers++;
  // 29 — against today.
  const now = planScrub(uid, { ...today, userNode: null });
  sum(r29, { comments: now.counts.comments + now.counts.commentTombstones, replies: now.counts.replies, squarePosts: now.counts.squarePosts + now.counts.squareArchived + now.counts.squareTombstones });
  // 30 — against the last backup before the request.
  const at = Number(rec?.requestedAt || rec?.updatedAt || 0);
  const before = archives.filter((a) => a.at < at).at(-1);
  if (!before) { noBackup++; continue; }
  const snap = await archive(before.name);
  const then = planScrub(uid, { ...Object.fromEntries(SCAN_NODES.map((n) => [n, snap[n] ?? null])), userNode: null });
  sum(r30, {
    commentsThatWouldBeTombstones: then.counts.commentTombstones,
    repliesByOthersRemovedThatRuling30Keeps: then.counts.repliesByOthersKept,
    squarePostsThatWouldBeTombstones: then.counts.squareTombstones,
    squareRepliesByOthersRemovedThatRuling30Keeps: then.counts.squareRepliesByOthersKept,
  });
  // Were those replies really removed? Count any that still exist today (the old scrub should have taken all).
  for (const [slug, thread] of Object.entries(snap.comments || {})) {
    for (const [cid, c] of Object.entries(thread || {})) {
      if (c && c.parentId && c.authorUid !== uid && (thread[c.parentId]?.authorUid === uid) && today.comments?.[slug]?.[cid]) stillPresentToday++;
    }
  }
  // 33 — a voice linked to them in the backup, and not linked (detached) today.
  for (const [id, v] of Object.entries(snap.cms_voices || {})) if (v?.matchUid === uid && today.cms_voices?.[id] && today.cms_voices[id].matchUid !== uid) r33.voicesDetachedEarlier++;
}
for (const v of Object.values(today.cms_voices || {})) if (v?.matchUid && deletedUids.has(v.matchUid)) r33.voicesStillLinkedToday++;

console.log(JSON.stringify({
  deletedReaders: readers,
  withABackupFromBeforeTheirDeletion: readers - noBackup,
  ruling29_stillUpToday: r29,
  ruling30_fromTheBackupsBeforeEachDeletion: r30,
  ruling30_repliesStillPresentToday: stillPresentToday,
  ruling33: r33,
  archivesRead: [...cache.keys()].map((n) => n.slice(0, 20)),
}, null, 2));
process.exit(0);
