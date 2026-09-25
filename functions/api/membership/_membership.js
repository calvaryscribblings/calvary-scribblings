// THE MEMBERSHIP WRITER — rail-agnostic, and the only thing that writes a reader's tier.
//
// NOT A ROUTE. Cloudflare Pages excludes underscore-prefixed files from Functions routing,
// and this exports no onRequest* handler. Nothing calls it yet: R10.3 wires the Stripe rail
// and R10.4 the Paystack one. It is written and tested first, alone, because the shape it
// commits to is the shape a migration would later have to undo.
//
// ONE WRITER, TWO RAILS, for the reason _lib.js gives for the purchase record it already
// shares: a membership is the only thing standing between a reader and the tier they pay for,
// and two hand-copies of the code that writes it is how a member ends up Gold on the Stripe
// rail and free on the Paystack one.
//
// ── THE ATOMIC PAIR ──────────────────────────────────────────────────────────────────────
//
//   users/{uid}/membership   a STRING: 'free' | 'gold' | 'platinum'   — the app's contract
//   memberships/{uid}        the billing record                        — everything else
//
// BOTH IN ONE MULTI-PATH PATCH AT THE ROOT, always. RTDB applies a multi-path update
// atomically: every path lands or none does. That is the entire reason the two nodes can be
// trusted to agree. Two sequential writes would leave a window — and worse, a durable
// inconsistency whenever the second one failed — in which a reader's tier and their billing
// record tell different stories, and there is no third place to arbitrate between them.
//
// Never write either node on its own. If a future round needs to touch only the detail, it
// still goes through here and still carries the scalar, because the scalar is cheap and the
// invariant is not.
//
// ── WHY THE SCALAR IS SEPARATE AT ALL ────────────────────────────────────────────────────
//
// `users/{uid}` is `.read: true` and an RTDB read grant cannot be revoked by a descendant
// (measured on the emulator, R10.1). A billing record underneath it would publish
// stripeCustomerId and the subscription code to anyone who asked. So the detail lives at
// top-level memberships/{uid}, which is owner-or-founder read and has no write grant at all.
// Neither node is writable by any client; this module reaches them with the service-account
// token, which bypasses rules entirely — the same posture as bookstore_purchases.
//
// ── IDEMPOTENCY IS KEYED ON THE INVOICE, NOT THE SUBSCRIPTION ────────────────────────────
//
// This is the one place the bookstore's machinery could NOT be reused as-is, and reusing it
// unexamined would have been a silent, expensive bug. shouldSkipGrant() in _lib.js decides
// replay-vs-repurchase on the stored transaction reference alone, which is exactly right when
// a reference identifies one payment. A subscription id does not: `sub_123` is the same
// string in month one and month forty. Keyed on it, every renewal would look like a replay,
// be skipped, and a paying member's currentPeriodEnd would freeze on the day they joined
// while their card kept being charged.
//
// The INVOICE id changes every period, so it is the reference that means "this payment".
// Stripe gives `in_…`; Paystack's invoice events carry their own. The RULE from R8.2.1 is
// unchanged and still load-bearing: the reference ALONE decides, and status plays no part.
// A guard that also required status === 'active' would skip a renewal arriving after a
// past_due, which is the normal shape of a recovered payment.
//
// ── DOWNGRADES FAIL CLOSED, AND MATCH ON THE SUBSCRIPTION ────────────────────────────────
//
// A downgrade is the mirror image, and it reuses classifyRevocation() from _lib.js verbatim —
// the same three verdicts, for the same reason R9.1 LB-7 introduced them. A
// customer.subscription.deleted for a subscription the member has ALREADY replaced must not
// take away the one they are currently paying for. If the incoming subscription cannot be
// matched to the stored one, NOTHING is written and a human is told. Leaving a lapsed member
// on Gold until someone looks is the cheaper error; taking Gold from someone who just paid
// for it is not.

import {
  dbBase,
  classifyRevocation,
  FIREBASE_TIMEOUT_MS,
} from '../bookstore/_lib.js';
import { TIERS, isTier, normaliseTier, needsScalarRepair } from '../../../app/lib/membership.js';
import { MoneyTransientError, faultArmed } from '../_money.js';

