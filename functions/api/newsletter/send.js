// Server-side proxy for the newsletter Worker's /send endpoint.
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const ADMIN_EMAILS = ['ikennaworksfromhome@gmail.com', 'fynbecki@gmail.com'];
const WORKER = 'https://calvary-newsletter.calvarymediauk.workers.dev';
// Public Firebase Web API key (client identifier, safe to hardcode — matches
// app/lib/firebase.js). NEWSLETTER_SEND_SECRET is the real secret and stays in env.
const FIREBASE_API_KEY = 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY';

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

// TEMP DEBUG (send@dbg1): returns a richer diagnostic instead of bare null so
// the authed failure path can be discriminated. STRIP after diagnosis — restore
// the plain `verifyAdminToken` that returns { uid, email } | null.
async function verifyAdminToken(token) {
  let res;
  try {
    res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      }
    );
  } catch (e) {
    return { ok: false, reason: 'lookup-threw', detail: String(e).slice(0, 200) };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, reason: 'lookup-not-ok', status: res.status, detail: detail.slice(0, 200) };
  }
  const data = await res.json().catch(() => null);
  const u = data?.users?.[0];
  if (!u) return { ok: false, reason: 'no-user' };
  return { ok: true, uid: u.localId ?? null, email: u.email ?? null };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.', fn: 'send@dbg1', debug: 'no-token' }, 401);

  // TEMP DEBUG (send@dbg1): distinguish verify-failed vs not-admin vs no-secret.
  const v = await verifyAdminToken(token);
  if (!v.ok) {
    return json(
      {
        error: 'Unauthorised.',
        fn: 'send@dbg1',
        debug: 'verify-failed:' + v.reason + (v.status ? '(' + v.status + ')' : ''),
        apiKeyPresent: true,
        lookupStatus: v.status ?? null,
        lookupDetail: v.detail ?? null,
      },
      401
    );
  }
  const caller = { uid: v.uid, email: v.email };
  if (!isAdmin(caller)) {
    return json(
      {
        error: 'Unauthorised.',
        fn: 'send@dbg1',
        debug: 'not-admin',
        sawEmail: v.email,
        sawUid: v.uid,
        apiKeyPresent: true,
      },
      401
    );
  }

  if (!env.NEWSLETTER_SEND_SECRET) {
    return json({ error: 'Server misconfigured.', fn: 'send@dbg1', debug: 'no-secret' }, 500);
  }

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
