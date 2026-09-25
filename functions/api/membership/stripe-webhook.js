// Membership Stripe webhook — Cloudflare Pages Function.
//
// POST /api/membership/stripe-webhook
//
// A SEPARATE ENDPOINT from functions/api/bookstore/stripe-webhook.js, with its own signing
// secret, and separate on purpose. The bookstore rail moves money for books and is proven on
// glass; a membership bug must not be able to break a book purchase, and the two have
// different event sets, different idempotency keys and opposite ideas of what a
// checkout.session.completed means. One endpoint routing both would be one file where those
// differences could be confused.
//
// NOTE both endpoints receive `checkout.session.completed` — Stripe delivers an event to every
// endpoint subscribed to it. Each therefore ignores what is not its own: this one skips
// anything that is not mode 'subscription', and the bookstore one skips subscription sessions.
//
// ── THE FOUR LIFECYCLE EVENTS ────────────────────────────────────────────────────────────
//
//   checkout.session.completed        the first payment. Captures the CUSTOMER ID — the only
//                                     moment it comes into existence, and the thing the
//                                     billing portal is opened against later.
//   invoice.paid                      every renewal. Advances currentPeriodEnd. Idempotency
//                                     is keyed on the INVOICE id here, never the subscription
//                                     — see _membership.js for what keying on the
//                                     subscription would cost.
//   customer.subscription.updated     tier changes, cancel-at-period-end, and the transition
//                                     into past_due.
//   customer.subscription.deleted     THE AUTHORITATIVE DOWNGRADE. The only event that writes
//                                     'free'.
//
// invoice.payment_failed is handled and DELIBERATELY DOES NOT DOWNGRADE. Stripe retries a
// failed card for around three weeks; a member whose card expired on holiday is still a
// member, and taking their tier away on the first retry would punish exactly the people most
// likely to fix it. It writes status 'past_due' and leaves the tier alone. The scalar is
// ENTITLEMENT, not billing state.
//
// ── THE FOUNDING LOCK, AND WHY THE PRICE IS READ ON EVERY EVENT ──────────────────────────
//
// The tier is NOT taken from event metadata. It is resolved from the Price id on the
// subscription item, through the reverse lookup in prices.js. That is deliberate and it is
// what makes the founding lock survive an upgrade: a member who moves Gold → Platinum through
// the portal arrives here as customer.subscription.updated carrying a new Price, and the ONLY
// honest way to know what they now have — and whether it is still a founding price — is to
// look the price up. Metadata written at checkout would still say 'gold'.
//
// `foundingSince` is PRESERVED from the stored record on every write, never restamped. A
// member's founding date is the day they joined, not the day they last changed plan.

import { json, bytesToHex, hexToBytes, timingSafeEqual, mintAccessToken } from '../bookstore/_lib.js';
import {
  applyMembershipChange, applyPassPurchase, readDetail, buildDetail, endMembershipNow, endPassNow,
} from './_membership.js';
import { stripe, invoiceSubscriptionId, invoiceSubscriptionUid, subscriptionPeriodEnd } from '../_stripe.js';
import { MoneyTransientError, settleWebhook } from '../_money.js';
import { describePrice, modeOf } from './prices.js';
import { buildPass, isPassKind } from '../../../app/lib/membershipPasses.js';

const LABEL = 'membership/stripe-webhook';
const TOLERANCE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

// ──────────────────────────────────────────────────────────────────────────
// Signature verification — the same scheme as the bookstore webhook, and
// deliberately a copy rather than an import: it reads STRIPE_WEBHOOK_SECRET
// from a different variable, and a shared helper that took the secret as an
// argument would invite passing the wrong one.
// ──────────────────────────────────────────────────────────────────────────
export async function verifyStripeSignature(rawBody, header, secret) {
  if (!header) return { ok: false, reason: 'missing header' };
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2),
  );
  const t = parseInt(parts.t, 10);
  if (!Number.isFinite(t)) return { ok: false, reason: 'no timestamp' };

  const age = Math.floor(Date.now() / 1000) - t;
  if (age > TOLERANCE_SECONDS) return { ok: false, reason: `timestamp too old (${age}s)` };
  if (age < -CLOCK_SKEW_SECONDS) return { ok: false, reason: `timestamp in the future (${-age}s)` };

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = hexToBytes(bytesToHex(sig));
  const provided = hexToBytes(parts.v1 || '');
  if (!provided || !timingSafeEqual(expected, provided)) return { ok: false, reason: 'no v1 match' };
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Reading a Stripe subscription. All pure, all exported for the harness.
// ──────────────────────────────────────────────────────────────────────────

