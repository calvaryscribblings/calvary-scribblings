// Server-side proxy for the calvary-auth Worker's /welcome endpoint.
//
//   POST /api/auth/welcome   (no body required)
//
// Sibling of ./send-verification.js — see that file's header for the full
// account of why the direct-from-browser call was replaced. Short version: the
// old call attached NEXT_PUBLIC_AUTH_SECRET, which would have shipped the
// secret to every visitor if it had been set, and was in fact unset, so the
// browser sent "Bearer undefined" and the Worker answered 401 to everything.
//
// The secret now lives in the Pages environment as AUTH_WORKER_SECRET and never
// enters any bundle. The recipient address comes off the verified account
// record rather than the request body, so a signed-in caller cannot aim
// brand-styled mail at an arbitrary inbox.
//
// ONE EXTRA GATE HERE. The welcome mail is the "you're verified, come in"
// message, so this refuses to send it for an account that is not actually
// verified. The client polls user.reload() until emailVerified flips and only
// then calls, but that is a client-side condition and this is the endpoint that
// can be called directly.

const AUTH_WORKER = 'https://calvary-auth.calvarymediauk.workers.dev';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyAccount(token, apiKey) {
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
  return data?.users?.[0] ?? null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const account = await verifyAccount(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!account) return json({ error: 'Unauthorised.' }, 401);
  if (!account.email) return json({ error: 'Account has no email address.' }, 400);

  // emailVerified comes back from the live account record, not from the token's
  // claims — a token minted before verification still reports the current state.
  if (account.emailVerified !== true) {
    return json({ error: 'Account is not verified.' }, 409);
  }

  if (!env.AUTH_WORKER_SECRET) {
    console.error('[auth/welcome] AUTH_WORKER_SECRET is not set in the Pages environment');
    return json({ error: 'Server misconfigured.' }, 500);
  }

  let body = {};
  try { body = await request.json(); } catch { /* body is optional */ }

  const firstName =
    (account.displayName || '').trim().split(' ')[0] ||
    (typeof body.firstName === 'string' ? body.firstName.trim().split(' ')[0] : '') ||
    'there';

  let workerRes;
  try {
    workerRes = await fetch(`${AUTH_WORKER}/welcome`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AUTH_WORKER_SECRET}`,
      },
      body: JSON.stringify({ email: account.email, firstName }),
    });
  } catch (e) {
    console.error('[auth/welcome] Worker unreachable:', e.message);
    return json({ error: 'Could not reach the mail service.' }, 502);
  }

  const text = await workerRes.text();
  if (!workerRes.ok) {
    console.error('[auth/welcome] Worker rejected:', workerRes.status, text.slice(0, 300));
    return json({ error: 'Welcome email could not be sent.', upstream: workerRes.status }, 502);
  }

  console.log('[auth/welcome] sent | uid:', account.localId);
  return json({ ok: true });
}
