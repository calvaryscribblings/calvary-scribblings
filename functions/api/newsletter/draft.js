// Server-side proxy for the newsletter Worker's /draft endpoints.
//   POST   /api/newsletter/draft        -> POST   {worker}/draft        (save)
//   DELETE /api/newsletter/draft?id=ID  -> DELETE {worker}/draft/:id    (delete)
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
  const u = data?.users?.[0];
  return u ? { uid: u.localId ?? null, email: u.email ?? null } : null;
}

async function requireAdmin(request, env) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);
  const caller = await verifyAdminToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!isAdmin(caller)) return json({ error: 'Unauthorised.' }, 401);
  if (!env.NEWSLETTER_SEND_SECRET) return json({ error: 'Server misconfigured.' }, 500);
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const body = await request.text();
  const workerRes = await fetch(`${WORKER}/draft`, {
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

export async function onRequestDelete(context) {
  const { request, env } = context;
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get('id');
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
