const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyToken(token, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.localId ?? null;
}

function base64url(arrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(clientEmail, privateKeyPem) {
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header  = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(enc.encode(JSON.stringify({
    iss:   clientEmail,
    sub:   clientEmail,
    aud:   'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
    iat:   now,
    exp:   now + 3600,
  })));

  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    enc.encode(signingInput)
  );
  const jwt = `${signingInput}.${base64url(sig)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const uid = await verifyToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Unauthorised.' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { slug } = body;
  if (!slug || typeof slug !== 'string') return json({ error: 'slug required.' }, 400);

  console.log('[record-attempt] uid:', uid, '| slug:', slug);

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb        = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

  if (!clientEmail || !privateKey) {
    console.error('[record-attempt] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    return json({ error: 'Server misconfigured.' }, 500);
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[record-attempt] JWT/token exchange failed:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  const bearer = { Authorization: `Bearer ${accessToken}` };

  // Idempotency: skip if this user has already been counted for this story
  const countedRes = await fetch(
    `${fbDb}/quizAttemptCounted/${uid}/${slug}.json`,
    { headers: bearer }
  );
  if (!countedRes.ok) {
    const text = await countedRes.text();
    console.error('[record-attempt] Firebase idempotency read failed:', countedRes.status, text.slice(0, 500));
    return json({ error: 'Failed to check idempotency.' }, 500);
  }
  const counted = await countedRes.json();
  if (counted === true) {
    console.log('[record-attempt] already counted — no-op | uid:', uid, '| slug:', slug);
    return json({ ok: true, counted: false });
  }

  // Mark counted + server-side increment in one atomic PATCH
  const updates = {
    [`quizAttemptCounted/${uid}/${slug}`]: true,
    [`cms_stories/${slug}/quizMeta/attemptCount`]: { '.sv': { 'increment': 1 } },
  };

  const patchRes = await fetch(`${fbDb}/.json`, {
    method: 'PATCH',
    headers: { ...bearer, 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!patchRes.ok) {
    const text = await patchRes.text();
    console.error('[record-attempt] Firebase PATCH failed:', patchRes.status, text.slice(0, 500));
    return json({ error: 'Failed to record attempt.' }, 500);
  }

  console.log('[record-attempt] success | uid:', uid, '| slug:', slug);
  return json({ ok: true, counted: true });
}
