// THE PRICE TABLE — the settled figures, the rails' agreement with them, and the one flag
// that decides whether anything can be bought.
//
// Three things are asserted here and each one guards a failure that ships silently:
//
//   1. THE FIGURES. Hand-set, settled, and typed out again in this file ON PURPOSE. A test
//      that imported the table and compared it to itself would pass no matter what anyone
//      changed. These literals are the second opinion — if a price moves, this fails and
//      somebody has to justify the move in a diff rather than discovering it on a card
//      statement.
//
//   2. RAIL PARITY. The pricing page SHOWS from app/lib/membershipPrices.js and the rails
//      CHARGE from their own AMOUNTS exports. Those are now slices of the one table, and this
//      proves it — because the failure when they drift is a reader who is quoted £2.99 and
//      charged £3.99, and nothing else in the build would notice.
//
//   3. THE ON-SALE FLAG. MEMBERSHIPS_ON_SALE is a hand-flipped boolean, which is only safe if
//      something fails the moment it disagrees with reality. Reality is isConfigured('live')
//      on both rails. This is that something.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUBSCRIPTION_AMOUNTS, subscriptionAmount, subscriptionsFor,
  stripeAmounts, paystackAmounts,
  MEMBERSHIPS_ON_SALE, LAUNCH_NOTICE, LAUNCH_DATE_LABEL,
  TIERS, INTERVALS,
} from '../../app/lib/membershipPrices.js';
import { AMOUNTS as STRIPE_AMOUNTS, isConfigured as stripeConfigured } from '../../functions/api/membership/prices.js';
import { AMOUNTS as PAYSTACK_AMOUNTS, isConfigured as paystackConfigured } from '../../functions/api/membership/paystack-plans.js';
import { AMOUNTS as PASS_AMOUNTS, passesFor } from '../../app/lib/membershipPasses.js';

// The settled table, in minor units, written out by hand as the independent second opinion.
//                     GBP     USD     NGN(kobo)
const SETTLED = {
  gold: {
    monthly: { gbp: 299, usd: 399, ngn: 150000 },
    annual: { gbp: 2999, usd: 3999, ngn: 1500000 },
  },
  platinum: {
    monthly: { gbp: 499, usd: 649, ngn: 250000 },
    annual: { gbp: 4999, usd: 6499, ngn: 2500000 },
  },
};

describe('the settled subscription figures', () => {
  test('every tier/interval/currency is exactly what was agreed', () => {
    for (const tier of Object.keys(SETTLED)) {
      for (const interval of Object.keys(SETTLED[tier])) {
        for (const [cur, expected] of Object.entries(SETTLED[tier][interval])) {
          assert.equal(
            subscriptionAmount(tier, interval, cur), expected,
            `${tier} ${interval} ${cur} must be ${expected} minor units`,
          );
        }
      }
    }
  });

  test('the passes are what was agreed, and the week pass is NAIRA ONLY', () => {
    assert.equal(PASS_AMOUNTS.day.gbp, 100);
    assert.equal(PASS_AMOUNTS.day.usd, 149);
    assert.equal(PASS_AMOUNTS.day.ngn, 30000);
    assert.equal(PASS_AMOUNTS.week.ngn, 50000);
    // The absence IS the rule. Not a condition anywhere — the week pass simply has no other
    // price, which is why the pricing page renders it correctly without a currency check.
    assert.equal(PASS_AMOUNTS.week.gbp, undefined, 'there is no GBP week pass');
    assert.equal(PASS_AMOUNTS.week.usd, undefined, 'there is no USD week pass');
  });

  test('a pricing page in naira is offered both passes; in GBP and USD, only the day pass', () => {
    assert.deepEqual(passesFor('ngn').map((p) => p.kind).sort(), ['day', 'week']);
    assert.deepEqual(passesFor('gbp').map((p) => p.kind), ['day']);
    assert.deepEqual(passesFor('usd').map((p) => p.kind), ['day']);
  });

  test('no amount is derived from another — the annuals are NOT ten times the monthly', () => {
    // Guards against a future "tidy-up" that computes annual = monthly * 10. The pitch is ten
    // months for twelve; the arithmetic is not, and £2.99 × 10 = £29.90 ≠ £29.99.
    for (const tier of TIERS) {
      for (const cur of ['gbp', 'usd']) {
        const monthly = subscriptionAmount(tier, 'monthly', cur);
        const annual = subscriptionAmount(tier, 'annual', cur);
        assert.notEqual(annual, monthly * 10, `${tier}/${cur} annual must not be a computed ×10`);
      }
    }
  });

  test('subscriptionsFor() offers all four rows in every currency we price', () => {
    for (const cur of ['gbp', 'usd', 'ngn']) {
      assert.equal(subscriptionsFor(cur).length, TIERS.length * INTERVALS.length, `${cur}`);
    }
    assert.deepEqual(subscriptionsFor('eur'), [], 'a currency we do not price offers nothing');
  });

  test('an unknown tier, interval or currency is null rather than a guess', () => {
    assert.equal(subscriptionAmount('bronze', 'monthly', 'gbp'), null);
    assert.equal(subscriptionAmount('gold', 'weekly', 'gbp'), null);
    assert.equal(subscriptionAmount('gold', 'monthly', 'eur'), null);
  });
});