/** The uid, from subscription/session metadata. Never from anything the client could set. */
export function extractUid(obj) {
  const m = obj?.metadata || {};
  if (typeof m.uid === 'string' && m.uid) return m.uid;
  if (typeof obj?.client_reference_id === 'string' && obj.client_reference_id) return obj.client_reference_id;
  return null;
}

/** The Price id on a subscription's first item — what the member is actually paying for. */
export function extractPriceId(subscription) {
  const item = subscription?.items?.data?.[0];
  const price = item?.price;
  if (typeof price === 'string') return price;
  if (typeof price?.id === 'string') return price.id;
  return null;
}

export const asId = (v) => (typeof v === 'string' && v ? v : (typeof v?.id === 'string' ? v.id : null));

/**
 * Stripe's subscription status → ours.
 *
 * 'past_due' and 'unpaid' both map to past_due and BOTH KEEP THE TIER. Only an explicit
 * deletion writes 'free', and it does so through the downgrade path rather than here.
 */
export function mapStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
    case 'trialing': return 'active';
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'canceled':
    case 'incomplete_expired': return 'cancelled';
    default: return null;
  }
}

/**
 * Build the detail record for a subscription, preserving what must not be restamped.
 *
 * `existing` is the stored record. foundingSince comes from it whenever it is already set —
 * a member's founding date is the day they joined, and an upgrade six months later must not
 * move it. `founding` is recomputed from the CURRENT price, because that is the only thing
 * that can tell us whether an upgrade landed on a founding price or fell off the generation.
 */
