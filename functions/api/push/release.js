// P4-B1 — POST /api/push/release { installId }: a phone gives its rows up.
//
// A phone signed out by force (an expired session, a deleted or disabled account) can no longer
// write push_tokens/{uid}, so the row stays and that account's pushes would keep reaching it (A58
// could not remove it). The app (A60) keeps a random install id of its own, never sent anywhere
// but here, and writes only its SHA-256 (installHash) on each row it registers. On reaching the
// signed-out state, whatever the cause, it posts the id; every row carrying its hash comes off,
// under every account.
//
// No sign-in is needed, by design: the caller may have none. Holding the install id is the proof,
// and the id never leaves the phone otherwise, so nobody else can release a device. The answer is
// always { ok: true }: it never says whether a row was found.
//
// Three subrequests: the token, one read of push_tokens, one PATCH. LOGGING: counts only.

import { mintAccessToken, SCOPES } from '../bookstore/_lib.js';
import { notifyDb, newBudget } from '../_notify.js';

const LABEL = 'push-release';
/** The install id the app generates: 32–128 URL-safe characters. */
export const INSTALL_ID_RE = /^[A-Za-z0-9_-]{32,128}$/;

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every row whose installHash is `hash`. */
export function rowsForHash(tokens, hash) {
  const out = [];
  for (const [uid, rows] of Object.entries(tokens || {})) {
    for (const [tokenKey, row] of Object.entries(rows || {})) if (row && row.installHash === hash) out.push({ uid, tokenKey });
  }
  return out;
}

export async function handleRelease(context, { stats = null } = {}) {
  const { request, env } = context;
  let body;
  try { body = JSON.parse((await request.text()) || 'null'); } catch { return reply({ ok: false, code: 'bad_request' }, 400); }
  const installId = body && typeof body === 'object' ? body.installId : null;
  if (typeof installId !== 'string' || !INSTALL_ID_RE.test(installId)) return reply({ ok: false, code: 'bad_request' }, 400);
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) { console.error(`[${LABEL}] unconfigured`); return reply({ ok: false, code: 'unavailable' }, 503); }
  const budget = newBudget(5);
  try {
    budget.take(1);
    const db = notifyDb(env, await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES), budget);
    const rows = rowsForHash((await db.get('push_tokens')) || {}, await sha256Hex(installId));
    if (rows.length) await db.patch(Object.fromEntries(rows.map((r) => [`push_tokens/${r.uid}/${r.tokenKey}`, null])));
    if (stats) Object.assign(stats, { released: rows.length, used: budget.used });
    return reply({ ok: true });
  } catch (e) {
    console.error(`[${LABEL}] failed: ${e?.code || e?.message || 'error'}`);
    return reply({ ok: false, code: 'unavailable' }, 502);
  }
}

export async function onRequestPost(context) { return handleRelease(context); }
