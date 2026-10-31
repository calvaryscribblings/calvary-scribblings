// ──────────────────────────────────────────────────────────────────────────
// RULING 256 (Ikenna, 31 Oct 2026) — A SECOND PAYMENT NEVER OVERWRITES THE FIRST.
//
//   When a second payment lands on a copy the reader already owns, the webhook keeps the first
//   payment's record and files the second beside it as a duplicate, flagged in /admin for
//   Ikenna to refund by hand. A refund revokes the copy only when no payment for it still
//   stands.
//
// THE BUG IT CLOSES (STORE-OWNED's finding). Both webhooks wrote any paid transaction with a new
// reference straight over bookstore_purchases/{uid}/{titleId} (buildGrantPayload through
// patchPurchase). The record has room for one payment:
//   · same rail — the first payment's references were overwritten, so the database no longer
//     named a payment the reader had made, and a refund of it could not be matched;
//   · across rails — both references survived (different fields), but amount and currency
//     became the second's, and a refund of EITHER payment revoked the copy while the other
//     still stood.
//
// THE SHAPE. The copy keeps one payment: the one it stands on. Every other payment for the same
// (uid, titleId) is filed here, under a key of its own:
//
//   bookstore_duplicate_payments/{uid}/{titleId}/{rail}_{reference}
//     { rail, uid, titleId, title, amount, currency, refs: { … }, receivedAt,
//       status: 'open' | 'refunded' | 'promoted', refundedAt?, refundReason?, promotedAt?,
//       role?: 'original' }
//
//   open      a payment that stands beside the copy's own. /admin lists it for a hand refund.
//   refunded  the provider says it was paid back (or disputed, reversed, failed). History.
//   promoted  the copy's own payment was refunded while this one stood, so the copy now stands
//             on THIS payment: its references, amount and currency moved onto the copy record.
//             The entry stays, as history.
//   role: 'original' marks the copy's first payment, filed here as refunded at the moment the
//             copy moved onto a duplicate — so the history keeps both.
//
// Server-written only (rules: .write false), founder-read only. The reader and the storefront
// never see it. Nothing here moves money: a refund is Ikenna's own hand, in Stripe or Paystack.
// ──────────────────────────────────────────────────────────────────────────

import { dbBase, FIREBASE_TIMEOUT_MS, PURCHASES_PATH, storedReferences } from './_lib.js';
import { DUPLICATES_PATH } from '../../../app/lib/bookstore/duplicates.js';

export { DUPLICATES_PATH };

/** Every field on a purchase record that names a payment, across both rails. */
export const PAYMENT_REF_FIELDS = ['stripeSessionId', 'stripePaymentIntent', 'paystackRef'];

/** RTDB keys may not contain . $ # [ ] / — a Paystack reference carries dots. */
export const duplicateKey = (rail, ref) => `${rail}_${String(ref || 'unknown').replace(/[.$#[\]/\x00-\x1f\x7f]/g, '_')}`;

/** The payment references a purchase record stands on, whichever rail. */
export const paymentRefsOf = (record) => storedReferences(record, PAYMENT_REF_FIELDS);

/** The references a filed entry names. */
export const entryRefs = (entry) => Object.values((entry && entry.refs) || {}).filter((v) => typeof v === 'string' && v);

/** Which rail a purchase record's payment was made on, from the field that names it. */
export const railOf = (record) => (record && typeof record.paystackRef === 'string' && record.paystackRef ? 'paystack' : 'stripe');

/**
 * Is this paid grant a DUPLICATE of the copy already on the shelf? Pure.
 *
 * Yes when the copy is active, stands on a payment (it names at least one payment reference),
 * and names none of the incoming ones. Everything else is the existing path, unchanged:
 *   · no record, or a revoked one — a first purchase, or a repurchase after a refund;
 *   · a copy that already names an incoming reference — a replay (shouldSkipGrant catches the
 *     primary reference first; this catches the secondary one too);
 *   · an active copy with NO payment reference — a comp (W3b) or a free claim (FREE-TITLES):
 *     a paid grant landing on one makes it a sale, by ruling, and must keep doing so;
 *   · PURCHASE_UNKNOWN (the read failed) — not an object, so not a duplicate. The grant fails
 *     open, as it always has: a reader who paid and has no book is the worse error.
 */
