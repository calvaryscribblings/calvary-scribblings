// R9.2 PL-3 + PL-14 — THE TWO GUARDS ON THE STRIPE WEBHOOK.
//
//   node --test tests/bookstore/stripe-guards.test.mjs      (npm run test:purchases)
//
// PL-3 · THE GRANT NEVER LOOKED AT WHETHER THE MONEY ARRIVED.
// handleGrant routed on event type alone. For a card that is correct — Stripe sets
// payment_status 'paid' before it sends checkout.session.completed — so this was invisible
// and would have stayed invisible until the first customer paid by bank debit. For every
// delayed-payment method the SAME event fires with payment_status 'unpaid', days before the
// money moves, and the book was granted on it. That the file already mapped
// checkout.session.async_payment_failed to a revocation is the proof the async case was
// anticipated; the grant simply landed first.
//
// PL-14 · THE REPLAY WINDOW WAS SYMMETRIC.
// `Math.abs(now - t)` made a 300-second tolerance mean "300 seconds either side", so a body
// dated five minutes in the future verified. The signature still has to check out, so this
// only ever mattered to an attacker already holding a valid signed body — but it handed that
// attacker ten minutes of validity where Stripe's own guidance gives five.
//
// Both are asserted END TO END through onRequestPost, not against an extracted helper: the
// bug in each case was in the wiring, and a unit test of the pure part would have passed
// while the endpoint stayed wrong. Offline; nothing here reaches the network.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  onRequestPost as stripeWebhook,
  isPaidSession,
} from '../../functions/api/bookstore/stripe-webhook.js';

const UID = 'AAAAowner0000000000000000001';
const TITLE = 'the-rescue';

const ENV = {
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  FIREBASE_CLIENT_EMAIL: 'sa@example.iam.gserviceaccount.com',
  // A real key: mintAccessToken signs the assertion with Web Crypto before it calls the
  // token endpoint, so a placeholder PEM throws before the code under test is reached.
  // Generated per run, authorises nothing, never leaves the process.
  FIREBASE_PRIVATE_KEY: generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey,
};

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Records url + method + parsed body for every outbound call, and answers the happy path:
 * a minted admin token, no existing purchase, a catalogue record, and an accepted PATCH.
 * A grant is therefore visible as a write, and its ABSENCE is what every PL-3 refusal
 * asserts.
 *
 * ⚠ R14 CHANGED THE SHAPE OF THE GRANT WRITE, and this stub caught it — four tests here went
 * red the moment the write moved, which is what a harness is for. The grant used to be a
 * PATCH to `…/bookstore_purchases/{uid}/{titleId}.json`. It is now ONE multi-path PATCH at
 * the database root carrying the purchase's fields AND the readership counter's delta, so
 * that a grant and the public count it produces cannot exist without each other. The URL no
 * longer names the node; the BODY's keys do.
 *
 * grantWrite() below is updated to match, and deliberately still recognises a grant by the
 * purchase path rather than by "a PATCH happened" — a write that touched only the counter
 * would not be a grant, and must not read as one.
 */
function stubFetch() {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    let body = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ url, method: init.method || 'GET', body });

    if (url.includes('oauth2.googleapis.com')) return jsonResponse({ access_token: 'ya29.test' });
    if (url.includes('bookstore_titles')) {
      return jsonResponse({ slug: TITLE, title: 'The Rescue', author: 'A. Writer', coverUrl: null });
    }
    // The idempotency read, still a GET at the record's own URL.
    if (url.includes('bookstore_purchases')) return jsonResponse(null);
    // R14 — the atomic write: a PATCH at the database root, keys naming the paths.
    if ((init.method || 'GET') === 'PATCH' && /\/\.json(\?|$)/.test(url)) return jsonResponse({ ok: true });
    return jsonResponse({}, 404);
  };
  return calls;
}

/** The purchase half of the atomic write, keyed off the body rather than the URL. */
const grantWrite = (calls) => {
  const c = calls.find((x) => x.method === 'PATCH' && x.body
    && Object.keys(x.body).some((k) => k.startsWith(`bookstore_purchases/${UID}/${TITLE}/`)));
  if (!c) return undefined;
  // Re-present it in the shape the assertions below already expect: the record's fields.
  const record = {};
  for (const [k, v] of Object.entries(c.body)) {
    const prefix = `bookstore_purchases/${UID}/${TITLE}/`;
    if (k.startsWith(prefix)) record[k.slice(prefix.length)] = v;
  }
  return { ...c, body: record };
};