export const SCALAR_PATH = (uid) => `users/${uid}/membership`;
export const DETAIL_PATH = (uid) => `memberships/${uid}`;

// ── THE PASS PATH IS A CHILD, AND THE WRITE IS DEEP ──────────────────────────────────────
//
// A pass lands at memberships/{uid}/pass and NOWHERE else. Two properties follow, and both
// are load-bearing rather than incidental.
//
// FIRST: the scalar is not in the update body at all. Not written 'free', not written
// anything — a pass purchase is not a tier change, and the only way to be sure a pass can
// never move the tier is for the pass writer to have no path to it. The database rule on
// users/{uid}/membership independently validates the value against the three tier strings, so
// the two defences are a belt and braces that were designed apart.
//
// SECOND: it is a DEEP path, so it cannot clobber its siblings. writeMembership() writes
// `memberships/{uid}: detail` — a path→object value, which replaces that node WHOLESALE. If a
// pass were written the same way it would delete stripeCustomerId, founding, foundingSince
// and the subscription's whole billing row on the first day-pass purchase, and the loss would
// be invisible until the member's next renewal could not be attributed. That is not a
// hypothetical: R11.1 was a week spent on exactly this failure in the story editor. A pass
// purchase touches one child and leaves the rest of the record untouched.
export const PASS_PATH = (uid) => `memberships/${uid}/pass`;

// Both rails' subscription identifiers, for classifyRevocation. Stripe stores two because a
// cancellation event and a subscription object do not always carry the same one; Paystack's
// subscription code is on every event about a subscription by construction.
export const STRIPE_SUB_REF_FIELDS = ['stripeSubscriptionId', 'stripeCustomerId'];
export const PAYSTACK_SUB_REF_FIELDS = ['paystackSubscriptionCode'];

export const INTERVALS = ['monthly', 'annual'];
export const RAILS = ['stripe', 'paystack'];
export const STATUSES = ['active', 'past_due', 'cancelled'];

