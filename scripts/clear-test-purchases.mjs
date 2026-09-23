#!/usr/bin/env node
// CLEAR THE TEST-MODE PURCHASES — before live money, on Ikenna's word, and not before.
//
//   FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json node scripts/clear-test-purchases.mjs
//       DRY RUN (the default). Reads, classifies, writes the backup file, prints the plan.
//       Changes nothing in the database.
//
//   … PAYSTACK_TEST_SECRET_KEY=sk_test_… node scripts/clear-test-purchases.mjs
//       The same, and each Paystack reference is asked of Paystack IN TEST MODE. A Paystack
//       record is removable only if Paystack's test mode knows it (see "PROOF" below).
//
//   … node scripts/clear-test-purchases.mjs --apply --confirm=<N>
//       Deletes. <N> must equal the number of records the plan removes. The count is typed,
//       not a yes: a plan that grew since you read it refuses instead of running.
//
// ── PROOF: WHAT "DEMONSTRABLY TEST-MODE" MEANS, PER RAIL ─────────────────────────────────
//
//   STRIPE   stripeSessionId starts `cs_test_`. Stripe writes the mode INTO the Checkout
//            Session id (cs_test_… / cs_live_…); the prefix is Stripe's own statement.
//
//            ⚠ NOT the PaymentIntent. The pre-launch note carried forward from R9.1 said
//            "stripePaymentIntent starts pi_test". The census on 23 Sep 2026 found every
//            stored PaymentIntent is `pi_3U…`: PaymentIntent ids carry NO mode marker. So a
//            `pi_` value is never evidence of anything here, in either direction.
//
//   PAYSTACK A Paystack reference is OURS (cs.<uid>.<titleId>.<nonce>) and has no mode marker
//            at all. It is removable only when PAYSTACK_TEST_SECRET_KEY (sk_test_…) is given
//            AND GET /transaction/verify/<ref> with that key returns the transaction with
//            domain 'test'. A test key cannot see a live transaction, so "the test mode
//            has it" is proof. Without the key, every Paystack record is REFUSED, not
//            assumed.
//
//   ANYTHING ELSE (a cs_live_ session, no reference, an unrecognised shape, a record with
//   one proven and one unproven reference) is REFUSED and printed as refused. There is no
//   flag that overrides a refusal. A record this script refuses is a human's decision.
//
// ⚠ Why not "delete the node" or "delete what lacks stripePaymentIntent": today every record
// is test-mode, so deleting bookstore_purchases would do the same thing. The day the first
// real purchase lands, it would also take a paying reader's book, and the diff would look
// like a tidy-up. This script selects by PROOF OF MODE, one record at a time, so it stays
// correct after live money arrives.
//
// ── THE BACKUP COMES FIRST ───────────────────────────────────────────────────────────────
//
// Every run, dry or not, writes backups/clear-test-purchases/<timestamp>.json BEFORE anything
// else: every record it would remove (whole, as read), the proof for each, every refused
// record and why, and bookstore_readership as it stood. In --apply the write happens only
// after that file is on disk and re-read. RTDB daily backups exist too
// (scripts/backup/RESTORE.md), but a restore from a daily archive also rewinds every other
// node, and this file does not.
//
// ── READERSHIP ───────────────────────────────────────────────────────────────────────────
//
// bookstore_readership/{titleId}/count is public. The removals and the readership correction
// go in ONE atomic multi-path update. For every title a removed record belonged to, the count
// is recomputed from the records that REMAIN, with the one shared definition
// (scripts/readership-source.mjs), and written as {count} or deleted when zero (absent is
// absent). Titles no removed record touched are not written. Decrementing by the removed
// records would be wrong here: the census found basil, the-fire-in-the-flint and the-rescue
// stored as ABSENT with 2 active records each, because they were bought before the counter
// shipped and the backfill never ran. A decrement would drive them negative.
//
// ── APPLY IS RE-CHECKED ──────────────────────────────────────────────────────────────────
//
// Between the plan and the write, each record is re-read. If it changed (a webhook landed, a
// refund arrived), the whole run stops without writing. After the write, every removed path
// and every readership count is read back and compared to the plan.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readershipFromPurchases } from './readership-source.mjs';

const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const PURCHASES_PATH = 'bookstore_purchases';
const READERSHIP_PATH = 'bookstore_readership';
const PAYSTACK_VERIFY_API = 'https://api.paystack.co/transaction/verify';
const BACKUP_DIR = join('backups', 'clear-test-purchases');

