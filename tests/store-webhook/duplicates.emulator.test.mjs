// RULING 256 — A SECOND PAYMENT NEVER OVERWRITES THE FIRST. Both rails, against the emulator.
//
//   npm run test:store-webhook:emulator
//
// Every case delivers signed, provider-shaped events to the REAL webhooks (harness.mjs) and
// asserts what the database holds afterwards: the copy's record, the duplicates node and the
// public readership count. It reads paths, not the code: the path names are written out here
// rather than imported, so the suite runs unchanged against a build that predates the ruling —
// which is how it was shown red first, on bca482d1.
//
// Nothing refunds anything. A "refund" here is the provider's refund EVENT arriving, as it would
// after Ikenna refunds by hand in the dashboard.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as stripeHook } from '../../functions/api/bookstore/stripe-webhook.js';
import { onRequestPost as paystackHook } from '../../functions/api/bookstore/paystack-webhook.js';
import {
  install, uninstall, wipe, get, set, outbound,
  stripe, paystack, stripeSessionCompleted, stripeChargeRefunded,
  paystackRef, paystackChargeSuccess, paystackRefundProcessed,
} from './harness.mjs';

const UID = 'w256ReaderUid00000000000001';
const TITLE = 'harness-title-256';
const COPY = `bookstore_purchases/${UID}/${TITLE}`;
const DUPS = `bookstore_duplicate_payments/${UID}/${TITLE}`;
const COUNT = `bookstore_readership/${TITLE}/count`;

// Stripe: the first payment (A) and a second (B). Paystack: one reference (P).
const A = { session: 'cs_test_256_first', pi: 'pi_test_256_first' };
const B = { session: 'cs_test_256_second', pi: 'pi_test_256_second' };
const P = paystackRef(UID, TITLE, 'a1b2c3d4e5f6');
const P2 = paystackRef(UID, TITLE, '0f9e8d7c6b5a');
const keyOf = (rail, ref) => `${rail}_${ref.replace(/[.$#[\]/]/g, '_')}`;

const buyStripe = (p, amount = 999) => stripe(stripeHook, stripeSessionCompleted({ uid: UID, titleId: TITLE, ...p, amount }));
const refundStripe = (p, amount = 999) => stripe(stripeHook, stripeChargeRefunded({ uid: UID, titleId: TITLE, pi: p.pi, amount }));
const buyPaystack = (reference) => paystack(paystackHook, paystackChargeSuccess({ reference }));
const refundPaystack = (reference) => paystack(paystackHook, paystackRefundProcessed({ reference }));

const copy = () => get(COPY);
const dups = async () => (await get(DUPS)) || {};
const count = async () => (await get(COUNT)) || 0;
const moneyFailures = async () => Object.keys((await get('ops/money_failures')) || {});

before(install);
after(uninstall);
beforeEach(async () => {
  await wipe();
  await set(`bookstore_titles/${TITLE}`, { slug: TITLE, title: 'The Harness Title', author: 'A. Harness', status: 'published', prices: { gbp: 999, ngn: 750000 } });
});

describe('a normal purchase and a normal refund — unchanged', () => {
  test('Stripe: bought, then refunded — granted, counted, then revoked and uncounted; no duplicates', async () => {
    assert.equal((await buyStripe(A)).status, 200);
    const c = await copy();
    assert.equal(c.status, 'active');
    assert.equal(c.stripeSessionId, A.session);
    assert.equal(c.stripePaymentIntent, A.pi);
    assert.equal(c.amount, 999);
    assert.equal(await count(), 1);
    assert.equal((await refundStripe(A)).status, 200);
    assert.equal((await copy()).status, 'revoked');
    assert.equal(await count(), 0);
    assert.deepEqual(await dups(), {});
    assert.deepEqual(await moneyFailures(), []);
  });

  test('Paystack: bought, then refunded — the same', async () => {
    assert.equal((await buyPaystack(P)).status, 200);
    assert.equal((await copy()).paystackRef, P);
    assert.equal(await count(), 1);
    assert.equal((await refundPaystack(P)).status, 200);
    assert.equal((await copy()).status, 'revoked');
    assert.equal(await count(), 0);
    assert.deepEqual(await dups(), {});
  });

  test('a paid grant over a complimentary copy makes it a sale, as before (W3b) — not a duplicate', async () => {
    await set(COPY, { status: 'active', source: 'comp', compGrant: true, compGrantedAt: 1, purchasedAt: 1 });
    await buyStripe(A);
    const c = await copy();
    assert.equal(c.stripeSessionId, A.session);
    assert.equal(c.source, undefined);
    assert.equal(await count(), 1);
    assert.deepEqual(await dups(), {});
  });

  test('a refund, then a repurchase: a new copy, not a duplicate', async () => {
    await buyStripe(A);
    await refundStripe(A);
    await buyStripe(B);
    const c = await copy();
    assert.equal(c.status, 'active');
    assert.equal(c.stripeSessionId, B.session);
    assert.equal(await count(), 1);
    assert.deepEqual(await dups(), {});
  });
});

