// RULING 256 — the pure half: when is a payment a duplicate, and what /admin shows of one.
// The end-to-end half (both webhooks, the emulator, signed provider payloads) is
// tests/store-webhook/duplicates.emulator.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isDuplicatePayment, duplicateKey, refundPlan, openEntries, promotionUpdates, DUPLICATES_PATH as FN_PATH,
} from '../../functions/api/bookstore/_duplicates.js';
import { PURCHASE_UNKNOWN } from '../../functions/api/bookstore/_lib.js';
import { DUPLICATES_PATH, DUPLICATE_ALERT, openDuplicates, duplicateLine } from '../../app/lib/bookstore/duplicates.js';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const stripeCopy = { status: 'active', stripeSessionId: 'cs_1', stripePaymentIntent: 'pi_1', amount: 999, currency: 'gbp', purchasedAt: 5 };

describe('256 · what counts as a duplicate payment', () => {
  test('an active paid copy that names none of the incoming references: a duplicate', () => {
    assert.equal(isDuplicatePayment(stripeCopy, ['cs_2', 'pi_2']), true);
    assert.equal(isDuplicatePayment(stripeCopy, ['cs.u.t.abcdef012345']), true, 'across rails');
  });
  test('a replay, by either of the copy\'s references: not a duplicate', () => {
    assert.equal(isDuplicatePayment(stripeCopy, ['cs_1', 'pi_1']), false);
    assert.equal(isDuplicatePayment(stripeCopy, ['cs_other', 'pi_1']), false);
  });
  test('no record, a revoked one, or a read that failed: the existing grant path', () => {
    assert.equal(isDuplicatePayment(null, ['cs_2']), false);
    assert.equal(isDuplicatePayment({ ...stripeCopy, status: 'revoked' }, ['cs_2']), false, 'a repurchase after a refund');
    assert.equal(isDuplicatePayment(PURCHASE_UNKNOWN, ['cs_2']), false, 'fails open, as the grant always has');
  });
  test('a comp or a free claim: a paid grant still makes it a sale (W3b, FREE-TITLES)', () => {
    assert.equal(isDuplicatePayment({ status: 'active', source: 'comp', compGrant: true }, ['cs_2']), false);
    assert.equal(isDuplicatePayment({ status: 'active', freeRef: 'free.u.t', rail: 'free' }, ['cs_2']), false);
  });
  test('a key per rail and reference, safe for a database path', () => {
    assert.equal(duplicateKey('paystack', 'cs.uid.title.abc'), 'paystack_cs_uid_title_abc');
    assert.equal(duplicateKey('stripe', 'cs_test_x'), 'stripe_cs_test_x');
  });
  test('one spelling of the node, shared by the webhooks and /admin', () => {
    assert.equal(FN_PATH, DUPLICATES_PATH);
    assert.equal(DUPLICATES_PATH, 'bookstore_duplicate_payments');
  });
});

