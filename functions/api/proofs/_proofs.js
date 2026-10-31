// PROOFS — what the two endpoints share: identity, the switch, and admin reads.
// Underscore-prefixed so Pages does not route it.
//
// The answer a caller gets never depends on anything the client says about itself: the uid is
// the verified ID token's, founder is isFounder(uid) on the server, and the switch is read from
// the database with an admin token on every call.
//
// ── FAIL CLOSED ─────────────────────────────────────────────────────────────────────────
// A switch that can't be read is a closed switch. A non-founder then gets "nothing", the same
// as while Proofs is closed — never somebody else's proof.
import { json, dbBase, verifyIdToken, mintAccessToken, SCOPES, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { isFounder } from '../../../app/lib/founders.js';
import { PROOFS_ACCESS_PATH } from '../../../app/lib/proofs.js';

// Never cached anywhere: a proof is one writer's unreleased text.
export const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

export function respond(data, status = 200) {
  const res = json(data, status);
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

export const NOT_FOUND = Object.freeze({ error: 'That proof could not be found.', code: 'not_found' });

export function readIdToken(request, body) {
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

export async function readBody(request) {
  const raw = await request.text().catch(() => '');
  if (!raw || !raw.trim()) return {};
  try { const b = JSON.parse(raw); return b && typeof b === 'object' ? b : null; } catch { return null; }
}

export async function readJson(env, token, path, query = '') {
  const res = await fetch(`${dbBase(env)}/${path}.json${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status}`);
  return res.json();
}

export const configured = (env) => !!(env.NEXT_PUBLIC_FIREBASE_API_KEY && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);

/**
 * Who is calling, and may they use Proofs at all.
 *   → { error: Response } on a missing/broken token or an unreadable server credential
 *   → { uid, founder, open, token }
 * `founders` is injectable for the tests, which never use a founder account.
 */
export async function identify(request, body, env, { founders = isFounder } = {}) {
  const idToken = readIdToken(request, body);
  if (!idToken) return { error: respond({ error: 'Please sign in.', code: 'signed_out' }, 401) };
  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return { error: respond({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401) };

  let token;
  try { token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES); }
  catch (e) {
    console.error('[proofs] admin token mint failed:', e?.message || e);
    return { error: respond({ error: 'Proofs couldn’t be opened just now. Please try again.', code: 'unavailable' }, 502) };
  }

  const founder = founders(uid) === true;
  let open = false;
  if (!founder) {
    try { open = (await readJson(env, token, `${PROOFS_ACCESS_PATH}/open`)) === true; }
    catch (e) { console.error('[proofs] switch read failed — treating Proofs as closed:', e?.message || e); open = false; }
  }
  return { uid, founder, open: founder || open, token };
}
