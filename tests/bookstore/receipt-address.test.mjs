// R9.1 — THE BOOK BUYER'S RECEIPT ADDRESS.
//
//   node --test tests/bookstore/receipt-address.test.mjs      (npm run test:purchases)
//
// ── WHAT WAS WRONG, AND HOW LONG IT HAD BEEN WRONG ──────────────────────────────────────
//
// The R9 launch audit went looking for the purchase confirmation email and found there is
// none: no Resend call, no receipt template, nothing in emails/ but WeeklyDigest.jsx. The two
// Workers holding the Resend key (calvary-newsletter, calvary-auth) never see a purchase.
//
// That alone would have been survivable, because Stripe sends its own receipt. Except it
// could not: functions/api/bookstore/checkout.js called verifyIdToken(), which is a wrapper
// around lookupUser() that returns `localId` and throws the rest away — so the Checkout
// Session was built with no `customer_email`, and Stripe had no address.
//
//   ⭑ A BOOK BUYER RECEIVED NO EMAIL FROM ANYONE. Not from us, not from Stripe. Their only
//     confirmation of a completed sale was the ?purchase=success redirect, gone the moment the
//     tab closed.
//
// Both membership rails already set it — membership/checkout.js:177, pass-checkout.js:137 — so
// the book rail, the ONLY one that has actually taken money, was the only one getting it wrong.
// Ikenna's R9.1 ruling: Stripe's own receipt for launch, a house-branded one in October.
//
// ── WHY THIS IS A SUITE AND NOT A ONE-LINE DIFF ─────────────────────────────────────────
//
// Because the failure was invisible to every existing test. 564 purchase assertions passed
// with no receipt address in the session, and they still pass now — they watch status codes
// and whether a rail was reached, and nobody had ever read the form body Stripe receives. So
// the assertions here read the ACTUAL urlencoded body of the outbound Stripe call.
//
// Three things are pinned, and the third is the one most likely to be broken by a later
// "tidy-up":
//
//   1. the address reaches Stripe at all
//   2. it is the address on the VERIFIED TOKEN, never one from the request body — a
//      body-supplied address would let a buyer post someone else's receipt to themselves,
//      which is the rule paystack-checkout.js:98 already states
//   3. ⚠ A MISSING ADDRESS DOES NOT BLOCK THE SALE. Paystack refuses a transaction without an
//      email (409 no_email) because Paystack requires one; Stripe does not, and an anonymous or
//      phone-only account can buy a book on this rail today. Making the address mandatory here
//      to "fix" the receipt would break a working sale to add a courtesy. It is the natural
//      wrong turn and it has a named test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as stripeCheckout } from '../../functions/api/bookstore/checkout.js';

const UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const TOKEN_EMAIL = 'reader@example.com';
const ID_TOKEN = 'stub-id-token';

const TITLE = {
  status: 'published',
  slug: 'the-rescue',
  title: 'The Rescue',
  author: 'Joseph Conrad',
  publisherId: 'calvary',
  prices: { gbp: 199, usd: 249, ngn: 180000 },
  territoriesAllowed: '*',
};

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_stub',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'stub-web-api-key',
  FIREBASE_DATABASE_URL: 'https://stub-db.example.com',
  SITE_ORIGIN: 'https://example.test',
};

/**
 * Runs a checkout and hands back the FORM STRIPE ACTUALLY RECEIVED, parsed.
 *
 * `identity` is what Identity Toolkit answers with — the shape of a real verified user record,
 * so "this account has no email" is modelled by omitting the field rather than by reaching
 * into the endpoint.
 */
async function checkoutForm({ identity = { localId: UID, email: TOKEN_EMAIL }, body = {} } = {}) {
  const original = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
    // `identity: null` models a token Identity Toolkit will not resolve — an empty users
    // array, which is what it actually answers. NOT `undefined`: that triggers the default
    // parameter above and hands back a perfectly valid user, which is how the first draft of
    // the 401 test below asserted nothing at all and passed a 200 as a 401.
    if (href.includes('identitytoolkit.googleapis.com')) return ok({ users: identity ? [identity] : [] });
    if (href.includes('/bookstore_titles/')) return ok(TITLE);
    if (href.includes('/bookstore_publishers/')) return ok({ status: 'active' });
    if (href.includes('/bookstore_purchases/')) return ok(null);
    if (href.includes('api.stripe.com')) {
      sent = new URLSearchParams(String(init.body));
      return ok({ id: 'cs_test_stub', url: 'https://checkout.stripe.com/stub' });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  try {
    const request = new Request('https://calvaryscribblings.co.uk/api/bookstore/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: ID_TOKEN, titleId: 'a-title', currency: 'gbp', ...body }),
    });
    Object.defineProperty(request, 'cf', { value: { country: 'GB' }, configurable: true });
    const res = await stripeCheckout({ request, env: ENV });
    return { res, form: sent };
  } finally {
    globalThis.fetch = original;
  }
}