const str = (v) => (typeof v === 'string' && v ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const oneOf = (v, list) => (typeof v === 'string' && list.includes(v) ? v : null);

/**
 * The billing record. Pure, so the harness can assert every field without a network.
 *
 * EVERY KEY IS PRESENT IN THE RETURN VALUE, null when unknown — but NOT in the stored record,
 * and the difference is worth stating because it surprised this module's own author.
 *
 * RTDB TREATS null AS DELETE. A null in a PATCH body removes the key rather than storing it,
 * so a detail built with ten nulls arrives in the database with the four keys that had real
 * values. Verified on the live canary record: 12 keys returned, 4 keys stored.
 *
 * That is FINE, and half of it is the point: writing null is exactly how a field that no
 * longer applies gets CLEARED, rather than leaving last month's currentPeriodEnd sitting
 * beside this month's status. What it means for readers is that ABSENT AND null ARE THE SAME
 * FACT here, and every consumer must treat them alike — which they do, by testing for the
 * type they want rather than for null (see describeMembership, activePass,
 * shouldSkipMembershipGrant and storedReferences). Do not write `detail.status === null`;
 * write `typeof detail.status === 'string'`.
 *
 * Rail-specific identifiers are filtered to non-empty strings before they are stored, for the
 * reason buildGrantPayload gives in _lib.js: a null sitting in a record looking like a
 * reference compares equal to nothing and would send every later event to manual review.
 */
export function buildDetail({
  tier, interval, currency, rail, status, currentPeriodEnd, cancelAtPeriodEnd,
  founding, foundingSince, invoiceRef, refs, pass, now,
}) {
  const t = normaliseTier(tier);
  return {
    // The tier is MIRRORED here as well as being the scalar. Deliberate redundancy: this
    // record must be readable on its own for support and reconciliation, and a billing row
    // that cannot say what it bought is not much of a record. The scalar remains the contract.
    tier: t,
    interval: oneOf(interval, INTERVALS),
    currency: str(currency) ? String(currency).toLowerCase() : null,
    rail: oneOf(rail, RAILS),
    status: oneOf(status, STATUSES),
    currentPeriodEnd: num(currentPeriodEnd),
    cancelAtPeriodEnd: cancelAtPeriodEnd === true,
    founding: founding === true,
    foundingSince: num(foundingSince),
    lastInvoiceRef: str(invoiceRef),
    ...Object.fromEntries(
      Object.entries(refs || {}).filter(([, v]) => typeof v === 'string' && v),
    ),
    pass: pass && typeof pass === 'object' ? pass : null,
    updatedAt: num(now) ?? Date.now(),
  };
}

// ── W3 / MON-14: THE WRITE IS PER FIELD, NEVER THE WHOLE NODE ──────────────────────────
//
// Until W3 this wrote `memberships/{uid}: detail` — a path→object value, which REPLACES the node.
// Both rails re-read `pass` and carried it forward, but a pass landing between that read and
// this write was erased: a paid day pass, gone, with nothing logged. The same wholesale write
// was how a late event's stale view of the record clobbered a newer one.
//
// Now every field is its own path, and two children are NEVER in the body at all:
//
//   pass    written only by writePass(), one deep path of its own
//   ended   the ended-subscription tombstones (MON-03), only ever ADDED to, by endedUpdate()
//
// A deep write cannot clear a field it does not name, which the wholesale write did for free.
// So every rail identifier this module knows is named explicitly — as null when the new state
// does not carry it — and a Stripe → Paystack switch still leaves no stale Stripe id behind.
// (null in an RTDB PATCH deletes the child; see the header above buildDetail.)
export const KNOWN_REF_FIELDS = [
  'stripeSubscriptionId', 'stripeCustomerId', 'stripePriceId', 'priceGeneration',
  'paystackSubscriptionCode', 'paystackCustomerCode', 'paystackPlanCode', 'planGeneration',
  // not an identifier, but state of the same kind: true of one subscription, cleared by the next
  'endedReason',
];
const NEVER_IN_THE_BODY = new Set(['pass', 'ended', 'upgrade', 'passRefunds']);

/**
 * The atomic pair, as a multi-path update body ready for a root PATCH.
 *
 * Pure and exported separately from the write so a test can assert the EXACT paths and values
 * without stubbing a network. The scalar and every detail field land in ONE root PATCH, which
 * RTDB applies atomically.
 */
export function buildMembershipUpdate(uid, detail, { accountDeleted = false } = {}) {
  if (!str(uid)) throw new Error('buildMembershipUpdate: uid is required');
  const tier = normaliseTier(detail && detail.tier);
  const body = {};
  const d = { ...(detail || {}), tier };
  for (const f of KNOWN_REF_FIELDS) if (!(f in d)) d[f] = null;
  for (const [k, v] of Object.entries(d)) {
    if (NEVER_IN_THE_BODY.has(k)) continue;
    body[`${DETAIL_PATH(uid)}/${k}`] = v === undefined ? null : v;
  }
  // A DELETED ACCOUNT gets the billing record and NOTHING under users/. The scalar is the one
  // write in this whole module that lands under users/{uid}, and writing it for a deleted uid
  // would put a stub profile node back (functions/api/account/_deletion.js).
  if (!accountDeleted) body[SCALAR_PATH(uid)] = tier;
  return body;
}

// ── W3 / MON-03: ENDED SUBSCRIPTIONS ARE TOMBSTONED ──────────────────────────────────────
//
// memberships/{uid}/ended/{subscription id or code} = { at, reason }.
//
// A late or out-of-order event — invoice.payment_failed or subscription.updated after
// subscription.deleted, a replayed checkout, Paystack's not_renew after we disabled the old
// plan in an upgrade — used to rebuild the detail from the subscription's price and write the
// tier straight back. The member kept Gold for free. Now the moment a subscription ends (the
// provider says so, a refund ends it, an upgrade replaces it) its id is written here, and no
// grant event naming that id can ever write a tier again. Only ever added to; nothing clears it.
export const ENDED_PATH = (uid, ref) => `${DETAIL_PATH(uid)}/ended/${ref}`;
export const isEndedSubscription = (existing, ref) =>
  !!(ref && existing && typeof existing === 'object' && existing.ended && existing.ended[ref]);
export function endedUpdate(uid, ref, reason, now) {
  if (!str(ref) || /[.$#[\]/]/.test(ref)) return {};
  return { [ENDED_PATH(uid, ref)]: { at: num(now) ?? Date.now(), reason: String(reason || 'ended') } };
}

/** The subscription a stored record is currently about, on either rail. */
export const currentSubscriptionRef = (d) =>
  (d && typeof d === 'object' && (str(d.stripeSubscriptionId) || str(d.paystackSubscriptionCode))) || null;

const isLive = (status) => status === 'active' || status === 'past_due';

export const DELETION_PATH = (uid) => `deletions/${uid}`;

/**
 * Has this uid been through account deletion? Read by the one writer below.
 *
 * FAILS OPEN — returns false on a read failure — matching every grant path here: a paying member
 * must not lose their tier because one read hiccuped. The cost of the other outcome is bounded:
 * a stub users/{uid} node for a deleted account, which the account scrub removes on its next
 * tick (scripts/account/scrub.mjs, "the stub backstop").
 */
export async function isDeletedAccount(env, token, uid) {
  try {
    const res = await fetch(`${dbBase(env)}/${DELETION_PATH(encodeURIComponent(uid))}.json`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) !== null;
  } catch (e) {
    console.error(`[membership] deletion probe failed for ${uid} (treating as live):`, e.message || e);
    return false;
  }
}

/**
 * Replay guard for a grant or renewal. Keyed on the INVOICE reference alone.
 *
 * Same rule as shouldSkipGrant() in _lib.js — reference alone, status irrelevant — applied to
 * the reference that actually changes per payment. See the header for why the subscription id
 * is the wrong key and what it would cost.
 */
export function shouldSkipMembershipGrant(existingDetail, invoiceRef) {
  if (!existingDetail || typeof existingDetail !== 'object') return false;
  if (typeof invoiceRef !== 'string' || !invoiceRef) return false;
  return existingDetail.lastInvoiceRef === invoiceRef;
}

/**
 * The pass update, as a multi-path body ready for a root PATCH. ONE path, deliberately.
 *
 * Pure and exported separately from the write for the same reason buildMembershipUpdate is:
 * a test can assert the exact paths without a network, and anyone reading it can see in three
 * lines that the tier scalar is not among them.
 */
export function buildPassUpdate(uid, pass) {
  if (!str(uid)) throw new Error('buildPassUpdate: uid is required');
  if (!pass || typeof pass !== 'object') throw new Error('buildPassUpdate: pass is required');
  return { [PASS_PATH(uid)]: pass };
}

/**
 * Replay guard for a pass purchase, keyed on the CHARGE reference.
 *
 * Same rule as shouldSkipMembershipGrant, one node down: reference alone, status irrelevant.
 * The stakes are higher here than on a subscription, because a pass grant is not idempotent by
 * nature — it EXTENDS. A replayed webhook that was not skipped would hand out a second day for
 * one payment, every time Stripe or Paystack retried a delivery it was not sure landed.
 *
 * The reference is stored ON the pass rather than in a side node, so the guard and the thing it
 * guards arrive in the same read and cannot disagree.
 */
export function shouldSkipPassGrant(existingPass, ref) {
  if (!existingPass || typeof existingPass !== 'object') return false;
  if (typeof ref !== 'string' || !ref) return false;
  return existingPass.ref === ref;
}

/**
 * Should this downgrade event be applied to the stored membership?
 *
 * W3 / MON-02: MATCHED ON THE SUBSCRIPTION ALONE. Until W3 the candidate list included the
 * CUSTOMER, which is the same across every subscription a reader ever holds. So the deletion of
 * a subscription the member had already REPLACED matched the customer and took away the one
 * they were paying for now — after a Paystack upgrade (the old Gold plan ends months later,
 * on the same CUS_ code) or a Stripe cancel-and-rejoin. The customer is used only for a record
 * that has no subscription id at all (a Paystack first charge whose subscription.create has
 * not landed yet), which is the one case it can be about nothing else.
 *
 * Verdicts: 'revoke' (apply it), 'stale' (a different, current subscription is on the record —
 * the ended one is tombstoned and nothing else happens), 'absent' (nothing recorded), 'review'
 * (the event names nothing we can match).
 */
export function classifyDowngrade(existingDetail, subRef, customerRef = null) {
  if (!existingDetail || typeof existingDetail !== 'object') return { verdict: 'absent', stored: [] };
  const stored = currentSubscriptionRef(existingDetail);
  if (stored) {
    if (subRef && subRef === stored) return { verdict: 'revoke', stored: [stored] };
    return { verdict: subRef ? 'stale' : 'review', stored: [stored] };
  }
  const cus = str(existingDetail.stripeCustomerId) || str(existingDetail.paystackCustomerCode);
  if (customerRef && cus && customerRef === cus && isLive(existingDetail.status)) return { verdict: 'revoke', stored: [cus] };
  return { verdict: isLive(existingDetail.status) ? 'review' : 'stale', stored: cus ? [cus] : [] };
}

// ──────────────────────────────────────────────────────────────────────────
// The write. Everything above this line is pure.
// ──────────────────────────────────────────────────────────────────────────

export async function readDetail(env, token, uid) {
  const res = await fetch(`${dbBase(env)}/${DETAIL_PATH(encodeURIComponent(uid))}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET ${DETAIL_PATH(uid)} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function readScalar(env, token, uid) {
  const res = await fetch(`${dbBase(env)}/${SCALAR_PATH(encodeURIComponent(uid))}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET ${SCALAR_PATH(uid)} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function rootPatch(env, token, body, what) {
  const res = await fetch(`${dbBase(env)}/.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB ${what} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return body;
}

/**
 * Write the pair. ONE root PATCH, atomic by RTDB's own guarantee. `extra` rides in the same
 * PATCH (an ended-subscription tombstone), so a downgrade and its tombstone cannot half-land.
 */
export async function writeMembership(env, token, uid, detail, { extra = {}, accountDeleted } = {}) {
  const deleted = accountDeleted ?? await isDeletedAccount(env, token, uid);
  const body = { ...buildMembershipUpdate(uid, detail, { accountDeleted: deleted }), ...extra };
  return rootPatch(env, token, body, 'root PATCH');
}

/**
 * Apply a membership change, whichever rail it came from.
 *
 * Returns a verdict for a business decision; THROWS for anything a retry could fix, and the
 * webhook answers that with a 500 so the provider redelivers (W3 / MON-04; see _money.js).
 *
 *   'written'              the change was written
 *   'skipped'              a replay of an invoice already recorded
 *   'stale'                about a subscription that has ENDED (tombstoned) or been replaced —
 *                          nothing written, nothing wrong
 *   'not_paid'             a subscription that is not active or past_due (incomplete) — no tier
 *   'absent'               a downgrade for a membership that was never recorded
 *   'review'               needs a human; nothing written (MONEY FAILURE)
 *   'second_subscription'  a new subscription while another is live and no upgrade sanctioned it
 *                          — a reader is being billed twice; nothing written (MONEY FAILURE)
 *   'paid_after_deletion'  money for an account already deleted — the subscription is cancelled
 *                          at the provider and a human decides the refund (MONEY FAILURE)
 *
 * Grant-side options:
 *   subRef       the subscription the event is about (Stripe sub_…, Paystack SUB_…) or null
 *   newSubscription  this event STARTS a subscription (checkout completed / first charge)
 *   sanctioned   an upgrade in progress replaces the stored subscription with this one
 *   cancelAtProvider  async () => void — cancel this event's subscription at the provider
 */
export async function applyMembershipChange(env, token, uid, {
  kind,              // 'grant' | 'downgrade'
  invoiceRef,
  subRef = null,
  customerRef = null,
  newSubscription = false,
  sanctioned = false,
  cancelAtProvider = null,
  endedReason = 'provider',
  paidAt = null,     // ms — when the money in this event moved, if the event says
  detail,
  label = 'membership',
  now = Date.now(),
}) {
  let existing;
  try {
    existing = await readDetail(env, token, uid);
  } catch (e) {
    // W3: THROWN, not guessed. The grant used to fail open and the downgrade to fail closed;
    // with a provider retry behind every webhook, both can simply wait for a read that works.
    throw new MoneyTransientError(`[${label}] detail read failed for ${uid}: ${e.message || e}`);
  }

  if (await faultArmed(env, token, uid, { now })) {
    throw new MoneyTransientError(`[${label}] TEST-MODE FAULT armed at ops/money_fault/${uid} — refusing so the provider retries`);
  }

  if (kind === 'downgrade') {
    const { verdict, stored } = classifyDowngrade(existing, subRef, customerRef);
    const tomb = endedUpdate(uid, subRef, endedReason, now);
    if (verdict !== 'revoke') {
      if (verdict === 'stale' && Object.keys(tomb).length && existing) {
        await rootPatch(env, token, tomb, 'tombstone PATCH');
      }
      console.log(`[${label}] downgrade ${verdict} for ${uid}: event sub=${subRef || '—'} stored=[${stored.join(', ') || '—'}] — tier untouched`);
      return {
        verdict, uid, ref: subRef,
        why: verdict === 'review'
          ? `${label}: a cancellation for ${uid} names no subscription we can match (event ${subRef || customerRef || '—'}, stored ${stored.join(', ') || '—'}). The tier was NOT removed; check the provider.`
          : undefined,
      };
    }
    const written = await writeMembership(env, token, uid, detail, { extra: tomb });
    console.log(`[${label}] downgraded ${uid} (sub ${subRef || '—'}, ${endedReason})`);
    return { verdict: 'written', written };
  }

  // ── grant ────────────────────────────────────────────────────────────────
  if (shouldSkipMembershipGrant(existing, invoiceRef)) {
    console.log(`[${label}] duplicate invoice ${invoiceRef} for ${uid} — skipped`);
    return { verdict: 'skipped' };
  }

  if (isEndedSubscription(existing, subRef)) {
    // MON-03. The subscription has ended. A lifecycle event about it is history, and so is a
    // payment made BEFORE it ended (a replay, a late delivery). A payment made AFTER it ended —
    // or one whose time we cannot tell — is money taken for a membership that no longer
    // exists, and a human must see that.
    const endedAt = existing.ended[subRef]?.at;
    const beforeTheEnd = typeof paidAt === 'number' && typeof endedAt === 'number' && paidAt <= endedAt;
    if (invoiceRef && !beforeTheEnd) {
      return {
        verdict: 'review', uid, ref: invoiceRef,
        why: `${label}: payment ${invoiceRef} arrived for ${uid} on subscription ${subRef}, which has ENDED (${existing.ended[subRef]?.reason || '—'}). No tier was granted. Refund it or reinstate by hand.`,
      };
    }
    console.log(`[${label}] ${subRef} for ${uid} has ended — late event ignored, tier untouched`);
    return { verdict: 'stale' };
  }

  const stored = currentSubscriptionRef(existing);
  if (stored && isLive(existing.status) && (subRef ? subRef !== stored : newSubscription) && !sanctioned) {
    return {
      verdict: 'second_subscription', uid, ref: subRef || invoiceRef,
      why: `${label}: ${uid} already has live subscription ${stored} and a SECOND one (${subRef || invoiceRef || '—'}) has been paid for. Nothing was written. Cancel and refund one of them.`,
    };
  }

  if (detail.status === 'cancelled') {
    // A grant-shaped event whose live state says the subscription is over (Stripe canceled /
    // incomplete_expired). Before W3 this wrote the tier back with status 'cancelled'.
    return applyMembershipChange(env, token, uid, {
      kind: 'downgrade', subRef, customerRef, detail: { ...detail, tier: 'free' }, label, now, endedReason: 'provider',
    });
  }
  if (!isLive(detail.status)) {
    console.log(`[${label}] ${subRef || '—'} for ${uid} is not paid yet (status ${detail.status || 'incomplete'}) — no tier`);
    return { verdict: 'not_paid' };
  }

  const accountDeleted = await isDeletedAccount(env, token, uid);
  if (accountDeleted) {
    // MON-05. A subscription is live for an account that no longer exists: stop the billing
    // at the provider FIRST, then record the payment (billing record only — nothing under users/).
    let cancelled = 'no cancel hook';
    if (cancelAtProvider) {
      try { await cancelAtProvider(); cancelled = 'cancelled at the provider'; }
      catch (e) { throw new MoneyTransientError(`[${label}] DELETED-ACCOUNT ${uid}: provider cancel failed: ${e.message || e}`); }
    }
    await writeMembership(env, token, uid, { ...detail, status: 'cancelled', tier: 'free' }, {
      accountDeleted: true, extra: endedUpdate(uid, subRef, 'account_deleted', now),
    });
    return {
      verdict: 'paid_after_deletion', uid, ref: invoiceRef || subRef,
      why: `${label}: ${uid} deleted their account, then a live subscription (${subRef || '—'}, payment ${invoiceRef || 'none'}) reached us. ${cancelled}. Nothing was recreated. Decide whether to refund the payment.`,
    };
  }

  // The repair check. Cheap, and the only moment a malformed scalar is visible to anyone.
  try {
    const current = await readScalar(env, token, uid);
    if (needsScalarRepair(current)) {
      console.error(
        `[${label}] REPAIRING malformed membership scalar for ${uid}: ` +
        `${JSON.stringify(current)} is not one of ${TIERS.join('|')} — overwriting with ` +
        `'${normaliseTier(detail && detail.tier)}'`,
      );
    }
  } catch (e) {
    console.error(`[${label}] scalar repair probe failed for ${uid} (continuing):`, e.message || e);
  }

  const written = await writeMembership(env, token, uid, detail, { accountDeleted: false });
  console.log(
    `[${label}] wrote ${uid} tier=${written[SCALAR_PATH(uid)]} ` +
    `status=${detail.status || '—'} invoice=${invoiceRef || '—'}`,
  );
  return { verdict: 'written', written };
}

/**
 * W3 / MON-12 — A FULL REFUND (or a dispute) ENDS THE MEMBERSHIP NOW. Ikenna's ruling, 24 Sep.
 *
 * Cancel at the provider first (so nothing renews), then write free + the tombstone in one
 * PATCH. If the refunded subscription is not the one on the record (already replaced), only the
 * tombstone is written. Throws on anything retryable.
 */
export async function endMembershipNow(env, token, uid, { subRef, reason, cancelAtProvider, rail, label = 'membership', now = Date.now() }) {
  if (cancelAtProvider) await cancelAtProvider();
  let existing;
  try { existing = await readDetail(env, token, uid); }
  catch (e) { throw new MoneyTransientError(`[${label}] detail read failed for ${uid}: ${e.message || e}`); }
  const tomb = endedUpdate(uid, subRef, reason, now);
  const stored = currentSubscriptionRef(existing);
  if (!existing || (stored && stored !== subRef)) {
    if (existing && Object.keys(tomb).length) await rootPatch(env, token, tomb, 'tombstone PATCH');
    console.log(`[${label}] ${reason} on ${subRef} for ${uid}: not the current subscription (${stored || 'none'}) — tombstoned only`);
    return { verdict: 'stale' };
  }
  const detail = buildDetail({
    tier: 'free', rail, status: 'cancelled',
    founding: existing.founding === true,
    foundingSince: typeof existing.foundingSince === 'number' ? existing.foundingSince : null,
    refs: {
      stripeCustomerId: str(existing.stripeCustomerId),
      paystackCustomerCode: str(existing.paystackCustomerCode),
    },
    now,
  });
  const written = await writeMembership(env, token, uid, { ...detail, endedReason: reason }, { extra: tomb });
  console.log(`[${label}] ${reason}: ended ${uid}'s membership (${subRef}) NOW`);
  return { verdict: 'written', written };
}

async function readPath(env, token, path) {
  const res = await fetch(`${dbBase(env)}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function readPass(env, token, uid) {
  const res = await fetch(`${dbBase(env)}/${PASS_PATH(encodeURIComponent(uid))}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET ${PASS_PATH(uid)} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Write the pass. ONE deep path, so no sibling on the billing record can be disturbed. */
export async function writePass(env, token, uid, pass) {
  const body = buildPassUpdate(uid, pass);
  const res = await fetch(`${dbBase(env)}/.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB pass PATCH failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return body;
}

/**
 * Apply a pass purchase, whichever rail it came from. The twin of applyMembershipChange, and
 * deliberately a separate function rather than a `kind: 'pass'` branch inside it: that one
 * writes the scalar on every path it takes, and the surest way for a pass never to reach the
 * scalar is for the pass to be written by code that has no line that writes it.
 *
 *   'written'    the pass was written — see `stacked` on the returned pass for extend vs fresh
 *   'skipped'    a replay of a charge reference already recorded
 *
 * ── THE READ FAILURE, AND WHY IT STILL WRITES ────────────────────────────────────────────
 *
 * Stacking needs the current pass, so a failed read leaves a choice with no clean answer:
 *
 *   refuse   — a reader who has paid gets nothing. Total loss, and Paystack's charge has
 *              already settled by the time this runs.
 *   proceed  — the new pass is built with no `existing`, so it REPLACES rather than extends.
 *              A reader mid-pass loses the remainder: bounded, at most seven days, and
 *              repairable by hand from the log line below.
 *
 * It proceeds, matching the fail-open posture every grant path in this codebase takes, and it
 * says so loudly: the line carries the reference and the uid so the remainder can be restored
 * without hunting. Both branches are bad; only one of them takes money and gives nothing back.
 */
export async function applyPassPurchase(env, token, uid, { buildPassFor, ref, label = 'membership/pass', now = Date.now() }) {
  let existing;
  try {
    existing = await readPass(env, token, uid);
  } catch (e) {
    // W3: THROWN, and the provider retries. Before W3 this wrote a FRESH pass, which lost the
    // remainder of any pass the reader already held; with a retry behind it, waiting is free.
    throw new MoneyTransientError(`[${label}] pass read failed for ${uid} ref=${ref || '—'}: ${e.message || e}`);
  }
  if (await faultArmed(env, token, uid, { now })) {
    throw new MoneyTransientError(`[${label}] TEST-MODE FAULT armed at ops/money_fault/${uid} — refusing so the provider retries`);
  }

  if (shouldSkipPassGrant(existing, ref)) {
    console.log(`[${label}] duplicate pass reference ${ref} for ${uid} — skipped`);
    return { verdict: 'skipped' };
  }
  let refunded = null;
  try { refunded = await readPath(env, token, `${DETAIL_PATH(uid)}/passRefunds/${failureSafe(ref)}`); }
  catch (e) { throw new MoneyTransientError(`[${label}] pass refund read failed for ${uid}: ${e.message || e}`); }
  if (refunded !== null) {
    console.log(`[${label}] pass reference ${ref} for ${uid} was REFUNDED — a late grant is ignored`);
    return { verdict: 'stale' };
  }

  const pass = buildPassFor(existing);
  await writePass(env, token, uid, pass);
  if (await isDeletedAccount(env, token, uid)) {
    return {
      verdict: 'paid_after_deletion', uid, ref,
      why: `${label}: a pass (${ref || '—'}) was paid for by ${uid} after the account was deleted. Refund it by hand.`,
    };
  }
  console.log(
    `[${label}] wrote pass ${uid} kind=${pass.kind} tier=${pass.tier} ` +
    `expires=${new Date(pass.expiresAt).toISOString()} stacked=${pass.stacked} ref=${ref || '—'}`,
  );
  return { verdict: 'written', pass };
}

const failureSafe = (ref) => String(ref || '').replace(/[.$#[\]/]/g, '_');

/**
 * W3 / MON-12 — a full refund ENDS THE PASS NOW (ruling). Only the pass the refund paid for:
 * if a later purchase replaced its reference, the refund cannot be matched and a human looks.
 * The refunded reference is remembered so a late grant cannot bring the pass back.
 */
export async function endPassNow(env, token, uid, { ref, reason, label = 'membership/pass', now = Date.now() }) {
  let existing;
  try { existing = await readPass(env, token, uid); }
  catch (e) { throw new MoneyTransientError(`[${label}] pass read failed for ${uid}: ${e.message || e}`); }
  // Beside the pass, not inside it: writePass() replaces the pass node on every purchase.
  const mark = { [`${DETAIL_PATH(uid)}/passRefunds/${failureSafe(ref)}`]: now };
  if (!existing || existing.ref !== ref) {
    await rootPatch(env, token, mark, 'pass refund mark');
    return {
      verdict: existing ? 'refund_unmatched' : 'stale', uid, ref,
      why: existing ? `${label}: ${reason} for pass ${ref} (${uid}), but the pass on record is ${existing.ref}. Nothing ended; check by hand.` : undefined,
    };
  }
  await rootPatch(env, token, {
    ...mark,
    [`${PASS_PATH(uid)}/expiresAt`]: Math.min(now, existing.expiresAt || now),
    [`${PASS_PATH(uid)}/endedReason`]: reason,
  }, 'pass end PATCH');
  console.log(`[${label}] ${reason}: ended ${uid}'s pass ${ref} NOW`);
  return { verdict: 'written' };
}

export { isTier, normaliseTier, needsScalarRepair, TIERS };
