const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const FB_PROJECT_ID = 'calvary-scribblings';
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
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.localId ?? null;
}

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Local copy with the `firebase` scope added on top of userinfo.email +
// firebase.database — needed for Identity Toolkit accounts:batchGet. Inlined
// here (not refactored into the shared helper) because this function is a
// one-off backfill that will be deleted after the run.
async function getAccessToken(clientEmail, privateKeyPem) {
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, false, ['sign']
  );
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header  = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(enc.encode(JSON.stringify({
    iss: clientEmail, sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/firebase.database',
      'https://www.googleapis.com/auth/firebase',
    ].join(' '),
    iat: now, exp: now + 3600,
  })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  const jwt = `${signingInput}.${base64url(sig)}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
  }
  const { access_token } = await tokenRes.json();
  return access_token;
}

async function listAllAuthUsers(projectId, accessToken) {
  const all = [];
  let pageToken = null;
  let pages = 0;
  do {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchGet`);
    url.searchParams.set('maxResults', '1000');
    if (pageToken) url.searchParams.set('nextPageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Auth list failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    if (Array.isArray(data.users)) all.push(...data.users);
    pageToken = data.nextPageToken ?? null;
    pages += 1;
    if (pages > 50) throw new Error('Auth list pagination exceeded 50-page safety limit.');
  } while (pageToken);
  return all;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const adminUid = await verifyAdminToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (adminUid !== ADMIN_UID) return json({ error: 'Unauthorised.' }, 401);

  let body = {};
  try { body = await request.json(); } catch {}
  const dryRun = body?.dryRun === true;

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb        = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');
  const projectId   = env.FIREBASE_PROJECT_ID ?? FB_PROJECT_ID;

  if (!clientEmail || !privateKey) return json({ error: 'Server misconfigured.' }, 500);

  let accessToken;
  try {
    accessToken = await getAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[admin/backfill-joindate] JWT error:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  const bearer = { Authorization: `Bearer ${accessToken}` };

  let authUsers;
  try {
    authUsers = await listAllAuthUsers(projectId, accessToken);
  } catch (e) {
    console.error('[admin/backfill-joindate] list auth failed:', e.message);
    return json({ error: e.message }, 500);
  }

  const dbRes = await fetch(`${fbDb}/users.json`, { headers: bearer });
  if (!dbRes.ok) {
    const text = await dbRes.text();
    console.error('[admin/backfill-joindate] users read failed:', dbRes.status, text.slice(0, 300));
    return json({ error: 'Failed to read users.' }, 500);
  }
  const dbUsers = (await dbRes.json()) ?? {};

  const patch = {};
  const errors = [];
  const sample = [];
  let alreadyHadJoinDate = 0;
  let backfilled = 0;

  for (const u of authUsers) {
    const uid = u.localId;
    if (!uid) {
      errors.push({ uid: null, reason: 'Auth record missing localId.' });
      continue;
    }
    const existing = dbUsers[uid]?.joinDate;
    if (typeof existing === 'number' && existing > 0) {
      alreadyHadJoinDate += 1;
      continue;
    }
    const createdAt = Number(u.createdAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0) {
      errors.push({ uid, reason: `Invalid createdAt: ${u.createdAt}` });
      continue;
    }
    patch[`${uid}/joinDate`] = createdAt;
    backfilled += 1;
    if (sample.length < 5) {
      sample.push({ uid, joinDate: createdAt, email: u.email ?? null });
    }
  }

  if (!dryRun && backfilled > 0) {
    const patchRes = await fetch(`${fbDb}/users.json`, {
      method: 'PATCH',
      headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text();
      console.error('[admin/backfill-joindate] PATCH failed:', patchRes.status, text.slice(0, 300));
      return json({ error: `PATCH failed (${patchRes.status}): ${text.slice(0, 200)}` }, 500);
    }
    console.log(`[admin/backfill-joindate] wrote ${backfilled} joinDate entries by ${adminUid}`);
  }

  return json({
    totalUsers: authUsers.length,
    alreadyHadJoinDate,
    backfilled,
    errors,
    sample,
    dryRun,
  });
}
