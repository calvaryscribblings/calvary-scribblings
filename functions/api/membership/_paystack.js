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
// ORDERING CAVEAT, stated because it is real and survivable. Paystack does not guarantee that
// charge.success precedes subscription.create. If subscription.create arrives first the index
// is empty, that one event goes to review, and the charge.success behind it still writes the
// membership and seeds the index — so the subscription code is picked up on the next event
// instead. The member is never wrong, only a log line is.

import { dbBase, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { applyMembershipChange, readDetail, buildDetail } from './_membership.js';
import {
  describePlan, modeOf, domainOf, parseMembershipReference, isMembershipReference,
} from './paystack-plans.js';

const LABEL = 'membership/paystack';

export const INDEX_PATH = (code) => `paystack_membership_index/${code}`;

// Subscription-shaped identifiers, for the downgrade matcher — the analogue of
// STRIPE_SUB_REF_FIELDS.
export const PAYSTACK_SUB_REF_FIELDS = ['paystackSubscriptionCode', 'paystackCustomerCode'];

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
  str(d?.reference) || str(d?.transaction?.reference) || str(d?.data?.reference) || null;

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

  for (const [via, code] of [
    ['subscription_code', subscriptionCodeFromEvent(data)],
    ['customer_code', customerCodeFromEvent(data)],
  ]) {
    if (!code) continue;
    try {
      const uid = await readIndex(env, token, code);
      if (typeof uid === 'string' && uid) return { uid, via };
    } catch (e) {
      console.error(`[${LABEL}] index read failed for ${code}:`, e.message || e);
    }
  }
  return { uid: null, via: null };
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

  const token = await getToken();
  const { uid, via } = await resolveUid(env, token, data);
  if (!uid) {
    console.error(
      `[${LABEL}] NEEDS-MANUAL-REVIEW ${name}: no uid — reference=${referenceFromEvent(data) || '—'} ` +
      `subscription=${subscriptionCodeFromEvent(data) || '—'} customer=${customerCodeFromEvent(data) || '—'} ` +
      `— nothing written. An email is NOT used as a fallback on purpose.`,
    );
    return { verdict: 'review' };
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

  let existing = null;
  try { existing = await readDetail(env, token, uid); } catch { /* applyMembershipChange re-reads */ }

  const keepFounding = {
    founding: !!(existing && existing.founding === true),
    foundingSince: existing && typeof existing.foundingSince === 'number' ? existing.foundingSince : null,
    pass: existing && typeof existing.pass === 'object' ? existing.pass : null,
  };

  // ── the downgrade ────────────────────────────────────────────────────────
  // subscription.disable is the authoritative one, the analogue of Stripe's
  // customer.subscription.deleted. It fails CLOSED against a stale subscription, so a disable
  // for a subscription the member already replaced cannot take away the one they are paying
  // for now.
  if (name === 'subscription.disable') {
    return applyMembershipChange(env, token, uid, {
      kind: 'downgrade',
      refFields: PAYSTACK_SUB_REF_FIELDS,
      candidates: [subscriptionCode, customerCode].filter(Boolean),
      detail: buildDetail({
        tier: 'free', rail: 'paystack', status: 'cancelled',
        // The founding facts survive a cancellation — a returning member is still founding.
        ...keepFounding,
        refs: {
          paystackSubscriptionCode: subscriptionCode,
          paystackCustomerCode: customerCode,
          paystackPlanCode: existing && str(existing.paystackPlanCode),
        },
        now,
      }),
      label: LABEL,
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
      paystackSubscriptionCode: subscriptionCode || (existing && str(existing.paystackSubscriptionCode)),
      paystackCustomerCode: customerCode || (existing && str(existing.paystackCustomerCode)),
      paystackPlanCode: planCode,
      planGeneration: described.generation,
    },
    pass: keepFounding.pass,
    now,
  });

  console.log(`[${LABEL}] ${name} uid=${uid} via=${via} plan=${planCode} tier=${described.tier} status=${status}`);
  return applyMembershipChange(env, token, uid, {
    kind: 'grant', invoiceRef, detail, label: LABEL,
  });
}
