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
    scope: 'https://www.googleapis.com/auth/firebase.database',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function lookupUsername(fbDb, bearer, uid) {
  try {
    const res = await fetch(`${fbDb}/users/${uid}/username.json`, { headers: bearer });
    if (!res.ok) return null;
    return await res.json() ?? null;
  } catch {
    return null;
  }
}

async function writeAuditLog(fbDb, bearer, entry) {
  try {
    const res = await fetch(`${fbDb}/quizResetLog.json`, {
      method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[admin/reset-attempt] audit write failed:', res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.error('[admin/reset-attempt] audit write threw:', e.message);
  }
}

// ── Single reset / unlock ─────────────────────────────────────────────────────

async function resetSingle(fbDb, bearer, adminUid, targetUid, slug, action, reason) {
  const checkRes = await fetch(`${fbDb}/quiz_submissions/${targetUid}/${slug}.json`, { headers: bearer });
  if (!checkRes.ok) throw new Error(`Submission read failed (${checkRes.status})`);
  if ((await checkRes.json()) === null) return { wasReset: false };

  const targetHandle = await lookupUsername(fbDb, bearer, targetUid);

  // Atomic PATCH: null all three paths + decrement attemptCount
  const patch = {
    [`quiz_submissions/${targetUid}/${slug}`]:   null,
    [`quizAttemptCounted/${targetUid}/${slug}`]: null,
    [`userStoryTiers/${targetUid}/${slug}`]:     null,
    [`cms_stories/${slug}/quizMeta/attemptCount`]: { '.sv': { 'increment': -1 } },
  };
  const patchRes = await fetch(`${fbDb}/.json`, {
    method: 'PATCH',
    headers: { ...bearer, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error(`Reset PATCH failed (${patchRes.status}): ${text.slice(0, 200)}`);
  }

  await writeAuditLog(fbDb, bearer, {
    adminUid, targetUid, targetHandle, slug,
    action, reason: reason || null, timestamp: Date.now(),
  });

  console.log(`[admin/reset-attempt] ${action} | target:${targetUid} slug:${slug} by:${adminUid}`);
  return { wasReset: true };
}

// ── Bulk reset ────────────────────────────────────────────────────────────────

async function resetBulk(fbDb, bearer, adminUid, slug, reason) {
  const dbRes = await fetch(`${fbDb}/quiz_submissions.json`, { headers: bearer });
  if (!dbRes.ok) throw new Error(`Submissions read failed (${dbRes.status})`);
  const all = await dbRes.json();
  if (!all) return { resetCount: 0 };

  const uids = Object.keys(all).filter(uid => all[uid]?.[slug]);
  if (uids.length === 0) return { resetCount: 0 };

  const handleResults = await Promise.allSettled(uids.map(uid => lookupUsername(fbDb, bearer, uid)));

  const patch = {};
  for (const uid of uids) {
    patch[`quiz_submissions/${uid}/${slug}`]   = null;
    patch[`quizAttemptCounted/${uid}/${slug}`] = null;
    patch[`userStoryTiers/${uid}/${slug}`]     = null;
  }
  patch[`cms_stories/${slug}/quizMeta/attemptCount`] = { '.sv': { 'increment': -uids.length } };

  const patchRes = await fetch(`${fbDb}/.json`, {
    method: 'PATCH',
    headers: { ...bearer, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error(`Bulk PATCH failed (${patchRes.status}): ${text.slice(0, 200)}`);
  }

  // One audit log entry per UID, non-fatal
  const now = Date.now();
  await Promise.allSettled(uids.map((uid, i) => {
    const handle = handleResults[i].status === 'fulfilled' ? handleResults[i].value : null;
    return writeAuditLog(fbDb, bearer, {
      adminUid, targetUid: uid, targetHandle: handle, slug,
      action: 'bulk', reason: reason || null, timestamp: now,
    });
  }));

  console.log(`[admin/reset-attempt] bulk | slug:${slug} count:${uids.length} by:${adminUid}`);
  return { resetCount: uids.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const adminUid = await verifyAdminToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (adminUid !== ADMIN_UID) return json({ error: 'Unauthorised.' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { uid: targetUid, slug, action = 'reset', reason } = body;

  if (!slug || typeof slug !== 'string') return json({ error: 'slug required.' }, 400);
  if (!['reset', 'unlock', 'bulk'].includes(action)) return json({ error: 'Invalid action.' }, 400);
  if (action !== 'bulk' && (!targetUid || typeof targetUid !== 'string')) {
    return json({ error: 'uid required.' }, 400);
  }

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb        = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

  if (!clientEmail || !privateKey) return json({ error: 'Server misconfigured.' }, 500);

  let accessToken;
  try {
    accessToken = await getAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[admin/reset-attempt] JWT error:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  const bearer = { Authorization: `Bearer ${accessToken}` };

  try {
    if (action === 'bulk') {
      const result = await resetBulk(fbDb, bearer, adminUid, slug, reason);
      return json({ ok: true, ...result });
    } else {
      const result = await resetSingle(fbDb, bearer, adminUid, targetUid, slug, action, reason);
      return json({ ok: true, ...result });
    }
  } catch (e) {
    console.error('[admin/reset-attempt] error:', e.message);
    return json({ error: e.message }, 500);
  }
}
