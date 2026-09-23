#!/usr/bin/env node
// VERIFY ONE PURCHASE — read-only. Run after every real purchase and after every refund.
//
//   FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json \
//     node scripts/verify-live-purchase.mjs <uid> <titleId>
//
//   Optional, for a Paystack record:  PAYSTACK_SECRET_KEY=sk_live_… (or sk_test_…)
//     asks Paystack what it knows about the reference: mode, status, amount. A Paystack
//     reference carries no mode marker of its own, so without the key the mode prints as
//     UNPROVEN.
//
// WRITES NOTHING, EVER. Not to the database, not to Stripe, not to Paystack.
//
// What it prints:
//   · the record: status, rail, reference(s), amount, currency, LIVE / TEST / UNPROVEN
//   · bookstore_readership/{titleId}/count, beside the true count recomputed from every
//     purchase record (scripts/readership-source.mjs, the one shared definition)
//   · whether /api/bookstore/stream would issue a ticket now. That is the same test stream.js
//     applies (a record exists and status === 'active', exactly), plus whether the EPUB it
//     would sign actually exists in Storage.
//
// Expected, after a real purchase:  status active · LIVE · ticket YES · count = true count
// Expected, after its refund:       status revoked, revokedReason refunded · ticket NO
//                                   (403 revoked) · the count back down by one
//
// Exit code: 0 if the record is internally consistent and the stored count equals the true
// count, 1 otherwise. So it can be the last line of a checklist step.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readershipFromPurchases } from './readership-source.mjs';

const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const STORAGE_BUCKET = 'calvary-scribblings.firebasestorage.app'; // = functions/api/bookstore/_lib.js
const PAYSTACK_VERIFY_API = 'https://api.paystack.co/transaction/verify';

const fmt = (ms) => (Number.isFinite(ms) ? `${new Date(ms).toISOString()} (${ms})` : '—');

/** Mode of a stored purchase from the record alone. Pure. PaymentIntent ids carry no mode. */
export function modeFromRecord(record) {
  const s = typeof record?.stripeSessionId === 'string' ? record.stripeSessionId : '';
  if (s.startsWith('cs_live_')) return { rail: 'stripe', mode: 'LIVE' };
  if (s.startsWith('cs_test_')) return { rail: 'stripe', mode: 'TEST' };
  if (typeof record?.paystackRef === 'string' && record.paystackRef) return { rail: 'paystack', mode: 'UNPROVEN' };
  return { rail: '—', mode: 'UNPROVEN' };
}

/** Would stream.js issue a ticket? The same two lines it runs, before the Storage step. Pure. */
export function streamVerdict(record) {
  if (!record || typeof record !== 'object') return { ticket: false, code: 'not_purchased' };
  if (record.status !== 'active') return { ticket: false, code: 'revoked', reason: record.revokedReason || null };
  return { ticket: true, code: null };
}

async function main() {
  const [uid, titleId] = process.argv.slice(2);
  if (!uid || !titleId) {
    console.error('usage: node scripts/verify-live-purchase.mjs <uid> <titleId>');
    process.exit(2);
  }
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) { console.error('FIREBASE_SERVICE_ACCOUNT_PATH is required.'); process.exit(2); }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const { getStorage } = await import('firebase-admin/storage');
  const app = initializeApp({
    credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))),
    databaseURL: DATABASE_URL, storageBucket: STORAGE_BUCKET,
  });
  const db = getDatabase(app);

  const record = (await db.ref(`bookstore_purchases/${uid}/${titleId}`).get()).val();
  const all = (await db.ref('bookstore_purchases').get()).val() || {};
  const stored = (await db.ref(`bookstore_readership/${titleId}/count`).get()).val();
  const truth = readershipFromPurchases(all).get(titleId) || 0;

  let consistent = true;
  console.log(`\nbookstore_purchases/${uid}/${titleId}`);
  if (!record) {
    console.log('  (no record)');
  } else {
    const { rail, mode } = modeFromRecord(record);
    let shownMode = mode;
    if (rail === 'paystack' && process.env.PAYSTACK_SECRET_KEY) {
      const res = await fetch(`${PAYSTACK_VERIFY_API}/${encodeURIComponent(record.paystackRef)}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }, signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.status === true && body.data?.reference === record.paystackRef) {
        shownMode = String(body.data.domain || '?').toUpperCase();
        console.log(`  paystack says     domain=${body.data.domain} status=${body.data.status} amount=${body.data.amount} ${body.data.currency} paid_at=${body.data.paid_at || '—'}`);
      } else {
        console.log(`  paystack says     not found with this key (${res.status} ${body?.message || ''}) — mode stays UNPROVEN`);
      }
    }
    console.log(`  status            ${record.status}`);
    console.log(`  rail              ${rail}`);
    console.log(`  mode              ${shownMode}`);
    if (record.stripeSessionId) console.log(`  stripeSessionId   ${record.stripeSessionId}`);
    if (record.stripePaymentIntent) console.log(`  stripePaymentIntent ${record.stripePaymentIntent}   (no mode marker)`);
    if (record.paystackRef) console.log(`  paystackRef       ${record.paystackRef}`);
    console.log(`  amount            ${record.amount} ${record.currency}   (minor units: pence / cents / kobo)`);
    console.log(`  purchasedAt       ${fmt(record.purchasedAt)}`);
    if (record.revokedAt != null || record.revokedReason != null) {
      console.log(`  revokedReason     ${record.revokedReason ?? '—'}`);
      console.log(`  revokedAt         ${fmt(record.revokedAt)}`);
    }
    // The two stamp shapes that mean something is wrong (R9.1): an active record carrying a
    // revocation, and a revoked record with no reason.
    if (record.status === 'active' && record.revokedReason) {
      consistent = false;
      const earlier = Number(record.revokedAt) < Number(record.purchasedAt);
      console.log(`  ⚠ ACTIVE WITH A REVOCATION STAMP — ${earlier
        ? 'revokedAt is EARLIER than purchasedAt: a repurchase inherited its own refund (the pre-R9.1 bug)'
        : 'revokedAt is LATER than purchasedAt: a refund that failed to set status. Investigate.'}`);
    }
    if (record.status === 'revoked' && !record.revokedReason) {
      consistent = false;
      console.log('  ⚠ REVOKED WITH NO REASON');
    }
  }

  const v = streamVerdict(record);
  let ticket = v.ticket ? 'YES' : `NO — stream.js answers 403 ${v.code}${v.reason ? ` (${v.reason})` : ''}`;
  if (v.ticket) {
    const [exists] = await getStorage(app).bucket().file(`bookstore_epubs/${titleId}/master.epub`).exists();
    if (!exists) { ticket = 'NO — entitled, but bookstore_epubs/<titleId>/master.epub is MISSING (stream.js would 5xx)'; consistent = false; }
  }
  console.log(`\nstream ticket       ${ticket}`);

  const countOk = (stored ?? 0) === truth;
  if (!countOk) consistent = false;
  console.log(`readership count    stored ${stored ?? '(absent)'} · true ${truth}   ${countOk ? '✓' : '✗ DRIFT — see scripts/readership.mjs report'}`);
  console.log(consistent ? '\n✓ consistent' : '\n✗ see the lines marked above');
  process.exit(consistent ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
