// Membership checkout, Stripe rail — Cloudflare Pages Function.
//
// POST /api/membership/checkout
//   credential: Authorization: Bearer <Firebase ID token>  (or body { idToken })
//   body: { tier: 'gold'|'platinum', interval: 'monthly'|'annual', currency: 'gbp'|'usd' }
//   → 200 { url }
//   → 401 { code: 'signed_out' }
//   → 409 { code: 'not_configured' }   the price book has no ids yet
//   → 400 { code: 'bad_request' }
//
// The twin of functions/api/bookstore/checkout.js, and everything that file says about the
// two rules that matter applies here without a word changed:
//
//   1. The uid comes from a VERIFIED Firebase ID token, never the request body. It becomes
//      client_reference_id, which is what the webhook trusts when it writes a reader's TIER.
//      A body-supplied uid would let anyone buy a membership into someone else's account.
//   2. The price is never supplied by the client. The body names a tier, an interval and a
//      currency; the PRICE comes from the price book, server-side. A client-supplied amount
//      is a client-supplied discount.
//
// ── mode: 'subscription', AND A REAL PRICE ID ────────────────────────────────────────────
//
// The bookstore rail uses inline `price_data`, which is right for a one-off: a book is bought
// once at the price on the day. A subscription must reference a SHARED Price object instead,
// because the founding lock is nothing more than "this subscription is still pinned to the
// price it started on", and an inline price creates a new anonymous price per session that
// nothing can later be compared against. If the price book is unconfigured this endpoint
// REFUSES rather than falling back to price_data — a fallback would work, would charge the
// right amount, and would quietly make the member ungrandfatherable.
//
// ── THE CUSTOMER, AND THE ORDER IT COMES INTO EXISTENCE ──────────────────────────────────
//
// A Stripe Customer is what the billing portal is opened against, and one does not exist until
// somebody has checked out. So the ordering is:
//
//   first checkout   → no stored customer → send `customer_email` and let Stripe create one
//   webhook          → captures `session.customer` and stores it on memberships/{uid}
//   later checkouts  → send `customer` so the same person is not duplicated
//   portal           → needs the stored id; says so honestly when it is not there yet
//
// Sending customer_email rather than nothing matters: without it Stripe creates a Customer
// with no email, the member gets no receipts, and support cannot find them by address. The
// email comes from the VERIFIED token, like the uid — never from the body, for the same
// reason the Paystack rail reads it from lookupUser().

