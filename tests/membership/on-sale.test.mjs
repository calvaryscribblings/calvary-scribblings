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
import { LAUNCH_DATE_LABEL } from '../../app/lib/launch.js';
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
      `  ${LAUNCH_DATE_LABEL}" in NGN, on the same page on the same day, is a worse thing to ship\n` +
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

// ── LIVE-MONEY PREFLIGHT (23 Sep 2026) — THE GATE COVERS ALL FOUR CHECKOUTS ──────────────
//
// The interlock above proves the flag and the live ids agree. It proved nothing about who
// READS the flag. The two pass endpoints read neither the flag nor isConfigured, so a live key
// sold real passes a week before memberships opened, and every assertion in this file stayed
// green. The block below holds the endpoints themselves: all four checkouts, both rails, test
// and live keys, secret and restricted. Each is called for real, with `fetch` stubbed to
// record, and must answer 409 LAUNCH_NOTICE WITHOUT TOUCHING THE NETWORK. Not Firebase, not
// Stripe, not Paystack: a closed gate costs nothing and reveals nothing.
//
//   MUTATION, run at the preflight and reddened: delete the saleGate block from
//   pass-checkout.js / paystack-pass-checkout.js → the pass rows below fail with a live
//   provider call. Run it again after any edit to a checkout or to _onSale.js.

import { readFileSync } from 'node:fs';
import { saleGate, CLOSED_BODY, CLOSED_STATUS } from '../../functions/api/membership/_onSale.js';
import { modeOf as stripeModeOf } from '../../functions/api/membership/prices.js';
import { modeOf as paystackModeOf } from '../../functions/api/membership/paystack-plans.js';
import * as subStripe from '../../functions/api/membership/checkout.js';
import * as subPaystack from '../../functions/api/membership/paystack-checkout.js';
import * as passStripe from '../../functions/api/membership/pass-checkout.js';
import * as passPaystack from '../../functions/api/membership/paystack-pass-checkout.js';

const CHECKOUTS = [
  { name: 'subscription/stripe', file: 'checkout.js', mod: subStripe, rail: 'stripe', keyVar: 'STRIPE_SECRET_KEY',
    body: { tier: 'gold', interval: 'monthly', currency: 'gbp' } },
  { name: 'subscription/paystack', file: 'paystack-checkout.js', mod: subPaystack, rail: 'paystack', keyVar: 'PAYSTACK_SECRET_KEY',
    body: { tier: 'gold', interval: 'monthly' } },
  { name: 'pass/stripe', file: 'pass-checkout.js', mod: passStripe, rail: 'stripe', keyVar: 'STRIPE_SECRET_KEY',
    body: { kind: 'day', currency: 'gbp' } },
  { name: 'pass/paystack', file: 'paystack-pass-checkout.js', mod: passPaystack, rail: 'paystack', keyVar: 'PAYSTACK_SECRET_KEY',
    body: { kind: 'day' } },
];
const KEYS = ['sk_test_preflight', 'sk_live_preflight', 'rk_test_preflight', 'rk_live_preflight'];

