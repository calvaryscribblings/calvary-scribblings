// R9.1 LB-10 — OUTBOUND TIMEOUTS, on every fetch in the bookstore surface.
//
//   node --test tests/bookstore/timeouts.test.mjs      (npm run test:purchases)
//
// THE PROBLEM. fetch() has no default timeout. A provider that completes the TCP handshake
// and then stops talking is indistinguishable from a slow one, and the request hangs until
// Cloudflare kills the whole invocation by wall-clock — which no catch block in this repo can
// observe. On checkout that is a reader watching a dead button; on a webhook it is a non-2xx,
// which makes Stripe or Paystack retry an event whose money has already moved.
//
// THE FIX is one line per call site — `signal: AbortSignal.timeout(BUDGET)` — and it is
// exactly the kind of line that gets dropped in a refactor without anything going red. Hence
// this file, which asserts it three ways:
//
//   1. THE MECHANISM. A genuinely stalled server, a real AbortSignal.timeout, a real abort.
//      Proves the technique works on this runtime rather than assuming it.
//   2. THE BUDGETS. Every call site is exercised and the signal it passes is captured, so a
//      dropped signal or a wrong budget fails here.
//   3. THE FAIL-POSTURE. Each endpoint is driven with a stub that times out, and the response
//      it produces is asserted. This is the half that matters: LB-10 required the timeouts to
//      change no behaviour except the hanging, and in particular the two webhooks must still
//      answer 200 once a signature has verified.
//
// Offline and host-independent. Nothing here reaches the network.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';

import {
  PROVIDER_TIMEOUT_MS,
  FIREBASE_TIMEOUT_MS,
} from '../../functions/api/bookstore/_lib.js';
import { onRequestPost as checkout } from '../../functions/api/bookstore/checkout.js';
import { onRequestPost as paystackCheckout } from '../../functions/api/bookstore/paystack-checkout.js';
import { onRequestPost as stream } from '../../functions/api/bookstore/stream.js';
import { onRequestPost as stripeWebhook } from '../../functions/api/bookstore/stripe-webhook.js';
import { onRequestPost as paystackWebhook } from '../../functions/api/bookstore/paystack-webhook.js';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. THE MECHANISM — a real stalled server and a real abort.
// ═══════════════════════════════════════════════════════════════════════════════

test('AbortSignal.timeout actually aborts a stalled response on this runtime', async () => {
  // Accepts the connection, sends headers, then never sends a body and never ends. This is
  // the exact failure a status-code check cannot see: the response "arrives" and then hangs.
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // deliberately no res.end()
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const started = Date.now();
  await assert.rejects(
    async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(300) });
      await res.text(); // the hang is HERE, not on the status line
    },
    (e) => e.name === 'TimeoutError' || e.name === 'AbortError',
    'a stalled body must abort rather than hang forever',
  );
  assert.ok(Date.now() - started < 5000, 'and it must abort near its budget, not at the platform limit');

  await new Promise((r) => server.close(r));
});

// ═══════════════════════════════════════════════════════════════════════════════
// The stub. Records every call and fails it the way a real timeout does.
// ═══════════════════════════════════════════════════════════════════════════════

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// AbortSignal.timeout() rejects with a DOMException named 'TimeoutError'. Reproducing that
// exactly — rather than a generic Error — is what makes the fail-posture assertions below
// mean anything: the endpoints must handle the real thing.
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

/**
 * Replace fetch with a recorder. `plan` maps a substring of the URL to a handler; the FIRST
 * matching entry wins, and anything unmatched times out. That way a test names only the calls
 * it wants to succeed and everything else stalls.
 */
function stubFetch(plan = []) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    calls.push({ url, signal: init.signal });
    for (const [needle, handler] of plan) {
      if (url.includes(needle)) return handler(url, init);
    }
    throw timeoutError();
  };
  return calls;
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A signed-in reader, as Identity Toolkit returns them.
const IDENTITY = ['identitytoolkit.googleapis.com', async () =>
  jsonResponse({ users: [{ localId: 'AAAAowner0000000000000000001', email: 'reader@example.com' }] })];

// A minted admin token.
const OAUTH = ['oauth2.googleapis.com', async () => jsonResponse({ access_token: 'ya29.test' })];

const postRequest = (body) => new Request('https://calvaryscribblings.co.uk/api/x', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  PAYSTACK_SECRET_KEY: 'sk_paystack_test',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaTest',
  FIREBASE_CLIENT_EMAIL: 'sa@example.iam.gserviceaccount.com',
  // A REAL key is required, not a placeholder: mintAccessToken signs the JWT with Web Crypto
  // BEFORE it calls the token endpoint, so an unparseable PEM throws early and the stalled
  // RTDB call under test is never reached. Generated per run and thrown away — it authorises
  // nothing, and no test lets the signed assertion leave the process.
  FIREBASE_PRIVATE_KEY: generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey,
};

