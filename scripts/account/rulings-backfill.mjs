#!/usr/bin/env node
// W19 / RULING 48 (Ikenna, 27 Sep 2026) — RULINGS 29, 30 AND 33 APPLY TO PAST DELETIONS.
//
//   node scripts/account/rulings-backfill.mjs            dry run: counts per ruling, writes nothing
//   node scripts/account/rulings-backfill.mjs --apply    back up, then apply
//
// One-off. The 15-minute scrub never revisits a finished deletion, so an account whose scrub ran
// before W17 shipped the rulings (fbe39d2c, 26 Sep 23:31 UTC) was scrubbed under the old plan and
// stays that way unless this runs. For each of those records it plans, against today's data and
// the daily backup taken before the deletion:
//
//   29  anything of theirs still up — comments, replies, Square posts (live and archived): deleted
//   30  (a) a comment or post of theirs still up with another reader's reply beneath it: tombstoned,
//           exactly as the scrub does today
//       (b) another reader's reply the OLD scrub removed with its parent: found in the backup, and
//           counted. It is NOT restored by this script. A reply missing today may have been taken
//           down since by its own author or by a moderator, and the backup cannot say which, so
//           --apply REFUSES while any is found and the case comes back as a report.
//   33  a reader voice quoting them — still linked (the scrub's own plan), or DETACHED by the old
//       scrub (linked in the backup, unlinked today): the record, its images, and a rebuild.
//
// IDEMPOTENT: every change is planned from what is there now, so a second run finds 0.
// Anything else the old scrub left (a reaction, a notification…) is outside ruling 48: the run
// reports it and refuses to apply rather than widen its own brief.
//
// PRIVATE: logs carry counts and `del-xxxxxxxx` refs only (W12 — the repo is public). The backup
// of every record it changes, with its full before-state, goes to ~/calvary-backups (outside the
// repo, mode 600) before the first write.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { planScrub, SCAN_NODES, dropCovered } from './scrub-plan.mjs';

// When the rulings reached the scrub: W17's commit, which the every-15-minutes workflow ran from main.
export const RULINGS_SHIPPED_AT = Date.parse('2026-09-26T23:31:07Z');

const isObj = (v) => v && typeof v === 'object';
const entries = (v) => (isObj(v) ? Object.entries(v) : []);
const byUid = (rec, uid) => isObj(rec) && (rec.authorUid === uid || rec.uid === uid);

// The scrub's counts, split into what ruling 48 is about and what it is not.
const R29 = ['comments', 'replies', 'squarePosts', 'squareArchived'];
const R30 = ['commentTombstones', 'squareTombstones'];
const IN_SCOPE = new Set([...R29, ...R30, 'voicesRemoved', 'repliesByOthersKept', 'squareRepliesByOthersKept']);

/** Which deletion records ruling 48 reaches: scrubbed before the rulings shipped. */
export function pastDeletions(records) {
  return entries(records).filter(([, r]) => Number(r?.steps?.scrub) > 0 && Number(r.steps.scrub) < RULINGS_SHIPPED_AT);
}

/**
 * Other readers' replies the old scrub removed: beneath a comment or post of theirs in the backup,
 * and absent today. Flat comment replies (parentId), nested Open Pages replies, and Square replies.
 */
export function removedReplies(uid, before, today) {
  const found = [];
  for (const [slug, thread] of entries(before?.comments)) {
    for (const [cid, c] of entries(thread)) {
      if (isObj(c) && c.parentId && !byUid(c, uid) && byUid(thread[c.parentId], uid) && !today?.comments?.[slug]?.[cid]) found.push(`comments/${slug}/${cid}`);
      const walk = (node, rel, parentTheirs) => {
        for (const [rid, r] of entries(node?.replies)) {
          const rr = `${rel}/replies/${rid}`;
          const at = rr.split('/').reduce((o, k) => (o == null ? undefined : o[k]), today?.comments?.[slug]);
          if (parentTheirs && !byUid(r, uid) && !at) found.push(`comments/${slug}/${rr}`);
          walk(r, rr, byUid(r, uid));
        }
      };
      walk(c, cid, byUid(c, uid));
    }
  }
  for (const node of ['square_posts', 'square_archive']) {
    const posts = before?.[node];
    for (const [id, p] of entries(posts)) {
      if (isObj(p) && p.parentId && !byUid(p, uid) && byUid(posts[p.parentId], uid) && !today?.[node]?.[id]) found.push(`${node}/${id}`);
    }
  }
  return found;
}

