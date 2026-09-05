// R9.1 — THE ON-SALE INTERLOCK. The test membershipPrices.js has claimed since R11.7.
//
//   node --test tests/membership/on-sale.test.mjs      (npm run test:membership)
//
// ── WHY THIS FILE EXISTS, AND WHAT IT REPLACES ───────────────────────────────────────────
//
// app/lib/membershipPrices.js has said this about MEMBERSHIPS_ON_SALE since R11.7:
//
//   "this flag is not 'has the date passed' — it is 'do the live ids exist yet', asserted
//    against the real price books by tests/membership/on-sale.test.mjs. That test imports both
//    rail modules and fails the moment this constant and isConfigured('live') disagree in
//    either direction, which is what makes a single boolean safe: it CANNOT silently drift,
//    because the build stops."
//
// THE FILE DID NOT EXIST. Not renamed, not moved, not disabled — `git log --all
// --diff-filter=A` found no commit that ever added it. Nothing anywhere imported
// MEMBERSHIPS_ON_SALE alongside isConfigured, in any test or any build step. The interlock was
// a sentence, and the sentence is the reason nobody went looking for the mechanism: a comment
// that describes a safety net is believed, and the belief is what stops the check.
//
// So this is not a new idea. It is the idea that was already written down, finally built, and
// the only thing worth adding is that the failure it prevents is silent in BOTH directions:
//
//   · PASTE WITHOUT FLIPPING — the live price ids land in prices.js and paystack-plans.js,
//     both rails answer, the store is open, and every membership surface still prints
//     "Memberships open on 30 September" over working buttons. Money moves and the page
//     denies it.
//   · FLIP WITHOUT PASTING — the flag goes true against null ids. Every price renders, every
//     button is live, and every click answers 409 not_configured. The store looks open and
//     refuses everyone.
//
// Neither errors. Neither logs. Both survive a full manual walk of the pricing page by anyone
// who does not happen to click Join, and the second one survives even that if they read the
// 409's message as the pre-launch copy it is word-for-word identical to.
//
// ── THE ASSERTION IS A STRICT IFF, AND ACROSS BOTH RAILS TOGETHER ────────────────────────
//
// MEMBERSHIPS_ON_SALE === (stripe live configured AND paystack live configured).
//
// The conjunction is the flag's own documented rule — "CONSERVATIVE ACROSS RAILS … if Stripe's
// live prices existed and Paystack's did not, this stays false and nobody is offered
// anything". So a HALF-PASTED launch is a failure here, deliberately: prices.js says "FLIP IT
// IN THE SAME COMMIT that pastes the live PRICE_BOOK and PLAN_BOOK blocks", and a red suite on
// a commit that pastes one rail is that instruction being enforced rather than restated.
//
// ── ⚠ THIS FILE MUST BE ABLE TO FAIL. RUN THE MUTATIONS. ─────────────────────────────────
//
// A test that asserts an interlock and cannot redden is the exact thing this round exists to
// close, so do not take the green on trust. Both mutations were run against this file at
// R9.1 and both reddened; run them again after any edit here, to the flag, or to either book:
//
//   PASTE WITHOUT FLIPPING
//     fill functions/api/membership/prices.js PRICE_BOOK.founding.live with any 8 strings and
//     paystack-plans.js PLAN_BOOK.founding.live with any 4, leave MEMBERSHIPS_ON_SALE false
//     → expected: "the rails are LIVE-CONFIGURED and MEMBERSHIPS_ON_SALE is false"
//
//   FLIP WITHOUT PASTING
//     set MEMBERSHIPS_ON_SALE = true, leave both books null
//     → expected: "MEMBERSHIPS_ON_SALE is true and NEITHER rail is live-configured"
//
// Revert after each. Neither mutation may be left in the tree, and neither is this round's
// work — R9.1 ships no live price and no live plan.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { MEMBERSHIPS_ON_SALE, LAUNCH_NOTICE } from '../../app/lib/membershipPrices.js';
import {
  isConfigured as stripeIsConfigured, PRICE_BOOK, CURRENT_GENERATION as STRIPE_GENERATION,
  PORTAL_CONFIGURATION,
} from '../../functions/api/membership/prices.js';
import {
  isConfigured as paystackIsConfigured, PLAN_BOOK,
  CURRENT_GENERATION as PAYSTACK_GENERATION,
} from '../../functions/api/membership/paystack-plans.js';

// Read ONCE, at import, and never through a helper that could be stubbed. The whole point is
// that these are the real exported books as the build would ship them.
const STRIPE_LIVE = stripeIsConfigured('live');
const PAYSTACK_LIVE = paystackIsConfigured('live');
const RAILS_LIVE = STRIPE_LIVE && PAYSTACK_LIVE;