import { json, dbBase, lookupUser, PROVIDER_TIMEOUT_MS, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { DETAIL_PATH } from './_membership.js';
import {
  TIERS, INTERVALS, STRIPE_CURRENCIES, CURRENT_GENERATION,
  priceIdFor, isConfigured, modeOf, LAUNCH_NOTICE,
} from './prices.js';

const LABEL = 'membership/checkout';
const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const DEFAULT_ORIGIN = 'https://calvaryscribblings.co.uk';

/** The ID token, header first. Same contract R9.10 gave the stream endpoint. */
export function readIdToken(request, body) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

/**
 * Validate the three things the client is allowed to choose. Pure, so the 400 contract can be
 * asserted without a network — and so an unsupported combination is a named branch rather
 * than a fall-through that silently sells the wrong thing.
 */
export function validateSelection({ tier, interval, currency }) {
  if (!TIERS.includes(tier)) return { ok: false, code: 'bad_tier', error: 'Choose Gold or Platinum.' };
  if (!INTERVALS.includes(interval)) return { ok: false, code: 'bad_interval', error: 'Choose monthly or annual.' };
  const cur = String(currency || '').toLowerCase();
  if (!STRIPE_CURRENCIES.includes(cur)) {
    // Naira is not an error the reader caused — it is a different rail, and the copy says so
    // rather than pretending the currency is invalid.
    return cur === 'ngn'
      ? { ok: false, code: 'wrong_rail', error: 'Naira memberships are paid through Paystack.' }
      : { ok: false, code: 'bad_currency', error: 'Unsupported currency.' };
  }
  return { ok: true, tier, interval, currency: cur };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.STRIPE_SECRET_KEY) {
    console.error(`[${LABEL}] STRIPE_SECRET_KEY is not set`);
    return json({ error: 'Memberships are not available yet. Please try again later.', code: 'not_configured' }, 500);
  }
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(`[${LABEL}] NEXT_PUBLIC_FIREBASE_API_KEY is not set`);
    return json({ error: 'Memberships are not available yet. Please try again later.', code: 'not_configured' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to become a member.', code: 'signed_out' }, 401);

  const selection = validateSelection(body || {});
  if (!selection.ok) return json({ error: selection.error, code: selection.code }, 400);
  const { tier, interval, currency } = selection;

  const mode = modeOf(env.STRIPE_SECRET_KEY);
  if (!isConfigured(mode)) {
    // HONEST, not a 500. The rail is built and the prices have not been created yet; a reader
    // seeing "try again later" would be told a lie about a transient problem.
    console.error(`[${LABEL}] price book has no ${mode} ids for generation ${CURRENT_GENERATION}`);
    return json({ error: LAUNCH_NOTICE, code: 'not_configured' }, 409);
  }

  const priceId = priceIdFor({ tier, interval, currency, mode });
  if (!priceId) {
    console.error(`[${LABEL}] no ${mode} price for ${tier}/${interval}/${currency}`);
    return json({ error: 'That membership is not available in this currency.', code: 'not_priced' }, 409);
  }

  // ── identity ───────────────────────────────────────────────────────────────
  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const uid = user?.localId;
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);
  const email = typeof user.email === 'string' && user.email ? user.email : null;

  // ── the existing customer, if this reader has ever checked out ─────────────
  // Read as THE READER, with the id token already verified above. memberships/{uid} is
  // owner-or-founder readable (R10.1), so no admin credential is needed or wanted here — this
  // endpoint only ever wants one reader's own record, and asking with their own token is the
  // narrowest possible way to get it.
  //
  // Failure is TOLERATED, not fatal: a missing or unreadable customer id simply means the
  // first-checkout path, whose cost if wrong is a duplicate Stripe Customer, never a wrong
  // charge. The webhook is what makes the id durable.
  let customerId = null;
  try {
    const res = await fetch(`${dbBase(env)}/${DETAIL_PATH(encodeURIComponent(uid))}.json?auth=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (res.ok) {
      const detail = await res.json();
      if (detail && typeof detail.stripeCustomerId === 'string' && detail.stripeCustomerId) {
        customerId = detail.stripeCustomerId;
      }
    }
  } catch (e) {
    console.error(`[${LABEL}] customer lookup failed for ${uid} (continuing as first checkout):`, e.message || e);
  }

  // ── the session ────────────────────────────────────────────────────────────
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('client_reference_id', uid);
  form.set('success_url', `${origin}/membership?join=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/membership?join=cancelled`);

  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');

  // Identity on the session AND on the subscription. Session metadata does not propagate to
  // the Subscription, and customer.subscription.updated/deleted carry only the Subscription —
  // so without this pair a lifecycle event could not name the reader it is about. Exactly the
  // lesson bookstore/checkout.js learned when it added payment_intent_data metadata for
  // refunds.
  form.set('metadata[uid]', uid);
  form.set('metadata[kind]', 'membership');
  form.set('subscription_data[metadata][uid]', uid);
  form.set('subscription_data[metadata][kind]', 'membership');
  form.set('subscription_data[metadata][tier]', tier);
  form.set('subscription_data[metadata][generation]', CURRENT_GENERATION);

  if (customerId) form.set('customer', customerId);
  else if (email) form.set('customer_email', email);

  let session;
  try {
    const res = await fetch(STRIPE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    session = await res.json();
    if (!res.ok) {
      console.error(`[${LABEL}] session create failed for ${uid} ${tier}/${interval}/${currency}:`, session?.error?.message || res.status);
      return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
    }
  } catch (e) {
    console.error(`[${LABEL}] Stripe request failed:`, e.message || e);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  if (!session?.url) {
    console.error(`[${LABEL}] Stripe returned a session with no url: ${session?.id}`);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  console.log(`[${LABEL}] session ${session.id} uid=${uid} ${tier}/${interval}/${currency} price=${priceId} customer=${customerId || 'new'}`);
  return json({ url: session.url });
}
