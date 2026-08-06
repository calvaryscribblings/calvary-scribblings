// R8.4 — TERRITORY ENFORCEMENT AT THE TILL, and the deliberate absence of it at the shelf.
//
//   node --test tests/bookstore/territory-endpoints.test.mjs      (npm run test:purchases)
//
// The unit suite (tests/bookstore/territory.test.mjs) pins what a licence MEANS. This one pins
// what the endpoints DO with it, by calling onRequestPost for real with a stubbed edge:
//
//   · a restricted title is refused with 403 not_in_territory, on BOTH rails
//   · and NOTHING IS CREATED — no Stripe session, no Paystack transaction. This is the half a
//     status-code assertion misses: an endpoint that charges the card and then returns 403 is
//     the worst possible version of this feature, and the only way to know it does not is to
//     watch the outbound calls.
//   · a worldwide title is permitted, and a restricted title is permitted from inside its
//     licence — so the guard is a guard and not an off switch.
//   · stream.js still hands over a purchased book to a reader in a country the title was never
//     licensed for. Ownership survives travel.
//
// THE COUNTRY IS STUBBED AT THE REQUEST LEVEL, as `request.cf.country` — the same property
// Cloudflare sets at the edge and the same one region.js reads. Nothing here passes a country
// in a body or a header the endpoint would trust, because neither endpoint will accept one.
//
// EVERYTHING ELSE IS A FETCH STUB. No Firebase, no Stripe, no Paystack, no network at all: one
// router keyed by URL, which also records every call so the "created nothing" assertions have
// something to read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { onRequestPost as stripeCheckout } from '../../functions/api/bookstore/checkout.js';
import { onRequestPost as paystackCheckout } from '../../functions/api/bookstore/paystack-checkout.js';
import { onRequestPost as stream } from '../../functions/api/bookstore/stream.js';

const UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const EMAIL = 'reader@example.com';
const ID_TOKEN = 'stub-id-token';

const WORLDWIDE_TITLE = {
  status: 'published',
  slug: 'the-rescue',
  title: 'The Rescue',
  author: 'A Name',
  publisherId: 'calvary',
  prices: { gbp: 199, usd: 249, ngn: 180000 },
  territoriesAllowed: '*',
};

// UK & Ireland only — the "only-in" state.
const UK_ONLY_TITLE = { ...WORLDWIDE_TITLE, slug: 'uk-only', territoriesAllowed: ['GB', 'IE'] };

// Worldwide except North America — the "worldwide-except" state, and the one a real contract
// is most likely to be written as.
const NOT_IN_NA_TITLE = { ...WORLDWIDE_TITLE, slug: 'not-in-na', territoriesAllowed: '*', territoriesExcluded: ['CA', 'MX', 'US'] };

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_stub',
  PAYSTACK_SECRET_KEY: 'sk_test_paystack_stub',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'stub-web-api-key',
  FIREBASE_DATABASE_URL: 'https://stub-db.example.com',
  SITE_ORIGIN: 'https://example.test',
};

/**
 * A Pages Function context with a stubbed edge.
 *
 * `cf.country` is where Cloudflare puts the answer and where region.js reads it; passing null
 * models the undetermined case (Tor, an unknown egress, a local harness) by omitting `cf`
 * entirely, exactly as `wrangler dev` does.
 */
