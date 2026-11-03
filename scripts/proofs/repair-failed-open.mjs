// PROOFS-R3.1 — undo the failed "Open Proofs to writers" of 2 Nov 2026, 21:58:29 UTC.
//
//   node scripts/proofs/repair-failed-open.mjs            # dry run: says what it would delete, counts only
//   node scripts/proofs/repair-failed-open.mjs --apply    # backs up, verifies, deletes, re-reads
//
// That Open died on its 51st subrequest (Cloudflare's per-request limit). Before it died it had
// claimed 4 writers' openings and recorded 17 of their stories as told, and it had sent NOTHING:
// it only sends after opening the switch, and the switch was never written. Left in place, those
// 4 writers read as "already emailed" and would never get their opening email (once only).
//
// This deletes EXACTLY those 21 records, so the state is "never opened" and Ikenna's next Open
// (on the R3.1 build) emails every ticked writer once. It REFUSES, and writes nothing, if:
//   · Proofs is open (the tick could act on a half-repaired ledger);
//   · the count of openings or story entries is not exactly what is expected (4 and 17);
//   · any opening or story entry shows a send (sent true, sentAt, emailId), a failure reason
//     (why), a status, or a timestamp outside the failed run's one second, or carries anything an
//     Open of that build did not write;
//   · the 21 timestamps are not all the same instant (one call writes one `now`);
//   · anything is queued.
// The delete is one atomic multi-path update through the SAFETY-1 guard: dry by default; on
// --apply, a fresh verified backup of exactly the 21 paths first. Then it re-reads every one.
//
// Counts only on the console (W12): never a uid, a slug, a name or a value.
import { pathToFileURL } from 'node:url';
import { openGuard, readOnlyDb, endpoints, DB_URL } from '../safety/guard.mjs';
import { readServiceAccountFile, readSaKeySecret } from '../security/service-account.mjs';
import { isId } from '../../app/lib/ids.js';

export const FAILED_SECOND = '2026-11-02T21:58:29Z';
export const EXPECT = { openings: 4, stories: 17 };
const OPENING_KEYS = ['at', 'by', 'stories', 'sent'];
const STORY_KEYS = ['goLiveMs', 'toldAt', 'kind', 'seq', 'via', 'remindedFor', 'log'];

/** Pure. → { paths: [...], refusals: [...] }. `mail` is the proofs_mail node, `access` proofs_access. */
export function planRepair(mail, access, { second = FAILED_SECOND, expect = EXPECT } = {}) {
  const refusals = [];
  const lo = Date.parse(second), hi = lo + 1000;
  const inSecond = (t) => Number.isFinite(t) && t >= lo && t < hi;
  const stamps = new Set();
  const paths = [];
  if (access?.open === true) refusals.push('Proofs is open: close it first');
  if (mail?.queue && Object.keys(mail.queue).length) refusals.push('the opening queue is not empty');
  let openings = 0, stories = 0;
  for (const [uid, w] of Object.entries(mail?.writers || {})) {
    if (!isId('uid', uid)) { refusals.push('a writer key is not a uid'); continue; }
    if (w?.excluded) refusals.push('a writer is marked excluded (the failed run marked none)');
    const o = w?.opening;
    if (o) {
      openings++;
      const extra = Object.keys(o).filter((k) => !OPENING_KEYS.includes(k));
      if (extra.length) refusals.push(`an opening carries ${extra.sort().join(', ')}`);
      if (o.sent !== false) refusals.push('an opening is not sent:false');
      if (!inSecond(o.at)) refusals.push('an opening has a different timestamp');
      stamps.add(o.at);
      paths.push(`proofs_mail/writers/${uid}/opening`);
    }
    for (const [slug, r] of Object.entries(w?.stories || {})) {
      stories++;
      if (!o) refusals.push('a story entry belongs to a writer with no opening');
      const extra = Object.keys(r || {}).filter((k) => !STORY_KEYS.includes(k));
      if (extra.length) refusals.push(`a story entry carries ${extra.sort().join(', ')}`);
      if (r?.kind !== 'opening' || r?.via !== 'opening' || r?.seq !== 1) refusals.push('a story entry is not an opening seed');
      if (!inSecond(r?.toldAt)) refusals.push('a story entry has a different timestamp');
      stamps.add(r?.toldAt);
      const log = Object.entries(r?.log || {});
      if (log.length !== 1 || log[0][0] !== 'e1' || log[0][1]?.kind !== 'opening' || log[0][1]?.via !== 'opening'
        || 'sent' in (log[0][1] || {}) || 'why' in (log[0][1] || {}) || log[0][1]?.at !== r?.toldAt) {
        refusals.push('a story entry’s log is not a single unsent opening seed');
      }
      paths.push(`proofs_mail/writers/${uid}/stories/${slug}`);
    }
  }
  if (stamps.size > 1) refusals.push('the records do not share one timestamp');
  if (openings !== expect.openings) refusals.push(`expected ${expect.openings} openings, found ${openings}`);
  if (stories !== expect.stories) refusals.push(`expected ${expect.stories} story entries, found ${stories}`);
  return { paths, refusals: [...new Set(refusals)], openings, stories };
}

