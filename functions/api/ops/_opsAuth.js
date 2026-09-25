// W7 — WHO MAY ASK THE OPS ENDPOINTS. Two callers, and nobody else:
//
//   a FOUNDER, with a Firebase ID token (a person checking by hand)
//   THE LAUNCH CHECK, running in GitHub Actions, with a short-lived JWT it signs with the site's
//   own Firebase service-account key — the key Actions already holds as FIREBASE_SERVICE_ACCOUNT
//   and this Pages project already holds as FIREBASE_PRIVATE_KEY. It is verified here against
//   Google's PUBLISHED public keys for that account, so no new secret exists anywhere, no new
//   sign-in account is created, and nothing in this file can sign.
//
// The service JWT: header { alg: RS256, kid }, payload { iss = sub = the service account email,
// aud = OPS_AUDIENCE, iat, exp }. Accepted only if exp is in the future and no more than ten
// minutes after iat, the email is THIS project's (env.FIREBASE_CLIENT_EMAIL), and the signature
// verifies under a key Google lists for that email right now (a rotated key stops working).

import { lookupUser } from '../bookstore/_lib.js';
import { isFounder } from '../../../app/lib/founders.js';

export const OPS_AUDIENCE = 'calvary-ops';
const MAX_LIFETIME_S = 600;

function b64urlToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const decodePart = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/** Pure: do the claims pass? `nowS` in seconds. */
export function claimsOk(payload, { email, nowS }) {
  if (!payload || typeof payload !== 'object' || !email) return false;
  if (payload.iss !== email || payload.sub !== email) return false;
  if (payload.aud !== OPS_AUDIENCE) return false;
  if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) return false;
  if (payload.exp <= nowS) return false;
  if (payload.iat > nowS + 60) return false;
  if (payload.exp - payload.iat > MAX_LIFETIME_S) return false;
  return true;
}

export async function verifyServiceJwt(token, env, { fetchImpl = fetch, nowS = Math.floor(Date.now() / 1000) } = {}) {
  try {
    const [h, p, sig] = String(token).split('.');
    if (!h || !p || !sig) return false;
    const header = decodePart(h);
    const payload = decodePart(p);
    if (header.alg !== 'RS256' || !header.kid) return false;
    const email = env.FIREBASE_CLIENT_EMAIL;
    if (!claimsOk(payload, { email, nowS })) return false;
    const res = await fetchImpl(`https://www.googleapis.com/service_accounts/v1/jwk/${encodeURIComponent(email)}`);
    if (!res.ok) return false;
    const jwk = (await res.json())?.keys?.find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return false;
  }
}

/** { ok, who } — who is 'founder' or 'launch-check'. */
export async function authoriseOps(request, env, deps = {}) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401 };
  let header0 = null;
  try { header0 = decodePart(token.split('.')[0]); } catch { /* not a JWT we sign */ }
  // A Firebase ID token is also RS256 with a kid, so a token that fails as ours falls through.
  if (header0 && header0.kid && await verifyServiceJwt(token, env, deps)) return { ok: true, who: 'launch-check' };
  const user = await lookupUser(token, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  if (user && isFounder(user.localId)) return { ok: true, who: 'founder' };
  return { ok: false, status: 403 };
}
