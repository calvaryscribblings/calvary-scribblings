#!/usr/bin/env node
// THE ACCOUNT SCRUB RUNNER — finishes every account deletion the endpoint has started.
//
//   node scripts/account/scrub.mjs              report only: what each pending deletion would remove
//   node scripts/account/scrub.mjs --apply      remove it, and mark deletions/{uid}/steps/scrub
//   node scripts/account/scrub.mjs --preview <uid>
//        a LIVE account, not deleted: everything the endpoint AND the scrub would remove, as
//        counts. Read-only, always. This is how a deletion is reported before anyone says go.
//
// Runs on .github/workflows/account-scrub.yml, every 15 minutes. The plan is scripts/account/
// scrub-plan.mjs (pure); the endpoint half is functions/api/account/_deletion.js.
//
// WHICH RECORDS. A deletion is scrubbed once its Auth step is recorded — never before, so a
// deletion that failed midway and may yet be abandoned is never half-scrubbed from here. Every
// run also re-checks EVERY record, finished or not, for a users/{uid} node: a membership webhook
// that could not read deletions/{uid} fails open and may write one (_membership.js). That is the
// stub backstop, and it is why a deleted uid never keeps a profile for longer than one tick.
//
// ORDER. Nulls first, then counters. If a run dies between the two, the next run no longer finds
// the reactions it removed and so does not take their counters down: a counter can end up one
// too HIGH, never one too low, and never below zero.

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planScrub, SCAN_NODES } from './scrub-plan.mjs';
import { planOwned, handlesOf, OWNED_NODES, STORAGE_PREFIXES, membershipAction } from '../../functions/api/account/_deletion.js';

const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const CHUNK = 400;

export async function readScan(db) {
  const snap = {};
  await Promise.all(SCAN_NODES.map(async (n) => { snap[n] = (await db.ref(n).get()).val(); }));
  return snap;
}

/** Apply one plan. Returns the counters actually taken down. */
export async function applyPlan(db, plan) {
  for (let i = 0; i < plan.nulls.length; i += CHUNK) {
    const u = {};
    for (const p of plan.nulls.slice(i, i + CHUNK)) u[p] = null;
    await db.ref().update(u);
  }
  let moved = 0;
  for (const p of plan.decrements) {
    const res = await db.ref(p).transaction((c) => {
      // A missing counter stays missing: returning 0 here would CREATE it. NOT `return undefined`
      // — the first pass of an admin transaction runs against the empty local cache, sees null
      // even when the server holds a number, and undefined would abort it there. Returning the
      // null unchanged lets the server's compare fail and the handler run again with the value.
      if (typeof c !== 'number') return c;
      return Math.max(0, c - 1);
    });
    if (res.committed && typeof res.snapshot.val() === 'number') moved++;
  }
  return moved;
}

/** One pass over every deletions/{uid} record. */
export async function runScrub(db, { apply = false, now = Date.now, log = console.log } = {}) {
  const records = (await db.ref('deletions').get()).val() || {};
  const summary = { pending: 0, scrubbed: 0, stubs: 0 };
  let snap = null;
  for (const [uid, rec] of Object.entries(records)) {
    const steps = rec?.steps || {};
    const userNode = (await db.ref(`users/${uid}`).get()).val();

    if (steps.scrub) {
      // THE STUB BACKSTOP.
      if (userNode !== null) {
        summary.stubs++;
        log(`[scrub] ${uid}: finished deletion has a users node again (${Object.keys(userNode).join(',')}) — ${apply ? 'removing' : 'would remove'}`);
        if (apply) await db.ref(`users/${uid}`).remove();
      }
      continue;
    }
    if (!steps.auth) { log(`[scrub] ${uid}: endpoint has not finished (steps: ${Object.keys(steps).join(',') || 'none'}) — waiting`); continue; }

    summary.pending++;
    snap ||= await readScan(db);
    const plan = planScrub(uid, { ...snap, userNode });
    log(`[scrub] ${uid}: ${plan.nulls.length} paths, ${plan.decrements.length} counters — ${JSON.stringify(plan.counts)}`);
    if (!apply) continue;
    const moved = await applyPlan(db, plan);
    const t = now();
    await db.ref(`deletions/${uid}`).update({ 'steps/scrub': t, updatedAt: t, completedAt: t });
    summary.scrubbed++;
    log(`[scrub] ${uid}: done (${moved} counters moved)`);
    snap = null; // the next record plans against a fresh read
  }
  return summary;
}

/** Everything a deletion of this LIVE uid would remove. Read-only. */
export async function preview(db, uid, email) {
  const get = async (p) => (await db.ref(p).get()).val();
  const user = await get(`users/${uid}`);
  const handles = {};
  for (const h of handlesOf(user)) handles[h] = await get(`usernames/${h}`);
  const owned = planOwned(uid, {
    user, following: await get(`following/${uid}`), followers: await get(`followers/${uid}`),
    handles, subscribers: email ? await get('subscribers') : null, waitlist: email ? await get('bookstore_waitlist') : null,
  }, email);
  const ownedPresent = {};
  for (const p of Object.keys(owned)) {
    const v = await get(p);
    if (v !== null) ownedPresent[p.replace(uid, '{uid}')] = typeof v === 'object' ? Object.keys(v).length : 1;
  }
  const scrub = planScrub(uid, { ...(await readScan(db)), userNode: null });
  const membership = await get(`memberships/${uid}`);
  return {
    owned: ownedPresent,
    scrub: scrub.counts,
    scrubPaths: scrub.nulls.length,
    counters: scrub.decrements.length,
    membershipToCancel: membershipAction(membership),
    kept: {
      memberships: membership !== null,
      bookstore_purchases: (await get(`bookstore_purchases/${uid}`)) !== null,
      purchases: (await get(`purchases/${uid}`)) !== null,
    },
    storagePrefixes: STORAGE_PREFIXES(uid),
    ownedNodes: OWNED_NODES.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const keyPath = process.env.SCRUB_SERVICE_ACCOUNT || 'serviceAccountKey.json';
  let credential;
  try { credential = cert(JSON.parse(readFileSync(keyPath, 'utf8'))); } catch { credential = applicationDefault(); }
  initializeApp({ credential, databaseURL: process.env.SCRUB_DATABASE_URL || DB_URL });
  const db = getDatabase();
  const i = args.indexOf('--preview');
  if (i >= 0) {
    const uid = args[i + 1];
    if (!uid) { console.error('--preview needs a uid'); process.exit(2); }
    const { getAuth } = await import('firebase-admin/auth');
    const email = await getAuth().getUser(uid).then((u) => u.email || null).catch(() => null);
    console.log(JSON.stringify(await preview(db, uid, email), null, 2));
  } else {
    const s = await runScrub(db, { apply: args.includes('--apply') });
    console.log(`[scrub] ${args.includes('--apply') ? 'APPLIED' : 'report only'}: ${JSON.stringify(s)}`);
  }
  process.exit(0);
}
