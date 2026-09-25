// MEMBERSHIP — Paystack event handling.
//
// NOT A ROUTE, and it cannot be one. PAYSTACK ALLOWS EXACTLY ONE WEBHOOK URL PER ACCOUNT,
// shared by test and live (they are told apart by `domain` on the payload, not by the URL).
// So membership events cannot have an endpoint of their own the way the Stripe rail does —
// they arrive at whatever single URL is configured, which is already
// functions/api/bookstore/paystack-webhook.js.
//
// That webhook therefore DELEGATES here. The alternative — repointing the dashboard URL at a
// new dispatcher — would mean a cutover on a live money path in exchange for nothing, so the
// URL stays where it is, the signature is verified once by the existing endpoint, and this
// module owns every membership decision.
//
// ── TELLING THE TWO RAILS APART ──────────────────────────────────────────────────────────
//
// `charge.success` is shared: it is a book purchase AND a membership's first charge AND every
// membership renewal. Two signals separate them, and both are ours rather than inferred:
//
//   1. the reference prefix — `ms.` is membership, `cs.` is a book. Ours on the first charge.
//   2. a `plan` object on the payload — a book purchase never has one. Paystack's own data,
//      and the signal that still works on a renewal, whose reference is Paystack's.
//
// ── THE RENEWAL IDENTITY GAP, AND HOW IT CLOSES ──────────────────────────────────────────
//
// THE PROBLEM. The bookstore rail can reconstruct uid + titleId from the reference alone
// because WE mint it. That holds for a membership's first charge and for nothing after it:
// every recurring charge carries a reference Paystack generated, which matches neither
// PAYSTACK_REF_RE nor MEMBERSHIP_REF_RE. Metadata is no answer either — Paystack makes no
// promise it survives onto a recurring charge, and the bookstore webhook's own header already
// records that as the reason its reference is self-describing in the first place.
//
// THE RESOLUTION. The first charge is self-describing, so it is used to SEED AN INDEX:
//
//   paystack_membership_index/{code} = uid
//
// keyed by BOTH identifiers Paystack puts on later events — the customer code (`CUS_…`) and
// the subscription code (`SUB_…`). Both are opaque and globally unique, so one flat node holds
// both without collision. Every later event resolves its uid through it.
//
// ON AN INDEX MISS, NOTHING IS WRITTEN and a human is asked. The tempting fallback is
// customer.email → uid, and it is refused: an email is mutable, a reader may change theirs in
// Paystack, and two accounts can share one address. Guessing an identity wrong here does not
// fail loudly — it silently grants somebody else's membership to the wrong reader.
//
// ORDERING CAVEAT — and R10.5 stated this WRONG, which a live test-card run corrected.
//
// The original claim was: if subscription.create arrives before charge.success, that one event
// reviews and "the charge behind it recovers". THE CHARGE CANNOT RECOVER THE SUBSCRIPTION
// CODE. Measured against a real Paystack transaction: charge.success carries the customer code
// and the plan, and NO subscription code at all. So the first charge can only ever seed
// `CUS_…`; `SUB_…` arrives on a subscription-shaped event and nowhere else.
//
// In practice that resolved itself in the live run — subscription.not_renew carried the
// customer code, which was already indexed, so the subscription code was seeded then. But it
// left one narrow hole: a subscription-shaped event carrying ONLY a subscription code, before
// that code was ever indexed, is unattributable. A cancellation is the case that matters, and
// the consequence is a cancelled member keeping their tier until somebody looks.
//
// subscriptionOwner() below closes it. On an index miss for a subscription code, it ASKS
// PAYSTACK who the subscription belongs to and retries the index with the customer code that
// comes back. That is a lookup, not a guess — the authenticated provider is telling us, which
// is the whole difference between this and the email fallback refused above.

