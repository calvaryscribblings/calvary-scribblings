// The R8.2 naira rail, as executable assertions.
//
//   node --test tests/bookstore/paystack.test.mjs      (npm run test:paystack)
//
// HOST-INDEPENDENT AND OFFLINE. Nothing here talks to Paystack, Firebase or Cloudflare — it
// imports the pure halves of the two endpoints directly and asserts them. That is deliberate:
// the parts of a payment rail that are cheapest to get wrong (a SHA-256 where SHA-512 was
// meant, a guard that resurrects a revoked purchase, a reference that cannot be parsed back)
// are all decidable without a network, and a test that needs test-mode keys is a test nobody
// runs.
//
// The endpoint modules are .js under functions/, and the repo has no "type": "module" — they
// load because Node ≥22.12 detects unambiguous ESM syntax. Same mechanism the newsletter
// suite already relies on for app/lib/*.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  buildPaystackReference,
  parsePaystackReference,
  buildGrantPayload,
  buildRevokePayload,
  denormalisedFields,
  hexToBytes,
  timingSafeEqual,
} from '../../functions/api/bookstore/_lib.js';

// The replay/repurchase guard is shared by both rails and specified in its own file,
// tests/bookstore/purchase-guard.test.mjs.
import {
  verifyPaystackSignature,
  extractReference,
  extractIdentity,
} from '../../functions/api/bookstore/paystack-webhook.js';

import { selectNgnAmount } from '../../functions/api/bookstore/paystack-checkout.js';

const UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const TITLE_ID = 'the-fire-in-the-flint';
const SECRET = 'sk_test_deadbeefcafe0123456789';

// The scheme, independently implemented from node:crypto so the test is not simply the
// endpoint's own arithmetic played back at it.
const sign = (body, secret = SECRET) =>
  createHmac('sha512', secret).update(body, 'utf8').digest('hex');

// ── Signature verification ───────────────────────────────────────────────────

test('signature: a correctly signed body is accepted', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'cs.a.b.0123abcd' } });
  const res = await verifyPaystackSignature(body, sign(body), SECRET);
  assert.equal(res.ok, true);
});

test('signature: SHA-512, not SHA-256 — a SHA-256 digest is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: {} });
  const sha256 = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
  const res = await verifyPaystackSignature(body, sha256, SECRET);
  assert.equal(res.ok, false);
});

test('signature: a tampered body is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: { amount: 450000 } });
  const signature = sign(body);
  const tampered = JSON.stringify({ event: 'charge.success', data: { amount: 1 } });
  const res = await verifyPaystackSignature(tampered, signature, SECRET);
  assert.equal(res.ok, false);
  assert.match(res.reason, /mismatch/);
});

test('signature: the wrong secret is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: {} });
  const res = await verifyPaystackSignature(body, sign(body, 'sk_test_someone_elses_key'), SECRET);
  assert.equal(res.ok, false);
});

test('signature: a missing or malformed header is rejected, not thrown', async () => {
  const body = '{}';
  assert.equal((await verifyPaystackSignature(body, null, SECRET)).ok, false);
  assert.equal((await verifyPaystackSignature(body, '', SECRET)).ok, false);
  assert.equal((await verifyPaystackSignature(body, 'not-hex-at-all', SECRET)).ok, false);
  assert.equal((await verifyPaystackSignature(body, 'abc', SECRET)).ok, false); // odd length
});

test('signature: verification is over the RAW body, not a re-serialisation', async () => {
  // Same object, different key order and whitespace — Paystack signed one exact string.
  const asSent = '{"event":"charge.success","data":{"reference":"cs.a.b.0123abcd","amount":450000}}';
  const signature = sign(asSent);
  const reserialised = JSON.stringify(JSON.parse(asSent));
  assert.equal((await verifyPaystackSignature(asSent, signature, SECRET)).ok, true);

  const roundTripped = JSON.stringify({ data: JSON.parse(asSent).data, event: 'charge.success' });
  assert.notEqual(roundTripped, asSent);
  assert.equal((await verifyPaystackSignature(roundTripped, signature, SECRET)).ok, false);
  // Guard the premise: if JSON.stringify ever became order-preserving this test would be void.
  assert.equal(reserialised, asSent);
});