const state = () =>
  `MEMBERSHIPS_ON_SALE=${MEMBERSHIPS_ON_SALE} stripe.live=${STRIPE_LIVE} paystack.live=${PAYSTACK_LIVE}`;

describe('⭑ THE ON-SALE INTERLOCK — the flag and the live ids cannot drift apart', () => {
  test('⭑ MEMBERSHIPS_ON_SALE IS TRUE IF AND ONLY IF BOTH RAILS ARE LIVE-CONFIGURED', () => {
    if (MEMBERSHIPS_ON_SALE && !RAILS_LIVE) {
      assert.fail(
        `MEMBERSHIPS_ON_SALE is true and ${STRIPE_LIVE || PAYSTACK_LIVE ? 'only one rail is' : 'NEITHER rail is'} ` +
        `live-configured (${state()}).\n\n` +
        '  Every membership button on /membership is now live and every click answers 409\n' +
        '  not_configured — whose message is the pre-launch sentence word for word, so the\n' +
        '  store looks open, refuses everyone, and says nothing a reader could act on.\n\n' +
        '  Either paste the live ids into BOTH functions/api/membership/prices.js and\n' +
        '  paystack-plans.js, or set MEMBERSHIPS_ON_SALE back to false. Same commit.',
      );
    }
    if (!MEMBERSHIPS_ON_SALE && RAILS_LIVE) {
      assert.fail(
        `the rails are LIVE-CONFIGURED and MEMBERSHIPS_ON_SALE is false (${state()}).\n\n` +
        '  Both rails will take real money right now, and every membership surface still\n' +
        `  prints ${JSON.stringify(LAUNCH_NOTICE)} over working buttons.\n\n` +
        '  Flip MEMBERSHIPS_ON_SALE in app/lib/membershipPrices.js, in the commit that\n' +
        '  pasted the ids — not the one after it.',
      );
    }
    assert.equal(MEMBERSHIPS_ON_SALE, RAILS_LIVE, state());
  });

  test('⭑ A HALF-PASTED LAUNCH IS A FAILURE — the flag governs both rails or neither', () => {
    // Not implied by the iff above: it holds trivially when both rails are false. This is the
    // conservative rule stated on its own, so the intermediate state has a named test.
    assert.equal(
      STRIPE_LIVE, PAYSTACK_LIVE,
      `one rail is live-configured and the other is not (${state()}).\n\n` +
      '  The flag is ONE boolean for both, deliberately: on sale in GBP and USD and "opens\n' +
      '  30 September" in NGN, on the same page on the same day, is a worse thing to ship\n' +
      '  than waiting for the second rail. Paste both, or neither.',
    );
  });

  test('THE PORTAL CONFIGURATION MOVES WITH THE PRICES — a live store needs a live portal', () => {
    // The second half of the founding lock. Live prices with a null portal configuration means
    // portal.js answers 409 not_configured for every member who tries to cancel or upgrade —
    // and the alternative it is refusing (an unrestricted portal) would end the founding lock
    // on the first upgrade. Either way the day it matters is the day after launch.
    const portalLive = typeof PORTAL_CONFIGURATION[STRIPE_GENERATION]?.live === 'string'
      && !!PORTAL_CONFIGURATION[STRIPE_GENERATION].live;
    assert.equal(
      portalLive, STRIPE_LIVE,
      `stripe live prices=${STRIPE_LIVE} but live portal configuration=${portalLive}.\n\n` +
      '  scripts/create-founding-prices.mjs prints the PRICE_BOOK and the PORTAL_CONFIGURATION\n' +
      '  blocks in the same run. Paste both.',
    );
  });

  test('the flag is a boolean, and the two rails agree on which generation is current', () => {
    assert.equal(typeof MEMBERSHIPS_ON_SALE, 'boolean',
      'a truthy string or a number here would satisfy every `if` in the app and no assertion');
    assert.equal(STRIPE_GENERATION, PAYSTACK_GENERATION,
      'the rails are reading different generations — the reverse lookups cannot both be right');
    assert.ok(PRICE_BOOK[STRIPE_GENERATION], `PRICE_BOOK has no ${STRIPE_GENERATION} generation`);
    assert.ok(PLAN_BOOK[PAYSTACK_GENERATION], `PLAN_BOOK has no ${PAYSTACK_GENERATION} generation`);
  });

  test('R9.1 SHIPS NO LIVE IDS — this build is pre-launch, and says so out loud', () => {
    // The one assertion here that IS about today rather than about the invariant. It is
    // separate from the interlock above on purpose: on launch day this test is DELETED and the
    // four above are untouched, so the interlock survives the commit that opens the store.
    assert.equal(RAILS_LIVE, false,
      'a live rail is configured. If that is deliberate, this is launch day: delete THIS test '
      + '(and only this one) in the same commit, and leave the interlock standing.');
    assert.equal(MEMBERSHIPS_ON_SALE, false);
  });
});