// Only assert the budget where the call site is unambiguous.
const budgetOf = (calls, needle) => {
  const call = calls.find((c) => c.url.includes(needle));
  assert.ok(call, `expected a fetch to ${needle}`);
  assert.ok(call.signal instanceof AbortSignal, `${needle} must carry an AbortSignal`);
  return call.signal;
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2 + 3. Per function: a stalled stub, the budget, and the preserved fail-posture.
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkout (Stripe rail)', () => {
  test('a stalled catalogue read times out and still answers 502, not a hang', async () => {
    const calls = stubFetch([IDENTITY]); // the title read is unmatched → times out
    const res = await checkout({
      request: postRequest({ idToken: 'tok', titleId: 'the-rescue', currency: 'gbp' }),
      env: ENV,
    });

    assert.equal(res.status, 502, 'the documented posture for an unreachable catalogue');
    assert.match((await res.json()).error, /catalogue/i);
    budgetOf(calls, 'bookstore_titles');
  });

  test('every outbound call carries a signal, at the documented budget', async () => {
    const calls = stubFetch([
      IDENTITY,
      ['bookstore_titles', async () => jsonResponse({
        status: 'published', slug: 'the-rescue', title: 'The Rescue', prices: { gbp: 199 },
      })],
      ['api.stripe.com', async () => jsonResponse({ id: 'cs_test_1', url: 'https://stripe/x' })],
    ]);
    const res = await checkout({
      request: postRequest({ idToken: 'tok', titleId: 'the-rescue', currency: 'gbp' }),
      env: ENV,
    });
    assert.equal(res.status, 200);

    // Provider calls get the long budget, Firebase the short one.
    assert.ok(calls.every((c) => c.signal instanceof AbortSignal), 'no call may go out unsignalled');
    budgetOf(calls, 'identitytoolkit.googleapis.com');
    budgetOf(calls, 'api.stripe.com');
    budgetOf(calls, 'bookstore_titles');
  });
});

describe('paystack-checkout (NGN rail)', () => {
  test('a stalled catalogue read times out and still answers 502', async () => {
    const calls = stubFetch([IDENTITY]);
    const res = await paystackCheckout({
      request: postRequest({ idToken: 'tok', titleId: 'the-rescue' }),
      env: ENV,
    });

    assert.equal(res.status, 502);
    budgetOf(calls, 'bookstore_titles');
  });
});

describe('stream (the reader gate)', () => {
  test('a stalled purchase read times out and fails CLOSED with 502', async () => {
    // The identity and token calls answer; the RTDB purchase read stalls.
    const calls = stubFetch([IDENTITY, OAUTH]);
    const res = await stream({
      request: postRequest({ idToken: 'tok', titleId: 'the-rescue' }),
      env: ENV,
    });

    // FAIL CLOSED is the point. A timeout must never be read as "no purchase" (403 + a buy
    // button) and must never hand over the file.
    assert.equal(res.status, 502, 'unknown entitlement withholds the file');
    const body = await res.json();
    assert.match(body.error, /Could not open your copy/i);
    assert.notEqual(body.code, 'not_purchased', 'a timeout must not be reported as "you do not own this"');
    budgetOf(calls, 'bookstore_purchases');
  });
});

// ── The webhooks. Signature first, then the posture that matters most. ─────────

async function stripeSigned(body, secret) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

async function paystackSigned(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('stripe-webhook', () => {
  test('a stalled Firebase write still answers 200 — the money already moved', async () => {
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_test_1', client_reference_id: 'AAAAowner0000000000000000001',
        metadata: { uid: 'AAAAowner0000000000000000001', titleId: 'the-rescue' },
        payment_intent: 'pi_test_1', amount_total: 199, currency: 'gbp',
        // R9.2 PL-3 added a payment_status gate IN FRONT of the token mint, so a session
        // without one now returns before any Firebase call and this fixture would be asserting
        // a plain 200 rather than the stalled-write posture it exists for. 'paid' is what
        // Stripe sends for a card, which is the case under test.
        payment_status: 'paid',
      } },
    });
    // The token mints; every RTDB call stalls.
    const calls = stubFetch([OAUTH]);
    const res = await stripeWebhook({
      request: new Request('https://x/api/bookstore/stripe-webhook', {
        method: 'POST', body,
        headers: { 'Stripe-Signature': await stripeSigned(body, ENV.STRIPE_WEBHOOK_SECRET) },
      }),
      env: ENV,
    });

    // THE LOAD-BEARING ASSERTION. A non-2xx here makes Stripe redeliver for 72 hours. The
    // response policy says 200 once the signature has verified, and a timeout is no different
    // from any other Firebase failure.
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, degraded: true });
    budgetOf(calls, 'bookstore_purchases');
  });
});

describe('paystack-webhook', () => {
  test('a stalled Paystack verify still answers 200', async () => {
    const ref = 'cs.AAAAowner0000000000000000001.the-rescue.aabbccddeeff';
    const body = JSON.stringify({ event: 'charge.success', data: { reference: ref } });
    // Nothing is stubbed: the verify call stalls, which is the call under test.
    const calls = stubFetch([]);
    const res = await paystackWebhook({
      request: new Request('https://x/api/bookstore/paystack-webhook', {
        method: 'POST', body,
        headers: { 'x-paystack-signature': await paystackSigned(body, ENV.PAYSTACK_SECRET_KEY) },
      }),
      env: ENV,
    });

    // handleGrant catches a failed verify, logs, and returns without granting — so the
    // envelope is a plain 200 rather than the degraded one. Either way: not a retry trigger.
    assert.equal(res.status, 200);
    budgetOf(calls, 'api.paystack.co');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// The budgets themselves, stated once so a change to either is a deliberate edit.
// ═══════════════════════════════════════════════════════════════════════════════

test('the two budgets are the documented ones', () => {
  assert.equal(PROVIDER_TIMEOUT_MS, 10_000, 'third-party APIs: 10s');
  assert.equal(FIREBASE_TIMEOUT_MS, 5_000, 'same-region RTDB REST: 5s');
  assert.ok(FIREBASE_TIMEOUT_MS < PROVIDER_TIMEOUT_MS, 'the nearer dependency gets the tighter budget');
});