async function callWithStubbedNetwork(mod, env, body) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error(`network touched: ${url}`);
  };
  try {
    const request = new Request('https://calvaryscribblings.co.uk/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer preflight-token' },
      body: JSON.stringify(body),
    });
    const res = await mod.onRequestPost({ request, env });
    return { res, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

// W3 split this block in two. On LIVE keys a closed gate still refuses before anything touches
// the network. On TEST keys it may look up the reader and read ops/test_buyers — the W3 proof's
// door, which an admin opens per uid — but it never reaches Stripe or Paystack for a reader who
// is not listed.
async function callAsReader(mod, env, body, { listed = false } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('identitytoolkit') || u.includes('accounts:lookup')) return ok({ users: [{ localId: 'uidPreflight', email: 'p@example.com' }] });
    if (u.includes('oauth2') || u.includes('token')) return ok({ access_token: 't', expires_in: 3600 });
    if (u.includes('/ops/test_buyers/')) return ok(listed ? true : null);
    throw new Error(`network touched: ${u}`);
  };
  try {
    const request = new Request('https://calvaryscribblings.co.uk/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer preflight-token' },
      body: JSON.stringify(body),
    });
    const res = await mod.onRequestPost({ request, env });
    return { res, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const SA = { FIREBASE_CLIENT_EMAIL: 'sa@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'unused-by-a-stub' };

describe('⭑ ALL FOUR MEMBERSHIP CHECKOUTS ARE SHUT WHILE MEMBERSHIPS_ON_SALE IS FALSE', () => {
  for (const c of CHECKOUTS) {
    for (const key of KEYS.filter((k) => k.includes('_live_'))) {
      test(`${c.name} with ${key.replace('_preflight', '_…')} → 409 LAUNCH_NOTICE, no network`, async (t) => {
        if (MEMBERSHIPS_ON_SALE) { t.skip('memberships are on sale — this block holds the pre-launch door'); return; }
        const env = { [c.keyVar]: key, NEXT_PUBLIC_FIREBASE_API_KEY: 'preflight-api-key' };
        const { res, calls } = await callWithStubbedNetwork(c.mod, env, c.body);
        const json = await res.json().catch(() => null);
        assert.deepEqual(calls, [],
          `${c.name} reached the network with ${key} while memberships are NOT on sale — ` +
          `with a live key that is a real checkout. Calls: ${calls.join(', ')}`);
        assert.equal(res.status, 409, `${c.name} answered ${res.status}: ${JSON.stringify(json)}`);
        assert.equal(json?.error, LAUNCH_NOTICE);
        assert.equal(json?.code, 'not_configured');
      });
    }
    for (const key of KEYS.filter((k) => k.includes('_test_'))) {
      test(`${c.name} with ${key.replace('_preflight', '_…')} → 409 for an unlisted reader, and no PROVIDER is reached`, async (t) => {
        if (MEMBERSHIPS_ON_SALE) { t.skip('memberships are on sale'); return; }
        const env = { [c.keyVar]: key, NEXT_PUBLIC_FIREBASE_API_KEY: 'preflight-api-key', ...SA };
        const { res, calls } = await callAsReader(c.mod, env, c.body);
        const json = await res.json().catch(() => null);
        assert.equal(calls.filter((u) => /api\.stripe\.com|api\.paystack\.co/.test(u)).length, 0, calls.join(', '));
        assert.equal(res.status, 409, `${c.name} answered ${res.status}: ${JSON.stringify(json)}`);
        assert.equal(json?.error, LAUNCH_NOTICE);
      });
    }
  }
});

describe('⭑ ONE CONDITION, IMPORTED — never restated at a call site', () => {
  for (const c of CHECKOUTS) {
    test(`${c.name} asks saleGate('${c.rail}', …) and nothing else`, () => {
      const src = readFileSync(new URL(`../../functions/api/membership/${c.file}`, import.meta.url), 'utf8');
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      assert.match(code, /from '\.\/_onSale\.js'/, `${c.file} does not import the gate`);
      assert.match(code, new RegExp(`saleGate\\('${c.rail}', env\\.${c.keyVar}\\)`),
        `${c.file} does not call saleGate('${c.rail}', env.${c.keyVar})`);
      assert.doesNotMatch(code, /\bisConfigured\s*\(/, `${c.file} restates isConfigured() — use saleGate`);
      assert.doesNotMatch(code, /MEMBERSHIPS_ON_SALE/, `${c.file} reads the flag itself — use saleGate`);
    });
  }

  test('the refusal is the subscriptions\' historic one: 409 · LAUNCH_NOTICE · not_configured', () => {
    assert.equal(CLOSED_STATUS, 409);
    assert.deepEqual({ ...CLOSED_BODY }, { error: LAUNCH_NOTICE, code: 'not_configured' });
  });

  test('⚠ the GRANT sites never consult the gate — a payment that arrives is honoured', () => {
    for (const f of ['_paystack.js', 'stripe-webhook.js', '_membership.js']) {
      const src = readFileSync(new URL(`../../functions/api/membership/${f}`, import.meta.url), 'utf8');
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      assert.doesNotMatch(code, /_onSale|saleGate|MEMBERSHIPS_ON_SALE/,
        `${f} consults the on-sale gate. Ruling: gate at checkout creation ONLY — a reader who ` +
        'has paid receives what they paid for.');
    }
  });
});

describe('⭑ LAUNCH DAY — one flip opens passes and subscriptions together', () => {
  // Proven through the gate's own `onSale` parameter rather than by editing the constant: the
  // four endpoints ask saleGate and nothing else (asserted above), so what saleGate answers
  // with the flag true is what all four do.
  for (const rail of ['stripe', 'paystack']) {
    const isConfigured = rail === 'stripe' ? stripeIsConfigured : paystackIsConfigured;
    for (const key of KEYS) {
      test(`${rail} ${key.replace('_preflight', '_…')}: flag true opens iff the mode is configured`, () => {
        const mode = key.includes('_live_') ? 'live' : 'test';
        assert.equal(saleGate(rail, key, { onSale: true }).open, isConfigured(mode));
        assert.equal(saleGate(rail, key, { onSale: false }).open, false,
          'a false flag must shut the rail whatever the key and whatever the books hold');
      });
    }
  }

  test('with the flag true and the live books pasted, every live key opens both rails — no pass step', () => {
    // The interlock above guarantees flag ⇒ both live books. So at the flip, the live answer
    // for all four endpoints is `true` together. Nothing else sits between the flag and a pass.
    if (!MEMBERSHIPS_ON_SALE) {
      for (const rail of ['stripe', 'paystack']) {
        assert.equal(saleGate(rail, 'sk_live_x').open, false);
        assert.equal(saleGate(rail, 'rk_live_x').open, false);
      }
      return;
    }
    for (const rail of ['stripe', 'paystack']) {
      assert.equal(saleGate(rail, 'sk_live_x').open, true);
      assert.equal(saleGate(rail, 'rk_live_x').open, true);
    }
  });
});

describe('⭑ modeOf() READS A RESTRICTED KEY BY ITS MODE — both rails', () => {
  for (const [name, modeOf] of [['stripe', stripeModeOf], ['paystack', paystackModeOf]]) {
    test(`${name}: sk_live_ and rk_live_ are live; sk_test_ and rk_test_ are test`, () => {
      assert.equal(modeOf('sk_live_abc'), 'live');
      assert.equal(modeOf('rk_live_abc'), 'live', 'a restricted LIVE key read as test — test price ids would go to live Stripe, and the setup script would skip --i-mean-live');
      assert.equal(modeOf('sk_test_abc'), 'test');
      assert.equal(modeOf('rk_test_abc'), 'test');
    });
    test(`${name}: anything else is test (a missing key is not a live key)`, () => {
      for (const k of [undefined, null, '', 'pk_live_abc', 'whsec_abc', 'live', 'sk_liveabc']) {
        assert.equal(modeOf(k), 'test', `modeOf(${JSON.stringify(k)})`);
      }
    });
  }
});
