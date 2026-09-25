// Day-pass checkout, Stripe rail — Cloudflare Pages Function.
//
// POST /api/membership/pass-checkout
//   credential: Authorization: Bearer <Firebase ID token>  (or body { idToken })
//   body: { kind: 'day', currency: 'gbp'|'usd' }
//   → 200 { url }
//   → 401 { code: 'signed_out' }
//   → 400 { code: 'bad_kind' | 'bad_currency' }
//   → 409 { code: 'not_offered' }   this pass is not sold in this currency
//   → 409 { code: 'not_configured' }   memberships are not on sale (LAUNCH_NOTICE) — _onSale.js
//
// The two rules checkout.js states apply here unchanged: the uid comes from a VERIFIED ID
// token and becomes client_reference_id, and the PRICE is never supplied by the client — the
// body names a kind and a currency, and the amount comes from the catalogue, server-side.
//
// ── mode 'payment', AND INLINE price_data — THE OPPOSITE OF THE SUBSCRIPTION ENDPOINT ────
//
// checkout.js refuses to use price_data, because a subscription must reference a shared Price
// object or the founding lock has nothing to pin to. A pass has no lock to hold: it is bought
// once at the price on the day and never renews, so there is no later generation for it to be
// distinguished from. Inline pricing is right here for exactly the reason it is wrong there —
// the same reasoning bookstore/checkout.js applies to a book.
//
// The practical consequence is worth stating: passes need NO setup script and no created
// Stripe objects. ⚠ That is exactly why this endpoint must NOT open on the key alone. Until the
// live-money preflight it did: a live key sold real passes before memberships opened. It now
// opens on _onSale.js's gate, the same one the subscriptions use.
//
// ── WHY THIS IS A SEPARATE ENDPOINT ──────────────────────────────────────────────────────
//
// Not a `kind: 'pass'` branch inside checkout.js. That file's whole doctrine is "a real Price
// id or refuse", enforced by isConfigured() before anything else happens; a pass path through
// it would have to bypass that guard, and a guard with an exception is a guard nobody trusts.
// Two endpoints, two doctrines, neither weakened.
//
// ── ROUTING, WHICH IS THE PART THAT CAN GO WRONG QUIETLY ─────────────────────────────────
//
// Stripe delivers checkout.session.completed to EVERY subscribed endpoint. Until now the two
// handlers split cleanly on `mode`: the bookstore owns 'payment', membership owns
// 'subscription'. A pass is mode 'payment' and would land in the bookstore's handler, which
// would find no titleId and log an unattributable-session error on every pass sold. So the
// session carries `metadata[kind] = 'pass'`, and BOTH webhooks read it — membership claims it,
// the bookstore skips it. The marker is on the session's own metadata rather than inferred
// from the absence of a titleId, because "no titleId" is also what a genuinely broken book
// purchase looks like, and those two must stay distinguishable.