import { dbBase, FIREBASE_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import {
  applyMembershipChange, applyPassPurchase, readDetail, buildDetail, endMembershipNow, endPassNow,
  endedUpdate, currentSubscriptionRef, DETAIL_PATH,
} from './_membership.js';
import { MoneyTransientError } from '../_money.js';
import {
  buildPass, parsePassReference, isPassReference, PAYSTACK_PASS_CURRENCY,
} from '../../../app/lib/membershipPasses.js';
import {
  describePlan, modeOf, domainOf, parseMembershipReference, isMembershipReference,
} from './paystack-plans.js';

const LABEL = 'membership/paystack';

export const INDEX_PATH = (code) => `paystack_membership_index/${code}`;

// W3: refund- and dispute-shaped events. Ours when the reference is `ms.`/`mp.`, or when the
// transaction behind a Paystack-generated reference carries a plan (a renewal); the bookstore
// webhook hands us every such event whose reference is not a book's `cs.`.
export const REFUND_EVENTS = new Map([
  ['refund.processed', 'refunded'],
  ['charge.dispute.create', 'disputed'],
  ['dispute.create', 'disputed'],
  ['charge.reversed', 'reversed'],
]);

// W3 / MON-02: how long an upgrade recorded at checkout may sanction the new subscription.
export const UPGRADE_WINDOW_MS = 2 * 24 * 3600 * 1000;

/** Membership events that are ours outright, whatever else is on the payload. */
export const MEMBERSHIP_EVENTS = new Set([
  'subscription.create',
  'subscription.disable',
  'subscription.not_renew',
  'invoice.create',
  'invoice.update',
  'invoice.payment_failed',
]);

// ──────────────────────────────────────────────────────────────────────────
// Reading a Paystack payload. All pure, all exported for the harness — Paystack's shapes vary
// by event type more than Stripe's do, so every extractor checks several plausible homes.
// ──────────────────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' && v ? v : null);

export const planCodeFromEvent = (d) =>
  str(d?.plan?.plan_code) || str(d?.plan_object?.plan_code) || str(d?.subscription?.plan?.plan_code)
  || str(d?.plan) || null;

export const subscriptionCodeFromEvent = (d) =>
  str(d?.subscription_code) || str(d?.subscription?.subscription_code) || null;

export const customerCodeFromEvent = (d) =>
  str(d?.customer?.customer_code) || str(d?.subscription?.customer?.customer_code)
  || str(d?.customer_code) || null;

export const referenceFromEvent = (d) =>
  str(d?.reference) || str(d?.transaction?.reference) || str(d?.transaction_reference)
  || str(d?.data?.reference) || null;

/**
 * The idempotency reference for a membership payment. INVOICE FIRST, never the subscription.
 *
 * Paystack gives an `invoice_code` on invoice events and a per-charge `reference` on
 * charge.success. Both change every period, which is the property that matters — keyed on the
 * subscription code every renewal would read as a replay and a paying member's period end
 * would freeze on the day they joined. See _membership.js for the full argument.
 */
export const invoiceRefFromEvent = (d) =>
  str(d?.invoice_code) || str(d?.transaction?.reference) || str(d?.reference) || null;

/** Is this payload a membership's business rather than a book's? */
export function isMembershipEvent(eventName, data) {
  if (MEMBERSHIP_EVENTS.has(eventName)) return true;
  if (isMembershipReference(referenceFromEvent(data))) return true;
  // R11.3 — a PASS charge. It is the hardest of the three to recognise and the reference is the
  // only thing that can do it: a pass is initialized with no plan, so there is no plan object,
  // and it creates no subscription, so there is no subscription code. `mp.` is the whole signal.
  // A book charge carries `cs.` and cannot match, so this cannot divert a purchase.
  if (isPassReference(referenceFromEvent(data))) return true;
  // A renewal: Paystack's own reference, but a plan object a book purchase never has.
  return !!planCodeFromEvent(data);
}

/** Paystack's subscription status → ours. `attention` is their dunning state. */
export function mapStatus(paystackStatus) {
  switch (paystackStatus) {
    case 'active': return 'active';
    case 'attention':
    case 'pending': return 'past_due';
    case 'cancelled':
    case 'complete':
    case 'non-renewing': return 'cancelled';
    default: return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// The index.
// ──────────────────────────────────────────────────────────────────────────

export async function readIndex(env, token, code) {
  const res = await fetch(`${dbBase(env)}/${INDEX_PATH(encodeURIComponent(code))}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`index GET failed: ${res.status}`);
  return res.json();
}

/**
 * Point every identifier on this event at the uid. One root PATCH, so a customer code and a
 * subscription code learned in the same breath cannot half-land.
 */
export async function seedIndex(env, token, uid, codes) {
  const body = {};
  for (const code of codes) if (typeof code === 'string' && code) body[INDEX_PATH(code)] = uid;
  if (!Object.keys(body).length) return null;
  const res = await fetch(`${dbBase(env)}/.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`index PATCH failed: ${res.status}`);
  return body;
}

/**
 * The uid for this event: the reference if it is ours, otherwise the index.
 *
 * Returns { uid, via } so the caller can log HOW an identity was established — which is the
 * first thing anybody debugging a mis-attributed membership will want.
 */
export async function resolveUid(env, token, data) {
  const parsed = parseMembershipReference(referenceFromEvent(data));
  if (parsed) return { uid: parsed.uid, via: 'reference' };

  const subCode = subscriptionCodeFromEvent(data);
  for (const [via, code] of [
    ['subscription_code', subCode],
    ['customer_code', customerCodeFromEvent(data)],
  ]) {
    if (!code) continue;
    let uid;
    try {
      uid = await readIndex(env, token, code);
    } catch (e) {
      // W3: a failed read is not a miss. A miss sends the event to a human; a failed read just
      // needs the provider to try again.
      throw new MoneyTransientError(`[${LABEL}] index read failed for ${code}: ${e.message || e}`);
    }
    if (typeof uid === 'string' && uid) return { uid, via };
  }

  // LAST RESORT, and it is a lookup rather than a guess: ask Paystack who owns this
  // subscription, then try the index again with the customer code it returns. Reached only
  // when a subscription-shaped event carries no customer code AND its own code was never
  // indexed — the narrow hole the live run exposed. See the ordering note in the header.
  if (subCode) {
    const owner = await subscriptionOwner(env, subCode);
    if (owner) {
      let uid;
      try { uid = await readIndex(env, token, owner); }
      catch (e) { throw new MoneyTransientError(`[${LABEL}] index read failed for ${owner}: ${e.message || e}`); }
      if (typeof uid === 'string' && uid) return { uid, via: 'subscription_lookup' };
    }
  }
  return { uid: null, via: null };
}

/** The customer code owning a subscription, straight from Paystack. Never throws. */
export async function subscriptionOwner(env, subscriptionCode) {
  try {
    const res = await fetch(`https://api.paystack.co/subscription/${encodeURIComponent(subscriptionCode)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const body = await res.json();
    if (!res.ok || body?.status !== true) return null;
    return str(body?.data?.customer?.customer_code);
  } catch (e) {
    console.error(`[${LABEL}] subscription lookup failed for ${subscriptionCode}:`, e.message || e);
    return null;
  }
}

const paystackHeaders = (env) => ({ Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' });

async function paystackGet(env, path) {
  const res = await fetch(`https://api.paystack.co${path}`, { headers: paystackHeaders(env), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  const body = await res.json().catch(() => null);
  return { ok: res.ok && body?.status === true, status: res.status, body };
}

/**
 * Stop a Paystack subscription renewing. The same call the reader's Cancel button makes
 * (functions/api/membership/paystack-cancel.js) and account deletion makes.
 *
 * Measured 25 Sep 2026 in test mode: /subscription/disable does NOT end the subscription. It
 * moves it to `non-renewing` with cancelledAt = next_payment_date, fires subscription.not_renew
 * now, and subscription.disable at the period end. So access to the end of the paid period is
 * Paystack's own behaviour, not something we emulate.
 *
 * The email_token is fetched on demand, never stored: memberships/{uid} is owner-readable and
 * the token is a capability. Idempotent — a subscription already non-renewing, cancelled or
 * complete is success. Returns { status, nextPaymentDate }. Throws on a transient failure.
 */
export async function disablePaystackSubscription(env, code) {
  const got = await paystackGet(env, `/subscription/${encodeURIComponent(code)}`);
  if (!got.ok || !got.body?.data) throw new MoneyTransientError(`Paystack fetch ${code} failed: ${got.status} ${got.body?.message || ''}`);
  const sub = got.body.data;
  const nextPaymentDate = str(sub.next_payment_date) || str(sub.cancelledAt) || null;
  if (sub.status !== 'active' && sub.status !== 'attention') return { status: sub.status, nextPaymentDate, already: true };
  const res = await fetch('https://api.paystack.co/subscription/disable', {
    method: 'POST', headers: paystackHeaders(env),
    body: JSON.stringify({ code, token: sub.email_token }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== true) throw new MoneyTransientError(`Paystack disable ${code} failed: ${res.status} ${body?.message || ''}`);
  return { status: str(body?.data?.status) || 'non-renewing', nextPaymentDate, customer: str(sub.customer?.customer_code) };
}

/**
 * Is this grant the new half of an upgrade that the checkout recorded? paystack-checkout.js
 * writes memberships/{uid}/upgrade = { from, plan, at } when a live member picks another plan;
 * the new subscription is sanctioned only on THAT plan, replacing THAT subscription, recently.
 */
export function upgradeSanctions(existing, planCode, now = Date.now()) {
  const u = existing && typeof existing === 'object' ? existing.upgrade : null;
  if (!u || typeof u !== 'object') return false;
  return u.plan === planCode && u.from === currentSubscriptionRef(existing)
    && typeof u.at === 'number' && now - u.at < UPGRADE_WINDOW_MS;
}

// ──────────────────────────────────────────────────────────────────────────
// Refunds (W3 / MON-12).
// ──────────────────────────────────────────────────────────────────────────

/**
 * A refund or dispute on a membership or pass charge. Ruling (Ikenna, 24 Sep 2026): a FULL
 * refund ends the membership or pass now; a partial one changes nothing. A dispute ends it.
 *
 * Paystack refunds can land DAYS after they are raised (3–10 working days live), so this is
 * written to be correct whenever it arrives: the transaction is re-read from Paystack, never
 * trusted from the event, and the subscription it paid for is ended only if it is still current.
 */
export async function handleMembershipRefund(env, getToken, event, now = Date.now()) {
  const data = event?.data || {};
  const reason = REFUND_EVENTS.get(event?.event);
  if (event?.event === 'refund.processed' || reason === 'refunded') {
    if (data.status && data.status !== 'processed') return { verdict: 'ignored' };
  }
  const ref = referenceFromEvent(data);
  if (!ref) return { verdict: 'review', why: `${LABEL}: ${event?.event} names no transaction. Nothing ended.` };

  const v = await paystackGet(env, `/transaction/verify/${encodeURIComponent(ref)}`);
  if (!v.ok || !v.body?.data) throw new MoneyTransientError(`verify ${ref} failed: ${v.status} ${v.body?.message || ''}`);
  const txn = v.body.data;
  const refundAmount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
  const full = reason !== 'refunded' || !(Number.isFinite(refundAmount) && refundAmount < txn.amount);

  const pass = parsePassReference(ref);
  if (pass) {
    if (!full) { console.log(`[${LABEL}] PARTIAL refund on pass ${ref} — the pass is kept`); return { verdict: 'kept' }; }
    return endPassNow(env, await getToken(), pass.uid, { ref, reason, label: LABEL, now });
  }

  const planCode = str(txn?.plan?.plan_code) || str(txn?.plan) || null;
  const firstCharge = parseMembershipReference(ref);
  if (!firstCharge && !planCode) return { verdict: 'ignored' };   // not a membership charge

  const token = await getToken();
  const { uid } = firstCharge ? { uid: firstCharge.uid } : await resolveUid(env, token, { customer: txn.customer });
  if (!uid) return { verdict: 'review', ref, why: `${LABEL}: ${reason} on membership charge ${ref}, but no reader could be found for customer ${txn?.customer?.customer_code || '—'}. Nothing ended.` };
  if (!full) { console.log(`[${LABEL}] PARTIAL refund on ${ref} for ${uid} — the membership is kept`); return { verdict: 'kept' }; }

  let existing;
  try { existing = await readDetail(env, token, uid); }
  catch (e) { throw new MoneyTransientError(`detail read failed for ${uid}: ${e.message || e}`); }
  let subRef = currentSubscriptionRef(existing);
  if (existing && existing.paystackPlanCode && planCode && existing.paystackPlanCode !== planCode) {
    return {
      verdict: 'refund_unmatched', uid, ref,
      why: `${LABEL}: ${reason} on ${ref} (${planCode}) for ${uid}, but the live membership is on ${existing.paystackPlanCode}. Nothing ended — check whether the refunded plan was already replaced.`,
    };
  }
  if (!subRef) {
    // The subscription.create that names it has not landed. Ask Paystack for this customer's
    // subscription on this plan — a lookup by the provider, not a guess.
    const cus = txn?.customer?.id;
    const list = cus ? await paystackGet(env, `/subscription?customer=${encodeURIComponent(cus)}&plan=${encodeURIComponent(planCode || '')}`) : { ok: false };
    subRef = (list.ok && (list.body.data || []).find((x) => x.status === 'active' || x.status === 'non-renewing' || x.status === 'attention')?.subscription_code) || null;
  }
  if (!subRef) return { verdict: 'review', uid, ref, why: `${LABEL}: ${reason} on ${ref} for ${uid} — no subscription could be identified. Nothing ended.` };
  return endMembershipNow(env, token, uid, {
    subRef, reason, rail: 'paystack', label: LABEL, now,
    cancelAtProvider: () => disablePaystackSubscription(env, subRef),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// The handler.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Handle one membership Paystack event.
 *
 * `getToken` is a factory so no admin token is minted for an event that turns out not to need
 * one. Returns a verdict; never throws for a business decision, so the calling webhook keeps
 * its 200-after-verification response policy.
 */
export async function handleMembershipPaystackEvent(env, getToken, event, now = Date.now()) {
  const data = event?.data || {};
  const name = event?.event;
  const mode = domainOf(event) === 'live' ? 'live' : modeOf(env.PAYSTACK_SECRET_KEY);

  // ── R11.3: THE PASS, HANDLED BEFORE ANYTHING ELSE ────────────────────────
  //
  // First because everything below assumes a subscription. resolveUid() looks the reader up
  // through a subscription or customer code, and a pass has neither; the plan lookup after it
  // refuses anything it cannot name a tier for, and a pass has no plan by construction. Both
  // would send a perfectly good pass to manual review.
  //
  // The uid comes from the REFERENCE, which this server built and Paystack echoed back inside
  // a signed payload — the same trust the bookstore's `cs.` references have always had. The
  // KIND comes from the reference too, and the duration and tier from the catalogue: nothing
  // about what the reader receives is taken from the event body.
  if (REFUND_EVENTS.has(name)) return handleMembershipRefund(env, getToken, event, now);

  const passRef = referenceFromEvent(data);
  const parsedPass = parsePassReference(passRef);
  if (parsedPass) {
    if (name !== 'charge.success') {
      // A pass has no lifecycle beyond its charge. Anything else about one — a refund, a
      // dispute — is a human matter, not a write.
      console.log(`[${LABEL}] ${name} for pass ${passRef} — no automatic action`);
      return { verdict: 'ignored' };
    }
    if (data.status && data.status !== 'success') {
      console.error(`[${LABEL}] pass charge ${passRef} has status=${data.status} — NOT granted`);
      return { verdict: 'ignored' };
    }
    // ⚠ NEVER GATE THIS ON MEMBERSHIPS_ON_SALE (ruling, live-money preflight, 23 Sep 2026).
    // The on-sale gate lives at checkout CREATION (_onSale.js) and nowhere downstream of a
    // payment. If a pass charge arrives here, money has moved: the reader gets the pass they paid
    // for. Taking money and delivering nothing is worse than a pass sold before its day.
    const passToken = await getToken();
    return applyPassPurchase(env, passToken, parsedPass.uid, {
      ref: passRef,
      label: LABEL,
      buildPassFor: (existing) => buildPass({
        kind: parsedPass.kind,
        currency: PAYSTACK_PASS_CURRENCY,
        rail: 'paystack',
        ref: passRef,
        existing,
        now,
      }),
    });
  }

  const token = await getToken();
  const { uid, via } = await resolveUid(env, token, data);
  if (!uid) {
    return {
      verdict: 'review', ref: referenceFromEvent(data) || subscriptionCodeFromEvent(data),
      why: `${LABEL}: ${name} with no reader — reference=${referenceFromEvent(data) || '—'} ` +
        `subscription=${subscriptionCodeFromEvent(data) || '—'} customer=${customerCodeFromEvent(data) || '—'}. ` +
        'Nothing written. An email is NOT used as a fallback on purpose.',
    };
  }

  const subscriptionCode = subscriptionCodeFromEvent(data);
  const customerCode = customerCodeFromEvent(data);

  // Seed the index from anything new on this event. Best-effort: a failure here costs a later
  // event a manual review, never a wrong write.
  try {
    await seedIndex(env, token, uid, [subscriptionCode, customerCode]);
  } catch (e) {
    console.error(`[${LABEL}] index seed failed for ${uid}:`, e.message || e);
  }

  let existing;
  try { existing = await readDetail(env, token, uid); }
  catch (e) { throw new MoneyTransientError(`[${LABEL}] detail read failed for ${uid}: ${e.message || e}`); }

  const keepFounding = {
    founding: !!(existing && existing.founding === true),
    foundingSince: existing && typeof existing.foundingSince === 'number' ? existing.foundingSince : null,
  };

  // ── the downgrade ────────────────────────────────────────────────────────
  // subscription.disable is the authoritative one, the analogue of Stripe's
  // customer.subscription.deleted. Matched on the SUBSCRIPTION CODE (MON-02): after an upgrade
  // the old plan's disable arrives months later on the same customer, and must not take away the
  // new one.
  if (name === 'subscription.disable') {
    return applyMembershipChange(env, token, uid, {
      kind: 'downgrade',
      subRef: subscriptionCode,
      customerRef: customerCode,
      endedReason: 'provider',
      detail: buildDetail({
        tier: 'free', rail: 'paystack', status: 'cancelled',
        // The founding facts survive a cancellation — a returning member is still founding.
        ...keepFounding,
        refs: {
          paystackCustomerCode: customerCode || (existing && str(existing.paystackCustomerCode)),
        },
        now,
      }),
      label: LABEL,
      now,
    });
  }

  // ── everything else needs a plan to name a tier ──────────────────────────
  const planCode = planCodeFromEvent(data) || (existing && str(existing.paystackPlanCode));
  const described = describePlan(planCode, mode);
  if (!described) {
    console.error(
      `[${LABEL}] NEEDS-MANUAL-REVIEW ${name} for ${uid}: plan ${planCode || '—'} is not in the ` +
      `${mode} plan book — nothing written. Guessing a tier would either hand out Platinum or ` +
      `take away Gold.`,
    );
    return { verdict: 'review' };
  }

  // subscription.not_renew is NOT a downgrade. The member has switched off auto-renew and keeps
  // everything they paid for until the period ends; subscription.disable arrives then and does
  // the actual downgrade. Writing 'free' here would take a tier away that is still paid for.
  const notRenewing = name === 'subscription.not_renew';

  // Dunning. invoice.payment_failed records the state and NEVER touches the tier — Paystack
  // retries, and a member whose card failed once is still a member.
  const dunning = name === 'invoice.payment_failed';

  const status = dunning
    ? 'past_due'
    : (notRenewing ? 'active' : (mapStatus(data?.subscription?.status || data?.status) || 'active'));

  // Only a real payment consumes the replay key. An invoice.create or a not_renew is not a
  // payment, and passing the last invoice on one would make the next genuine renewal look like
  // a duplicate.
  const paid = (name === 'charge.success' && data?.status === 'success')
    || (name === 'invoice.update' && data?.paid === true)
    || (name === 'invoice.create' && data?.paid === true);
  const invoiceRef = paid ? invoiceRefFromEvent(data) : null;

  const periodEnd = (() => {
    const raw = data?.next_payment_date || data?.subscription?.next_payment_date || data?.period_end;
    const t = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(t) ? t : null;
  })();

  const firstCharge = name === 'charge.success' && isMembershipReference(referenceFromEvent(data));
  const sameSubscriptionAsStored = !!existing && str(existing.paystackCustomerCode) === customerCode
    && str(existing.paystackPlanCode) === planCode;
  const sanctioned = upgradeSanctions(existing, planCode, now);
  const replacing = sanctioned ? existing.upgrade.from : null;

  // A renewal (Paystack's own reference, no subscription code) for a membership that is already
  // cancelled: money for a period nobody is entitled to. MON-03 — never a re-grant.
  if (paid && !firstCharge && !subscriptionCode && existing && existing.status === 'cancelled') {
    return {
      verdict: 'review', uid, ref: invoiceRef,
      why: `${LABEL}: renewal payment ${invoiceRef || '—'} for ${uid} on ${planCode}, but the membership is CANCELLED. No tier granted. Refund it or reinstate by hand.`,
    };
  }

  // The stored code carries over only when this event is about the same subscription. During an
  // upgrade the stored code is the OLD plan's, and must not be copied onto the new one.
  const storedCode = existing && str(existing.paystackSubscriptionCode);
  const carriedCode = storedCode && storedCode !== replacing ? storedCode : null;

  const detail = buildDetail({
    tier: described.tier,
    interval: described.interval,
    currency: described.currency,
    rail: 'paystack',
    status,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: notRenewing,
    // The plan code IS the price on this rail, so the founding flag is read straight off it.
    founding: described.generation === 'founding',
    // …but the DATE is preserved, never restamped.
    foundingSince: keepFounding.foundingSince ?? (described.generation === 'founding' ? now : null),
    invoiceRef,
    refs: {
      paystackSubscriptionCode: subscriptionCode || carriedCode,
      paystackCustomerCode: customerCode || (existing && str(existing.paystackCustomerCode)),
      paystackPlanCode: planCode,
      planGeneration: described.generation,
    },
    now,
  });

  console.log(`[${LABEL}] ${name} uid=${uid} via=${via} plan=${planCode} tier=${described.tier} status=${status}${replacing ? ` replacing=${replacing}` : ''}`);
  const result = await applyMembershipChange(env, token, uid, {
    kind: 'grant', invoiceRef, detail, label: LABEL, now,
    subRef: subscriptionCode,
    customerRef: customerCode,
    newSubscription: firstCharge && !sameSubscriptionAsStored,
    sanctioned,
    paidAt: (() => { const t = Date.parse(data?.paid_at || data?.paidAt || ''); return Number.isFinite(t) ? t : null; })(),
    cancelAtProvider: subscriptionCode ? () => disablePaystackSubscription(env, subscriptionCode) : null,
  });

  // THE OTHER HALF OF AN UPGRADE: the old plan stops renewing and is tombstoned, and the
  // sanction is spent. Idempotent — whichever of charge.success / subscription.create lands
  // first does it, the other finds it done.
  if (replacing && result.verdict === 'written') {
    await disablePaystackSubscription(env, replacing);
    const res = await fetch(`${dbBase(env)}/.json`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...endedUpdate(uid, replacing, 'replaced', now), [`${DETAIL_PATH(uid)}/upgrade`]: null }),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new MoneyTransientError(`[${LABEL}] upgrade tombstone for ${uid} failed: ${res.status}`);
    console.log(`[${LABEL}] upgrade for ${uid}: ${replacing} disabled and tombstoned`);
  }
  return result;
}
