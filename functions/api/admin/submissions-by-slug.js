const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const ADMIN_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyAdminToken(token, apiKey) {
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

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(clientEmail, privateKeyPem) {
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false, ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header  = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(enc.encode(JSON.stringify({
    iss: clientEmail, sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.database',
    iat: now, exp: now + 3600,
  })));

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

export async function onRequestGet(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const callerUid = await verifyAdminToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (callerUid !== ADMIN_UID) return json({ error: 'Unauthorised.' }, 401);

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) return json({ error: 'slug required.' }, 400);

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb        = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

  if (!clientEmail || !privateKey) {
    return json({ error: 'Server misconfigured.' }, 500);
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[admin/submissions-by-slug] JWT error:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  const bearer = { Authorization: `Bearer ${accessToken}` };

  const dbRes = await fetch(`${fbDb}/quiz_submissions.json`, { headers: bearer });

  if (!dbRes.ok) {
    const text = await dbRes.text();
    console.error('[admin/submissions-by-slug] DB read failed:', dbRes.status, text.slice(0, 300));
    return json({ error: 'Failed to read submissions.' }, 500);
  }

  const allSubmissions = await dbRes.json();
  if (!allSubmissions) return json({ submissions: [] });

  const submissions = [];
  for (const [uid, userSubs] of Object.entries(allSubmissions)) {
    if (!userSubs || !userSubs[slug]) continue;
    const sub = userSubs[slug];
    submissions.push({
      uid,
      hardballPassed: sub.hardballPassed,
      tier: sub.tier ?? null,
      pointsAwarded: sub.pointsAwarded ?? 0,
      submittedAt: sub.submittedAt ?? null,
    });
  }

  submissions.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));

  return json({ submissions });
}