describe('256 · a second payment is filed, never written over the first', () => {
  test('same rail (Stripe): the copy keeps the first payment, the second is filed beside it', async () => {
    await buyStripe(A);
    const before = await copy();
    assert.equal((await buyStripe(B, 1099)).status, 200);
    assert.deepEqual(await copy(), before, 'the copy record is exactly as it was');
    assert.equal(await count(), 1, 'a duplicate is not a new copy: the count does not move');
    const d = await dups();
    const e = d[keyOf('stripe', B.session)];
    assert.ok(e, 'the second payment is filed under its own key');
    assert.equal(e.status, 'open');
    assert.equal(e.rail, 'stripe');
    assert.deepEqual(e.refs, { stripeSessionId: B.session, stripePaymentIntent: B.pi });
    assert.equal(e.amount, 1099);
    assert.equal(e.currency, 'GBP');
    assert.equal(e.uid, UID);
    assert.equal(e.titleId, TITLE);
    assert.equal(typeof e.receivedAt, 'number');
    assert.equal(e.title, 'The Harness Title');
    assert.equal(Object.keys(d).length, 1);
  });

  test('same rail (Paystack): the same', async () => {
    await buyPaystack(P);
    const before = await copy();
    await buyPaystack(P2);
    assert.deepEqual(await copy(), before);
    assert.equal(await count(), 1);
    const e = (await dups())[keyOf('paystack', P2)];
    assert.equal(e?.status, 'open');
    assert.deepEqual(e.refs, { paystackRef: P2 });
    assert.equal(e.amount, 750000);
    assert.equal(e.currency, 'NGN');
  });

  test('cross rail (Stripe, then Paystack): amount and currency stay the first payment\'s', async () => {
    await buyStripe(A);
    const before = await copy();
    await buyPaystack(P);
    const c = await copy();
    assert.deepEqual(c, before, 'no paystackRef, no NGN amount on the copy');
    assert.equal(c.currency, 'gbp');
    assert.equal(await count(), 1);
    const e = (await dups())[keyOf('paystack', P)];
    assert.equal(e?.status, 'open');
    assert.equal(e.currency, 'NGN');
  });

  test('cross rail (Paystack, then Stripe): the same, the other way round', async () => {
    await buyPaystack(P);
    const before = await copy();
    await buyStripe(A);
    assert.deepEqual(await copy(), before);
    assert.equal((await dups())[keyOf('stripe', A.session)]?.status, 'open');
  });

  test('a webhook retry of a duplicate files it once — and cannot reopen one already refunded', async () => {
    await buyStripe(A);
    await buyStripe(B);
    await buyStripe(B);
    await buyStripe(B);
    assert.equal(Object.keys(await dups()).length, 1, 'three deliveries, one entry');
    await refundStripe(B);
    await buyStripe(B);   // Stripe retries for 72 hours; one can land after the refund
    const e = (await dups())[keyOf('stripe', B.session)];
    assert.equal(e.status, 'refunded', 'the retry did not reopen it');
    assert.equal(await count(), 1);
  });
});