export function detailForSubscription({ subscription, existing, mode, now }) {
  const priceId = extractPriceId(subscription);
  const described = describePrice(priceId, mode);
  const founding = !!described && described.generation === 'founding';
  // W3 / MON-06: item-level on dahlia, top-level before basil. subscriptionPeriodEnd reads both.
  const periodEndS = subscriptionPeriodEnd(subscription);
  const periodEnd = typeof periodEndS === 'number' ? periodEndS * 1000 : null;

  return {
    detail: buildDetail({
      tier: described ? described.tier : null,
      interval: described ? described.interval : null,
      currency: described ? described.currency : (subscription?.currency || null),
      rail: 'stripe',
      status: mapStatus(subscription?.status),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end === true,
      founding,
      // PRESERVED, never restamped. The one field an upgrade must not touch.
      foundingSince: (existing && typeof existing.foundingSince === 'number')
        ? existing.foundingSince
        : (founding ? now : null),
      invoiceRef: null,
      refs: {
        stripeSubscriptionId: asId(subscription?.id),
        stripeCustomerId: asId(subscription?.customer),
        stripePriceId: priceId,
        priceGeneration: described ? described.generation : null,
      },
      pass: existing && typeof existing.pass === 'object' ? existing.pass : null,
      now,
    }),
    described,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Handlers.
// ──────────────────────────────────────────────────────────────────────────

/** The LIVE subscription. Throws (→ 500 → Stripe retries) on anything but a clean answer. */
async function fetchSubscription(env, subscriptionId) {
  const r = await stripe(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!r.ok) throw new MoneyTransientError(`subscription ${subscriptionId} fetch failed: ${r.status} ${r.body?.error?.message || ''}`);
  return r.body;
}

/**
 * Cancel a subscription NOW, at Stripe. Idempotent: an already-cancelled or missing
 * subscription is success. No proration, no refund — a refund is a separate, deliberate act.
 */
export async function cancelStripeSubscription(env, subscriptionId) {
  const r = await stripe(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' });
  if (r.ok) return 'cancelled';
  if (r.status === 404 || r.body?.error?.code === 'resource_missing') return 'absent';
  if (/cancel/i.test(r.body?.error?.message || '')) return 'already';
  throw new MoneyTransientError(`Stripe cancel ${subscriptionId} failed: ${r.status} ${r.body?.error?.message || ''}`);
}

/**
 * Apply a subscription's current state. Shared by completed / invoice.paid / updated /
 * payment_failed, because all of them mean the same thing to us: this is the subscription, this
 * is what it now confers. ALWAYS the live object (MON-14): an event's own copy can be older than
 * what is already stored.
 */
async function applySubscription(env, getToken, { subscription, uid, invoiceRef, now, newSubscription = false }) {
  const mode = modeOf(env.STRIPE_SECRET_KEY);
  const token = await getToken();
  let existing = null;
  try { existing = await readDetail(env, token, uid); } catch { /* applyMembershipChange re-reads, and throws */ }

  const { detail, described } = detailForSubscription({ subscription, existing, mode, now });
  const subId = asId(subscription?.id);

  if (!described) {
    // An unattributable price. REFUSE to guess a tier: guessing up hands out Platinum, guessing
    // down takes away Gold.
    return {
      verdict: 'review', uid, ref: subId,
      why: `${LABEL}: subscription ${subId} for ${uid} is on price ${extractPriceId(subscription) || '—'}, which is not in the ${mode} price book. Nothing was written.`,
    };
  }

  return applyMembershipChange(env, token, uid, {
    kind: 'grant',
    invoiceRef,
    subRef: subId,
    customerRef: asId(subscription?.customer),
    newSubscription,
    cancelAtProvider: () => cancelStripeSubscription(env, subId),
    detail: { ...detail, lastInvoiceRef: invoiceRef || (existing && typeof existing.lastInvoiceRef === 'string' ? existing.lastInvoiceRef : null) },
    label: LABEL,
    now,
  });
}

/**
 * Is this payment-mode session a PASS of ours?
 *
 * Read from the session's own metadata, which pass-checkout.js sets, and never inferred from
 * "mode is payment and there is no titleId" — that shape is also what a broken book purchase
 * looks like, and the bookstore's unattributable-session error is a real signal that must keep
 * working. An explicit marker keeps the two apart.
 */
export const isPassSession = (session) =>
  session?.mode === 'payment' && session?.metadata?.kind === 'pass';

/**
 * A pass purchase. Writes memberships/{uid}/pass and NOTHING else — no scalar, no billing row.
 *
 * The kind comes from session metadata, which only this server set; the DURATION and the TIER
 * come from the catalogue, never from the event. An event-supplied duration would be a
 * client-supplied duration the moment anyone could forge a session.
 *
 * ⚠ NEVER GATE THIS ON MEMBERSHIPS_ON_SALE (ruling, live-money preflight, 23 Sep 2026). The
 * on-sale gate lives at checkout CREATION (_onSale.js) and nowhere downstream of a payment. A
 * completed pass session means money has moved: the reader gets what they paid for. Taking money
 * and delivering nothing is worse than a pass sold before its day. The same holds for the
 * subscription grant below.
 */
async function handlePassCompleted(env, getToken, session, now) {
  const uid = extractUid(session);
  if (!uid) {
    console.error(`[${LABEL}] pass session ${session.id} carries no uid — nothing recorded`);
    return { verdict: 'review' };
  }
  const kind = session?.metadata?.passKind;
  if (!isPassKind(kind)) {
    console.error(`[${LABEL}] pass session ${session.id} for ${uid} has unknown passKind=${kind || '—'} — nothing recorded`);
    return { verdict: 'review' };
  }
  // Money must have actually moved. A delayed-payment method reaches 'completed' unpaid and
  // follows later with async_payment_succeeded — the lesson R9.2 PL-3 taught the bookstore.
  if (session.payment_status && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    console.error(
      `[${LABEL}] pass session ${session.id} for ${uid} has payment_status=${session.payment_status} — NOT granted`,
    );
    return { verdict: 'ignored' };
  }

  const token = await getToken();
  // The session id is the replay key: it is stable across Stripe's redeliveries of the same
  // event and unique per purchase, which is exactly what an extend-on-write needs.
  const ref = session.id;
  return applyPassPurchase(env, token, uid, {
    ref,
    label: LABEL,
    buildPassFor: (existing) => buildPass({
      kind,
      currency: session.currency || null,
      rail: 'stripe',
      ref,
      existing,
      now,
    }),
  });
}

async function handleCheckoutCompleted(env, getToken, session, now) {
  // OURS, and the one payment-mode session this endpoint claims. Checked before the mode
  // guard below, which would otherwise send every pass straight to 'ignored'.
  if (isPassSession(session)) return handlePassCompleted(env, getToken, session, now);

  // Not ours — the bookstore endpoint owns every other payment-mode session.
  if (session?.mode !== 'subscription') return { verdict: 'ignored' };

  const uid = extractUid(session);
  if (!uid) return { verdict: 'review', ref: session.id, why: `${LABEL}: subscription session ${session.id} carries no uid. Nothing recorded.` };
  const subscriptionId = asId(session.subscription);
  if (!subscriptionId) return { verdict: 'review', uid, ref: session.id, why: `${LABEL}: session ${session.id} for ${uid} carries no subscription. Nothing recorded.` };
  // THE CUSTOMER ID IS BORN HERE. The subscription object carries it, and fetching the
  // subscription is also how the Price is read rather than trusted from the session.
  const subscription = await fetchSubscription(env, subscriptionId);
  return applySubscription(env, getToken, {
    subscription, uid, invoiceRef: asId(session.invoice), now, newSubscription: true,
  });
}

/** MON-15 — a delayed-method pass settles here, not at completed. */
async function handleAsyncSucceeded(env, getToken, session, now) {
  if (!isPassSession(session)) return { verdict: 'ignored' };
  return handlePassCompleted(env, getToken, session, now);
}

async function handleInvoicePaid(env, getToken, invoice, now) {
  // MON-06: on dahlia the subscription lives at invoice.parent.subscription_details. Reading only
  // invoice.subscription ignored EVERY renewal as "a one-off invoice".
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { verdict: 'ignored' };   // a one-off invoice is not ours
  const subscription = await fetchSubscription(env, subscriptionId);
  const uid = extractUid(subscription) || invoiceSubscriptionUid(invoice);
  if (!uid) return { verdict: 'review', ref: invoice.id, why: `${LABEL}: invoice ${invoice.id} on ${subscriptionId} has no uid. Nothing recorded.` };
  return applySubscription(env, getToken, { subscription, uid, invoiceRef: asId(invoice.id), now });
}

async function handleSubscriptionUpdated(env, getToken, eventSubscription, now) {
  // MON-14: the LIVE subscription, never the event's copy. Stripe does not order deliveries, so
  // an update from before a cancellation can arrive after it.
  const subscription = await fetchSubscription(env, asId(eventSubscription?.id));
  const uid = extractUid(subscription);
  if (!uid) return { verdict: 'review', ref: asId(subscription?.id), why: `${LABEL}: subscription ${asId(subscription?.id)} has no uid. Nothing recorded.` };
  // NO invoiceRef: an update is not a payment, so it must not consume the replay key.
  return applySubscription(env, getToken, { subscription, uid, invoiceRef: null, now });
}

/** The dunning event. Records the state; NEVER touches the tier. */
async function handlePaymentFailed(env, getToken, invoice, now) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { verdict: 'ignored' };
  const subscription = await fetchSubscription(env, subscriptionId);
  const uid = extractUid(subscription) || invoiceSubscriptionUid(invoice);
  if (!uid) return { verdict: 'review', ref: invoice.id, why: `${LABEL}: failed invoice ${invoice.id} on ${subscriptionId} has no uid.` };
  console.log(`[${LABEL}] payment failed for ${uid} on ${subscriptionId} — recording past_due, tier UNCHANGED`);
  return applySubscription(env, getToken, { subscription, uid, invoiceRef: null, now });
}

/** THE AUTHORITATIVE DOWNGRADE. Matched on the SUBSCRIPTION alone (MON-02). */
async function handleSubscriptionDeleted(env, getToken, subscription, now) {
  const uid = extractUid(subscription);
  if (!uid) return { verdict: 'review', ref: asId(subscription?.id), why: `${LABEL}: deleted subscription ${asId(subscription?.id)} has no uid. Nothing revoked.` };
  const token = await getToken();
  let existing = null;
  try { existing = await readDetail(env, token, uid); } catch { /* applyMembershipChange re-reads, and throws */ }

  return applyMembershipChange(env, token, uid, {
    kind: 'downgrade',
    subRef: asId(subscription?.id),
    customerRef: asId(subscription?.customer),
    endedReason: 'provider',
    detail: buildDetail({
      tier: 'free',
      rail: 'stripe',
      status: 'cancelled',
      // The founding facts SURVIVE a cancellation. A member who leaves and comes back within
      // the founding window is still a founding member.
      founding: !!(existing && existing.founding === true),
      foundingSince: existing && typeof existing.foundingSince === 'number' ? existing.foundingSince : null,
      refs: {
        stripeCustomerId: existing && typeof existing.stripeCustomerId === 'string' ? existing.stripeCustomerId : null,
      },
      now,
    }),
    label: LABEL,
    now,
  });
}

/**
 * W3 / MON-12 — refunds and disputes. Ikenna's ruling, 24 Sep 2026:
 *   a FULL refund ends a membership or a pass immediately; a dispute is treated the same;
 *   a PARTIAL refund on a membership or pass changes nothing (only books were ruled on, and the
 *   ruling there — partial keeps — is the same shape).
 * A book's charge carries metadata.titleId and is the bookstore endpoint's; this one ignores it.
 */
async function handleRefundOrDispute(env, getToken, obj, now, eventType) {
  const dispute = eventType === 'charge.dispute.created';
  let charge = obj;
  if (dispute) {
    const r = await stripe(env, `/charges/${encodeURIComponent(asId(obj.charge))}`);
    if (!r.ok) throw new MoneyTransientError(`charge ${asId(obj.charge)} fetch failed: ${r.status}`);
    charge = r.body;
  }
  const meta = charge?.metadata || {};
  if (meta.titleId) return { verdict: 'ignored' };
  const full = dispute || charge?.refunded === true;
  const reason = dispute ? 'disputed' : 'refunded';
  const pi = asId(charge?.payment_intent);

  if (meta.kind === 'pass') {
    const uid = typeof meta.uid === 'string' && meta.uid ? meta.uid : null;
    if (!uid || !pi) return { verdict: 'review', ref: charge?.id, why: `${LABEL}: ${reason} pass charge ${charge?.id} has no uid or payment intent.` };
    if (!full) {
      console.log(`[${LABEL}] PARTIAL refund on pass charge ${charge.id} for ${uid} — the pass is kept`);
      return { verdict: 'kept' };
    }
    const sessions = await stripe(env, '/checkout/sessions', { query: { payment_intent: pi, limit: '1' } });
    if (!sessions.ok) throw new MoneyTransientError(`session lookup for ${pi} failed: ${sessions.status}`);
    const sessionId = sessions.body?.data?.[0]?.id;
    if (!sessionId) return { verdict: 'review', uid, ref: pi, why: `${LABEL}: ${reason} pass charge ${charge.id} for ${uid} — no Checkout Session found for ${pi}. The pass was NOT ended.` };
    return endPassNow(env, await getToken(), uid, { ref: sessionId, reason, label: LABEL, now });
  }

  // A subscription payment? Dahlia links a payment to its invoice through InvoicePayments.
  let invoiceId = asId(charge?.invoice);
  if (!invoiceId && pi) {
    const ip = await stripe(env, '/invoice_payments', { query: { 'payment[type]': 'payment_intent', 'payment[payment_intent]': pi, limit: '1' } });
    if (!ip.ok) throw new MoneyTransientError(`invoice payment lookup for ${pi} failed: ${ip.status}`);
    invoiceId = asId(ip.body?.data?.[0]?.invoice);
  }
  if (!invoiceId) return { verdict: 'ignored' };
  const inv = await stripe(env, `/invoices/${encodeURIComponent(invoiceId)}`);
  if (!inv.ok) throw new MoneyTransientError(`invoice ${invoiceId} fetch failed: ${inv.status}`);
  const subId = invoiceSubscriptionId(inv.body);
  if (!subId) return { verdict: 'ignored' };
  const subscription = await fetchSubscription(env, subId);
  const uid = extractUid(subscription) || invoiceSubscriptionUid(inv.body);
  if (!uid) return { verdict: 'review', ref: subId, why: `${LABEL}: ${reason} on subscription ${subId} — no uid. The membership was NOT ended.` };
  if (!full) {
    console.log(`[${LABEL}] PARTIAL refund on ${subId} for ${uid} — the membership is kept`);
    return { verdict: 'kept' };
  }
  return endMembershipNow(env, await getToken(), uid, {
    subRef: subId, reason, rail: 'stripe', label: LABEL, now,
    cancelAtProvider: () => cancelStripeSubscription(env, subId),
  });
}

const HANDLERS = {
  'checkout.session.completed': handleCheckoutCompleted,
  'checkout.session.async_payment_succeeded': handleAsyncSucceeded,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_succeeded': handleInvoicePaid,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'invoice.payment_failed': handlePaymentFailed,
  'charge.refunded': handleRefundOrDispute,
  'charge.dispute.created': handleRefundOrDispute,
};

/** The events the endpoint must be subscribed to — scripts/money/stripe-webhooks.mjs reads this. */
export const MEMBERSHIP_EVENTS = Object.keys(HANDLERS);

export async function onRequestPost(context) {
  const { request, env } = context;

  const sigHeader = request.headers.get('Stripe-Signature');
  if (!sigHeader) return new Response('Missing Stripe-Signature', { status: 400 });
  if (!env.STRIPE_MEMBERSHIP_WEBHOOK_SECRET) {
    console.error(`[${LABEL}] STRIPE_MEMBERSHIP_WEBHOOK_SECRET is not set`);
    return new Response('Server misconfigured', { status: 500 });
  }
  if (!env.STRIPE_SECRET_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] missing STRIPE_SECRET_KEY or Firebase service-account vars`);
    return new Response('Server misconfigured', { status: 500 });
  }

  const rawBody = await request.text();
  const verification = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_MEMBERSHIP_WEBHOOK_SECRET);
  if (!verification.ok) {
    // MON-21: the reason is LOGGED, never returned — it can carry signature material.
    console.error(`[${LABEL}] signature verification failed:`, verification.reason);
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const obj = event?.data?.object;
  if (!obj) return new Response('Missing data.object', { status: 400 });

  const handler = HANDLERS[event.type];
  if (!handler) return json({ received: true, ignored: event.type });

  // Past this line the request is provably from Stripe. W3 / MON-04: a failure a retry could
  // fix answers 500 so Stripe redelivers (every handler is idempotent); a verdict a retry
  // cannot fix answers 200 — and both land in ops/money_failures and Ikenna's inbox.
  //
  // THE TOKEN IS MINTED LAZILY, and memoised: most traffic here is the bookstore's, and ignored.
  let cached = null;
  const getToken = async () => (cached ||= await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY));
  return settleWebhook(env, {
    run: () => handler(env, getToken, obj, Date.now(), event.type),
    rail: 'stripe', eventType: event.type, eventKey: event.id || obj.id, label: LABEL, json,
  });
}
