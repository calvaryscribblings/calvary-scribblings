// Bookstore Stripe webhook — Cloudflare Pages Function.
//
// POST /api/bookstore/stripe-webhook
//
// Ported in R5 from workers/stripe-webhook/src/index.js, which was itself rescued in
// 8752e04 from a stash where it had sat unversioned since May. That worker was written
// for the retired Dead End paywall and wrote purchases/{uid}/{slug}. Everything it got
// right about Stripe and Google is preserved here verbatim — the signature verification,
// the PEM normalisation, the RS256 service-account token minting, and the response
// policy. What changed is the target node, the identity fields, and the event set.
// workers/stripe-webhook/ stays in the tree as the archival source; it is not deployed.
//
// Architecture:
//   1. Verify the Stripe-Signature header against STRIPE_WEBHOOK_SECRET using HMAC-SHA256
//      (Web Crypto). Reject if the timestamp is outside a 5-minute window or if no v1
//      signature matches.
//   2. Parse the body as JSON. Only the event types below cause a Firebase write;
//      everything else is acknowledged with 200.
//   3. Mint a Google OAuth2 access token from the Firebase service account (RS256 JWT via
//      Web Crypto) — the same pattern as functions/api/record-attempt.js.
//   4. PATCH bookstore_purchases/{uid}/{titleId}.
//
// RESPONSE POLICY — preserved from the rescued worker, and the reason it looks lopsided:
// Stripe retries on any non-2xx. Once a signature has verified, the request is genuine and
// retrying it will not fix a Firebase outage, so we return 200 and surface the failure via
// console.error to the Pages tail instead of inviting a retry storm. Only failures BEFORE
// that point — a bad signature, unparseable JSON, missing secret — return 4xx/5xx. That is
// deliberate: a 200 here means "received and understood", not "fulfilled".
//
// WHY THE ADMIN TOKEN: database.rules.json gates bookstore_purchases writes to the two
// founder UIDs, so no client can grant itself a book. A service-account token carries
// Admin privilege and bypasses rules entirely, which is exactly why this endpoint — and
// not the browser — is what records a purchase. Do not relax those rules to make anything
// here easier.

// R5b: json(), b64url(), pemToArrayBuffer(), mintAccessToken() and dbBase() moved to
// ./_lib.js when stream.js became the third caller — a move, not a rewrite. The Stripe
// signature SCHEME below stays here: nothing else needs it.
//
// R8.2 moved the purchase-record plumbing (read/patch/denormalise/payload) and the hex-and-
// constant-time comparison helpers there too, when paystack-webhook.js became the second
// writer of bookstore_purchases. Also a move. Everything this file does is unchanged.
import {
  json,
  bytesToHex,
  hexToBytes,
  timingSafeEqual,
  mintAccessToken,
  readPurchase,
  patchPurchase,
  fetchTitleFields,
  buildGrantPayload,
  buildRevokePayload,
  shouldSkipGrant,
  classifyRevocation,
  STRIPE_REF_FIELDS,
} from './_lib.js';

const LABEL = 'bookstore/stripe-webhook';

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

// R9.2 PL-14. The tolerance above is how far in the PAST a signed timestamp may be; this is
// how far in the FUTURE. They are deliberately not the same number. Stripe's own libraries
// check age one-sidedly (`now - t > tolerance`) and so accept an arbitrarily future
// timestamp; this file used Math.abs, which was worse in a different way — it made the
// tolerance symmetric and handed a captured, still-valid body five extra minutes of life.
// A future timestamp is only ever clock skew between Cloudflare's edge and Stripe's, which
// is seconds, never minutes.
const STRIPE_CLOCK_SKEW_SECONDS = 30;

// Events that grant access, and events that take it away. Anything not listed is
// acknowledged and ignored, so the Stripe dashboard can be configured broadly without
// this endpoint needing to change.
//
// R9.2 PL-3: async_payment_succeeded is the OTHER half of a delayed-payment method. For a
// card, checkout.session.completed arrives with payment_status 'paid' and is the whole
// story. For anything asynchronous — BACS, SEPA debit, Bancontact, a bank redirect —
// completed arrives FIRST, with payment_status 'unpaid', and the money lands (or does not)
// days later as async_payment_succeeded / async_payment_failed. Both grant events carry the
// same Session `id`, so a grant that arrives on the second one still stores the same
// stripeSessionId, and the revoke path's reference matching is unaffected.
const GRANT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);
const REVOKE_EVENTS = new Map([
  ['charge.refunded', 'refunded'],
  ['charge.dispute.created', 'disputed'],
  ['checkout.session.async_payment_failed', 'payment-failed'],
]);