/** Voices the old scrub detached from them: linked in the backup, still up today but unlinked. */
export function detachedVoices(uid, before, today) {
  const out = [];
  for (const [id, v] of entries(before?.cms_voices)) {
    const now = today?.cms_voices?.[id];
    if (v?.matchUid === uid && isObj(now) && now.matchUid !== uid) {
      out.push({ id, storagePrefixes: [...new Set([id, now.slug, v.slug].filter((x) => typeof x === 'string' && x && !x.includes('/')))].map((x) => `voices/${x}/`) });
    }
  }
  return out;
}

/**
 * One past deletion. Pure.
 * @returns {{ counts, plan: { nulls, sets, decrements, voices }, outOfScope: object, refuse: string|null }}
 */
export function planPastDeletion(uid, today, before, { now = Date.now() } = {}) {
  const scrub = planScrub(uid, { ...today, userNode: null }, { now });
  const replies = before ? removedReplies(uid, before, today) : [];
  const detached = before ? detachedVoices(uid, before, today).filter((d) => !scrub.voices.some((v) => v.id === d.id)) : [];
  const outOfScope = Object.fromEntries(Object.entries(scrub.counts).filter(([k, n]) => n && !IN_SCOPE.has(k)));
  const counts = {
    ruling29: Object.fromEntries(R29.map((k) => [k, scrub.counts[k]])),
    ruling30: { tombstonesToWrite: R30.reduce((n, k) => n + scrub.counts[k], 0), repliesRemovedByOldScrub: replies.length },
    ruling33: { voicesStillLinked: scrub.voices.length, voicesDetachedEarlier: detached.length },
  };
  let refuse = null;
  if (replies.length) refuse = `${replies.length} reply/replies by other readers were removed by the old scrub; restoring them needs a decision (see the header)`;
  else if (Object.keys(outOfScope).length) refuse = `the old scrub left things outside rulings 29/30/33: ${JSON.stringify(outOfScope)}`;
  const nulls = dropCovered([...scrub.nulls, ...detached.map((d) => `cms_voices/${d.id}`)]);
  return {
    counts,
    plan: { nulls, sets: scrub.sets, decrements: scrub.decrements, voices: [...scrub.voices, ...detached] },
    outOfScope,
    refuse,
  };
}

export const changes = (p) => p.plan.nulls.length + Object.keys(p.plan.sets).length + p.plan.decrements.length + p.plan.voices.length;

