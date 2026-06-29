// Story read-counter Pages Function.
//
//   POST (or GET) /api/hit?slug=<storySlug>  ->  { count: <updatedTotal> }
//
// Replaces the /api/hit endpoint that was removed in the functions/ restructure.
// The story and reader pages call this on mount —
//   fetch('/api/hit?slug=…', { method: 'POST' })
// — to record a read and display the live total (app/stories/[slug]/page-client.js
// and app/reader/[slug]/page-reader.js both read { count }).
//
// This is a Cloudflare Pages Function (the deployed app is a static `output:'export'`
// build served from out/, so Next.js Route Handlers do not run as live endpoints —
// only root-level functions/ are executed by Cloudflare Pages). It mirrors the
// service-account auth used by functions/api/open-pages/moderate.js and
// functions/api/record-attempt.js: a short-lived OAuth token minted from the
// FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY Pages env vars lets the function
// write the rules-locked stories node. The increment itself is an atomic RTDB
// server-side ServerValue increment, so concurrent reads never lose updates —
// the same guarantee a runTransaction would give on the client SDK.

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Service-account auth — mint an OAuth access token for the Firebase Admin REST
// API (copied from functions/api/open-pages/moderate.js).
// ---------------------------------------------------------------------------

function base64url(arrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(clientEmail, privateKeyPem) {
  const pemBody = privateKeyPem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,
    ''
  );
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(
    enc.encode(
      JSON.stringify({
        iss: clientEmail,
        sub: clientEmail,
        aud: 'https://oauth2.googleapis.com/token',
        scope:
          'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
        iat: now,
        exp: now + 3600,
      })
    )
  );

  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  const jwt = `${signingInput}.${base64url(sig)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

// ---------------------------------------------------------------------------
// Handler — shared by GET and POST. Atomically bumps stories/{slug}/hits and
// returns the updated total.
// ---------------------------------------------------------------------------

async function handle(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug required.' }, 400);

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

  if (!clientEmail || !privateKey) {
    console.error('[hit] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    return json({ error: 'Server misconfigured.' }, 500);
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[hit] token exchange failed:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  const auth = { Authorization: `Bearer ${accessToken}` };
  const hitsPath = `${fbDb}/stories/${encodeURIComponent(slug)}/hits.json`;

  // Atomic server-side increment (ServerValue.increment over REST).
  try {
    const incRes = await fetch(hitsPath, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ '.sv': { increment: 1 } }),
    });
    if (!incRes.ok) {
      const text = await incRes.text();
      console.error('[hit] increment failed:', incRes.status, text.slice(0, 200));
      return json({ error: `Increment failed (${incRes.status}).` }, 500);
    }
  } catch (e) {
    console.error('[hit] increment error:', e.message);
    return json({ error: 'Increment failed.' }, 500);
  }

  // Read back the authoritative post-increment total.
  let count = null;
  try {
    const getRes = await fetch(hitsPath, { headers: auth });
    if (getRes.ok) {
      const v = await getRes.json();
      if (typeof v === 'number') count = v;
    }
  } catch (e) {
    console.warn('[hit] read-back failed:', e.message);
  }

  return json({ count });
}

export async function onRequestGet(context) {
  return handle(context);
}

export async function onRequestPost(context) {
  return handle(context);
}
