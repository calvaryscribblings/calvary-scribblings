// Server-side proxy for the newsletter Worker's /drafts endpoint.
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
//
// AUTH: the caller must present a Firebase ID token as `Authorization: Bearer
// <idToken>`; the uid is derived from it via identitytoolkit and only then
// checked against ADMIN_UIDS. The ?uid= query param is gone.
//
// It previously trusted that query param outright. The admin uids are public,
// so `GET /api/newsletter/drafts?uid=XaG6...` returned every saved and
// scheduled newsletter — subject lines, full block content, send times — to
// anyone who asked.
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

export async function onRequestGet(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const uid = await verifyToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Unauthorised.' }, 401);
  if (!ADMIN_UIDS.includes(uid)) return json({ error: 'Unauthorised.' }, 401);

  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);

  const workerRes = await fetch(`${WORKER}/drafts`, {
    headers: { Authorization: `Bearer ${env.NEWSLETTER_SEND_SECRET}` },
  });

  return new Response(await workerRes.text(), {
    status: workerRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