describe('THE RAILS CHARGE WHAT THE PAGE SHOWS', () => {
  test('Stripe’s AMOUNTS is the GBP/USD slice of the one table', () => {
    assert.deepEqual(STRIPE_AMOUNTS, stripeAmounts());
    for (const tier of TIERS) {
      for (const interval of INTERVALS) {
        assert.equal(STRIPE_AMOUNTS[tier][interval].gbp, SETTLED[tier][interval].gbp);
        assert.equal(STRIPE_AMOUNTS[tier][interval].usd, SETTLED[tier][interval].usd);
        // And it must NOT have grown a naira column — Stripe cannot settle naira.
        assert.equal(STRIPE_AMOUNTS[tier][interval].ngn, undefined);
      }
    }
  });

  test('Paystack’s AMOUNTS is the naira slice, in kobo', () => {
    assert.deepEqual(PAYSTACK_AMOUNTS, paystackAmounts());
    for (const tier of TIERS) {
      for (const interval of INTERVALS) {
        assert.equal(PAYSTACK_AMOUNTS[tier][interval], SETTLED[tier][interval].ngn);
      }
    }
  });

  test('the canonical table is the union of the two slices and nothing else', () => {
    for (const tier of TIERS) {
      for (const interval of INTERVALS) {
        assert.deepEqual(
          Object.keys(SUBSCRIPTION_AMOUNTS[tier][interval]).sort(),
          ['gbp', 'ngn', 'usd'],
        );
      }
    }
  });
});

describe('MEMBERSHIPS_ON_SALE cannot drift from the price books', () => {
  // THE POINT OF THIS FILE. The flag is hand-flipped; this is what makes that safe.
  //
  // If it ever fails, do NOT edit the assertion. Either the live ids were pasted and the flag
  // was not flipped (flip it), or the flag was flipped before the ids exist (unflip it, or
  // finish the setup) — the two states are not interchangeable and one of them puts buttons on
  // the pricing page that answer 409.
  test('the flag says exactly what BOTH live price books say', () => {
    const liveReady = stripeConfigured('live') && paystackConfigured('live');
    assert.equal(
      MEMBERSHIPS_ON_SALE, liveReady,
      MEMBERSHIPS_ON_SALE
        ? 'MEMBERSHIPS_ON_SALE is true but the live PRICE_BOOK/PLAN_BOOK is not fully populated'
        : 'the live price books are fully populated — flip MEMBERSHIPS_ON_SALE to true',
    );
  });

  test('TEST mode is configured on both rails, so the page can be exercised end to end', () => {
    assert.equal(stripeConfigured('test'), true);
    assert.equal(paystackConfigured('test'), true);
  });

  test('the launch sentence has ONE source, and the rails import it', async () => {
    assert.match(LAUNCH_NOTICE, /30 September/);
    assert.equal(LAUNCH_DATE_LABEL, '30 September');
    // prices.js re-exports it rather than keeping a copy; paystack-checkout imports it direct.
    const stripeRail = await import('../../functions/api/membership/prices.js');
    assert.equal(stripeRail.LAUNCH_NOTICE, LAUNCH_NOTICE);
  });
});