test('hex + constant-time compare behave', () => {
  assert.equal(hexToBytes('zz'), null);
  assert.equal(hexToBytes('abc'), null);
  assert.deepEqual([...hexToBytes('00ff10')], [0, 255, 16]);
  assert.equal(timingSafeEqual(hexToBytes('00ff'), hexToBytes('00ff')), true);
  assert.equal(timingSafeEqual(hexToBytes('00ff'), hexToBytes('00fe')), false);
  assert.equal(timingSafeEqual(hexToBytes('00ff'), hexToBytes('00ffaa')), false);
  assert.equal(timingSafeEqual(null, null), false);
});

// ── The reference format ─────────────────────────────────────────────────────

test('reference: round-trips uid and titleId', () => {
  const ref = buildPaystackReference(UID, TITLE_ID, 'a1b2c3d4e5f6');
  assert.equal(ref, `cs.${UID}.${TITLE_ID}.a1b2c3d4e5f6`);
  assert.deepEqual(parsePaystackReference(ref), {
    uid: UID,
    titleId: TITLE_ID,
    nonce: 'a1b2c3d4e5f6',
  });
});

test('reference: hyphenated slugs survive — the separator is "."', () => {
  const parsed = parsePaystackReference(buildPaystackReference(UID, 'a-b-c-d-e', 'aabbccddeeff'));
  assert.equal(parsed.titleId, 'a-b-c-d-e');
});

test('reference: an auto-generated nonce is present and distinct per call', () => {
  const a = buildPaystackReference(UID, TITLE_ID);
  const b = buildPaystackReference(UID, TITLE_ID);
  assert.notEqual(a, b, 'a repeat purchase must not collide with the first');
  assert.equal(parsePaystackReference(a).titleId, TITLE_ID);
  assert.match(parsePaystackReference(a).nonce, /^[a-f0-9]{12}$/);
});

test('reference: foreign and malformed references are rejected, not misparsed', () => {
  assert.equal(parsePaystackReference('T123456789'), null);          // a Paystack-minted ref
  assert.equal(parsePaystackReference(''), null);
  assert.equal(parsePaystackReference(null), null);
  assert.equal(parsePaystackReference(`cs.${UID}.${TITLE_ID}`), null); // no nonce
  assert.equal(parsePaystackReference(`xx.${UID}.${TITLE_ID}.abcd1234`), null);
  assert.equal(parsePaystackReference(`cs.${UID}.bad_slug.abcd1234`), null);
});

test('reference: unsafe ids are refused at build time, before money moves', () => {
  assert.throws(() => buildPaystackReference('uid.with.dots', TITLE_ID), /uid/);
  assert.throws(() => buildPaystackReference(UID, 'has_underscore'), /titleId/);
  assert.throws(() => buildPaystackReference(UID, 'has.dot'), /titleId/);
  assert.throws(() => buildPaystackReference('', TITLE_ID), /uid/);
});

// ── Identity extraction ──────────────────────────────────────────────────────

test('identity: read from the reference, on every payload shape', () => {
  const ref = buildPaystackReference(UID, TITLE_ID, 'aabbccddeeff');
  assert.deepEqual(extractIdentity({ reference: ref }), { uid: UID, titleId: TITLE_ID });
  assert.deepEqual(extractIdentity({ transaction: { reference: ref } }), { uid: UID, titleId: TITLE_ID });
  assert.deepEqual(extractIdentity({ transaction_reference: ref }), { uid: UID, titleId: TITLE_ID });
  assert.equal(extractReference({ transaction: { reference: ref } }), ref);
});

test('identity: metadata is the fallback when the reference will not parse', () => {
  assert.deepEqual(
    extractIdentity({ reference: 'T-paystack-minted', metadata: { uid: UID, titleId: TITLE_ID } }),
    { uid: UID, titleId: TITLE_ID },
  );
  assert.deepEqual(extractIdentity({ reference: 'T-nope' }), { uid: null, titleId: null });
  assert.deepEqual(extractIdentity({}), { uid: null, titleId: null });
});

// ── The grant payload, both rails ────────────────────────────────────────────

