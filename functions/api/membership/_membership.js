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

/**
 * The atomic pair, as a multi-path update body ready for a root PATCH.
 *
 * Pure and exported separately from the write so a test can assert the EXACT paths and values
 * without stubbing a network — and so anyone reading this can see, in four lines, that the
 * scalar and the detail cannot be written apart.
 */
export function buildMembershipUpdate(uid, detail) {
  if (!str(uid)) throw new Error('buildMembershipUpdate: uid is required');
  const tier = normaliseTier(detail && detail.tier);
  return {
    [SCALAR_PATH(uid)]: tier,          // the STRING the app reads
    [DETAIL_PATH(uid)]: detail,        // everything else
  };
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
 * A thin, named wrapper over classifyRevocation() rather than a reimplementation: the three
 * verdicts and the fail-closed posture are exactly what R9.1 LB-7 built and there is no
 * reason for membership to have its own opinion. 'revoke' here means "apply the downgrade".
 */
export function classifyDowngrade(existingDetail, refFields, candidates) {
  return classifyRevocation(existingDetail, refFields, candidates);
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

/**
 * Write the pair. ONE root PATCH, atomic by RTDB's own guarantee.
 *
 * PATCH at the ROOT with fully-qualified paths — not PUT, and not a PATCH scoped to either
 * node. A root PATCH is the only shape that spans two top-level nodes in one atomic
 * operation, which is the invariant this whole module exists to hold.
 */
export async function writeMembership(env, token, uid, detail) {
  const body = buildMembershipUpdate(uid, detail);
  const res = await fetch(`${dbBase(env)}/.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB root PATCH failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return body;
}

/**
 * Apply a membership change, whichever rail it came from.
 *
 * Returns a verdict rather than throwing on a business decision, so a webhook can log the
 * right line and still answer 200 — the response policy both webhooks already follow.
 *
 *   'written'    the pair was written
 *   'skipped'    a replay of an invoice already recorded
 *   'review'     a downgrade that could not be matched to the stored subscription — NOTHING
 *                written, a human needed
 *   'absent'     a downgrade for a membership that was never recorded
 *
 * THE REPAIR CASE. Before writing, the current scalar is read and checked. A value that is
 * present but not one of the three strings — the `{ tier: 'free' }` object a Stage 3C test
 * account carries, say — is logged as a repair rather than trusted, and the write corrects
 * it in passing. It would be corrected anyway, since the scalar is always part of the update;
 * the point of naming it is that a malformed value means something upstream wrote a shape
 * nobody expected, and that should be visible rather than quietly tidied away.
 */
export async function applyMembershipChange(env, token, uid, {
  kind,              // 'grant' | 'downgrade'
  invoiceRef,
  refFields,
  candidates,
  detail,
  label = 'membership',
}) {
  let existing = null;
  let readFailed = false;
  try {
    existing = await readDetail(env, token, uid);
  } catch (e) {
    readFailed = true;
    console.error(`[${label}] detail read failed for ${uid}:`, e.message || e);
  }

  if (kind === 'grant') {
    // Fail OPEN, exactly as the purchase rail does: a failed idempotency read must not drop a
    // payment on the floor. A duplicate grant is a far smaller problem than a paying member
    // who never got their tier.
    if (!readFailed && shouldSkipMembershipGrant(existing, invoiceRef)) {
      console.log(`[${label}] duplicate invoice ${invoiceRef} for ${uid} — skipped`);
      return { verdict: 'skipped' };
    }
  } else {
    // Fail CLOSED on a downgrade — the opposite posture, on purpose. If we cannot PROVE this
    // event is about the subscription on the record, the wrong write takes a paid-for tier
    // away from someone who owns it.
    if (readFailed) {
      console.error(`[${label}] NEEDS-MANUAL-REVIEW downgrade for ${uid}: detail unreadable, nothing written`);
      return { verdict: 'review' };
    }
    const { verdict, stored } = classifyDowngrade(existing, refFields, candidates);
    if (verdict !== 'revoke') {
      console.error(
        `[${label}] ${verdict === 'absent' ? 'no membership recorded' : 'NEEDS-MANUAL-REVIEW'} ` +
        `for ${uid}: event refs=[${(candidates || []).join(', ') || '—'}] stored=[${stored.join(', ') || '—'}] ` +
        `— nothing written`,
      );
      return { verdict };
    }
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
    // Never block a write on the repair probe; it is diagnostics, not a gate.
    console.error(`[${label}] scalar repair probe failed for ${uid} (continuing):`, e.message || e);
  }

  const written = await writeMembership(env, token, uid, detail);
  console.log(
    `[${label}] wrote ${uid} tier=${written[SCALAR_PATH(uid)]} ` +
    `status=${detail.status || '—'} invoice=${invoiceRef || '—'}`,
  );
  return { verdict: 'written', written };
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
export async function applyPassPurchase(env, token, uid, { buildPassFor, ref, label = 'membership/pass' }) {
  let existing = null;
  let readFailed = false;
  try {
    existing = await readPass(env, token, uid);
  } catch (e) {
    readFailed = true;
    console.error(
      `[${label}] NEEDS-MANUAL-REVIEW pass read failed for ${uid} ref=${ref || '—'}: ${e.message || e} — ` +
      `writing a FRESH pass; if this reader held a live one, its remainder was not carried over`,
    );
  }

  if (!readFailed && shouldSkipPassGrant(existing, ref)) {
    console.log(`[${label}] duplicate pass reference ${ref} for ${uid} — skipped`);
    return { verdict: 'skipped' };
  }

  // The caller supplies the builder so this function never has to know the catalogue — and so
  // the `existing` it just read is the only source of the stacked expiry.
  const pass = buildPassFor(readFailed ? null : existing);
  await writePass(env, token, uid, pass);
  console.log(
    `[${label}] wrote pass ${uid} kind=${pass.kind} tier=${pass.tier} ` +
    `expires=${new Date(pass.expiresAt).toISOString()} stacked=${pass.stacked} ref=${ref || '—'}`,
  );
  return { verdict: 'written', pass };
}

export { isTier, normaliseTier, needsScalarRepair, TIERS };
