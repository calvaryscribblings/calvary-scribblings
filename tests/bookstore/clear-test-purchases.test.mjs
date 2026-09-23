// scripts/clear-test-purchases.mjs — the predicate that decides which money records may be
// deleted before launch. It must refuse everything it cannot PROVE is test-mode.
//
//   node --test tests/bookstore/clear-test-purchases.test.mjs     (npm run test:purchases)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecord, buildPlan } from '../../scripts/clear-test-purchases.mjs';

const REF = 'cs.UID1.basil.9e1047b7f642';

describe('classifyRecord — proof of mode, never shape', () => {
  test('a cs_test_ session is removable', () => {
    assert.equal(classifyRecord({ status: 'active', stripeSessionId: 'cs_test_abc' }).removable, true);
  });
  test('a cs_live_ session is refused', () => {
    const c = classifyRecord({ status: 'active', stripeSessionId: 'cs_live_abc' });
    assert.equal(c.removable, false);
    assert.match(c.refusal, /LIVE/);
  });
  test('⚠ a PaymentIntent proves nothing — pi_ has no mode marker', () => {
    // The census found every stored PaymentIntent is pi_3U…. A record carrying only one is
    // unproven, whatever it looks like.
    assert.equal(classifyRecord({ status: 'active', stripePaymentIntent: 'pi_3Uabc' }).removable, false);
    assert.equal(classifyRecord({ status: 'active', stripePaymentIntent: 'pi_test_abc' }).removable, false);
  });
  test('a Paystack ref is refused unless Paystack TEST mode confirms it', () => {
    assert.equal(classifyRecord({ paystackRef: REF }).removable, false, 'no verdict → refused');
    assert.equal(classifyRecord({ paystackRef: REF }, new Map([[REF, 'unknown']])).removable, false);
    assert.equal(classifyRecord({ paystackRef: REF }, new Map([[REF, 'live']])).removable, false);
    assert.equal(classifyRecord({ paystackRef: REF }, new Map([[REF, 'test']])).removable, true);
  });
  test('a record with one proven and one unproven reference is refused', () => {
    assert.equal(classifyRecord({ stripeSessionId: 'cs_test_a', paystackRef: REF }).removable, false);
  });
  test('no reference, an odd session id, or no record at all → refused', () => {
    assert.equal(classifyRecord({ status: 'active' }).removable, false);
    assert.equal(classifyRecord({ stripeSessionId: 'sess_123' }).removable, false);
    assert.equal(classifyRecord(null).removable, false);
    assert.equal(classifyRecord([]).removable, false);
  });
});

describe('buildPlan — removals and readership in one update', () => {
  const purchases = {
    A: { basil: { status: 'active' }, rescue: { status: 'active' } },
    B: { basil: { status: 'active' }, flint: { status: 'revoked' } },
    C: { rescue: { status: 'active' } }, // stays: a real reader
  };
  test('readership is recomputed from what REMAINS, only for titles a removal touched', () => {
    const { update, readershipAfter } = buildPlan(purchases, [
      { uid: 'A', titleId: 'basil' }, { uid: 'A', titleId: 'rescue' }, { uid: 'B', titleId: 'basil' },
    ]);
    assert.equal(update['bookstore_purchases/A/basil'], null);
    assert.equal(update['bookstore_purchases/B/basil'], null);
    assert.deepEqual(readershipAfter, { basil: 0, rescue: 1 });
    assert.equal(update['bookstore_readership/basil'], null, 'zero is ABSENT, not {count:0}');
    assert.deepEqual(update['bookstore_readership/rescue'], { count: 1 }, 'C\'s real purchase still counts');
    assert.equal('bookstore_readership/flint' in update, false, 'an untouched title is not written');
  });
  test('the input is not mutated', () => {
    const before = structuredClone(purchases);
    buildPlan(purchases, [{ uid: 'A', titleId: 'basil' }]);
    assert.deepEqual(purchases, before);
  });
});

// scripts/verify-live-purchase.mjs — its two pure halves. The stream verdict must be the same
// two lines stream.js runs, or the post-refund check certifies something the endpoint doesn't do.
import { modeFromRecord, streamVerdict } from '../../scripts/verify-live-purchase.mjs';

describe('verify-live-purchase — mode and stream verdict', () => {
  test('mode comes from the session prefix; a PaymentIntent or a Paystack ref is UNPROVEN', () => {
    assert.deepEqual(modeFromRecord({ stripeSessionId: 'cs_live_x' }), { rail: 'stripe', mode: 'LIVE' });
    assert.deepEqual(modeFromRecord({ stripeSessionId: 'cs_test_x' }), { rail: 'stripe', mode: 'TEST' });
    assert.equal(modeFromRecord({ stripePaymentIntent: 'pi_3Ux' }).mode, 'UNPROVEN');
    assert.deepEqual(modeFromRecord({ paystackRef: REF }), { rail: 'paystack', mode: 'UNPROVEN' });
  });
  test('ticket iff a record exists with status exactly active — as stream.js', () => {
    assert.deepEqual(streamVerdict(null), { ticket: false, code: 'not_purchased' });
    assert.equal(streamVerdict({ status: 'active' }).ticket, true);
    assert.deepEqual(streamVerdict({ status: 'revoked', revokedReason: 'refunded' }),
      { ticket: false, code: 'revoked', reason: 'refunded' });
    assert.equal(streamVerdict({}).ticket, false, 'a missing status is not active');
  });
  test('stream.js still applies exactly that test', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../functions/api/bookstore/stream.js', import.meta.url), 'utf8');
    assert.match(src, /if \(!purchase \|\| typeof purchase !== 'object'\)/);
    assert.match(src, /if \(purchase\.status !== 'active'\)/);
  });
});