const FIELDS = denormalisedFields({
  slug: 'the-fire-in-the-flint',
  title: 'The Fire in the Flint',
  author: 'A Scribbler',
  coverUrl: 'https://example.test/c.jpg',
  prices: { ngn: 450000 },
});

test('grant payload: the naira rail', () => {
  const ref = buildPaystackReference(UID, TITLE_ID, 'aabbccddeeff');
  const p = buildGrantPayload({
    amount: 450000,
    currency: 'NGN',
    refField: 'paystackRef',
    refValue: ref,
    fields: FIELDS,
  });

  assert.equal(p.status, 'active');
  assert.equal(p.amount, 450000);
  assert.equal(p.currency, 'NGN');
  assert.equal(p.paystackRef, ref);
  assert.equal(p.stripeSessionId, undefined, 'the naira rail must not fabricate a Stripe id');
  assert.equal(typeof p.purchasedAt, 'number');
  // The four denormalised fields My Library renders a shelf from.
  assert.equal(p.slug, 'the-fire-in-the-flint');
  assert.equal(p.title, 'The Fire in the Flint');
  assert.equal(p.author, 'A Scribbler');
  assert.equal(p.coverUrl, 'https://example.test/c.jpg');
  assert.equal(p.prices, undefined, 'only the four display fields are denormalised');
  // R9.1 — every grant clears the refund stamps, on BOTH rails. See the note in
  // functions/api/bookstore/_lib.js: a null in an RTDB PATCH deletes the child, and a
  // repurchase that inherited revokedReason:'refunded' is what this ends.
  assert.equal(p.revokedAt, null, 'a grant clears any refund stamp underneath it');
  assert.equal(p.revokedReason, null, 'a grant clears any refund stamp underneath it');
});

// ⚠ R9.1 — THIS TEST IS A CLOSED KEY SET, WHICH IS WHY IT REDDENED AND WHY IT SHOULD HAVE.
//
// It pins the EXACT shape of a Stripe grant, so adding `revokedAt: null, revokedReason: null`
// to buildGrantPayload() broke it — correctly. A payload written into a live money record is
// the one place a new key must be noticed rather than absorbed, and a deepEqual on the sorted
// keys is the cheapest guard that notices. Keep the list closed; widen it deliberately.
test('grant payload: the Stripe rail, and the two refund stamps every grant clears', () => {
  const p = buildGrantPayload({
    amount: 199,
    currency: 'gbp',
    refField: 'stripeSessionId',
    refValue: 'cs_test_123',
    fields: FIELDS,
  });
  assert.deepEqual(Object.keys(p).sort(), [
    'amount', 'author', 'compGrant', 'compGrantedAt', 'coverUrl', 'currency', 'freeRef', 'purchasedAt',
    'rail', 'revokedAt', 'revokedReason', 'slug', 'source', 'status', 'stripeSessionId', 'title',
  ]);
  // FREE-TITLES: a purchase clears the free-copy markers too, so buying over a free copy is a sale.
  assert.equal(p.freeRef, null);
  assert.equal(p.rail, null);
  // W3b: a purchase clears the comp markers (null deletes), so buying over a comp is a sale.
  assert.equal(p.source, null);
  // Present AND null, not absent — the two are the same fact on read but opposite acts on a
  // PATCH: absent leaves the old stamp standing, null deletes it. That difference is the fix.
  assert.equal(p.revokedAt, null);
  assert.equal(p.revokedReason, null);
  assert.equal(p.stripeSessionId, 'cs_test_123');
  assert.equal(p.paystackRef, undefined);
  assert.equal(p.currency, 'gbp');
});

test('grant payload: absent amount/currency/fields degrade to null, never to undefined keys', () => {
  const p = buildGrantPayload({ refField: 'paystackRef', refValue: 'cs.a.b.0123abcd' });
  assert.equal(p.amount, null);
  assert.equal(p.currency, null);
  assert.equal(p.status, 'active');
  assert.equal(denormalisedFields(null), null);
});

test('revoke payload', () => {
  const p = buildRevokePayload('refunded');
  assert.equal(p.status, 'revoked');
  assert.equal(p.revokedReason, 'refunded');
  assert.equal(typeof p.revokedAt, 'number');
});

// ── Pricing ──────────────────────────────────────────────────────────────────