function contextFor(body, country, env = ENV) {
  // R9.10: this double used to expose only `json()` and a null-returning `headers.get`. A real
  // Cloudflare Request also has `text()`, a real Headers and a `url` — and when stream.js began
  // reading the raw body (so a native client may send none) and the Authorization header, the
  // three stream cases below failed on `request.text is not a function` while production was
  // fine. A partial double that drifts from the platform object tests the double, not the code.
  // Building a real Request removes the whole class of drift; `cf` is the one genuinely
  // Cloudflare-specific field and is still attached by hand.
  const request = new Request('https://calvaryscribblings.co.uk/api/bookstore/stub', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (country !== null) Object.defineProperty(request, 'cf', { value: { country }, configurable: true });
  return { request, env };
}

/**
 * Installs a global fetch that answers Firebase, Identity Toolkit, Stripe, Paystack and Google
 * OAuth from a table, and records every call. Returns the log plus a restore function.
 */
function stubFetch({ title = null, purchase = null, publisher = { status: 'active' } } = {}) {
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, method: init.method || 'GET' });

    const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // Identity Toolkit — the id-token verification both checkout endpoints do first.
    if (href.includes('identitytoolkit.googleapis.com')) {
      return ok({ users: [{ localId: UID, email: EMAIL }] });
    }
    // Google OAuth — stream.js's admin token mint.
    if (href.includes('oauth2.googleapis.com')) {
      return ok({ access_token: 'stub-admin-token', expires_in: 3600 });
    }
    // RTDB reads.
    if (href.includes('/bookstore_titles/')) return ok(title);
    if (href.includes('/bookstore_publishers/')) return ok(publisher);
    if (href.includes('/bookstore_purchases/')) return ok(purchase);
    // The payment rails. Reaching either of these in a refusal test is the failure.
    if (href.includes('api.stripe.com')) return ok({ id: 'cs_test_stub', url: 'https://checkout.stripe.com/stub' });
    if (href.includes('api.paystack.co')) {
      return ok({ status: true, data: { authorization_url: 'https://checkout.paystack.com/stub' } });
    }

    throw new Error(`unstubbed fetch: ${href}`);
  };

  return {
    calls,
    restore: () => { globalThis.fetch = original; },
    hitStripe: () => calls.some((c) => c.url.includes('api.stripe.com')),
    hitPaystack: () => calls.some((c) => c.url.includes('api.paystack.co')),
  };
}

const stripeBody = { idToken: ID_TOKEN, titleId: 'a-title', currency: 'gbp' };
const paystackBody = { idToken: ID_TOKEN, titleId: 'a-title' };

// ═══════════════════════════════════════════════════════════════════════════════
// THE STRIPE RAIL
// ═══════════════════════════════════════════════════════════════════════════════

test('stripe: an allow-listed title is REFUSED outside its territories, and nothing is created', async () => {
  const f = stubFetch({ title: UK_ONLY_TITLE });
  try {
    const res = await stripeCheckout(contextFor(stripeBody, 'US'));
    assert.equal(res.status, 403);
    const payload = await res.json();
    assert.equal(payload.code, 'not_in_territory');
    // THE COUNTRY IS NOT IN THE BODY. It goes to the log; echoing it back would turn a refusal
    // into a geolocation oracle for anyone probing the endpoint.
    assert.equal(JSON.stringify(payload).includes('US'), false);
    assert.equal(f.hitStripe(), false, 'NO Stripe session may be created for a refused sale');
  } finally { f.restore(); }
});

test('stripe: an excluded country is refused on a worldwide-except title', async () => {
  const f = stubFetch({ title: NOT_IN_NA_TITLE });
  try {
    const res = await stripeCheckout(contextFor(stripeBody, 'CA'));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_in_territory');
    assert.equal(f.hitStripe(), false);
  } finally { f.restore(); }
});

test('stripe: a worldwide title is permitted', async () => {
  const f = stubFetch({ title: WORLDWIDE_TITLE });
  try {
    const res = await stripeCheckout(contextFor(stripeBody, 'US'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).url, 'https://checkout.stripe.com/stub');
    assert.equal(f.hitStripe(), true);
  } finally { f.restore(); }
});

test('stripe: a restricted title is permitted from INSIDE its licence', async () => {
  for (const [title, country] of [[UK_ONLY_TITLE, 'GB'], [UK_ONLY_TITLE, 'IE'], [NOT_IN_NA_TITLE, 'GB']]) {
    const f = stubFetch({ title });
    try {
      const res = await stripeCheckout(contextFor(stripeBody, country));
      assert.equal(res.status, 200, `${title.slug} must sell in ${country}`);
      assert.equal(f.hitStripe(), true);
    } finally { f.restore(); }
  }
});

