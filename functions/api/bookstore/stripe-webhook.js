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

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const PURCHASES_PATH = 'bookstore_purchases';
const TITLES_PATH = 'bookstore_titles';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// Events that grant access, and events that take it away. Anything not listed is
// acknowledged and ignored, so the Stripe dashboard can be configured broadly without
// this endpoint needing to change.
const GRANT_EVENTS = new Set(['checkout.session.completed']);
const REVOKE_EVENTS = new Map([
  ['charge.refunded', 'refunded'],
  ['charge.dispute.created', 'disputed'],
  ['checkout.session.async_payment_failed', 'payment-failed'],
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes) {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// Constant-time comparison over two equal-length Uint8Arrays. Returns false
// straight away for length mismatches — the lengths themselves are not
// secret, so leaking that is fine.
function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
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
// Firebase service-account OAuth token minting (RS256 via Web Crypto).
// ──────────────────────────────────────────────────────────────────────────

function b64url(input) {
  let str;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    str = btoa(bin);
  } else {
    str = btoa(input);
  }
  return str.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function mintAccessToken(clientEmail, privateKeyPem) {
  // Secrets paste in with literal `\n` rather than newlines if the value was copied from
  // the JSON-escaped service-account file — normalise so the PEM parser is happy.
  const privateKey = privateKeyPem.includes('\\n')
    ? privateKeyPem.replace(/\\n/g, '\n')
    : privateKeyPem;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

// ──────────────────────────────────────────────────────────────────────────
// RTDB access. The rescued worker passed the token as an ?access_token= query
// param; the sibling Pages Functions (record-attempt, open-pages/moderate) use an
// Authorization header instead. Following the siblings keeps a bearer token out of
// URLs, which is where tokens end up in logs.
// ──────────────────────────────────────────────────────────────────────────

const dbBase = (env) => (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

const purchaseUrl = (env, uid, titleId) =>
  `${dbBase(env)}/${PURCHASES_PATH}/${encodeURIComponent(uid)}/${encodeURIComponent(titleId)}.json`;

async function readPurchase(env, token, uid, titleId) {
  const res = await fetch(purchaseUrl(env, uid, titleId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`RTDB GET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// PATCH so we never clobber sibling fields a later flow might add (fulfilment notes,
// refund trails). A grant and a later revocation therefore layer on the same record.
async function patchPurchase(env, token, uid, titleId, payload) {
  const res = await fetch(purchaseUrl(env, uid, titleId), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`RTDB PATCH failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

// Denormalised display fields, so My Library can render a shelf without a second read and
// still shows something sane if the title doc is later renamed or removed. This mirrors the
// fallback chain in app/my-library/page.js. Never throws — a missing title costs us the
// four cosmetic fields, not the purchase.
async function fetchTitleFields(env, token, titleId) {
  try {
    const res = await fetch(
      `${dbBase(env)}/${TITLES_PATH}/${encodeURIComponent(titleId)}.json`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const t = await res.json();
    if (!t || typeof t !== 'object') return null;
    return {
      slug: typeof t.slug === 'string' ? t.slug : null,
      title: typeof t.title === 'string' ? t.title : null,
      author: typeof t.author === 'string' ? t.author : null,
      coverUrl: typeof t.coverUrl === 'string' ? t.coverUrl : null,
    };
  } catch (e) {
    console.error(`[bookstore/stripe-webhook] title lookup failed for ${titleId}:`, e.message || e);
    return null;
  }
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

  // Idempotency. Stripe delivers at-least-once, and a duplicate PATCH of identical data is
  // harmless in itself — but re-running it would resurrect a purchase that had since been
  // refunded, because the replayed grant would overwrite status:'revoked'. Skipping on an
  // exact session match is what makes replay safe rather than merely wasteful.
  let existing = null;
  try {
    existing = await readPurchase(env, token, uid, titleId);
  } catch (e) {
    // A failed idempotency read is not a reason to drop a purchase on the floor. Log it and
    // fall through to the write — a duplicate grant is a far smaller problem than a paying
    // reader with no book.
    console.error(`[bookstore/stripe-webhook] idempotency read failed for ${uid}/${titleId}:`, e.message || e);
  }
  if (existing && existing.stripeSessionId === session.id && existing.status === 'active') {
    console.log(`[bookstore/stripe-webhook] duplicate ${session.id} for ${uid}/${titleId} — skipped`);
    return;
  }

  const fields = await fetchTitleFields(env, token, titleId);

  const payload = {
    purchasedAt: Date.now(),
    amount: typeof session.amount_total === 'number' ? session.amount_total : null,
    currency: session.currency || null,
    stripeSessionId: session.id,
    status: 'active',
    ...(fields || {}),
  };

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
  await patchPurchase(env, token, uid, titleId, {
    status: 'revoked',
    revokedAt: Date.now(),
    revokedReason: reason,
  });
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