import { STRIPE_VERSION } from '../_stripe.js';
import { json, lookupUser, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import { PASS_KINDS, PASS_TIER, passAmount, isPassOffered, railFor } from '../../../app/lib/membershipPasses.js';
import { saleGate, CLOSED_BODY, CLOSED_STATUS } from './_onSale.js';
import { isTestEnv, isTestBuyer } from '../_money.js';

const LABEL = 'membership/pass-checkout';
const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const DEFAULT_ORIGIN = 'https://calvaryscribblings.co.uk';

// What the reader sees on the Stripe page. Kept here rather than in the catalogue because it
// is copy, not pricing — the catalogue holds facts about money and nothing about wording.
const PRODUCT_NAME = { day: 'Calvary Scribblings — Day Pass', week: 'Calvary Scribblings — Week Pass' };

export function readIdToken(request, body) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

/**
 * Validate the two things the client may choose. Pure, so the 400/409 contract is assertable
 * without a network.
 *
 * The naira branch is a 400 with its own code rather than a generic bad_currency, for the same
 * reason checkout.js gives: a Nigerian reader has not made a mistake, they are on the other
 * rail, and the copy should say so. The week-pass-in-pounds branch is a 409 rather than a 400
 * for the matching reason — the request is well-formed, the product simply is not sold at that
 * price, which is a fact about the catalogue rather than about the request.
 */
export function validatePassSelection({ kind, currency }) {
  if (!PASS_KINDS.includes(kind)) return { ok: false, status: 400, code: 'bad_kind', error: 'Choose a day pass.' };
  const cur = String(currency || '').toLowerCase();
  if (cur === 'ngn') {
    return { ok: false, status: 400, code: 'wrong_rail', error: 'Naira passes are paid through Paystack.' };
  }
  if (railFor(cur) !== 'stripe') {
    return { ok: false, status: 400, code: 'bad_currency', error: 'Unsupported currency.' };
  }
  if (!isPassOffered(kind, cur)) {
    return { ok: false, status: 409, code: 'not_offered', error: 'That pass is not sold in this currency.' };
  }
  return { ok: true, kind, currency: cur };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.STRIPE_SECRET_KEY || !env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(`[${LABEL}] STRIPE_SECRET_KEY or NEXT_PUBLIC_FIREBASE_API_KEY is not set`);
    return json({ error: 'Passes are not available yet. Please try again later.', code: 'not_configured' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to buy a pass.', code: 'signed_out' }, 401);

  const selection = validatePassSelection(body || {});
  if (!selection.ok) return json({ error: selection.error, code: selection.code }, selection.status);
  const { kind, currency } = selection;

  // THE ON-SALE GATE, and it sits BEFORE the identity round trip, so a closed gate costs
  // nothing. This endpoint had none until the live-money preflight (23 Sep 2026) found that a
  // live secret key sold real passes a week before memberships opened, with only the page's
  // hidden buttons in the way. It now shuts on exactly the condition the subscriptions use,
  // from the same module, and opens with them when MEMBERSHIPS_ON_SALE flips. See _onSale.js.
  const { open, mode } = saleGate('stripe', env.STRIPE_SECRET_KEY);
  // A closed gate on LIVE keys refuses here, before any identity work. On TEST keys a listed
  // test buyer (ops/test_buyers, W3) may still pass — decided once the uid is known, below.
  if (!open && !isTestEnv(env)) {
    console.error(`[${LABEL}] not on sale in ${mode} mode — ${kind}/${currency} refused`);
    return json(CLOSED_BODY, CLOSED_STATUS);
  }

  const amount = passAmount(kind, currency);

  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const uid = user?.localId;
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);
  if (!open && !(await isTestBuyer(env, uid))) {
    console.error(`[${LABEL}] not on sale in ${mode} mode — ${kind}/${currency} refused`);
    return json(CLOSED_BODY, CLOSED_STATUS);
  }
  const email = typeof user.email === 'string' && user.email ? user.email : null;

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('client_reference_id', uid);
  form.set('success_url', `${origin}/membership?pass=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/membership?pass=cancelled`);

  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', currency);
  form.set('line_items[0][price_data][unit_amount]', String(amount));
  form.set('line_items[0][price_data][product_data][name]', PRODUCT_NAME[kind]);

  // The routing marker and the identity, on the session AND on the PaymentIntent. The session
  // metadata is what both webhooks route on; the payment_intent copy is what a refund or a
  // dispute carries, which is the lesson bookstore/checkout.js already learned.
  form.set('metadata[uid]', uid);
  form.set('metadata[kind]', 'pass');
  form.set('metadata[passKind]', kind);
  form.set('metadata[tier]', PASS_TIER);
  form.set('payment_intent_data[metadata][uid]', uid);
  form.set('payment_intent_data[metadata][kind]', 'pass');
  form.set('payment_intent_data[metadata][passKind]', kind);

  if (email) form.set('customer_email', email);

  let session;
  try {
    const res = await fetch(STRIPE_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Stripe-Version': STRIPE_VERSION, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    session = await res.json();
    if (!res.ok) {
      console.error(`[${LABEL}] session create failed for ${uid} ${kind}/${currency}:`, session?.error?.message || res.status);
      return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
    }
  } catch (e) {
    console.error(`[${LABEL}] Stripe request failed:`, e.message || e);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  if (!session?.url) {
    console.error(`[${LABEL}] session ${session?.id || '—'} has no url`);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  console.log(`[${LABEL}] opened ${session.id} uid=${uid} ${kind}/${currency} ${amount}`);
  return json({ url: session.url });
}