test('price: a stored kobo amount is used verbatim — no conversion', () => {
  assert.deepEqual(selectNgnAmount({ prices: { ngn: 450000, gbp: 499, usd: 649 } }), {
    ok: true,
    amount: 450000,
  });
});

test('price: no NGN price yields the 409 not_priced_in_ngn contract', () => {
  // This is the live shape of every published title as of R8.2 — GBP only.
  const res = selectNgnAmount({ prices: { gbp: 199 } });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.code, 'not_priced_in_ngn');
  assert.match(res.error, /naira/i);
});

test('price: a GBP price is never converted into a naira one', () => {
  const gbpOnly = { prices: { gbp: 199 } };
  const res = selectNgnAmount(gbpOnly);
  assert.equal(res.ok, false);
  assert.equal(res.amount, undefined, 'no FX rate may appear anywhere on this rail');
});

test('price: junk NGN values are refused rather than charged', () => {
  for (const ngn of [-1, 1.5, '450000', null, undefined, NaN, Infinity]) {
    const res = selectNgnAmount({ prices: { ngn } });
    assert.equal(res.ok, false, `prices.ngn = ${String(ngn)} must not be chargeable`);
    assert.equal(res.code, 'not_priced_in_ngn');
  }
  // FREE-TITLES: 0 is not junk, it is FREE — still not chargeable, but refused as free_title,
  // pointing at the claim, rather than as "buy it in pounds instead".
  const free = selectNgnAmount({ prices: { ngn: 0 } });
  assert.equal(free.ok, false);
  assert.equal(free.code, 'free_title');
  assert.equal(selectNgnAmount({}).ok, false);
  assert.equal(selectNgnAmount(null).ok, false);
});

// ── SHOP-2 §2: the paperback shop's events are not ours ─────────────────────────────────────
// The paperback shop (books.calvaryscribblings.co.uk, its own Worker) takes its money through the
// same Paystack account, so its events arrive here signed with our key. Its transaction references
// start "shop-"; an event with no reference is the shop's when its metadata.order starts "CS-".
// After the signature check and the body parse, before any routing, write or email, such an event
// is answered 200 {received:true, ignored:'shop'} and nothing else happens: no fetch (so no read,
// no write, no money_failures record, no email) and nothing logged.
import { onRequestPost } from '../../functions/api/bookstore/paystack-webhook.js';
import { generateKeyPairSync } from 'node:crypto';

const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const ENV = { PAYSTACK_SECRET_KEY: SECRET, FIREBASE_CLIENT_EMAIL: 'probe@example.invalid', FIREBASE_PRIVATE_KEY: PEM };

/** Deliver one event to the real handler with fetch and the console stubbed; report what it did. */
async function deliver(event, { signature } = {}) {
  const body = JSON.stringify(event);
  const fetches = []; const logged = [];
  const realFetch = globalThis.fetch; const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  globalThis.fetch = async (url) => { fetches.push(String(url)); return new Response('{"error":"offline"}', { status: 503 }); };
  for (const k of Object.keys(real)) console[k] = (...a) => logged.push(a.join(' '));
  try {
    const request = new Request('https://calvaryscribblings.co.uk/api/bookstore/paystack-webhook', {
      method: 'POST', headers: { 'x-paystack-signature': signature ?? sign(body), 'content-type': 'application/json' }, body,
    });
    const res = await onRequestPost({ request, env: ENV, waitUntil: () => {} });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, fetches, logged };
  } finally {
    globalThis.fetch = realFetch; Object.assign(console, real);
  }
}
const SHOP_REF = 'shop-7Q2X9K4M1P';
const assertIgnoredShop = (r) => {
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { received: true, ignored: 'shop' });
  assert.deepEqual(r.fetches, [], 'no read, no write, no email');
  assert.deepEqual(r.logged, [], 'nothing of it logged');
};

