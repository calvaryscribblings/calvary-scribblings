#!/usr/bin/env node
// READERSHIP — the backfill and the reconciler, one script, two verbs.
//
//   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json node scripts/readership.mjs report
//   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json node scripts/readership.mjs backfill [--apply]
//
//   report    Recompute from bookstore_purchases and print every title with the stored
//             number beside the true one. WRITES NOTHING, EVER, including when it finds
//             drift. Exits 1 if anything disagrees, so it can be run on a schedule and
//             noticed. This is the reconciliation the brief asked for.
//
//   backfill  The one-time write at ship time. Computes the same numbers and replaces the
//             whole bookstore_readership node. Run `report` first, then `backfill` (a dry run).
//
// SAFETY-1: backfill is DRY BY DEFAULT and writes only with --apply (it used to write by default,
// with an opt-in --dry-run; --dry-run is still accepted, means the default, and wins over --apply).
// The write goes through scripts/safety/guard.mjs, which backs up the whole node and verifies the
// backup before replacing it. It prints COUNTS ONLY.
//
// ⚠ THEY SHARE ONE DEFINITION OF THE TRUTH — readershipFromPurchases() in
// scripts/readership-source.mjs, which is also what tests/bookstore/readership.test.mjs
// asserts over a synthetic set. A backfill and a reconciler with separate arithmetic would
// mean the reconciler certifying the backfill's bug.
//
// ⚠ AND THE RECONCILER NEVER PATCHES. A discrepancy means the counter's atomicity broke or
// something wrote the node that should not have — see the note on reconcile(). Repair is a
// human, with the number this printed.
//
// Auth: service-account JSON at FIREBASE_SERVICE_ACCOUNT_PATH, handed to the guard, which mints
// the token and does every read and the one write by REST; no firebase-admin dependency.
// bookstore_purchases is founder-read-only, so this credential is not optional — there is no
// anonymous way to compute this and there must not be.

import { readershipFromPurchases, reconcile } from './readership-source.mjs';
import { openGuard } from './safety/guard.mjs';

const PURCHASES_PATH = 'bookstore_purchases';
const READERSHIP_PATH = 'bookstore_readership';

function printTable(rows) {
  if (rows.length === 0) {
    console.log('  (no titles on either side — nothing has been bought, and nothing is stored)');
    return;
  }
  const w = Math.max(7, ...rows.map((r) => r.titleId.length));
  console.log(`  ${'title'.padEnd(w)}  ${'stored'.padStart(6)}  ${'true'.padStart(6)}   status`);
  console.log(`  ${'-'.repeat(w)}  ------  ------   ------`);
  for (const r of rows) {
    const have = r.have === null ? '—' : String(r.have);
    console.log(`  ${r.titleId.padEnd(w)}  ${have.padStart(6)}  ${String(r.want).padStart(6)}   ${r.ok ? 'ok' : 'DRIFT'}`);
  }
}

async function main() {
  const verb = process.argv[2];
  if (verb !== 'report' && verb !== 'backfill') {
    console.error('usage: node scripts/readership.mjs report | backfill [--apply]');
    process.exit(2);
  }
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH env var is required — bookstore_purchases is founder-read-only.');
    process.exit(2);
  }

  // `report` never writes: its guard is dry whatever the command line says.
  const guard = await openGuard('readership', {
    apply: verb === 'backfill' && process.argv.includes('--apply') && !process.argv.includes('--dry-run'),
    env: { ...process.env, GUARD_SERVICE_ACCOUNT: saPath },
  });

  console.log(`[readership] reading ${PURCHASES_PATH}/ …`);
  const purchases = await guard.get(PURCHASES_PATH);
  const readers = purchases ? Object.keys(purchases).length : 0;
  const records = purchases
    ? Object.values(purchases).reduce((n, t) => n + Object.keys(t || {}).length, 0)
    : 0;
  console.log(`[readership] ${records} purchase record(s) across ${readers} reader(s)`);

  const computed = readershipFromPurchases(purchases);
  console.log(`[readership] reading ${READERSHIP_PATH}/ …`);
  const stored = await guard.get(READERSHIP_PATH);

  const { rows, drift } = reconcile(computed, stored || {});
  console.log('');
  printTable(rows);
  console.log('');

  if (verb === 'report') {
    if (drift.length === 0) {
      console.log('[readership] ✓ stored counts agree with the purchase records.');
      return;
    }
    console.error(`[readership] ✗ ${drift.length} title(s) DRIFT. Nothing was written — this command never writes.`);
    for (const d of drift) {
      console.error(`  ${d.titleId}: stored ${d.have === null ? '(absent)' : d.have}, should be ${d.want}`);
    }
    console.error('[readership] The counter rides the purchase write atomically, so drift means either that');
    console.error('[readership] atomicity broke or something else wrote the node. Investigate before repairing.');
    process.exitCode = 1;
    return;
  }

  // backfill
  const payload = {};
  for (const [titleId, count] of [...computed.entries()].sort()) payload[titleId] = { count };

  // Counts only (SAFETY-1): the table above is the per-title view; the payload is not printed.
  const total = Object.values(payload).reduce((n, v) => n + v.count, 0);
  console.log(`[readership] backfill payload — ${Object.keys(payload).length} title(s) with at least one active record, ${total} reader-title(s) in all.`);
  // Titles with nobody are ABSENT from the payload, not written as 0. Absent is absent.
  console.log('[readership] titles with no active purchase are deliberately NOT written — absent is absent.');

  // The whole node, not a merge: the backfill establishes it from source, so a stale key left by
  // an earlier partial run must not survive. The guard backs up the whole node and verifies the
  // backup first. It is a one-time operation and `report` is what to run afterwards.
  const res = await guard.update({ [READERSHIP_PATH]: payload }, { label: 'backfill' });
  if (!res.applied) {
    console.log('[readership] dry run (the default): nothing written. Re-run with --apply to write.');
    return;
  }
  guard.summary();
  console.log('[readership] written. Run `report` to confirm.');
}

main().catch((err) => {
  console.error('[readership] FAILED:', err.message);
  process.exit(1);
});