describe('256 · refunds — the copy goes only when no payment for it stands', () => {
  test('refunding the duplicate: it is marked refunded, and the copy stays', async () => {
    await buyStripe(A);
    await buyStripe(B);
    const before = await copy();
    assert.equal((await refundStripe(B)).status, 200);
    assert.deepEqual(await copy(), before);
    assert.equal(await count(), 1);
    const e = (await dups())[keyOf('stripe', B.session)];
    assert.equal(e.status, 'refunded');
    assert.equal(e.refundReason, 'refunded');
    assert.equal(typeof e.refundedAt, 'number');
    assert.deepEqual(await moneyFailures(), [], 'not a reconciliation failure: the event was matched');
  });

  test('refunding the duplicate (Paystack beside a Stripe copy): the same, across rails', async () => {
    await buyStripe(A);
    await buyPaystack(P);
    await refundPaystack(P);
    assert.equal((await copy()).status, 'active');
    assert.equal((await dups())[keyOf('paystack', P)].status, 'refunded');
  });

  test('refunding the copy\'s payment while a duplicate stands: the copy stays, on the duplicate', async () => {
    await buyStripe(A);
    await buyStripe(B, 1099);
    assert.equal((await refundStripe(A)).status, 200);
    const c = await copy();
    assert.equal(c.status, 'active', 'still in the library');
    assert.equal(c.stripeSessionId, B.session, 'now standing on the second payment');
    assert.equal(c.stripePaymentIntent, B.pi);
    assert.equal(c.amount, 1099);
    assert.equal(await count(), 1);
    const d = await dups();
    assert.equal(d[keyOf('stripe', B.session)].status, 'promoted', 'the duplicate is now the copy\'s payment');
    const orig = d[keyOf('stripe', A.session)];
    assert.equal(orig?.status, 'refunded', 'and the history keeps the first payment, refunded');
    assert.equal(orig.role, 'original');
    assert.deepEqual(orig.refs, { stripeSessionId: A.session, stripePaymentIntent: A.pi });
    assert.equal(orig.amount, 999);
  });

  test('…and across rails: a Stripe copy refunded while a Paystack payment stands moves onto it', async () => {
    await buyStripe(A);
    await buyPaystack(P);
    await refundStripe(A);
    const c = await copy();
    assert.equal(c.status, 'active');
    assert.equal(c.paystackRef, P);
    assert.equal(c.stripeSessionId, undefined, 'the refunded payment is no longer the copy\'s');
    assert.equal(c.currency, 'NGN');
    assert.equal(c.amount, 750000);
    // and a refund of the Paystack payment now revokes it, nothing standing behind it
    await refundPaystack(P);
    assert.equal((await copy()).status, 'revoked');
    assert.equal(await count(), 0);
  });

  test('refunding both, duplicate first: the copy is revoked with the second refund', async () => {
    await buyStripe(A);
    await buyStripe(B);
    await refundStripe(B);
    assert.equal((await copy()).status, 'active');
    await refundStripe(A);
    assert.equal((await copy()).status, 'revoked');
    assert.equal(await count(), 0);
  });

  test('refunding both, copy first: the copy is revoked with the second refund, and the history is whole', async () => {
    await buyStripe(A);
    await buyStripe(B);
    await refundStripe(A);
    assert.equal((await copy()).status, 'active');
    await refundStripe(B);
    assert.equal((await copy()).status, 'revoked');
    assert.equal(await count(), 0);
    const d = await dups();
    assert.equal(d[keyOf('stripe', A.session)].status, 'refunded');
    assert.equal(d[keyOf('stripe', B.session)].status, 'refunded', 'the promoted entry is closed with its refund');
    assert.deepEqual(await moneyFailures(), []);
  });

  test('a replayed refund of the first payment, after the copy moved, changes nothing', async () => {
    await buyStripe(A);
    await buyStripe(B);
    await refundStripe(A);
    const c = await copy();
    const d = await dups();
    await refundStripe(A);
    assert.deepEqual(await copy(), c);
    assert.deepEqual(await dups(), d);
    assert.deepEqual(await moneyFailures(), [], 'matched to the history, so not flagged for review');
  });

  test('nothing in any of this reached outside the machine', () => {
    assert.deepEqual(outbound, []);
  });
});