describe('256 · the refund decision', () => {
  const entries = {
    stripe_cs_2: { status: 'open', receivedAt: 20, refs: { stripeSessionId: 'cs_2', stripePaymentIntent: 'pi_2' }, amount: 1099, currency: 'GBP' },
    stripe_cs_3: { status: 'open', receivedAt: 10, refs: { stripeSessionId: 'cs_3' } },
    stripe_cs_4: { status: 'refunded', receivedAt: 5, refs: { stripeSessionId: 'cs_4' } },
  };
  test('a refund of a filed payment marks that one; the copy is not touched', () => {
    assert.equal(refundPlan({ copyMatched: false, entries, candidates: ['pi_2'] }).action, 'duplicate');
  });
  test('a refund of the copy\'s payment with one standing: promote the EARLIEST open one', () => {
    const p = refundPlan({ copyMatched: true, entries, candidates: ['pi_1'] });
    assert.equal(p.action, 'promote');
    assert.equal(p.key, 'stripe_cs_3');
  });
  test('nothing standing: revoke', () => {
    assert.equal(refundPlan({ copyMatched: true, entries: { x: { status: 'refunded' } }, candidates: ['pi_1'] }).action, 'revoke');
    assert.equal(refundPlan({ copyMatched: true, entries: null, candidates: ['pi_1'] }).action, 'revoke');
  });
  test('neither: the existing review path', () => {
    assert.equal(refundPlan({ copyMatched: false, entries, candidates: ['pi_9'] }).action, 'none');
  });
  test('open entries, earliest first', () => {
    assert.deepEqual(openEntries(entries).map(([k]) => k), ['stripe_cs_3', 'stripe_cs_2']);
  });
  test('a promotion never names the copy\'s status, so the readership count cannot move', () => {
    const u = promotionUpdates({ uid: 'u', titleId: 't', existing: stripeCopy, key: 'stripe_cs_2', entry: entries.stripe_cs_2, reason: 'refunded', now: 7 });
    assert.equal(Object.keys(u).some((k) => k.endsWith('/status') && k.startsWith('bookstore_purchases/')), false);
    assert.equal(u['bookstore_purchases/u/t/stripeSessionId'], 'cs_2');
    assert.equal(u['bookstore_purchases/u/t/paystackRef'], null);
    assert.equal(u['bookstore_duplicate_payments/u/t/stripe_cs_1'].role, 'original');
    assert.equal(u['bookstore_duplicate_payments/u/t/stripe_cs_2/status'], 'promoted');
  });
});

describe('256 · the /admin block', () => {
  const node = {
    uA: { 'the-book': {
      stripe_cs_2: { status: 'open', rail: 'stripe', amount: 999, currency: 'GBP', receivedAt: Date.UTC(2026, 9, 31, 12), title: 'The Book', refs: { stripeSessionId: 'cs_2' } },
      stripe_cs_9: { status: 'refunded', rail: 'stripe', amount: 999, currency: 'GBP', receivedAt: 1 },
      stripe_cs_8: { status: 'promoted', rail: 'stripe', amount: 999, currency: 'GBP', receivedAt: 2 },
    } },
    uB: { 'another': { paystack_cs_x: { status: 'open', rail: 'paystack', amount: 750000, currency: 'NGN', receivedAt: Date.UTC(2026, 9, 30, 9), titleId: 'another' } } },
  };
  test('only OPEN duplicates are listed, earliest first; a refunded one has dropped out', () => {
    assert.deepEqual(openDuplicates(node).map((d) => d.key), ['paystack_cs_x', 'stripe_cs_2']);
    assert.deepEqual(openDuplicates(null), []);
  });
  test('each line: title, rail, amount, date and the reader\'s internal reference — no payment id', () => {
    const [ng, gb] = openDuplicates(node).map(duplicateLine);
    assert.equal(gb, '“The Book” · Stripe · £9.99 · 31 Oct 2026, 12:00 · reader uA');
    assert.equal(ng, '“another” · Paystack · ₦7,500 · 30 Oct 2026, 09:00 · reader uB');
    assert.doesNotMatch(gb, /cs_2/);
  });
  test('the block says what to do, and /admin reads the node and draws it', () => {
    assert.equal(DUPLICATE_ALERT.action, 'Refund by hand in Stripe or Paystack.');
    const page = src('app/admin/page.js');
    assert.match(page, /get\(ref\(db, DUPLICATES_PATH\)\)/);
    assert.match(page, /setDuplicates\(openDuplicates\(/);
    assert.match(page, /data-duplicate-payments=""/);
    assert.match(page, /duplicates\.map\(d => \(/);
  });
});

describe('256 · no money moves', () => {
  test('no refund API anywhere in either webhook or the duplicates module', () => {
    for (const f of ['functions/api/bookstore/stripe-webhook.js', 'functions/api/bookstore/paystack-webhook.js', 'functions/api/bookstore/_duplicates.js', 'app/lib/bookstore/duplicates.js']) {
      const s = src(f);
      assert.doesNotMatch(s, /api\.stripe\.com/, `${f} calls Stripe`);
      assert.doesNotMatch(s, /api\.paystack\.co\/refund/, `${f} calls Paystack's refund API`);
      assert.doesNotMatch(s, /\/v1\/refunds/, `${f} names a refunds endpoint`);
    }
  });
});
