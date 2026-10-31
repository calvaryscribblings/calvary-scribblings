// RULING 256 — BOTH BOOK WEBHOOKS, RUN FOR REAL AGAINST THE DATABASE EMULATOR.
//
// functions/api/bookstore/stripe-webhook.js and paystack-webhook.js run unmodified. Every event
// is a provider-shaped payload SIGNED with a test secret, so each one passes the real signature
// check (Stripe: HMAC-SHA256 over `t.body`; Paystack: HMAC-SHA512 over the body). Their database
// calls are real REST calls to the RTDB emulator — ETags, preconditions, server increments and
// multi-path PATCHes all come from it.
//
// Stood in for, and nothing else:
//   oauth2.googleapis.com/token           → an emulator admin token ("owner")
//   api.paystack.co/transaction/verify/…  → the transaction this suite registered for that reference
//                                          (Paystack's verify response shape: { status, data })
//   api.resend.com/emails                 → RECORDED in `sentMail`, never delivered (ALERTS-1). A
//                                          suite can make it refuse (resendRefuses(true)).
// So no real email can be sent from here either: the key below is a dummy, and the host is stubbed.
// Anything else is refused, so no request leaves the machine, and no money moves: there is no
// refund API anywhere in this path, and nothing here could reach one.
//
// Lives OUTSIDE tests/bookstore/ deliberately: `npm run test:purchases` globs that directory and
// runs without an emulator (W43's carry-over suite set the precedent).
//
// Run inside `firebase emulators:exec --only database` (npm run test:store-webhook:emulator).
import { createHmac, generateKeyPairSync } from 'node:crypto';

const EMU = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
export const NS = 'storewebhook256';
const FAKE = 'https://store-webhook.test';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

const STRIPE_SECRET = 'whsec_test_harness_256';
const PAYSTACK_SECRET = 'sk_test_harness_256';

export const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: FAKE,
  STRIPE_WEBHOOK_SECRET: STRIPE_SECRET,
  PAYSTACK_SECRET_KEY: PAYSTACK_SECRET,
  RESEND_API_KEY: 're_test_harness_dummy',
  FROM_EMAIL: 'alerts@harness.invalid',
};

const realFetch = globalThis.fetch;
const paystackTxns = new Map();
export const outbound = [];
export const sentMail = [];
let resendRefusing = false;
export const resendRefuses = (on) => { resendRefusing = !!on; };

/** Register what Paystack's verify endpoint will say about a reference. */
export const paystackKnows = (txn) => paystackTxns.set(txn.reference, txn);

export function install() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://api.paystack.co/transaction/verify/')) {
      const ref = decodeURIComponent(url.split('/').pop());
      const txn = paystackTxns.get(ref);
      return txn
        ? new Response(JSON.stringify({ status: true, message: 'Verification successful', data: txn }), { status: 200 })
        : new Response(JSON.stringify({ status: false, message: 'Transaction reference not found' }), { status: 400 });
    }
    if (url === 'https://api.resend.com/emails') {
      if (resendRefusing) return new Response(JSON.stringify({ message: 'refused by the harness' }), { status: 500 });
      sentMail.push({ auth: (init.headers || {}).Authorization ? 'present' : 'absent', ...JSON.parse(init.body || '{}') });
      return new Response(JSON.stringify({ id: `harness-${sentMail.length}` }), { status: 200 });
    }
    if (url.startsWith(FAKE)) {
      const u = new URL(url);
      const target = `${EMU}${u.pathname}?ns=${NS}${u.search ? `&${u.search.slice(1)}` : ''}`;
      const headers = { ...(init.headers || {}), Authorization: 'Bearer owner' };
      const { signal, ...rest } = init;
      return realFetch(target, { ...rest, headers });
    }
    outbound.push(url);
    throw new Error(`harness: refused an outbound call to ${new URL(url).host}`);
  };
}
export function uninstall() { globalThis.fetch = realFetch; }

// ── the emulator, as admin ─────────────────────────────────────────────────────────────────
const emu = (path) => `${EMU}/${path}.json?ns=${NS}`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
export async function get(path) { return (await realFetch(emu(path), { headers: H })).json(); }
export async function set(path, value) {
  const r = await realFetch(emu(path), { method: 'PUT', headers: H, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`emulator PUT ${path} ${r.status}`);
}
export async function wipe() { await set('', null); paystackTxns.clear(); outbound.length = 0; sentMail.length = 0; resendRefusing = false; }

// ── signed deliveries ──────────────────────────────────────────────────────────────────────
const ctx = (request) => ({ request, env: ENV, waitUntil: () => {} });

/** Deliver a Stripe event, signed as Stripe signs it. Resolves to { status, body }. */
export async function stripe(onRequestPost, event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', STRIPE_SECRET).update(`${t}.${body}`).digest('hex');
  const req = new Request('https://calvaryscribblings.co.uk/api/bookstore/stripe-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` }, body,
  });
  const res = await onRequestPost(ctx(req));
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Deliver a Paystack event, signed as Paystack signs it. */
export async function paystack(onRequestPost, event) {
  const body = JSON.stringify(event);
  const sig = createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
  const req = new Request('https://calvaryscribblings.co.uk/api/bookstore/paystack-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig }, body,
  });
  const res = await onRequestPost(ctx(req));
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ── provider-shaped test payloads ──────────────────────────────────────────────────────────
// The fields the webhooks read, in the shapes Stripe and Paystack send in test mode. Ids carry
// the providers' test markers (cs_test_, pi_test_, ch_test_) and are invented here.

export const stripeSessionCompleted = ({ uid, titleId, session, pi, amount = 999, currency = 'gbp' }) => ({
  id: `evt_test_${session}`, object: 'event', type: 'checkout.session.completed', livemode: false,
  data: { object: {
    id: session, object: 'checkout.session', mode: 'payment', payment_status: 'paid', status: 'complete',
    client_reference_id: uid, metadata: { uid, titleId }, payment_intent: pi,
    amount_total: amount, currency, livemode: false,
  } },
});

export const stripeChargeRefunded = ({ uid, titleId, pi, amount = 999, currency = 'gbp' }) => ({
  id: `evt_test_refund_${pi}`, object: 'event', type: 'charge.refunded', livemode: false,
  data: { object: {
    id: `ch_test_${pi}`, object: 'charge', amount, amount_refunded: amount, currency, refunded: true,
    status: 'succeeded', payment_intent: pi, metadata: { uid, titleId }, livemode: false,
  } },
});

export const paystackRef = (uid, titleId, nonce) => `cs.${uid}.${titleId}.${nonce}`;

export function paystackChargeSuccess({ reference, amount = 750000 }) {
  const txn = { id: 4099260516, domain: 'test', status: 'success', reference, amount, currency: 'NGN', paid_at: new Date().toISOString(), channel: 'card', metadata: {} };
  paystackKnows(txn);
  return { event: 'charge.success', data: { ...txn } };
}

export const paystackRefundProcessed = ({ reference, amount = 750000 }) => ({
  event: 'refund.processed',
  data: { status: 'processed', transaction_reference: reference, amount, currency: 'NGN', domain: 'test', refunded_by: 'harness@example.test' },
});
