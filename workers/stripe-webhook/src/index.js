// calvary-stripe-webhook — receives Stripe webhook events for the Dead End
// paywall and writes purchase records into Firebase RTDB at
// purchases/{uid}/{slug}.
//
// Architecture:
//   1. Verify the Stripe-Signature header against STRIPE_WEBHOOK_SECRET using
//      HMAC-SHA256 (Web Crypto). Reject if the timestamp is older than 5
//      minutes or if no v1 signature matches.
//   2. Parse the event body as JSON. Only checkout.session.completed events
//      result in a Firebase write; everything else is acknowledged with 200.
//   3. Mint a Google OAuth2 access token from the Firebase service account
//      (Web Crypto RS256 JWT) — same pattern as the calvary-account-purge
//      worker.
//   4. PATCH purchases/{uid}/{slug} with the purchase metadata.
//
// We always return 200 once signature verification has succeeded so Stripe
// does not retry on transient Firebase failures — those are surfaced via
// console.error and tail logs instead. (Stripe only retries on non-2xx, so
// hard failures during verification or missing-uid validation still return
// 4xx as appropriate.)

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
const DEFAULT_SLUG = 'dead-end-a-halfway-around-the-moon-story';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

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
// Mirrors workers/calvary-account-purge/src/index.js.
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
  // Wrangler secrets paste in with literal `\n` rather than newlines if the
  // user copied the JSON-escaped form — normalise so the PEM parser is happy.
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
// RTDB write — PATCH so we don't clobber any sibling fields that future
// flows might add (refund timestamps, fulfilment notes, etc.).
// ──────────────────────────────────────────────────────────────────────────

async function writePurchase(env, token, uid, slug, payload) {
  const url = `${env.FIREBASE_DATABASE_URL}/purchases/${encodeURIComponent(uid)}/${encodeURIComponent(slug)}.json?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`RTDB PATCH failed: ${res.status} ${await res.text()}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Event handling.
// ──────────────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(env, session) {
  const uid = session.client_reference_id;
  if (!uid || typeof uid !== 'string') {
    console.error('[stripe-webhook] missing client_reference_id on session', session.id);
    return { ok: false, status: 400, body: 'missing client_reference_id' };
  }

  const slug = (session.metadata && session.metadata.story_slug) || DEFAULT_SLUG;
  const amount = typeof session.amount_total === 'number' ? session.amount_total : null;
  const currency = session.currency || null;

  const payload = {
    purchasedAt: Date.now(),
    amount,
    currency,
    stripeSessionId: session.id,
  };

  try {
    const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    await writePurchase(env, token, uid, slug, payload);
    console.log(`[stripe-webhook] recorded purchase uid=${uid} slug=${slug} session=${session.id}`);
    return { ok: true };
  } catch (e) {
    // Swallow the error so Stripe doesn't retry — we'd rather investigate
    // via Workers logs and replay manually than have Stripe hammer us while
    // Firebase is unreachable. Surfaced via console.error → tail.
    console.error(`[stripe-webhook] firebase write failed for session ${session.id} uid=${uid}:`, e.message || e);
    return { ok: true, degraded: true };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Worker entry point.
// ──────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const sigHeader = request.headers.get('Stripe-Signature');
    if (!sigHeader) {
      return new Response('Missing Stripe-Signature', { status: 400 });
    }
    if (!env.STRIPE_WEBHOOK_SECRET) {
      console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET secret is not set');
      return new Response('Server misconfigured', { status: 500 });
    }

    const rawBody = await request.text();
    const verification = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
    if (!verification.ok) {
      console.error('[stripe-webhook] signature verification failed:', verification.reason);
      return new Response(`Invalid signature: ${verification.reason}`, { status: 400 });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (event.type !== 'checkout.session.completed') {
      // Acknowledge so Stripe does not retry. We deliberately accept every
      // event type the endpoint is configured to receive, even ones we don't
      // act on yet, to keep the dashboard tidy.
      return new Response(JSON.stringify({ received: true, ignored: event.type }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = event.data && event.data.object;
    if (!session) {
      return new Response('Missing data.object', { status: 400 });
    }

    const result = await handleCheckoutCompleted(env, session);
    if (!result.ok) {
      return new Response(result.body || 'error', { status: result.status || 500 });
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
