// Server-side proxy for the newsletter Worker's /draft endpoints.
//   POST   /api/newsletter/draft         -> POST   {worker}/draft        (save)
//   DELETE /api/newsletter/draft?id=ID    -> DELETE {worker}/draft/:id    (delete)
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
//
// AUTH: the caller must present a Firebase ID token as `Authorization: Bearer
// <idToken>`; the uid is derived from it via identitytoolkit and only then
// checked against ADMIN_UIDS. Both methods below take the same route — the
// DELETE no longer reads ?uid= at all.
//
// The header above used to read "simple UID allowlist — the same pattern as
// functions/api/generate-quiz.js", with the uid taken from the body on POST and
// from the query string on DELETE. That description outlived its truth twice
// over: generate-quiz stopped doing this in 19b0175, and the pattern itself was
// never safe. The admin uids are public — client bundle, storage.rules, line 10
// here — so the allowlist was a check anyone could pass by typing the answer
// into the request. A stranger could save or delete any newsletter draft,
// including a scheduled one due to go out.
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

// Shared by both handlers: returns the verified admin uid, or a Response to
// return immediately.
async function requireAdmin(request, env) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: json({ error: 'Unauthorised.' }, 401) };

  const uid = await verifyToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return { error: json({ error: 'Unauthorised.' }, 401) };
  if (!ADMIN_UIDS.includes(uid)) return { error: json({ error: 'Unauthorised.' }, 401) };
  return { uid };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  console.log('[newsletter/draft] save | uid:', gate.uid, '(verified)');

  // A body uid, if any client still sends one, is stripped here and was never
  // consulted above. The Worker authorises via the secret.
  const { uid: _ignored, ...payload } = body;
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

  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required.' }, 400);

  console.log('[newsletter/draft] delete | uid:', gate.uid, '(verified) | id:', id);

  const workerRes = await fetch(`${WORKER}/draft/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.NEWSLETTER_SEND_SECRET}` },
  });

  return new Response(await workerRes.text(), {
    status: workerRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
