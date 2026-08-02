// Server-side proxy for the newsletter Worker's /send endpoint.
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
//
// AUTH: the caller must present a Firebase ID token as `Authorization: Bearer
// <idToken>`; the uid is derived from it via identitytoolkit and only then
// checked against ADMIN_UIDS. Same pattern as functions/api/generate-quiz.js
// since 19b0175.
//
// THIS ENDPOINT MAILS EVERY ACTIVE SUBSCRIBER. Until 19b0175's sibling round it
// read `uid` from the request BODY and compared that to the allowlist. The
// admin uids are not secret — they are in the client bundle, in storage.rules,
// and on line 10 of this file's siblings — so the check was one anyone could
// pass by typing the answer into the request. A stranger could have sent an
// arbitrary issue, under the platform's own FROM address, to the whole list,
// and no recall exists for mail.
const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const WORKER = 'https://calvary-newsletter.calvarymediauk.workers.dev';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Verbatim from functions/api/record-attempt.js.
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

export async function onRequestPost(context) {
  const { request, env } = context;

  // Authenticate BEFORE reading the body, so a forged uid never reaches a
  // variable.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const uid = await verifyToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Unauthorised.' }, 401);
  if (!ADMIN_UIDS.includes(uid)) return json({ error: 'Unauthorised.' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  console.log('[newsletter/send] uid:', uid, '(verified) | test:', !!(body.testTo ?? body.testEmail));

  // A body uid, if any client still sends one, is stripped here and was never
  // consulted above. The Worker authorises via the secret.
  const { uid: _ignored, ...payload } = body;
  const workerRes = await fetch(`${WORKER}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.NEWSLETTER_SEND_SECRET}`,
    },
    body: JSON.stringify(payload),
  });

  return new Response(await workerRes.text(), {
    status: workerRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
