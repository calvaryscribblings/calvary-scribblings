// Bookstore Paystack webhook — Cloudflare Pages Function.
//
// POST /api/bookstore/paystack-webhook
//
// The naira twin of stripe-webhook.js. Same job, same target node, same response policy —
// but three things differ enough to be worth stating before anyone reads the code assuming
// otherwise:
//
//   1. THE SIGNATURE IS SHA-512, NOT SHA-256. Paystack signs the raw body with an HMAC keyed
//      by the SECRET KEY (there is no separate webhook secret, unlike Stripe's whsec_). The
//      digest is hex, in the `x-paystack-signature` header. SHA-256 is the near-universal
//      default and it is the wrong answer here; a 256 implementation fails every event and
//      looks like a key problem.
//      — https://paystack.com/docs/payments/webhooks/
//
//   2. THE PAYLOAD IS NOT TRUSTED FOR MONEY. A verified signature proves Paystack sent it; it
//      does not prove what was paid. Before granting anything we re-fetch the transaction
//      from GET /transaction/verify/:reference and take the amount, currency and status from
//      THAT response. This is Paystack's own documented instruction and it is the difference
//      between a webhook and an authorisation.
//
//   3. IDENTITY COMES FROM THE REFERENCE. Stripe hands us client_reference_id and copies
//      PaymentIntent metadata onto charges, so refunds arrive identifiable. Paystack offers no
//      such guarantee — a refund event's shape varies and may carry no metadata at all. So
//      checkout mints a self-describing reference (cs.<uid>.<titleId>.<nonce>, see _lib.js)
//      and every handler here reconciles from it, with metadata as the fallback rather than
//      the source.
//
// RESPONSE POLICY — inherited from the Stripe path deliberately. Paystack retries any
// non-2xx every 3 minutes for four attempts, then hourly for up to 72 hours. Once a signature
// has verified, the request is genuine and retrying will not fix a Firebase outage, so we
// return 200 and surface the failure via console.error to the Pages tail. Only failures
// BEFORE that point — bad signature, missing header, unparseable JSON — return 4xx. A 200
// here means "received and understood", not "fulfilled".
//
// WHY THE ADMIN TOKEN: database.rules.json gates bookstore_purchases writes to the two
// founder UIDs, so no client can grant itself a book. R8.2 changed no rules and needs none.

import {
  json,
  mintAccessToken,
  hexToBytes,
  timingSafeEqual,
  bytesToHex,
  readPurchase,
  patchPurchase,
  fetchTitleRecord,
  denormalisedFields,
  buildGrantPayload,
  buildRevokePayload,
  parsePaystackReference,
} from './_lib.js';

const LABEL = 'bookstore/paystack-webhook';

export const PAYSTACK_SIGNATURE_HEADER = 'x-paystack-signature';
export const PAYSTACK_VERIFY_API = 'https://api.paystack.co/transaction/verify';

const GRANT_EVENTS = new Set(['charge.success']);

// Events that take access away. Paystack's own docs and its v1 event list disagree on whether
// disputes are namespaced (`charge.dispute.create`) or bare (`dispute.create`), so both
// spellings are mapped — an unknown event costs nothing (it is acknowledged and ignored),
// whereas a missed dispute leaves a chargebacked book on someone's shelf.
//
// refund.pending and refund.failed are deliberately ABSENT. Pending is an intention, not a
// movement, and failed means the money never went back — revoking on either would take a book
// away from a reader who still owns it.
const REVOKE_EVENTS = new Map([
  ['refund.processed', 'refunded'],
  ['charge.dispute.create', 'disputed'],
  ['dispute.create', 'disputed'],
  ['charge.reversed', 'reversed'],
]);

// ──────────────────────────────────────────────────────────────────────────
// Signature verification.
// ──────────────────────────────────────────────────────────────────────────

/**
 * HMAC-SHA512 of the RAW body, keyed with the Paystack secret key, hex-encoded, compared in
 * constant time against the x-paystack-signature header.
 *
 * rawBody must be the bytes as sent. Re-serialising parsed JSON changes key order and
 * whitespace, and the signature is over the exact string — the single most common way this
 * check is broken.
 *
 * Exported for tests/bookstore/paystack.test.mjs.
 */
