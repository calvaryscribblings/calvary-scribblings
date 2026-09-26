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

import { json, dbBase, lookupUser, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { DETAIL_PATH } from './_membership.js';
import {
  TIERS, INTERVALS, STRIPE_CURRENCIES, CURRENT_GENERATION,
  priceIdFor, describePrice, PORTAL_CONFIGURATION,
} from './prices.js';
import { stripe, subscriptionItemId } from '../_stripe.js';
import { isTestEnv, isTestBuyer } from '../_money.js';
// The one gate all four membership checkouts open on. See _onSale.js.
import { saleGate, CLOSED_BODY, CLOSED_STATUS } from './_onSale.js';

const LABEL = 'membership/checkout';
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

// ── W3 / MON-02: ONE SUBSCRIPTION PER READER, EVER ───────────────────────────────────────
//
// Until W3 a Gold member pressing CHOOSE PLATINUM got a SECOND subscription on the same
// customer, both billed, the tier flipping on every invoice, and cancelling either one dropping
// them to free. Now a live member never reaches Checkout:
//
//   same plan              → 409 already_member
//   another plan, Stripe   → a Stripe-hosted CONFIRM page (billing portal flow
//                            subscription_update_confirm) that switches the price on the SAME
//                            subscription, with Stripe's own proration shown before they agree.
//                            The portal configuration is the founding one, so the lock holds.
//   a naira membership     → 409 other_rail: cancel that one first
//
// "Live" is read from our record AND from Stripe (the customer's active subscriptions), so a
// webhook that has not landed yet cannot open the door to a second subscription.

/** What to do for a reader who asked for {tier, interval}, given what they hold. Pure. */
export function planChange(detail, { tier, interval }) {
  const live = detail && (detail.status === 'active' || detail.status === 'past_due');
  if (!live) return { action: 'checkout' };
  if (detail.rail === 'paystack') return { action: 'refuse', status: 409, code: 'other_rail', error: 'Your membership is paid in naira. Cancel it in your settings first, then choose a card plan.' };
  if (detail.tier === tier && detail.interval === interval) return { action: 'refuse', status: 409, code: 'already_member', error: 'You already have this membership.' };
  return { action: 'switch' };
}

async function liveStripeSubscription(env, customerId) {
  if (!customerId) return null;
  for (const status of ['active', 'past_due', 'trialing']) {
    const r = await stripe(env, '/subscriptions', { query: { customer: customerId, status, limit: '1' } });
    if (!r.ok) throw new Error(`subscription list failed: ${r.status}`);
    if (r.body?.data?.[0]) return r.body.data[0];
  }
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.STRIPE_SECRET_KEY) {
    console.error(`[${LABEL}] STRIPE_SECRET_KEY is not set`);
    return json({ error: 'Memberships aren’t available yet. Please try again later.', code: 'not_configured' }, 500);
  }
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(`[${LABEL}] NEXT_PUBLIC_FIREBASE_API_KEY is not set`);
    return json({ error: 'Memberships aren’t available yet. Please try again later.', code: 'not_configured' }, 500);
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

  // HONEST, not a 500. The rail is built and memberships are not on sale yet; a reader seeing
  // "try again later" would be told a lie about a transient problem. The condition is
  // _onSale.js's, shared with the other three checkouts. Since the live-money preflight it
  // includes MEMBERSHIPS_ON_SALE as well as isConfigured(mode).
  const { open: onSale, mode } = saleGate('stripe', env.STRIPE_SECRET_KEY);
  // A closed gate on LIVE keys refuses here, before any identity work — exactly as before W3.
  if (!onSale && !isTestEnv(env)) {
    console.error(`[${LABEL}] not on sale in ${mode} mode (generation ${CURRENT_GENERATION})`);
    return json(CLOSED_BODY, CLOSED_STATUS);
  }

  // ── identity ───────────────────────────────────────────────────────────────
  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const uid = user?.localId;
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);
  const email = typeof user.email === 'string' && user.email ? user.email : null;

  // THE GATE. isTestBuyer() is the W3 proof's door: in TEST mode only, a uid an admin listed at
  // ops/test_buyers may check out before MEMBERSHIPS_ON_SALE. With a live key it reads nothing.
  const open = onSale || await isTestBuyer(env, uid);
  if (!open) {
    console.error(`[${LABEL}] not on sale in ${mode} mode (generation ${CURRENT_GENERATION})`);
    return json(CLOSED_BODY, CLOSED_STATUS);
  }

  const priceId = priceIdFor({ tier, interval, currency, mode });
  if (!priceId) {
    console.error(`[${LABEL}] no ${mode} price for ${tier}/${interval}/${currency}`);
    return json({ error: 'That membership isn’t available in this currency.', code: 'not_priced' }, 409);
  }

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
  let detail = null;
  try {
    const res = await fetch(`${dbBase(env)}/${DETAIL_PATH(encodeURIComponent(uid))}.json?auth=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (res.ok) {
      detail = await res.json();
      if (detail && typeof detail.stripeCustomerId === 'string' && detail.stripeCustomerId) {
        customerId = detail.stripeCustomerId;
      }
    }
  } catch (e) {
    console.error(`[${LABEL}] customer lookup failed for ${uid} (continuing as first checkout):`, e.message || e);
  }

  // ── MON-02: a live member never gets a second subscription ──────────────────
  let live;
  try {
    live = await liveStripeSubscription(env, customerId);
  } catch (e) {
    console.error(`[${LABEL}] live-subscription check failed for ${uid}:`, e.message || e);
    return json({ error: 'Checkout couldn’t be opened. Please try again.' }, 502);
  }
  const held = live ? { ...(detail || {}), rail: 'stripe', status: 'active', ...(describePrice(live.items?.data?.[0]?.price?.id, mode) || {}) } : detail;
  const change = planChange(held, { tier, interval });
  if (change.action === 'refuse') return json({ error: change.error, code: change.code }, change.status);
  if (change.action === 'switch') {
    if (!live) return json({ error: 'Your membership is still being set up. Try again in a minute.', code: 'pending' }, 409);
    // Stripe cannot bill one customer in two currencies (MON-20): the switch stays in theirs.
    const cur = String(live.currency || currency).toLowerCase();
    const target = priceIdFor({ tier, interval, currency: cur, mode });
    const configuration = PORTAL_CONFIGURATION[CURRENT_GENERATION]?.[mode] || null;
    if (!target || !configuration) return json({ error: 'That membership isn’t available yet.', code: 'not_configured' }, 409);
    const portal = await stripe(env, '/billing_portal/sessions', {
      form: {
        customer: customerId,
        configuration,
        return_url: `${origin}/membership?switch=${tier}`,
        'flow_data[type]': 'subscription_update_confirm',
        'flow_data[subscription_update_confirm][subscription]': live.id,
        'flow_data[subscription_update_confirm][items][0][id]': subscriptionItemId(live),
        'flow_data[subscription_update_confirm][items][0][price]': target,
        'flow_data[subscription_update_confirm][items][0][quantity]': '1',
        'flow_data[after_completion][type]': 'redirect',
        'flow_data[after_completion][redirect][return_url]': `${origin}/membership?switch=${tier}`,
      },
    }).catch((e) => ({ ok: false, body: { error: { message: e.message } } }));
    if (!portal.ok || !portal.body?.url) {
      console.error(`[${LABEL}] switch session failed for ${uid} ${live.id} → ${target}:`, portal.body?.error?.message || portal.status);
      return json({ error: 'Your plan couldn’t be changed just now. Please try again.' }, 502);
    }
    console.log(`[${LABEL}] switch ${uid} ${live.id} → ${tier}/${interval} (${target})`);
    return json({ url: portal.body.url, switch: true });
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
    const res = await stripe(env, '/checkout/sessions', { form });
    session = res.body;
    if (!res.ok) {
      console.error(`[${LABEL}] session create failed for ${uid} ${tier}/${interval}/${currency}:`, session?.error?.message || res.status);
      return json({ error: 'Checkout couldn’t be opened. Please try again.' }, 502);
    }
  } catch (e) {
    console.error(`[${LABEL}] Stripe request failed:`, e.message || e);
    return json({ error: 'Checkout couldn’t be opened. Please try again.' }, 502);
  }

  if (!session?.url) {
    console.error(`[${LABEL}] Stripe returned a session with no url: ${session?.id}`);
    return json({ error: 'Checkout couldn’t be opened. Please try again.' }, 502);
  }

  console.log(`[${LABEL}] session ${session.id} uid=${uid} ${tier}/${interval}/${currency} price=${priceId} customer=${customerId || 'new'}`);
  return json({ url: session.url });
}
