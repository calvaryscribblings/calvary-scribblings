// Server-side proxy for the newsletter Worker's /drafts endpoint.
// Holds the Worker secret in env.NEWSLETTER_SEND_SECRET so it never ships to
// the browser. Only authenticated admins (founder/Eva) may call through.
//
// Auth: simple UID allowlist read from the ?uid= query param — the same pattern
// as functions/api/generate-quiz.js (this is a GET, so the uid travels in the
// query string rather than a body). No identitytoolkit lookup, no Firebase API
// key, no network call.
const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const WORKER = 'https://calvary-newsletter.calvarymediauk.workers.dev';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const uid = new URL(request.url).searchParams.get('uid');
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