test('shop: charge.success with a shop- reference is ignored, even if its metadata names a uid and a title', async () => {
  assertIgnoredShop(await deliver({ event: 'charge.success', data: { reference: SHOP_REF, amount: 650000, currency: 'NGN', metadata: { order: 'CS-10023', uid: UID, titleId: TITLE_ID } } }));
});
test('shop: refund.processed on a shop- transaction is ignored', async () => {
  assertIgnoredShop(await deliver({ event: 'refund.processed', data: { transaction_reference: SHOP_REF, amount: 650000, status: 'processed' } }));
});
test('shop: refund.pending and refund.failed on a shop- transaction are ignored', async () => {
  for (const event of ['refund.pending', 'refund.failed']) assertIgnoredShop(await deliver({ event, data: { transaction_reference: SHOP_REF } }));
});
test('shop: charge.dispute.create on a shop- transaction is ignored', async () => {
  assertIgnoredShop(await deliver({ event: 'charge.dispute.create', data: { transaction: { reference: SHOP_REF, id: 1 }, status: 'awaiting-merchant-feedback' } }));
});
test('shop: dispute.create (the bare spelling) on a shop- transaction is ignored', async () => {
  assertIgnoredShop(await deliver({ event: 'dispute.create', data: { transaction: { reference: SHOP_REF } } }));
});
test('shop: charge.reversed on a shop- transaction is ignored', async () => {
  assertIgnoredShop(await deliver({ event: 'charge.reversed', data: { reference: SHOP_REF } }));
});
test('shop: an event with no reference whose metadata.order starts CS- is ignored (on data or on its transaction)', async () => {
  assertIgnoredShop(await deliver({ event: 'charge.success', data: { metadata: { order: 'CS-10023' } } }));
  assertIgnoredShop(await deliver({ event: 'charge.dispute.create', data: { transaction: { metadata: { order: 'CS-10023' } } } }));
});
test('shop: a shop- reference on a refund whose own reference is something else is still the shop\'s', async () => {
  assertIgnoredShop(await deliver({ event: 'refund.processed', data: { reference: 'rf_1a2b3c', transaction_reference: SHOP_REF } }));
});

// Controls: the Book Store and the signature are untouched.
test('control: a Book Store charge.success still routes to the grant (its first call is the verify for its reference)', async () => {
  const ref = buildPaystackReference(UID, TITLE_ID);
  const r = await deliver({ event: 'charge.success', data: { reference: ref, metadata: { order: 'CS-10023' } } });
  assert.notDeepEqual(r.json, { received: true, ignored: 'shop' });
  assert.ok(r.fetches[0]?.includes(`/transaction/verify/${encodeURIComponent(ref)}`), 'reached handleGrant');
});
test('control: a Book Store refund still routes to the revoke, a membership refund to the membership module', async () => {
  const ref = buildPaystackReference(UID, TITLE_ID);
  const book = await deliver({ event: 'refund.processed', data: { transaction_reference: ref } });
  assert.notDeepEqual(book.json, { received: true, ignored: 'shop' });
  assert.ok(book.fetches.length > 0, 'reached handleRevoke');
  const ms = await deliver({ event: 'refund.processed', data: { transaction_reference: 'ms.abc.def.0123abcd' } });
  assert.notDeepEqual(ms.json, { received: true, ignored: 'shop' });
  assert.ok(ms.fetches.length > 0, 'reached the membership module');
});
test('control: an unrouted event is acknowledged by name as before; "shop" elsewhere in a reference, or CS- with a reference, is not the shop\'s', async () => {
  const r = await deliver({ event: 'transfer.success', data: { reference: 'tr_123' } });
  assert.deepEqual(r.json, { received: true, ignored: 'transfer.success' });
  const mid = await deliver({ event: 'charge.success', data: { reference: 'cs.shop-x.y.0123abcd' } });
  assert.notDeepEqual(mid.json, { received: true, ignored: 'shop' });
  const withRef = await deliver({ event: 'charge.success', data: { reference: buildPaystackReference(UID, TITLE_ID), metadata: { order: 'CS-1' } } });
  assert.notDeepEqual(withRef.json, { received: true, ignored: 'shop' });
});
test('control: a shop event with a bad signature is still refused, 400, before anything else', async () => {
  const r = await deliver({ event: 'charge.success', data: { reference: SHOP_REF } }, { signature: 'ab'.repeat(64) });
  assert.equal(r.status, 400);
  assert.match(r.text, /Invalid signature/);
  assert.deepEqual(r.fetches, []);
});