export function isDuplicatePayment(existing, incomingRefs) {
  if (!existing || typeof existing !== 'object') return false;
  if (existing.status !== 'active') return false;
  const stored = paymentRefsOf(existing);
  if (stored.length === 0) return false;
  const incoming = (incomingRefs || []).filter((v) => typeof v === 'string' && v);
  if (incoming.length === 0) return false;
  return !incoming.some((r) => stored.includes(r));
}

/** The entry filed for a duplicate payment. Pure (the clock aside). */
export function buildDuplicateEntry({ rail, uid, titleId, amount, currency, refs, title }) {
  return {
    rail,
    uid,
    titleId,
    title: typeof title === 'string' && title ? title : null,
    amount: typeof amount === 'number' ? amount : null,
    currency: typeof currency === 'string' && currency ? currency.toUpperCase() : null,
    refs: Object.fromEntries(Object.entries(refs || {}).filter(([, v]) => typeof v === 'string' && v)),
    receivedAt: Date.now(),
    status: 'open',
  };
}

/** The filed entry an event's references name, as [key, entry], or null. Pure. */
export function matchEntry(entries, candidates) {
  const incoming = (candidates || []).filter((v) => typeof v === 'string' && v);
  if (!incoming.length || !entries || typeof entries !== 'object') return null;
  for (const [key, entry] of Object.entries(entries)) {
    if (entryRefs(entry).some((r) => incoming.includes(r))) return [key, entry];
  }
  return null;
}

/** Open duplicates, earliest first. Pure. */
export function openEntries(entries) {
  return Object.entries(entries || {})
    .filter(([, e]) => e && e.status === 'open')
    .sort(([, a], [, b]) => (a.receivedAt || 0) - (b.receivedAt || 0));
}

/**
 * The refund decision, for an event already matched against the copy's own references. Pure.
 *
 *   'duplicate'  the event names a filed payment and not the copy's: mark THAT entry refunded.
 *                The copy is untouched.
 *   'promote'    the event names the copy's payment, and a duplicate still stands: the copy
 *                moves onto the earliest open duplicate. It is NOT revoked.
 *   'revoke'     the event names the copy's payment and nothing else stands: revoke, as before.
 *   'none'       neither — the caller's existing absent/review handling applies.
 */
export function refundPlan({ copyMatched, entries, candidates }) {
  const hit = matchEntry(entries, candidates);
  if (!copyMatched) {
    return hit ? { action: 'duplicate', key: hit[0], entry: hit[1] } : { action: 'none' };
  }
  const open = openEntries(entries);
  if (open.length) return { action: 'promote', key: open[0][0], entry: open[0][1] };
  return { action: 'revoke' };
}

/**
 * The multi-path update that moves a copy onto a standing duplicate. Pure.
 *
 * The copy's status is not named, so the readership count does not move (readershipDelta reads
 * a payload without `status` as 0) — the copy was active and stays active. Its old payment is
 * filed beside the duplicates as refunded (role 'original'), so the history keeps both.
 */