/** A READ-ONLY database handle (any write throws), and its app, to close when done. */
async function adminDb(env) {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const ep = endpoints(env);
  const name = `repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let app;
  if (ep.emulator) {
    const ns = env.GUARD_DB_NAMESPACE || env.GCLOUD_PROJECT || 'demo-safety';
    app = initializeApp({ projectId: ns, databaseURL: `${ep.db}?ns=${ns}` }, name);
  } else {
    const sa = env.PROOFS_SERVICE_ACCOUNT ? readServiceAccountFile(env.PROOFS_SERVICE_ACCOUNT)
      : env.FIREBASE_SA_KEY ? readSaKeySecret(env.FIREBASE_SA_KEY) : readServiceAccountFile('serviceAccountKey.json');
    app = initializeApp({ credential: cert(sa), databaseURL: DB_URL }, name);
  }
  return { db: readOnlyDb(getDatabase(app)), close: () => app.delete() };
}

/** The script. Returns { ok, applied, ... } and prints counts only. */
export async function runRepair({ argv = process.argv, env = process.env, log = (s) => console.log(s) } = {}) {
  const { db, close } = await adminDb(env);
  try { return await repair(db, { argv, env, log }); } finally { await close(); }
}

async function repair(db, { argv, env, log }) {
  const [mail, access] = await Promise.all([db.ref('proofs_mail').get(), db.ref('proofs_access').get()]).then((s) => s.map((x) => x.val()));
  const plan = planRepair(mail, access);
  log(`[repair] found: openings=${plan.openings} storyEntries=${plan.stories} → ${plan.paths.length} paths to delete`);
  if (plan.refusals.length) {
    for (const r of plan.refusals) log(`[repair] REFUSED: ${r}`);
    log('[repair] nothing was written.');
    return { ok: false, refusals: plan.refusals };
  }
  const guard = await openGuard('repair-failed-open', { argv, env, log });
  await guard.update(Object.fromEntries(plan.paths.map((p) => [p, null])));
  if (!guard.apply) { log('[repair] dry run: nothing was written. Re-run with --apply.'); return { ok: true, applied: false, paths: plan.paths.length }; }
  // VERIFY: every one of the 21 is gone, and nothing else under proofs_mail changed.
  const after = (await db.ref('proofs_mail').get()).val();
  const still = plan.paths.filter((p) => p.split('/').slice(1).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), after) != null);
  const before = JSON.parse(JSON.stringify(mail || {}));
  for (const p of plan.paths) { const ks = p.split('/').slice(1); const last = ks.pop(); const parent = ks.reduce((o, k) => o?.[k], before); if (parent) delete parent[last]; }
  const prune = (o) => { if (!o || typeof o !== 'object') return o; for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (o[k] == null || (typeof o[k] === 'object' && !Object.keys(o[k]).length)) delete o[k]; } return o; };
  const same = JSON.stringify(prune(before)) === JSON.stringify(prune(after || {}));
  log(`[repair] verify: ${plan.paths.length - still.length}/${plan.paths.length} deleted, rest of proofs_mail ${same ? 'unchanged' : 'CHANGED'}`);
  return { ok: !still.length && same, applied: true, paths: plan.paths.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const r = await runRepair();
  process.exit(r.ok ? 0 : 1);
}