/**
 * Is this record DEMONSTRABLY a test-mode purchase? Pure: the Paystack answer is passed in.
 *
 * @param record            the stored purchase
 * @param paystackVerdicts  Map<reference, 'test' | 'live' | 'unknown'> from Paystack's test mode
 * @returns { removable: boolean, proof: string[], refusal: string|null }
 */
export function classifyRecord(record, paystackVerdicts = new Map()) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { removable: false, proof: [], refusal: 'not a purchase record' };
  }
  const proof = [];
  const session = typeof record.stripeSessionId === 'string' ? record.stripeSessionId : null;
  const ref = typeof record.paystackRef === 'string' ? record.paystackRef : null;

  if (!session && !ref) {
    return { removable: false, proof, refusal: 'no stripeSessionId and no paystackRef — mode cannot be proven' };
  }
  if (session) {
    if (session.startsWith('cs_live_')) return { removable: false, proof, refusal: `LIVE Stripe session ${session}` };
    if (!session.startsWith('cs_test_')) return { removable: false, proof, refusal: `unrecognised Stripe session id ${session}` };
    proof.push(`stripe session ${session} (cs_test_ prefix)`);
  }
  if (ref) {
    const verdict = paystackVerdicts.get(ref) || 'unknown';
    if (verdict === 'live') return { removable: false, proof, refusal: `Paystack reports ${ref} as LIVE` };
    if (verdict !== 'test') {
      return {
        removable: false, proof,
        refusal: `Paystack ref ${ref} is unproven — run with PAYSTACK_TEST_SECRET_KEY=sk_test_… so Paystack's test mode can confirm it`,
      };
    }
    proof.push(`paystack ${ref} (found by Paystack TEST mode, domain 'test')`);
  }
  return { removable: true, proof, refusal: null };
}

/**
 * The atomic update: every removal plus the readership of every title a removal touched,
 * recomputed from what remains. Pure.
 */
export function buildPlan(purchases, removals) {
  const remaining = structuredClone(purchases || {});
  const touched = new Set();
  const update = {};
  for (const { uid, titleId } of removals) {
    update[`${PURCHASES_PATH}/${uid}/${titleId}`] = null;
    touched.add(titleId);
    if (remaining[uid]) {
      delete remaining[uid][titleId];
      if (Object.keys(remaining[uid]).length === 0) delete remaining[uid];
    }
  }
  const after = readershipFromPurchases(remaining);
  const readershipAfter = {};
  for (const titleId of [...touched].sort()) {
    const n = after.get(titleId) || 0;
    update[`${READERSHIP_PATH}/${titleId}`] = n > 0 ? { count: n } : null;
    readershipAfter[titleId] = n;
  }
  return { update, readershipAfter };
}

// ──────────────────────────────────────────────────────────────────────────

async function db(saPath) {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const app = initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))), databaseURL: DATABASE_URL });
  return getDatabase(app);
}

