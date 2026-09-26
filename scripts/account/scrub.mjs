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
// PRIVATE FIELDS. Every run also sweeps users/ for a date of birth (or other private field) an
// old app binary wrote onto the public record, and moves it to users_private/{uid} —
// scripts/account/private-fields.mjs. It runs AFTER the deletions, so a reader deleted this tick
// is already skipped.
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
import { runPrivateSweep } from './private-fields.mjs';
import { randomRef, LOG_REF_RE } from '../ops/redact.mjs';

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

/** A deleted reader's billing record that still says live, or null. Pure. */
export function billingBackstop(uid, membership) {
  const a = membershipAction(membership);
  return a ? { rail: a.rail, ref: a.id || a.code } : null;
}

/**
 * The record's log reference: deletions/{uid}/logRef, a random `del-xxxxxxxx` written the first
 * time a run has to mention the record. W12: THIS RUN'S LOG IS PUBLIC. It never prints a uid, a
 * provider reference or anything else that names the reader — only this tag, which leads
 * nowhere without the database. A report-only run has nothing to write it with, so an
 * untagged record is printed by its position in this run instead.
 */
async function logRefFor(db, uid, rec, { apply, ordinal }) {
  if (LOG_REF_RE.test(rec?.logRef || '')) return rec.logRef;
  if (!apply) return `record #${ordinal} (untagged)`;
  const ref = randomRef();
  await db.ref(`deletions/${uid}/logRef`).set(ref);
  return ref;
}

/** One pass over every deletions/{uid} record. */
export async function runScrub(db, { apply = false, now = Date.now, log = console.log } = {}) {
  const records = (await db.ref('deletions').get()).val() || {};
  const summary = { pending: 0, scrubbed: 0, stubs: 0 };
  let snap = null;
  let ordinal = 0;
  for (const [uid, rec] of Object.entries(records)) {
    ordinal++;
    const steps = rec?.steps || {};
    let ref = null;
    const tag = async () => (ref ||= await logRefFor(db, uid, rec, { apply, ordinal }));
    const userNode = (await db.ref(`users/${uid}`).get()).val();

    // W3 / MON-05 — THE BILLING BACKSTOP. The endpoint cancels every subscription it can find,
    // and the webhook writer cancels any that goes live afterwards. If a deleted reader's
    // billing record still says live, one of those missed, and a deleted reader may be billed:
    // it is written to ops/money_failures (where every other money failure lands) and annotated
    // on the run. This job holds no provider key, so it reports rather than cancels.
    const billing = billingBackstop(uid, (await db.ref(`memberships/${uid}`).get()).val());
    if (billing) {
      summary.billing = (summary.billing || 0) + 1;
      log(`::error::[scrub] ${await tag()}: deleted account still has a LIVE ${billing.rail} subscription — recorded in ops/money_failures`);
      if (apply) {
        const at = now();
        const path = `ops/money_failures/deleted-live-${uid}`;
        const seen = (await db.ref(`${path}/firstAt`).get()).val();
        await db.ref(path).update({
          rail: billing.rail, kind: 'deleted_account_live_subscription', uid, ref: billing.ref, retryable: false,
          summary: `Account ${uid} was deleted but memberships/${uid} still shows a live ${billing.rail} subscription (${billing.ref}). Cancel it at the provider.`,
          lastAt: at, ...(seen ? {} : { firstAt: at, resolved: false }),
        });
      }
    }

    if (steps.scrub) {
      // THE STUB BACKSTOP.
      if (userNode !== null) {
        summary.stubs++;
        log(`[scrub] ${await tag()}: finished deletion has a users node again (${Object.keys(userNode).length} field(s)) — ${apply ? 'removing' : 'would remove'}`);
        if (apply) await db.ref(`users/${uid}`).remove();
      }
      continue;
    }
    if (!steps.auth) { log(`[scrub] ${await tag()}: endpoint has not finished (steps: ${Object.keys(steps).join(',') || 'none'}) — waiting`); continue; }

    summary.pending++;
    snap ||= await readScan(db);
    const plan = planScrub(uid, { ...snap, userNode });
    log(`[scrub] ${await tag()}: ${plan.nulls.length} paths, ${plan.decrements.length} counters — ${JSON.stringify(plan.counts)}`);
    if (!apply) continue;
    const moved = await applyPlan(db, plan);
    const t = now();
    await db.ref(`deletions/${uid}`).update({ 'steps/scrub': t, updatedAt: t, completedAt: t });
    summary.scrubbed++;
    log(`[scrub] ${await tag()}: done (${moved} counters moved)`);
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
    storagePrefixes: STORAGE_PREFIXES('{uid}'),
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
    const p = await runPrivateSweep(db, { apply: args.includes('--apply') });
    console.log(`[private] ${args.includes('--apply') ? 'APPLIED' : 'report only'}: ${JSON.stringify(p)}`);
    // W7: the heartbeat scripts/launch-check.mjs reads. Written only after an applied run has
    // finished both sweeps, so a run that threw before here leaves it stale, and stale is red.
    if (args.includes('--apply')) {
      await db.ref('ops/account_scrub').set({ lastRunAt: Date.now(), scrubbed: s.scrubbed ?? null });
    }
  }
  process.exit(0);
}
