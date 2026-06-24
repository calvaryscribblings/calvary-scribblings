// Server-side proxy for the newsletter Worker's /draft endpoints.
//   POST   /api/newsletter/draft         -> POST   {worker}/draft        (save)
//   DELETE /api/newsletter/draft?id=ID    -> DELETE {worker}/draft/:id    (delete)
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
//
// Auth: simple UID allowlist — the same pattern as functions/api/generate-quiz.js.
// POST reads uid from the body; DELETE reads it from the ?uid= query param.
// No identitytoolkit lookup, no Firebase API key, no network call.
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

  if (!ADMIN_UIDS.includes(body.uid)) return json({ error: 'Unauthorised.' }, 401);
  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  // Forward everything except the uid (the Worker authorises via the secret).
  const { uid, ...payload } = body;
  const workerRes = await fetch(`${WORKER}/draft`, {
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

export async function onRequestDelete(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const uid = url.searchParams.get('uid');
  if (!ADMIN_UIDS.includes(uid)) return json({ error: 'Unauthorised.' }, 401);
  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required.' }, 400);

  const workerRes = await fetch(`${WORKER}/draft/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.NEWSLETTER_SEND_SECRET}` },
  });

  return new Response(await workerRes.text(), {
    status: workerRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