/** The counter half of the same write, if it moved. */
const readershipWrite = (calls) => {
  const c = calls.find((x) => x.method === 'PATCH' && x.body && Object.keys(x.body).some((k) => k.startsWith('bookstore_readership/')));
  if (!c) return undefined;
  const key = Object.keys(c.body).find((k) => k.startsWith('bookstore_readership/'));
  return { key, value: c.body[key] };
};

// The signature the endpoint will accept, dated `t` (default: now).
async function stripeSigned(body, secret, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

async function deliver(event, { at } = {}) {
  const body = JSON.stringify(event);
  return stripeWebhook({
    request: new Request('https://x/api/bookstore/stripe-webhook', {
      method: 'POST',
      body,
      headers: { 'Stripe-Signature': await stripeSigned(body, ENV.STRIPE_WEBHOOK_SECRET, at) },
    }),
    env: ENV,
  });
}

const session = (overrides = {}) => ({
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_pl3',
      client_reference_id: UID,
      metadata: { uid: UID, titleId: TITLE },
      payment_intent: 'pi_test_pl3',
      amount_total: 199,
      currency: 'gbp',
      payment_status: 'paid',
      ...overrides.object,
    },
  },
  ...(overrides.type ? { type: overrides.type } : {}),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PL-3 — payment_status decides, not event type.
// ═══════════════════════════════════════════════════════════════════════════════

describe('PL-3 · the grant waits for the money', () => {
  test('isPaidSession: paid and no_payment_required grant; everything else does not', () => {
    assert.equal(isPaidSession({ payment_status: 'paid' }), true);
    // A 100%-off coupon or a comp. There is no money to wait for and the session is
    // legitimately complete — refusing it would be a free copy that never arrives.
    assert.equal(isPaidSession({ payment_status: 'no_payment_required' }), true);

    assert.equal(isPaidSession({ payment_status: 'unpaid' }), false);
    assert.equal(isPaidSession({}), false, 'a missing field is not a paid one');
    assert.equal(isPaidSession(null), false);
    assert.equal(isPaidSession(undefined), false);
    assert.equal(isPaidSession({ payment_status: 'PAID' }), false, 'no case folding — Stripe sends lower case');
    assert.equal(isPaidSession({ payment_status: true }), false);
  });

  test('a paid session still grants — the guard changes nothing for a card', async () => {
    const calls = stubFetch();
    const res = await deliver(session());

    assert.equal(res.status, 200);
    const write = grantWrite(calls);
    assert.ok(write, 'the ordinary card purchase must still be recorded');
    assert.equal(write.body.status, 'active');
    assert.equal(write.body.stripeSessionId, 'cs_test_pl3');
    assert.equal(write.body.stripePaymentIntent, 'pi_test_pl3');
  });

  test('THE FINDING: an unpaid session grants nothing', async () => {
    const calls = stubFetch();
    const res = await deliver(session({ object: { payment_status: 'unpaid' } }));

    // Still a 200: the signature verified, so the event is acknowledged and Stripe must not
    // redeliver it. The book simply is not handed over.
    assert.equal(res.status, 200);
    assert.equal(grantWrite(calls), undefined, 'no book may be granted before the money moves');
    // And it costs nothing to refuse: the guard sits in front of the token mint.
    assert.equal(calls.length, 0, 'an unpaid session must not even mint an admin token');
  });

  test('a session with no payment_status at all grants nothing', async () => {
    const calls = stubFetch();
    const ev = session();
    delete ev.data.object.payment_status;
    const res = await deliver(ev);

    assert.equal(res.status, 200);
    assert.equal(grantWrite(calls), undefined, 'unknown is not paid');
  });

  test('a zero-amount session (no_payment_required) does grant', async () => {
    const calls = stubFetch();
    const res = await deliver(session({ object: { payment_status: 'no_payment_required', amount_total: 0 } }));

    assert.equal(res.status, 200);
    assert.ok(grantWrite(calls), 'a comp or a 100%-off coupon is a real entitlement');
  });

  test('async_payment_succeeded is the event that grants a delayed payment', async () => {
    const calls = stubFetch();
    const res = await deliver(session({
      type: 'checkout.session.async_payment_succeeded',
      object: { payment_status: 'paid' },
    }));

    assert.equal(res.status, 200);
    const write = grantWrite(calls);
    assert.ok(write, 'without this the delayed rail would never grant at all after PL-3');
    // THE LOAD-BEARING PART. Both grant events carry the same Session id, so the stored
    // reference is the same either way and the LB-7 revoke matching still resolves.
    assert.equal(write.body.stripeSessionId, 'cs_test_pl3');
  });

  test('the whole delayed-payment sequence: unpaid grants nothing, then succeeded grants once', async () => {
    const calls = stubFetch();
    await deliver(session({ object: { payment_status: 'unpaid' } }));
    assert.equal(grantWrite(calls), undefined);

    await deliver(session({
      type: 'checkout.session.async_payment_succeeded',
      object: { payment_status: 'paid' },
    }));
    // R14 — counted off the BODY, not the URL: the write is a root fan-out now.
    const writes = calls.filter((c) => c.method === 'PATCH' && c.body
      && Object.keys(c.body).some((k) => k.startsWith('bookstore_purchases/')));
    assert.equal(writes.length, 1, 'exactly one grant across the pair');
    // …and exactly one readership increment, on the event that actually granted.
    const counter = readershipWrite(calls);
    assert.deepEqual(counter, { key: `bookstore_readership/${TITLE}/count`, value: { '.sv': { increment: 1 } } },
      'the delayed payment must move the public count once, on the succeeded event');
  });

  test('a failed delayed payment revokes nothing and is not an error', async () => {
    const calls = stubFetch();
    const res = await deliver(session({
      type: 'checkout.session.async_payment_failed',
      object: { payment_status: 'unpaid' },
    }));

    assert.equal(res.status, 200);
    const writes = calls.filter((c) => c.method === 'PATCH' && c.body
      && Object.keys(c.body).some((k) => k.startsWith('bookstore_purchases/')));
    assert.equal(writes.length, 0, 'there was never a purchase to revoke');
    assert.equal(readershipWrite(calls), undefined, 'and nothing to decrement');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PL-14 — the replay window is one-sided again.
// ═══════════════════════════════════════════════════════════════════════════════

describe('PL-14 · the signature window has a front and a back', () => {
  const now = () => Math.floor(Date.now() / 1000);

  test('a current timestamp verifies', async () => {
    stubFetch();
    const res = await deliver(session(), { at: now() - 5 });
    assert.equal(res.status, 200);
  });

  test('a body older than the tolerance is rejected as too old', async () => {
    stubFetch();
    const res = await deliver(session(), { at: now() - 3600 });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /too old/i);
  });

  test('THE FINDING: a body dated in the future is rejected', async () => {
    stubFetch();
    const res = await deliver(session(), { at: now() + 3600 });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /future/i);
  });

  test('THE REGRESSION: +290s verified under Math.abs and must not now', async () => {
    // Inside the old symmetric ±300 window, outside the new one. This single case is the
    // whole of PL-14: if Math.abs ever comes back, only this test goes red.
    stubFetch();
    const res = await deliver(session(), { at: now() + 290 });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /future/i);
  });

  test('a few seconds of clock skew is still accepted', async () => {
    // Cloudflare's edge and Stripe's clock differ by seconds, never minutes. Rejecting every
    // negative age would turn ordinary skew into a dropped purchase.
    stubFetch();
    const res = await deliver(session(), { at: now() + 10 });
    assert.equal(res.status, 200);
  });

  test('a forged timestamp cannot buy validity — the HMAC covers it', async () => {
    // Re-dating a captured body to slide it inside the window breaks the signature, because
    // the signed payload is `${t}.${body}`. Belt and braces on the bound above.
    stubFetch();
    const body = JSON.stringify(session());
    const honest = await stripeSigned(body, ENV.STRIPE_WEBHOOK_SECRET, now() - 3600);
    const redated = honest.replace(/^t=\d+/, `t=${now()}`);
    const res = await stripeWebhook({
      request: new Request('https://x/api/bookstore/stripe-webhook', {
        method: 'POST', body, headers: { 'Stripe-Signature': redated },
      }),
      env: ENV,
    });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /no v1 signature matched/i);
  });
});
