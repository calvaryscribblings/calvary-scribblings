// Server-side proxy for the calvary-auth Worker's /send-verification endpoint.
//
//   POST /api/auth/send-verification   (no body required)
//
// WHY THIS EXISTS. AuthModal used to call the Worker directly, attaching
// `Authorization: Bearer ${process.env.NEXT_PUBLIC_AUTH_SECRET}`. That was
// broken in two independent ways:
//
//   1. NEXT_PUBLIC_* is inlined into the client bundle at build time, so the
//      "secret" would have shipped to every visitor had it been set at all. A
//      value anyone can read is not a credential; it is a spam vector, because
//      this Worker sends brand-styled mail to whatever address it is handed.
//   2. It was NOT set at build, so the browser sent the literal string
//      "Bearer undefined" and the Worker answered 401 to every request. The
//      call site did not check res.ok, so the failure was silent — new accounts
//      simply never received a verification email, for an unknown length of
//      time. That is the breakage this round exists to repair.
//
// The secret now lives in the Pages environment as AUTH_WORKER_SECRET, is read
// through context.env here, and never enters any bundle.
//
// WHO MAY CALL: any caller holding a valid Firebase ID token, verified through
// the same identitytoolkit path record-attempt.js and generate-quiz.js use. A
// signed-out caller gets 401.
//
// WHO THE MAIL GOES TO is decided HERE, not by the caller. The address is read
// off the verified account record, so a signed-in user cannot aim this Worker
// at somebody else's inbox — which they could have done with a body-supplied
// email, and which is exactly the abuse a shipped secret would have enabled.
// firstName is cosmetic (it only greets the reader) and falls back to the body
// value when the account has no displayName yet.

const AUTH_WORKER = 'https://calvary-auth.calvarymediauk.workers.dev';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Same call as verifyToken() elsewhere in functions/, but returns the whole
// user record — this proxy needs the account's email, not just its uid.
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

  if (!env.AUTH_WORKER_SECRET) {
    // Loud, not silent. The whole point of this round is that a missing secret
    // must never again look like success.
    console.error('[auth/send-verification] AUTH_WORKER_SECRET is not set in the Pages environment');
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
    workerRes = await fetch(`${AUTH_WORKER}/send-verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AUTH_WORKER_SECRET}`,
      },
      body: JSON.stringify({ email: account.email, firstName }),
    });
  } catch (e) {
    console.error('[auth/send-verification] Worker unreachable:', e.message);
    return json({ error: 'Could not reach the mail service.' }, 502);
  }

  const text = await workerRes.text();
  if (!workerRes.ok) {
    console.error('[auth/send-verification] Worker rejected:', workerRes.status, text.slice(0, 300));
    return json({ error: 'Verification email could not be sent.', upstream: workerRes.status }, 502);
  }

  console.log('[auth/send-verification] sent | uid:', account.localId);
  return json({ ok: true });
}
