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
} from './_lib.js';

const LABEL = 'bookstore/stripe-webhook';

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

// Events that grant access, and events that take it away. Anything not listed is
// acknowledged and ignored, so the Stripe dashboard can be configured broadly without
// this endpoint needing to change.
const GRANT_EVENTS = new Set(['checkout.session.completed']);
const REVOKE_EVENTS = new Map([
  ['charge.refunded', 'refunded'],
  ['charge.dispute.created', 'disputed'],
  ['checkout.session.async_payment_failed', 'payment-failed'],
]);

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
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSeconds > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp outside tolerance (${ageSeconds}s)` };
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

  const payload = buildGrantPayload({
    amount: session.amount_total,
    currency: session.currency,
    refField: 'stripeSessionId',
    refValue: session.id,
    fields,
  });

  await patchPurchase(env, token, uid, titleId, payload);
  console.log(
    `[bookstore/stripe-webhook] recorded uid=${uid} titleId=${titleId} ` +
    `session=${session.id}${fields ? '' : ' (no denormalised fields)'}`,
  );
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
  await patchPurchase(env, token, uid, titleId, buildRevokePayload(reason));
  console.log(`[bookstore/stripe-webhook] revoked uid=${uid} titleId=${titleId} reason=${reason}`);
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