test('stripe: an UNDETERMINED country is refused for a restricted title and served for a worldwide one', async () => {
  // The asymmetry, at the till. `country: null` omits request.cf entirely, which is what a Tor
  // exit node and a local harness both look like.
  const restricted = stubFetch({ title: UK_ONLY_TITLE });
  try {
    const res = await stripeCheckout(contextFor(stripeBody, null));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_in_territory');
    assert.equal(restricted.hitStripe(), false);
  } finally { restricted.restore(); }

  const worldwide = stubFetch({ title: WORLDWIDE_TITLE });
  try {
    const res = await stripeCheckout(contextFor(stripeBody, null));
    assert.equal(res.status, 200, 'nearly the whole catalogue must be unaffected by an unreadable geography');
  } finally { worldwide.restore(); }
});

test('stripe: a client-supplied country is IGNORED — the edge is the only source', async () => {
  const f = stubFetch({ title: UK_ONLY_TITLE });
  try {
    // A caller claiming to be in Britain, from America. The body is not a licence.
    const res = await stripeCheckout(contextFor({ ...stripeBody, country: 'GB' }, 'US'));
    assert.equal(res.status, 403);
    assert.equal(f.hitStripe(), false);
  } finally { f.restore(); }
});

test('stripe: territory outranks price — a restricted, unpriced title fails as a LICENCE', async () => {
  // Precedence, server-side. 409 "no price in that currency" would send the reader off to try
  // another currency, and no currency can buy them this book.
  const f = stubFetch({ title: { ...UK_ONLY_TITLE, prices: {} } });
  try {
    const res = await stripeCheckout(contextFor(stripeBody, 'US'));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_in_territory');
  } finally { f.restore(); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE PAYSTACK RAIL — the same licence, or it is no licence at all
// ═══════════════════════════════════════════════════════════════════════════════

test('paystack: an allow-listed title is REFUSED outside its territories, and nothing is created', async () => {
  const f = stubFetch({ title: UK_ONLY_TITLE });
  try {
    const res = await paystackCheckout(contextFor(paystackBody, 'US'));
    assert.equal(res.status, 403);
    const payload = await res.json();
    assert.equal(payload.code, 'not_in_territory');
    assert.equal(JSON.stringify(payload).includes('US'), false);
    assert.equal(f.hitPaystack(), false, 'NO Paystack transaction may be initialised for a refused sale');
  } finally { f.restore(); }
});

test('paystack: an excluded country is refused on a worldwide-except title', async () => {
  const f = stubFetch({ title: { ...NOT_IN_NA_TITLE, territoriesExcluded: ['NG'] } });
  try {
    const res = await paystackCheckout(contextFor(paystackBody, 'NG'));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_in_territory');
    assert.equal(f.hitPaystack(), false);
  } finally { f.restore(); }
});

test('paystack: a worldwide title is permitted', async () => {
  const f = stubFetch({ title: WORLDWIDE_TITLE });
  try {
    const res = await paystackCheckout(contextFor(paystackBody, 'NG'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).url, 'https://checkout.paystack.com/stub');
    assert.equal(f.hitPaystack(), true);
  } finally { f.restore(); }
});

test('paystack: a restricted title is permitted from inside its licence', async () => {
  const f = stubFetch({ title: { ...WORLDWIDE_TITLE, territoriesAllowed: ['NG', 'GB'] } });
  try {
    const res = await paystackCheckout(contextFor(paystackBody, 'NG'));
    assert.equal(res.status, 200);
    assert.equal(f.hitPaystack(), true);
  } finally { f.restore(); }
});

test('paystack: an undetermined country is refused for a restricted title', async () => {
  const f = stubFetch({ title: UK_ONLY_TITLE });
  try {
    const res = await paystackCheckout(contextFor(paystackBody, null));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_in_territory');
    assert.equal(f.hitPaystack(), false);
  } finally { f.restore(); }
});

test('paystack: territory outranks price — refused BEFORE not_priced_in_ngn', async () => {
  const f = stubFetch({ title: { ...UK_ONLY_TITLE, prices: { gbp: 199 } } });
  try {
    const res = await paystackCheckout(contextFor(paystackBody, 'US'));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_in_territory');
  } finally { f.restore(); }
});

test('both rails answer identically for the same licence and the same country', async () => {
  // A book sellable on one rail and not the other is not a licence, it is a bug with two
  // implementations. Asserted as a property rather than as two hand-written expectations.
  for (const [title, country, expected] of [
    [WORLDWIDE_TITLE, 'US', 200],
    [UK_ONLY_TITLE, 'GB', 200],
    [UK_ONLY_TITLE, 'US', 403],
    [UK_ONLY_TITLE, null, 403],
    [NOT_IN_NA_TITLE, 'US', 403],
    [NOT_IN_NA_TITLE, 'NG', 200],
  ]) {
    const a = stubFetch({ title });
    let stripeStatus;
    try { stripeStatus = (await stripeCheckout(contextFor(stripeBody, country))).status; } finally { a.restore(); }

    const b = stubFetch({ title });
    let paystackStatus;
    try { paystackStatus = (await paystackCheckout(contextFor(paystackBody, country))).status; } finally { b.restore(); }

    assert.equal(stripeStatus, expected, `stripe ${title.slug} from ${country}`);
    assert.equal(paystackStatus, expected, `paystack ${title.slug} from ${country}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM — DELIBERATELY UNENFORCED
// ═══════════════════════════════════════════════════════════════════════════════

// A real RSA key, generated per run rather than committed: stream.js signs a GCS URL for real,
// and stubbing the signature would mean stubbing the code path this test exists to walk.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const STREAM_ENV = {
  ...ENV,
  FIREBASE_CLIENT_EMAIL: 'stub@calvary.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
};

test('stream: OWNERSHIP SURVIVES TRAVEL — a purchased title still opens outside its territories', async () => {
  // THE POINT OF THIS TEST, and the reason it is written as an assertion rather than as a
  // comment in stream.js:
  //
  // A territory restriction governs the SALE — where a publisher may offer the book — not the
  // copy. A reader who buys in London and opens the book on a plane, on holiday, or after
  // emigrating owns the same book they owned at the till. A shop that took their money and
  // then locked the file because they crossed a border has sold them something and taken it
  // away, which is not licence enforcement; it is a broken product.
  //
  // So this asserts a NON-feature. If someone ever adds a territory check to stream.js — by
  // symmetry with the checkout endpoints, which is the tempting and wrong move — this test
  // goes red and says why.
  const f = stubFetch({
    title: UK_ONLY_TITLE,
    purchase: { status: 'active', titleId: 'a-title', purchaseDate: 1750000000000 },
  });
  try {
    // Bought when they lived in Britain; opening it from Japan, which the licence never covered.
    const res = await stream(contextFor({ idToken: ID_TOKEN, titleId: 'a-title' }, 'JP', STREAM_ENV));
    assert.equal(res.status, 200, 'a paid-for book must open wherever its reader is');
    const payload = await res.json();
    assert.ok(payload.url.startsWith('https://storage.googleapis.com/'), 'a signed URL, not a refusal');
    assert.ok(payload.expiresAt > 0);
  } finally { f.restore(); }
});

test('stream: an undetermined country does not withhold a purchased book either', async () => {
  const f = stubFetch({
    title: UK_ONLY_TITLE,
    purchase: { status: 'active', titleId: 'a-title' },
  });
  try {
    const res = await stream(contextFor({ idToken: ID_TOKEN, titleId: 'a-title' }, null, STREAM_ENV));
    assert.equal(res.status, 200);
  } finally { f.restore(); }
});

test('stream: the checks it DOES make are untouched by R8.4', async () => {
  // The guard against the opposite failure: proving stream.js ignores geography must not have
  // quietly proved it ignores everything.
  const notPurchased = stubFetch({ title: WORLDWIDE_TITLE, purchase: null });
  try {
    const res = await stream(contextFor({ idToken: ID_TOKEN, titleId: 'a-title' }, 'GB', STREAM_ENV));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_purchased');
  } finally { notPurchased.restore(); }

  const revoked = stubFetch({ title: WORLDWIDE_TITLE, purchase: { status: 'revoked', revokedReason: 'refund' } });
  try {
    const res = await stream(contextFor({ idToken: ID_TOKEN, titleId: 'a-title' }, 'GB', STREAM_ENV));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'revoked');
  } finally { revoked.restore(); }
});