/**
 * Has the money actually arrived?
 *
 * Stripe sets `payment_status` on every Checkout Session and it is the only field on the
 * event that answers this. Three values exist:
 *
 *   'paid'                 — settled. Grant.
 *   'no_payment_required'  — a zero-amount session: a 100%-off coupon, a comp. There is no
 *                            money to wait for and the session is legitimately complete, so
 *                            this grants too. Refusing it would mean a free copy that
 *                            silently never appears on the shelf.
 *   'unpaid'               — the delayed-payment case. Do NOT grant; async_payment_succeeded
 *                            is the event that will say the money landed.
 *
 * ANYTHING ELSE, INCLUDING A MISSING FIELD, IS NOT PAID. This is the one place in the grant
 * path that fails closed, and it is the right place: everywhere else the choice is between a
 * duplicate grant and a paying reader with no book, and a duplicate grant is cheaper. Here
 * the choice is between a book given away and a book that arrives a few seconds late behind
 * a loud log line, and the log line is cheaper. Exported for tests.
 */
export function isPaidSession(session) {
  const status = session && session.payment_status;
  return status === 'paid' || status === 'no_payment_required';
}

// ──────────────────────────────────────────────────────────────────────────
// Stripe signature verification — manual HMAC-SHA256 since the Workers
// runtime cannot pull in the Stripe Node SDK without bundling.
// ──────────────────────────────────────────────────────────────────────────

function parseStripeSigHeader(header) {
  // Header looks like: t=1614265030,v1=abc...,v1=def...,v0=...
  // There can be multiple v1 values during a secret rotation; accept any.
  const parts = (header || '').split(',').map(s => s.trim()).filter(Boolean);
  let timestamp = null;
  const v1Sigs = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === 't') timestamp = v;
    else if (k === 'v1') v1Sigs.push(v);
  }
  return { timestamp, v1Sigs };
}

