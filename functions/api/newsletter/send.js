// Server-side proxy for the newsletter Worker's /send endpoint.
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
//
// Auth: simple UID allowlist read from the request body — the same pattern as
// functions/api/generate-quiz.js. No identitytoolkit lookup, no Firebase API
// key, no network call. The client sends the signed-in user's uid in the body.
const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const WORKER = 'https://calvary-newsletter.calvarymediauk.workers.dev';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  // TEMP DEBUG: echo the received uid so we can see what the function gets. STRIP after.
  if (!ADMIN_UIDS.includes(body.uid)) return json({ error: 'Unauthorised.', receivedUid: body.uid ?? null }, 401);
  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  // Forward everything except the uid (the Worker authorises via the secret).
  const { uid, ...payload } = body;
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