export function promotionUpdates({ uid, titleId, existing, key, entry, reason, now = Date.now() }) {
  const P = `${PURCHASES_PATH}/${uid}/${titleId}`;
  const D = `${DUPLICATES_PATH}/${uid}/${titleId}`;
  const origRail = railOf(existing);
  const origRefs = Object.fromEntries(PAYMENT_REF_FIELDS.map((f) => [f, existing[f]]).filter(([, v]) => typeof v === 'string' && v));
  const origKey = duplicateKey(origRail, origRefs.stripeSessionId || origRefs.paystackRef || origRefs.stripePaymentIntent);
  const update = {
    [`${D}/${origKey}`]: {
      rail: origRail, uid, titleId, title: typeof existing.title === 'string' ? existing.title : (entry.title || null),
      amount: typeof existing.amount === 'number' ? existing.amount : null,
      currency: typeof existing.currency === 'string' ? existing.currency.toUpperCase() : null,
      refs: origRefs, receivedAt: typeof existing.purchasedAt === 'number' ? existing.purchasedAt : null,
      status: 'refunded', refundedAt: now, refundReason: reason, role: 'original',
    },
    [`${D}/${key}/status`]: 'promoted',
    [`${D}/${key}/promotedAt`]: now,
    [`${P}/amount`]: entry.amount ?? null,
    [`${P}/currency`]: entry.currency ?? null,
  };
  // The copy names exactly the duplicate's references from now on: a later refund of THAT
  // payment matches the copy, and one of the old payment matches the 'original' entry.
  for (const f of PAYMENT_REF_FIELDS) update[`${P}/${f}`] = (entry.refs && entry.refs[f]) || null;
  return update;
}

/** The entry a refund marks, as update paths. Pure. */
export function refundedUpdates({ uid, titleId, key, reason, now = Date.now() }) {
  const D = `${DUPLICATES_PATH}/${uid}/${titleId}/${key}`;
  return { [`${D}/status`]: 'refunded', [`${D}/refundedAt`]: now, [`${D}/refundReason`]: reason };
}

/**
 * When the copy itself is revoked and it stood on a promoted entry, that entry is refunded too —
 * so the node reads as history, with nothing left 'promoted' behind a revoked copy. Pure.
 */
export function revokeCompanionUpdates({ uid, titleId, existing, entries, reason, now = Date.now() }) {
  const stored = paymentRefsOf(existing);
  const out = {};
  for (const [key, e] of Object.entries(entries || {})) {
    if (e && e.status === 'promoted' && entryRefs(e).some((r) => stored.includes(r))) {
      Object.assign(out, refundedUpdates({ uid, titleId, key, reason, now }));
    }
  }
  return out;
}

// ── I/O ──────────────────────────────────────────────────────────────────

const node = (env, uid, titleId, key) =>
  `${dbBase(env)}/${DUPLICATES_PATH}/${encodeURIComponent(uid)}/${encodeURIComponent(titleId)}${key ? `/${encodeURIComponent(key)}` : ''}.json`;

/** Every filed entry for this copy, or null. Throws on a failed read. */
export async function readDuplicates(env, token, uid, titleId) {
  const res = await fetch(node(env, uid, titleId), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET (duplicates) failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * File a duplicate ONCE. A provider retry (both retry for 72 hours) arrives with the same
 * reference and so the same key; the write is conditional on the key being empty (RTDB's ETag
 * precondition), so two deliveries racing each other still file one entry, and a retry that
 * lands after Ikenna's refund was recorded cannot reopen it.
 *
 * Returns { filed: true } for the first delivery, { filed: false } for any after it.
 */
export async function fileDuplicateOnce(env, token, uid, titleId, key, entry) {
  const url = node(env, uid, titleId, key);
  const head = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!head.ok) throw new Error(`RTDB GET (duplicate) failed: ${head.status} ${(await head.text()).slice(0, 300)}`);
  if ((await head.json()) !== null) return { filed: false };
  const etag = head.headers.get('ETag');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(etag ? { 'if-match': etag } : {}) },
    body: JSON.stringify(entry),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (res.status === 412) return { filed: false };   // another delivery filed it first
  if (!res.ok) throw new Error(`RTDB PUT (duplicate) failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return { filed: true };
}

/** One atomic multi-path PATCH at the root. */
export async function patchRoot(env, token, update) {
  const res = await fetch(`${dbBase(env)}/.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB PATCH failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}