async function verifyStripeSignature(rawBody, header, secret) {
  const { timestamp, v1Sigs } = parseStripeSigHeader(header);
  if (!timestamp || v1Sigs.length === 0) {
    return { ok: false, reason: 'malformed Stripe-Signature header' };
  }

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'non-numeric timestamp in Stripe-Signature' };
  }
  // R9.2 PL-14: signed, not absolute. A positive age is an old body, a negative one is a
  // body dated in the future — different problems, different bounds, and neither is what
  // Math.abs was measuring.
  const ageSeconds = Math.floor(Date.now() / 1000) - ts;
  if (ageSeconds > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp too old (${ageSeconds}s)` };
  }
  if (ageSeconds < -STRIPE_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: `timestamp in the future (${-ageSeconds}s)` };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expectedBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expected = new Uint8Array(expectedBuf);

  for (const sig of v1Sigs) {
    const provided = hexToBytes(sig);
    if (provided && timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }
  return {
    ok: false,
    reason: `no v1 signature matched (expected ${bytesToHex(expected).slice(0, 12)}…)`,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Identity. uid comes from client_reference_id (set by checkout.js from a VERIFIED id
// token — never from anything the browser typed) with metadata.uid as the fallback;
// titleId comes from metadata. Charge-shaped events carry neither natively, which is why
// checkout.js also stamps payment_intent_data[metadata] — Stripe copies PaymentIntent
// metadata onto the Charge, so refunds and disputes arrive identifiable.
// ──────────────────────────────────────────────────────────────────────────

function extractIdentity(obj) {
  const meta = (obj && obj.metadata) || {};
  const fromRef = typeof obj?.client_reference_id === 'string' ? obj.client_reference_id : '';
  const fromMeta = typeof meta.uid === 'string' ? meta.uid : '';
  const titleId = typeof meta.titleId === 'string' ? meta.titleId : '';
  return { uid: fromRef || fromMeta || null, titleId: titleId || null };
}

// ──────────────────────────────────────────────────────────────────────────
// Event handling.
// ──────────────────────────────────────────────────────────────────────────

async function handleGrant(env, session) {
  const { uid, titleId } = extractIdentity(session);

  // A verified-but-unattributable session. Returning 4xx would make Stripe retry a request
  // that can never succeed, so this is logged loudly and acknowledged.
  if (!uid || !titleId) {
    console.error(
      `[bookstore/stripe-webhook] session ${session.id} has no uid/titleId ` +
      `(uid=${uid || '—'}, titleId=${titleId || '—'}) — nothing recorded`,
    );
    return;
  }

  // R9.2 PL-3. BEFORE the token mint, so an unpaid session costs nothing. This endpoint
  // routed on event type alone and never looked at payment_status; for a card that was
  // correct, because Stripe sets 'paid' before it sends completed. For a delayed-payment
  // method it granted the book on a session where the money had not moved and might never.
  if (!isPaidSession(session)) {
    console.error(
      `[bookstore/stripe-webhook] session ${session.id} for ${uid}/${titleId} has ` +
      `payment_status=${session.payment_status || '—'} — NOT granted. A delayed-payment ` +
      `method will follow with checkout.session.async_payment_succeeded; anything else here ` +
      `needs a human.`,
    );
    return;
  }

  const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);

  // Idempotency. Stripe delivers at-least-once and retries a non-2xx for up to 72 hours, so
  // the same checkout.session.completed can arrive again long after a refund revoked the
  // purchase. shouldSkipGrant() decides on the SESSION ID ALONE — see the full argument in
  // _lib.js. A different session id for the same book is a genuine repurchase and falls
  // through to the write, which is what makes buying-again-after-a-refund work.
  //
  // R8.2.1 removed a trailing `&& existing.status === 'active'` from this condition. It
  // inverted the guard in the one case the guard existed for: a replay against a revoked
  // record failed the test, fell through, and set status back to 'active'.
  let existing = null;
  try {
    existing = await readPurchase(env, token, uid, titleId);
  } catch (e) {
    // A failed idempotency read is not a reason to drop a purchase on the floor. Log it and
    // fall through to the write — a duplicate grant is a far smaller problem than a paying
    // reader with no book.
    console.error(`[bookstore/stripe-webhook] idempotency read failed for ${uid}/${titleId}:`, e.message || e);
  }
  if (shouldSkipGrant(existing, 'stripeSessionId', session.id)) {
    console.log(
      `[bookstore/stripe-webhook] duplicate ${session.id} for ${uid}/${titleId} ` +
      `(status=${existing.status}) — skipped`,
    );
    return;
  }

  const fields = await fetchTitleFields(env, token, titleId, LABEL);

  // R9.1 LB-7: the PaymentIntent id is stored alongside the session id because it is the ONLY
  // identifier that survives the hop from Checkout Session to Charge to Dispute. A
  // charge.refunded carries `payment_intent`; a charge.dispute.created carries it too. Neither
  // carries the session id, so without this field a refund could never prove which purchase it
  // was about, and every revocation would fall to manual review. Stripe types it as a string
  // when the session is complete and as an expandable object only when explicitly requested,
  // which we do not do — but guard anyway rather than store `[object Object]`.
  const paymentIntent = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (typeof session.payment_intent?.id === 'string' ? session.payment_intent.id : null);

  const payload = buildGrantPayload({
    amount: session.amount_total,
    currency: session.currency,
    refField: 'stripeSessionId',
    refValue: session.id,
    extraRefs: { stripePaymentIntent: paymentIntent },
    fields,
  });

  await patchPurchase(env, token, uid, titleId, payload);
  console.log(
    `[bookstore/stripe-webhook] recorded uid=${uid} titleId=${titleId} ` +
    `session=${session.id}${fields ? '' : ' (no denormalised fields)'}`,
  );
}

/**
 * Every identifier on a revoke-shaped event that could name the stored purchase.
 *
 * The three event types reach us as three different objects, and only one of them is the
 * Session that was stored:
 *
 *   checkout.session.async_payment_failed  → a Session. `id` IS the stored stripeSessionId.
 *   charge.refunded                        → a Charge.  `payment_intent` is the link.
 *   charge.dispute.created                 → a Dispute. `payment_intent` is the link, and
 *                                            `charge` names the charge it disputes.
 *
 * All of them are offered and the guard takes any match. `id` is included for every shape
 * because it costs nothing: a `ch_`/`dp_` id simply matches neither stored field.
 *
 * Exported for tests.
 */
export function revocationCandidates(obj) {
  const pi = typeof obj?.payment_intent === 'string'
    ? obj.payment_intent
    : (typeof obj?.payment_intent?.id === 'string' ? obj.payment_intent.id : null);
  const charge = typeof obj?.charge === 'string' ? obj.charge : null;
  const id = typeof obj?.id === 'string' ? obj.id : null;
  return [id, pi, charge].filter((v) => typeof v === 'string' && v);
}

async function handleRevoke(env, obj, reason) {
  const { uid, titleId } = extractIdentity(obj);

  if (!uid || !titleId) {
    console.error(
      `[bookstore/stripe-webhook] ${reason} event ${obj?.id || '—'} carries no uid/titleId ` +
      `— cannot match a purchase, nothing revoked`,
    );
    return;
  }

  const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);

  // R9.1 LB-7. The read is REQUIRED before the write, and a failed read must not fall through
  // to one — see the fail-closed argument on classifyRevocation in _lib.js. This is the
  // opposite posture to handleGrant above, on purpose.
  const candidates = revocationCandidates(obj);
  let existing;
  try {
    existing = await readPurchase(env, token, uid, titleId);
  } catch (e) {
    console.error(
      `[bookstore/stripe-webhook] NEEDS-MANUAL-REVIEW ${reason}: could not read ` +
      `${uid}/${titleId} to match the reference (${e.message || e}) — event refs=` +
      `[${candidates.join(', ') || '—'}], nothing revoked`,
    );
    return;
  }

  const { verdict, stored } = classifyRevocation(existing, STRIPE_REF_FIELDS, candidates);

  if (verdict === 'absent') {
    // R9.2 PL-3 changed what 'absent' MEANS for one of the three revoke events. Now that an
    // unpaid session no longer grants, the ordinary life of a failed delayed payment is
    // completed(unpaid) → nothing written → async_payment_failed → nothing to revoke. That
    // is the system working, and it must not page anyone. The other two reasons keep the
    // loud line: a refund or a dispute for a purchase that was never recorded means money
    // moved somewhere this ledger cannot see.
    if (reason === 'payment-failed') {
      console.log(
        `[bookstore/stripe-webhook] ${reason} for ${uid}/${titleId} with no purchase ` +
        `recorded — expected: the session was never granted because it was never paid.`,
      );
      return;
    }
    console.error(
      `[bookstore/stripe-webhook] NEEDS-MANUAL-REVIEW ${reason}: no purchase recorded at ` +
      `${uid}/${titleId} — event refs=[${candidates.join(', ') || '—'}], nothing revoked`,
    );
    return;
  }

  if (verdict === 'review') {
    // BOTH references, as the finding requires: the one on the record and the one on the
    // event. Without the pair a human cannot tell a repurchase from a bug.
    console.error(
      `[bookstore/stripe-webhook] NEEDS-MANUAL-REVIEW ${reason} for ${uid}/${titleId}: ` +
      `event refs=[${candidates.join(', ') || '—'}] do not match stored refs=` +
      `[${stored.join(', ') || '—'}] (record status=${existing.status || '—'}) — ` +
      `most likely a dispute for a refunded charge arriving after a repurchase. ` +
      `NOTHING WRITTEN; the reader keeps the book they paid for.`,
    );
    return;
  }

  await patchPurchase(env, token, uid, titleId, buildRevokePayload(reason));
  console.log(
    `[bookstore/stripe-webhook] revoked uid=${uid} titleId=${titleId} reason=${reason} ` +
    `(matched stored ref)`,
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const sigHeader = request.headers.get('Stripe-Signature');
  if (!sigHeader) return new Response('Missing Stripe-Signature', { status: 400 });

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('[bookstore/stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response('Server misconfigured', { status: 500 });
  }
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[bookstore/stripe-webhook] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    return new Response('Server misconfigured', { status: 500 });
  }

  // Must be the raw bytes as sent: the signature is over the exact body, so re-serialising
  // parsed JSON here would break verification for any payload Stripe formats differently.
  const rawBody = await request.text();

  const verification = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!verification.ok) {
    console.error('[bookstore/stripe-webhook] signature verification failed:', verification.reason);
    return new Response(`Invalid signature: ${verification.reason}`, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const obj = event.data && event.data.object;
  if (!obj) return new Response('Missing data.object', { status: 400 });

  // Past this line the request is provably from Stripe, so every exit is a 200. See the
  // response-policy note in the header.
  try {
    if (GRANT_EVENTS.has(event.type)) {
      await handleGrant(env, obj);
    } else if (REVOKE_EVENTS.has(event.type)) {
      await handleRevoke(env, obj, REVOKE_EVENTS.get(event.type));
    } else {
      return json({ received: true, ignored: event.type });
    }
  } catch (e) {
    console.error(`[bookstore/stripe-webhook] ${event.type} (${obj.id}) failed:`, e.message || e);
    return json({ received: true, degraded: true });
  }

  return json({ received: true });
}