async function paystackTestVerdict(key, reference) {
  const res = await fetch(`${PAYSTACK_VERIFY_API}/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => null);
  if (res.ok && body?.status === true && body?.data?.reference === reference) {
    return body.data.domain === 'test' ? 'test' : (body.data.domain === 'live' ? 'live' : 'unknown');
  }
  return 'unknown'; // not found by the test key, or an error: unproven, never assumed
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmArg = args.find((a) => a.startsWith('--confirm='));
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH is required — bookstore_purchases is founder-read-only.');
    process.exit(2);
  }
  const psKey = process.env.PAYSTACK_TEST_SECRET_KEY || '';
  if (psKey && !psKey.startsWith('sk_test_')) {
    console.error('PAYSTACK_TEST_SECRET_KEY must be a TEST key (sk_test_…). A live key proves nothing about test mode.');
    process.exit(2);
  }

  const database = await db(saPath);
  const purchases = (await database.ref(PURCHASES_PATH).get()).val() || {};
  const readershipBefore = (await database.ref(READERSHIP_PATH).get()).val();

  const all = [];
  for (const [uid, byTitle] of Object.entries(purchases)) {
    for (const [titleId, record] of Object.entries(byTitle || {})) all.push({ uid, titleId, record });
  }

  const verdicts = new Map();
  for (const { record } of all) {
    const ref = typeof record?.paystackRef === 'string' ? record.paystackRef : null;
    if (!ref || verdicts.has(ref)) continue;
    verdicts.set(ref, psKey ? await paystackTestVerdict(psKey, ref) : 'unknown');
  }

  const removals = [];
  const refused = [];
  for (const row of all) {
    const c = classifyRecord(row.record, verdicts);
    (c.removable ? removals : refused).push({ ...row, ...c });
  }
  const { update, readershipAfter } = buildPlan(purchases, removals);

  // THE BACKUP, before anything else.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(BACKUP_DIR, `${stamp}${apply ? '-apply' : '-dry-run'}.json`);
  const backup = {
    takenAt: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run', database: DATABASE_URL,
    removals: removals.map(({ uid, titleId, record, proof }) => ({ path: `${PURCHASES_PATH}/${uid}/${titleId}`, record, proof })),
    refused: refused.map(({ uid, titleId, record, refusal }) => ({ path: `${PURCHASES_PATH}/${uid}/${titleId}`, record, refusal })),
    readershipBefore, readershipAfter, update,
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  if (!isDeepStrictEqual(JSON.parse(readFileSync(backupPath, 'utf8')), JSON.parse(JSON.stringify(backup)))) {
    console.error(`backup at ${backupPath} did not read back identically — stopping, nothing written.`);
    process.exit(1);
  }

  const d = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—');
  console.log(`\n${all.length} purchase record(s). Backup: ${backupPath}\n`);
  console.log(`WOULD REMOVE (${removals.length}):`);
  for (const r of removals) {
    const x = r.record;
    console.log(`  ${r.uid}/${r.titleId}  status=${x.status}  ${x.amount} ${x.currency}  bought ${d(x.purchasedAt)}` +
      `${x.revokedReason ? `  revokedReason=${x.revokedReason} revokedAt ${d(x.revokedAt)}` : ''}`);
    for (const p of r.proof) console.log(`      proof: ${p}`);
  }
  console.log(`\nREFUSED (${refused.length}) — left exactly as they are:`);
  for (const r of refused) console.log(`  ${r.uid}/${r.titleId}  — ${r.refusal}`);
  if (refused.length === 0) console.log('  (none)');
  console.log('\nREADERSHIP (titles a removal touches; recomputed from what remains):');
  for (const [t, n] of Object.entries(readershipAfter)) {
    const before = readershipBefore?.[t]?.count;
    console.log(`  ${t.padEnd(26)} ${String(before ?? '(absent)').padStart(8)} → ${n === 0 ? '(absent)' : n}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing was written. To apply: --apply --confirm=${removals.length}`);
    process.exit(0);
  }

  if (removals.length === 0) { console.log('\nNothing to remove.'); process.exit(0); }
  if (confirmArg !== `--confirm=${removals.length}`) {
    console.error(`\n--apply needs --confirm=${removals.length} (the number this plan removes). Nothing written.`);
    process.exit(1);
  }

  // Re-read every record the plan removes. Any change stops the whole run.
  for (const r of removals) {
    const now = (await database.ref(`${PURCHASES_PATH}/${r.uid}/${r.titleId}`).get()).val();
    if (!isDeepStrictEqual(now, r.record)) {
      console.error(`\n${r.uid}/${r.titleId} CHANGED since the plan was read — stopping, nothing written. Re-run the dry run.`);
      process.exit(1);
    }
  }

  await database.ref().update(update); // one atomic multi-path write

  let ok = true;
  for (const r of removals) {
    const gone = (await database.ref(`${PURCHASES_PATH}/${r.uid}/${r.titleId}`).get()).val() === null;
    if (!gone) { ok = false; console.error(`  ✗ ${r.uid}/${r.titleId} is still present`); }
  }
  for (const [t, n] of Object.entries(readershipAfter)) {
    const c = (await database.ref(`${READERSHIP_PATH}/${t}/count`).get()).val();
    if ((c ?? 0) !== n) { ok = false; console.error(`  ✗ readership ${t} is ${c}, planned ${n}`); }
  }
  for (const r of refused) {
    const still = (await database.ref(`${PURCHASES_PATH}/${r.uid}/${r.titleId}`).get()).val();
    if (!isDeepStrictEqual(still, r.record)) { ok = false; console.error(`  ✗ REFUSED record ${r.uid}/${r.titleId} changed`); }
  }
  console.log(ok
    ? `\n✓ removed ${removals.length}, readership as planned, ${refused.length} refused record(s) untouched. Backup: ${backupPath}`
    : `\n✗ read-back disagreed with the plan. Backup: ${backupPath}`);
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
