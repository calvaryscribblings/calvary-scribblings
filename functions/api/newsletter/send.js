// Server-side proxy for the newsletter Worker's /send endpoint.
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const ADMIN_EMAILS = ['ikennaworksfromhome@gmail.com', 'fynbecki@gmail.com'];
const WORKER = 'https://calvary-newsletter.calvarymediauk.workers.dev';

// Authorise by UID OR admin email — matches the app's admin rule (commit 3293247).
function isAdmin(caller) {
  if (!caller) return false;
  if (ADMIN_UIDS.includes(caller.uid)) return true;
  const email = caller.email?.toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyAdminToken(token, apiKey) {
  // TEMP DEBUG: confirm the API key var actually arrives in the Functions env.
  console.log('[newsletter/send] verify: apiKey present?', !!apiKey, 'len', apiKey ? apiKey.length : 0);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  // TEMP DEBUG: surface the identitytoolkit response status; a non-OK here
  // (wrong/missing key, expired token) silently becomes null and reads as "Unauthorised".
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    console.log('[newsletter/send] verify: lookup NOT ok, status', res.status, 'body', detail);
    return null;
  }
  const data = await res.json();
  const u = data?.users?.[0];
  if (!u) {
    console.log('[newsletter/send] verify: lookup ok but no user record in response');
    return null;
  }
  console.log('[newsletter/send] verify: ok uid', u.localId ?? null, 'email', u.email ?? null);
  return { uid: u.localId ?? null, email: u.email ?? null };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  // TEMP DEBUG: did the Authorization header arrive with a Bearer token?
  console.log('[newsletter/send] auth header present?', !!authHeader, 'token present?', !!token);
  if (!token) return json({ error: 'Unauthorised.', debug: 'no-token' }, 401);

  const caller = await verifyAdminToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  // TEMP DEBUG: did verify return a caller, and is that caller an admin?
  console.log('[newsletter/send] caller', caller ? JSON.stringify(caller) : 'null', 'isAdmin?', isAdmin(caller));
  if (!caller) return json({ error: 'Unauthorised.', debug: 'verify-null' }, 401);
  if (!isAdmin(caller)) {
    return json(
      { error: 'Unauthorised.', debug: 'not-admin', callerUid: caller.uid, callerEmail: caller.email },
      401
    );
  }

  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  const body = await request.text();
  const workerRes = await fetch(`${WORKER}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.NEWSLETTER_SEND_SECRET}`,
    },
    body,
  });

  return new Response(await workerRes.text(), {
    status: workerRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