export async function verifyPaystackSignature(rawBody, header, secret) {
  if (typeof header !== 'string' || !header) {
    return { ok: false, reason: 'missing x-paystack-signature header' };
  }
  const provided = hexToBytes(header.trim().toLowerCase());
  if (!provided) return { ok: false, reason: 'signature header is not valid hex' };

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const expectedBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = new Uint8Array(expectedBuf);

  if (timingSafeEqual(provided, expected)) return { ok: true };
  return {
    ok: false,
    reason: `signature mismatch (expected ${bytesToHex(expected).slice(0, 12)}…)`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Identity and idempotency.
// ──────────────────────────────────────────────────────────────────────────

/**
 * The transaction reference, wherever this event shape happens to keep it. charge.success has
 * it at data.reference; refund and dispute payloads nest the original transaction, and the
 * field name is not guaranteed across event types. Checking every plausible location costs
 * nothing and is the difference between a revocation landing and a log line saying it could
 * not find the purchase.
 *
 * Exported for tests.
 */
export function extractReference(data) {
  const candidates = [
    data?.reference,
    data?.transaction?.reference,
    data?.transaction_reference,
    data?.data?.reference,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
  }
  return null;
}

/**
 * uid + titleId, from the reference first and metadata second. The reference is authoritative
 * because checkout built it from a verified token; metadata is a convenience copy that only
 * some event shapes carry.
 *
 * Exported for tests.
 */
export function extractIdentity(data) {
  const parsed = parsePaystackReference(extractReference(data));
  if (parsed) return { uid: parsed.uid, titleId: parsed.titleId };

  const meta = data?.metadata || data?.transaction?.metadata || {};
  const uid = typeof meta.uid === 'string' ? meta.uid : '';
  const titleId = typeof meta.titleId === 'string' ? meta.titleId : '';
  return { uid: uid || null, titleId: titleId || null };
}

/**
 * Replay protection.
 *
 * Skip whenever the record already names THIS reference — whatever its status. That last
 * clause is the whole point: Paystack delivers at least once, and a replayed charge.success
 * arriving after a refund must not overwrite status:'revoked' back to 'active'. A guard that
 * only skips on `status === 'active'` (as the Stripe path's does) leaves exactly that hole
 * open, and it is why this one is written differently rather than shared.
 *
 * A DIFFERENT reference for the same book is a genuine second purchase — the reader bought it
 * again after a refund — and must fall through to the write.
 *
 * Exported for tests.
 */
export function shouldSkipGrant(existing, reference) {
  return Boolean(existing && typeof existing === 'object' && existing.paystackRef === reference);
}

// ──────────────────────────────────────────────────────────────────────────
// Server-side transaction verification.
// ──────────────────────────────────────────────────────────────────────────

async function verifyTransaction(env, reference) {
  const res = await fetch(`${PAYSTACK_VERIFY_API}/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== true || !body?.data) {
    throw new Error(`verify failed: HTTP ${res.status} ${body?.message || ''}`.trim());
  }
  return body.data;
}

// ──────────────────────────────────────────────────────────────────────────
// Event handling.
// ──────────────────────────────────────────────────────────────────────────

async function handleGrant(env, data) {
  const reference = extractReference(data);
  const { uid, titleId } = extractIdentity(data);

  // Verified, but unattributable. A 4xx would make Paystack retry a request that can never
  // succeed, so this is logged loudly and acknowledged — see the response policy above.
  if (!reference || !uid || !titleId) {
    console.error(
      `[${LABEL}] charge.success ref=${reference || '—'} has no uid/titleId ` +
      `(uid=${uid || '—'}, titleId=${titleId || '—'}) — nothing recorded`,
    );
    return;
  }

  // THE AUTHORITATIVE READ. Amount, currency and status come from here, never from the
  // delivered payload.
  let txn;
  try {
    txn = await verifyTransaction(env, reference);
  } catch (e) {
    console.error(`[${LABEL}] could not verify ${reference}:`, e.message || e);
    return;
  }

  if (txn.status !== 'success') {
    console.error(`[${LABEL}] ${reference} verified as '${txn.status}', not 'success' — not granting`);
    return;
  }

  const currency = typeof txn.currency === 'string' ? txn.currency.toUpperCase() : '';
  if (currency !== 'NGN') {
    console.error(`[${LABEL}] ${reference} settled in ${currency || '—'}, not NGN — not granting`);
    return;
  }

  const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);

  // One read serves both the price cross-check and the denormalised display fields.
  const titleRecord = await fetchTitleRecord(env, token, titleId, LABEL);
  const expected = titleRecord?.prices?.ngn;

  // Cross-check the paid amount against the catalogue. Fail CLOSED on a definite mismatch —
  // that is either a tampered initialize or a bug, and neither should hand over a book. Fail
  // OPEN when the title is unreadable or unpriced: the money has already moved, and refusing
  // a paying reader because of a Firebase blip is the worse failure. Both branches log the
  // numbers so a manual grant is a copy-paste rather than an investigation.
  if (Number.isInteger(expected) && expected > 0 && txn.amount !== expected) {
    console.error(
      `[${LABEL}] ${reference} amount mismatch: paid ${txn.amount} kobo, ` +
      `catalogue says ${expected} kobo for ${titleId} — NOT granting, resolve by hand`,
    );
    return;
  }
  if (!Number.isInteger(expected)) {
    console.error(
      `[${LABEL}] ${reference} could not be price-checked (${titleId} has no readable ngn ` +
      `price) — granting on the verified amount ${txn.amount} kobo`,
    );
  }

  // Idempotency. A failed read is not a reason to drop a purchase on the floor: log it and
  // fall through to the write, because a duplicate grant is a far smaller problem than a
  // paying reader with no book.
  let existing = null;
  try {
    existing = await readPurchase(env, token, uid, titleId);
  } catch (e) {
    console.error(`[${LABEL}] idempotency read failed for ${uid}/${titleId}:`, e.message || e);
  }
  if (shouldSkipGrant(existing, reference)) {
    console.log(
      `[${LABEL}] duplicate ${reference} for ${uid}/${titleId} ` +
      `(status=${existing.status}) — skipped`,
    );
    return;
  }

  const fields = denormalisedFields(titleRecord);

  await patchPurchase(env, token, uid, titleId, buildGrantPayload({
    amount: txn.amount,
    currency: 'NGN',
    refField: 'paystackRef',
    refValue: reference,
    fields,
  }));

  console.log(
    `[${LABEL}] recorded uid=${uid} titleId=${titleId} ref=${reference} ` +
    `${txn.amount} kobo${fields ? '' : ' (no denormalised fields)'}`,
  );
}

async function handleRevoke(env, data, reason) {
  const { uid, titleId } = extractIdentity(data);

  if (!uid || !titleId) {
    console.error(
      `[${LABEL}] ${reason} event ref=${extractReference(data) || '—'} carries no uid/titleId ` +
      `— cannot match a purchase, nothing revoked`,
    );
    return;
  }

  const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
  await patchPurchase(env, token, uid, titleId, buildRevokePayload(reason));
  console.log(`[${LABEL}] revoked uid=${uid} titleId=${titleId} reason=${reason}`);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const sigHeader = request.headers.get(PAYSTACK_SIGNATURE_HEADER);
  if (!sigHeader) return new Response('Missing x-paystack-signature', { status: 400 });

  // The same key signs webhooks and authorises the verify call — Paystack has no separate
  // webhook secret.
  if (!env.PAYSTACK_SECRET_KEY) {
    console.error(`[${LABEL}] PAYSTACK_SECRET_KEY is not set`);
    return new Response('Server misconfigured', { status: 500 });
  }
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY`);
    return new Response('Server misconfigured', { status: 500 });
  }

  // Raw bytes as sent. See the note on verifyPaystackSignature.
  const rawBody = await request.text();

  const verification = await verifyPaystackSignature(rawBody, sigHeader, env.PAYSTACK_SECRET_KEY);
  if (!verification.ok) {
    console.error(`[${LABEL}] signature verification failed:`, verification.reason);
    return new Response(`Invalid signature: ${verification.reason}`, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const data = event?.data;
  if (!data || typeof data !== 'object') return new Response('Missing data', { status: 400 });

  // Past this line the request is provably from Paystack, so every exit is a 200.
  try {
    if (GRANT_EVENTS.has(event.event)) {
      await handleGrant(env, data);
    } else if (REVOKE_EVENTS.has(event.event)) {
      await handleRevoke(env, data, REVOKE_EVENTS.get(event.event));
    } else {
      return json({ received: true, ignored: event.event });
    }
  } catch (e) {
    console.error(`[${LABEL}] ${event.event} (${extractReference(data) || '—'}) failed:`, e.message || e);
    return json({ received: true, degraded: true });
  }

  return json({ received: true });
}
