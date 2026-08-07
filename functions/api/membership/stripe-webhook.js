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
  applyMembershipChange, applyPassPurchase, readDetail, buildDetail, STRIPE_SUB_REF_FIELDS,
} from './_membership.js';
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
  const periodEnd = typeof subscription?.current_period_end === 'number'
    ? subscription.current_period_end * 1000 : null;

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

async function fetchSubscription(env, subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`subscription fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Apply a subscription's current state. Shared by completed / invoice.paid / updated, because
 * all three mean the same thing to us: this is the subscription, this is what it now confers.
 */
async function applySubscription(env, getToken, { subscription, uid, invoiceRef, now }) {
  const mode = modeOf(env.STRIPE_SECRET_KEY);
  const token = await getToken();
  let existing = null;
  try { existing = await readDetail(env, token, uid); } catch { /* applyMembershipChange re-reads and logs */ }

  const { detail, described } = detailForSubscription({ subscription, existing, mode, now });

  if (!described) {
    // An unattributable price. REFUSE to guess a tier: guessing up hands out Platinum, guessing
    // down takes away Gold, and a price we do not recognise means someone created one by hand
    // or this build predates a generation. Loud, and nothing written.
    console.error(
      `[${LABEL}] NEEDS-MANUAL-REVIEW: subscription ${asId(subscription?.id)} for ${uid} is on price ` +
      `${extractPriceId(subscription) || '—'}, which is not in the ${mode} price book — nothing written`,
    );
    return { verdict: 'review' };
  }

  return applyMembershipChange(env, token, uid, {
    kind: 'grant',
    invoiceRef,
    detail: { ...detail, lastInvoiceRef: invoiceRef || detail.lastInvoiceRef || null },
    label: LABEL,
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
  if (!uid) {
    console.error(`[${LABEL}] session ${session.id} carries no uid — nothing recorded`);
    return { verdict: 'review' };
  }
  const subscriptionId = asId(session.subscription);
  if (!subscriptionId) {
    console.error(`[${LABEL}] session ${session.id} for ${uid} carries no subscription — nothing recorded`);
    return { verdict: 'review' };
  }
  // THE CUSTOMER ID IS BORN HERE. The subscription object carries it, and fetching the
  // subscription is also how the Price is read rather than trusted from the session.
  const subscription = await fetchSubscription(env, subscriptionId);
  return applySubscription(env, getToken, {
    subscription, uid, invoiceRef: asId(session.invoice), now,
  });
}

async function handleInvoicePaid(env, getToken, invoice, now) {
  const subscriptionId = asId(invoice?.subscription);
  if (!subscriptionId) return { verdict: 'ignored' };   // a one-off invoice is not ours
  const subscription = await fetchSubscription(env, subscriptionId);
  const uid = extractUid(subscription);
  if (!uid) {
    console.error(`[${LABEL}] invoice ${invoice.id} on ${subscriptionId} has no uid — nothing recorded`);
    return { verdict: 'review' };
  }
  return applySubscription(env, getToken, { subscription, uid, invoiceRef: asId(invoice.id), now });
}

async function handleSubscriptionUpdated(env, getToken, subscription, now) {
  const uid = extractUid(subscription);
  if (!uid) {
    console.error(`[${LABEL}] subscription ${asId(subscription?.id)} has no uid — nothing recorded`);
    return { verdict: 'review' };
  }
  // NO invoiceRef: an update is not a payment, so it must not consume the replay key. Passing
  // the last invoice here would make the next genuine renewal look like a duplicate.
  return applySubscription(env, getToken, { subscription, uid, invoiceRef: null, now });
}

/** The dunning event. Records the state; NEVER touches the tier. */
async function handlePaymentFailed(env, getToken, invoice, now) {
  const subscriptionId = asId(invoice?.subscription);
  if (!subscriptionId) return { verdict: 'ignored' };
  const subscription = await fetchSubscription(env, subscriptionId);
  const uid = extractUid(subscription);
  if (!uid) return { verdict: 'review' };
  console.log(`[${LABEL}] payment failed for ${uid} on ${subscriptionId} — recording past_due, tier UNCHANGED`);
  // applySubscription reads the live subscription, whose status Stripe has already moved to
  // past_due. The tier still comes from the price, so it is preserved by construction.
  return applySubscription(env, getToken, { subscription, uid, invoiceRef: null, now });
}

/** THE AUTHORITATIVE DOWNGRADE — the only path that writes 'free'. */
async function handleSubscriptionDeleted(env, getToken, subscription, now) {
  const uid = extractUid(subscription);
  if (!uid) {
    console.error(`[${LABEL}] deleted subscription ${asId(subscription?.id)} has no uid — nothing revoked`);
    return { verdict: 'review' };
  }
  const token = await getToken();
  let existing = null;
  try { existing = await readDetail(env, token, uid); } catch { /* handled below */ }

  return applyMembershipChange(env, token, uid, {
    kind: 'downgrade',
    refFields: STRIPE_SUB_REF_FIELDS,
    candidates: [asId(subscription?.id), asId(subscription?.customer)].filter(Boolean),
    detail: buildDetail({
      tier: 'free',
      rail: 'stripe',
      status: 'cancelled',
      // The founding facts SURVIVE a cancellation. A member who leaves and comes back within
      // the founding window is still a founding member, and throwing the date away would make
      // that unrecoverable.
      founding: !!(existing && existing.founding === true),
      foundingSince: existing && typeof existing.foundingSince === 'number' ? existing.foundingSince : null,
      refs: {
        stripeCustomerId: existing && typeof existing.stripeCustomerId === 'string' ? existing.stripeCustomerId : null,
      },
      pass: existing && typeof existing.pass === 'object' ? existing.pass : null,
      now,
    }),
    label: LABEL,
  });
}

const HANDLERS = {
  'checkout.session.completed': handleCheckoutCompleted,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_succeeded': handleInvoicePaid,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'invoice.payment_failed': handlePaymentFailed,
};

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
    console.error(`[${LABEL}] signature verification failed:`, verification.reason);
    return new Response(`Invalid signature: ${verification.reason}`, { status: 400 });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const obj = event?.data?.object;
  if (!obj) return new Response('Missing data.object', { status: 400 });

  const handler = HANDLERS[event.type];
  if (!handler) return json({ received: true, ignored: event.type });

  // Past this line the request is provably from Stripe, so every exit is a 200 — the same
  // response policy the bookstore webhook documents. A non-2xx invites a retry storm that
  // cannot fix a Firebase outage.
  //
  // THE TOKEN IS MINTED LAZILY, and memoised. Stripe delivers a great deal of traffic this
  // endpoint ignores — every payment-mode checkout the bookstore rail owns arrives here too —
  // and minting an OAuth token before deciding whether the event is even ours would pay for a
  // round-trip on every one of them.
  try {
    let cached = null;
    const getToken = async () => (cached ||= await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY));
    const result = await handler(env, getToken, obj, Date.now());
    return json({ received: true, verdict: result?.verdict || 'ok' });
  } catch (e) {
    console.error(`[${LABEL}] ${event.type} (${obj.id}) failed:`, e.message || e);
    return json({ received: true, degraded: true });
  }
}