describe('⭑ THE BOOK BUYER GETS A RECEIPT — the address reaches Stripe', () => {
  test('⭑ customer_email IS SET ON THE SESSION, from the verified token', async () => {
    const { res, form } = await checkoutForm();
    assert.equal(res.status, 200);
    assert.ok(form, 'no Stripe session was created at all');
    assert.equal(
      form.get('customer_email'), TOKEN_EMAIL,
      'the Checkout Session carries no customer_email — Stripe has no address to send a '
      + 'receipt to, and there is no other purchase email anywhere in this platform',
    );
  });

  test('⭑ THE ADDRESS IS NEVER TAKEN FROM THE REQUEST BODY', async () => {
    // A buyer posting somebody else's address must not be able to redirect a receipt, and must
    // not be able to put an address on a session for an account that has none.
    const { form } = await checkoutForm({
      body: { email: 'attacker@example.com', customer_email: 'attacker@example.com' },
    });
    assert.equal(form.get('customer_email'), TOKEN_EMAIL,
      'a body-supplied address reached Stripe — the email must come from the verified token');
  });

  test('⭑ AN ACCOUNT WITH NO EMAIL STILL BUYS THE BOOK — the field is omitted, not empty', async () => {
    // The natural wrong turn: making the address mandatory to guarantee the receipt. Anonymous
    // and phone-only accounts buy on this rail today and would stop being able to.
    const { res, form } = await checkoutForm({ identity: { localId: UID } });
    assert.equal(res.status, 200, 'a missing email must not refuse the sale on the Stripe rail');
    assert.equal(form.has('customer_email'), false,
      'customer_email must be absent, not empty — Stripe rejects the whole session on a blank');
  });

  test('an empty or whitespace address is treated as absent', async () => {
    for (const email of ['', '   ']) {
      const { res, form } = await checkoutForm({ identity: { localId: UID, email } });
      assert.equal(res.status, 200);
      assert.equal(form.has('customer_email'), false, `"${email}" was sent to Stripe as an address`);
    }
  });

  test('the identity call is made ONCE — reading the email costs no extra round trip', async () => {
    // verifyIdToken() was already calling Identity Toolkit and discarding the email. If a later
    // change reads the address with a second lookup, that is a needless round trip on the
    // critical path of every sale.
    const original = globalThis.fetch;
    let lookups = 0;
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (href.includes('identitytoolkit.googleapis.com')) { lookups++; return ok({ users: [{ localId: UID, email: TOKEN_EMAIL }] }); }
      if (href.includes('/bookstore_titles/')) return ok(TITLE);
      if (href.includes('/bookstore_publishers/')) return ok({ status: 'active' });
      if (href.includes('/bookstore_purchases/')) return ok(null);
      if (href.includes('api.stripe.com')) return ok({ id: 'cs_test_stub', url: 'https://checkout.stripe.com/stub' });
      throw new Error(`unstubbed fetch: ${href}`);
    };
    try {
      const request = new Request('https://calvaryscribblings.co.uk/api/bookstore/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: ID_TOKEN, titleId: 'a-title', currency: 'gbp' }),
      });
      Object.defineProperty(request, 'cf', { value: { country: 'GB' }, configurable: true });
      await stripeCheckout({ request, env: ENV });
    } finally { globalThis.fetch = original; }
    assert.equal(lookups, 1, `Identity Toolkit was called ${lookups} times; one is enough`);
  });

  test('an expired token is still a 401 — reading the email did not weaken the auth check', async () => {
    const { res, form } = await checkoutForm({ identity: null });
    assert.equal(res.status, 401);
    assert.equal(form, null, 'a Stripe session was created for an unverified caller');
  });

  test('the rest of the session is unchanged — metadata and the PaymentIntent pair still ship', async () => {
    // The refund path depends on payment_intent_data metadata reaching the Charge. A regression
    // here would not surface until somebody asked for their money back.
    const { form } = await checkoutForm();
    assert.equal(form.get('metadata[uid]'), UID);
    assert.equal(form.get('metadata[titleId]'), 'a-title');
    assert.equal(form.get('payment_intent_data[metadata][uid]'), UID);
    assert.equal(form.get('payment_intent_data[metadata][titleId]'), 'a-title');
    assert.equal(form.get('client_reference_id'), UID);
    assert.equal(form.get('mode'), 'payment');
  });
});