// ─────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const { getStorage } = await import('firebase-admin/storage');
  const { mintToken } = await import('../rules-pull.mjs');
  const { applyPlan, voicesDown } = await import('./scrub.mjs');
  const { fireDeployHook } = await import('../deploy-hook.mjs');
  const { LOG_REF_RE } = await import('../ops/redact.mjs');

  const APPLY = process.argv.includes('--apply');
  const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
  const BUCKET = 'calvary-scribblings-default-rtdb-backups';
  initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: DB_URL, storageBucket: 'calvary-scribblings.firebasestorage.app' });
  const db = getDatabase();
  const bucket = getStorage().bucket();

  const readToday = async () => {
    const t = {};
    await Promise.all(SCAN_NODES.map(async (n) => { t[n] = (await db.ref(n).get()).val(); }));
    return t;
  };
  const token = await mintToken();
  const list = await (await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?maxResults=1000`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const archives = (list.items || []).filter((o) => o.name.endsWith('_data.json.gz')).map((o) => ({ name: o.name, at: Date.parse(o.timeCreated) })).sort((a, b) => a.at - b.at);
  const cache = new Map();
  const archive = async (name) => {
    if (!cache.has(name)) {
      const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      cache.set(name, JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer()))));
    }
    return cache.get(name);
  };

  const records = (await db.ref('deletions').get()).val() || {};
  const cohort = pastDeletions(records);
  let today = await readToday();
  const refOf = (rec, i) => (LOG_REF_RE.test(rec?.logRef || '') ? rec.logRef : `record #${i + 1}`);

  const plans = [];
  for (const [i, [uid, rec]] of cohort.entries()) {
    const at = Number(rec?.requestedAt || rec?.updatedAt || 0);
    const b = archives.filter((a) => a.at < at).at(-1);
    const p = planPastDeletion(uid, today, b ? await archive(b.name) : null);
    plans.push({ uid, ref: refOf(rec, i), hadBackup: !!b, p });
  }

  const total = { ruling29: {}, ruling30: {}, ruling33: {} };
  for (const { p } of plans) for (const r of Object.keys(total)) for (const [k, n] of Object.entries(p.counts[r])) total[r][k] = (total[r][k] || 0) + n;
  const pending = plans.filter(({ p }) => changes(p) > 0 || p.refuse);
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry run',
    deletionRecords: Object.keys(records).length,
    scrubbedBeforeRulingsShipped: cohort.length,
    withABackupFromBeforeTheirDeletion: plans.filter((x) => x.hadBackup).length,
    ...total,
    recordsWithChanges: pending.filter(({ p }) => changes(p) > 0).length,
    refusals: pending.filter(({ p }) => p.refuse).map(({ ref, p }) => `${ref}: ${p.refuse}`),
  }, null, 2));

  if (APPLY) {
    if (pending.some(({ p }) => p.refuse)) { console.error('[backfill] REFUSED — nothing written. See refusals.'); process.exit(3); }
    // Written even when it holds nothing, so an applied run always leaves its record.
    // THE BACKUP, before the first write: every path this run will touch, as it stands now.
    const dir = join(homedir(), 'calvary-backups');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `w19-ruling48-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const before = {};
    for (const { p } of pending) {
      for (const path of [...p.plan.nulls, ...Object.keys(p.plan.sets), ...p.plan.decrements]) before[path] = (await db.ref(path).get()).val();
      for (const v of p.plan.voices) {
        for (const prefix of v.storagePrefixes) {
          const [files] = await bucket.getFiles({ prefix });
          for (const f of files) before[`storage:${f.name}`] = { contentType: f.metadata.contentType, base64: (await f.download())[0].toString('base64') };
        }
      }
    }
    writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), ruling: 48, before }), { mode: 0o600 });
    console.log(`[backfill] backup: ${Object.keys(before).length} record(s) → ~/calvary-backups/${file.split('/').pop()}`);
    for (const { ref, p } of pending) {
      const moved = await applyPlan(db, p.plan);
      if (p.plan.voices.length) {
        const v = await voicesDown(p.plan, {
          removeStoragePrefix: async (prefix) => { const [files] = await bucket.getFiles({ prefix }); await Promise.all(files.map((f) => f.delete())); return files.length; },
          rebuild: () => fireDeployHook(process.env.CMS_DEPLOY_HOOK_URL, { envName: 'CMS_DEPLOY_HOOK_URL', what: 'ruling 48: a past deletion\'s voice came down' }),
        });
        console.log(`[backfill] ${ref}: ${p.plan.voices.length} voice(s) down, ${v.images} image(s), rebuild ${v.rebuild}`);
      }
      console.log(`[backfill] ${ref}: applied (${moved} counter(s) moved)`);
    }
    if (!pending.length) console.log('[backfill] 0 changes planned: the backup is empty and nothing was written to the database.');
  }
  process.exit(0);
}
